---
name: govbr-design-system
description: Orienta a implementação de interfaces (páginas EJS, HTML, CSS, JS de navegador) do sistema de livros didáticos do IFC seguindo o Padrão Digital de Governo (GovBR-DS). Use em qualquer tarefa de frontend — criar ou alterar telas, formulários, tabelas, navegação, mensagens, modais, estados de interface, estilos ou componentes visuais — e ao revisar interfaces antes de concluí-las.
---

# GovBR-DS no sistema de livros didáticos do IFC

Referência principal: **Padrão Digital de Governo — https://www.gov.br/ds/**.
Mapa de links oficiais: [references/links.md](references/links.md).

Stack do projeto (AGENTS.md, seção 11): **HTML renderizado no servidor (EJS) + CSS + JavaScript puro**, Express 5. Não há React, Vue ou Angular — não introduza nenhum deles para usar o Design System.

## 1. Regra de ouro: consulte antes de escrever

Você **não** deve escrever marcação, classes, atributos, propriedades, eventos ou chamadas JS de componentes GovBR-DS de memória.

Antes de usar qualquer componente:

1. Abra a página do componente em `https://www.gov.br/ds/components/<nome>` e leia as abas **Visão Geral** (quando e como usar), **Códigos** (HTML/CSS/JS de referência) e **Acessibilidade**.
   - O site é uma SPA: se a ferramenta de busca de página retornar só o título, use o navegador (ex.: ferramentas de browser do ambiente) para renderizar e ler o texto.
2. Confirme a **versão instalada** do pacote em `package.json`/`package-lock.json` e, em caso de dúvida, consulte os arquivos do próprio pacote em `node_modules/@govbr-ds/...` (CSS, JS, `dist/types/*.d.ts` dos Web Components). O que está instalado prevalece sobre exemplos antigos.
3. Copie a estrutura da aba **Códigos** e adapte apenas conteúdo (textos, nomes de campos, dados). Não "melhore" a estrutura.
4. Se a documentação não cobrir o caso, **diga isso explicitamente** no PR/resposta e escolha a opção mais conservadora (HTML semântico nativo + tokens/utilitários do core). Nunca invente propriedade, classe, evento, método ou componente.

Se não for possível acessar a documentação nem os arquivos do pacote, **pare e informe** — não produza código de componente "provável".

## 2. Qual implementação oficial usar

