'use strict';
// Consultas do painel. Todas as métricas partem de `visits` (1 linha por sessão) e `events` (1 linha por evento).
const lib = require('./lib');
const { all, get } = require('./db');
const { SECTIONS } = require('./track');

const ENGAGED = '(engaged_s >= 15 OR max_scroll >= 50 OR cta_clicks + wa_clicks > 0)';
const CONV = '(lead_id IS NOT NULL OR wa_clicks > 0)';

// ---------- filtros ----------
function parseFilter(q) {
  const today = lib.brtDay(Date.now());
  let p = q.get('p') || '7d';
  let from, to = today;
  if (p === 'hoje') from = today;
  else if (p === 'ontem') { from = to = lib.addDays(today, -1); }
  else if (p === '30d') from = lib.addDays(today, -29);
  else if (p === '90d') from = lib.addDays(today, -89);
  else if (p === 'custom' && lib.validDay(q.get('from')) && lib.validDay(q.get('to')) && q.get('from') <= q.get('to')) { from = q.get('from'); to = q.get('to'); }
  else { p = '7d'; from = lib.addDays(today, -6); }
  const channels = lib.CHANNELS;
  const canal = channels.includes(q.get('canal')) ? q.get('canal') : '';
  return { p, from, to, fromTs: lib.dayStart(from), toTs: lib.dayStart(lib.addDays(to, 1)), canal, bots: q.get('bots') === '1', today };
}
function vWhere(f, a = 'v') {
  const w = [`${a}.first_ts >= ?`, `${a}.first_ts < ?`];
  const p = [f.fromTs, f.toTs];
  if (!f.bots) w.push(`${a}.is_bot = 0`);
  if (f.canal) { w.push(`${a}.channel = ?`); p.push(f.canal); }
  return { sql: w.join(' AND '), p };
}
function daysOf(f) {
  const out = [];
  for (let d = f.from; d <= f.to; d = lib.addDays(d, 1)) out.push(d);
  return out;
}

// ---------- investimento ----------
function spendRows(f) {
  const rows = all('SELECT channel, campaign, SUM(amount_cents) AS c FROM spend WHERE day >= ? AND day <= ? GROUP BY channel, campaign', f.from, f.to);
  const byChannel = {}, byCampaign = {};
  let total = 0;
  for (const r of rows) {
    if (f.canal && r.channel !== f.canal) continue;
    total += r.c;
    byChannel[r.channel] = (byChannel[r.channel] || 0) + r.c;
    if (r.campaign) byCampaign[r.channel + '|' + r.campaign.toLowerCase()] = (byCampaign[r.channel + '|' + r.campaign.toLowerCase()] || 0) + r.c;
  }
  return { total, byChannel, byCampaign };
}

// ---------- visão geral ----------
function overview(f) {
  const w = vWhere(f);
  const k = get(
    `SELECT COUNT(*) AS sessions,
       COUNT(DISTINCT COALESCE(NULLIF(vid, ''), ip_hash)) AS uniques,
       COALESCE(SUM(pageviews), 0) AS pageviews,
       COALESCE(SUM(CASE WHEN ${ENGAGED} THEN 1 ELSE 0 END), 0) AS engaged,
       COALESCE(SUM(CASE WHEN ${ENGAGED} THEN engaged_s ELSE 0 END), 0) AS engaged_s,
       COALESCE(SUM(cta_clicks), 0) AS cta, COALESCE(SUM(CASE WHEN wa_clicks > 0 THEN 1 ELSE 0 END), 0) AS wa,
       COALESCE(SUM(CASE WHEN lead_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS leads,
       COALESCE(SUM(CASE WHEN ${CONV} THEN 1 ELSE 0 END), 0) AS conv,
       COALESCE(SUM(CASE WHEN wstep >= 1 THEN 1 ELSE 0 END), 0) AS w1,
       COALESCE(SUM(CASE WHEN wstep >= 2 THEN 1 ELSE 0 END), 0) AS w2,
       COALESCE(SUM(CASE WHEN wstep >= 3 THEN 1 ELSE 0 END), 0) AS w3,
       COALESCE(SUM(CASE WHEN wstep >= 4 THEN 1 ELSE 0 END), 0) AS w4
     FROM visits v WHERE ${w.sql}`, ...w.p);
  const perDay = all(
    `SELECT strftime('%Y-%m-%d', first_ts / 1000 - 10800, 'unixepoch') AS d, COUNT(*) AS sessions,
       SUM(CASE WHEN lead_id IS NOT NULL THEN 1 ELSE 0 END) AS leads, SUM(CASE WHEN wa_clicks > 0 THEN 1 ELSE 0 END) AS wa
     FROM visits v WHERE ${w.sql} GROUP BY d`, ...w.p);
  const map = Object.fromEntries(perDay.map((r) => [r.d, r]));
  const series = daysOf(f).map((d) => ({ d, sessions: (map[d] || {}).sessions || 0, leads: (map[d] || {}).leads || 0, wa: (map[d] || {}).wa || 0 }));
  const lw = ['ts >= ?', 'ts < ?'], lp = [f.fromTs, f.toTs];
  if (!f.bots) lw.push('is_bot = 0');
  if (f.canal) { lw.push('channel = ?'); lp.push(f.canal); }
  const byStatus = all(`SELECT status, COUNT(*) AS n, COALESCE(SUM(value_cents), 0) AS v FROM leads WHERE ${lw.join(' AND ')} GROUP BY status`, ...lp);
  const spend = spendRows(f);
  return { k, series, byStatus, spend, hits: hitsStats(f) };
}

