'use strict';
// Componentes HTML do painel (sem bibliotecas externas: nada sai do servidor).
const { esc } = require('./lib');

const TZ = 'America/Sao_Paulo';
const nf = new Intl.NumberFormat('pt-BR');
const dtf = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dtfFull = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tf = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const int = (n) => nf.format(Math.round(Number(n) || 0));
const pct = (a, b, d = 1) => (b ? ((a / b) * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%' : '—');
const brl = (cents) => ((Number(cents) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dur = (s) => { s = Math.round(Number(s) || 0); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
const dt = (ts) => dtf.format(new Date(ts));
const dtFull = (ts) => dtfFull.format(new Date(ts));
const time = (ts) => tf.format(new Date(ts));
const ago = (ts) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`; };
const dayLabel = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);

const raw = (html) => ({ html });
const cell = (c) => (c && typeof c === 'object' && 'html' in c ? c.html : esc(c));

const NAV = [
  ['/painel', 'Visão geral', 'home'], ['/painel/aquisicao', 'Aquisição', 'aq'], ['/painel/comportamento', 'Comportamento', 'comp'],
  ['/painel/leads', 'Demandas', 'leads'], ['/painel/tempo-real', 'Tempo real', 'rt'], ['/painel/investimento', 'Investimento', 'inv'],
  ['/painel/qualidade', 'Qualidade técnica', 'q'], ['/painel/utm', 'Links rastreados (UTM)', 'utm'],
];

// "Usuários" só aparece para administrador; "Minha conta" para todos.
const NAV_ACCOUNT = [['/painel/conta', 'Minha conta', 'conta']];
const NAV_ADMIN = [['/painel/usuarios', 'Usuários', 'users']];

function layout({ title, active, user, csrf, body, flash, flashErr, refresh }) {
  const items = [...NAV, ...(user.role === 'admin' ? NAV_ADMIN : []), ...NAV_ACCOUNT];
  const nav = items.map(([href, label, key]) => `<a href="${href}"${key === active ? ' class="on" aria-current="page"' : ''}>${esc(label)}</a>`).join('');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>${esc(title)} · Painel Lima Ferreira</title>
<link rel="stylesheet" href="/painel/assets/panel.css"><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>
<body><div class="app">
<aside class="side"><div class="side__brand"><strong>Lima Ferreira</strong><small>Painel de tráfego</small></div>
<nav class="side__nav" aria-label="Painel">${nav}</nav>
<div class="side__user"><span>${esc(user.name || user.email)}<small>${esc(user.role === 'admin' ? 'Administrador' : 'Gestor de tráfego')}</small></span>
<form method="post" action="/painel/sair"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn btn--ghost" type="submit">Sair</button></form></div></aside>
<main class="main" id="main"${refresh ? ` data-refresh="${refresh}"` : ''}><header class="main__head"><h1>${esc(title)}</h1></header>
${flash ? `<p class="flash${flashErr ? ' flash--err' : ''}" role="${flashErr ? 'alert' : 'status'}">${esc(flash)}</p>` : ''}${body}</main></div>
<script src="/painel/assets/panel.js" defer></script></body></html>`;
}

function loginPage({ csrf, error, locked }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>Entrar · Painel</title><link rel="stylesheet" href="/painel/assets/panel.css"></head>
<body class="login"><form class="login__card" method="post" action="/painel/login" autocomplete="on">
<h1>Painel de tráfego</h1><p class="muted">Acesso restrito. Lima Ferreira Advogados.</p>
${error ? `<p class="flash flash--err" role="alert">${esc(locked ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' : 'E-mail ou senha incorretos.')}</p>` : ''}
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<label>E-mail<input type="email" name="email" autocomplete="username" required autofocus></label>
<label>Senha<input type="password" name="password" autocomplete="current-password" required></label>
<button class="btn" type="submit">Entrar</button></form><script src="/painel/assets/panel.js" defer></script></body></html>`;
}

function filterBar(f, channels, extraHidden = '') {
  const opt = (v, l) => `<option value="${esc(v)}"${f.p === v ? ' selected' : ''}>${esc(l)}</option>`;
  return `<form class="filters" method="get" aria-label="Filtros">${extraHidden}
<label>Período<select name="p">${opt('hoje', 'Hoje')}${opt('ontem', 'Ontem')}${opt('7d', 'Últimos 7 dias')}${opt('30d', 'Últimos 30 dias')}${opt('90d', 'Últimos 90 dias')}${opt('custom', 'Personalizado')}</select></label>
<label>De<input type="date" name="from" value="${esc(f.from)}"></label><label>Até<input type="date" name="to" value="${esc(f.to)}"></label>
<label>Canal<select name="canal"><option value="">Todos</option>${channels.map((c) => `<option${f.canal === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
<label class="chk"><input type="checkbox" name="bots" value="1"${f.bots ? ' checked' : ''}> Incluir robôs</label>
<button class="btn" type="submit">Aplicar</button><span class="muted small">${esc(f.from)} → ${esc(f.to)} · horário de Brasília</span></form>`;
}

const kpi = (label, value, sub = '', tone = '') => `<div class="kpi ${tone}"><span class="kpi__l">${esc(label)}</span><strong class="kpi__v">${value}</strong>${sub ? `<span class="kpi__s">${sub}</span>` : ''}</div>`;
const card = (title, inner, note = '', cls = '') => `<section class="card ${cls}"><header><h2>${esc(title)}</h2>${note ? `<p class="muted small">${note}</p>` : ''}</header>${inner}</section>`;

function table(headers, rows, { empty = 'Sem dados no período.', num = [] } = {}) {
  if (!rows.length) return `<p class="empty">${esc(empty)}</p>`;
  const th = headers.map((h, i) => `<th scope="col"${num.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td${num.includes(i) ? ' class="n"' : ''}>${cell(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].find((m) => m * p >= v) * p;
}
function barChart(points, { color = 'var(--c1)', unit = '' } = {}) {
  const W = 560, H = 230, L = 34, R = 6, T = 10, B = 30;
  const n = points.length || 1;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const iw = W - L - R, ih = H - T - B, bw = Math.max(2, (iw / n) * 0.68);
  const step = Math.ceil(n / 6);
  let g = '';
  for (const frac of [0, 0.5, 1]) {
    const y = T + ih - ih * frac;
    g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="ax">${int(max * frac)}</text>`;
  }
  const bars = points.map((p, i) => {
    const x = L + (iw / n) * i + (iw / n - bw) / 2;
    const h = (p.value / max) * ih;
    const lab = i % step === 0 || i === n - 1 ? `<text x="${x + bw / 2}" y="${H - 9}" text-anchor="middle" class="ax">${esc(p.label)}</text>` : '';
    return `<rect x="${x.toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, p.value ? 1 : 0).toFixed(1)}" fill="${color}" rx="1.5"><title>${esc(p.label)}: ${int(p.value)}${esc(unit)}</title></rect>${lab}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras por dia">${g}${bars}</svg>`;
}

function funnel(steps) {
  const top = steps[0].value || 0;
  return `<ol class="funnel">${steps.map((s, i) => {
    const w = top ? Math.max(1.5, (s.value / top) * 100) : 0;
    const prev = i ? steps[i - 1].value : null;
    return `<li><div class="funnel__row"><span class="funnel__l">${esc(s.label)}</span><span class="funnel__n">${int(s.value)} <small>${pct(s.value, top)}</small></span></div>
<div class="funnel__bar"><span style="width:${w}%"></span></div>${prev && s.value <= prev ? `<span class="funnel__d muted small">${pct(s.value, prev)} do passo anterior</span>` : ''}</li>`;
  }).join('')}</ol>`;
}

function distList(rows, { total } = {}) {
  if (!rows.length) return '<p class="empty">Sem dados no período.</p>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  const tot = total || rows.reduce((s, r) => s + r.value, 0);
  return `<ul class="dist">${rows.map((r) => `<li><span class="dist__l">${esc(r.label || '(vazio)')}</span><span class="dist__b"><i style="width:${(r.value / max) * 100}%"></i></span><span class="dist__n">${int(r.value)} <small>${pct(r.value, tot, 0)}</small></span></li>`).join('')}</ul>`;
}

const STATUS_CLASS = { novo: 'st-new', contatado: 'st-info', qualificado: 'st-ok', proposta: 'st-ok', fechado: 'st-won', perdido: 'st-lost', spam: 'st-lost' };
const badge = (status, label) => raw(`<span class="badge ${STATUS_CLASS[status] || ''}">${esc(label)}</span>`);

module.exports = { raw, cell, esc, int, pct, brl, dur, dt, dtFull, time, ago, dayLabel, layout, loginPage, filterBar, kpi, card, table, barChart, funnel, distList, badge };
