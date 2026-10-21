# Testes automatizados

> Situação em 2026-10-21: **módulo de acesso implementado e testado** (RF-001 a RF-006 e RF-008): domínio, serviço, banco e rotas HTTP (login com o Google, sessão, CSRF, telas iniciais). Nos testes de rota, só o Google é simulado (provedor falso); a validação real do ID token é da `openid-client` e foi conferida manualmente. As demais funcionalidades estão registradas como **pendentes** (`todo`) e **não contam como aprovadas**.
> Estratégia de testes por risco: [`docs/architecture.md`](architecture.md), seção 12, e [`AGENTS.md`](../AGENTS.md), seção 13.

## Ferramentas

| Ferramenta | Uso |
|---|---|
| `node:test` (Node.js 24) | Executor de testes, asserções, `todo`/`skip` e cobertura (`--experimental-test-coverage`). Sem dependências extras. |
| `pg` 8.23.1 | Acesso ao PostgreSQL (aplicação e testes). |
| PostgreSQL 17 em Docker (`docker/compose.test.yml`) | Banco **exclusivo de testes**: porta `55432`, dados em memória (descartados ao parar o container). |
| `fetch` nativo do Node | Testes de rota (sem `supertest`): o servidor sobe numa porta aleatória e o teste guarda o cookie de sessão. |
| Playwright | **Ainda não instalado**: entra com os fluxos de interface (assinatura no celular). |

## Como executar

Pré-requisitos: Node.js 24+, Docker (para os testes de integração).

```bash
npm ci
```

```bash
npm run db:test:up
```

```bash
npm test
```

| Comando | O que roda |
|---|---|
| `npm test` | Suíte completa (inclui os pendentes, exibidos como `todo`) |
| `npm run test:unit` | Testes sem banco: unitários, documentação e políticas |
| `npm run test:integration` | Testes com o banco de testes (**falham** se o banco não estiver no ar). Aplicam as migrações automaticamente. |
| `npm run test:pending` | Apenas o backlog de testes pendentes |
| `npm run test:coverage` | Suíte completa com relatório de cobertura de `src/` e `test/helpers/` |
| `npm run db:test:up` / `npm run db:test:down` | Sobe / remove o banco de testes. Recrie-o (`down` e `up`) após alterar uma migração já aplicada. |
| `npm run db:migrate` | Aplica migrações em `DATABASE_MIGRATION_URL` (ou `DATABASE_URL`). **Não** é usado pelos testes. |

## Organização

| Pasta / arquivo | Conteúdo |
|---|---|
| `test/helpers/test-db.js` | Conexão ao banco de testes, trava de segurança e `withRollback` |
| `test/helpers/banco-migrado.js` | Sobe o pool e aplica as migrações uma vez por arquivo (advisory lock evita corrida entre arquivos paralelos) |
| `test/helpers/navegador.js` | Cliente HTTP com cookie de sessão e provedor de login falso |
| `test/helpers/fixtures.js` | Dados fictícios: domínios, campi Alfa/Beta/Gama, servidores com cada papel, estudante |
| `test/unit/acesso-dominio.test.js` | Regras puras: domínio de login, escopo do usuário, quem decide e quem concede papéis |
| `test/unit/infra.test.js` | Configuração e montagem do escopo do banco (inclui recusa de identificadores não UUID) |
| `test/unit/test-db-guard.test.js` | Trava que impede rodar testes fora do banco de testes |
| `test/integration/acesso-servico.test.js` | Casos de uso de acesso contra o banco real, com os critérios CA-001 a CA-005 |
| `test/integration/acesso-estudante.test.js` | RF-006: ligação da conta ao cadastro, estudante sem cadastro, bloqueio de funções de servidor e RLS dos cadastros |
| `test/integration/acesso-isolamento.test.js` | Tentativas de violar o isolamento **direto no banco** (RLS), imutabilidade e vazamento de contexto entre conexões |
| `test/integration/rotas-acesso.test.js` | Rotas de ponta a ponta com sessão real: login, regeneração da sessão, state inválido, domínio recusado, XSS, CSRF, escolha de campus, revogação e desativação na hora, logout, estudante |
| `test/integration/rotas-administracao.test.js` | RF-003/RF-004 pela interface: lista e decisão de solicitações, equipe e papéis, com tentativas por URL e formulário forjado (outro campus, sem CSRF, quem não é da equipe) |
| `test/integration/app.test.js` | Servidor HTTP: `GET /saude` (inclusive com banco fora do ar) e 404 padrão |
| `test/integration/test-database.test.js` | Versão e conexão do banco, desfazimento de transações |
| `test/docs/` | Consistência da documentação e regressões de decisões revogadas |
| `test/policy/` | Regras do AGENTS.md verificáveis no repositório (sem `.env`, sem campus ou domínio fixo no código) |
| `test/pending/` | Backlog de testes das funcionalidades ainda não implementadas, com IDs `RN-xx`/`CA-xxx.n` |

