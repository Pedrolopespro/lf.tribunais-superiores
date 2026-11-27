'use strict';
// Painel privado do gestor de tráfego: rotas, formulários, exportações e páginas.
const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib');
const auth = require('./auth');
const ui = require('./panel-ui');
const data = require('./panel-data');
const { TRIBUNAIS, SERVICOS, PRAZOS, VIAS, SVC_LABELS, STATUSES, SECTIONS } = require('./track');
const { all, get, run } = require('./db');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const VIEWS = path.join(__dirname, 'views');
const FLASH = {
  salvo: 'Alterações salvas.', adicionado: 'Investimento registrado.', excluido: 'Registro excluído.',
  'usuario-criado': 'Usuário criado. Passe a senha por um canal seguro; a pessoa pode trocá-la em Minha conta.',
  'senha-redefinida': 'Senha redefinida. As sessões abertas dessa pessoa foram encerradas.',
  'usuario-ativado': 'Usuário reativado.', 'usuario-desativado': 'Usuário desativado e desconectado.',
  'senha-alterada': 'Senha alterada. Suas outras sessões foram encerradas.',
};
// mensagens de erro (aparecem em vermelho)
const FLASH_ERR = {
  'erro-valor': 'Valor inválido. Use o formato 1234,56.', 'erro-dados': 'Dados inválidos. Confira os campos.',
  'email-invalido': 'E-mail inválido.', 'email-existe': 'Já existe um usuário com esse e-mail.', 'papel-invalido': 'Perfil inválido.',
  'senha-curta': `A senha precisa ter de ${auth.MIN_PASSWORD} a 200 caracteres.`, 'nao-encontrado': 'Usuário não encontrado.',
  'proprio-desativar': 'Você não pode desativar o seu próprio usuário.', 'proprio-senha': 'Para trocar a sua senha, use Minha conta.',
  'ultimo-admin': 'Não é possível desativar o último administrador.',
  'senha-atual-errada': 'A senha atual está incorreta.', 'senhas-diferentes': 'A confirmação não confere com a nova senha.',
  bloqueado: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
};
const PAID_CHANNELS = ['Google Ads', 'Meta Ads', 'LinkedIn Ads', 'Outros pagos'];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function parseBrl(s) {
  s = String(s || '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 100000000 ? Math.round(n * 100) : null;
}
const csvCell = (v, sep) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return new RegExp(`[${sep}"\\n\\r]`).test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (rows, sep = ';') => rows.map((r) => r.map((c) => csvCell(c, sep)).join(sep)).join('\r\n') + '\r\n';
const cleanText = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);

// ---------- helpers de página ----------
const qs = (f, extra = {}) => {
  const p = new URLSearchParams({ p: f.p, from: f.from, to: f.to, ...(f.canal ? { canal: f.canal } : {}), ...(f.bots ? { bots: '1' } : {}), ...extra });
  return p.toString();
};
const conv = (r) => pct(r.conv, r.sessions);
function pct(a, b, d) { return ui.pct(a, b, d); }

function healthCard(h) {
  const s = h.server, b = h.browser;
  const cap = s.n ? Math.min(100, (b.n / s.n) * 100) : null;
  const capG = s.g ? Math.min(100, (b.g / s.g) * 100) : null;
  const inner = `<div class="kpis kpis--3">${ui.kpi('Acessos vistos pelo servidor', ui.int(s.n))}${ui.kpi('Sessões medidas no navegador', ui.int(b.n), cap === null ? '' : `${cap.toFixed(0)}% dos acessos`)}${ui.kpi('Cliques de anúncio (gclid)', `${ui.int(b.g)} <small>de ${ui.int(s.g)}</small>`, capG === null ? 'sem cliques de Google Ads no período' : `${capG.toFixed(0)}% medidos`)}</div>`;
  return ui.card('Saúde do rastreamento', inner, 'Compara o que o servidor recebeu com o que o script do navegador conseguiu medir. A diferença inclui recargas de página, bloqueadores de script e visitantes que saem antes de a página carregar. Queda repentina costuma indicar problema no site, na tag ou no anúncio.');
}

// ---------- rótulos (tribunal / apoio / prazo) ----------
const tribSigla = (c) => (c ? String(c).toUpperCase() : '—');
const tribNome = (c) => (TRIBUNAIS[c] ? `${TRIBUNAIS[c]} (${tribSigla(c)})` : c || '—');
const servLabel = (c) => SERVICOS[c] || c || '—';
const prazoLabel = (c) => PRAZOS[c] || c || '—';
const demandLabel = (l) => `${tribSigla(l.tribunal)} · ${servLabel(l.servico)}`;

// ---------- páginas ----------
function pageOverview(ctx, f) {
  const d = data.overview(f), k = d.k;
  const st = Object.fromEntries(d.byStatus.map((s) => [s.status, s]));
  const qualified = ['qualificado', 'proposta', 'fechado'].reduce((n, s) => n + ((st[s] || {}).n || 0), 0);
  const won = st.fechado || { n: 0, v: 0 };
  const spend = d.spend.total;
  const kpis = [
    ui.kpi('Sessões', ui.int(k.sessions), `${ui.int(k.uniques)} visitantes únicos (aprox.)`),
    ui.kpi('Engajamento', pct(k.engaged, k.sessions), `${ui.int(k.engaged)} sessões · tempo médio ${ui.dur(k.engaged ? k.engaged_s / k.engaged : 0)}`),
    ui.kpi('Demandas concluídas', ui.int(k.leads), `${pct(k.leads, k.sessions)} das sessões · cliques para o WhatsApp`, 'kpi--hi'),
    ui.kpi('Sessões com clique no WhatsApp', ui.int(k.wa), `${pct(k.wa, k.sessions)} · inclui botão do topo e flutuante`, 'kpi--hi'),
    ui.kpi('Conversões', ui.int(k.conv), `${pct(k.conv, k.sessions)} · demanda concluída ou WhatsApp`, 'kpi--hi'),
    ui.kpi('Demandas qualificadas', ui.int(qualified), `${pct(qualified, k.leads)} das demandas`),
    ui.kpi('Contratos fechados', ui.int(won.n), won.v ? ui.brl(won.v) : 'sem valor informado'),
    ui.kpi('Investimento', spend ? ui.brl(spend) : '—', spend ? '' : 'registre em Investimento'),
    ui.kpi('Custo por demanda', spend && k.leads ? ui.brl(spend / k.leads) : '—', spend && k.conv ? `${ui.brl(spend / k.conv)} por conversão` : ''),
    ui.kpi('Retorno (ROAS)', spend && won.v ? (won.v / spend).toFixed(1).replace('.', ',') + '×' : '—', 'valor fechado ÷ investimento'),
  ].join('');
  const funnel = ui.funnel([
    { label: 'Sessões', value: k.sessions }, { label: 'Engajadas', value: k.engaged }, { label: 'Escolheram o tribunal', value: k.w1 },
    { label: 'Abriram o WhatsApp (demanda)', value: k.leads },
  ]);
  const sess = d.series.map((r) => ({ label: ui.dayLabel(r.d), value: r.sessions }));
  const cv = d.series.map((r) => ({ label: ui.dayLabel(r.d), value: r.leads + r.wa }));
  const statusRows = Object.entries(STATUSES).map(([key, label]) => ({ label, value: (st[key] || {}).n || 0 })).filter((r) => r.value);
  const body = `<div class="kpis">${kpis}</div>
<div class="cols"><div>${ui.card('Sessões por dia', ui.barChart(sess, { unit: ' sessões' }))}</div><div>${ui.card('Conversões por dia', ui.barChart(cv, { color: 'var(--c2)', unit: ' conversões' }), 'Demandas concluídas + sessões com clique no WhatsApp.')}</div></div>
<div class="cols"><div>${ui.card('Jornada até o WhatsApp', funnel, 'Cada etapa conta sessões únicas. "Escolheram o tribunal" = clicaram num cartão de tribunal (que já abre o WhatsApp).')}</div>
<div>${ui.card('Demandas por situação', ui.distList(statusRows), 'A equipe marca cada demanda em Demandas, depois de falar com o colega no WhatsApp.')}${healthCard(d.hits)}</div></div>`;
  return { title: 'Visão geral', active: 'home', filters: true, body };
}

