-- 001 — Módulo de acesso: instituição, domínios, campi, usuários, solicitações,
-- atribuições e auditoria. Isolamento por campus reforçado com Row-Level Security.
-- Referências: AGENTS.md seções 5, 6, 7.2 e 9; docs/requirements.md RF-001 a RF-005.

-- Papel usado pela aplicação em TODA transação (SET LOCAL ROLE livros_app).
-- Sem login próprio e sem BYPASSRLS; o usuário de login da aplicação é membro dele.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'livros_app') THEN
    CREATE ROLE livros_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO livros_app;

-- Contexto da requisição, definido por comContexto() com set_config(..., true).
CREATE FUNCTION app_usuario_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.usuario_id', true), '')::uuid
$$;
CREATE FUNCTION app_campi() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.campi', true), '')::uuid[], '{}'::uuid[])
$$;
CREATE FUNCTION app_escopo_institucional() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.escopo_institucional', true), '') = 'true'
$$;
CREATE FUNCTION app_admin_institucional() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.admin_institucional', true), '') = 'true'
$$;

-- ===================== GLOBAIS =====================
CREATE TABLE instituicao (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome_oficial     text NOT NULL,
  sigla            text NOT NULL,
  cnpj             char(14),
  logotipo_arquivo text
);

CREATE TYPE tipo_usuario AS ENUM ('SERVIDOR', 'ESTUDANTE');

CREATE TABLE dominio_permitido (
  dominio text PRIMARY KEY CHECK (dominio = lower(dominio) AND dominio !~ '[@\s]'),
  tipo    tipo_usuario NOT NULL,
  ativo   boolean NOT NULL DEFAULT true
);

CREATE TABLE campus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       text NOT NULL UNIQUE,
  nome_oficial text NOT NULL,
  nome_curto   text NOT NULL,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub   text NOT NULL UNIQUE,
  email        text NOT NULL UNIQUE CHECK (email = lower(email)),
  nome         text NOT NULL,
  tipo         tipo_usuario NOT NULL,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  ultimo_login timestamptz
);

-- ===================== POR CAMPUS =====================
CREATE TABLE campus_configuracao (
  campus_id         uuid PRIMARY KEY REFERENCES campus(id),
  endereco          text,
  cidade            text,
  uf                char(2),
  cep               char(8),
  setor_responsavel text,
  email_setor       text,
  telefone          text,
  permite_entrega_com_pendencia boolean NOT NULL DEFAULT true   -- RN-21
);

CREATE TABLE solicitacao_acesso (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  campus_id     uuid NOT NULL REFERENCES campus(id),   -- campus DECLARADO: não concede nada
  status        text NOT NULL DEFAULT 'PENDENTE'
                CHECK (status IN ('PENDENTE', 'APROVADA', 'RECUSADA', 'CANCELADA')),
  solicitada_em timestamptz NOT NULL DEFAULT now(),
  decidida_por  uuid REFERENCES usuario(id),
  decidida_em   timestamptz,
  motivo_recusa text,
  -- COALESCE: com motivo NULL, length() é NULL e um CHECK NULL seria aceito.
  CHECK (status <> 'RECUSADA' OR COALESCE(length(trim(motivo_recusa)), 0) > 0),
  CHECK ((status IN ('PENDENTE', 'CANCELADA')) = (decidida_por IS NULL))
);
CREATE UNIQUE INDEX ux_solicitacao_pendente ON solicitacao_acesso (usuario_id) WHERE status = 'PENDENTE';
CREATE INDEX ix_solicitacao_campus ON solicitacao_acesso (campus_id, status);

CREATE TYPE papel AS ENUM ('ADMIN_INSTITUCIONAL', 'ADMIN_CAMPUS', 'OPERADOR', 'CONSULTA');

CREATE TABLE atribuicao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  papel         papel NOT NULL,
  campus_id     uuid REFERENCES campus(id),             -- NULL = institucional
  concedida_por uuid REFERENCES usuario(id),            -- NULL apenas no bootstrap (RF-005)
  concedida_em  timestamptz NOT NULL DEFAULT now(),
  revogada_por  uuid REFERENCES usuario(id),
  revogada_em   timestamptz,
  CHECK (
    (papel = 'ADMIN_INSTITUCIONAL' AND campus_id IS NULL) OR
    (papel IN ('ADMIN_CAMPUS', 'OPERADOR') AND campus_id IS NOT NULL) OR
    (papel = 'CONSULTA')
  ),
  CHECK ((revogada_em IS NULL) = (revogada_por IS NULL))
);
CREATE UNIQUE INDEX ux_atribuicao_ativa
  ON atribuicao (usuario_id, papel, COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revogada_em IS NULL;
CREATE INDEX ix_atribuicao_usuario ON atribuicao (usuario_id) WHERE revogada_em IS NULL;
CREATE INDEX ix_atribuicao_campus ON atribuicao (campus_id) WHERE revogada_em IS NULL;

-- Somente servidores recebem atribuições.
CREATE FUNCTION trg_atribuicao_somente_servidor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT tipo FROM usuario WHERE id = NEW.usuario_id) <> 'SERVIDOR' THEN
    RAISE EXCEPTION 'atribuições são exclusivas de servidores' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER atribuicao_somente_servidor
  BEFORE INSERT ON atribuicao FOR EACH ROW EXECUTE FUNCTION trg_atribuicao_somente_servidor();

