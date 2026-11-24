'use strict';
// Banco SQLite embutido no Node (node:sqlite, sem dependências externas).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { DATA_DIR } = require('./lib');

const db = new DatabaseSync(path.join(DATA_DIR, process.env.LF_DB_FILE || 'lf.sqlite'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

// ---------- migração (bancos de versões anteriores) ----------
// Esta versão trocou o formulário por um assistente: as tabelas visits e leads mudaram. Nada disso estava em produção;
// por segurança, as tabelas antigas são RENOMEADAS (não apagadas) e as novas nascem vazias logo abaixo.
for (const [table, marker, indexes] of [
  ['leads', 'name', ['idx_leads_ts', 'idx_leads_status']],
  ['visits', 'form_started', ['idx_visits_first', 'idx_visits_last', 'idx_visits_channel']],
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (cols.includes(marker)) {
    for (const ix of indexes) db.exec(`DROP INDEX IF EXISTS ${ix}`);
    db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legado_${Date.now()}`);
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS visits (
  sid TEXT PRIMARY KEY,
  vid TEXT NOT NULL DEFAULT '',
  first_ts INTEGER NOT NULL,
  last_ts INTEGER NOT NULL,
  landing TEXT NOT NULL DEFAULT '',
  ref_url TEXT NOT NULL DEFAULT '',
  ref_host TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  gclid TEXT NOT NULL DEFAULT '',
  fbclid TEXT NOT NULL DEFAULT '',
  svc TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'Direto',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  screen_w INTEGER NOT NULL DEFAULT 0,
  screen_h INTEGER NOT NULL DEFAULT 0,
  consent INTEGER NOT NULL DEFAULT 0,      -- 1 aceitou, -1 recusou, 0 sem decisão
  is_bot INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT '',
  pageviews INTEGER NOT NULL DEFAULT 0,
  max_scroll INTEGER NOT NULL DEFAULT 0,
  engaged_s INTEGER NOT NULL DEFAULT 0,
  cta_clicks INTEGER NOT NULL DEFAULT 0,
  wa_clicks INTEGER NOT NULL DEFAULT 0,
  court TEXT NOT NULL DEFAULT '',          -- tribunal escolhido no assistente (stf, stj, tst, tse, stm)
  servico TEXT NOT NULL DEFAULT '',        -- apoio escolhido (re, resp, rr, despacho, ...)
  prazo TEXT NOT NULL DEFAULT '',          -- prazo informado (andamento, julgamento, sem-data, explicar)
  wstep INTEGER NOT NULL DEFAULT 0,        -- etapa mais avançada: 1 tribunal, 2 apoio, 3 prazo, 4 resumo
  lead_id INTEGER,
  lcp_ms INTEGER,
  cls REAL,
  js_errors INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  sections TEXT NOT NULL DEFAULT ','
);
CREATE INDEX IF NOT EXISTS idx_visits_first ON visits(first_ts);
CREATE INDEX IF NOT EXISTS idx_visits_last ON visits(last_ts);
CREATE INDEX IF NOT EXISTS idx_visits_channel ON visits(channel, first_ts);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  sid TEXT NOT NULL,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value REAL,
  path TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid, ts);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, ts);

-- acessos vistos pelo servidor (não dependem de JavaScript): medem a perda de rastreamento do cliente
CREATE TABLE IF NOT EXISTS hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  gclid INTEGER NOT NULL DEFAULT 0,
  fbclid INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hits_ts ON hits(ts);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  tribunal TEXT NOT NULL DEFAULT '',
  servico TEXT NOT NULL DEFAULT '',
  prazo TEXT NOT NULL DEFAULT '',
  via TEXT NOT NULL DEFAULT 'whatsapp',    -- whatsapp | copia
  sid TEXT NOT NULL DEFAULT '',
  vid TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'Direto',
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT '',
  gclid TEXT NOT NULL DEFAULT '',
  fbclid TEXT NOT NULL DEFAULT '',
  svc TEXT NOT NULL DEFAULT '',
  landing TEXT NOT NULL DEFAULT '',
  ref_host TEXT NOT NULL DEFAULT '',
  first_touch TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'novo',
  value_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  is_bot INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leads_ts ON leads(ts);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS lead_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_leadlog ON lead_log(lead_id, ts);

CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_ts INTEGER NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_spend_day ON spend(day);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'gestor',      -- admin | gestor
  pass_hash TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  last_login INTEGER,
  active INTEGER NOT NULL DEFAULT 1         -- 0 = desativado (não entra, sessões encerradas)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_ts INTEGER NOT NULL,
  expires_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  k TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(k, ts);
`);

// bancos criados antes da tela de usuários não têm a coluna "active"
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'active')) {
  db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
}

// ---------- helpers ----------
const cache = new Map();
const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const all = (sql, ...p) => stmt(sql).all(...p);
const get = (sql, ...p) => stmt(sql).get(...p);
const run = (sql, ...p) => { const r = stmt(sql).run(...p); return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }; };
const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

module.exports = { db, all, get, run, tx };