function pageAcquisition(ctx, f) {
  const a = data.acquisition(f);
  const sp = a.spend;
  const row = (label, r, spendVal) => [label, ui.int(r.sessions), pct(r.engaged, r.sessions, 0), ui.int(r.leads), ui.int(r.wa), ui.int(r.conv), conv(r), spendVal ? ui.brl(spendVal) : '—', spendVal && r.conv ? ui.brl(spendVal / r.conv) : '—'];
  const H = ['Sessões', 'Engaj.', 'Demandas', 'WhatsApp', 'Conversões', 'Taxa conv.', 'Investimento', 'Custo/conv.'];
  const num = [1, 2, 3, 4, 5, 6, 7, 8];
  const body = [
    ui.card('Por canal', ui.table(['Canal', ...H], a.channels.map((r) => row(r.channel, r, sp.byChannel[r.channel])), { num }), 'Canal é definido por gclid/fbclid, UTM e site de referência.'),
    ui.card('Por campanha (utm_campaign)', ui.table(['Campanha', ...H], a.campaigns.map((r) => row(`${r.campaign} · ${r.channel}`, r, sp.byCampaign[r.channel + '|' + r.campaign])), { num, empty: 'Nenhuma campanha com UTM no período.' }), 'O investimento só aparece quando o nome da campanha em Investimento é igual ao utm_campaign.'),
    ui.card('Palavras-chave (utm_term)', ui.table(['Termo', 'Campanha', 'Sessões', 'Demandas', 'WhatsApp', 'Conversões'], a.terms.map((r) => [r.term, r.campaign, ui.int(r.sessions), ui.int(r.leads), ui.int(r.wa), ui.int(r.conv)]), { num: [2, 3, 4, 5], empty: 'Sem utm_term. Use {keyword} no modelo de URL do Google Ads (veja Links rastreados).' })),
    ui.card('Anúncios (utm_content)', ui.table(['Anúncio', 'Campanha', 'Sessões', 'Demandas', 'WhatsApp', 'Conversões'], a.contents.map((r) => [r.content, r.campaign, ui.int(r.sessions), ui.int(r.leads), ui.int(r.wa), ui.int(r.conv)]), { num: [2, 3, 4, 5], empty: 'Sem utm_content no período.' })),
    ui.card('Grupos de anúncios por serviço (svc)', ui.table(['Serviço', 'Sessões', 'Demandas', 'WhatsApp', 'Conversões', 'Taxa conv.'], a.svcs.map((r) => [SVC_LABELS[r.svc] || r.svc, ui.int(r.sessions), ui.int(r.leads), ui.int(r.wa), ui.int(r.conv), conv(r)]), { num: [1, 2, 3, 4, 5], empty: 'Nenhum acesso com o parâmetro svc.' }), 'O parâmetro ?svc= na URL final abre o assistente já no tribunal e no apoio certos.'),
    ui.card('Sites de referência', ui.table(['Site', 'Sessões', 'Conversões'], a.refs.map((r) => [r.ref_host, ui.int(r.sessions), ui.int(r.conv)]), { num: [1, 2] })),
    healthCard(a.hits),
  ].join('');
  return { title: 'Aquisição', active: 'aq', filters: true, body };
}

