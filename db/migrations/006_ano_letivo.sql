-- 006 — Simplificação da oferta (RF-012 revisado em 2026-10-21, D-21):
-- os livros são anuais; não há turmas nem semestres. A oferta do campus é ano letivo + curso,
-- e o estudante será associado a curso, série e ano letivo (vínculo, RF-030).
-- A tabela continua se chamando periodo_letivo (referências futuras: entrega, adoção), mas cada
-- registro é um ANO letivo, único por campus. Início e término ficam: o término é a base do prazo (RN-44).

DROP TABLE turma;
DROP FUNCTION trg_turma_estrutura_fixa();

ALTER TABLE periodo_letivo ADD COLUMN ano smallint;
-- Dados existentes: o rótulo já era o ano (ex.: "2027"); se não for, usa o ano da data de início.
UPDATE periodo_letivo SET ano = CASE WHEN rotulo ~ '^[0-9]{4}$' THEN rotulo::smallint ELSE extract(year FROM inicio)::smallint END;
ALTER TABLE periodo_letivo
  ALTER COLUMN ano SET NOT NULL,
  ADD CONSTRAINT ck_periodo_ano CHECK (ano BETWEEN 2000 AND 2100);
DROP INDEX ux_periodo_rotulo;
ALTER TABLE periodo_letivo DROP COLUMN rotulo;
CREATE UNIQUE INDEX ux_periodo_ano ON periodo_letivo (campus_id, ano);

COMMENT ON TABLE periodo_letivo IS 'Ano letivo do campus (um por ano). O término (fim) é a base do prazo de devolução dos livros de série específica (RN-44).';
