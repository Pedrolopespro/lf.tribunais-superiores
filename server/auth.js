'use strict';
// Autenticação do painel: scrypt, sessões no banco (só o hash do token), CSRF e bloqueio por tentativas.
const crypto = require('node:crypto');
const lib = require('./lib');
const { all, get, run } = require('./db');

const SESSION_TTL = 8 * 3600 * 1000;
const COOKIE = 'lf_auth';
const PRE_COOKIE = 'lf_pre';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${h}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const calc = crypto.scryptSync(pw, salt, 64);
  const exp = Buffer.from(h, 'hex');
  return exp.length === calc.length && crypto.timingSafeEqual(calc, exp);
}
const DUMMY = hashPassword(crypto.randomBytes(8).toString('hex'));

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createUser(email, name, role, password) {
  return run('INSERT INTO users (email, name, role, pass_hash, created_ts) VALUES (?,?,?,?,?)', email.toLowerCase(), name, role, hashPassword(password), Date.now());
}
function setPassword(email, password) {
  const r = run('UPDATE users SET pass_hash = ? WHERE email = ?', hashPassword(password), email.toLowerCase());
  if (r.changes) run('DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)', email.toLowerCase());
  return r.changes > 0;
}

// ---------- gestão de usuários (tela "Usuários" do painel, só administrador) ----------
// Cada função devolve null em caso de sucesso, ou a chave do erro (a tela traduz em mensagem).
const MIN_PASSWORD = 10, MAX_PASSWORD = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordOk = (pw) => typeof pw === 'string' && pw.length >= MIN_PASSWORD && pw.length <= MAX_PASSWORD;

function listUsers() {
  return all('SELECT id, email, name, role, active, created_ts, last_login FROM users ORDER BY active DESC, role ASC, created_ts ASC');
}
function addUser({ email, name, role, password }) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 120) return 'email-invalido';
  if (role !== 'admin' && role !== 'gestor') return 'papel-invalido';
  if (!passwordOk(password)) return 'senha-curta';
  if (get('SELECT id FROM users WHERE email = ?', email)) return 'email-existe';
  const nome = String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || email.split('@')[0];
  createUser(email, nome, role, password);
  return null;
}
// Redefine a senha de OUTRA pessoa (a própria troca em "Minha conta"). Encerra as sessões dela.
function resetPasswordById(id, password, actorId) {
  const u = get('SELECT id, email FROM users WHERE id = ?', id);
  if (!u) return 'nao-encontrado';
  if (u.id === actorId) return 'proprio-senha';
  if (!passwordOk(password)) return 'senha-curta';
  setPassword(u.email, password);
  return null;
}
function setActive(id, active, actorId) {
  const u = get('SELECT id, role, active FROM users WHERE id = ?', id);
  if (!u) return 'nao-encontrado';
  if (!active) {
    if (u.id === actorId) return 'proprio-desativar';
    if (u.role === 'admin' && u.active && get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", u.id).n === 0) return 'ultimo-admin';
  }
  run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id);
  if (!active) run('DELETE FROM auth_sessions WHERE user_id = ?', id);
  return null;
}
// Troca da própria senha: exige a senha atual (com o mesmo bloqueio de tentativas do login) e encerra as outras sessões.
function changeOwnPassword(req, user, current, next, confirm) {
  const ip = lib.clientIp(req);
  if (isLocked(ip, user.email)) return 'bloqueado';
  const row = get('SELECT pass_hash FROM users WHERE id = ?', user.id);
  if (!row || !verifyPassword(String(current || ''), row.pass_hash)) { noteFailure(ip, user.email); return 'senha-atual-errada'; }
  if (String(next || '') !== String(confirm || '')) return 'senhas-diferentes';
  if (!passwordOk(next)) return 'senha-curta';
  run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(next), user.id);
  run('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?', user.id, lib.sha256(lib.parseCookies(req)[COOKIE] || ''));
  clearFailures(ip, user.email);
  return null;
}

