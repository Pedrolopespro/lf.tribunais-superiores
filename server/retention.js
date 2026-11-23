'use strict';
// Retenção (a Política de Privacidade promete até 14 meses ≈ 425 dias):
// - dados de navegação (eventos, sessões, acessos) são APAGADOS;
// - demandas são ANONIMIZADAS (perdem o id da sessão, o id de visitante e o hash de IP) e ficam só como registro
//   estatístico e comercial: tribunal, apoio, prazo, situação, valor e atribuição de campanha.
const { run } = require('./db');

function purge(days = 425) {
  const cutoff = Date.now() - days * 86400e3;
  const events = run('DELETE FROM events WHERE ts < ?', cutoff).changes;
  const visits = run('DELETE FROM visits WHERE last_ts < ?', cutoff).changes;
  const hits = run('DELETE FROM hits WHERE ts < ?', cutoff).changes;
  const leads = run("UPDATE leads SET sid = '', vid = '', ip_hash = '', first_touch = '' WHERE ts < ? AND (sid != '' OR vid != '' OR ip_hash != '' OR first_touch != '')", cutoff).changes;
  run('DELETE FROM login_attempts WHERE ts < ?', Date.now() - 24 * 3600e3);
  return { events, visits, hits, leads };
}
module.exports = { purge };
