-- Somente DESENVOLVIMENTO. Vínculos FICTÍCIOS dos estudantes do seed 002 (RF-030 a RF-033).
-- - Domínio reservado "estudantes.exemplo.invalid" como domínio de estudante, só no dev: permite
--   cadastrar e importar estudantes fictícios pela interface (ninguém faz login com ele).
-- - Os e-mails dos estudantes do seed passam a esse domínio (só os que ainda estão no antigo e sem conta ligada).
-- - Vínculo só é criado para quem ainda não tem nenhum (não desfaz encerramentos feitos na interface).

INSERT INTO dominio_permitido (dominio, tipo) VALUES ('estudantes.exemplo.invalid', 'ESTUDANTE')
ON CONFLICT (dominio) DO NOTHING;

UPDATE estudante SET email_institucional = replace(email_institucional, '@exemplo.invalid', '@estudantes.exemplo.invalid')
WHERE matricula LIKE 'DEV%' AND email_institucional LIKE '%@exemplo.invalid' AND usuario_id IS NULL;

INSERT INTO vinculo_estudante (campus_id, estudante_id, curso_id, periodo_letivo_id, serie, criado_por)
SELECT c.id, e.id,
       (SELECT k.id FROM curso k WHERE k.campus_id = c.id AND k.ativo ORDER BY k.criado_em LIMIT 1),
       (SELECT p.id FROM periodo_letivo p WHERE p.campus_id = c.id ORDER BY p.ano LIMIT 1),
       v.serie,
       (SELECT id FROM usuario WHERE google_sub = 'seed-dev-srv-06')
FROM (VALUES ('DEV0001', 'FRA', 1), ('DEV0002', 'FRA', 2), ('DEV0003', 'EXE', 1)) AS v(matricula, campus, serie)
JOIN estudante e ON e.matricula = v.matricula
JOIN campus c ON c.codigo = v.campus
WHERE NOT EXISTS (SELECT 1 FROM vinculo_estudante x WHERE x.estudante_id = e.id)
  AND EXISTS (SELECT 1 FROM curso k WHERE k.campus_id = c.id AND k.ativo)
  AND EXISTS (SELECT 1 FROM periodo_letivo p WHERE p.campus_id = c.id);
