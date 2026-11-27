# Lima Ferreira Advogados — LP "Tribunais Superiores": planejamento (v2)

A copy está em [COPY.md](COPY.md); como rodar, em [../README.md](../README.md). **Esta versão substitui a v1** (landing com formulário): a direção mudou para uma interface com cara de software, com carrossel de tribunais e assistente de 3 etapas que termina no WhatsApp.

## 1. O que mudou e o que continua
| | v1 (descartada) | v2 (atual) |
|---|---|---|
| Experiência | Página longa com formulário | Primeira tela com escolha do tribunal → apoio → prazo → resumo → WhatsApp |
| Visual | Serifa, papel e bronze | Sem serifa, azul profundo/preto, dourado nas ações, vidro fosco, bordas finas |
| Dados do visitante | Nome, e-mail, telefone, OAB, UF | **Nenhum dado pessoal.** Só tribunal, apoio e prazo; o contato acontece no WhatsApp |
| Conversão | Envio do formulário | Clique final (WhatsApp ou "Copiar resumo") |
| Continua igual | Tracking próprio, painel privado, UTMs, Google Ads Pesquisa como canal-base, deploy em Node |

## 2. Direção de design
- **Referências:** as três artes que você enviou (preto, tipografia leve × pesada na mesma família, cartões de vidro com borda fina, setas e numerais grandes e leves).
- **Tipografia:** Inter (sem serifa), pesos 200–800. Primeira linha dos títulos em peso 200, segunda em 700.
- **Cores:** fundo `#070B14`, azul da marca `#0E4378`, texto `#EEF3FA`, dourado `#C7AE7A` só nas ações. Brilho iridescente (azul, ciano, lilás) apenas na borda do cartão sob mouse, foco ou seleção.
- **Primeira tela:** foto do STF com camada azul-escura, título centralizado que aparece suavemente, pergunta e três cartões por vez em movimento contínuo da direita para a esquerda (~30 px/s).
- **Carrossel:** pausa com mouse, foco/teclado, toque (retoma 4,5 s depois) e quando um tribunal está selecionado; botões anterior, pausar/retomar e próximo; sob "movimento reduzido" não anda sozinho e o botão de pausa some.
- **Botão flutuante** "Falar com nossa equipe". Sem número configurado ele leva ao seletor de tribunal (não fica morto). A faixa de cookies compacta no celular e esconde o botão enquanto está aberta.
- **Imagens tratadas:** marcas dos tribunais recortadas e achatadas em fundo branco (os arquivos vieram com margem enorme e fundo opaco); logo do escritório extraído da arte que você enviou (branco com transparência); fotos em WebP.

## 3. Arquitetura da página
| Seção (`id`) | Conteúdo | O que o painel mede |
|---|---|---|
| Primeira tela (`topo`) | Título, pergunta, carrossel, assistente | Funil por etapa, controles do carrossel, voltas |
| Reconhecimentos (`reconhecimentos`) | Quatro selos (desligável) | Alcance da seção |
| Como funciona (`como-funciona`) | 01 Apresente · 02 Alinhe · 03 Acompanhe | Alcance |
| O escritório (`escritorio`) | Foto, "Nossa história", fundadora | Alcance |
| Encerramento (`fechamento`) | "Selecionar tribunal" | Cliques |

**Assistente — modelo de dados:** tribunal (`stf|stj|tst|tse|stm`) → apoio (`re`, `resp`, `rr`, `despacho`, `sustentacao`, `acompanhamento`, `hde`, `outra`, `eleitoral`, `militar`) → prazo (`andamento|julgamento|sem-data|explicar`). A cada escolha sai um evento; o clique final grava uma **demanda** (tabela `leads`) com a atribuição da sessão.

## 4. Conformidade com a publicidade na advocacia
Fonte: texto oficial do Provimento nº 205/2021 do CFOAB, lido nesta sessão. **Não substitui a validação do sócio responsável nem do Tribunal de Ética/Comitê de Marketing Jurídico da OAB-DF.**

| Ponto | Situação |
|---|---|
| **Selos de prêmios (art. 5º, § 1º)** | O Provimento veda **pagar, patrocinar ou custear qualquer despesa** para aparecer em prêmios ou honrarias que destaquem profissionais. Só o escritório sabe se isso vale para os quatro selos. O bloco está **no ar por pedido seu**; desligue com `"mostrarSelos": false` em `config/site.config.json` até confirmar. |
| **Linguagem de autoelogio (art. 3º, IV)** | O texto "Nossa história" (seu) tem "equipe **qualificada**" e "com **eficiência** e proximidade". Mantive na íntegra. Alternativa neutra, se o sócio preferir: *"Contamos com uma equipe e com o uso de tecnologia para atender clientes em todo o Brasil."* |
| **Título de especialista (art. 3º, III)** | A página não usa "especialista". |
| **Preços, resultados, casos** | Nenhum. |
| **Marcas dos tribunais** | A página oficial do **STF diz que o uso da logomarca exige autorização do tribunal**. Nos textos que consegui ler de STJ, TST, TSE e STM não achei regra clara sobre terceiros, mas o manual de uso do TSE (seção "uso da marca por terceiros") e o manual vigente do STJ não foram lidos. Cartões com marca podem parecer chancela. Mitigações já feitas: aviso no rodapé e na política de privacidade ("apenas identificam o tribunal; sem vínculo institucional"). Para o caso de a autorização não vir: `"marcasTribunais": false` troca todas as marcas por siglas em texto. |
| **Anúncios** | Google Ads de **Pesquisa** é o canal-base (palavra-chave que responde a busca do potencial cliente). Meta/LinkedIn só com conteúdo informativo, nunca "contrate". Disparo frio de e-mail/WhatsApp para listas de advogados é vedado (mala direta). |
| **Anúncios dirigidos a advogados** | O Provimento não trata de "correspondência jurídica" para outros advogados. Vale consultar a OAB-DF antes de investir em mídia. |
| **Fundadora** | Número da OAB pendente; só aparece quando informado (título "verdadeiro e comprovável", art. 4º, § 1º). |