function hitsStats(f) {
  const h = get('SELECT COUNT(*) AS n, COALESCE(SUM(gclid), 0) AS g, COALESCE(SUM(fbclid), 0) AS fb FROM hits WHERE ts >= ? AND ts < ? AND is_bot = 0', f.fromTs, f.toTs);
  const s = get(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN gclid != '' THEN 1 ELSE 0 END), 0) AS g, COALESCE(SUM(CASE WHEN fbclid != '' THEN 1 ELSE 0 END), 0) AS fb FROM visits WHERE first_ts >= ? AND first_ts < ? AND is_bot = 0`, f.fromTs, f.toTs);
  return { server: h, browser: s };
}

// ---------- aquisição ----------
function agg(f, cols, { where = '', limit = 40 } = {}) {
  const w = vWhere(f);
  return all(
    `SELECT ${cols.join(', ')}, COUNT(*) AS sessions, SUM(CASE WHEN ${ENGAGED} THEN 1 ELSE 0 END) AS engaged,
       SUM(CASE WHEN lead_id IS NOT NULL THEN 1 ELSE 0 END) AS leads, SUM(CASE WHEN wa_clicks > 0 THEN 1 ELSE 0 END) AS wa,
       SUM(CASE WHEN ${CONV} THEN 1 ELSE 0 END) AS conv
     FROM visits v WHERE ${w.sql} ${where} GROUP BY ${cols.join(', ')} ORDER BY sessions DESC LIMIT ${limit}`, ...w.p);
}
function acquisition(f) {
  return {
    channels: agg(f, ['channel']),
    campaigns: agg(f, ['channel', 'campaign'], { where: "AND campaign != ''" }),
    terms: agg(f, ['term', 'campaign'], { where: "AND term != ''" }),
    contents: agg(f, ['content', 'campaign'], { where: "AND content != ''" }),
    svcs: agg(f, ['svc'], { where: "AND svc != ''" }),
    refs: agg(f, ['ref_host'], { where: "AND ref_host != ''", limit: 20 }),
    spend: spendRows(f),
    hits: hitsStats(f),
  };
}

// ---------- comportamento ----------
function behavior(f) {
  const w = vWhere(f);
  const sel = SECTIONS.map(([id], i) => `COALESCE(SUM(CASE WHEN instr(sections, ',${id},') > 0 THEN 1 ELSE 0 END), 0) AS s${i}`).join(', ');
  const r = get(
    `SELECT COUNT(*) AS n, ${sel},
       COALESCE(SUM(CASE WHEN max_scroll >= 25 THEN 1 ELSE 0 END), 0) AS sc25, COALESCE(SUM(CASE WHEN max_scroll >= 50 THEN 1 ELSE 0 END), 0) AS sc50,
       COALESCE(SUM(CASE WHEN max_scroll >= 75 THEN 1 ELSE 0 END), 0) AS sc75, COALESCE(SUM(CASE WHEN max_scroll >= 90 THEN 1 ELSE 0 END), 0) AS sc90,
       COALESCE(SUM(CASE WHEN engaged_s < 5 THEN 1 ELSE 0 END), 0) AS t0, COALESCE(SUM(CASE WHEN engaged_s >= 5 AND engaged_s < 15 THEN 1 ELSE 0 END), 0) AS t1,
       COALESCE(SUM(CASE WHEN engaged_s >= 15 AND engaged_s < 60 THEN 1 ELSE 0 END), 0) AS t2, COALESCE(SUM(CASE WHEN engaged_s >= 60 THEN 1 ELSE 0 END), 0) AS t3
     FROM visits v WHERE ${w.sql}`, ...w.p);
  const names = ['cta_click', 'whatsapp_click', 'carousel_ctl', 'wizard_back', 'outbound_click', 'nav_click'];
  const events = all(
    `SELECT e.name, e.label, COUNT(*) AS n, COUNT(DISTINCT e.sid) AS sessions FROM events e JOIN visits v ON v.sid = e.sid
     WHERE ${w.sql} AND e.name IN (${names.map(() => '?').join(',')}) GROUP BY e.name, e.label ORDER BY n DESC`, ...w.p, ...names);
  const hours = all(`SELECT CAST(strftime('%H', first_ts / 1000 - 10800, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS sessions, SUM(CASE WHEN ${CONV} THEN 1 ELSE 0 END) AS conv FROM visits v WHERE ${w.sql} GROUP BY h`, ...w.p);
  const wdays = all(`SELECT CAST(strftime('%w', first_ts / 1000 - 10800, 'unixepoch') AS INTEGER) AS d, COUNT(*) AS sessions, SUM(CASE WHEN ${CONV} THEN 1 ELSE 0 END) AS conv FROM visits v WHERE ${w.sql} GROUP BY d`, ...w.p);
  const lw = ['ts >= ?', 'ts < ?'], lp = [f.fromTs, f.toTs];
  if (!f.bots) lw.push('is_bot = 0');
  if (f.canal) { lw.push('channel = ?'); lp.push(f.canal); }
  return {
    r, events, hours, wdays,
    devices: agg(f, ['device'], { limit: 10 }), browsers: agg(f, ['browser'], { limit: 10 }), oses: agg(f, ['os'], { limit: 10 }),
    pickCourt: all(`SELECT court AS k, COUNT(*) AS n FROM visits v WHERE ${w.sql} AND court != '' GROUP BY court ORDER BY n DESC`, ...w.p),
    pickServico: all(`SELECT servico AS k, COUNT(*) AS n FROM visits v WHERE ${w.sql} AND servico != '' GROUP BY servico ORDER BY n DESC`, ...w.p),
    pickPrazo: all(`SELECT prazo AS k, COUNT(*) AS n FROM visits v WHERE ${w.sql} AND prazo != '' GROUP BY prazo ORDER BY n DESC`, ...w.p),
    leadTribunal: all(`SELECT tribunal AS k, COUNT(*) AS n FROM leads WHERE ${lw.join(' AND ')} GROUP BY tribunal ORDER BY n DESC`, ...lp),
    leadServico: all(`SELECT servico AS k, COUNT(*) AS n FROM leads WHERE ${lw.join(' AND ')} GROUP BY servico ORDER BY n DESC`, ...lp),
    leadPrazo: all(`SELECT prazo AS k, COUNT(*) AS n FROM leads WHERE ${lw.join(' AND ')} GROUP BY prazo ORDER BY n DESC`, ...lp),
  };
}

// ---------- leads ----------
const PAGE = 50;
function leadsPage(f, q) {
  const w = ['ts >= ?', 'ts < ?'], p = [f.fromTs, f.toTs];
  if (!f.bots) w.push('is_bot = 0');
  if (f.canal) { w.push('channel = ?'); p.push(f.canal); }
  const status = q.get('status') || '';
  if (status) { w.push('status = ?'); p.push(status); }
  const term = (q.get('q') || '').trim().slice(0, 60);
  if (term) { w.push('(tribunal LIKE ? OR servico LIKE ? OR campaign LIKE ? OR term LIKE ? OR notes LIKE ?)'); const like = '%' + term.replace(/[%_]/g, '') + '%'; p.push(like, like, like, like, like); }
  const page = Math.max(1, parseInt(q.get('page'), 10) || 1);
  const total = get(`SELECT COUNT(*) AS n FROM leads WHERE ${w.join(' AND ')}`, ...p).n;
  const rows = all(`SELECT * FROM leads WHERE ${w.join(' AND ')} ORDER BY ts DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, ...p);
  const counts = all(`SELECT status, COUNT(*) AS n FROM leads WHERE ts >= ? AND ts < ? ${f.bots ? '' : 'AND is_bot = 0'} GROUP BY status`, f.fromTs, f.toTs);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)), status, term, counts };
}
function leadDetail(id) {
  const lead = get('SELECT * FROM leads WHERE id = ?', id);
  if (!lead) return null;
  const visit = lead.sid ? get('SELECT * FROM visits WHERE sid = ?', lead.sid) : null;
  const events = lead.sid ? all('SELECT ts, name, label, value FROM events WHERE sid = ? ORDER BY ts, id LIMIT 300', lead.sid) : [];
  const log = all('SELECT ts, user_email, action, detail FROM lead_log WHERE lead_id = ? ORDER BY ts DESC, id DESC', id);
  return { lead, visit, events, log };
}

