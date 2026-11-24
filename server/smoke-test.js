'use strict';
// Teste de ponta a ponta com banco temporário. Uso: npm test
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-smoke-'));
process.env.LF_NO_AUTOSTART = '1'; // o teste sobe o servidor sozinho, em porta aleatória
process.env.LF_DATA_DIR = tmp;
process.env.LF_DB_FILE = 'smoke-demo.sqlite';
process.env.LF_SECRET = 'segredo-de-teste';
process.env.LF_TRUST_PROXY = '1'; // como em produção, atrás do proxy da hospedagem
process.env.LF_CONFIG = path.join(tmp, 'site.config.json');
const writeCfg = (extra = {}) => fs.writeFileSync(process.env.LF_CONFIG, JSON.stringify({
  site: { whatsapp: '5500000000000', url: 'https://lp.exemplo.invalid', email: 'contato@teste.invalid', ...extra },
  tracking: { gtm: 'GTM-TESTE01' },
}));
writeCfg();

// banco "de uma versão anterior" (com formulário): a migração precisa renomear, não apagar
{
  const old = new DatabaseSync(path.join(tmp, 'smoke-demo.sqlite'));
  old.exec("CREATE TABLE leads (id INTEGER PRIMARY KEY, name TEXT); CREATE INDEX idx_leads_ts ON leads(id); INSERT INTO leads (name) VALUES ('Antigo');");
  old.exec('CREATE TABLE visits (sid TEXT PRIMARY KEY, form_started INTEGER); CREATE INDEX idx_visits_first ON visits(sid);');
  old.close();
}

const { start } = require('./index');
const auth = require('./auth');
const lib = require('./lib');
const { get, all, db } = require('./db');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; } else { fails++; console.log('  ✗ FALHOU:', msg); } };
const section = (t) => console.log('\n' + t);
const cookieJar = () => {
  const jar = {};
  return {
    set(res) { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } },
    header() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
    jar,
  };
};