## 5. Rastreamento
**Arquitetura (igual à v1):** o navegador envia eventos para `/api/e` (first-party); o servidor registra cada acesso à página para medir a perda do rastreamento em JavaScript; tudo espelha em `window.dataLayer` com prefixo `lf_` para o gestor ligar GA4, Google Ads e Meta pelo GTM. IP nunca é gravado em claro; sem consentimento não há cookie persistente nem tag de terceiros.

| Evento | Quando | Rótulo |
|---|---|---|
| `page_view`, `scroll`, `section_view`, `engaged` | carga, 25/50/75/90 %, seção no centro da tela, atenção real | % · id da seção · segundos |
| `carousel_ctl` | anterior, próximo, pausar, retomar | `prev|next|pause|resume` |
| `wizard_court` | escolheu o tribunal | `stf`… |
| `wizard_service` | escolheu o apoio | `stj:resp` |
| `wizard_deadline` | informou o prazo | `andamento`… |
| `wizard_summary` | chegou ao resumo | `stj:resp:andamento` |
| `wizard_back`, `wizard_copy` | voltou etapa; copiou o resumo | etapa |
| `cta_click`, `whatsapp_click`, `nav_click`, `outbound_click` | botões, WhatsApp (inclui `wizard_final`, `header_cta`, `float_wa`), menu, links externos | `data-label` |
| `lead` | **servidor**, ao gravar a demanda | `stj:resp` |
| `lcp`, `cls`, `js_error`, `consent_*` | qualidade técnica e cookies | — |

**Conversões para as plataformas (dataLayer):** `generate_lead` (demanda concluída) e `click_whatsapp`. **O clique final do WhatsApp dispara os dois.** No GTM/Google Ads, marque **apenas `generate_lead` como conversão principal** e deixe `click_whatsapp` como microconversão (botão do topo e flutuante), senão a mesma pessoa conta duas vezes. Há integração direta com GA4, Pixel e Google Ads (IDs na configuração).
**Sessão e atribuição:** a sessão expira após 30 min parada **ou quando chega outro clique de campanha** (UTM/gclid/fbclid diferente) na mesma aba. UTMs, `gclid` e `fbclid` são gravados no servidor na entrada e copiados para a demanda; com consentimento, guarda-se também o primeiro toque (90 dias). O identificador de visitante expira em 90 dias.
**Limites reais:** não se vê quem bloqueia JavaScript nem a conversa dentro do WhatsApp (só o clique). Como o site **não coleta nome nem telefone**, o painel não consegue ligar uma conversa específica do WhatsApp a uma demanda. O time marca a situação manualmente. Solução futura: código curto na mensagem (ver seção 9).

## 6. Painel privado (`/painel`)
| Página | O que responde |
|---|---|
| Visão geral | Sessões, engajamento, demandas concluídas, WhatsApp, conversões, custo por demanda, ROAS, funil do assistente, saúde do rastreamento |
| Aquisição | Canal, campanha, palavra-chave, anúncio e `svc` com conversão e custo |
| Comportamento | Seções vistas, rolagem, tempo, **tribunal / apoio / prazo escolhidos**, demandas por tribunal, carrossel, voltas, hora e dia da semana, dispositivo |
| Demandas | Lista e detalhe com atribuição, jornada da sessão evento a evento, situação, valor do contrato, notas e histórico; exportações |
| Tempo real | Quem está no site agora e os últimos eventos |
| Investimento | Lançamento de gasto por campanha (custo por demanda e ROAS) |
| Qualidade técnica | LCP/CLS, erros de JS, consentimento, robôs |
| Links rastreados | Gerador de URL com UTM, `svc` e `tribunal` + sufixo do Google Ads |

Segurança: senha com scrypt, sessão de 8 h guardada como hash, cookie `HttpOnly` + `SameSite=Strict`, CSRF, bloqueio após 5 falhas, CSP sem terceiros, `noindex`. Como não há mais dado pessoal, o perfil "gestor" e o "admin" veem o mesmo conteúdo.

