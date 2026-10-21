# Livros Didáticos — IFC

Gestão de entrega e devolução de livros didáticos do Instituto Federal Catarinense, multi-campus, com implantação inicial no Campus Fraiburgo.

Documentação: [`AGENTS.md`](AGENTS.md) (regras e decisões), [`docs/requirements.md`](docs/requirements.md), [`docs/business-rules.md`](docs/business-rules.md), [`docs/architecture.md`](docs/architecture.md), [`docs/testing.md`](docs/testing.md).

> Situação: login com o Google, escolha de campus pelo servidor e área inicial do estudante funcionando. Aprovação de acessos pela tela, estoque, entregas e devoluções ainda não existem.

## Desenvolvimento com Docker

Pré-requisito: Docker com Docker Compose. Node.js local é opcional (só para rodar testes fora do container).

```bash
npm run dev:up
```

Na primeira vez, o container instala as dependências, aplica as migrações e carrega dados fictícios (cerca de 1 minuto). Depois:

- Aplicação: <http://127.0.0.1:3000/saude>
- Banco de desenvolvimento: `127.0.0.1:55433`, banco `livros_dev` (usuário `livros`, senha `livros`, apenas local)
- Alterações em `src/` reiniciam o servidor automaticamente.

| Comando | O que faz |
|---|---|
| `npm run dev:up` | Sobe banco e aplicação em segundo plano |
| `npm run dev:logs` | Acompanha os logs da aplicação |
| `npm run dev:down` | Para o ambiente, mantendo os dados |
| `npm run dev:reset` | Para o ambiente e **apaga** o banco de desenvolvimento e as dependências do container |

Sem `docker compose up` de novo, mudanças em `package.json` não são instaladas: rode `docker compose restart app`. Mudanças em `db/migrations` ou `db/seeds` também são aplicadas ao reiniciar o container `app`.

### Login com o Google

Copie `.env.example` para `.env` e preencha as credenciais do cliente OAuth (URI de redirecionamento `http://localhost:3000/auth/callback`). O `compose.yaml` lê o `.env`. Acesse **<http://localhost:3000>** (use `localhost`, não `127.0.0.1`, para o retorno do Google funcionar).

`BOOTSTRAP_ADMIN_EMAILS` define quem vira o primeiro administrador institucional no primeiro login, só enquanto não houver nenhum. Depois de alterar o `.env`, recrie o container: `docker compose up -d`.

### Como o ambiente está montado

| Serviço | Imagem | Observação |
|---|---|---|
| `db` | `postgres:17-alpine` | Dados persistentes no volume `pgdata`. Na criação, `docker/dev/initdb/` cria o papel `livros_app` e o login `livros_app_dev`. |
| `app` | `node:24-alpine` | Código montado de `./`; `node_modules` em volume próprio (binários de Linux). Recarga com `nodemon --legacy-watch` (polling, necessário com arquivos do Windows). |

A aplicação conecta como `livros_app_dev`, que **não** é dono das tabelas e só tem os privilégios do papel `livros_app`, sujeito ao isolamento entre campi (RLS), como em produção. Migrações e seeds usam o dono do banco (`livros`).

Dados de desenvolvimento (`db/seeds/dev/`): Campus Fraiburgo e um campus fictício, para exercitar o uso multi-campus desde o início. Nunca carregar dados reais de estudantes (AGENTS.md, regra 15).

## Testes

Os testes usam um banco separado (porta `55432`, em memória). Veja [`docs/testing.md`](docs/testing.md).

```bash
npm run db:test:up
```

```bash
npm test
```
