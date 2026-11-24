'use strict';
// Servidor HTTP: LP estática (com config injetada), API de eventos/leads e painel privado. Sem dependências externas.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const lib = require('./lib');
const track = require('./track');
const panel = require('./panel');

const PUBLIC = path.join(lib.ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.xml']);
const PAGES = { '/politica-de-privacidade': 'politica-de-privacidade.html' };

function baseHeaders(req, extra = {}) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    ...extra,
  };
  if (lib.isHttps(req)) h['Strict-Transport-Security'] = 'max-age=31536000';
  return h;
}

function send(req, res, status, body, headers = {}, ext = '.html') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = baseHeaders(req, headers);
  if (!h['Content-Type']) h['Content-Type'] = MIME[ext] || 'application/octet-stream';
  if (COMPRESSIBLE.has(ext) && buf.length > 800 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding';
    const z = zlib.gzipSync(buf);
    h['Content-Length'] = z.length;
    res.writeHead(status, h); res.end(req.method === 'HEAD' ? undefined : z); return;
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h); res.end(req.method === 'HEAD' ? undefined : buf);
}
const sendJson = (req, res, status, obj) => send(req, res, status, JSON.stringify(obj), {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 413 ? { Connection: 'close' } : {}),
}, '.json');

// ---------- template da LP ----------
let tplCache = { key: '', html: '' };
function renderTemplate(file) {
  const cfg = lib.getConfig();
  const src = path.join(PUBLIC, file);
  const key = file + ':' + fs.statSync(src).mtimeMs + ':' + JSON.stringify(cfg);
  if (tplCache.key === key) return tplCache.html;
  const s = cfg.site, t = cfg.tracking;
  const pub = {
    wa: String(s.whatsapp || '').replace(/\D/g, ''),
    gtm: t.gtm, ga4: t.ga4, pixel: t.metaPixel, ads: t.googleAdsId, adsLead: t.googleAdsLeadLabel, adsWa: t.googleAdsWhatsappLabel,
    anon: t.analiseAnonimaSemConsentimento !== false,
    logos: s.marcasTribunais !== false,
  };
  const contact = [s.endereco, s.cidade, s.telefone, s.email, s.oabSociedade ? 'Sociedade de advogados — OAB ' + s.oabSociedade : ''].filter(Boolean).map(lib.esc).join(' · ');
  let raw = fs.readFileSync(src, 'utf8');
  // selos/prêmios: bloco removido por configuração (site.mostrarSelos = false) — ver Provimento 205/2021, art. 5º, § 1º
  if (s.mostrarSelos === false) raw = raw.replace(/<!--selos:start-->[\s\S]*?<!--selos:end-->/g, '');
  const fundadoraMeta = 'Fundadora · 17 anos de advocacia' + (s.fundadoraOab ? ' · OAB ' + lib.esc(s.fundadoraOab) : '');
  const html = raw
    .replaceAll('{{FUNDADORA_META}}', fundadoraMeta)
    .replaceAll('{{CONFIG_JSON}}', JSON.stringify(pub).replace(/</g, '\\u003c'))
    .replaceAll('{{SITE_NAME}}', lib.esc(s.nome)).replaceAll('{{SITE_URL}}', lib.esc(String(s.url).replace(/\/$/, '')))
    .replaceAll('{{FOOTER_CONTACT}}', contact || lib.esc(s.cidade))
    .replaceAll('{{EMAIL_PRIVACIDADE}}', lib.esc(s.emailPrivacidade || s.email || 'o canal de contato indicado neste site'))
    .replaceAll('{{YEAR}}', String(new Date().getFullYear()));
  tplCache = { key, html };
  return html;
}

// ---------- estáticos ----------
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel.includes('\0') || rel.split('/').some((p) => p.startsWith('.'))) return false;
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = '"' + st.size + '-' + Math.floor(st.mtimeMs) + '"';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, baseHeaders(req, { ETag: etag })); res.end(); return true; }
  // CSS/JS revalidam sempre (ETag → 304 barato), para que ajustes da LP apareçam na hora; imagens e fontes ficam em cache.
  const cc = ext === '.css' || ext === '.js' ? 'no-cache' : 'public, max-age=86400';
  send(req, res, 200, fs.readFileSync(file), { 'Cache-Control': cc, ETag: etag }, ext);
  return true;
}

