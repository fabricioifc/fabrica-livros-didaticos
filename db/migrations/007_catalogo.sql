-- 007 — Catálogo de títulos compartilhado por todos os campi (RF-020; RN-73 a RN-75; D-03).
-- Global: sem campus_id. Estoque, adoções e movimentações por campus entram em migrações próprias.

CREATE TABLE componente_curricular (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(trim(nome)) > 0 AND nome = trim(nome))
);
CREATE UNIQUE INDEX ux_componente_nome ON componente_curricular (lower(nome));

CREATE TABLE titulo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isbn13          char(13) CHECK (isbn13 ~ '^97[89][0-9]{10}$'),   -- NULL: material sem ISBN
  codigo_programa text CHECK (codigo_programa IS NULL OR length(trim(codigo_programa)) > 0),   -- ex.: código PNLD
  titulo          text NOT NULL CHECK (length(trim(titulo)) > 0),
  autores         text NOT NULL CHECK (length(trim(autores)) > 0),
  editora         text,
  edicao          text,
  volume          text,
  ano_publicacao  smallint CHECK (ano_publicacao BETWEEN 1900 AND 2100),
  componente_id   uuid REFERENCES componente_curricular(id),
  abrangencia     text NOT NULL CHECK (abrangencia IN ('SERIE_ESPECIFICA', 'ENSINO_MEDIO_COMPLETO')),
  serie           smallint CHECK (serie BETWEEN 1 AND 4),          -- DP-17
  mesclado_em_id  uuid REFERENCES titulo(id),                      -- RF-021 (Posterior): deduplicação sem apagar
  criado_por      uuid NOT NULL REFERENCES usuario(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  -- RN-74 / CA-020.2: série obrigatória para série específica e ausente para ensino médio completo.
  CHECK ((abrangencia = 'SERIE_ESPECIFICA') = (serie IS NOT NULL))
);
-- RN-73 / CA-020.1: ISBN único no IFC.
CREATE UNIQUE INDEX ux_titulo_isbn ON titulo (isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX ix_titulo_busca ON titulo (lower(titulo));

GRANT SELECT, INSERT ON componente_curricular TO livros_app;
GRANT SELECT, INSERT, UPDATE ON titulo TO livros_app;

-- Leitura: o catálogo é compartilhado (o serviço restringe a servidores com acesso).
-- Criação: quem tem campus no escopo ou administração institucional (o serviço exige Administração do campus).
-- Alteração: só administração institucional (RN-75, proposta pendente de DP-05).
ALTER TABLE componente_curricular ENABLE ROW LEVEL SECURITY;
ALTER TABLE componente_curricular FORCE ROW LEVEL SECURITY;
CREATE POLICY p_componente_leitura ON componente_curricular FOR SELECT USING (true);
CREATE POLICY p_componente_criacao ON componente_curricular FOR INSERT
  WITH CHECK (app_admin_institucional() OR cardinality(app_campi()) > 0);

ALTER TABLE titulo ENABLE ROW LEVEL SECURITY;
ALTER TABLE titulo FORCE ROW LEVEL SECURITY;
CREATE POLICY p_titulo_leitura ON titulo FOR SELECT USING (true);
CREATE POLICY p_titulo_criacao ON titulo FOR INSERT
  WITH CHECK ((app_admin_institucional() OR cardinality(app_campi()) > 0) AND criado_por = app_usuario_id());
CREATE POLICY p_titulo_alteracao ON titulo FOR UPDATE
  USING (app_admin_institucional()) WITH CHECK (app_admin_institucional());

-- Quem criou e quando não mudam.
CREATE FUNCTION trg_titulo_autoria_fixa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.criado_por, NEW.criado_em) IS DISTINCT FROM (OLD.criado_por, OLD.criado_em) THEN
    RAISE EXCEPTION 'autoria do título não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER titulo_autoria_fixa BEFORE UPDATE ON titulo FOR EACH ROW EXECUTE FUNCTION trg_titulo_autoria_fixa();