## 7. Arquitetura técnica e publicação
Back-end em Node (≥ 22.13), sem dependências, SQLite embutido. **A página depende do servidor** (injeta WhatsApp, IDs de tags e rodapé; o `.md` pedia arquivos que abrem direto no navegador, mas isso não é possível aqui sem perder o tracking e o painel). Checklist de publicação no README. **Confirmar o plano da Hostinger** (precisa de Node.js ≥ 22.13 ou VPS; plano só PHP exigiria portar o back-end).

## 8. Pendências
1. **Selos:** o escritório pagou ou custeou algo para aparecer em qualquer um deles? (art. 5º, § 1º). Decidir `mostrarSelos`.
2. **Marcas dos tribunais:** pedir autorização ao STF (obrigatória pela página oficial) e verificar os demais; decidir `marcasTribunais`. **O logo do TSE não veio no ZIP**: o site do TSE bloqueou o download automático (erro 403), então o cartão usa a sigla em texto. Se você baixar o arquivo, eu encaixo.
3. **Textos:** sócio valida "qualificada" e "com eficiência" (art. 3º, IV).
4. **Fundadora:** número da OAB e o retrato de terno branco (hoje, prévia com a escultura).
5. **Número do WhatsApp**, e-mail, endereço, registro da sociedade na OAB/DF e e-mail do encarregado de dados.
6. **Foto do hero:** 736×981 px, baixa para tela cheia no desktop (aparece suave por causa da camada azul). Enviar versão maior (≥ 2000 px de largura).
7. **IDs de mídia:** GTM, GA4, Meta Pixel, Google Ads (ID e rótulos).
8. **Plano e domínio da Hostinger.**
9. **Política de Privacidade:** revisão jurídica (prazos, bases legais) e auto-hospedar as fontes (hoje Google Fonts, que expõe o IP).
10. **Ads:** consulta à OAB-DF sobre anúncios dirigidos a advogados.

## 9. Próximos passos
1. Publicar e validar um fluxo real até o WhatsApp.
2. **Código curto na mensagem do WhatsApp** (ex.: `Ref.: 7F3K`) para casar a conversa com a sessão e a atribuição. Muda o texto da mensagem, por isso não foi feito sem sua aprovação.
3. Teste A/B do título e da ordem dos tribunais; API de Conversões da Meta; importação do custo do Google Ads.

## 10. Verificação
- **`npm test`: 168 verificações automatizadas**, entre elas: fidelidade da copy do assistente (todas as opções, perguntas e a mensagem do WhatsApp), ausência de "Falar com um advogado", "especialista" e preço, selos e marcas desligáveis (a flag chega à página), migração de banco antigo (renomeia, não apaga), eventos e escolhas do assistente, validação da conversão (tribunal × apoio), robôs, retenção (apaga navegação e anonimiza demandas antigas), proxy/HTTPS, login, CSRF, XSS, e todas as páginas do painel.
- **Navegador (verificado):**
  - **1366×768:** a primeira tela cabe na dobra (controles terminam em y=687) e a faixa de cookies (barra baixa e larga) não cobre nenhum cartão.
  - **375×667:** primeira tela cabe; assistente nas 3 etapas sem sobreposição e sem rolagem horizontal (o botão flutuante some enquanto o assistente ou a faixa de cookies estão abertos); botão final com largura total.
  - **Carrossel:** pausa no mouse, retoma a ~30 px/s, fica parado enquanto há tribunal selecionado e o botão passa a mostrar "Retomar"; **um clique retoma**; pausa do visitante funciona.
  - **Borda iridescente:** o ângulo gira no cartão selecionado (82° → 142° em 1,5 s) e os cartões sem foco ficam parados e invisíveis.
  - **Assistente:** voltar/alterar; `?svc=resp` abre na etapa 2 sem roubar o foco; TSE tem uma só opção; mensagem do WhatsApp idêntica ao seu texto; sem número, "Copiar resumo da demanda" → "Resumo copiado."
  - **Marcas:** com `marcasTribunais: false` os cinco cartões viram siglas em texto e nenhuma imagem de tribunal é carregada.
  - **Dados:** o clique final grava demanda, sessão e jornada; o painel mostra o funil novo.
- **Não testado:** sob "movimento reduzido" no navegador (só o código), toque em celular real, Safari/Firefox (a borda iridescente cai para um anel estático onde `@property` não existe), navegação completa só por teclado, WhatsApp de verdade, GTM/GA4/Pixel/Google Ads, Hostinger.
- **Efeitos colaterais do trabalho:** o teste do botão "Copiar resumo" deixou um resumo fictício (STM) na área de transferência do seu computador. Dois subagentes de pesquisa usaram o painel do navegador; um deles abriu diálogos de "salvar arquivo" (não aceitos).

> **Atualização (27/11/2026):** o assistente de 3 etapas foi removido a pedido do escritório. Não há formulário: cada cartão de tribunal e todo botão de ação abrem o WhatsApp direto, com a mensagem pronta ("Olá! Gostaria de apoio para uma demanda no [tribunal]."). A demanda é registrada no clique, só com o tribunal (ou sem tribunal, nos botões gerais).
