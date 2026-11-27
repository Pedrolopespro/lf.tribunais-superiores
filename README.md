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

## Avaliações do Google (carrossel)

Uma seção "Avaliações no Google" aparece antes do encerramento **somente** quando há uma fonte configurada.

**Em uso: widget gratuito do Featurable** (`avaliacoes.featurableId` na config). O site carrega `featurable.com/assets/bundle.js` só quando o visitante chega perto da seção, remove a marcação de nota média que o widget injeta no `<head>` e, se o script falhar, esconde o bloco. Aparência, idioma e filtros se ajustam no painel do Featurable (recomendado: tema escuro, idioma português, estrelas mínimas = 1, "schema" desligado). Para desligar, deixe `featurableId` vazio.

**Alternativa (paga, já pronta e desligada): Places API do Google**, usada só quando `featurableId` está vazio. Sem chave e `place_id`, ela não existe na página.

1. No Google Cloud: ativar a **Places API (New)**, criar uma chave restrita a essa API e **ligar um limite diário de consultas** (cota) e um alerta de orçamento. A consulta que traz avaliações é paga; confirmar o preço atual na tabela do Google.
2. Variáveis de ambiente no hPanel: `LF_GOOGLE_PLACES_KEY` (a chave; nunca no repositório nem no chat) e `LF_GOOGLE_PLACE_ID` (o identificador do local no Google Maps; não é segredo e também pode ir em `avaliacoes.placeId` na config).
3. Opcional em `avaliacoes` (config): `linkPerfil` (botão "Ver todas no Google"), `mostrarNota` (nota média e total; **desligada por padrão**, a cliente decide), `maxPorDia` (teto diário de consultas do servidor; padrão 400), `ativar: false` (desliga mesmo com a chave).

Como funciona e por quê:
- O servidor consulta o Google **ao vivo, sem cache**: as regras do Google proíbem guardar o conteúdo das avaliações (só o `place_id`). Consultas simultâneas dividem uma chamada. A LP só chama `/api/avaliacoes` quando o visitante chega perto da seção.
- O Google devolve no máximo **5** avaliações, escolhidas por ele. O site mostra o texto original do autor, sem editar nem escolher, com nome do autor e link. Avaliações só com nota (sem texto) não aparecem. Não há foto do autor (evita requisição do visitante ao Google antes do consentimento).
- A chave fica só no servidor. Se o Google falhar ou o teto diário for atingido, o carrossel some e sobra o link para o perfil (se configurado).
- OAB: o Provimento 205/2021 não trata de avaliações; a orientação da OAB-SP é de que só devem ser divulgados depoimentos espontâneos do próprio cliente, com a origem preservada. Mostrar a nota média e republicar avaliações que citem resultados de processos são pontos que a cliente deve confirmar com a OAB-DF.

## Segurança — o que nunca fazer

- Não publicar a pasta `data/` nem `config/` (só `public/` é servida pelo servidor).
- Não rodar `demo-server` nem `seed-demo` em produção.
- Em produção, defina `LF_SECRET` e `LF_DATA_DIR` (fora da pasta de deploy) e `LF_TRUST_PROXY=1` atrás de proxy.

## Publicação na Hostinger (validar cada item no hPanel)

1. Confirmar um plano com **Node.js ≥ 22.13** (ou VPS). Um plano só de PHP exigiria portar o back-end.
2. Subir o projeto (Git ou ZIP); arquivo de entrada `server/index.js`.
3. Variáveis de ambiente: `LF_TRUST_PROXY=1`, `LF_DATA_DIR` apontando para uma pasta **fora** da pasta de deploy (o banco sobrevive a atualizações) e `LF_SECRET` com um valor longo e aleatório.
4. Copiar `config/site.config.example.json` para `config/site.config.json` e preencher (WhatsApp, tags, rodapé; decidir `mostrarSelos` e `marcasTribunais`).
5. Criar o primeiro administrador, de um destes jeitos:
   - **Sem terminal (Hostinger):** defina `LF_ADMIN_EMAIL` e `LF_ADMIN_PASSWORD` (mín. 10 caracteres). O app cria o usuário na subida se o e-mail ainda não existir (nunca troca a senha de quem já existe) e não grava a senha em log nem em arquivo. Depois do primeiro acesso, **apague `LF_ADMIN_PASSWORD`** das variáveis. `LF_GESTOR_EMAIL`/`LF_GESTOR_PASSWORD` fazem o mesmo para o gestor.
   - **Com terminal:** `npm run setup -- admin@dominio gestor@dominio`, guardar as senhas do arquivo gerado e **apagá-lo**.
   - Os demais usuários se criam no painel, em **Usuários** (só administrador: criar, redefinir senha, desativar/reativar). Não existe cadastro aberto. Cada pessoa troca a própria senha em **Minha conta**.
6. Ativar HTTPS e o domínio; conferir que `/painel` pede login e que `/data` e `/config` não abrem.
7. Agendar no cron: `node server/cli.js purge` (mensal) e cópia diária do banco.
8. Testar uma demanda real até o WhatsApp e conferir no painel (atribuição, jornada, situação).
