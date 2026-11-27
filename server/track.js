'use strict';
// Ingestão de eventos de navegação, conversões (cliques para o WhatsApp) e acessos vistos pelo servidor.
const lib = require('./lib');
const { run, get, tx } = require('./db');

const EVENT_NAMES = new Set([
  'page_view', 'scroll', 'section_view', 'engaged', 'cta_click', 'whatsapp_click', 'nav_click', 'outbound_click',
  'carousel_ctl', 'wizard_court', 'wizard_service', 'wizard_deadline', 'wizard_summary', 'wizard_back', 'wizard_copy',
  'consent_accept', 'consent_decline', 'lcp', 'cls', 'js_error',
]);

// Espelho do que existe em public/assets/site.js — manter os códigos iguais.
const TRIBUNAIS = {
  stf: 'Supremo Tribunal Federal', stj: 'Superior Tribunal de Justiça', tst: 'Tribunal Superior do Trabalho',
  tse: 'Tribunal Superior Eleitoral', stm: 'Superior Tribunal Militar',
};
const COMMON = { despacho: 'Despacho e memoriais', sustentacao: 'Sustentação oral', acompanhamento: 'Acompanhamento processual', outra: 'Outra demanda' };
const SERVICOS_POR_TRIBUNAL = {
  stf: { re: 'Recurso extraordinário', ...COMMON },
  stj: { resp: 'Recurso especial', ...COMMON, hde: 'Homologação de decisão estrangeira' },
  tst: { rr: 'Recurso de revista', ...COMMON },
  tse: { eleitoral: 'Apresentar demanda eleitoral' },
  stm: { militar: 'Apresentar demanda militar' },
};
const SERVICOS = Object.assign({}, ...Object.values(SERVICOS_POR_TRIBUNAL));
const PRAZOS = { andamento: 'Prazo em andamento', julgamento: 'Julgamento marcado', 'sem-data': 'Sem data próxima', explicar: 'Prefere explicar à equipe' };
const VIAS = { whatsapp: 'WhatsApp', copia: 'Resumo copiado' };
// ?svc= dos grupos de anúncios
const SVC_LABELS = {
  resp: 'Recurso especial (STJ)', re: 'Recurso extraordinário (STF)', rr: 'Recurso de revista (TST)', hde: 'Homologação de decisão estrangeira (STJ)',
  despacho: 'Despacho e memoriais', sustentacao: 'Sustentação oral', acompanhamento: 'Acompanhamento processual',
};
const STATUSES = { novo: 'Novo', contatado: 'Contato feito', qualificado: 'Qualificado', proposta: 'Proposta enviada', fechado: 'Fechado', perdido: 'Perdido', spam: 'Spam / inválido' };
// Seções da LP, na ordem da página (os ids precisam bater com o HTML)
const SECTIONS = [
  ['topo', 'Primeira tela e escolha do tribunal'], ['reconhecimentos', 'Reconhecimentos'], ['como-funciona', 'Como funciona'],
  ['escritorio', 'O escritório'], ['fechamento', 'Encerramento'],
];

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const lower = (v, n = 80) => clean(v, n).toLowerCase();
const SID_RE = /^[a-f0-9]{16,32}$/;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function pathOf(p) { return clean(String(p || '/').split('?')[0].split('#')[0], 120) || '/'; }
const json = (status, obj) => ({ status, body: obj });

