-- Somente DESENVOLVIMENTO. Oferta FICTÍCIA para os dois campi do seed (RF-012, D-21):
-- ano letivo 2027 e um curso. Só é criada em campus que ainda não tem nenhum ano letivo / curso
-- (não desfaz o que for cadastrado pela interface).

INSERT INTO periodo_letivo (campus_id, ano, inicio, fim)
SELECT c.id, 2027, DATE '2027-02-10', DATE '2027-12-15'
FROM campus c
WHERE c.codigo IN ('FRA', 'EXE')
  AND NOT EXISTS (SELECT 1 FROM periodo_letivo p WHERE p.campus_id = c.id);

INSERT INTO curso (campus_id, nome)
SELECT c.id, 'Técnico em Informática integrado ao Ensino Médio (exemplo)'
FROM campus c
WHERE c.codigo IN ('FRA', 'EXE')
  AND NOT EXISTS (SELECT 1 FROM curso k WHERE k.campus_id = c.id);
