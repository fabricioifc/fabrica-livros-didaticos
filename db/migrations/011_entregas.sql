-- 011 — Entregas: preparação e cancelamento (RF-040, RF-041, RF-043; RN-13 a RN-25).
-- A assinatura (RF-042), que efetiva a entrega e baixa o estoque, e o estorno (RF-044) entram na migração seguinte.
-- Por campus da operação (imutável), com FKs compostas e RLS. Sem DELETE: cancelar é mudar o status.

CREATE TYPE status_entrega AS ENUM ('PREPARADA', 'ASSINADA', 'CANCELADA', 'ESTORNADA');   -- sem expiração (RN-24)

CREATE TABLE entrega (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id           uuid NOT NULL REFERENCES campus(id),           -- campus DA OPERAÇÃO
  vinculo_id          uuid NOT NULL,
  periodo_letivo_id   uuid NOT NULL,                                 -- ano letivo do vínculo (RN-15)
  termo_modelo_id     uuid NOT NULL REFERENCES termo_modelo(id),     -- versão vigente na preparação (RN-23)
  status              status_entrega NOT NULL DEFAULT 'PREPARADA',
  forma_identificacao text NOT NULL CHECK (forma_identificacao IN ('QR_CODE', 'MATRICULA_DIGITADA')),
  avisos_confirmados  jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(avisos_confirmados) = 'array'),   -- RN-18, CA-041.4
  preparada_por       uuid NOT NULL REFERENCES usuario(id),
  preparada_em        timestamptz NOT NULL DEFAULT now(),
  cancelada_por       uuid REFERENCES usuario(id),
  cancelada_em        timestamptz,
  estornada_por       uuid REFERENCES usuario(id),                   -- RN-28 (RF-044)
  estornada_em        timestamptz,
  justificativa_estorno text,
  snapshot_estudante  jsonb NOT NULL,                                -- nome, matrícula, curso, série e ano na data (RN-03)
  snapshot_unidade    jsonb NOT NULL,                                -- dados do campus na data (RN-03)
  UNIQUE (campus_id, id),
  FOREIGN KEY (campus_id, vinculo_id)        REFERENCES vinculo_estudante (campus_id, id),
  FOREIGN KEY (campus_id, periodo_letivo_id) REFERENCES periodo_letivo (campus_id, id),
  CHECK ((status = 'CANCELADA') = (cancelada_por IS NOT NULL AND cancelada_em IS NOT NULL)),
  CHECK ((status = 'ESTORNADA') = (estornada_por IS NOT NULL AND estornada_em IS NOT NULL
                                   AND COALESCE(length(trim(justificativa_estorno)), 0) > 0))
);
CREATE INDEX ix_entrega_campus_status ON entrega (campus_id, status, preparada_em);
CREATE INDEX ix_entrega_vinculo ON entrega (vinculo_id);
-- RN-22 / CA-040.4: no máximo uma entrega aguardando assinatura por vínculo (o estudante tem um só vínculo ativo).
CREATE UNIQUE INDEX ux_entrega_preparada ON entrega (vinculo_id) WHERE status = 'PREPARADA';

CREATE TABLE entrega_item (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id  uuid NOT NULL,
  entrega_id uuid NOT NULL,
  titulo_id  uuid NOT NULL REFERENCES titulo(id),
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade = 1),     -- RN-17
  UNIQUE (campus_id, id),
  UNIQUE (entrega_id, titulo_id),                                    -- RN-16 / CA-040.2
  FOREIGN KEY (campus_id, entrega_id) REFERENCES entrega (campus_id, id)
);
CREATE INDEX ix_entrega_item_campus_titulo ON entrega_item (campus_id, titulo_id);

-- RN-14 / RN-15: só para vínculo ATIVO, no ano letivo do próprio vínculo.
CREATE FUNCTION trg_entrega_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'PREPARADA' THEN
    RAISE EXCEPTION 'entrega nasce preparada' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vinculo_estudante v
                  WHERE v.id = NEW.vinculo_id AND v.campus_id = NEW.campus_id
                    AND v.situacao = 'ATIVO' AND v.periodo_letivo_id = NEW.periodo_letivo_id) THEN
    RAISE EXCEPTION 'entrega exige vínculo ativo no campus, no ano letivo do vínculo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER entrega_insercao BEFORE INSERT ON entrega FOR EACH ROW EXECUTE FUNCTION trg_entrega_insercao();

