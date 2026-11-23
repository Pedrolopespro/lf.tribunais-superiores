'use strict';
// Servidor de DEMONSTRAÇÃO: só escuta em 127.0.0.1, usa banco próprio (data/demo) com dados fictícios
// e senhas de teste aleatórias gravadas em data/demo/credenciais-demo.txt. Nunca use em produção.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dir = path.join(__dirname, '..', 'data', 'demo');
fs.mkdirSync(dir, { recursive: true });
process.env.LF_DATA_DIR = dir;
process.env.LF_DB_FILE = 'demo.sqlite';
process.env.LF_CONFIG = path.join(dir, 'site.config.json');
if (!fs.existsSync(process.env.LF_CONFIG)) {
  fs.writeFileSync(process.env.LF_CONFIG, JSON.stringify({
    site: { whatsapp: '', url: 'http://localhost:3100', email: 'contato@exemplo.invalid' },
  }, null, 2));
}

const { start } = require('./index');
const auth = require('./auth');
const { get } = require('./db');

const pw = () => Array.from(crypto.randomBytes(16), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[b % 54]).join('');
if (!get('SELECT id FROM users LIMIT 1')) {
  const a = pw(), g = pw();
  auth.createUser('admin@demo.local', 'Admin (demo)', 'admin', a);
  auth.createUser('gestor@demo.local', 'Gestor (demo)', 'gestor', g);
  fs.writeFileSync(path.join(dir, 'credenciais-demo.txt'), `admin@demo.local\n${a}\ngestor@demo.local\n${g}\n`, { mode: 0o600 });
}
if (!get('SELECT sid FROM visits LIMIT 1')) require('./seed-demo').run();

const port = Number(process.env.PORT) || 3100;
start(port, '127.0.0.1').then(() => {
  console.log(`DEMO  LP:     http://localhost:${port}/`);
  console.log(`DEMO  Painel: http://localhost:${port}/painel   (credenciais em data/demo/credenciais-demo.txt)`);
});
