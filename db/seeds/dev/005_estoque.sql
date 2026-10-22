-- Somente DESENVOLVIMENTO. Entradas FICTÍCIAS de estoque (RF-025) para os títulos do seed 004,
-- com quantidades diferentes em cada campus. O saldo é aplicado pelo gatilho da migração 008.
-- Só registra a entrada se o título ainda não tiver nenhuma movimentação no campus (não desfaz o que foi feito na interface).

INSERT INTO movimentacao_estoque (campus_id, titulo_id, tipo, quantidade, origem, usuario_id)
SELECT c.id, t.id, 'ENTRADA', v.quantidade, 'Carga inicial fictícia (seed de desenvolvimento)',
       (SELECT id FROM usuario WHERE google_sub = 'seed-dev-srv-06')
FROM (VALUES
  ('FRA', 'Matemática em Contexto (exemplo)',     40),
  ('FRA', 'Língua Portuguesa Viva (exemplo)',      35),
  ('FRA', 'Biologia: Vida e Ambiente (exemplo)',   12),
  ('EXE', 'Matemática em Contexto (exemplo)',     20),
  ('EXE', 'Física: Movimento e Energia (exemplo)',  8)
) AS v(campus, titulo, quantidade)
JOIN campus c ON c.codigo = v.campus
JOIN titulo t ON t.titulo = v.titulo
WHERE NOT EXISTS (SELECT 1 FROM movimentacao_estoque m WHERE m.campus_id = c.id AND m.titulo_id = t.id);
