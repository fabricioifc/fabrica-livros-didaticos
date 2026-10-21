-- 004 — Proteção do cadastro de campi no banco (RF-010, RF-011; AGENTS.md 6.2).
-- Todos leem os campi (lista de escolha, nomes nos documentos). Só o administrador
-- institucional cria campi e altera código/situação; quem tem o campus no escopo
-- (o serviço exige Administração do campus) pode alterar os nomes.

ALTER TABLE campus ADD CONSTRAINT ck_campus_codigo CHECK (codigo ~ '^[A-Z0-9]{2,10}$');
ALTER TABLE campus ADD CONSTRAINT ck_campus_nomes CHECK (length(trim(nome_oficial)) > 0 AND length(trim(nome_curto)) > 0);

ALTER TABLE campus ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus FORCE ROW LEVEL SECURITY;
CREATE POLICY p_campus_leitura ON campus FOR SELECT USING (true);
CREATE POLICY p_campus_criacao ON campus FOR INSERT WITH CHECK (app_admin_institucional());
CREATE POLICY p_campus_alteracao ON campus FOR UPDATE
  USING (app_admin_institucional() OR id = ANY (app_campi()))
  WITH CHECK (app_admin_institucional() OR id = ANY (app_campi()));

-- Código e situação (ativo) só mudam com administração institucional; a criação nunca é desfeita (sem DELETE).
CREATE FUNCTION trg_campus_codigo_situacao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.codigo IS DISTINCT FROM OLD.codigo OR NEW.ativo IS DISTINCT FROM OLD.ativo OR NEW.criado_em IS DISTINCT FROM OLD.criado_em)
     AND NOT app_admin_institucional() THEN
    RAISE EXCEPTION 'código e situação do campus só podem ser alterados pela administração institucional'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER campus_codigo_situacao
  BEFORE UPDATE ON campus FOR EACH ROW EXECUTE FUNCTION trg_campus_codigo_situacao();

-- Validações da configuração do campus (RF-011).
ALTER TABLE campus_configuracao
  ADD CONSTRAINT ck_config_uf CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT ck_config_cep CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$');
