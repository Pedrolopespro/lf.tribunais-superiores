'use strict';
// Dados 100% FICTÍCIOS, só para ver o painel preenchido. Nunca rode em banco de produção.
const lib = require('./lib');
const { run, tx } = require('./db');
const { SECTIONS, SERVICOS_POR_TRIBUNAL, PRAZOS } = require('./track');

let seed = 20261121;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const wpick = (pairs) => { let r = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');

const CHANNELS = [['Google Ads', 55], ['Direto', 14], ['Busca orgânica', 11], ['Meta Ads', 9], ['LinkedIn Ads', 5], ['Referência', 6]];
const CAMPAIGNS = {
  'Google Ads': [['correspondente-brasilia', 'correspondente em brasília stj', ''], ['resp-stj', 'protocolar recurso especial brasília', 'resp'], ['sustentacao-oral', 'sustentação oral stj advogado', 'sustentacao'], ['hde-stj', 'homologação de sentença estrangeira advogado', 'hde'], ['rr-tst', 'advogado recurso de revista tst', 'rr']],
  'Meta Ads': [['conteudo-tribunais-superiores', '', '']],
  'LinkedIn Ads': [['conteudo-linkedin', '', '']],
};
const COURTS = [['stf', 34], ['stj', 36], ['tst', 18], ['tse', 5], ['stm', 7]];
const PRAZO_W = [['andamento', 34], ['julgamento', 14], ['sem-data', 32], ['explicar', 20]];
const STATUS_W = [['novo', 25], ['contatado', 25], ['qualificado', 20], ['proposta', 12], ['fechado', 8], ['perdido', 8], ['spam', 2]];
const EV = 'INSERT INTO events (ts, sid, name, label, value, path, extra) VALUES (?,?,?,?,?,?,?)';

function run_() {
  const now = Date.now();
  const today = lib.brtDay(now);
  let leadN = 0;
  tx(() => {
    for (let d = 29; d >= 0; d--) {
      const day = lib.addDays(today, -d);
      const base = lib.dayStart(day);
      const weekday = new Date(base).getUTCDay();
      const n = Math.round((weekday === 0 || weekday === 6 ? 14 : 34) * (0.8 + rnd() * 0.5) * (1 + (29 - d) / 120));
      for (let i = 0; i < n; i++) {
        const hour = Math.min(23, Math.max(0, Math.round(11 + (rnd() + rnd() + rnd() - 1.5) * 8)));
        const ts = base + hour * 3600e3 + Math.floor(rnd() * 3600e3);
        if (ts > now) continue;
        const sid = hex(24);
        const channel = wpick(CHANNELS);
        const camp = CAMPAIGNS[channel] ? pick(CAMPAIGNS[channel]) : ['', '', ''];
        const paid = !!CAMPAIGNS[channel];
        const mobile = rnd() < 0.68;
        const bot = rnd() < 0.03 ? 1 : 0;
        const engaged = rnd() < (channel === 'Google Ads' ? 0.62 : 0.45);
        const reached = engaged ? 1 + Math.floor(rnd() * (SECTIONS.length - 1)) : 0;
        const maxScroll = Math.min(100, Math.round(((reached + 1) / SECTIONS.length) * 100 * (0.8 + rnd() * 0.3)));
        const engS = engaged ? 15 + Math.floor(rnd() * 140) : Math.floor(rnd() * 12);
        // assistente
        let wstep = 0, court = '', servico = '', prazo = '', lead = false, via = '';
        if (rnd() < (engaged ? 0.42 : 0.05)) {
          wstep = 1; court = wpick(COURTS);
          const preset = camp[2];
          servico = pick(Object.keys(SERVICOS_POR_TRIBUNAL[court]));
          if (preset && SERVICOS_POR_TRIBUNAL[court][preset]) servico = preset;
          if (rnd() < 0.85) { wstep = 2; if (rnd() < 0.8) { wstep = 3; prazo = wpick(PRAZO_W); if (rnd() < 0.85) { wstep = 4; lead = rnd() < 0.34; via = rnd() < 0.75 ? 'whatsapp' : 'copia'; } } }
          if (wstep < 2) servico = '';
          if (wstep < 3) prazo = '';
        }
        const waDirect = !lead && engaged && rnd() < 0.05;
        const waClicks = (lead && via === 'whatsapp' ? 1 : 0) + (waDirect ? 1 : 0);
        const cta = engaged && rnd() < 0.2;
        const consent = rnd() < 0.62 ? 1 : rnd() < 0.5 ? -1 : 0;
        const sections = ',' + SECTIONS.slice(0, reached + 1).map((s) => s[0]).join(',') + ',';
        run(
          `INSERT INTO visits (sid, vid, first_ts, last_ts, landing, ref_url, ref_host, source, medium, campaign, content, term, gclid, fbclid, svc, channel, device, browser, os,
             lang, screen_w, screen_h, consent, is_bot, ip_hash, pageviews, max_scroll, engaged_s, cta_clicks, wa_clicks, court, servico, prazo, wstep, lcp_ms, cls, js_errors, events, sections)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          sid, consent === 1 ? hex(24) : '', ts, ts + engS * 1000, '/', channel === 'Referência' ? 'https://exemplo.com.br/' : '', channel === 'Referência' ? 'exemplo.com.br' : channel === 'Busca orgânica' ? 'google.com' : '',
          channel === 'Google Ads' ? 'google' : channel === 'Meta Ads' ? 'facebook' : channel === 'LinkedIn Ads' ? 'linkedin' : '',
          paid ? (channel === 'Google Ads' ? 'cpc' : 'paid_social') : '', camp[0], paid ? 'anuncio-' + (1 + Math.floor(rnd() * 3)) : '', camp[1],
          channel === 'Google Ads' ? 'Cj0K' + hex(20) : '', channel === 'Meta Ads' ? 'IwAR' + hex(16) : '', camp[2],
          channel, mobile ? 'mobile' : 'desktop', mobile ? pick(['Chrome', 'Safari', 'Instagram (in-app)']) : pick(['Chrome', 'Edge', 'Firefox']), mobile ? pick(['Android', 'iOS']) : pick(['Windows', 'macOS']),
          'pt-BR', mobile ? 390 : 1440, mobile ? 844 : 900, consent, bot, hex(16), 1, maxScroll, engS, cta ? 1 : 0, waClicks,
          court, servico, prazo, wstep, Math.round(1200 + rnd() * 2800 + (mobile ? 700 : 0)), Math.round(rnd() * 120) / 1000, rnd() < 0.02 ? 1 : 0, 6 + reached * 2 + wstep * 2, sections,
        );
        run(EV, ts, sid, 'page_view', '', null, '/', '');
        for (let s = 1; s <= reached; s++) run(EV, ts + s * 4000, sid, 'section_view', SECTIONS[s][0], null, '/', '');
        if (rnd() < 0.12) run(EV, ts + 3000, sid, 'carousel_ctl', pick(['next', 'prev', 'pause']), null, '/', '');
        if (cta) run(EV, ts + 20000, sid, 'cta_click', pick(['header_cta', 'float_wa', 'close_select']), null, '/', '');
        if (wstep >= 1) run(EV, ts + 24000, sid, 'wizard_court', court, null, '/', '');
        if (wstep >= 2) run(EV, ts + 30000, sid, 'wizard_service', court + ':' + servico, null, '/', '');
        if (wstep >= 3) run(EV, ts + 36000, sid, 'wizard_deadline', prazo, null, '/', '');
        if (wstep >= 4) run(EV, ts + 41000, sid, 'wizard_summary', court + ':' + servico + ':' + prazo, null, '/', '');
        if (rnd() < 0.1 && wstep >= 2) run(EV, ts + 33000, sid, 'wizard_back', String(wstep), null, '/', '');
        if (waDirect) run(EV, ts + 45000, sid, 'whatsapp_click', pick(['header_cta', 'float_wa']), null, '/', '');
        if (lead && via === 'whatsapp') run(EV, ts + 50000, sid, 'whatsapp_click', 'wizard_final', null, '/', '');
        run('INSERT INTO hits (ts, source, medium, campaign, gclid, fbclid, is_bot) VALUES (?,?,?,?,?,?,?)', ts - 800, channel === 'Google Ads' ? 'google' : '', paid ? 'cpc' : '', camp[0], channel === 'Google Ads' ? 1 : 0, channel === 'Meta Ads' ? 1 : 0, bot);
        if (rnd() < 0.07) run('INSERT INTO hits (ts, source, medium, campaign, gclid, fbclid, is_bot) VALUES (?,?,?,?,?,?,?)', ts - 500, channel === 'Google Ads' ? 'google' : '', paid ? 'cpc' : '', camp[0], channel === 'Google Ads' ? 1 : 0, 0, 0);
        if (lead) {
          leadN++;
          const status = wpick(STATUS_W);
          const lr = run(
            `INSERT INTO leads (ts, updated_ts, tribunal, servico, prazo, via, sid, vid, channel, source, medium, campaign, content, term, gclid, fbclid, svc, landing, ref_host,
               first_touch, status, value_cents, notes, is_bot, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            ts + 50000, ts + 50000 + Math.floor(rnd() * 86400e3), court, servico, prazo, via, sid, '', channel, channel === 'Google Ads' ? 'google' : '', paid ? 'cpc' : '', camp[0], '', camp[1],
            channel === 'Google Ads' ? 'Cj0K' + hex(20) : '', '', camp[2], '/', '', '', status, status === 'fechado' ? 150000 + Math.floor(rnd() * 400000) : 0, '', bot, hex(16),
          );
          run('UPDATE visits SET lead_id = ? WHERE sid = ?', lr.id, sid);
          run(EV, ts + 50000, sid, 'lead', court + ':' + servico, null, '/', '');
          run('INSERT INTO lead_log (lead_id, ts, user_email, action, detail) VALUES (?,?,?,?,?)', lr.id, ts + 50000, '', 'criado', 'Demanda fictícia (demo)');
        }
      }
      // investimento diário fictício
      for (const [ch, camps] of [['Google Ads', ['correspondente-brasilia', 'resp-stj', 'sustentacao-oral', 'hde-stj', 'rr-tst']], ['Meta Ads', ['conteudo-tribunais-superiores']], ['LinkedIn Ads', ['conteudo-linkedin']]]) {
        for (const c of camps) {
          const base_ = ch === 'Google Ads' ? 4500 : 2500;
          run('INSERT INTO spend (day, channel, campaign, amount_cents, notes, created_ts, created_by) VALUES (?,?,?,?,?,?,?)', day, ch, c, Math.round(base_ * (0.7 + rnd() * 0.7)), '', now, 'demo');
        }
      }
    }
  });
  void PRAZOS;
  console.log(`Demo criada: ${leadN} demandas fictícias. Banco: ${process.env.LF_DB_FILE}`);
}
module.exports = { run: run_ };
