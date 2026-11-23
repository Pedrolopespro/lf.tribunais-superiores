# LP Tribunais Superiores — Lima Ferreira Advogados

Landing page (carrossel de tribunais + assistente que termina no WhatsApp) + rastreamento próprio + painel privado para o gestor de tráfego. Sem dependências externas (só Node.js ≥ 22.13).

Leia primeiro: [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md) (estratégia, conformidade, tracking, pendências) e [docs/COPY.md](docs/COPY.md) (textos).

## Ver funcionando agora (dados fictícios)

```powershell
npm run demo-server
```

Abre em `http://localhost:3100` (LP) e `http://localhost:3100/painel`. As senhas de teste ficam em `data/demo/credenciais-demo.txt`. Escuta apenas em 127.0.0.1.

## Uso real

```powershell
npm run setup -- admin@dominio.com.br gestor@dominio.com.br
npm start
```

1. `setup` cria `config/site.config.json`, os dois usuários e grava as senhas em `data/credenciais-iniciais.txt` (não são exibidas). Guarde-as e apague o arquivo.
2. Edite `config/site.config.json`: WhatsApp (`5561999999999`), IDs de GTM/GA4/Pixel/Google Ads, e-mail, endereço, registro da OAB. Campo vazio = recurso desligado e nada de placeholder visível na página.
3. `npm start` sobe em `http://localhost:3000`. Painel em `/painel`.

Outros comandos: `npm run reset-senha -- email`, `npm run purge` (retenção de 425 dias), `npm test`.

## Onde mexer

| Quero… | Arquivo |
|---|---|
| Textos fixos da página | `public/index.html` (espelha `docs/COPY.md`) |
| Tribunais, apoios, prazos e a mensagem do WhatsApp | `public/assets/site.js` (e o espelho em `server/track.js`: manter os códigos iguais) |
| Cores, fontes, animações, borda iridescente | `public/assets/site.css` (variáveis no topo) |
| Eventos de rastreamento | `public/assets/tracker.js` e `data-track`/`data-label` no HTML |
| Painel | `server/panel.js` (páginas) e `server/panel-data.js` (consultas) |
| WhatsApp, tags, rodapé, selos, marcas | `config/site.config.json` |

Opções em `config/site.config.json` → `site`: `whatsapp` (`5561999999999`), `mostrarSelos` (`false` esconde o bloco de selos), `marcasTribunais` (`false` troca as marcas dos tribunais por siglas), `fundadoraOab`. Campo vazio = recurso desligado.

Imagens: `public/assets/img/`. Os cartões usam `stf|stj|tst|stm.png`; o TSE aparece em texto até existir `tse.png` e `logo: true` no `site.js`.

A página **precisa do servidor Node** (ele injeta a configuração); não abre direto do disco.

## Segurança — o que nunca fazer

- Não publicar a pasta `data/` nem `config/` (só `public/` é servida pelo servidor).
- Não rodar `demo-server` nem `seed-demo` em produção.
- Em produção, defina `LF_SECRET` e `LF_DATA_DIR` (fora da pasta de deploy) e `LF_TRUST_PROXY=1` atrás de proxy.

## Publicação na Hostinger (validar cada item no hPanel)

1. Confirmar um plano com **Node.js ≥ 22.13** (ou VPS). Um plano só de PHP exigiria portar o back-end.
2. Subir o projeto (Git ou ZIP); arquivo de entrada `server/index.js`.
3. Variáveis de ambiente: `LF_TRUST_PROXY=1`, `LF_DATA_DIR` apontando para uma pasta **fora** da pasta de deploy (o banco sobrevive a atualizações) e `LF_SECRET` com um valor longo e aleatório.
4. Copiar `config/site.config.example.json` para `config/site.config.json` e preencher (WhatsApp, tags, rodapé; decidir `mostrarSelos` e `marcasTribunais`).
5. Rodar `npm run setup -- admin@dominio gestor@dominio`, guardar as senhas do arquivo gerado e **apagá-lo**.
6. Ativar HTTPS e o domínio; conferir que `/painel` pede login e que `/data` e `/config` não abrem.
7. Agendar no cron: `node server/cli.js purge` (mensal) e cópia diária do banco.
8. Testar uma demanda real até o WhatsApp e conferir no painel (atribuição, jornada, situação).
