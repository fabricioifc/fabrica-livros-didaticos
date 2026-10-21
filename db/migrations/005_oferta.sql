-- 005 — Oferta do campus: períodos letivos, cursos e turmas (RF-012).
-- Tabelas por campus: campus_id NOT NULL, UNIQUE (campus_id, id), FKs compostas e RLS (AGENTS.md 7 e 9).
-- Sem DELETE para a aplicação: correções por edição; curso sai de uso por desativação.

CREATE TABLE periodo_letivo (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES campus(id),
  rotulo    text NOT NULL CHECK (length(trim(rotulo)) > 0 AND rotulo = trim(rotulo)),
  inicio    date NOT NULL,
  fim       date NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim > inicio),
  UNIQUE (campus_id, id)
);
CREATE UNIQUE INDEX ux_periodo_rotulo ON periodo_letivo (campus_id, lower(rotulo));
CREATE INDEX ix_periodo_campus_datas ON periodo_letivo (campus_id, inicio, fim);

CREATE TABLE curso (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES campus(id),
  nome      text NOT NULL CHECK (length(trim(nome)) > 0 AND nome = trim(nome)),
  ativo     boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, id)
);
CREATE UNIQUE INDEX ux_curso_nome ON curso (campus_id, lower(nome));

CREATE TABLE turma (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id         uuid NOT NULL,
  curso_id          uuid NOT NULL,
  periodo_letivo_id uuid NOT NULL,
  nome              text NOT NULL CHECK (length(trim(nome)) > 0 AND nome = trim(nome)),
  serie             smallint NOT NULL CHECK (serie BETWEEN 1 AND 4),   -- DP-17: cursos integrados de até 4 anos
  criado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, id),
  -- CA-012.1: curso e período obrigatoriamente do MESMO campus da turma.
  FOREIGN KEY (campus_id, curso_id)          REFERENCES curso (campus_id, id),
  FOREIGN KEY (campus_id, periodo_letivo_id) REFERENCES periodo_letivo (campus_id, id)
);
CREATE UNIQUE INDEX ux_turma_nome ON turma (campus_id, periodo_letivo_id, lower(nome));
CREATE INDEX ix_turma_campus_curso ON turma (campus_id, curso_id);

-- A turma não muda de campus, curso nem período depois de criada (vínculos e entregas dependerão dela).
CREATE FUNCTION trg_turma_estrutura_fixa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.campus_id, NEW.curso_id, NEW.periodo_letivo_id) IS DISTINCT FROM (OLD.campus_id, OLD.curso_id, OLD.periodo_letivo_id) THEN
    RAISE EXCEPTION 'campus, curso e período da turma não podem ser alterados' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER turma_estrutura_fixa BEFORE UPDATE ON turma FOR EACH ROW EXECUTE FUNCTION trg_turma_estrutura_fixa();

-- Período e curso também não mudam de campus.
CREATE FUNCTION trg_campus_fixo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.campus_id IS DISTINCT FROM OLD.campus_id THEN
    RAISE EXCEPTION 'o campus do registro não pode ser alterado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER periodo_campus_fixo BEFORE UPDATE ON periodo_letivo FOR EACH ROW EXECUTE FUNCTION trg_campus_fixo();
CREATE TRIGGER curso_campus_fixo BEFORE UPDATE ON curso FOR EACH ROW EXECUTE FUNCTION trg_campus_fixo();

GRANT SELECT, INSERT, UPDATE ON periodo_letivo, curso, turma TO livros_app;

-- Leitura: campi do escopo ou institucional. Escrita: campi do escopo ou administração institucional
-- (o serviço exige Administração do campus ou institucional).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['periodo_letivo', 'curso', 'turma'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY p_%s_leitura ON %I FOR SELECT USING (app_escopo_institucional() OR campus_id = ANY (app_campi()))', t, t);
    EXECUTE format('CREATE POLICY p_%s_criacao ON %I FOR INSERT WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()))', t, t);
    EXECUTE format('CREATE POLICY p_%s_alteracao ON %I FOR UPDATE USING (app_admin_institucional() OR campus_id = ANY (app_campi())) WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()))', t, t);
  END LOOP;
END
$$;
