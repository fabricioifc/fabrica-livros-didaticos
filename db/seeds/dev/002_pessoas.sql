-- Somente DESENVOLVIMENTO. Pessoas FICTÍCIAS para testar aprovação de acessos e equipes
-- com a conta do administrador (AGENTS.md, regra 15: nenhum dado real).
-- - E-mails no domínio reservado ".invalid": não coincidem com pessoas reais e não fazem login.
-- - Idempotente e respeita o que você fizer na interface: solicitações e papéis só são criados
--   se a pessoa ainda não tiver nenhum registro daquele tipo (aprovar, recusar ou remover
--   um papel não é desfeito ao reiniciar o container).

-- Servidores fictícios
INSERT INTO usuario (google_sub, email, nome, tipo) VALUES
  ('seed-dev-srv-01', 'ana.exemplo@exemplo.invalid',      'Ana Exemplo (fictícia)',      'SERVIDOR'),
  ('seed-dev-srv-02', 'bruno.exemplo@exemplo.invalid',    'Bruno Exemplo (fictício)',    'SERVIDOR'),
  ('seed-dev-srv-03', 'carla.exemplo@exemplo.invalid',    'Carla Exemplo (fictícia)',    'SERVIDOR'),
  ('seed-dev-srv-04', 'diego.exemplo@exemplo.invalid',    'Diego Exemplo (fictício)',    'SERVIDOR'),
  ('seed-dev-srv-05', 'elisa.exemplo@exemplo.invalid',    'Elisa Exemplo (fictícia)',    'SERVIDOR'),
  ('seed-dev-srv-06', 'fabio.exemplo@exemplo.invalid',    'Fábio Exemplo (fictício)',    'SERVIDOR'),
  ('seed-dev-srv-07', 'gabriela.exemplo@exemplo.invalid', 'Gabriela Exemplo (fictícia)', 'SERVIDOR')
ON CONFLICT (google_sub) DO NOTHING;

-- Solicitações pendentes: Ana e Bruno no Campus Fraiburgo; Carla no campus fictício.
INSERT INTO solicitacao_acesso (usuario_id, campus_id, solicitada_em)
SELECT u.id, c.id, now() - (p.dias || ' days')::interval
FROM (VALUES ('seed-dev-srv-01', 'FRA', 2), ('seed-dev-srv-02', 'FRA', 1), ('seed-dev-srv-03', 'EXE', 0))
     AS p(sub, campus, dias)
JOIN usuario u ON u.google_sub = p.sub
JOIN campus c ON c.codigo = p.campus
WHERE NOT EXISTS (SELECT 1 FROM solicitacao_acesso s WHERE s.usuario_id = u.id);

-- Equipes já formadas:
--   Fraiburgo: Diego (Consulta), Elisa (Consulta + Atendimento)
--   Exemplo:   Fábio (Consulta + Administração do campus), Gabriela (Consulta)
INSERT INTO atribuicao (usuario_id, papel, campus_id)
SELECT u.id, p.papel::papel, c.id
FROM (VALUES
  ('seed-dev-srv-04', 'CONSULTA', 'FRA'),
  ('seed-dev-srv-05', 'CONSULTA', 'FRA'),
  ('seed-dev-srv-05', 'OPERADOR', 'FRA'),
  ('seed-dev-srv-06', 'CONSULTA', 'EXE'),
  ('seed-dev-srv-06', 'ADMIN_CAMPUS', 'EXE'),
  ('seed-dev-srv-07', 'CONSULTA', 'EXE')
) AS p(sub, papel, campus)
JOIN usuario u ON u.google_sub = p.sub
JOIN campus c ON c.codigo = p.campus
WHERE NOT EXISTS (SELECT 1 FROM atribuicao a WHERE a.usuario_id = u.id AND a.campus_id = c.id AND a.papel = p.papel::papel);

-- Estudantes fictícios (cadastro, sem conta de login). Matrículas com prefixo DEV.
INSERT INTO estudante (matricula, nome, email_institucional) VALUES
  ('DEV0001', 'Helena Exemplo (fictícia)', 'helena.exemplo@exemplo.invalid'),
  ('DEV0002', 'Igor Exemplo (fictício)',   'igor.exemplo@exemplo.invalid'),
  ('DEV0003', 'Júlia Exemplo (fictícia)',  'julia.exemplo@exemplo.invalid')
ON CONFLICT (matricula) DO NOTHING;