// ---------- tempo real ----------
function realtime() {
  const now = Date.now();
  const online = get('SELECT COUNT(*) AS n FROM visits WHERE last_ts >= ? AND is_bot = 0', now - 5 * 60 * 1000).n;
  const last30 = get('SELECT COUNT(*) AS n FROM visits WHERE first_ts >= ? AND is_bot = 0', now - 30 * 60 * 1000).n;
  const leads24 = get('SELECT COUNT(*) AS n FROM leads WHERE ts >= ? AND is_bot = 0', now - 24 * 3600 * 1000).n;
  const visits = all(
    `SELECT v.sid, v.first_ts, v.last_ts, v.channel, v.campaign, v.term, v.device, v.browser, v.pageviews, v.max_scroll, v.engaged_s, v.lead_id, v.wa_clicks, v.cta_clicks,
       (SELECT name || CASE WHEN label != '' THEN ' · ' || label ELSE '' END FROM events WHERE sid = v.sid AND name NOT IN ('lcp', 'cls', 'engaged') ORDER BY ts DESC, id DESC LIMIT 1) AS last_ev
     FROM visits v WHERE v.last_ts >= ? AND v.is_bot = 0 ORDER BY v.last_ts DESC LIMIT 40`, now - 60 * 60 * 1000);
  const events = all(
    `SELECT e.ts, e.name, e.label, e.value, v.channel, v.device FROM events e JOIN visits v ON v.sid = e.sid
     WHERE e.ts >= ? AND v.is_bot = 0 AND e.name NOT IN ('engaged','lcp','cls') ORDER BY e.ts DESC, e.id DESC LIMIT 40`, now - 60 * 60 * 1000);
  return { online, last30, leads24, visits, events };
}

