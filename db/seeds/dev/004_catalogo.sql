-- Somente DESENVOLVIMENTO. Títulos FICTÍCIOS para o catálogo (RF-020).
-- Sem ISBN de propósito: um ISBN válido inventado poderia coincidir com o de um livro real.
-- Cadastrados em nome de um servidor fictício do seed 002; não duplica ao reaplicar.

INSERT INTO componente_curricular (nome)
SELECT v.nome FROM (VALUES ('Matemática'), ('Língua Portuguesa'), ('Biologia'), ('Física')) AS v(nome)
WHERE NOT EXISTS (SELECT 1 FROM componente_curricular c WHERE lower(c.nome) = lower(v.nome));

INSERT INTO titulo (titulo, autores, editora, volume, componente_id, abrangencia, serie, criado_por)
SELECT v.titulo, 'Autoria Fictícia', 'Editora Exemplo (fictícia)', v.volume,
       (SELECT id FROM componente_curricular WHERE lower(nome) = lower(v.componente)),
       v.abrangencia, v.serie,
       (SELECT id FROM usuario WHERE google_sub = 'seed-dev-srv-06')
FROM (VALUES
  ('Matemática em Contexto (exemplo)',       'Volume único', 'Matemática',        'ENSINO_MEDIO_COMPLETO', NULL::smallint),
  ('Língua Portuguesa Viva (exemplo)',        'Volume único', 'Língua Portuguesa', 'ENSINO_MEDIO_COMPLETO', NULL),
  ('Biologia: Vida e Ambiente (exemplo)',     'Volume 1',     'Biologia',          'SERIE_ESPECIFICA',      1),
  ('Física: Movimento e Energia (exemplo)',   'Volume 2',     'Física',            'SERIE_ESPECIFICA',      2)
) AS v(titulo, volume, componente, abrangencia, serie)
WHERE NOT EXISTS (SELECT 1 FROM titulo t WHERE t.titulo = v.titulo);
