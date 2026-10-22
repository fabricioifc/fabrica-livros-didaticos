-- 008 — Estoque por campus e livro-razão de movimentações (RF-025 a RF-028; RN-69 a RN-72; D-09).
-- O saldo (estoque.disponivel) só muda por movimentação: a aplicação NÃO tem UPDATE em estoque;
-- um gatilho aplica cada movimentação ao saldo na mesma transação, com bloqueio de linha
-- (ON CONFLICT ... DO UPDATE), e o CHECK impede saldo negativo mesmo sob concorrência.

CREATE TABLE estoque (
  campus_id     uuid NOT NULL REFERENCES campus(id),
  titulo_id     uuid NOT NULL REFERENCES titulo(id),
  disponivel    integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campus_id, titulo_id),
  CONSTRAINT ck_estoque_nao_negativo CHECK (disponivel >= 0)   -- RN-72
);

CREATE TYPE tipo_movimentacao AS ENUM ('ENTRADA', 'ENTREGA', 'DEVOLUCAO', 'BAIXA', 'AJUSTE', 'ESTORNO');

CREATE TABLE movimentacao_estoque (                -- livro-razão imutável
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campus_id       uuid NOT NULL,
  titulo_id       uuid NOT NULL,
  tipo            tipo_movimentacao NOT NULL,
  quantidade      integer NOT NULL CHECK (quantidade <> 0),       -- positiva entra, negativa sai
  origem          text CHECK (origem IS NULL OR length(trim(origem)) > 0),               -- RN-69 (entrada)
  justificativa   text CHECK (justificativa IS NULL OR length(trim(justificativa)) > 0), -- RN-70, RN-71
  referencia_tipo text,                                            -- entrega, devolução, estorno (RF-040+)
  referencia_id   uuid,
  usuario_id      uuid NOT NULL REFERENCES usuario(id),
  ocorrido_em     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campus_id, titulo_id) REFERENCES estoque (campus_id, titulo_id),
  -- Sinal e dados obrigatórios por tipo (os tipos ligados a entregas e devoluções entram nas próximas etapas).
  CONSTRAINT ck_mov_entrada CHECK (tipo <> 'ENTRADA' OR (quantidade > 0 AND origem IS NOT NULL)),
  CONSTRAINT ck_mov_baixa CHECK (tipo <> 'BAIXA' OR (quantidade < 0 AND justificativa IS NOT NULL)),
  CONSTRAINT ck_mov_ajuste CHECK (tipo <> 'AJUSTE' OR justificativa IS NOT NULL)
);
CREATE INDEX ix_mov_campus_titulo ON movimentacao_estoque (campus_id, titulo_id, ocorrido_em);
CREATE INDEX ix_mov_campus_data ON movimentacao_estoque (campus_id, ocorrido_em);

-- Aplica a movimentação ao saldo antes de gravá-la (cria a linha de estoque na primeira entrada).
-- O UPDATE bloqueia a linha até o fim da transação: operações simultâneas no mesmo título esperam,
-- e a que deixaria o saldo negativo falha no CHECK. Sem linha (saldo zero), uma retirada também falha.
-- (Não dá para usar só INSERT ... ON CONFLICT: o CHECK é avaliado no registro proposto, negativo.)
-- SECURITY DEFINER: só este gatilho escreve em estoque; o RLS de estoque continua valendo.
CREATE FUNCTION trg_movimentacao_aplica_saldo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE estoque SET disponivel = disponivel + NEW.quantidade, atualizado_em = now()
   WHERE campus_id = NEW.campus_id AND titulo_id = NEW.titulo_id;
  IF NOT FOUND THEN
    -- Primeira movimentação do título no campus; ON CONFLICT cobre duas primeiras entradas simultâneas.
    INSERT INTO estoque AS e (campus_id, titulo_id, disponivel)
      VALUES (NEW.campus_id, NEW.titulo_id, NEW.quantidade)
      ON CONFLICT (campus_id, titulo_id)
      DO UPDATE SET disponivel = e.disponivel + EXCLUDED.disponivel, atualizado_em = now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER movimentacao_aplica_saldo BEFORE INSERT ON movimentacao_estoque
  FOR EACH ROW EXECUTE FUNCTION trg_movimentacao_aplica_saldo();

GRANT SELECT ON estoque TO livros_app;                     -- sem INSERT/UPDATE: só pelo gatilho
GRANT SELECT, INSERT ON movimentacao_estoque TO livros_app; -- sem UPDATE/DELETE: imutável (RN-02)

-- Leitura: campi do escopo ou institucional. Registro: campi do escopo ou administração institucional,
-- sempre em nome de quem está logado (o serviço exige Administração do campus ou institucional).
ALTER TABLE estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE estoque FORCE ROW LEVEL SECURITY;
CREATE POLICY p_estoque_leitura ON estoque FOR SELECT
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_estoque_gatilho_insercao ON estoque FOR INSERT
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_estoque_gatilho_alteracao ON estoque FOR UPDATE
  USING (app_admin_institucional() OR campus_id = ANY (app_campi()))
  WITH CHECK (app_admin_institucional() OR campus_id = ANY (app_campi()));

ALTER TABLE movimentacao_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacao_estoque FORCE ROW LEVEL SECURITY;
CREATE POLICY p_mov_leitura ON movimentacao_estoque FOR SELECT
  USING (app_escopo_institucional() OR campus_id = ANY (app_campi()));
CREATE POLICY p_mov_registro ON movimentacao_estoque FOR INSERT
  WITH CHECK ((app_admin_institucional() OR campus_id = ANY (app_campi())) AND usuario_id = app_usuario_id());