function pageBehavior(ctx, f) {
  const b = data.behavior(f), r = b.r;
  const secRows = SECTIONS.map(([id, label], i) => ({ label, value: r['s' + i] }));
  const scroll = [['25%', r.sc25], ['50%', r.sc50], ['75%', r.sc75], ['90%', r.sc90]].map(([label, value]) => ({ label: 'Rolou ' + label, value }));
  const times = [['Menos de 5 s', r.t0], ['5 a 15 s', r.t1], ['15 a 60 s', r.t2], ['Mais de 60 s', r.t3]].map(([label, value]) => ({ label, value }));
  const evt = (names) => b.events.filter((e) => names.includes(e.name));
  const evtTable = (rows, empty) => ui.table(['Item', 'Eventos', 'Sessões'], rows.map((e) => [e.label || '(sem rótulo)', ui.int(e.n), ui.int(e.sessions)]), { num: [1, 2], empty });
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0') + 'h', value: (b.hours.find((x) => x.h === h) || {}).sessions || 0 }));
  const hoursConv = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0') + 'h', value: (b.hours.find((x) => x.h === h) || {}).conv || 0 }));
  const wd = WEEKDAYS.map((l, i) => { const x = b.wdays.find((y) => y.d === i) || {}; return [l, ui.int(x.sessions || 0), ui.int(x.conv || 0), pct(x.conv || 0, x.sessions || 0)]; });
  const dev = (rows, key) => ui.table([key, 'Sessões', 'Conversões', 'Taxa conv.'], rows.map((x) => [x[Object.keys(x)[0]], ui.int(x.sessions), ui.int(x.conv), conv(x)]), { num: [1, 2, 3] });
  const dist = (rows, fn) => ui.distList(rows.map((x) => ({ label: fn(x.k), value: x.n })));
  const body = [
    `<div class="cols"><div>${ui.card('Seções vistas', ui.distList(secRows, { total: r.n }), 'Sessões que chegaram a cada seção (a seção precisa cruzar o centro da tela).')}</div>
<div>${ui.card('Profundidade de rolagem', ui.distList(scroll, { total: r.n }))}${ui.card('Tempo engajado', ui.distList(times, { total: r.n }), 'Conta só o tempo com a aba visível e interação recente.')}</div></div>`,
    `<div class="cols"><div>${ui.card('Tribunal escolhido (sessões)', dist(b.pickCourt, tribSigla), 'Interesse por tribunal, mesmo quando o visitante não conclui.')}</div>
<div>${ui.card('Apoio escolhido (sessões)', dist(b.pickServico, servLabel))}${ui.card('Prazo informado (sessões)', dist(b.pickPrazo, prazoLabel), 'Quem tem prazo em andamento ou julgamento marcado tende a ter urgência.')}</div></div>`,
    `<div class="cols"><div>${ui.card('Demandas concluídas por tribunal', dist(b.leadTribunal, tribSigla))}${ui.card('Demandas concluídas por apoio', dist(b.leadServico, servLabel))}</div>
<div>${ui.card('Demandas concluídas por prazo', dist(b.leadPrazo, prazoLabel))}${ui.card('Botões e chamadas (CTA)', evtTable(evt(['cta_click', 'whatsapp_click']).map((e) => ({ ...e, label: (e.name === 'whatsapp_click' ? '[WhatsApp] ' : '[CTA] ') + e.label })), 'Nenhum clique registrado.'), 'Rótulos vêm do atributo data-label de cada botão.')}</div></div>`,
    `<div class="cols"><div>${ui.card('Carrossel de tribunais', evtTable(evt(['carousel_ctl']), 'Ninguém usou os controles do carrossel.'), 'Anterior, próximo, pausar e retomar.')}</div>
<div></div></div>`,
    `<div class="cols"><div>${ui.card('Sessões por hora do dia', ui.barChart(hours, { unit: ' sessões' }), 'Horário de Brasília. Use para ajustar agendamento de anúncios.')}</div><div>${ui.card('Conversões por hora', ui.barChart(hoursConv, { color: 'var(--c2)', unit: ' conversões' }))}</div></div>`,
    `<div class="cols"><div>${ui.card('Dia da semana', ui.table(['Dia', 'Sessões', 'Conversões', 'Taxa conv.'], wd, { num: [1, 2, 3] }))}</div>
<div>${ui.card('Dispositivo', dev(b.devices, 'Dispositivo'))}${ui.card('Navegador', dev(b.browsers, 'Navegador'))}${ui.card('Sistema', dev(b.oses, 'Sistema'))}</div></div>`,
  ].join('');
  return { title: 'Comportamento', active: 'comp', filters: true, body };
}

function pageLeads(ctx, f, url) {
  const q = url.searchParams;
  const L = data.leadsPage(f, q);
  const cnt = Object.fromEntries(L.counts.map((c) => [c.status, c.n]));
  const chips = [['', 'Todas', Object.values(cnt).reduce((a, b) => a + b, 0)], ...Object.entries(STATUSES).map(([k, l]) => [k, l, cnt[k] || 0])]
    .map(([k, l, n]) => `<a class="chip${L.status === k ? ' on' : ''}" href="/painel/leads?${qs(f, { ...(k ? { status: k } : {}), ...(L.term ? { q: L.term } : {}) })}">${ui.esc(l)} <b>${n}</b></a>`).join('');
  const rows = L.rows.map((l) => [
    ui.raw(`<a href="/painel/leads/${l.id}">${ui.dt(l.ts)}</a>`), tribSigla(l.tribunal), servLabel(l.servico), prazoLabel(l.prazo), VIAS[l.via] || l.via,
    l.channel + (l.campaign ? ' · ' + l.campaign : ''), ui.badge(l.status, STATUSES[l.status] || l.status), l.value_cents ? ui.brl(l.value_cents) : '—',
  ]);
  const pg = (n) => `/painel/leads?${qs(f, { page: n, ...(L.status ? { status: L.status } : {}), ...(L.term ? { q: L.term } : {}) })}`;
  const pager = L.pages > 1 ? `<nav class="pager">${L.page > 1 ? `<a href="${pg(L.page - 1)}">← Anterior</a>` : ''}<span>Página ${L.page} de ${L.pages}</span>${L.page < L.pages ? `<a href="${pg(L.page + 1)}">Próxima →</a>` : ''}</nav>` : '';
  const search = `<form class="filters filters--inline" method="get" action="/painel/leads"><input type="hidden" name="p" value="${ui.esc(f.p)}"><input type="hidden" name="from" value="${ui.esc(f.from)}"><input type="hidden" name="to" value="${ui.esc(f.to)}">${f.canal ? `<input type="hidden" name="canal" value="${ui.esc(f.canal)}">` : ''}${f.bots ? '<input type="hidden" name="bots" value="1">' : ''}${L.status ? `<input type="hidden" name="status" value="${ui.esc(L.status)}">` : ''}<label>Buscar<input type="search" name="q" value="${ui.esc(L.term)}" placeholder="tribunal, apoio, campanha, observação…"></label><button class="btn" type="submit">Buscar</button></form>`;
  const exp = `<p class="exports">Exportar: <a href="/painel/exportar/leads.csv?${qs(f)}">demandas (CSV)</a> · <a href="/painel/exportar/google-ads-offline.csv">conversões offline Google Ads (CSV)</a> · <a href="/painel/exportar/sessoes.csv?${qs(f)}">sessões (CSV)</a></p>`;
  const offlineNote = '<p class="muted small">Conversões offline: os nomes “Lead qualificado”, “Proposta enviada” e “Contrato fechado” precisam existir na conta do Google Ads como ações de conversão por importação de cliques, com exatamente esses nomes. O arquivo só inclui demandas que vieram de clique com gclid.</p>';
  const note = '<p class="muted small">Cada demanda nasce de um clique para o WhatsApp: num cartão de tribunal (já vem com o tribunal) ou num botão “Falar com nossa equipe” (tribunal = —). O site não coleta nome nem telefone: a conversa acontece no WhatsApp, e a equipe atualiza a situação aqui.</p>';
  const body = `<div class="chips">${chips}</div>${search}${note}${ui.card(`${L.total} demanda${L.total === 1 ? '' : 's'}`, ui.table(['Data', 'Tribunal', 'Apoio', 'Prazo', 'Via', 'Origem', 'Situação', 'Valor'], rows, { empty: 'Nenhuma demanda no período.' }) + pager)}${exp}${offlineNote}`;
  return { title: 'Demandas', active: 'leads', filters: true, body };
}

