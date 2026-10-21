# Testes automatizados

> Situação em 2026-10-21: **infraestrutura pronta; a aplicação ainda não tem código.** Os testes atuais verificam a infraestrutura de testes, a documentação (que é a especificação seguida pelos agentes) e políticas do repositório. Os testes das funcionalidades estão registrados como **pendentes** (`todo`) e **não contam como aprovados**.
> Estratégia de testes por risco: [`docs/architecture.md`](architecture.md), seção 12, e [`AGENTS.md`](../AGENTS.md), seção 13.

## Ferramentas

| Ferramenta | Uso |
|---|---|
| `node:test` (Node.js 24) | Executor de testes, asserções, `todo`/`skip` e cobertura (`--experimental-test-coverage`). Sem dependências extras. |
| `pg` 8.23.1 | Acesso ao PostgreSQL nos testes de integração. |
| PostgreSQL 17 em Docker (`docker/compose.test.yml`) | Banco **exclusivo de testes**: porta `55432`, dados em memória (descartados ao parar o container). |
| `supertest` e Playwright | **Ainda não instalados**: entram quando houver rotas HTTP e telas. |

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
| `npm run test:integration` | Testes com o banco de testes (**falham** se o banco não estiver no ar) |
| `npm run test:pending` | Apenas o backlog de testes pendentes |
| `npm run test:coverage` | Suíte completa com relatório de cobertura de `src/` e `test/helpers/` |
| `npm run db:test:up` / `npm run db:test:down` | Sobe / remove o banco de testes |

## Organização

| Pasta | Conteúdo | Situação |
|---|---|---|
| `test/helpers/` | `test-db.js`: conexão ao banco de testes, trava de segurança e `withRollback` | Pronto |
| `test/unit/` | Testes unitários (hoje: a trava de segurança do banco de testes) | Pronto |
| `test/integration/` | Banco real: versão, conexão e desfazimento de transações | Pronto |
| `test/docs/` | Consistência da documentação e regressões de decisões revogadas | Pronto |
| `test/policy/` | Regras do AGENTS.md verificáveis no repositório (sem `.env`, sem campus/domínio fixo no código) | Parcial: 2 testes aguardam código |
| `test/pending/` | Backlog de 75 testes das funcionalidades, com IDs `RN-xx`/`CA-xxx.n` | Pendente |

## Regras para quem escreve testes

- **Somente dados fictícios.** Fixtures com no mínimo dois campi (AGENTS.md, seção 13.1).
- **Nunca** usar `DATABASE_URL`. O banco vem de `TEST_DATABASE_URL` ou do padrão local, e `assertSafeTestDatabase` recusa host remoto e banco cujo nome não termine em `_test`.
- Cada teste prepara seus dados e os desfaz com `withRollback` (transação sempre revertida) ou equivalente. Nada de depender da ordem de execução nem de `sleep`.
- Teste citando o ID da regra ou do critério que verifica (ex.: `RN-27`, `CA-042.4`).
- Ao implementar uma funcionalidade, **mova** o item correspondente de `test/pending/` para `test/unit/` ou `test/integration/` com asserções reais. Não apague pendentes sem implementar o teste.
- Funcionalidade sem código → `test.todo`; verificação que depende de código ainda inexistente → `t.skip('PENDENTE: …')`. Nenhum dos dois conta como aprovado.
- Não simular a aplicação inteira: regras de domínio testadas como funções puras; repositórios, permissões e isolamento testados contra o PostgreSQL real.

## Resultado da última execução (2026-10-21, execução limpa)

`npm ci` → `npm run db:test:up` → `npm test`, código de saída 0:

| Métrica | Quantidade |
|---|---|
| Aprovados | 22 |
| Falhos | 0 |
| Ignorados (`skip`, aguardando código) | 2 |
| Pendentes (`todo`, funcionalidades não implementadas) | 75 |
| Total | 99 |

Cobertura (`npm run test:coverage`): `test/helpers/test-db.js` 100% de linhas, ramos e funções. **Não há código de aplicação em `src/`**, portanto não há cobertura de regras de negócio, permissões ou isolamento: esse número não indica correção do sistema.

## Limitações conhecidas

- A cobertura nativa do Node ainda é experimental (`--experimental-test-coverage`). Por padrão ela exclui arquivos em pastas `test/`; o script informa `--test-coverage-exclude` explicitamente para medir `test/helpers/`.
- Os testes de documentação verificam estrutura e referências, não se o conteúdo das regras está correto.
- Testes de integração exigem Docker; sem ele, falham com a mensagem "Banco de testes indisponível".