## Regras para quem escreve testes

- **Somente dados fictícios.** Fixtures com no mínimo dois campi (AGENTS.md, seção 13.1).
- **Nunca** usar `DATABASE_URL`. O banco vem de `TEST_DATABASE_URL` ou do padrão local, e `assertSafeTestDatabase` recusa host remoto e banco cujo nome não termine em `_test`.
- Cada teste roda em `withRollback`: os serviços recebem o client da transação, e `comContexto` usa `SAVEPOINT` em vez de abrir outra transação. Tudo é desfeito ao final.
- Comando que **deve falhar** dentro de um teste roda em `SAVEPOINT` próprio; senão o PostgreSQL aborta a transação e os comandos seguintes nem são testados.
- Testes de isolamento chamam o banco pelo papel `livros_app` (via `comContexto`); o usuário dono do banco de testes ignora RLS e só deve ser usado para montar fixtures.
- Teste citando o ID da regra ou do critério que verifica (ex.: `RN-27`, `CA-042.4`).
- Ao implementar uma funcionalidade, **mova** o item correspondente de `test/pending/` para `test/unit/` ou `test/integration/` com asserções reais.
- Funcionalidade sem código → `test.todo`; verificação que depende de código ainda inexistente → `t.skip('PENDENTE: …')`. Nenhum dos dois conta como aprovado.

## Resultado da última execução (2026-10-21, execução limpa)

`npm run db:test:down` → `npm ci` → `npm run db:test:up` → `npm test`, código de saída 0:

| Métrica | Quantidade |
|---|---|
| Aprovados | 134 |
| Falhos | 0 |
| Ignorados (`skip`) | 0 |
| Pendentes (`todo`, funcionalidades não implementadas) | 69 |
| Total | 203 |

Cobertura (`npm run test:coverage`), incluindo `test/helpers/`: 98,0% das linhas e 95,1% dos ramos; `servico.js` e `dominio.js` do acesso com 100% das linhas. Lacunas conhecidas:

- `src/infra/db/migrar.js`: o caminho de falha de uma migração (rollback) não é testado; o corpo de aplicação só é coberto quando o banco está vazio.
- `src/modulos/acesso/servico.js`: o repasse de erros de banco inesperados na solicitação de acesso.
- `src/server.js` e `src/infra/db/cli-seed.js`: pontos de entrada, verificados manualmente no ambiente dev, sem teste automatizado.
- `src/infra/db/cli-migrar.js`: comando de linha, sem teste.

Cobertura de linhas **não** prova correção: ela mostra o que foi executado, não se cada regra foi verificada em todos os casos.

## Defeitos encontrados pelos testes

| Data | Defeito | Correção |
|---|---|---|
| 2026-10-21 | `CHECK` da recusa de solicitação aceitava motivo `NULL` (`length(NULL)` é `NULL`, e `CHECK` nulo passa). O mesmo padrão estava no esboço de `devolucao_item` do AGENTS.md. | `COALESCE(length(trim(...)), 0) > 0` na migração 001 e no AGENTS.md; teste de regressão com `NULL`, vazio e só espaços. |

## Limitações conhecidas

- A cobertura nativa do Node ainda é experimental (`--experimental-test-coverage`). Por padrão ela exclui arquivos em pastas `test/`; o script informa `--test-coverage-exclude` explicitamente.
- O fluxo OIDC real (assinatura e validade do ID token) não é testado automaticamente: os testes de rota usam um provedor falso. Foi verificado o redirecionamento ao Google (PKCE, state, nonce) e o login real é testado manualmente.
- Os testes de documentação verificam estrutura e referências, não se o conteúdo das regras está correto.
- Testes de integração exigem Docker; sem ele, falham com a mensagem "Banco de testes indisponível".
