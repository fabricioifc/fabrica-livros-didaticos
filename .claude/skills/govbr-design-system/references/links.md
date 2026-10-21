# Links oficiais do GovBR-DS

Levantados em 2026-10-21 a partir do menu de https://www.gov.br/ds/. O site é uma SPA: se um link não abrir, comece pela página inicial e navegue pelo menu. Os links podem mudar; a fonte de verdade é sempre o site oficial.

## Começar
- Página inicial: https://www.gov.br/ds/home
- Padrão Mínimo: https://www.gov.br/ds/introducao/padrao-minimo
- Princípios: https://www.gov.br/ds/introducao/principios
- Fluxo de Desenvolvimento (instalação, core × Web Components, dependências externas): https://www.gov.br/ds/como-comecar/fluxo-dev
- Acessibilidade: https://www.gov.br/ds/acessibilidade
- Downloads (assets, fonte Rawline): https://www.gov.br/ds/downloads/assets
- Release Notes: https://www.gov.br/ds/release-notes

## Fundamentos visuais
`https://www.gov.br/ds/fundamentos-visuais/<item>` — `visao-geral`, `cores`, `iconografia`, `espacamento`, `estados`, `ilustracao`, `grid`, `superficie`, `elevacao`, `movimento`, `tipografia`.

## Padrões
- Design: `https://www.gov.br/ds/padroes/design/<item>` — `ajuda-comunicacao`, `densidade`, `contentoverflow`, `dropdown`, `formulario`, `grafico`, `onboarding`, `collapse`, `navegacao`, `emptystates`.
- Writing: https://www.gov.br/ds/padroes/writing/principios-writing · https://www.gov.br/ds/padroes/writing/microcopy

## Componentes
`https://www.gov.br/ds/components/<nome>` — abas **Visão Geral**, **Códigos**, **Acessibilidade**.

`accordion`, `avatar`, `breadcrumb`, `button`, `card`, `carousel`, `checkbox`, `cookiebar`, `datetimepicker`, `divider`, `footer`, `header`, `input`, `item`, `list`, `loading`, `magicbutton`, `menu`, `message`, `modal`, `notification`, `pagination`, `radio`, `scrim`, `select`, `signin`, `skiplink`, `step`, `switch`, `tab`, `table`, `tag`, `textarea`, `tooltip`, `upload`, `wizard`.

## Templates
- Base: https://www.gov.br/ds/templates/base
- Erro: https://www.gov.br/ds/templates/erro

## Utilitários JS (core)
`https://www.gov.br/ds/utilitarios/js/<item>` — `accordion`, `checkgroup`, `collapse`, `dropdown`, `scrim`, `tooltip`.

## Guias
`https://www.gov.br/ds/guias/<item>` — `boas-praticas-de-css`, `boas-praticas-de-html`, `acessibilidade-html`, `codificacao-javascript`, `wai-aria`, `navegadores-suportados`, `construcao-de-componentes`, `migracao-2x-3x`.

## Pacotes npm oficiais
| Pacote | Versão `latest` em 2026-10-21 | Observação |
|---|---|---|
| `@govbr-ds/core` | 3.7.0 | CSS/JS; arquivos em `dist/` (`core.min.css`, `core-lite.min.css`, `core-tokens.min.css`, `core.min.js`, `core-init.min.js`…). |
| `@govbr-ds/webcomponents` | 2.4.0 | Custom elements `br-*` (Stencil); peers: `@govbr-ds/core`, `@floating-ui/dom`, `date-fns`, `iconify-icon`. Tipos em `dist/types/`. Documentação: https://www.gov.br/ds/webcomponents |

Confira sempre a versão realmente instalada no projeto antes de seguir qualquer exemplo.

## Comunidade
- Wiki: https://gov.br/ds/wiki/
- GitLab: https://gitlab.com/govbr-ds