O GovBR-DS oferece duas implementações oficiais (ver "Fluxo de Desenvolvimento" em https://www.gov.br/ds/como-comecar/fluxo-dev):

| Implementação | Pacote | Uso neste projeto |
|---|---|---|
| Biblioteca de componentes HTML/CSS/JS | `@govbr-ds/core` | **Padrão do projeto.** Funciona com HTML gerado no servidor, formulários nativos (`<form method="post">` com token CSRF), sem depender de JS para exibir conteúdo, e traz os utilitários (grid, cores, espaçamentos, tokens). |
| Web Components (Stencil, custom elements `br-*`) | `@govbr-ds/webcomponents` (requer `@govbr-ds/core` e outras peers) | Recomendada pelo DS para projetos modernos, mas **só use aqui caso a caso**, após confirmar na documentação/tipos do pacote que o componente funciona com o fluxo do projeto (envio de formulário nativo, renderização sem JS, CSP). Registre a decisão no AGENTS.md. |

Regras:

- Não misture as duas implementações para o **mesmo** componente na mesma tela.
- Não use wrappers de framework (`@govbr-ds/webcomponents-react` etc.) — o projeto não usa framework.
- Sirva CSS/JS do DS a partir de `node_modules` (copiados para `/public` no build) — **não** dependa do CDN do DS; a própria documentação recomenda npm ou arquivos locais. Isso também simplifica a CSP.
- Dependências externas exigidas pelo DS (fonte **Rawline**, ícones **Font Awesome** na versão indicada pela documentação) devem ser hospedadas localmente e carregadas **antes** dos arquivos do DS.
- Componentes interativos do core podem exigir **inicialização manual em JS** (aba Códigos/Javascript de cada componente). Inicialize após o carregamento de `core.min.js`, em um módulo JS próprio (`/public/js/...`), sem scripts inline (CSP).
- Não instale nem atualize pacotes do DS sem pedido explícito; ao atualizar, leia as Release Notes (https://www.gov.br/ds/release-notes).

## 3. Escolhendo componentes e padrões

Comece pelo **Padrão Mínimo** (https://www.gov.br/ds/introducao/padrao-minimo): cabeçalho, rodapé, tipografia Rawline, paleta de cores por função, botões, sign-in, ícones com significado consistente.

Mapeamento orientativo para as telas do projeto — **confirme cada um na documentação antes de usar**:

| Necessidade na aplicação | Onde procurar no DS |
|---|---|
| Estrutura geral da página | Templates › Base; componentes Header, Footer, Menu, Skip Link, Breadcrumb |
| Página de erro / não encontrado / sem permissão | Templates › Erro |
| Login com Google | Componente Sign-in (apenas o padrão visual do botão; o fluxo é OIDC do backend) |
| Formulários (estudante, entrega, configurações) | Padrão › Formulário; componentes Input, Select, Checkbox, Radio, Switch, Textarea, DateTimePicker, Upload (importação CSV) |
| Ações | Button (hierarquia primário/secundário/terciário conforme doc) |
| Listagens (estoque, pendências, solicitações de acesso) | Table, Pagination, List/Item, Tag (status) |
| Lista vazia | Padrão › Empty States |
| Feedback de operação (sucesso, erro, alerta) | Message |
| Avisos não bloqueantes do usuário | Notification |
| Confirmação de ação crítica (estorno, cancelar entrega, revogar acesso) | Modal + Scrim |
| Carregamento (ex.: gravando a entrega assinada) | Loading |
| Fluxos em etapas (importação de planilha) | Wizard ou Step |
| Agrupar detalhes (histórico de um estudante) | Accordion, Collapse, Tab, Card |
| Dicas curtas | Tooltip (nunca como único meio de transmitir informação essencial) |
| Textos e rótulos | Padrões › Writing (Princípios de UX Writing, Microcopy) |
| Telas no celular (atendimento, modo assinatura, área do estudante) | Fundamentos › Grid; Padrão › Densidade; Navegação |

Diretrizes de escolha:

- **Estados de interface**: toda tela de dados deve prever *carregando*, *vazio*, *erro*, *sem permissão* e *sucesso*; use Fundamentos › Estados para estados interativos (hover, foco, ativo, desabilitado).
- **Mensagens**: erro de campo junto ao campo (padrão do Input/Formulário); erro geral de envio com Message no topo do formulário; sucesso após POST com Message na página de destino (padrão PRG — redirecionar após POST).
- **Modais** apenas para confirmações e decisões curtas. Não use modal para formulários longos nem para conteúdo que precise de URL própria.
- **Tabelas**: cabeçalho obrigatório, nomes de coluna curtos, paginação no servidor para listas grandes, status com Tag + texto (nunca só cor).
- **Ícones** seguem os significados definidos em Iconografia (ex.: lupa = pesquisar, lixeira = excluir, lápis = editar).

## 4. Componentes customizados

**Proibido** criar componente customizado quando existir equivalente oficial adequado (ex.: botão, campo, tabela, modal, mensagem, paginação, abas, tag "próprios").

**Permitido** criar componentes **de domínio** que compõem os oficiais, por exemplo:

- lista de livros pendentes de devolução;
- **modo assinatura**: termo, lista de livros e área para o estudante assinar com o dedo na tela do dispositivo do servidor (sem menus nem dados de outros estudantes);
- leitor de QR code / campo de matrícula para identificar o estudante;
- resumo de estoque por título;
- linha do tempo de movimentações de um estudante.

Requisitos para componentes de domínio:

1. São **composições** de componentes e utilitários oficiais (Card, List/Item, Table, Tag, Button…), implementadas como **parciais EJS** em `src/views/partials/` (não como novos custom elements).
2. Usam apenas **tokens e utilitários** do DS para cor, tipografia, espaçamento, elevação e grid — sem valores "mágicos" (hex, px soltos).
3. CSS próprio mínimo, em arquivo do projeto, com prefixo de projeto (ex.: `.ld-`), **sem** sobrescrever classes `br-*` do DS.
4. Têm o mesmo nível de acessibilidade dos componentes oficiais (seção 6).
5. Antes de criar, registre no PR: qual necessidade, quais componentes oficiais foram avaliados e por que não bastam.

## 5. GovBR-DS × identidade visual do IFC

São coisas diferentes e não devem ser confundidas:

| | GovBR-DS | Identidade visual do IFC |
|---|---|---|
| O que é | Padrão de **interface** do Governo Federal: componentes, fundamentos visuais, comportamento, acessibilidade | **Marca** institucional: logotipo do IFC e de seus campi, regras de aplicação da marca |
| Onde aparece | Toda a interface (layout, cores de interface, tipografia, componentes) | Pontos de identificação: área de logo do Header, documentos emitidos (termo, comprovante), rodapé |
| Quem define | Governo Federal (gov.br/ds) | IFC (Comunicação) e regras da Rede Federal |

Regras:

- **Não** recolorir componentes do DS com as cores da marca do IFC nem trocar a tipografia do DS pela da marca.
- **Não** criar, redesenhar, recortar ou recolorir logotipos. Use apenas arquivos oficiais fornecidos pela Comunicação do IFC, nas proporções e versões fornecidas.
- Uso do logotipo do IFC/campus e da marca gov.br no cabeçalho e nos documentos depende de confirmação (AGENTS.md, DP-11). Até lá, use texto (nome oficial vindo da configuração) no lugar do logo.
- Nome e dados da unidade sempre vêm da **configuração do campus** (banco), nunca escritos no template (AGENTS.md, regra 2).
- Não invente cores, fontes ou regras de marca do IFC: se precisar, peça o manual de identidade visual.

## 6. Acessibilidade, responsividade e teclado

Fontes: https://www.gov.br/ds/acessibilidade, aba **Acessibilidade** de cada componente, guias "Acessibilidade no Código HTML" e "Uso do WAI-ARIA". Meta do projeto: **WCAG 2.1 AA / eMAG**.

- **HTML semântico primeiro**: `header`, `nav`, `main`, `footer`, `h1`–`h6` em ordem, `button` para ações, `a` para navegação, `table` com `th`/`scope`/`caption` para dados. ARIA só quando o HTML nativo não resolve — e conforme a documentação do componente.
- **Um `h1` por página**; `<html lang="pt-BR">`; `<title>` único e descritivo por página.
- **Skip Link** para o conteúdo principal em todas as páginas.
- **Formulários**: todo campo com `<label>` associado; obrigatoriedade indicada em texto; mensagens de erro ligadas ao campo (`aria-describedby` conforme doc do Input) e anunciadas; não apagar o que o usuário digitou ao mostrar erro; foco vai para o resumo de erros ou primeiro campo inválido.
- **Teclado**: tudo operável só com teclado, em ordem lógica; sem armadilhas; modal prende o foco enquanto aberto, fecha com Esc (se a doc do Modal indicar) e devolve o foco ao elemento que o abriu.
- **Foco visível**: nunca remover `outline` sem substituto equivalente; usar o estado de foco do DS.
- **Contraste**: mínimo 4,5:1 para texto normal e 3:1 para texto grande e componentes de interface; use as combinações de cores do DS (Fundamentos › Cores) em vez de criar novas.
- **Cor nunca é a única informação** (status de entrega, pendência, erro): use também texto e/ou ícone.
- **Conteúdo dinâmico** (ex.: estudante identificado pelo QR code, entrega registrada): anunciar com região `aria-live` adequada.
- **Área de assinatura** (canvas): tem rótulo acessível, botões "Limpar" e "Confirmar" operáveis por teclado e instruções em texto; a alternativa para quem não pode assinar está adiada (DV-06).
- **Responsividade**: grid do DS; layout funcional a partir de 320 px de largura sem rolagem horizontal da página; tabelas largas com estratégia da documentação do Table; alvos de toque confortáveis. Atendimento, modo assinatura e área do estudante são **mobile-first**.
- **Zoom** de 200% sem perda de conteúdo ou função.
- **Movimento**: respeitar `prefers-reduced-motion` (Fundamentos › Movimento).

## 7. Segurança na camada de interface (lembretes do AGENTS.md)

- Templates com escape automático (`<%= %>`); `<%- %>` apenas para parciais confiáveis.
- Sem scripts ou estilos inline (CSP); JS em arquivos em `/public/js`.
- Todo formulário POST com token CSRF.
- Ocultar menus/botões **não** é controle de acesso — o backend valida (AGENTS.md, regra 3).
- Nenhum dado pessoal em URL.

## 8. Checklist antes de concluir uma interface

**Design System**
- [ ] Cada componente usado foi conferido na página oficial (abas Visão Geral, Códigos, Acessibilidade) e na versão instalada; links citados no PR.
- [ ] Nenhuma classe, atributo, propriedade, evento ou método foi inventado.
- [ ] Implementação oficial correta (core por padrão; Web Component só com decisão registrada); sem mistura para o mesmo componente.
- [ ] Nenhum componente customizado duplicando um oficial; componentes de domínio justificados e compostos de oficiais.
- [ ] Cores, tipografia, espaçamento e grid via tokens/utilitários do DS; CSS próprio mínimo, prefixado, sem sobrescrever `br-*`.
- [ ] Textos seguem UX Writing/Microcopy do DS (claros, curtos, em português).

**Estados**
- [ ] Estados de carregando, vazio, erro, sem permissão e sucesso implementados.
- [ ] Estados interativos (hover, foco, ativo, desabilitado) conforme Fundamentos › Estados.
- [ ] Ações destrutivas/irreversíveis pedem confirmação (Modal) e informam a consequência.

**Acessibilidade**
- [ ] Navegação completa por teclado; ordem de foco lógica; foco visível.
- [ ] Labels, mensagens de erro associadas, `lang`, títulos de página, hierarquia de headings, Skip Link.
- [ ] Contraste AA verificado; nenhuma informação só por cor.
- [ ] Testado com leitor de tela em pelo menos um fluxo principal (NVDA ou equivalente) e com ferramenta automática (ex.: axe/Lighthouse) sem erros críticos.

**Responsividade**
- [ ] Testado em ~360 px, ~768 px e ≥1280 px; sem rolagem horizontal da página; zoom 200% ok.

**Marca e multi-campus**
- [ ] Nome/dados da unidade vindos da configuração do campus; nada de "Fraiburgo" no template.
- [ ] Nenhum logotipo criado ou alterado; uso de marca conforme decisão registrada.

**Segurança**
- [ ] Escape nos templates, CSRF nos formulários, sem script/estilo inline, sem dados pessoais em URL.
