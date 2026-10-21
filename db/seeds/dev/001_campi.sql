-- Somente DESENVOLVIMENTO. Campi para testar o uso multi-campus desde o início:
-- o Campus Fraiburgo (primeira implantação) e um campus fictício. Idempotente.
INSERT INTO campus (codigo, nome_oficial, nome_curto) VALUES
  ('FRA', 'Instituto Federal Catarinense – Campus Fraiburgo', 'Fraiburgo'),
  ('EXE', 'Instituto Federal Catarinense – Campus Exemplo (fictício)', 'Exemplo')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO campus_configuracao (campus_id, setor_responsavel)
SELECT id, 'Setor responsável (fictício)' FROM campus WHERE codigo IN ('FRA', 'EXE')
ON CONFLICT (campus_id) DO NOTHING;
