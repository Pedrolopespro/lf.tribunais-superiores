'use strict';
// Avaliações do Google (Places API "New") para o carrossel da LP.
//
// Regras do Google (Places API, políticas): não guardar o conteúdo das avaliações (só o place_id pode ser guardado) e mostrar
// o autor com link. Por isso NÃO existe cache aqui: cada visita que chega ao carrossel consulta o Google ao vivo.
// Consultas simultâneas dividem a mesma chamada (dura só o tempo da requisição) e há um teto diário de consultas.
//
// Regras da OAB (Provimento 205/2021 e guia da OAB-SP): o escritório não edita nem escolhe o texto. Vão as avaliações que o
// Google devolver (no máximo 5), como o cliente escreveu (texto original, quando existe).
//
// Segredo: a chave fica só na variável de ambiente LF_GOOGLE_PLACES_KEY. Nunca vai ao navegador, ao log ou ao repositório.
const lib = require('./lib');

const BASE = (process.env.LF_PLACES_BASE || 'https://places.googleapis.com').replace(/\/$/, ''); // LF_PLACES_BASE: só para testes locais
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const used = { day: '', n: 0 };
let inflight = null;

function settings() {
  const cfg = lib.getConfig().avaliacoes || {};
  const placeId = String(process.env.LF_GOOGLE_PLACE_ID || cfg.placeId || '').trim();
  const key = String(process.env.LF_GOOGLE_PLACES_KEY || '').trim();
  return {
    on: cfg.ativar !== false && PLACE_ID_RE.test(placeId) && key.length > 0,
    placeId, key,
    link: safeUrl(cfg.linkPerfil),
    mostrarNota: cfg.mostrarNota === true,
    maxDia: Number.isFinite(Number(cfg.maxPorDia)) && Number(cfg.maxPorDia) > 0 ? Number(cfg.maxPorDia) : 400,
  };
}

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
function safeUrl(u) {
  try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
}

// O que a LP precisa saber sem fazer chamada nenhuma: se a seção existe e para onde o link leva.
function publicInfo() {
  const s = settings();
  return s.on ? { on: 1, link: s.link } : 0;
}

async function call(s) {
  const fields = ['reviews', 'googleMapsUri'].concat(s.mostrarNota ? ['rating', 'userRatingCount'] : []);
  const url = `${BASE}/v1/places/${encodeURIComponent(s.placeId)}?languageCode=pt-BR&regionCode=BR`;
  let r;
  try {
    r = await fetch(url, { headers: { 'X-Goog-Api-Key': s.key, 'X-Goog-FieldMask': fields.join(',') }, signal: AbortSignal.timeout(4000) });
  } catch (e) {
    console.error('[avaliacoes] falha ao consultar o Google:', e && e.name ? e.name : 'erro'); // nunca imprime a URL nem a chave
    return { ok: false, reviews: [] };
  }
  if (!r.ok) { console.error('[avaliacoes] o Google respondeu', r.status); return { ok: false, reviews: [] }; }
  let d;
  try { d = await r.json(); } catch { return { ok: false, reviews: [] }; }

  const reviews = (Array.isArray(d.reviews) ? d.reviews : []).map((rv) => {
    const a = rv.authorAttribution || {};
    const original = rv.originalText && rv.originalText.text; // texto como o autor escreveu (sem tradução)
    return {
      autor: clip(a.displayName, 80),
      autorUrl: safeUrl(a.uri),
      nota: Math.round(Number(rv.rating)) || 0,
      quando: clip(rv.relativePublishTimeDescription, 40),
      texto: clip(original || (rv.text && rv.text.text), 2000),
      url: safeUrl(rv.googleMapsUri),
    };
  }).filter((x) => x.texto && x.autor && x.nota >= 1 && x.nota <= 5).slice(0, 5);

  const out = { ok: true, reviews, perfil: s.link || safeUrl(d.googleMapsUri) };
  if (s.mostrarNota && Number(d.rating) > 0 && Number(d.userRatingCount) > 0) out.nota = { media: Math.round(Number(d.rating) * 10) / 10, total: Math.round(Number(d.userRatingCount)) };
  return out;
}

async function getReviews() {
  const s = settings();
  if (!s.on) return { ok: true, reviews: [] };
  if (inflight) return inflight; // divide a chamada em andamento; nada é guardado depois que ela termina
  const day = lib.brtDay(Date.now());
  if (used.day !== day) { used.day = day; used.n = 0; }
  if (used.n >= s.maxDia) return { ok: false, reviews: [], limite: true }; // teto diário: a LP esconde o carrossel
  used.n += 1;
  inflight = call(s).finally(() => { inflight = null; });
  return inflight;
}

module.exports = { getReviews, publicInfo, _used: used };