function pageLeadDetail(ctx, id, flash) {
  const d = data.leadDetail(id);
  if (!d) return null;
  const { lead: l, visit: v, events, log } = d;
  let ft = {};
  try { ft = l.first_touch ? JSON.parse(l.first_touch) : {}; } catch { /* ignora */ }
  const dl = (rows) => `<dl class="kv">${rows.map(([k, val]) => `<div><dt>${ui.esc(k)}</dt><dd>${val === '' || val == null ? '—' : ui.cell(val)}</dd></div>`).join('')}</dl>`;
  const t0 = events.length ? events[0].ts : l.ts;
  const journey = events.filter((e) => e.name !== 'lcp' && e.name !== 'cls'); // métricas técnicas ficam em "Qualidade técnica"
  const timeline = journey.length ? `<ol class="timeline">${journey.map((e) => `<li><time>+${ui.dur((e.ts - t0) / 1000)}</time><span><b>${ui.esc(e.name)}</b>${e.label ? ' · ' + ui.esc(e.label) : ''}${e.value != null && e.name !== 'lead' ? ' · ' + ui.esc(e.value) : ''}</span></li>`).join('')}</ol>` : '<p class="empty">Sem eventos de navegação ligados a esta demanda (o visitante pode ter bloqueado o script).</p>';
  const form = `<form method="post" action="/painel/leads/${l.id}" class="stack"><input type="hidden" name="_csrf" value="${ui.esc(ctx.csrf)}">
<label>Situação<select name="status">${Object.entries(STATUSES).map(([k, lab]) => `<option value="${k}"${l.status === k ? ' selected' : ''}>${ui.esc(lab)}</option>`).join('')}</select></label>
<label>Valor do contrato (R$)<input name="value" inputmode="decimal" value="${l.value_cents ? (l.value_cents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label>
<label>Observações internas <small>(não coloque dados sigilosos de clientes)</small><textarea name="notes" rows="4" maxlength="2000">${ui.esc(l.notes)}</textarea></label>
<button class="btn" type="submit">Salvar</button></form>`;
  const body = `<p><a href="/painel/leads">← Voltar às demandas</a></p><div class="cols">
<div>${ui.card('Demanda', dl([['Tribunal', tribNome(l.tribunal)], ['Apoio', servLabel(l.servico)], ['Prazo', prazoLabel(l.prazo)], ['Clique final', VIAS[l.via] || l.via], ['Recebida em', ui.dtFull(l.ts)]]))}
${ui.card('Origem (atribuição)', dl([['Canal', l.channel], ['utm_source', l.source], ['utm_medium', l.medium], ['utm_campaign', l.campaign], ['utm_content', l.content], ['utm_term', l.term], ['svc', l.svc ? SVC_LABELS[l.svc] || l.svc : ''], ['gclid', l.gclid ? l.gclid.slice(0, 12) + '…' : ''], ['fbclid', l.fbclid ? l.fbclid.slice(0, 12) + '…' : ''], ['Site de referência', l.ref_host], ['Primeiro toque', ft.utm_source ? `${ft.utm_source} / ${ft.utm_medium || '-'} / ${ft.utm_campaign || '-'}` : (ft.ts ? 'direto / sem UTM' : 'não disponível (sem consentimento)')]]))}
${v ? ui.card('Sessão', dl([['Dispositivo', `${v.device} · ${v.browser} · ${v.os}`], ['Rolagem máxima', v.max_scroll + '%'], ['Tempo engajado', ui.dur(v.engaged_s)], ['Cliques em CTA', v.cta_clicks], ['Consentimento de cookies', v.consent === 1 ? 'aceitou' : v.consent === -1 ? 'recusou' : 'sem decisão']])) : ''}</div>
<div>${ui.card('Acompanhamento', form)}${ui.card('Jornada até a demanda', timeline, 'Eventos da sessão que terminou no clique para o WhatsApp.')}
${ui.card('Histórico', log.length ? `<ul class="log">${log.map((x) => `<li><time>${ui.dtFull(x.ts)}</time> ${x.user_email ? ui.esc(x.user_email) + ': ' : ''}<b>${ui.esc(x.action)}</b>${x.detail ? ' — ' + ui.esc(x.detail) : ''}</li>`).join('')}</ul>` : '<p class="empty">Sem histórico.</p>')}</div></div>`;
  return { title: `Demanda #${l.id}`, active: 'leads', filters: false, body, flash };
}

function pageRealtime() {
  const r = data.realtime();
  const vis = ui.table(['Início', 'Atividade', 'Canal', 'Campanha / termo', 'Dispositivo', 'Rolagem', 'Engaj.', 'Último evento'], r.visits.map((v) => [
    ui.time(v.first_ts), ui.ago(v.last_ts) + ' atrás', v.channel, [v.campaign, v.term].filter(Boolean).join(' · ') || '—', `${v.device} · ${v.browser}`, v.max_scroll + '%', ui.dur(v.engaged_s),
    ui.raw(`${ui.esc(v.last_ev || '—')}${v.lead_id ? ' <span class="badge st-won">lead</span>' : ''}${v.wa_clicks ? ' <span class="badge st-ok">WhatsApp</span>' : ''}`)]), { empty: 'Nenhuma sessão na última hora.' });
  const ev = ui.table(['Hora', 'Evento', 'Rótulo', 'Canal'], r.events.map((e) => [ui.time(e.ts), e.name, e.label, e.channel]), { empty: 'Sem eventos recentes.' });
  const body = `<div class="kpis kpis--3">${ui.kpi('Online agora', ui.int(r.online), 'atividade nos últimos 5 minutos', 'kpi--hi')}${ui.kpi('Sessões (30 min)', ui.int(r.last30))}${ui.kpi('Leads (24 h)', ui.int(r.leads24))}</div>
<p class="muted small">Atualiza sozinho a cada 10 segundos. Robôs não aparecem aqui.</p>
<div class="cols"><div>${ui.card('Sessões da última hora', vis)}</div><div>${ui.card('Últimos eventos', ev)}</div></div>`;
  return { title: 'Tempo real', active: 'rt', filters: false, body, refresh: 10 };
}

