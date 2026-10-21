-- 003 — Sessões HTTP (express-session + connect-pg-simple). AGENTS.md seção 5.4.
-- Estrutura exigida pelo connect-pg-simple; a sessão guarda só o id do usuário e controles do login.
CREATE TABLE sessao (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX ix_sessao_expire ON sessao (expire);

GRANT SELECT, INSERT, UPDATE, DELETE ON sessao TO livros_app;