-- Atribuição só pode ser revogada (uma vez); os demais campos são imutáveis.
CREATE FUNCTION trg_atribuicao_somente_revogacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revogada_em IS NOT NULL
     OR (NEW.id, NEW.usuario_id, NEW.papel, NEW.campus_id, NEW.concedida_por, NEW.concedida_em)
        IS DISTINCT FROM
        (OLD.id, OLD.usuario_id, OLD.papel, OLD.campus_id, OLD.concedida_por, OLD.concedida_em) THEN
    RAISE EXCEPTION 'atribuição só pode ser revogada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER atribuicao_somente_revogacao
  BEFORE UPDATE ON atribuicao FOR EACH ROW EXECUTE FUNCTION trg_atribuicao_somente_revogacao();

CREATE TABLE auditoria (
  id          bigserial PRIMARY KEY,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  usuario_id  uuid REFERENCES usuario(id),
  campus_id   uuid REFERENCES campus(id),                -- NULL para ações institucionais
  acao        text NOT NULL,
  entidade    text NOT NULL,
  entidade_id text NOT NULL,
  antes       jsonb,
  depois      jsonb
);
CREATE INDEX ix_auditoria_campus_data ON auditoria (campus_id, ocorrido_em);

-- ===================== PRIVILÉGIOS =====================
GRANT SELECT ON instituicao, dominio_permitido, campus TO livros_app;
GRANT INSERT, UPDATE ON instituicao, dominio_permitido, campus TO livros_app;
GRANT SELECT, INSERT, UPDATE ON usuario, campus_configuracao, solicitacao_acesso TO livros_app;
GRANT SELECT, INSERT, UPDATE ON atribuicao TO livros_app;     -- UPDATE só para revogar (trigger)
GRANT SELECT, INSERT ON auditoria TO livros_app;              -- auditoria é imutável
GRANT USAGE ON SEQUENCE auditoria_id_seq TO livros_app;

-- ===================== ROW-LEVEL SECURITY =====================
ALTER TABLE campus_configuracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_configuracao FORCE ROW LEVEL SECURITY;
CREATE POLICY p_campus_configuracao ON campus_configuracao
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()))
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()));

ALTER TABLE solicitacao_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitacao_acesso FORCE ROW LEVEL SECURITY;
-- O próprio servidor vê e cria a sua solicitação; administradores veem as do seu campus.
CREATE POLICY p_solicitacao_leitura ON solicitacao_acesso FOR SELECT
  USING (usuario_id = app_usuario_id() OR app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_solicitacao_criacao ON solicitacao_acesso FOR INSERT
  WITH CHECK (usuario_id = app_usuario_id() AND status = 'PENDENTE');
CREATE POLICY p_solicitacao_decisao ON solicitacao_acesso FOR UPDATE
  USING (app_admin_institucional() OR campus_id = ANY (app_campi()) OR usuario_id = app_usuario_id())
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi())
              OR (usuario_id = app_usuario_id() AND status = 'CANCELADA'));

ALTER TABLE atribuicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE atribuicao FORCE ROW LEVEL SECURITY;
CREATE POLICY p_atribuicao_leitura ON atribuicao FOR SELECT
  USING (usuario_id = app_usuario_id() OR app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_atribuicao_escrita ON atribuicao FOR INSERT
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_atribuicao_revogacao ON atribuicao FOR UPDATE
  USING (app_admin_institucional() OR campus_id = ANY (app_campi()))
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()));

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY p_auditoria_leitura ON auditoria FOR SELECT
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()));
-- Cada um registra apenas as próprias ações; processos do sistema usam escopo institucional.
CREATE POLICY p_auditoria_registro ON auditoria FOR INSERT
  WITH CHECK (usuario_id IS NOT DISTINCT FROM app_usuario_id() OR app_escopo_institucional());