function pageQuality(ctx, f) {
  const q = data.quality(f);
  const ms = (v) => (v == null ? '—' : v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(2).replace('.', ',') + ' s');
  const lcpB = (v) => (v == null ? '' : ui.raw(` <span class="badge ${v <= 2500 ? 'st-ok' : v <= 4000 ? 'st-info' : 'st-lost'}">${v <= 2500 ? 'bom' : v <= 4000 ? 'atenção' : 'ruim'}</span>`));
  const clsB = (v) => (v == null ? '' : ui.raw(` <span class="badge ${v <= 0.1 ? 'st-ok' : v <= 0.25 ? 'st-info' : 'st-lost'}">${v <= 0.1 ? 'bom' : v <= 0.25 ? 'atenção' : 'ruim'}</span>`));
  const vrow = (label, x) => [label, ui.int(x.n), ui.raw(ms(x.lcp50)), ui.raw(ms(x.lcp75) + (x.lcp75 == null ? '' : lcpB(x.lcp75).html)), x.cls50 == null ? '—' : String(x.cls50).replace('.', ','), ui.raw(x.cls75 == null ? '—' : String(x.cls75).replace('.', ',') + clsB(x.cls75).html)];
  const b = q.base, bots = q.bots;
  const body = [
    ui.card('Velocidade percebida (Core Web Vitals)', ui.table(['Segmento', 'Sessões medidas', 'LCP mediano', 'LCP p75', 'CLS mediano', 'CLS p75'], [vrow('Todos', q.all), vrow('Mobile', q.mobile), vrow('Desktop', q.desktop)], { num: [1, 2, 3, 4, 5], empty: 'Ainda sem medições.' }), 'Meta do Google (p75): LCP até 2,5 s e CLS até 0,1. Página lenta no celular derruba a taxa de conversão e o índice de qualidade dos anúncios.'),
    `<div class="cols"><div>${ui.card('Consentimento de cookies', `<div class="kpis kpis--3">${ui.kpi('Aceitaram', pct(b.accepted, b.n, 0), ui.int(b.accepted) + ' sessões')}${ui.kpi('Recusaram', pct(b.declined, b.n, 0), ui.int(b.declined) + ' sessões')}${ui.kpi('Sem decisão', pct(b.undecided, b.n, 0), ui.int(b.undecided) + ' sessões')}</div>`, 'Só quem aceita carrega GTM/GA4/Pixel. O restante é medido apenas aqui, de forma anônima — por isso este painel é a fonte mais completa de volume.')}</div>
<div>${ui.card('Robôs e tráfego inválido', `<div class="kpis kpis--3">${ui.kpi('Sessões brutas', ui.int(bots.n))}${ui.kpi('Robôs filtrados', ui.int(bots.bots))}${ui.kpi('Participação', pct(bots.bots, bots.n))}</div>`, 'Excluídos das métricas por padrão. Marque “Incluir robôs” nos filtros para auditar.')}</div></div>`,
    ui.card('Erros de JavaScript', ui.table(['Erro', 'Ocorrências', 'Sessões'], q.errs.map((e) => [e.label, ui.int(e.n), ui.int(e.sessions)]), { num: [1, 2], empty: 'Nenhum erro registrado no período.' }), `${ui.int(b.err_sessions)} sessões com erro (${pct(b.err_sessions, b.n)}).`),
    healthCard(q.hits),
  ].join('');
  return { title: 'Qualidade técnica', active: 'q', filters: true, body };
}

function pageSpend(ctx, flash) {
  const rows = data.spendList().map((s) => [s.day.slice(8, 10) + '/' + s.day.slice(5, 7) + '/' + s.day.slice(0, 4), s.channel, s.campaign || '—', ui.brl(s.amount_cents), s.notes || '',
    ui.raw(`<form method="post" action="/painel/investimento/${s.id}/excluir" data-confirm="Excluir este registro?"><input type="hidden" name="_csrf" value="${ui.esc(ctx.csrf)}"><button class="btn btn--sm btn--danger" type="submit">Excluir</button></form>`)]);
  const form = `<form method="post" action="/painel/investimento" class="stack stack--row"><input type="hidden" name="_csrf" value="${ui.esc(ctx.csrf)}">
<label>Dia<input type="date" name="day" value="${lib.brtDay(Date.now())}" required></label>
<label>Canal<select name="channel">${PAID_CHANNELS.map((c) => `<option>${c}</option>`).join('')}</select></label>
<label>Campanha <small>(igual ao utm_campaign)</small><input name="campaign" maxlength="80" placeholder="ex.: resp-stj"></label>
<label>Valor gasto (R$)<input name="amount" inputmode="decimal" placeholder="0,00" required></label>
<label>Observação<input name="notes" maxlength="200"></label><button class="btn" type="submit">Registrar</button></form>`;
  const body = `${ui.card('Registrar investimento', form, 'O painel não acessa as contas de anúncio. Lance o gasto diário (ou semanal) por campanha para calcular custo por lead, custo por conversão e ROAS. Para importar do Google Ads/Meta, exporte o relatório e lance os totais.')}${ui.card('Lançamentos recentes', ui.table(['Dia', 'Canal', 'Campanha', 'Valor', 'Obs.', ''], rows, { num: [3], empty: 'Nenhum lançamento.' }))}`;
  return { title: 'Investimento', active: 'inv', filters: false, body, flash };
}

