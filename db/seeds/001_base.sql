-- Dados institucionais de base (todos os ambientes). Idempotente.
INSERT INTO instituicao (id, nome_oficial, sigla)
VALUES (1, 'Instituto Federal Catarinense', 'IFC')
ON CONFLICT (id) DO NOTHING;

-- Domínios aceitos no login (AGENTS.md, seção 5.1). Alterável pelo administrador institucional.
INSERT INTO dominio_permitido (dominio, tipo) VALUES
  ('ifc.edu.br', 'SERVIDOR'),
  ('estudantes.ifc.edu.br', 'ESTUDANTE')
ON CONFLICT (dominio) DO NOTHING;