// ---------- eventos ----------
function ingestEvents(raw, req) {
  let b;
  try { b = JSON.parse(raw); } catch { return json(400, { ok: false }); }
  if (!b || typeof b !== 'object' || !SID_RE.test(String(b.sid || ''))) return json(400, { ok: false });
  const ip = lib.clientIp(req);
  if (!lib.rateLimit('ev:' + ip, 300, 60000)) return json(429, { ok: false });

  const sid = b.sid;
  const ctx = b.ctx && typeof b.ctx === 'object' ? b.ctx : {};
  const ua = lib.parseUA(req.headers['user-agent']);
  const now = Date.now();
  const vid = SID_RE.test(String(b.vid || '')) ? b.vid : '';
  const evs = Array.isArray(b.ev) ? b.ev.slice(0, 40) : [];

  tx(() => {
    let v = get('SELECT sid, vid, is_bot, consent FROM visits WHERE sid = ?', sid);
    if (!v) {
      const u = ctx.u && typeof ctx.u === 'object' ? ctx.u : {};
      const own = String(req.headers.host || '').split(':')[0].replace(/^www\./, '').toLowerCase();
      let refHost = hostOf(ctx.r);
      if (refHost === own) refHost = '';
      const a = {
        source: lower(u.utm_source), medium: lower(u.utm_medium), campaign: lower(u.utm_campaign),
        content: lower(u.utm_content), term: lower(u.utm_term), gclid: clean(u.gclid, 120), fbclid: clean(u.fbclid, 120),
        svc: Object.keys(SVC_LABELS).includes(lower(u.svc, 20)) ? lower(u.svc, 20) : '',
      };
      const channel = lib.deriveChannel({ ...a, ref_host: refHost });
      const bot = ua.bot || ctx.wd === 1 || ctx.wd === true ? 1 : 0;
      run(
        `INSERT INTO visits (sid, vid, first_ts, last_ts, landing, ref_url, ref_host, source, medium, campaign, content, term, gclid, fbclid, svc,
           channel, device, browser, os, lang, screen_w, screen_h, consent, is_bot, ip_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sid, vid, now, now, pathOf(ctx.l), clean(ctx.r, 300), refHost, a.source, a.medium, a.campaign, a.content, a.term, a.gclid, a.fbclid, a.svc,
        channel, ua.device, ua.browser, ua.os, clean(ctx.lg, 12), Math.min(Number(ctx.sw) || 0, 20000), Math.min(Number(ctx.sh) || 0, 20000),
        ctx.c === 1 ? 1 : ctx.c === -1 ? -1 : 0, bot, lib.ipHash(ip),
      );
      v = { sid, vid, is_bot: bot, consent: 0 };
    } else if (vid && !v.vid) {
      run('UPDATE visits SET vid = ? WHERE sid = ?', vid, sid);
    }
    if ((ctx.wd === 1 || ctx.wd === true) && !v.is_bot) run('UPDATE visits SET is_bot = 1 WHERE sid = ?', sid);

    const page = pathOf(ctx.l);
    for (const e of evs) {
      if (!e || !EVENT_NAMES.has(e.n)) continue;
      const age = Math.min(Math.max(Number(e.a) || 0, 0), 600000);
      const ts = now - age;
      const label = clean(e.l, 80);
      const value = Number.isFinite(Number(e.v)) && e.v !== null && e.v !== '' ? Number(e.v) : null;
      let extra = '';
      if (e.x && typeof e.x === 'object') { try { extra = JSON.stringify(e.x).slice(0, 400); } catch { /* ignora */ } }
      run('INSERT INTO events (ts, sid, name, label, value, path, extra) VALUES (?,?,?,?,?,?,?)', ts, sid, e.n, label, value, page, extra);
      run('UPDATE visits SET events = events + 1, last_ts = MAX(last_ts, ?) WHERE sid = ?', ts, sid);
      switch (e.n) {
        case 'page_view': run('UPDATE visits SET pageviews = pageviews + 1 WHERE sid = ?', sid); break;
        case 'scroll': if (value !== null) run('UPDATE visits SET max_scroll = MAX(max_scroll, ?) WHERE sid = ?', Math.min(Math.round(value), 100), sid); break;
        case 'section_view': if (label) run("UPDATE visits SET sections = sections || ? || ',' WHERE sid = ? AND instr(sections, ?) = 0", label, sid, ',' + label + ','); break;
        case 'engaged': if (value !== null) run('UPDATE visits SET engaged_s = MAX(engaged_s, ?) WHERE sid = ?', Math.min(Math.round(value), 7200), sid); break;
        case 'cta_click': run('UPDATE visits SET cta_clicks = cta_clicks + 1 WHERE sid = ?', sid); break;
        case 'whatsapp_click': run('UPDATE visits SET wa_clicks = wa_clicks + 1 WHERE sid = ?', sid); break;
        case 'wizard_court':
          if (TRIBUNAIS[label]) run("UPDATE visits SET court = ?, servico = '', prazo = '', wstep = MAX(wstep, 1) WHERE sid = ?", label, sid);
          break;
        case 'wizard_service': {
          const [c, sv] = label.split(':');
          if (SERVICOS[sv]) run("UPDATE visits SET court = CASE WHEN ? != '' THEN ? ELSE court END, servico = ?, wstep = MAX(wstep, 2) WHERE sid = ?", TRIBUNAIS[c] ? c : '', c, sv, sid);
          break;
        }
        case 'wizard_deadline': if (PRAZOS[label]) run('UPDATE visits SET prazo = ?, wstep = MAX(wstep, 3) WHERE sid = ?', label, sid); break;
        case 'wizard_summary': run('UPDATE visits SET wstep = MAX(wstep, 4) WHERE sid = ?', sid); break;
        case 'lcp': if (value !== null) run('UPDATE visits SET lcp_ms = ? WHERE sid = ?', Math.round(value), sid); break;
        case 'cls': if (value !== null) run('UPDATE visits SET cls = ? WHERE sid = ?', Math.round(value * 1000) / 1000, sid); break;
        case 'js_error': run('UPDATE visits SET js_errors = js_errors + 1 WHERE sid = ?', sid); break;
        case 'consent_accept': run('UPDATE visits SET consent = 1 WHERE sid = ?', sid); break;
        case 'consent_decline': run('UPDATE visits SET consent = -1, vid = \'\' WHERE sid = ?', sid); break;
        default: break;
      }
    }
  });
  return json(200, { ok: true });
}

// ---------- conversão: clique para o WhatsApp (cartão do tribunal ou botão "Falar com nossa equipe") ----------
// Não há dados pessoais: guardamos o tribunal (se o clique foi num cartão) e a atribuição da sessão. A conversa continua no WhatsApp.
// Apoio e prazo ficaram opcionais (vinham do antigo assistente de 3 etapas; anúncios com ?svc= ainda preenchem o apoio).
function ingestLead(raw, req, onCreated) {
  let b;
  try { b = JSON.parse(raw); } catch { return json(400, { ok: false }); }
  if (!b || typeof b !== 'object') return json(400, { ok: false });

  const ip = lib.clientIp(req);
  if (!lib.rateLimit('lead:' + ip, 12, 3600 * 1000)) return json(429, { ok: false });

  const tribunal = clean(b.tribunal, 8), servico = clean(b.servico, 20), prazo = clean(b.prazo, 20), via = clean(b.via, 12);
  if ((tribunal && !TRIBUNAIS[tribunal]) || (servico && !(tribunal && SERVICOS_POR_TRIBUNAL[tribunal][servico])) || (prazo && !PRAZOS[prazo]) || !VIAS[via]) return json(422, { ok: false });

  const sid = SID_RE.test(String(b.sid || '')) ? b.sid : '';
  const vid = SID_RE.test(String(b.vid || '')) ? b.vid : '';
  const visit = sid ? get('SELECT * FROM visits WHERE sid = ?', sid) : null;
  // Sem sessão conhecida = provável robô batendo direto na API: grava, mas marcado como robô (fica fora das métricas).
  const attr = visit
    ? { channel: visit.channel, source: visit.source, medium: visit.medium, campaign: visit.campaign, content: visit.content, term: visit.term, gclid: visit.gclid, fbclid: visit.fbclid, svc: visit.svc, landing: visit.landing, ref_host: visit.ref_host, is_bot: visit.is_bot }
    : { channel: 'Direto', source: '', medium: '', campaign: '', content: '', term: '', gclid: '', fbclid: '', svc: '', landing: '', ref_host: '', is_bot: 1 };

  let firstTouch = '';
  if (b.ft && typeof b.ft === 'object') {
    const ft = {};
    for (const k of [...UTM_KEYS, 'gclid', 'fbclid', 'landing', 'ref', 'ts']) if (b.ft[k] !== undefined) ft[k] = clean(b.ft[k], 120);
    firstTouch = JSON.stringify(ft).slice(0, 600);
  }

  const now = Date.now();
  const dup = sid ? get('SELECT id FROM leads WHERE sid = ? AND tribunal = ? AND servico = ? AND prazo = ? AND via = ? AND ts > ?', sid, tribunal, servico, prazo, via, now - 10 * 60 * 1000) : null;
  if (dup) return json(200, { ok: true, id: dup.id, duplicate: true });

  const id = tx(() => {
    const r = run(
      `INSERT INTO leads (ts, updated_ts, tribunal, servico, prazo, via, sid, vid, channel, source, medium, campaign, content, term, gclid, fbclid, svc,
         landing, ref_host, first_touch, is_bot, ip_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      now, now, tribunal, servico, prazo, via, sid, vid, attr.channel, attr.source, attr.medium, attr.campaign, attr.content, attr.term, attr.gclid, attr.fbclid,
      attr.svc, attr.landing, attr.ref_host, firstTouch, attr.is_bot, lib.ipHash(ip),
    );
    if (sid && visit) {
      run(`UPDATE visits SET lead_id = ?, last_ts = MAX(last_ts, ?), events = events + 1,
             court = CASE WHEN ? != '' THEN ? ELSE court END, servico = CASE WHEN ? != '' THEN ? ELSE servico END, prazo = CASE WHEN ? != '' THEN ? ELSE prazo END,
             wstep = MAX(wstep, 4) WHERE sid = ?`, r.id, now, tribunal, tribunal, servico, servico, prazo, prazo, sid);
      run('INSERT INTO events (ts, sid, name, label, value, path, extra) VALUES (?,?,?,?,?,?,?)', now, sid, 'lead', (tribunal || 'geral') + (servico ? ':' + servico : ''), null, attr.landing, '');
    }
    run('INSERT INTO lead_log (lead_id, ts, user_email, action, detail) VALUES (?,?,?,?,?)', r.id, now, '', 'criado',
      'Clique para o ' + VIAS[via] + (tribunal ? ' no cartão do ' + tribunal.toUpperCase() : ' em botão geral (sem tribunal escolhido)'));
    return r.id;
  });

  if (onCreated) onCreated({ id, ts: now, tribunal, tribunal_nome: TRIBUNAIS[tribunal], servico, apoio: SERVICOS[servico], prazo, prazo_nome: PRAZOS[prazo], via, ...attr });
  return json(200, { ok: true, id });
}

// ---------- acesso visto pelo servidor ----------
function recordHit(req, url) {
  try {
    const ua = lib.parseUA(req.headers['user-agent']);
    const q = url.searchParams;
    run('INSERT INTO hits (ts, source, medium, campaign, gclid, fbclid, is_bot) VALUES (?,?,?,?,?,?,?)',
      Date.now(), lower(q.get('utm_source')), lower(q.get('utm_medium')), lower(q.get('utm_campaign')), q.get('gclid') ? 1 : 0, q.get('fbclid') ? 1 : 0, ua.bot ? 1 : 0);
  } catch { /* nunca derruba a página por causa de métrica */ }
}

module.exports = {
  ingestEvents, ingestLead, recordHit, EVENT_NAMES, STATUSES, SECTIONS, TRIBUNAIS, SERVICOS, SERVICOS_POR_TRIBUNAL, PRAZOS, VIAS, SVC_LABELS,
};
