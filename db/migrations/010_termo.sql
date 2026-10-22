-- 010 — Termo de compromisso único para todos os campi, versionado (RF-080; RN-23, RN-29; C9, D-10).
-- Global: sem campus_id. Versões são imutáveis (sem UPDATE/DELETE para a aplicação): publicar é criar
-- uma nova versão; as anteriores continuam consultáveis (CA-080.2) e as entregas apontam para a versão usada.

CREATE TABLE termo_modelo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  versao        integer NOT NULL UNIQUE CHECK (versao > 0),
  texto         text NOT NULL CHECK (length(trim(texto)) > 0),
  hash_texto    char(64) NOT NULL,            -- SHA-256 do texto, calculado pelo banco
  vigente_de    timestamptz NOT NULL DEFAULT now(),
  publicado_por uuid NOT NULL REFERENCES usuario(id)
);
CREATE INDEX ix_termo_vigencia ON termo_modelo (vigente_de DESC);

-- O hash é sempre o do texto gravado (não confia no valor enviado pela aplicação).
CREATE FUNCTION trg_termo_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.hash_texto := encode(sha256(convert_to(NEW.texto, 'UTF8')), 'hex');
  RETURN NEW;
END
$$;
CREATE TRIGGER termo_hash BEFORE INSERT ON termo_modelo FOR EACH ROW EXECUTE FUNCTION trg_termo_hash();

GRANT SELECT, INSERT ON termo_modelo TO livros_app;   -- sem UPDATE/DELETE: versões imutáveis

-- Leitura: todos (o serviço restringe a servidores com acesso; o estudante verá o termo que assinou).
-- Publicação: só administração institucional, em nome de quem está logado.
ALTER TABLE termo_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE termo_modelo FORCE ROW LEVEL SECURITY;
CREATE POLICY p_termo_leitura ON termo_modelo FOR SELECT USING (true);
CREATE POLICY p_termo_publicacao ON termo_modelo FOR INSERT
  WITH CHECK (app_admin_institucional() AND publicado_por = app_usuario_id());