-- Só mudam o status e os campos da transição: PREPARADA → ASSINADA | CANCELADA; ASSINADA → ESTORNADA.
CREATE FUNCTION trg_entrega_transicao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT ((OLD.status = 'PREPARADA' AND NEW.status IN ('ASSINADA', 'CANCELADA'))
       OR (OLD.status = 'ASSINADA' AND NEW.status = 'ESTORNADA')) THEN
    RAISE EXCEPTION 'transição de entrega inválida: % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.campus_id, NEW.vinculo_id, NEW.periodo_letivo_id, NEW.termo_modelo_id, NEW.forma_identificacao,
      NEW.avisos_confirmados, NEW.preparada_por, NEW.preparada_em, NEW.snapshot_estudante, NEW.snapshot_unidade)
     IS DISTINCT FROM
     (OLD.id, OLD.campus_id, OLD.vinculo_id, OLD.periodo_letivo_id, OLD.termo_modelo_id, OLD.forma_identificacao,
      OLD.avisos_confirmados, OLD.preparada_por, OLD.preparada_em, OLD.snapshot_estudante, OLD.snapshot_unidade) THEN
    RAISE EXCEPTION 'dados da entrega não podem ser alterados' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER entrega_transicao BEFORE UPDATE ON entrega FOR EACH ROW EXECUTE FUNCTION trg_entrega_transicao();

-- Itens só entram enquanto a entrega está preparada.
CREATE FUNCTION trg_entrega_item_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM entrega e WHERE e.id = NEW.entrega_id AND e.status = 'PREPARADA') THEN
    RAISE EXCEPTION 'itens só podem ser incluídos em entrega preparada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER entrega_item_insercao BEFORE INSERT ON entrega_item FOR EACH ROW EXECUTE FUNCTION trg_entrega_item_insercao();

GRANT SELECT, INSERT, UPDATE ON entrega TO livros_app;   -- UPDATE só nas transições (gatilho)
GRANT SELECT, INSERT ON entrega_item TO livros_app;      -- itens imutáveis

-- Leitura: campi do escopo ou institucional. Escrita: SOMENTE campi do escopo — a administração institucional
-- não opera entregas sem atribuição no campus (AGENTS.md 6.1). Preparação em nome de quem está logado.
ALTER TABLE entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE entrega FORCE ROW LEVEL SECURITY;
CREATE POLICY p_entrega_leitura ON entrega FOR SELECT
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_entrega_preparo ON entrega FOR INSERT
  WITH CHECK (campus_id = ANY (app_campi()) AND preparada_por = app_usuario_id());
CREATE POLICY p_entrega_transicao ON entrega FOR UPDATE
  USING (campus_id = ANY (app_campi())) WITH CHECK (campus_id = ANY (app_campi()));

ALTER TABLE entrega_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE entrega_item FORCE ROW LEVEL SECURITY;
CREATE POLICY p_entrega_item_leitura ON entrega_item FOR SELECT
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_entrega_item_preparo ON entrega_item FOR INSERT
  WITH CHECK (campus_id = ANY (app_campi()));

-- RN-18: títulos que o estudante já tem em posse, em QUALQUER campus (para o aviso), sem expor de onde.
-- Em posse = itens de entregas assinadas e não estornadas (as devoluções entram com RF-050).
-- Exige o campus no escopo e vínculo ativo do estudante nele. SECURITY DEFINER: mesmo pressuposto de D-24.
CREATE FUNCTION titulos_em_posse(p_campus uuid, p_estudante uuid) RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (p_campus = ANY (app_campi()) AND EXISTS (
    SELECT 1 FROM vinculo_estudante v WHERE v.campus_id = p_campus AND v.estudante_id = p_estudante AND v.situacao = 'ATIVO')) THEN
    RAISE EXCEPTION 'estudante fora do escopo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT DISTINCT i.titulo_id
      FROM entrega_item i
      JOIN entrega e ON e.id = i.entrega_id
      JOIN vinculo_estudante v ON v.id = e.vinculo_id
     WHERE v.estudante_id = p_estudante AND e.status = 'ASSINADA';
END
$$;
REVOKE ALL ON FUNCTION titulos_em_posse(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titulos_em_posse(uuid, uuid) TO livros_app;
