'use strict';
// Uso:
//   node server/cli.js init [email-admin] [email-gestor]   cria config, usuários e grava as senhas em data/ (nunca imprime a senha)
//   node server/cli.js reset-senha <email>                 gera nova senha e grava em data/
//   node server/cli.js purge [dias]                        apaga dados de navegação e anonimiza demandas antigas (padrão 425 dias)
//   node server/cli.js seed-demo                           dados fictícios p/ testar o painel (exige LF_DB_FILE com "demo")
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lib = require('./lib');

const cmd = process.argv[2];
const args = process.argv.slice(3);

function newPassword() {
  // 18 caracteres, sem símbolos ambíguos
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(18), (b) => alphabet[b % alphabet.length]).join('');
}
function writeCred(file, lines) {
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
}

if (cmd === 'init') {
  const cfgFile = path.join(lib.ROOT, 'config', 'site.config.json');
  if (!fs.existsSync(cfgFile)) {
    fs.copyFileSync(path.join(lib.ROOT, 'config', 'site.config.example.json'), cfgFile);
    console.log('Criado config/site.config.json (preencha WhatsApp, IDs de tags, endereço etc.).');
  }
  lib.getSecret();
  const auth = require('./auth');
  const { get } = require('./db');
  const adminEmail = (args[0] || 'admin@lf.local').toLowerCase();
  const gestorEmail = (args[1] || 'gestor@lf.local').toLowerCase();
  const out = ['CREDENCIAIS INICIAIS DO PAINEL (/painel) — troque com "npm run reset-senha" e apague este arquivo depois de guardar as senhas.', ''];
  for (const [email, role, nome] of [[adminEmail, 'admin', 'Administrador'], [gestorEmail, 'gestor', 'Gestor de tráfego']]) {
    if (get('SELECT id FROM users WHERE email = ?', email)) { console.log(`Usuário já existe: ${email} (nada alterado)`); continue; }
    const pw = newPassword();
    auth.createUser(email, nome, role, pw);
    out.push(`${role}: ${email}`, `senha: ${pw}`, '');
    console.log(`Usuário criado: ${email} (${role})`);
  }
  if (out.length > 2) {
    const f = path.join(lib.DATA_DIR, 'credenciais-iniciais.txt');
    writeCred(f, out);
    console.log(`\nSenhas gravadas em: ${f}\n(elas não são exibidas aqui de propósito)`);
  }
} else if (cmd === 'reset-senha') {
  const email = (args[0] || '').toLowerCase();
  if (!email) { console.error('Uso: node server/cli.js reset-senha <email>'); process.exit(1); }
  const auth = require('./auth');
  const pw = newPassword();
  if (!auth.setPassword(email, pw)) { console.error('Usuário não encontrado: ' + email); process.exit(1); }
  const f = path.join(lib.DATA_DIR, 'nova-senha-' + email.replace(/[^a-z0-9]/g, '_') + '.txt');
  writeCred(f, [`${email}`, `senha: ${pw}`]);
  console.log(`Nova senha gravada em: ${f} (sessões antigas foram encerradas)`);
} else if (cmd === 'purge') {
  const days = Number(args[0]) || 425;
  const r = require('./retention').purge(days);
  console.log(`Retenção (${days} dias): ${r.events} eventos, ${r.visits} sessões e ${r.hits} acessos apagados; ${r.leads} demandas anonimizadas.`);
} else if (cmd === 'seed-demo') {
  if (!/demo/i.test(process.env.LF_DB_FILE || '') && !args.includes('--force')) {
    console.error('Recusado: por segurança, só roda com LF_DB_FILE contendo "demo" (ex.: LF_DB_FILE=demo.sqlite). Use --force para ignorar.');
    process.exit(1);
  }
  require('./seed-demo').run();
} else {
  console.log('Comandos: init | reset-senha <email> | purge [dias] | seed-demo');
}
