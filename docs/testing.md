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
| `test/integration/campi-servico.test.js` | RF-010/RF-011: criação, situação e configuração de campi; reforço no banco (RLS e trigger da migração 004) |
| `test/integration/rotas-campi.test.js` | RF-010/RF-011 pela interface, com tentativas de código forjado e campus de outro por URL |
| `test/unit/campi-dominio.test.js` | Validação e normalização dos dados de campus |
| `test/integration/oferta-servico.test.js` | RF-012: anos letivos e cursos; um ano por campus; RLS; sem exclusão; turmas não existem mais (migração 006) |
| `test/integration/rotas-oferta.test.js` | RF-012 pela interface, com edição de ano letivo e curso por URL de outro campus |
| `test/unit/oferta-dominio.test.js` | Validação do ano, das datas e do nome do curso |
| `test/integration/catalogo-servico.test.js` | RF-020: cadastro, ISBN repetido (inclusive como ISBN-10), série específica, busca, permissões (RN-75) e reforço no banco |
| `test/integration/rotas-catalogo.test.js` | RF-020 pela interface: CSRF, ISBN repetido com link, erros juntos, 403/404, XSS |
| `test/unit/catalogo-dominio.test.js` | ISBN-10/13 (dígitos e conversão) e regra de abrangência/série |
| `test/integration/estoque-servico.test.js` | RF-025 a RF-028: entrada, baixa e ajuste, saldo insuficiente, consistência com o livro-razão, isolamento entre campi, permissões, RLS, imutabilidade e duas baixas simultâneas |
| `test/integration/rotas-estoque.test.js` | Estoque pela interface: CSRF, mensagens nos campos (422), 403 para Consulta, 404 para outro campus |
| `test/unit/estoque-dominio.test.js` | Validação das movimentações (quantidade, origem, justificativa, sentido do ajuste) e saldo suficiente |
| `test/integration/estudantes-servico.test.js` | RF-030 a RF-033: cadastro, edição, unicidade no IFC, um vínculo ativo, importação tudo ou nada (inclusive Windows-1252), consulta, encerramento, isolamento entre campi, RLS e imutabilidade |
| `test/integration/rotas-estudantes.test.js` | Estudantes pela interface: CSRF (inclusive no envio de arquivo), busca sem dados pessoais na URL, importação com erros por linha, 403/404 |
| `test/unit/estudantes-dominio.test.js` | Leitura do CSV (separador, aspas, codificação, cabeçalho), série, domínio do e-mail e encerramento |
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
| Aprovados | 258 |
| Falhos | 0 |
| Ignorados (`skip`) | 0 |
| Pendentes (`todo`, funcionalidades não implementadas) | 63 |
| Total | 321 |

Cobertura (`npm run test:coverage`), incluindo `test/helpers/`: 98,0% das linhas e 95,1% dos ramos; `servico.js` e `dominio.js` do acesso com 100% das linhas. Lacunas conhecidas:

- `src/infra/db/migrar.js`: o caminho de falha de uma migração (rollback) não é testado; o corpo de aplicação só é coberto quando o banco está vazio.
- `src/modulos/acesso/servico.js`: o repasse de erros de banco inesperados na solicitação de acesso.
- `src/server.js` e `src/infra/db/cli-seed.js`: pontos de entrada, verificados manualmente no ambiente dev, sem teste automatizado.
- `src/infra/db/cli-migrar.js`: comando de linha, sem teste.

Cobertura de linhas **não** prova correção: ela mostra o que foi executado, não se cada regra foi verificada em todos os casos.

## Defeitos encontrados pelos testes

| Data | Defeito | Correção |
|---|---|---|
| 2026-10-21 | Baixa com saldo suficiente era recusada pelo banco: no `INSERT ... ON CONFLICT DO UPDATE`, o `CHECK (disponivel >= 0)` é avaliado no registro proposto (quantidade negativa) antes de resolver o conflito. | O gatilho faz `UPDATE` primeiro e só insere a linha de estoque se ela não existir; teste de concorrência. |
| 2026-10-21 | No cadastro de título, com ISBN inválido o erro da série não aparecia: o zod não executa refinamentos de objeto quando um campo falha, então o usuário só via um erro por vez. | Validação da abrangência/série em esquema separado e erros mesclados; teste de regressão. |
| 2026-10-21 | `CHECK` da recusa de solicitação aceitava motivo `NULL` (`length(NULL)` é `NULL`, e `CHECK` nulo passa). O mesmo padrão estava no esboço de `devolucao_item` do AGENTS.md. | `COALESCE(length(trim(...)), 0) > 0` na migração 001 e no AGENTS.md; teste de regressão com `NULL`, vazio e só espaços. |

## Limitações conhecidas

- **Falha intermitente não identificada (2026-10-21):** em uma execução da suíte, 1 teste falhou; a saída não foi preservada e a falha não se repetiu em 13 execuções seguidas. Suspeita: testes de rota gravam dados de fato e rodam em paralelo com outros arquivos. Se reaparecer, guarde a saída completa (`npm test > saida.txt 2>&1`) antes de rodar de novo.
- Testes que criam ou revogam administradores institucionais gravados de fato devem usar `criarAdminInstitucionalConfirmado` / `travarAdminsInstitucionais` (fixtures), o mesmo bloqueio do serviço, para não interferir nos testes de RF-005.

- A cobertura nativa do Node ainda é experimental (`--experimental-test-coverage`). Por padrão ela exclui arquivos em pastas `test/`; o script informa `--test-coverage-exclude` explicitamente.
- O fluxo OIDC real (assinatura e validade do ID token) não é testado automaticamente: os testes de rota usam um provedor falso. Foi verificado o redirecionamento ao Google (PKCE, state, nonce) e o login real é testado manualmente.
- Os testes de documentação verificam estrutura e referências, não se o conteúdo das regras está correto.
- Testes de integração exigem Docker; sem ele, falham com a mensagem "Banco de testes indisponível".
