# Lima Ferreira Advogados — Copy da LP "Tribunais Superiores" (v2)

Fonte: `Lima-Ferreira-Prompt-e-Copy.md` (sua pasta Pedro IA) + a mensagem de chat que trouxe o texto "Nossa história" e a regra do CTA. **Este arquivo substitui a copy v1** (a do formulário), que foi descartada. O texto que vai ao ar fica em `public/assets/site.js` (assistente) e `public/index.html` (resto); se você editar aqui, avise para eu passar para a página.

## Decisões onde as fontes se contradiziam
| Ponto | Decisão | Motivo |
|---|---|---|
| CTA | **"Falar com nossa equipe"** (cabeçalho e botão flutuante). Nunca "falar com advogado". | Chat é posterior ao `.md`. |
| Bloco "O escritório" | Título do `.md` + o texto **"Nossa história"** do chat, na íntegra, ao lado da foto do escritório. **Descartei** os dois parágrafos do `.md` ("Com sede em Brasília…" e "A parceria começa com uma conversa…"). | Evita dois conjuntos de texto empilhados; a parceria já está explicada em "Como funciona". |
| Foto do bloco institucional | Foto azul do escritório (a que você enviou no chat). A escultura *A Justiça* ficou no cartão da fundadora, como prévia do retrato. | O `.md` pedia a escultura "para a prévia"; o chat trouxe a foto do escritório para falar do escritório. |
| Mensagem do WhatsApp | **Exatamente a do `.md`**, sem código de referência. | Código de referência mudaria o texto; ver "Próximos passos". |

## Cabeçalho
Logo **Lima Ferreira Advogados** · Como funciona · O escritório · Apresentar demanda · botão **Falar com nossa equipe**

## Primeira tela
Brasília · Tribunais Superiores

**Seu escritório.** *(fino)*
**Representado em Brasília.** *(pesado)*

Atuação nos tribunais superiores para advogados e escritórios de todo o Brasil.

**Em qual tribunal você precisa de apoio?**

Cartões em carrossel (3 por vez no desktop): STF · STJ · TST · TSE · STM, cada um com marca (ou sigla), nome oficial e **Selecionar tribunal**. Controles: **Tribunais anteriores**, **Pausar / Retomar**, **Próximos tribunais**.

## Assistente (3 etapas)
**Etapa 1 — Como podemos apoiar seu escritório?**
- STF: Recurso extraordinário · Despacho e memoriais · Sustentação oral · Acompanhamento processual · Outra demanda
- STJ: Recurso especial · Despacho e memoriais · Sustentação oral · Acompanhamento processual · Homologação de decisão estrangeira · Outra demanda
- TST: Recurso de revista · Despacho e memoriais · Sustentação oral · Acompanhamento processual · Outra demanda
- TSE: Apresentar demanda eleitoral
- STM: Apresentar demanda militar

**Etapa 2 — Há algum prazo ou julgamento próximo?** Tenho um prazo em andamento · Tenho um julgamento marcado · Não há uma data próxima · Prefiro explicar à equipe

**Etapa 3 — Vamos conversar sobre sua demanda.**
> Olá! Gostaria de apoio para uma demanda.
> Tribunal: [nome do tribunal (SIGLA)]
> Apoio: [serviço escolhido]
> Prazo: [opção selecionada]

**Continuar pelo WhatsApp** — *Você será direcionado ao WhatsApp com suas escolhas.* Enquanto não houver número: **Copiar resumo da demanda** → **Resumo copiado.**
Em todas as etapas: **Voltar**; no resumo, **Alterar** em cada linha.

## Reconhecimentos do escritório *(configurável — ver pendências)*
Selos: Ouro 2022 · Latin American Excellence in Law Awards — Silver Seal 2021 · Análise Advocacia Regional 2024 · Quality Justiça 2021.

## Como funciona — *Do seu escritório. Até Brasília.*
**01 / Apresente — Conte o que precisa.** Escolha o tribunal e indique sua demanda e os prazos envolvidos.
**02 / Alinhe — Definimos a atuação.** A equipe avalia a solicitação e alinha com você o escopo da parceria.
**03 / Acompanhe — Seguimos juntos.** Com a contratação formalizada, conduzimos as atividades combinadas em Brasília.

## O escritório
Nossa história · Lima Ferreira Advogados

**Uma equipe em Brasília.** *(fino)* **Ao lado do seu escritório.** *(pesado)*

Advocacia abrangente

Desde 2014, atuamos com foco em soluções jurídicas para empresas. Com o crescimento das demandas, ampliamos nossas áreas e nos tornamos um escritório abrangente.

Contamos com uma equipe qualificada e uso de tecnologia para atender clientes em todo o Brasil com eficiência e proximidade.

**Dra. Luana Lima Ferreira** — Fundadora · 17 anos de advocacia *(número da OAB só aparece quando for informado em `site.fundadoraOab`)*

## Encerramento
Vamos começar?
**Sua próxima demanda em Brasília começa aqui.** → **Selecionar tribunal**

## Rodapé
Lima Ferreira Advogados · Brasília/DF *(endereço, e-mail, telefone e registro da OAB entram pela configuração)*
STF · STJ · TST · TSE · STM
*As marcas dos tribunais são usadas apenas para identificar o tribunal e não indicam vínculo institucional. Este site tem caráter exclusivamente informativo, em conformidade com o Código de Ética e Disciplina da OAB e com o Provimento nº 205/2021 do Conselho Federal da OAB. As informações não constituem promessa de resultado nem aconselhamento jurídico.*

## Parâmetros para anúncios
- `?svc=resp|re|rr|hde` → abre o assistente já no tribunal e no apoio (etapa 2: prazo).
- `?svc=despacho|sustentacao|acompanhamento` → o visitante escolhe o tribunal; o apoio já vem marcado.
- `?tribunal=stf|stj|tst|tse|stm` → abre na etapa 1 daquele tribunal.

## Google Ads — estrutura sugerida (Pesquisa)
Canal-base, porque o Provimento 205/2021 admite palavra-chave quando o anúncio **responde a uma busca iniciada pelo potencial cliente** (Anexo Único).

| Grupo | Exemplos de palavras-chave (frase/exata) | URL final |
|---|---|---|
| Correspondente | correspondente em brasília stj · correspondente jurídico brasília stf · advogado correspondente tribunais superiores | `/` |
| REsp | protocolar recurso especial brasília · advogado recurso especial stj | `?svc=resp` |
| RE | advogado recurso extraordinário stf · protocolar recurso stf brasília | `?svc=re` |
| RR | advogado recurso de revista tst · correspondente tst brasília | `?svc=rr` |
| HDE | homologação de sentença estrangeira advogado · homologação decisão estrangeira stj | `?svc=hde` |
| Despacho | despacho com ministro stj · despachar memorial stf | `?svc=despacho` |
| Sustentação | sustentação oral stj advogado · sustentação oral stf brasília | `?svc=sustentacao` |

**Negativas iniciais:** grátis, gratuito, modelo, curso, concurso, vaga, estágio, como fazer, pdf, jurisprudência, consulta processual.
**Anúncios:** só informativos (tribunal, serviço, cidade). Sem preço, sem "garantido", sem superlativos.

> **Atualização (27/11/2026):** o assistente de 3 etapas foi removido a pedido do escritório. Não há formulário: cada cartão de tribunal e todo botão de ação abrem o WhatsApp direto, com a mensagem pronta ("Olá! Gostaria de apoio para uma demanda no [tribunal]."). A demanda é registrada no clique, só com o tribunal (ou sem tribunal, nos botões gerais).