// Usuários iniciais por variáveis de ambiente, para hospedagem sem terminal/SSH:
//   LF_ADMIN_EMAIL + LF_ADMIN_PASSWORD   (administrador)
//   LF_GESTOR_EMAIL + LF_GESTOR_PASSWORD (gestor de tráfego)
// Só cria quando o e-mail ainda NÃO existe: nunca troca a senha de quem já existe (isso é com "reset-senha"),
// então depois do primeiro acesso as variáveis de senha podem ser apagadas do painel da hospedagem.
// Nunca escreve a senha em log nem em arquivo. Devolve o que fez, para teste.
function bootstrapFromEnv(env = process.env, log = console.log) {
  const out = [];
  for (const [prefix, role, nome] of [['LF_ADMIN', 'admin', 'Administrador'], ['LF_GESTOR', 'gestor', 'Gestor de tráfego']]) {
    const email = String(env[prefix + '_EMAIL'] || '').trim().toLowerCase();
    if (!email) continue;
    const password = String(env[prefix + '_PASSWORD'] || '');
    let status;
    if (!EMAIL_RE.test(email)) status = 'email-invalido';
    else if (get('SELECT id FROM users WHERE email = ?', email)) status = 'existe';
    else if (!passwordOk(password)) status = 'senha-ausente-ou-curta';
    else { createUser(email, nome, role, password); status = 'criado'; }
    out.push({ email, role, status });
    log(`[painel] ${prefix}: ${email} -> ${status}`);
  }
  return out;
}

function cookieStr(name, value, req, { maxAge, path = '/painel' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Strict'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (lib.isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function startSession(user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  run('INSERT INTO auth_sessions (token_hash, user_id, csrf, created_ts, expires_ts) VALUES (?,?,?,?,?)', lib.sha256(token), user.id, csrf, now, now + SESSION_TTL);
  run('UPDATE users SET last_login = ? WHERE id = ?', now, user.id);
  run('DELETE FROM auth_sessions WHERE expires_ts < ?', now);
  return cookieStr(COOKIE, token, req, { maxAge: Math.floor(SESSION_TTL / 1000) });
}

function getSession(req) {
  const token = lib.parseCookies(req)[COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = get(
    `SELECT s.csrf, s.expires_ts, u.id, u.email, u.name, u.role, u.active FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    lib.sha256(token),
  );
  if (!row || row.expires_ts < Date.now() || !row.active) return null;
  return { csrf: row.csrf, user: { id: row.id, email: row.email, name: row.name, role: row.role } };
}
function endSession(req) {
  const token = lib.parseCookies(req)[COOKIE];
  if (token) run('DELETE FROM auth_sessions WHERE token_hash = ?', lib.sha256(token));
  return cookieStr(COOKIE, '', req, { maxAge: 0 });
}

// CSRF da tela de login (ainda sem sessão): cookie + campo oculto
function preToken(req) {
  const cur = lib.parseCookies(req)[PRE_COOKIE];
  if (cur && /^[a-f0-9]{32}$/.test(cur)) return { token: cur, setCookie: null };
  const token = crypto.randomBytes(16).toString('hex');
  return { token, setCookie: cookieStr(PRE_COOKIE, token, req, { maxAge: 3600 }) };
}
const verifyPre = (req, field) => {
  const c = lib.parseCookies(req)[PRE_COOKIE];
  return !!c && !!field && safeEq(c, field);
};

// bloqueio de força bruta
function attemptKeys(ip, email) { return ['ip:' + lib.sha256(ip), 'em:' + lib.sha256(ip + '|' + String(email).toLowerCase())]; }
function isLocked(ip, email) {
  const since = Date.now() - 15 * 60 * 1000;
  const [kIp, kEm] = attemptKeys(ip, email);
  const nIp = get('SELECT COUNT(*) AS n FROM login_attempts WHERE k = ? AND ts > ?', kIp, since).n;
  const nEm = get('SELECT COUNT(*) AS n FROM login_attempts WHERE k = ? AND ts > ?', kEm, since).n;
  return nIp >= 20 || nEm >= 5;
}
function noteFailure(ip, email) {
  const now = Date.now();
  for (const k of attemptKeys(ip, email)) run('INSERT INTO login_attempts (k, ts) VALUES (?,?)', k, now);
  run('DELETE FROM login_attempts WHERE ts < ?', now - 24 * 3600 * 1000);
}
function clearFailures(ip, email) { run('DELETE FROM login_attempts WHERE k = ?', attemptKeys(ip, email)[1]); }

function login(req, email, password) {
  const ip = lib.clientIp(req);
  email = String(email || '').trim().toLowerCase();
  if (isLocked(ip, email)) return { ok: false, locked: true };
  const user = get('SELECT * FROM users WHERE email = ?', email);
  const good = verifyPassword(String(password || ''), user ? user.pass_hash : DUMMY);
  if (!user || !user.active || !good) { noteFailure(ip, email); return { ok: false }; }
  clearFailures(ip, email);
  return { ok: true, cookie: startSession(user, req) };
}

module.exports = {
  hashPassword, verifyPassword, createUser, setPassword, bootstrapFromEnv, listUsers, addUser, resetPasswordById, setActive, changeOwnPassword, MIN_PASSWORD, getSession, endSession, preToken, verifyPre, login, safeEq, cookieStr,
};