// Aceita a origem quando bate com o Host recebido, com o X-Forwarded-Host (proxy confiável) ou com o domínio configurado em site.url.
// Isso evita derrubar leads e eventos em silêncio se o proxy da hospedagem reescrever o Host.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true; // sendBeacon/fetch same-origin sem Origin em alguns navegadores
  let host;
  try { host = new URL(o).host.toLowerCase(); } catch { return false; }
  const allowed = new Set();
  if (req.headers.host) allowed.add(String(req.headers.host).toLowerCase());
  if (lib.trustProxy() && req.headers['x-forwarded-host']) allowed.add(String(req.headers['x-forwarded-host']).split(',')[0].trim().toLowerCase());
  try { allowed.add(new URL(lib.getConfig().site.url).host.toLowerCase()); } catch { /* url ainda não configurada */ }
  return allowed.has(host);
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return sendJson(req, res, 200, { ok: true });

    // ---- API pública ----
    if (p === '/api/e' || p === '/api/lead') {
      if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false });
      if (!sameOrigin(req)) return sendJson(req, res, 403, { ok: false });
      const raw = await lib.readBody(req, p === '/api/e' ? 32 * 1024 : 16 * 1024);
      const r = p === '/api/e' ? track.ingestEvents(raw, req) : track.ingestLead(raw, req, notifyLead);
      return sendJson(req, res, r.status, r.body);
    }

    // ---- painel ----
    if (p === '/painel' || p.startsWith('/painel/')) return await panel.handle(req, res, url, { send, sendJson, baseHeaders });

    // ---- LP ----
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { ok: false });
    if (p === '/' || p === '/index.html') {
      track.recordHit(req, url);
      return send(req, res, 200, renderTemplate('index.html'), { 'Cache-Control': 'no-cache' });
    }
    if (PAGES[p]) return send(req, res, 200, renderTemplate(PAGES[p]), { 'Cache-Control': 'no-cache' });
    if (serveStatic(req, res, p)) return undefined;
    return send(req, res, 404, '<!doctype html><meta charset="utf-8"><title>Página não encontrada</title><p style="font-family:sans-serif;padding:2rem">Página não encontrada. <a href="/">Voltar ao início</a></p>', { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (e && e.status === 413) return sendJson(req, res, 413, { ok: false });
    console.error('[erro]', req.method, p, e && e.stack ? e.stack : e);
    if (!res.headersSent) sendJson(req, res, 500, { ok: false, error: 'Erro interno.' });
    return undefined;
  }
}

// Webhook opcional (CRM, Make, n8n, Zapier…). Só envia se houver URL configurada.
function notifyLead(lead) {
  const url = lib.getConfig().leads.webhookUrl;
  if (!url) return;
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evento: 'novo_lead', lead }), signal: AbortSignal.timeout(5000) })
    .catch((e) => console.error('[webhook] falhou:', e.message));
}

function start(port, host) {
  const server = http.createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return new Promise((resolve) => (host ? server.listen(port, host, () => resolve(server)) : server.listen(port, () => resolve(server))));
}

module.exports = { start, handler };

// Sobe sozinho ao ser carregado: a Hostinger carrega o arquivo de entrada por um wrapper, então
// `require.main === module` nunca é verdadeiro lá (503 "did not call listen()").
// Quem só precisa das funções (cli.js, smoke-test, demo-server) define LF_NO_AUTOSTART=1 antes do require.
if (process.env.LF_NO_AUTOSTART !== '1') {
  try { require('./auth').bootstrapFromEnv(); } catch (e) { console.error('[painel] não foi possível criar usuários iniciais:', e.message); }
  const port = Number(process.env.PORT) || lib.getConfig().servidor.porta || 3000;
  start(port).then(() => {
    console.log(`LP:      http://localhost:${port}/`);
    console.log(`Painel:  http://localhost:${port}/painel`);
  });
}
