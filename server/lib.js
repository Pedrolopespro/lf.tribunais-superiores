'use strict';
// Utilitários compartilhados: configuração, segredo, hash de IP, parsing de UA, canais.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.LF_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- configuração (recarrega sozinha quando o arquivo muda) ----------
function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? deepMerge(a[k] || {}, b[k]) : b[k];
  }
  return out;
}
let cfgCache = null;
function getConfig() {
  const file = process.env.LF_CONFIG || path.join(ROOT, 'config', 'site.config.json');
  const example = path.join(ROOT, 'config', 'site.config.example.json');
  let mt = 0;
  try { mt = fs.statSync(file).mtimeMs; } catch { /* sem config do usuário: usa o exemplo */ }
  if (cfgCache && cfgCache.mt === mt && cfgCache.file === file) return cfgCache.cfg;
  const base = JSON.parse(fs.readFileSync(example, 'utf8'));
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* ignora */ }
  const cfg = deepMerge(base, user);
  cfgCache = { mt, file, cfg };
  return cfg;
}

// ---------- segredo ----------
let secretCache = null;
function getSecret() {
  if (secretCache) return secretCache;
  if (process.env.LF_SECRET) return (secretCache = process.env.LF_SECRET);
  const f = path.join(DATA_DIR, 'secret.key');
  try { secretCache = fs.readFileSync(f, 'utf8').trim(); } catch { /* cria abaixo */ }
  if (!secretCache) {
    secretCache = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, secretCache, { mode: 0o600 });
  }
  return secretCache;
}

// ---------- tempo (Brasília é UTC-3 fixo, sem horário de verão desde 2019) ----------
const BRT_MS = 3 * 3600 * 1000;
const brtDay = (ts) => new Date(ts - BRT_MS).toISOString().slice(0, 10);
const dayStart = (day) => Date.parse(day + 'T00:00:00-03:00');
function addDays(day, n) {
  const d = new Date(Date.parse(day + 'T00:00:00Z'));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

// ---------- hashes ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
// IP nunca é gravado em claro: hash com sal diário + segredo (não reversível, não correlaciona entre dias).
const ipHash = (ip) => sha256(getSecret() + '|' + brtDay(Date.now()) + '|' + ip).slice(0, 16);

// Um único ponto de decisão: atrás do proxy da hospedagem, confiamos nos cabeçalhos X-Forwarded-*.
const trustProxy = () => !!getConfig().servidor.confiarProxy || process.env.LF_TRUST_PROXY === '1';
function clientIp(req) {
  if (trustProxy()) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}
function isHttps(req) {
  return !!req.socket.encrypted || (trustProxy() && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

// ---------- HTML ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------- User-Agent ----------
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|facebookexternalhit|embedly|python-requests|curl\/|wget|httpclient|axios|node-fetch|undici|go-http|java\/|phantom|puppeteer|playwright|selenium|mediapartners|adsbot|inspectiontool|storebot|scanner/i;
function parseUA(ua = '') {
  const u = String(ua);
  const device = /ipad|tablet|(android(?!.*mobile))/i.test(u) ? 'tablet' : /mobi|iphone|ipod|android/i.test(u) ? 'mobile' : 'desktop';
  const browser = /fban|fbav/i.test(u) ? 'Facebook (in-app)'
    : /instagram/i.test(u) ? 'Instagram (in-app)'
    : /linkedinapp/i.test(u) ? 'LinkedIn (in-app)'
    : /edg(e|a|ios)?\//i.test(u) ? 'Edge'
    : /opr\/|opera/i.test(u) ? 'Opera'
    : /samsungbrowser/i.test(u) ? 'Samsung Internet'
    : /firefox|fxios/i.test(u) ? 'Firefox'
    : /chrome|crios/i.test(u) ? 'Chrome'
    : /safari/i.test(u) ? 'Safari' : 'Outros';
  const os = /windows/i.test(u) ? 'Windows' : /android/i.test(u) ? 'Android' : /iphone|ipad|ipod/i.test(u) ? 'iOS'
    : /mac os x|macintosh/i.test(u) ? 'macOS' : /linux|cros/i.test(u) ? 'Linux/ChromeOS' : 'Outros';
  return { device, browser, os, bot: !u || BOT_RE.test(u) };
}

// ---------- canal de aquisição ----------
const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|yandex|baidu)\./i;
const SOCIAL = /(^|\.)(facebook|instagram|linkedin|t\.co|twitter|x\.com|youtube|youtu\.be|tiktok|threads|whatsapp|wa\.me|lnkd\.in|l\.instagram|lm\.facebook|l\.facebook)(\.|$)/i;
function deriveChannel({ source = '', medium = '', gclid = '', fbclid = '', ref_host = '' }) {
  const s = source.toLowerCase(), m = medium.toLowerCase();
  const paid = /^(cpc|ppc|paid|paidsocial|paid_social|display|cpm|cpv|ads?)$/.test(m);
  if (gclid || (/google/.test(s) && paid)) return 'Google Ads';
  if (fbclid && !paid && !s) return 'Meta Ads';
  if (/(facebook|instagram|meta|fb|ig)/.test(s) && (paid || fbclid)) return 'Meta Ads';
  if (/linkedin/.test(s) && paid) return 'LinkedIn Ads';
  if (paid) return 'Outros pagos';
  if (/e-?mail|newsletter/.test(m) || /e-?mail|newsletter/.test(s)) return 'E-mail';
  if (/whatsapp/.test(s)) return 'WhatsApp';
  if (s || m) return /organic|orgânico/.test(m) ? (SEARCH.test(ref_host) ? 'Busca orgânica' : 'Social orgânico') : 'Campanha (UTM)';
  if (ref_host) {
    if (SEARCH.test(ref_host)) return 'Busca orgânica';
    if (SOCIAL.test(ref_host)) return 'Social orgânico';
    return 'Referência';
  }
  return 'Direto';
}
const CHANNELS = ['Google Ads', 'Meta Ads', 'LinkedIn Ads', 'Outros pagos', 'Busca orgânica', 'Social orgânico', 'E-mail', 'WhatsApp', 'Campanha (UTM)', 'Referência', 'Direto'];

// ---------- limite de taxa em memória ----------
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.t > windowMs) b = { t: now, n: 0 };
  b.n += 1;
  buckets.set(key, b);
  if (buckets.size > 20000) for (const [k, v] of buckets) if (now - v.t > windowMs) buckets.delete(k);
  return b.n <= max;
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', (c) => {
      if (over) return; // descarta o excedente, mas deixa a resposta 413 sair antes de fechar a conexão
      size += c.length;
      if (size > limit) { over = true; chunks.length = 0; reject(Object.assign(new Error('payload'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = {
  ROOT, DATA_DIR, getConfig, getSecret, brtDay, dayStart, addDays, validDay, BRT_MS, sha256, rand, ipHash,
  clientIp, isHttps, trustProxy, esc, parseCookies, parseUA, deriveChannel, CHANNELS, rateLimit, readBody,
};