function pageUtm() {
  const site = String(lib.getConfig().site.url || '').replace(/\/$/, '');
  const svcOpts = Object.entries(SVC_LABELS).map(([k, l]) => `<option value="${k}">${ui.esc(l)}</option>`).join('');
  const tribOpts = Object.entries(TRIBUNAIS).map(([k, l]) => `<option value="${k}">${ui.esc(k.toUpperCase() + ' — ' + l)}</option>`).join('');
  const body = `<div class="cols"><div>${ui.card('Gerar URL com rastreamento', `<form id="utm-form" class="stack" data-site="${ui.esc(site)}">
<label>URL da página<input name="base" value="${ui.esc(site || 'https://')}"></label>
<label>Origem (utm_source)<select name="source"><option value="google">google</option><option value="facebook">facebook</option><option value="instagram">instagram</option><option value="linkedin">linkedin</option><option value="email">email</option><option value="whatsapp">whatsapp</option></select></label>
<label>Mídia (utm_medium)<select name="medium"><option value="cpc">cpc (busca paga)</option><option value="paid_social">paid_social</option><option value="email">email</option><option value="organico">organico</option><option value="bio">bio</option></select></label>
<label>Campanha (utm_campaign)<input name="campaign" placeholder="ex.: resp-stj" required></label>
<label>Anúncio / criativo (utm_content)<input name="content" placeholder="ex.: anuncio-1"></label>
<label>Termo (utm_term)<input name="term" placeholder="no Google Ads use {keyword}"></label>
<label>Serviço pré-selecionado (svc) <small>a mensagem do WhatsApp já sai com o apoio</small><select name="svc"><option value="">Nenhum (visitante escolhe)</option>${svcOpts}</select></label>
<label>Tribunal pré-selecionado <small>só quando o anúncio for de um tribunal específico</small><select name="tribunal"><option value="">Nenhum (visitante escolhe)</option>${tribOpts}</select></label></form>`, 'Use letras minúsculas, sem acento e com hífen. O painel já normaliza para minúsculas.')}</div>
<div>${ui.card('Resultado', `<label class="stack">URL final<textarea id="utm-out" rows="5" readonly></textarea></label><button class="btn" type="button" id="utm-copy">Copiar URL</button>
<h3 class="h3">Google Ads — modelo de acompanhamento (sufixo do URL final)</h3><textarea id="utm-suffix" rows="3" readonly></textarea><button class="btn btn--sm" type="button" id="utm-copy2">Copiar sufixo</button>
<p class="muted small">Ative também a marcação automática (gclid) na conta. O sufixo traz a palavra-chave e o tipo de correspondência de cada clique para cá.</p>`)}
${ui.card('Convenção sugerida', `<ul class="plain"><li><b>Campanha:</b> serviço-tribunal (ex.: <code>resp-stj</code>, <code>correspondente-brasilia</code>)</li><li><b>Anúncio:</b> <code>anuncio-1</code>, <code>anuncio-2</code>…</li><li><b>Redes sociais:</b> prefira conteúdo informativo; ver Provimento 205/2021 (impulsionamento sem oferta de serviços).</li></ul>`)}</div></div>`;
  return { title: 'Links rastreados (UTM)', active: 'utm', filters: false, body };
}

// ---------- usuários e conta ----------
function pageUsers(ctx) {
  const csrf = `<input type="hidden" name="_csrf" value="${ui.esc(ctx.csrf)}">`;
  const rows = auth.listUsers().map((u) => {
    const self = u.id === ctx.user.id;
    const actions = self
      ? ui.raw('<span class="muted small">Você · <a href="/painel/conta">Minha conta</a></span>')
      : ui.raw(`<div class="inline-forms">
<form method="post" action="/painel/usuarios/${u.id}/senha">${csrf}<input type="password" name="password" minlength="${auth.MIN_PASSWORD}" maxlength="200" placeholder="Nova senha" autocomplete="new-password" aria-label="Nova senha de ${ui.esc(u.email)}" required><button class="btn btn--sm" type="submit">Redefinir senha</button></form>
<form method="post" action="/painel/usuarios/${u.id}/situacao" data-confirm="${u.active ? 'Desativar este usuário? Ele será desconectado agora.' : 'Reativar este usuário?'}">${csrf}<input type="hidden" name="active" value="${u.active ? 0 : 1}"><button class="btn btn--sm${u.active ? ' btn--danger' : ''}" type="submit">${u.active ? 'Desativar' : 'Reativar'}</button></form></div>`);
    return [
      u.name || '—', u.email, u.role === 'admin' ? ui.badge('novo', 'Administrador') : ui.badge('contatado', 'Gestor de tráfego'),
      u.last_login ? ui.dtFull(u.last_login) : 'nunca entrou', u.active ? ui.badge('qualificado', 'Ativo') : ui.badge('perdido', 'Desativado'), actions,
    ];
  });
  const form = `<form method="post" action="/painel/usuarios" class="stack stack--row" autocomplete="off">${csrf}
<label>Nome<input name="name" maxlength="80" placeholder="ex.: Maria Souza"></label>
<label>E-mail<input type="email" name="email" maxlength="120" required></label>
<label>Perfil<select name="role"><option value="gestor">Gestor de tráfego</option><option value="admin">Administrador</option></select></label>
<label>Senha inicial <small>mín. ${auth.MIN_PASSWORD} caracteres</small><input type="password" name="password" minlength="${auth.MIN_PASSWORD}" maxlength="200" autocomplete="new-password" required></label>
<button class="btn" type="submit">Criar usuário</button></form>`;
  const note = 'Gestor vê todos os dados e atualiza as demandas. Só administrador cria, desativa e redefine senhas de usuários. Não existe cadastro aberto: ninguém entra sem ser criado aqui. Desativar bloqueia o acesso na hora.';
  const body = `${ui.card('Novo usuário', form, note)}${ui.card('Usuários do painel', ui.table(['Nome', 'E-mail', 'Perfil', 'Último acesso', 'Situação', 'Ações'], rows, { empty: 'Nenhum usuário.' }))}`;
  return { title: 'Usuários', active: 'users', filters: false, body };
}

function pageAccount(ctx) {
  const csrf = `<input type="hidden" name="_csrf" value="${ui.esc(ctx.csrf)}">`;
  const u = ctx.user;
  const info = `<dl class="kv"><div><dt>Nome</dt><dd>${ui.esc(u.name || '—')}</dd></div><div><dt>E-mail</dt><dd>${ui.esc(u.email)}</dd></div><div><dt>Perfil</dt><dd>${u.role === 'admin' ? 'Administrador' : 'Gestor de tráfego'}</dd></div></dl>`;
  const form = `<form method="post" action="/painel/conta/senha" class="stack">${csrf}
<input type="email" value="${ui.esc(u.email)}" autocomplete="username" hidden readonly>
<label>Senha atual<input type="password" name="current" autocomplete="current-password" required></label>
<label>Nova senha <small>mín. ${auth.MIN_PASSWORD} caracteres</small><input type="password" name="next" minlength="${auth.MIN_PASSWORD}" maxlength="200" autocomplete="new-password" required></label>
<label>Repita a nova senha<input type="password" name="confirm" minlength="${auth.MIN_PASSWORD}" maxlength="200" autocomplete="new-password" required></label>
<button class="btn" type="submit">Trocar senha</button></form>`;
  return { title: 'Minha conta', active: 'conta', filters: false, body: `<div class="cols"><div>${ui.card('Meu acesso', info)}</div><div>${ui.card('Trocar senha', form, 'Ao trocar, as suas outras sessões abertas são encerradas. Use uma senha longa e que você não usa em outros lugares.')}</div></div>` };
}

