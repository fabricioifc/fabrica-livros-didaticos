-- 002 — Cadastro global do estudante e ligação com a conta de login (RF-006).
-- Matrícula única no IFC (C8), sem CPF (C7). O vínculo com campus/curso/turma
-- (vinculo_estudante) entra com o módulo de estudantes (RF-030 a RF-033).

CREATE TABLE estudante (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula           text NOT NULL UNIQUE CHECK (length(trim(matricula)) > 0 AND matricula = trim(matricula)),
  nome                text NOT NULL CHECK (length(trim(nome)) > 0),
  email_institucional text NOT NULL UNIQUE CHECK (email_institucional = lower(trim(email_institucional))),
  usuario_id          uuid UNIQUE REFERENCES usuario(id),   -- preenchido no primeiro login
  qr_versao           integer NOT NULL DEFAULT 1 CHECK (qr_versao > 0),   -- AGENTS.md 8.2 (DV-19)
  criado_em           timestamptz NOT NULL DEFAULT now()
);

-- A conta ligada ao estudante precisa ser do tipo ESTUDANTE e ter o mesmo e-mail.
CREATE FUNCTION trg_estudante_conta_compativel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.usuario_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM usuario u WHERE u.id = NEW.usuario_id AND u.tipo = 'ESTUDANTE' AND u.email = NEW.email_institucional
  ) THEN
    RAISE EXCEPTION 'conta incompatível com o cadastro do estudante' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER estudante_conta_compativel
  BEFORE INSERT OR UPDATE OF usuario_id, email_institucional ON estudante
  FOR EACH ROW EXECUTE FUNCTION trg_estudante_conta_compativel();

GRANT SELECT, INSERT, UPDATE ON estudante TO livros_app;

-- O estudante vê apenas o próprio cadastro. Servidores de campus passarão a ver estudantes
-- vinculados ao seu campus quando vinculo_estudante existir (migração do módulo de estudantes).
ALTER TABLE estudante ENABLE ROW LEVEL SECURITY;
ALTER TABLE estudante FORCE ROW LEVEL SECURITY;
CREATE POLICY p_estudante_leitura ON estudante FOR SELECT
  USING (usuario_id = app_usuario_id() OR app_escopo_institucional());
CREATE POLICY p_estudante_escrita ON estudante FOR INSERT
  WITH CHECK (app_admin_institucional());
CREATE POLICY p_estudante_atualizacao ON estudante FOR UPDATE
  USING (app_admin_institucional())
  WITH CHECK (app_admin_institucional());