// ---------- qualidade técnica ----------
const pctile = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
function quality(f) {
  const w = vWhere(f);
  const vit = all(`SELECT device, lcp_ms, cls FROM visits v WHERE ${w.sql} AND (lcp_ms IS NOT NULL OR cls IS NOT NULL)`, ...w.p);
  const by = (dev) => {
    const rows = vit.filter((r) => !dev || r.device === dev);
    const l = rows.map((r) => r.lcp_ms).filter((x) => x != null), c = rows.map((r) => r.cls).filter((x) => x != null);
    return { n: rows.length, lcp50: pctile(l, 50), lcp75: pctile(l, 75), cls50: pctile(c, 50), cls75: pctile(c, 75) };
  };
  const errs = all(`SELECT e.label, COUNT(*) AS n, COUNT(DISTINCT e.sid) AS sessions FROM events e JOIN visits v ON v.sid = e.sid WHERE ${w.sql} AND e.name = 'js_error' GROUP BY e.label ORDER BY n DESC LIMIT 15`, ...w.p);
  const base = get(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN js_errors > 0 THEN 1 ELSE 0 END), 0) AS err_sessions, COALESCE(SUM(CASE WHEN consent = 1 THEN 1 ELSE 0 END), 0) AS accepted,
      COALESCE(SUM(CASE WHEN consent = -1 THEN 1 ELSE 0 END), 0) AS declined, COALESCE(SUM(CASE WHEN consent = 0 THEN 1 ELSE 0 END), 0) AS undecided FROM visits v WHERE ${w.sql}`, ...w.p);
  const bots = get('SELECT COUNT(*) AS n, COALESCE(SUM(is_bot), 0) AS bots FROM visits WHERE first_ts >= ? AND first_ts < ?', f.fromTs, f.toTs);
  return { all: by(''), mobile: by('mobile'), desktop: by('desktop'), errs, base, bots, hits: hitsStats(f) };
}

// ---------- investimento ----------
const spendList = (limit = 120) => all('SELECT * FROM spend ORDER BY day DESC, id DESC LIMIT ?', limit);

module.exports = { parseFilter, vWhere, overview, acquisition, behavior, leadsPage, leadDetail, realtime, quality, spendList, spendRows, hitsStats, PAGE };
