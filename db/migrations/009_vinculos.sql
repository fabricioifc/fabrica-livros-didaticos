-- 009 — Vínculos de estudantes com os campi (RF-030 a RF-033; RN-06, RN-08 a RN-11, RN-46; D-02, D-21).
-- O estudante é global (matrícula única no IFC); o vínculo é por campus, com curso, série e ano letivo.
-- Sem turmas nem semestres (D-21). Sem DELETE: vínculo encerrado continua no histórico (RN-10).

CREATE TABLE vinculo_estudante (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id         uuid NOT NULL REFERENCES campus(id),
  estudante_id      uuid NOT NULL REFERENCES estudante(id),
  curso_id          uuid NOT NULL,
  periodo_letivo_id uuid NOT NULL,                       -- ano letivo (D-21)
  serie             smallint NOT NULL CHECK (serie BETWEEN 1 AND 4),   -- DP-17
  situacao          text NOT NULL DEFAULT 'ATIVO'
                    CHECK (situacao IN ('ATIVO', 'CONCLUIDO', 'TRANSFERIDO', 'EVADIDO', 'CANCELADO')),
  inicio            date NOT NULL DEFAULT current_date,
  fim               date,                                -- data do encerramento (base do prazo, RN-46)
  encerrado_por     uuid REFERENCES usuario(id),
  criado_por        uuid NOT NULL REFERENCES usuario(id),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campus_id, id),
  -- Curso e ano letivo obrigatoriamente do MESMO campus do vínculo.
  FOREIGN KEY (campus_id, curso_id)          REFERENCES curso (campus_id, id),
  FOREIGN KEY (campus_id, periodo_letivo_id) REFERENCES periodo_letivo (campus_id, id),
  CHECK ((situacao = 'ATIVO') = (fim IS NULL)),
  CHECK ((situacao = 'ATIVO') = (encerrado_por IS NULL)),
  CHECK (fim IS NULL OR fim >= inicio)
);
-- RN-08 / CA-031.2: no máximo um vínculo ativo por estudante em TODO o IFC (vale entre campi, apesar do RLS).
CREATE UNIQUE INDEX ux_vinculo_ativo ON vinculo_estudante (estudante_id) WHERE situacao = 'ATIVO';
CREATE INDEX ix_vinculo_campus ON vinculo_estudante (campus_id, situacao);
CREATE INDEX ix_vinculo_estudante ON vinculo_estudante (estudante_id);

-- Vínculo ativo: só curso, ano letivo e série mudam (RN-09), ou ele é encerrado (RF-033).
-- Vínculo encerrado não muda mais.
CREATE FUNCTION trg_vinculo_alteracao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.situacao <> 'ATIVO' THEN
    RAISE EXCEPTION 'vínculo encerrado não pode ser alterado' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.campus_id, NEW.estudante_id, NEW.inicio, NEW.criado_por, NEW.criado_em)
     IS DISTINCT FROM (OLD.campus_id, OLD.estudante_id, OLD.inicio, OLD.criado_por, OLD.criado_em) THEN
    RAISE EXCEPTION 'campus, estudante e início do vínculo não podem ser alterados' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER vinculo_alteracao BEFORE UPDATE ON vinculo_estudante FOR EACH ROW EXECUTE FUNCTION trg_vinculo_alteracao();

GRANT SELECT, INSERT, UPDATE ON vinculo_estudante TO livros_app;

-- Leitura: campi do escopo ou institucional. Escrita: campi do escopo ou administração institucional
-- (o serviço exige Administração do campus ou institucional).
-- (A leitura pelo próprio estudante entra com a área do estudante, RF-062.)
ALTER TABLE vinculo_estudante ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinculo_estudante FORCE ROW LEVEL SECURITY;
CREATE POLICY p_vinculo_leitura ON vinculo_estudante FOR SELECT
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_vinculo_criacao ON vinculo_estudante FOR INSERT
  WITH CHECK ((app_admin_institucional() OR campus_id = ANY (app_campi())) AND criado_por = app_usuario_id());