// ---------- exportações ----------
function exportLeads(ctx, f) {
  const rows = all(`SELECT * FROM leads WHERE ts >= ? AND ts < ? ${f.bots ? '' : 'AND is_bot = 0'} ${f.canal ? 'AND channel = ?' : ''} ORDER BY ts DESC`, f.fromTs, f.toTs, ...(f.canal ? [f.canal] : []));
  const head = ['id', 'data', 'tribunal', 'apoio', 'prazo', 'clique_final', 'situacao', 'valor_reais', 'canal', 'campanha', 'termo', 'anuncio', 'svc', 'gclid', 'fbclid'];
  const out = [head, ...rows.map((l) => [l.id, new Date(l.ts - lib.BRT_MS).toISOString().slice(0, 19).replace('T', ' '), tribSigla(l.tribunal), servLabel(l.servico), prazoLabel(l.prazo), VIAS[l.via] || l.via, STATUSES[l.status] || l.status, (l.value_cents / 100).toFixed(2), l.channel, l.campaign, l.term, l.content, l.svc, l.gclid, l.fbclid])];
  return '﻿' + toCsv(out, ';');
}
function exportOffline() {
  const names = { qualificado: 'Lead qualificado', proposta: 'Proposta enviada', fechado: 'Contrato fechado' };
  const rows = all("SELECT gclid, status, updated_ts, value_cents FROM leads WHERE gclid != '' AND status IN ('qualificado','proposta','fechado') AND is_bot = 0 ORDER BY updated_ts DESC");
  const out = [['Parameters:TimeZone=-0300'], ['Google Click ID', 'Conversion Name', 'Conversion Time', 'Conversion Value', 'Conversion Currency'],
    ...rows.map((r) => [r.gclid, names[r.status], new Date(r.updated_ts - lib.BRT_MS).toISOString().slice(0, 19).replace('T', ' '), r.status === 'fechado' ? (r.value_cents / 100).toFixed(2) : '', 'BRL'])];
  return toCsv(out, ',');
}
function exportSessions(f) {
  const w = data.vWhere(f);
  const rows = all(`SELECT * FROM visits v WHERE ${w.sql} ORDER BY first_ts DESC LIMIT 50000`, ...w.p);
  const head = ['inicio', 'canal', 'source', 'medium', 'campanha', 'anuncio', 'termo', 'svc', 'referencia', 'dispositivo', 'navegador', 'sistema', 'paginas', 'rolagem_max', 'engajado_s', 'cliques_cta', 'cliques_whatsapp', 'tribunal', 'apoio', 'prazo', 'etapa_assistente', 'demanda_concluida', 'lcp_ms', 'cls', 'consentimento'];
  return '﻿' + toCsv([head, ...rows.map((v) => [new Date(v.first_ts - lib.BRT_MS).toISOString().slice(0, 19).replace('T', ' '), v.channel, v.source, v.medium, v.campaign, v.content, v.term, v.svc, v.ref_host, v.device, v.browser, v.os, v.pageviews, v.max_scroll, v.engaged_s, v.cta_clicks, v.wa_clicks, tribSigla(v.court), servLabel(v.servico), prazoLabel(v.prazo), v.wstep, v.lead_id ? 1 : 0, v.lcp_ms ?? '', v.cls ?? '', v.consent])], ';');
}

