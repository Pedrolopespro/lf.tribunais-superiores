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
  // tabela de usuários de antes da tela "Usuários" (sem a coluna active)
  old.exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'gestor', pass_hash TEXT NOT NULL, created_ts INTEGER NOT NULL, last_login INTEGER); INSERT INTO users (email, pass_hash, created_ts) VALUES ('antigo@teste.invalid', 'x', 1);");
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
  ok(all('PRAGMA table_info(users)').some((c) => c.name === 'active') && get('SELECT active FROM users WHERE email = ?', 'antigo@teste.invalid').active === 1, 'banco antigo ganha a coluna active (usuários existentes ficam ativos)');

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
  // WhatsApp: botão flutuante só com o ícone (verde do WhatsApp) e botão final do assistente em verde com o ícone
  const floatA = (html.match(/<a class="wa-float"[\s\S]*?<\/a>/) || [''])[0];
  ok(floatA.includes('<svg') && !/<span/.test(floatA) && !/>\s*Falar com nossa equipe\s*</.test(floatA) && /aria-label="Falar com nossa equipe/.test(floatA), 'botão flutuante é só o ícone do WhatsApp (com nome acessível, sem texto visível)');
  r = await fetch(base + '/assets/site.css'); const css = await r.text();
  ok(/--wa:\s*#25D366/i.test(css) && /\.wa-float\s*\{[^}]*background:\s*var\(--wa\)/.test(css) && /\.btn--wa\s*\{[^}]*background:\s*var\(--wa\)/.test(css), 'WhatsApp em verde oficial (#25D366), não dourado');
  ok(js.includes('btn btn--wa wiz__go') && js.includes('ic-wa'), 'botão final do assistente é o botão verde do WhatsApp, com ícone');
  const exCfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.config.example.json'), 'utf8'));
  ok(exCfg.site.whatsapp === '5561998344706', 'número do WhatsApp do escritório está na configuração padrão (vale em produção sem arquivo de config)');
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

  section('Avaliações do Google (Places simulado)');
  {
    const av = require('./avaliacoes');
    const realFetch = global.fetch;
    const gCalls = [];
    let gMode = 'ok';
    const sample = [
      { authorAttribution: { displayName: 'Maria Teste', uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/x' }, rating: 5, relativePublishTimeDescription: 'há 2 semanas', text: { text: 'Translated text', languageCode: 'pt' }, originalText: { text: 'Texto original <b>com html</b>\nsegunda linha', languageCode: 'pt' }, googleMapsUri: 'https://www.google.com/maps/reviews/1' },
      { authorAttribution: { displayName: 'João Teste', uri: 'javascript:alert(1)' }, rating: 4, relativePublishTimeDescription: 'há 1 mês', text: { text: 'Só o texto traduzido', languageCode: 'pt' }, googleMapsUri: 'http://inseguro.invalid/x' },
      { authorAttribution: { displayName: 'Sem Texto' }, rating: 5, relativePublishTimeDescription: 'há 3 meses' }, // só nota: não entra
      ...Array.from({ length: 6 }, (_, i) => ({ authorAttribution: { displayName: 'Extra ' + i }, rating: 5, text: { text: 'Avaliação extra ' + i } })),
    ];
    global.fetch = async (url, opts) => {
      if (!String(url).startsWith('https://places.googleapis.com/')) return realFetch(url, opts);
      gCalls.push({ url: String(url), headers: opts.headers });
      await new Promise((res) => setTimeout(res, 60)); // dá tempo de chamadas simultâneas se encontrarem
      if (gMode === 'erro') return new Response('{"error":"x"}', { status: 500 });
      return new Response(JSON.stringify({ reviews: sample, googleMapsUri: 'https://maps.google.com/?cid=1', rating: 4.86, userRatingCount: 38 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    // por padrão estes testes desligam o widget do Featurable (que tem prioridade) para exercitar a Places API
    const cfgFile = (av_ = {}) => fs.writeFileSync(process.env.LF_CONFIG, JSON.stringify({ site: { whatsapp: '5500000000000', url: 'https://lp.exemplo.invalid', email: 'contato@teste.invalid' }, tracking: { gtm: 'GTM-TESTE01' }, avaliacoes: { featurableId: '', ...av_ } }));
    const get1 = async () => (await fetch(base + '/api/avaliacoes')).json();
    const KEY = 'chave-falsa-de-teste-123';

    // desligado por padrão: sem chave nem place_id, nada é consultado e a seção continua escondida
    let j = await get1();
    r = await fetch(base + '/'); html = await r.text();
    ok(j.ok === true && j.reviews.length === 0 && gCalls.length === 0, 'sem chave/place_id: nenhuma consulta ao Google');
    ok(/"rev":\{"on":1,"fid":"d1cd5b36-6709-496f-b738-ece59dc064f9","link":""\}/.test(html) && /<section class="sec sec--rev" id="avaliacoes"[^>]*\bhidden\b/.test(html), 'padrão: widget gratuito do Featurable ligado (a seção nasce escondida e o site.js mostra)');
    ok(js.includes("'https://featurable.com/assets/bundle.js'") && js.includes("'data-featurable-async'") && js.includes("'featurable-' + fid"), 'site.js carrega o script do Featurable com o id do widget');
    ok(/getElementById\('featurable-structured-data'\)[^;]*;\s*if \(x\) x\.remove\(\)/.test(js), 'site.js remove a nota agregada (dados estruturados) que o widget injeta');
    cfgFile({}); r = await fetch(base + '/'); html = await r.text(); ok(/"rev":0/.test(html), 'sem Featurable e sem Places: rev:0 (seção não aparece)');
    cfgFile({ featurableId: 'x"><script>alert(1)</script>' }); r = await fetch(base + '/'); html = await r.text(); ok(/"rev":0/.test(html) && !html.includes('<script>alert(1)'), 'id do Featurable inválido é ignorado');
    cfgFile({ featurableId: 'd1cd5b36-6709-496f-b738-ece59dc064f9', ativar: false }); r = await fetch(base + '/'); html = await r.text(); ok(/"rev":0/.test(html), 'ativar:false desliga também o Featurable');
    r = await fetch(base + '/api/avaliacoes', { method: 'POST' }); ok(r.status === 405, '/api/avaliacoes só aceita GET');

    // ligado: chave por variável de ambiente + place_id
    process.env.LF_GOOGLE_PLACES_KEY = KEY;
    cfgFile({ placeId: 'ChIJteste_place-id-1234', linkPerfil: 'https://g.page/r/teste/review' });
    j = await get1();
    ok(j.ok === true && j.reviews.length === 5 && !j.reviews.some((x) => x.autor === 'Sem Texto'), `devolve no máximo 5 e só avaliações com texto (${sample.length} recebidas, uma só com nota)`);
    ok(j.reviews[0].texto === 'Texto original <b>com html</b>\nsegunda linha' && j.reviews[0].nota === 5, 'usa o texto ORIGINAL do autor, sem editar (HTML segue como texto; o site usa textContent)');
    ok(j.reviews[1].autorUrl === '' && j.reviews[1].url === '' && j.reviews[1].texto === 'Só o texto traduzido', 'links que não são https são descartados (javascript:, http:)');
    ok(j.reviews[0].autorUrl === 'https://www.google.com/maps/contrib/1' && j.reviews[0].autor === 'Maria Teste', 'autor e link do autor vão junto (exigência do Google)');
    ok(j.perfil === 'https://g.page/r/teste/review' && !('nota' in j), 'link do perfil vem da config; nota média desligada por padrão');
    const c0 = gCalls[gCalls.length - 1];
    ok(c0.url.includes('/v1/places/ChIJteste_place-id-1234') && c0.headers['X-Goog-Api-Key'] === KEY && c0.headers['X-Goog-FieldMask'] === 'reviews,googleMapsUri', 'consulta o Places (New) com a chave no cabeçalho e só os campos necessários');
    ok(!JSON.stringify(j).includes(KEY), 'a chave nunca aparece na resposta');
    r = await fetch(base + '/'); html = await r.text();
    ok(/"rev":\{"on":1,"link":"https:\/\/g\.page\/r\/teste\/review"\}/.test(html) && !html.includes(KEY), 'LP: seção liga (rev.on=1) e a chave não vai para o navegador');
    ok(!/innerHTML/.test(js.slice(js.indexOf('function reviews()'), js.indexOf('function reviews()') + 6500)), 'carrossel monta o texto das avaliações sem innerHTML');

    // sem cache (regra do Google): duas consultas seguidas = duas chamadas; simultâneas dividem uma
    av._used.n = 0;
    let n0 = gCalls.length; await get1(); await get1(); ok(gCalls.length - n0 === 2, 'sem cache: cada consulta vai ao Google');
    n0 = gCalls.length; await Promise.all([get1(), get1(), get1()]); ok(gCalls.length - n0 === 1, 'consultas simultâneas dividem a mesma chamada');

    // falha do Google: a LP não quebra
    gMode = 'erro'; j = await get1(); ok(j.ok === false && j.reviews.length === 0, 'erro do Google: resposta vazia, sem quebrar'); gMode = 'ok';

    // nota média só quando a cliente liga
    cfgFile({ placeId: 'ChIJteste_place-id-1234', mostrarNota: true });
    j = await get1();
    ok(j.nota && j.nota.media === 4.9 && j.nota.total === 38 && gCalls[gCalls.length - 1].headers['X-Goog-FieldMask'] === 'reviews,googleMapsUri,rating,userRatingCount', 'mostrarNota=true traz a nota média (e pede esses campos)');

    // teto diário protege o custo
    cfgFile({ placeId: 'ChIJteste_place-id-1234', maxPorDia: 2 });
    av._used.n = 0; n0 = gCalls.length;
    await get1(); await get1(); j = await get1();
    ok(gCalls.length - n0 === 2 && j.ok === false && j.limite === true && j.reviews.length === 0, 'teto diário: depois de 2 consultas não chama mais o Google');

    // place_id inválido ou ativar:false desligam
    cfgFile({ placeId: '../etc/passwd' }); n0 = gCalls.length; j = await get1(); ok(j.reviews.length === 0 && gCalls.length === n0, 'place_id inválido não gera consulta');
    cfgFile({ placeId: 'ChIJteste_place-id-1234', ativar: false }); j = await get1(); ok(j.reviews.length === 0 && gCalls.length === n0, 'ativar:false desliga a integração');

    // limite por IP
    let got429 = false; for (let i = 0; i < 40 && !got429; i++) got429 = (await fetch(base + '/api/avaliacoes')).status === 429;
    ok(got429, 'limite por IP (429) na rota de avaliações');

    delete process.env.LF_GOOGLE_PLACES_KEY; global.fetch = realFetch; writeCfg();
  }

  section('Painel: acesso e segurança');
  r = await fetch(base + '/painel', { redirect: 'manual' }); ok(r.status === 303 && r.headers.get('location') === '/painel/login', '/painel sem login redireciona');
  r = await fetch(base + '/painel/leads/1', { redirect: 'manual' }); ok(r.status === 303, 'detalhe da demanda exige login');
  r = await fetch(base + '/painel/exportar/leads.csv', { redirect: 'manual' }); ok(r.status === 303, 'exportação exige login');
  r = await fetch(base + '/painel/login'); html = await r.text();
  ok(/<script src="\/painel\/assets\/panel\.js" defer><\/script>/.test(html) && /script-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'tela de login carrega o script do painel (CSP só permite o próprio site)');
  r = await fetch(base + '/painel/assets/panel.js'); const pjs = await r.text();
  ok(r.status === 200 && pjs.includes('pw__btn') && pjs.includes('Mostrar'), 'script do painel (com o botão Mostrar/Ocultar senha) abre sem login');
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

  section('Painel: usuários e minha conta');
  const msgOf = (res) => (res.headers.get('location') || '').split('msg=')[1] || '';
  const csrfOf = async (hdr, p = '/painel') => ((await (await fetch(base + p, { headers: hdr })).text()).match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
  const alive = async (hdr) => (await fetch(base + '/painel', { redirect: 'manual', headers: hdr })).status === 200;
  const bad2 = /undefined|NaN|\[object Object\]/;
  r = await fetch(base + '/painel/usuarios', { headers: adminHdr }); html = await r.text();
  ok(r.status === 200 && html.includes('Novo usuário') && html.includes('admin@teste.invalid') && html.includes('antigo@teste.invalid') && !bad2.test(html), 'administrador vê a tela de usuários');
  ok(html.includes('href="/painel/usuarios"') && html.includes('href="/painel/conta"'), 'menu: "Usuários" e "Minha conta" para administrador');
  r = await fetch(base + '/painel/usuarios', { headers: gh }); ok(r.status === 403, 'gestor não acessa a tela de usuários (403)');
  r = await fetch(base + '/painel', { headers: gh }); html = await r.text();
  ok(!html.includes('href="/painel/usuarios"') && html.includes('href="/painel/conta"'), 'menu do gestor: sem "Usuários", com "Minha conta"');
  const gcsrf = (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
  r = await post('/painel/usuarios', { _csrf: gcsrf, email: 'invasor@teste.invalid', role: 'admin', password: 'Senha-Invasor-123' }, gh);
  ok(r.status === 403 && !get('SELECT id FROM users WHERE email = ?', 'invasor@teste.invalid'), 'gestor não consegue criar usuário (403)');
  r = await post('/painel/usuarios', { email: 'semcsrf@teste.invalid', role: 'gestor', password: 'Senha-Semcsrf-123' }); ok(r.status === 403 && !get('SELECT id FROM users WHERE email = ?', 'semcsrf@teste.invalid'), 'criar usuário sem CSRF = 403');

  const MARIA = 'Senha-Maria-Longa-1';
  r = await post('/painel/usuarios', { _csrf: csrf, name: 'Maria Teste', email: ' Maria@Teste.invalid ', role: 'gestor', password: MARIA });
  const maria = get('SELECT * FROM users WHERE email = ?', 'maria@teste.invalid');
  ok(r.status === 303 && msgOf(r) === 'usuario-criado' && maria && maria.role === 'gestor' && maria.active === 1 && maria.name === 'Maria Teste', 'administrador cria usuário (e-mail normalizado)');
  ok(maria && !maria.pass_hash.includes(MARIA) && auth.verifyPassword(MARIA, maria.pass_hash), 'senha do novo usuário guardada só como hash');
  r = await post('/painel/usuarios', { _csrf: csrf, email: 'maria@teste.invalid', role: 'gestor', password: MARIA }); ok(msgOf(r) === 'email-existe', 'e-mail repetido é recusado');
  r = await post('/painel/usuarios', { _csrf: csrf, email: 'curta@teste.invalid', role: 'gestor', password: 'curta123' }); ok(msgOf(r) === 'senha-curta' && !get('SELECT id FROM users WHERE email = ?', 'curta@teste.invalid'), 'senha com menos de 10 caracteres é recusada');
  r = await post('/painel/usuarios', { _csrf: csrf, email: 'isso-nao-e-email', role: 'gestor', password: MARIA }); ok(msgOf(r) === 'email-invalido', 'e-mail inválido é recusado');
  r = await post('/painel/usuarios', { _csrf: csrf, email: 'root@teste.invalid', role: 'root', password: MARIA }); ok(msgOf(r) === 'papel-invalido' && !get('SELECT id FROM users WHERE email = ?', 'root@teste.invalid'), 'perfil inventado é recusado');
  r = await fetch(base + '/painel/usuarios?msg=email-existe', { headers: adminHdr }); html = await r.text();
  ok(/class="flash flash--err"/.test(html) && html.includes('Já existe um usuário'), 'erro aparece em vermelho');
  r = await fetch(base + '/painel/usuarios?msg=__proto__', { headers: adminHdr }); html = await r.text(); ok(r.status === 200 && !/class="flash/.test(html), 'msg desconhecida não quebra nem aparece');

  let m1 = await login('maria@teste.invalid', MARIA); ok(m1.r.status === 303, 'novo usuário consegue entrar');
  const mh = { Cookie: m1.jar.header() };
  r = await fetch(base + '/painel/usuarios', { headers: mh }); ok(r.status === 403, 'novo gestor não vê a tela de usuários');
  const m2 = await login('maria@teste.invalid', MARIA); const mh2 = { Cookie: m2.jar.header() };
  const mcsrf = await csrfOf(mh);
  r = await post('/painel/conta/senha', { _csrf: mcsrf, current: 'errada-errada', next: 'Nova-Senha-Maria-2', confirm: 'Nova-Senha-Maria-2' }, mh); ok(msgOf(r) === 'senha-atual-errada', 'trocar a própria senha exige a senha atual');
  r = await post('/painel/conta/senha', { _csrf: mcsrf, current: MARIA, next: 'Nova-Senha-Maria-2', confirm: 'diferente-diferente' }, mh); ok(msgOf(r) === 'senhas-diferentes', 'confirmação da nova senha precisa conferir');
  r = await post('/painel/conta/senha', { _csrf: mcsrf, current: MARIA, next: 'curta', confirm: 'curta' }, mh); ok(msgOf(r) === 'senha-curta', 'nova senha curta é recusada');
  r = await post('/painel/conta/senha', { _csrf: mcsrf, current: MARIA, next: 'Nova-Senha-Maria-2', confirm: 'Nova-Senha-Maria-2' }, mh);
  ok(msgOf(r) === 'senha-alterada' && (await alive(mh)) && !(await alive(mh2)), 'troca de senha: sessão atual segue ativa e as outras são encerradas');
  m1 = await login('maria@teste.invalid', MARIA); ok(m1.r.status === 401, 'a senha antiga deixa de valer');
  m1 = await login('maria@teste.invalid', 'Nova-Senha-Maria-2'); ok(m1.r.status === 303, 'a senha nova vale');

  const mhNow = { Cookie: m1.jar.header() };
  r = await post(`/painel/usuarios/${maria.id}/senha`, { _csrf: csrf, password: 'Redefinida-Pelo-Admin-3' }); ok(msgOf(r) === 'senha-redefinida', 'administrador redefine a senha de outro usuário');
  ok(!(await alive(mhNow)), 'redefinir a senha encerra as sessões da pessoa');
  m1 = await login('maria@teste.invalid', 'Nova-Senha-Maria-2'); ok(m1.r.status === 401, 'senha anterior deixa de valer após a redefinição');
  m1 = await login('maria@teste.invalid', 'Redefinida-Pelo-Admin-3'); ok(m1.r.status === 303, 'senha redefinida vale');
  r = await post(`/painel/usuarios/${maria.id}/senha`, { _csrf: csrf, password: 'curta' }); ok(msgOf(r) === 'senha-curta', 'redefinição com senha curta é recusada');
  const adminRow = get('SELECT id FROM users WHERE email = ?', 'admin@teste.invalid');
  r = await post(`/painel/usuarios/${adminRow.id}/senha`, { _csrf: csrf, password: 'Outra-Senha-Do-Admin-4' }); ok(msgOf(r) === 'proprio-senha' && auth.verifyPassword('SenhaAdmin-Teste-1', get('SELECT pass_hash FROM users WHERE id = ?', adminRow.id).pass_hash), 'administrador não redefine a própria senha por essa tela');
  r = await post(`/painel/usuarios/${maria.id}/senha`, { _csrf: gcsrf, password: 'Redefinida-Pelo-Gestor-5' }, gh); ok(r.status === 403, 'gestor não redefine senha de ninguém');

  const mhLive = { Cookie: m1.jar.header() }; ok(await alive(mhLive), 'sessão da Maria está ativa antes de desativar');
  r = await post(`/painel/usuarios/${maria.id}/situacao`, { _csrf: csrf, active: '0' });
  ok(msgOf(r) === 'usuario-desativado' && get('SELECT active FROM users WHERE id = ?', maria.id).active === 0, 'administrador desativa um usuário');
  ok(!(await alive(mhLive)), 'desativar derruba a sessão na hora');
  m1 = await login('maria@teste.invalid', 'Redefinida-Pelo-Admin-3'); ok(m1.r.status === 401, 'usuário desativado não consegue entrar (senha certa)');
  r = await fetch(base + '/painel/usuarios', { headers: adminHdr }); html = await r.text(); ok(html.includes('Desativado') && html.includes('Reativar'), 'lista mostra o usuário como desativado');
  r = await post(`/painel/usuarios/${maria.id}/situacao`, { _csrf: csrf, active: '1' });
  const reativou = msgOf(r); // login() reaproveita a variável r, então lemos a mensagem antes
  m1 = await login('maria@teste.invalid', 'Redefinida-Pelo-Admin-3'); ok(reativou === 'usuario-ativado' && m1.r.status === 303, 'reativar devolve o acesso');
  r = await post(`/painel/usuarios/${adminRow.id}/situacao`, { _csrf: csrf, active: '0' }); ok(msgOf(r) === 'proprio-desativar' && get('SELECT active FROM users WHERE id = ?', adminRow.id).active === 1, 'ninguém desativa o próprio usuário');
  ok(auth.setActive(adminRow.id, false, 999999) === 'ultimo-admin' && get('SELECT active FROM users WHERE id = ?', adminRow.id).active === 1, 'o último administrador ativo não pode ser desativado');
  r = await post('/painel/usuarios/999999/situacao', { _csrf: csrf, active: '0' }); ok(msgOf(r) === 'nao-encontrado', 'usuário inexistente = erro amigável');
  r = await fetch(base + '/painel/conta', { headers: adminHdr }); html = await r.text(); ok(r.status === 200 && html.includes('Trocar senha') && html.includes('admin@teste.invalid') && !bad2.test(html), 'tela "Minha conta" abre');
  db.exec("DELETE FROM users WHERE email IN ('maria@teste.invalid')");

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