CREATE POLICY p_vinculo_alteracao ON vinculo_estudante FOR UPDATE
  USING (app_admin_institucional() OR campus_id = ANY (app_campi()))
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()));

-- ===== Estudante (global) visto pelos servidores =====
-- CA-032.1: o servidor só enxerga o estudante com vínculo (atual ou passado) num campus do seu escopo.
-- Cria: quem tem campus no escopo ou administração institucional. Altera (nome, e-mail):
-- quem tem no escopo o campus do vínculo ATIVO, ou administração institucional.
DROP POLICY p_estudante_leitura ON estudante;
DROP POLICY p_estudante_escrita ON estudante;
DROP POLICY p_estudante_atualizacao ON estudante;
CREATE POLICY p_estudante_leitura ON estudante FOR SELECT
  USING (usuario_id = app_usuario_id() OR app_escopo_institucional()
         OR EXISTS (SELECT 1 FROM vinculo_estudante v WHERE v.estudante_id = estudante.id AND v.campus_id = ANY (app_campi())));
CREATE POLICY p_estudante_criacao ON estudante FOR INSERT
  WITH CHECK (app_admin_institucional() OR cardinality(app_campi()) > 0);
CREATE POLICY p_estudante_atualizacao ON estudante FOR UPDATE
  USING (app_admin_institucional()
         OR EXISTS (SELECT 1 FROM vinculo_estudante v
                     WHERE v.estudante_id = estudante.id AND v.situacao = 'ATIVO' AND v.campus_id = ANY (app_campi())))
  WITH CHECK (app_admin_institucional()
         OR EXISTS (SELECT 1 FROM vinculo_estudante v
                     WHERE v.estudante_id = estudante.id AND v.situacao = 'ATIVO' AND v.campus_id = ANY (app_campi())));

-- Matrícula não muda (RN-06, RN-12): é a identidade do estudante no IFC.
CREATE FUNCTION trg_estudante_matricula_fixa() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.matricula IS DISTINCT FROM OLD.matricula THEN
    RAISE EXCEPTION 'a matrícula não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER estudante_matricula_fixa BEFORE UPDATE ON estudante FOR EACH ROW EXECUTE FUNCTION trg_estudante_matricula_fixa();

-- Conferência de unicidade no cadastro e na importação (RN-06, RN-08), sem expor dados de outros campi:
-- para as matrículas e e-mails informados, devolve só o id do estudante, QUAL chave coincidiu
-- (o próprio valor informado), se há conta de login ligada e onde está o vínculo ativo (aqui, outro campus ou nenhum).
-- SECURITY DEFINER para enxergar além do escopo; exige campus no escopo (ou administração institucional).
-- Pressupõe que o dono da função (dono do banco, usado nas migrações) não esteja sujeito ao RLS.
CREATE FUNCTION estudantes_por_chave(p_campus uuid, p_matriculas text[], p_emails text[])
  RETURNS TABLE (estudante_id uuid, matricula text, email text, conta_ligada boolean, vinculo_ativo text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (app_admin_institucional() OR p_campus = ANY (app_campi())) THEN
    RAISE EXCEPTION 'campus fora do escopo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT e.id,
           CASE WHEN e.matricula = ANY (p_matriculas) THEN e.matricula END,
           CASE WHEN e.email_institucional = ANY (p_emails) THEN e.email_institucional END,
           e.usuario_id IS NOT NULL,
           (SELECT CASE WHEN v.campus_id = p_campus THEN 'AQUI' ELSE 'OUTRO' END
              FROM vinculo_estudante v WHERE v.estudante_id = e.id AND v.situacao = 'ATIVO')
      FROM estudante e
     WHERE e.matricula = ANY (p_matriculas) OR e.email_institucional = ANY (p_emails);
END
$$;
REVOKE ALL ON FUNCTION estudantes_por_chave(uuid, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estudantes_por_chave(uuid, text[], text[]) TO livros_app;