// ---------- roteador ----------
async function handle(req, res, url, io) {
  const ph = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Content-Security-Policy': CSP };
  const p = url.pathname.replace(/\/+$/, '') || '/painel';
  const out = (status, body, extra = {}, ext = '.html') => io.send(req, res, status, body, { ...ph, ...extra }, ext);
  const redirect = (to, cookie) => { res.writeHead(303, io.baseHeaders(req, { ...ph, Location: to, ...(cookie ? { 'Set-Cookie': cookie } : {}) })); res.end(); };
  const readForm = async () => Object.fromEntries(new URLSearchParams(await lib.readBody(req, 16 * 1024)));

  // estáticos do painel
  if (p === '/painel/assets/panel.css' || p === '/painel/assets/panel.js') {
    const file = path.join(VIEWS, path.basename(p));
    return out(200, fs.readFileSync(file), { 'Cache-Control': 'no-cache' }, path.extname(file));
  }

  // login
  if (p === '/painel/login') {
    if (req.method === 'GET') {
      if (auth.getSession(req)) return redirect('/painel');
      const pre = auth.preToken(req);
      return out(200, ui.loginPage({ csrf: pre.token }), pre.setCookie ? { 'Set-Cookie': pre.setCookie } : {});
    }
    if (req.method === 'POST') {
      const body = await readForm();
      const pre = auth.preToken(req);
      if (!auth.verifyPre(req, body._csrf)) return out(403, ui.loginPage({ csrf: pre.token, error: true }), pre.setCookie ? { 'Set-Cookie': pre.setCookie } : {});
      const r = auth.login(req, body.email, body.password);
      if (!r.ok) return out(r.locked ? 429 : 401, ui.loginPage({ csrf: pre.token, error: true, locked: r.locked }), pre.setCookie ? { 'Set-Cookie': pre.setCookie } : {});
      return redirect('/painel', r.cookie);
    }
    return out(405, 'Método não permitido', {}, '.txt');
  }

  // a partir daqui, só logado
  const sess = auth.getSession(req);
  if (!sess) return redirect('/painel/login');
  const ctx = { user: sess.user, csrf: sess.csrf };
  let body = null;
  if (req.method === 'POST') {
    body = await readForm();
    if (!auth.safeEq(body._csrf || '', sess.csrf)) return out(403, 'Requisição inválida (CSRF). Volte e tente de novo.', {}, '.txt');
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return out(405, 'Método não permitido', {}, '.txt');
  }
  const flashKey = url.searchParams.get('msg') || '';
  const flashErr = Object.hasOwn(FLASH_ERR, flashKey);
  const flash = Object.hasOwn(FLASH, flashKey) ? FLASH[flashKey] : flashErr ? FLASH_ERR[flashKey] : '';
  const isAdmin = ctx.user.role === 'admin';
  const forbidden = () => out(403, 'Acesso restrito a administradores.', {}, '.txt');
  const render = (page) => out(200, ui.layout({ ...page, user: ctx.user, csrf: ctx.csrf, flash: page.flash || flash, flashErr, body: (page.filters ? ui.filterBar(page.f, lib.CHANNELS) : '') + page.body, refresh: page.refresh }));

  if (p === '/painel/sair' && req.method === 'POST') return redirect('/painel/login', auth.endSession(req));

  if (req.method === 'GET' || req.method === 'HEAD') {
    const f = data.parseFilter(url.searchParams);
    let m;
    if (p === '/painel') return render({ ...pageOverview(ctx, f), f });
    if (p === '/painel/aquisicao') return render({ ...pageAcquisition(ctx, f), f });
    if (p === '/painel/comportamento') return render({ ...pageBehavior(ctx, f), f });
    if (p === '/painel/leads') return render({ ...pageLeads(ctx, f, url), f });
    if ((m = p.match(/^\/painel\/leads\/(\d+)$/))) {
      const page = pageLeadDetail(ctx, Number(m[1]), flash);
      return page ? render({ ...page, f }) : out(404, 'Lead não encontrado.', {}, '.txt');
    }
    if (p === '/painel/tempo-real') return render(pageRealtime());
    if (p === '/painel/qualidade') return render({ ...pageQuality(ctx, f), f });
    if (p === '/painel/investimento') return render(pageSpend(ctx, flash));
    if (p === '/painel/utm') return render(pageUtm());
    if (p === '/painel/conta') return render(pageAccount(ctx));
    if (p === '/painel/usuarios') return isAdmin ? render(pageUsers(ctx)) : forbidden();
    if (p === '/painel/exportar/leads.csv') return out(200, exportLeads(ctx, f), { 'Content-Disposition': 'attachment; filename="leads.csv"', 'Content-Type': 'text/csv; charset=utf-8' }, '.csv');
    if (p === '/painel/exportar/google-ads-offline.csv') return out(200, exportOffline(), { 'Content-Disposition': 'attachment; filename="google-ads-conversoes-offline.csv"', 'Content-Type': 'text/csv; charset=utf-8' }, '.csv');
    if (p === '/painel/exportar/sessoes.csv') return out(200, exportSessions(f), { 'Content-Disposition': 'attachment; filename="sessoes.csv"', 'Content-Type': 'text/csv; charset=utf-8' }, '.csv');
    return out(404, 'Página não encontrada.', {}, '.txt');
  }

  // ---- POST ----
  let m;
  if ((m = p.match(/^\/painel\/leads\/(\d+)$/))) {
    const id = Number(m[1]);
    const lead = get('SELECT * FROM leads WHERE id = ?', id);
    if (!lead) return out(404, 'Lead não encontrado.', {}, '.txt');
    const status = Object.keys(STATUSES).includes(body.status) ? body.status : lead.status;
    const valueRaw = String(body.value || '').trim();
    const cents = valueRaw === '' ? 0 : parseBrl(valueRaw);
    if (cents === null) return redirect(`/painel/leads/${id}?msg=erro-valor`);
    const notes = cleanText(body.notes, 2000);
    const now = Date.now();
    const changes = [];
    if (status !== lead.status) changes.push(['status', `${STATUSES[lead.status]} → ${STATUSES[status]}`]);
    if (cents !== lead.value_cents) changes.push(['valor', `${ui.brl(lead.value_cents)} → ${ui.brl(cents)}`]);
    if (notes !== lead.notes) changes.push(['observações', 'atualizadas']);
    run('UPDATE leads SET status = ?, value_cents = ?, notes = ?, updated_ts = ? WHERE id = ?', status, cents, notes, changes.some((c) => c[0] !== 'observações') ? now : lead.updated_ts, id);
    for (const [a, d] of changes) run('INSERT INTO lead_log (lead_id, ts, user_email, action, detail) VALUES (?,?,?,?,?)', id, now, ctx.user.email, a, d);
    return redirect(`/painel/leads/${id}?msg=salvo`);
  }
  if (p === '/painel/investimento') {
    const day = lib.validDay(body.day) ? body.day : null;
    const cents = parseBrl(body.amount);
    if (!day || cents === null || cents === 0 || !PAID_CHANNELS.includes(body.channel)) return redirect('/painel/investimento?msg=' + (cents === null ? 'erro-valor' : 'erro-dados'));
    run('INSERT INTO spend (day, channel, campaign, amount_cents, notes, created_ts, created_by) VALUES (?,?,?,?,?,?,?)', day, body.channel, cleanText(body.campaign, 80).toLowerCase(), cents, cleanText(body.notes, 200), Date.now(), ctx.user.email);
    return redirect('/painel/investimento?msg=adicionado');
  }
  if ((m = p.match(/^\/painel\/investimento\/(\d+)\/excluir$/))) {
    run('DELETE FROM spend WHERE id = ?', Number(m[1]));
    return redirect('/painel/investimento?msg=excluido');
  }
  if (p === '/painel/conta/senha') {
    const e = auth.changeOwnPassword(req, ctx.user, body.current, body.next, body.confirm);
    if (!e) console.log(`[painel] ${ctx.user.email} trocou a própria senha`);
    return redirect('/painel/conta?msg=' + (e || 'senha-alterada'));
  }
  if (p === '/painel/usuarios' || p.startsWith('/painel/usuarios/')) {
    if (!isAdmin) return forbidden();
    if (p === '/painel/usuarios') {
      const e = auth.addUser({ email: body.email, name: body.name, role: body.role, password: body.password });
      if (!e) console.log(`[painel] ${ctx.user.email} criou o usuário ${String(body.email).trim().toLowerCase()} (${body.role})`);
      return redirect('/painel/usuarios?msg=' + (e || 'usuario-criado'));
    }
    if ((m = p.match(/^\/painel\/usuarios\/(\d+)\/senha$/))) {
      const e = auth.resetPasswordById(Number(m[1]), body.password, ctx.user.id);
      if (!e) console.log(`[painel] ${ctx.user.email} redefiniu a senha do usuário #${m[1]}`);
      return redirect('/painel/usuarios?msg=' + (e || 'senha-redefinida'));
    }
    if ((m = p.match(/^\/painel\/usuarios\/(\d+)\/situacao$/))) {
      const active = body.active === '1';
      const e = auth.setActive(Number(m[1]), active, ctx.user.id);
      if (!e) console.log(`[painel] ${ctx.user.email} ${active ? 'reativou' : 'desativou'} o usuário #${m[1]}`);
      return redirect('/painel/usuarios?msg=' + (e || (active ? 'usuario-ativado' : 'usuario-desativado')));
    }
  }
  return out(404, 'Página não encontrada.', {}, '.txt');
}

module.exports = { handle };