(async () => {
  section('Migração de banco antigo');
  const legacy = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_legado\\_%' ESCAPE '\\'").map((r) => r.name);
  ok(legacy.some((n) => n.startsWith('leads_legado_')) && legacy.some((n) => n.startsWith('visits_legado_')), 'tabelas antigas foram renomeadas (não apagadas)');
  ok(all('PRAGMA table_info(leads)').some((c) => c.name === 'tribunal') && all('PRAGMA table_info(visits)').some((c) => c.name === 'wstep'), 'tabelas novas criadas com as colunas do assistente');
  ok(all("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_leads_ts', 'idx_visits_first')").length === 2, 'índices recriados nas tabelas novas');

  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const J = (path_, body, headers = {}) => fetch(base + path_, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain', ...headers } });

  section('LP e páginas públicas');
  let r = await fetch(base + '/');
  let html = await r.text();
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  ok(r.status === 200, 'GET / = 200');
  ok(visible.includes('Seu escritório.') && visible.includes('Representado em Brasília.'), 'título da primeira tela');
  ok(visible.includes('Em qual tribunal você precisa de apoio?'), 'pergunta da primeira tela');
  ok(!html.includes('{{'), 'nenhum placeholder {{ }} sobrando na LP');
  ok(html.includes('"wa":"5500000000000"') && html.includes('GTM-TESTE01'), 'config injetada (WhatsApp e GTM)');
  ok(visible.includes('Falar com nossa equipe') && !/Falar com um advogado|falar com advogado/i.test(visible), 'CTA é "Falar com nossa equipe" (nunca "falar com advogado")');
  ok(!/especialista/i.test(visible), 'LP não usa "especialista" (Provimento 205/2021, art. 3º, III)');
  ok(!/\bR\$\s?\d|grátis|gratuito|desconto|garantid/i.test(visible), 'LP sem preço, gratuidade, desconto ou "garantido"');
  ok(visible.includes('Reconhecimentos do escritório') && (visible.match(/assets\/img\/selo-/g) || []).length === 4, 'quatro selos presentes por padrão');
  ok(visible.includes('Dra. Luana Lima Ferreira') && visible.includes('Fundadora · 17 anos de advocacia'), 'fundadora (sem OAB enquanto pendente)');
  ok(!/OAB\s*\d/.test(visible.split('Dra. Luana')[1] || ''), 'nenhum número de OAB inventado');
  ok(visible.includes('Desde 2014, atuamos') && visible.includes('Do seu escritório.') && visible.includes('Sua próxima demanda em Brasília começa aqui.'), 'textos de história, passos e encerramento');
  ok(/marcas dos tribunais são usadas apenas para identificar/.test(visible), 'aviso de que as marcas só identificam o tribunal');
  // selos desligáveis por configuração
  writeCfg({ mostrarSelos: false }); fs.utimesSync(process.env.LF_CONFIG, new Date(), new Date(Date.now() + 5000));
  const noSeals = (await (await fetch(base + '/')).text());
  ok(!noSeals.includes('selo-ouro') && !noSeals.includes('Reconhecimentos do escritório'), 'site.mostrarSelos=false remove o bloco de selos');
  writeCfg(); fs.utimesSync(process.env.LF_CONFIG, new Date(), new Date(Date.now() + 10000));

  // marcas dos tribunais desligáveis (alternativa caso o STF não autorize o uso do logotipo)
  ok(html.includes('"logos":true'), 'marcas dos tribunais ligadas por padrão');
  writeCfg({ marcasTribunais: false }); fs.utimesSync(process.env.LF_CONFIG, new Date(), new Date(Date.now() + 15000));
  const noLogos = (await (await fetch(base + '/')).text());
  ok(noLogos.includes('"logos":false'), 'site.marcasTribunais=false chega à página (cartões passam a mostrar siglas)');
  writeCfg(); fs.utimesSync(process.env.LF_CONFIG, new Date(), new Date(Date.now() + 20000));
  html = await (await fetch(base + '/')).text();

  // fidelidade da copy do assistente (está no JS)
  r = await fetch(base + '/assets/site.js'); const js = await r.text();
  for (const t of ['Supremo Tribunal Federal', 'Superior Tribunal de Justiça', 'Tribunal Superior do Trabalho', 'Tribunal Superior Eleitoral', 'Superior Tribunal Militar',
    'Recurso extraordinário', 'Recurso especial', 'Recurso de revista', 'Despacho e memoriais', 'Sustentação oral', 'Acompanhamento processual', 'Homologação de decisão estrangeira', 'Outra demanda',
    'Apresentar demanda eleitoral', 'Apresentar demanda militar', 'Tenho um prazo em andamento', 'Tenho um julgamento marcado', 'Não há uma data próxima', 'Prefiro explicar à equipe',
    'Como podemos apoiar seu escritório?', 'Há algum prazo ou julgamento próximo?', 'Vamos conversar sobre sua demanda.', 'Continuar pelo WhatsApp', 'Você será direcionado ao WhatsApp com suas escolhas.',
    'Copiar resumo da demanda', 'Resumo copiado.', 'Olá! Gostaria de apoio para uma demanda.', 'Tribunal: ', 'Apoio: ', 'Prazo: ']) ok(js.includes(t), `copy no assistente: "${t}"`);
  ok(!/Falar com um advogado/i.test(js), 'JS sem "Falar com um advogado"');
  // todo arquivo de imagem referenciado existe
  const imgs = [...new Set([...(html + js).matchAll(/\/assets\/img\/[a-z0-9._-]+\.(?:png|webp|jpg|svg)/gi)].map((m) => m[0]).concat(['stf', 'stj', 'tst', 'stm'].map((c) => `/assets/img/${c}.png`)))];
  for (const u of imgs) { const x = await fetch(base + u); ok(x.status === 200 && /image\//.test(x.headers.get('content-type') || ''), `imagem servida: ${u}`); }
  r = await fetch(base + '/politica-de-privacidade'); html = await r.text();
  ok(r.status === 200 && !html.includes('{{') && !/Falar com um advogado/i.test(html), 'política de privacidade renderiza sem placeholders');
  ok(!/formulário de contato|nome completo|OAB e UF/i.test(html) && /WhatsApp/.test(html), 'política não descreve mais o formulário e explica o WhatsApp');
  r = await fetch(base + '/robots.txt'); ok((await r.text()).includes('Disallow: /painel'), 'robots.txt bloqueia /painel');
  for (const bad of ['/../server/db.js', '/%2e%2e/server/db.js', '/assets/../../package.json', '/.env', '/%00']) {
    r = await fetch(base + bad); ok(r.status === 404 || r.status === 400, `path traversal bloqueado: ${bad} (${r.status})`);
  }
  ok(get('SELECT COUNT(*) AS n FROM hits').n >= 1, 'acesso à LP registrado no servidor (hits)');

  section('API de eventos e assistente');
  const sid = 'a1b2c3d4e5f60718293a4b5c';
  const ctx = { l: '/', r: 'https://www.google.com/', u: { utm_source: 'Google', utm_medium: 'CPC', utm_campaign: 'RESP-STJ', utm_term: 'recurso especial', gclid: 'TESTE123', svc: 'resp' }, c: 0, sw: 390, sh: 844, lg: 'pt-BR', wd: 0 };
  const iphone = { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', Origin: base };
  r = await J('/api/e', { sid, vid: '', ctx, ev: [{ n: 'page_view', a: 900 }, { n: 'section_view', l: 'topo', a: 800 }, { n: 'scroll', l: '50%', v: 50, a: 700 }, { n: 'carousel_ctl', l: 'pause', a: 600 }, { n: 'wizard_court', l: 'stj', a: 500 },
    { n: 'wizard_service', l: 'stj:resp', a: 400 }, { n: 'wizard_deadline', l: 'andamento', a: 300 }, { n: 'wizard_summary', l: 'stj:resp:andamento', a: 200 }, { n: 'engaged', v: 20, a: 100 }, { n: 'form_start', l: 'name', a: 10 }, { n: 'EVENTO_FALSO', a: 0 }] }, iphone);
  ok(r.status === 200, 'POST /api/e = 200');
  let v = get('SELECT * FROM visits WHERE sid = ?', sid);
  ok(v && v.channel === 'Google Ads' && v.campaign === 'resp-stj' && v.source === 'google' && v.svc === 'resp', 'canal e UTMs normalizados; svc validado');
  ok(v && v.device === 'mobile' && v.os === 'iOS', 'dispositivo/OS lidos do User-Agent');
  ok(v && v.court === 'stj' && v.servico === 'resp' && v.prazo === 'andamento' && v.wstep === 4, 'escolhas do assistente gravadas na sessão (etapa 4)');
  ok(v && v.pageviews === 1 && v.max_scroll === 50 && v.engaged_s === 20 && v.sections.includes(',topo,'), 'contadores da sessão corretos');
  ok(v && v.ip_hash && v.ip_hash.length === 16 && !v.ip_hash.includes('127.0.0.1'), 'IP armazenado só como hash');
  ok(get("SELECT COUNT(*) AS n FROM events WHERE sid = ? AND name IN ('EVENTO_FALSO', 'form_start')", sid).n === 0, 'eventos fora da lista branca (inclusive os antigos de formulário) descartados');
  r = await J('/api/e', { sid: 'deadbeefdeadbeefdeadbeef', ctx: { l: '/', r: '', u: {}, c: 0 }, ev: [{ n: 'page_view' }] }, { 'User-Agent': 'Googlebot/2.1', Origin: base });
  ok(get('SELECT is_bot FROM visits WHERE sid = ?', 'deadbeefdeadbeefdeadbeef').is_bot === 1, 'Googlebot marcado como robô');
  r = await J('/api/e', { sid, ctx, ev: [{ n: 'page_view' }] }, { Origin: 'https://evil.example' }); ok(r.status === 403, 'origem cruzada recusada em /api/e');
  r = await J('/api/e', { sid: 'XX', ev: [] }); ok(r.status === 400, 'sid inválido recusado');
  r = await fetch(base + '/api/e', { method: 'POST', body: '{nao-json' }); ok(r.status === 400, 'JSON inválido recusado');
  r = await fetch(base + '/api/e', { method: 'POST', body: 'x'.repeat(40000) }); ok(r.status === 413, 'payload grande recusado (413)');

  section('Conversão: clique final do assistente');
  const lead = { tribunal: 'stj', servico: 'resp', prazo: 'andamento', via: 'whatsapp', sid, vid: '' };
  r = await J('/api/lead', { ...lead, tribunal: 'xxx' }, { Origin: base }); ok(r.status === 422, 'tribunal inválido recusado');
  r = await J('/api/lead', { ...lead, tribunal: 'stf', servico: 'resp' }, { Origin: base }); ok(r.status === 422, 'apoio que não existe naquele tribunal (STF + recurso especial) recusado');
  r = await J('/api/lead', { ...lead, prazo: 'amanha' }, { Origin: base }); ok(r.status === 422, 'prazo inválido recusado');
  r = await J('/api/lead', { ...lead, via: 'telefone' }, { Origin: base }); ok(r.status === 422, 'via inválida recusada');
  ok(get('SELECT COUNT(*) AS n FROM leads').n === 0, 'nada gravado até aqui');
  r = await J('/api/lead', lead, { Origin: base }); let jl = await r.json();
  ok(r.status === 200 && jl.ok && jl.id > 0, 'demanda válida aceita');
  const L = get('SELECT * FROM leads WHERE id = ?', jl.id);
  ok(L.tribunal === 'stj' && L.servico === 'resp' && L.prazo === 'andamento' && L.via === 'whatsapp' && L.status === 'novo' && L.is_bot === 0, 'campos da demanda e status inicial');
  ok(L.channel === 'Google Ads' && L.campaign === 'resp-stj' && L.gclid === 'TESTE123' && L.term === 'recurso especial' && L.svc === 'resp', 'demanda herda a atribuição da sessão (servidor)');
  ok(get('SELECT lead_id FROM visits WHERE sid = ?', sid).lead_id === jl.id, 'sessão ligada à demanda');
  ok(!all('PRAGMA table_info(leads)').some((c) => ['name', 'email', 'phone', 'oab', 'message'].includes(c.name)), 'tabela de demandas não tem campo de dado pessoal');
  r = await J('/api/lead', lead, { Origin: base }); jl = await r.json(); ok(jl.duplicate === true, 'repetição em 10 min é idempotente');
  r = await J('/api/lead', { ...lead, via: 'copia' }, { Origin: base }); ok((await r.json()).duplicate !== true, 'via diferente conta como outra conversão');
  r = await J('/api/lead', { ...lead, sid: 'cccccccccccccccccccccccc' }, { Origin: base });
  ok(get("SELECT is_bot FROM leads WHERE sid = 'cccccccccccccccccccccccc'").is_bot === 1, 'sem sessão conhecida = marcado como robô (fora das métricas)');
  r = await J('/api/lead', lead, { Origin: 'https://evil.example' }); ok(r.status === 403, 'origem cruzada recusada em /api/lead');

  section('Proxy da hospedagem (Host reescrito, HTTPS)');
  const raw = (method, p, headers, body) => new Promise((resolve, reject) => {
    const u = new URL(base);
    const rq = http.request({ host: u.hostname, port: u.port, path: p, method, headers }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d })); });
    rq.on('error', reject); if (body) rq.write(body); rq.end();
  });
  const sid2 = 'b2c3d4e5f6071829a3b4c5d6';
  const evBody = JSON.stringify({ sid: sid2, ctx: { l: '/', r: '', u: {}, c: 0 }, ev: [{ n: 'page_view' }] });
  r = await raw('POST', '/api/e', { Host: 'interno.invalid', Origin: 'https://lp.exemplo.invalid', 'Content-Type': 'text/plain' }, evBody);
  ok(r.status === 200, 'Host reescrito pelo proxy, Origin = domínio de site.url → aceito');
  r = await raw('POST', '/api/e', { Host: 'interno.invalid', Origin: 'https://outro.exemplo.invalid', 'X-Forwarded-Host': 'outro.exemplo.invalid', 'Content-Type': 'text/plain' }, evBody);
  ok(r.status === 200, 'X-Forwarded-Host é aceito quando o proxy é confiável');
  r = await raw('POST', '/api/e', { Host: 'interno.invalid', Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, evBody);
  ok(r.status === 403, 'origem estranha continua recusada mesmo com Host reescrito');
  r = await raw('GET', '/painel/login', { 'X-Forwarded-Proto': 'https' });
  ok((r.headers['set-cookie'] || []).every((c) => /;\s*Secure/.test(c)) && /max-age=31536000/.test(r.headers['strict-transport-security'] || ''), 'LF_TRUST_PROXY=1: cookies Secure e HSTS atrás do proxy HTTPS');
  r = await raw('GET', '/painel/login', {});
  ok(!(r.headers['set-cookie'] || []).some((c) => /;\s*Secure/.test(c)) && !r.headers['strict-transport-security'], 'sem X-Forwarded-Proto https: sem Secure/HSTS (desenvolvimento local)');

  section('Retenção');
  {
    const old = Date.now() - 500 * 86400e3;
    db.exec(`INSERT INTO visits (sid, first_ts, last_ts) VALUES ('0ldsid0ldsid0ldsid0ldsid', ${old}, ${old})`);
    db.exec(`INSERT INTO events (ts, sid, name) VALUES (${old}, '0ldsid0ldsid0ldsid0ldsid', 'page_view')`);
    db.exec(`INSERT INTO hits (ts) VALUES (${old})`);
    db.exec(`INSERT INTO leads (ts, updated_ts, tribunal, servico, prazo, sid, vid, ip_hash, status, value_cents) VALUES (${old}, ${old}, 'stj', 'resp', 'andamento', 'sidvelho', 'vidvelho', 'iphashvelho', 'fechado', 123400)`);
    const res = require('./retention').purge(425);
    const oldLead = get("SELECT * FROM leads WHERE ts = ?", old);
    ok(res.events >= 1 && res.visits >= 1 && res.hits >= 1, 'purge apaga eventos, sessões e acessos antigos');
    ok(oldLead && oldLead.sid === '' && oldLead.vid === '' && oldLead.ip_hash === '' && oldLead.value_cents === 123400 && oldLead.status === 'fechado', 'purge anonimiza a demanda antiga e preserva tribunal, situação e valor');
    ok(get("SELECT COUNT(*) AS n FROM visits WHERE sid = '0ldsid0ldsid0ldsid0ldsid'").n === 0, 'sessão antiga removida');
    db.exec(`DELETE FROM leads WHERE ts = ${old}`);
  }

  section('Painel: acesso e segurança');
  r = await fetch(base + '/painel', { redirect: 'manual' }); ok(r.status === 303 && r.headers.get('location') === '/painel/login', '/painel sem login redireciona');
  r = await fetch(base + '/painel/leads/1', { redirect: 'manual' }); ok(r.status === 303, 'detalhe da demanda exige login');
  r = await fetch(base + '/painel/exportar/leads.csv', { redirect: 'manual' }); ok(r.status === 303, 'exportação exige login');
  auth.createUser('admin@teste.invalid', 'Admin', 'admin', 'SenhaAdmin-Teste-1');
  auth.createUser('gestor@teste.invalid', 'Gestor', 'gestor', 'SenhaGestor-Teste-1');
  {
    section('Usuários iniciais por variáveis de ambiente');
    const logs = [];
    const lg = (m) => logs.push(m);
    const PW = 'Boot-Senha-Teste-9';
    let res = auth.bootstrapFromEnv({ LF_ADMIN_EMAIL: ' Boot.Admin@Teste.invalid ', LF_ADMIN_PASSWORD: PW, LF_GESTOR_EMAIL: 'boot.gestor@teste.invalid', LF_GESTOR_PASSWORD: PW + 'x' }, lg);
    ok(res.length === 2 && res.every((x) => x.status === 'criado'), 'cria admin e gestor a partir das variáveis');
    const bu = get('SELECT * FROM users WHERE email = ?', 'boot.admin@teste.invalid');
    ok(bu && bu.role === 'admin' && auth.verifyPassword(PW, bu.pass_hash), 'e-mail normalizado, papel admin e senha confere');
    ok(get('SELECT role FROM users WHERE email = ?', 'boot.gestor@teste.invalid').role === 'gestor', 'gestor criado com o papel certo');
    ok(!logs.join('\n').includes(PW), 'a senha nunca aparece no log');
    const hashAntes = bu.pass_hash;
    res = auth.bootstrapFromEnv({ LF_ADMIN_EMAIL: 'boot.admin@teste.invalid', LF_ADMIN_PASSWORD: 'Outra-Senha-123' }, lg);
    ok(res[0].status === 'existe' && get('SELECT pass_hash FROM users WHERE email = ?', 'boot.admin@teste.invalid').pass_hash === hashAntes, 'não sobrescreve a senha de usuário que já existe');
    res = auth.bootstrapFromEnv({ LF_ADMIN_EMAIL: 'curta@teste.invalid', LF_ADMIN_PASSWORD: '1234567', LF_GESTOR_EMAIL: 'sem-senha@teste.invalid', LF_ADMIN_EMAIL_X: 'x' }, lg);
    ok(res.map((x) => x.status).join() === 'senha-ausente-ou-curta,senha-ausente-ou-curta' && !get('SELECT id FROM users WHERE email IN (?,?)', 'curta@teste.invalid', 'sem-senha@teste.invalid'), 'senha ausente ou com menos de 8 caracteres: não cria');
    res = auth.bootstrapFromEnv({ LF_ADMIN_EMAIL: 'isso-nao-e-email', LF_ADMIN_PASSWORD: 'Senha-Valida-123' }, lg);
    ok(res[0].status === 'email-invalido', 'e-mail inválido: não cria');
    ok(auth.bootstrapFromEnv({}, lg).length === 0, 'sem variáveis: não faz nada');
    db.exec("DELETE FROM users WHERE email LIKE 'boot.%@teste.invalid'");
  }
  const login = async (email, password) => {
    const jar = cookieJar();
    r = await fetch(base + '/painel/login'); jar.set(r); const m = (await r.text()).match(/name="_csrf" value="([a-f0-9]+)"/);
    ok(!!m, 'tela de login traz token CSRF');
    r = await fetch(base + '/painel/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() }, body: new URLSearchParams({ _csrf: m[1], email, password }) });
    jar.set(r); return { jar, r };
  };
  let a = await login('admin@teste.invalid', 'errada'); ok(a.r.status === 401, 'senha errada = 401');
  r = await fetch(base + '/painel/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: 'x', email: 'a@b.c', password: 'x' }) });
  ok(r.status === 403, 'login sem cookie/CSRF válido = 403');
  for (let i = 0; i < 5; i++) await login('bloqueio@teste.invalid', 'x');
  a = await login('bloqueio@teste.invalid', 'x'); ok(a.r.status === 429, 'bloqueio após 5 falhas seguidas (429)');
  a = await login('admin@teste.invalid', 'SenhaAdmin-Teste-1');
  ok(a.r.status === 303 && a.r.headers.get('location') === '/painel', 'login do admin ok');
  const sc = a.r.headers.getSetCookie().find((c) => c.startsWith('lf_auth=')) || '';
  ok(/HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Path=\/painel/.test(sc), 'cookie de sessão HttpOnly + SameSite=Strict + Path=/painel');
  ok(get('SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash = ?', lib.sha256(a.jar.jar.lf_auth)).n === 1, 'sessão guardada como hash (token não fica no banco)');
  const adminHdr = { Cookie: a.jar.header() };
  r = await fetch(base + '/painel', { headers: adminHdr }); html = await r.text();
  ok(r.status === 200 && html.includes('Visão geral') && html.includes('Demandas'), 'painel abre logado');
  ok(/noindex/.test(r.headers.get('x-robots-tag') || '') && /script-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'painel: noindex + CSP restritiva');
  ok(r.headers.get('cache-control') === 'no-store', 'painel: no-store');
  const csrf = (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
  ok(!!csrf, 'páginas logadas trazem token CSRF');
  const post = (p, fields, hdr = adminHdr) => fetch(base + p, { method: 'POST', redirect: 'manual', headers: { ...hdr, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  r = await post('/painel/investimento', { day: '2026-11-20', channel: 'Google Ads', campaign: 'resp-stj', amount: '100,00' }); ok(r.status === 403, 'POST sem CSRF = 403');
  r = await post('/painel/investimento', { _csrf: csrf, day: '2026-11-20', channel: 'Google Ads', campaign: 'RESP-STJ', amount: '1.234,56', notes: 'teste' });
  ok(r.status === 303 && get('SELECT amount_cents, campaign FROM spend').amount_cents === 123456 && get('SELECT campaign FROM spend').campaign === 'resp-stj', 'investimento registrado (R$ 1.234,56 → centavos, campanha em minúsculas)');
  r = await post('/painel/investimento', { _csrf: csrf, day: 'lixo', channel: 'Google Ads', amount: 'abc' }); ok(r.status === 303 && /erro/.test(r.headers.get('location')), 'investimento inválido rejeitado');
  r = await post(`/painel/leads/${jl.id}`, { _csrf: csrf, status: 'fechado', value: '5.000,00', notes: 'Fechou <script>alert(1)</script>' });
  const L2 = get('SELECT * FROM leads WHERE id = ?', jl.id);
  ok(r.status === 303 && L2.status === 'fechado' && L2.value_cents === 500000, 'demanda atualizada (situação + valor)');
  ok(get('SELECT COUNT(*) AS n FROM lead_log WHERE lead_id = ? AND user_email = ?', jl.id, 'admin@teste.invalid').n >= 2, 'histórico registra quem alterou');
  r = await fetch(base + `/painel/leads/${jl.id}`, { headers: adminHdr }); html = await r.text();
  ok(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'), 'XSS em observações escapado');
  ok(html.includes('Superior Tribunal de Justiça (STJ)') && html.includes('Recurso especial') && html.includes('Prazo em andamento') && html.includes('Jornada até a demanda'), 'detalhe mostra tribunal, apoio, prazo e jornada');
  ok(/wizard_court/.test(html) && /wizard_summary/.test(html), 'jornada da sessão mostra os passos do assistente');
  r = await fetch(base + '/painel/exportar/google-ads-offline.csv', { headers: adminHdr }); const off = await r.text();
  ok(off.includes('TESTE123') && off.includes('Contrato fechado') && off.includes('5000.00') && off.startsWith('Parameters:TimeZone=-0300'), 'CSV de conversões offline do Google Ads');
  r = await fetch(base + '/painel/exportar/leads.csv?p=30d', { headers: adminHdr }); const csvA = await r.text();
  ok(csvA.includes('resp-stj') && csvA.includes('STJ') && !/@/.test(csvA), 'CSV de demandas com atribuição e sem dado pessoal');

  section('Painel: perfil gestor');
  const g = await login('gestor@teste.invalid', 'SenhaGestor-Teste-1'); ok(g.r.status === 303, 'login do gestor ok');
  const gh = { Cookie: g.jar.header() };
  r = await fetch(base + '/painel/leads', { headers: gh }); ok(r.status === 200, 'gestor acessa as demandas');
  r = await fetch(base + '/painel/exportar/sessoes.csv?p=30d', { headers: gh }); ok(r.status === 200 && (await r.text()).includes('tribunal'), 'gestor exporta sessões');

  section('Painel: todas as páginas com dados de demonstração');
  require('./seed-demo').run();
  const pages = ['/painel', '/painel/aquisicao', '/painel/comportamento', '/painel/leads', '/painel/leads?status=qualificado&q=stj', '/painel/tempo-real', '/painel/investimento', '/painel/qualidade', '/painel/utm',
    '/painel?p=30d', '/painel?p=hoje', '/painel?p=ontem', '/painel?p=90d&canal=Google+Ads', '/painel?p=custom&from=2026-11-01&to=2026-11-15', '/painel?p=custom&from=lixo&to=lixo&canal=Inexistente&bots=1',
    '/painel/comportamento?p=30d', '/painel/aquisicao?p=30d', '/painel/qualidade?p=30d', '/painel/leads?page=2&p=30d',
    '/painel/exportar/leads.csv?p=30d', '/painel/exportar/sessoes.csv?p=30d'];
  const bad = /undefined|NaN|\[object Object\]/;
  for (const pg of pages) {
    r = await fetch(base + pg, { headers: adminHdr }); const t = await r.text();
    ok(r.status === 200 && !bad.test(t.replace(/<script[\s\S]*?<\/script>/g, '')), `${pg} → ${r.status}${bad.test(t) ? ' (contém undefined/NaN/[object Object])' : ''}`);
  }
  r = await fetch(base + '/painel/leads/999999', { headers: adminHdr }); ok(r.status === 404, 'demanda inexistente = 404');
  r = await fetch(base + '/painel?p=30d', { headers: adminHdr }); html = await r.text();
  ok(/Sessões por dia/.test(html) && /<svg class="chart"/.test(html) && /Escolheram o tribunal/.test(html) && /Chegaram ao resumo/.test(html), 'visão geral traz gráficos e o funil do assistente');
  r = await fetch(base + '/painel/comportamento?p=30d', { headers: adminHdr }); html = await r.text();
  ok(/Tribunal escolhido/.test(html) && /Apoio escolhido/.test(html) && /Prazo informado/.test(html) && /Carrossel de tribunais/.test(html), 'comportamento mostra escolhas do assistente');
  r = await fetch(base + '/painel/utm', { headers: adminHdr }); html = await r.text();
  ok(/name="tribunal"/.test(html) && /Recurso especial \(STJ\)/.test(html), 'gerador de UTM oferece svc e tribunal');
  const sess30 = get('SELECT COUNT(*) AS n FROM visits WHERE is_bot = 0').n;
  ok(sess30 > 300, `dados demo carregados (${sess30} sessões)`);
  r = await fetch(base + '/painel/sair', { method: 'POST', redirect: 'manual', headers: { ...adminHdr, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf }) });
  ok(r.status === 303, 'logout');
  r = await fetch(base + '/painel', { redirect: 'manual', headers: adminHdr }); ok(r.status === 303, 'sessão encerrada no servidor após logout');

  server.close(); db.close();
  console.log(`\n${fails ? '✗' : '✓'} ${passes} verificações ok, ${fails} falhas`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignora */ }
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE:', e); process.exit(2); });
