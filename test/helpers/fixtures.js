// Dados FICTÍCIOS para testes. Inseridos com o usuário dono do banco de testes (sem RLS),
// dentro da transação de withRollback; nomes aleatórios evitam colisão entre testes paralelos.
import { randomUUID } from 'node:crypto';

const sufixo = () => randomUUID().slice(0, 8);

// Domínios fictícios equivalentes aos institucionais (servidor e estudante).
export async function criarDominios(db) {
  const s = sufixo();
  const servidor = `servidores-${s}.teste`;
  const estudante = `estudantes-${s}.teste`;
  const inativo = `antigo-${s}.teste`;
  await db.query(
    `INSERT INTO dominio_permitido (dominio, tipo, ativo) VALUES
     ($1, 'SERVIDOR', true), ($2, 'ESTUDANTE', true), ($3, 'SERVIDOR', false)`,
    [servidor, estudante, inativo],
  );
  return { servidor, estudante, inativo };
}

export async function criarCampus(db, { nome = 'Campus Alfa', ativo = true } = {}) {
  const { rows } = await db.query(
    `INSERT INTO campus (codigo, nome_oficial, nome_curto, ativo) VALUES ($1, $2, $3, $4) RETURNING id, codigo`,
    [`T${sufixo().toUpperCase()}`, `Instituto Fictício – ${nome}`, nome, ativo],
  );
  await db.query('INSERT INTO campus_configuracao (campus_id, setor_responsavel) VALUES ($1, $2)', [rows[0].id, 'Setor Fictício']);
  return rows[0];
}

export async function criarUsuario(db, { tipo = 'SERVIDOR', dominio, nome = 'Pessoa Fictícia', ativo = true } = {}) {
  const s = sufixo();
  const { rows } = await db.query(
    `INSERT INTO usuario (google_sub, email, nome, tipo, ativo) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, google_sub, email, nome, tipo, ativo`,
    [`sub-${s}`, `pessoa.${s}@${dominio ?? 'exemplo.teste'}`, `${nome} ${s}`, tipo, ativo],
  );
  return rows[0];
}

// ISBN-13 aleatório com dígito verificador válido (para não colidir entre testes paralelos).
export function gerarIsbn() {
  const doze = `978${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const soma = [...doze].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return `${doze}${(10 - (soma % 10)) % 10}`;
}

// Cadastro de estudante (matrícula fictícia), opcionalmente já ligado a uma conta.
export async function criarEstudante(db, { email, nome = 'Estudante Fictício', usuarioId = null } = {}) {
  const s = sufixo();
  const { rows } = await db.query(
    `INSERT INTO estudante (matricula, nome, email_institucional, usuario_id) VALUES ($1, $2, $3, $4)
     RETURNING id, matricula, nome, email_institucional, usuario_id`,
    [`MAT${s}`, `${nome} ${s}`, email ?? `aluno.${s}@exemplo.teste`, usuarioId],
  );
  return rows[0];
}

export async function atribuir(db, usuarioId, papel, campusId = null) {
  const { rows } = await db.query(
    `INSERT INTO atribuicao (usuario_id, papel, campus_id) VALUES ($1, $2, $3)
     RETURNING id, usuario_id, papel, campus_id, revogada_em`,
    [usuarioId, papel, campusId],
  );
  return rows[0];
}

// Bloqueio usado pelo serviço ao contar administradores institucionais (RF-005, CA-004.2).
// Testes que criam ou revogam admins institucionais devem tomá-lo para não interferir entre si.
export const travarAdminsInstitucionais = (db) => db.query("SELECT pg_advisory_xact_lock(hashtext('acesso.admin_institucional'))");

// Admin institucional gravado de fato (fora de withRollback), serializado com os testes de RF-005.
export async function criarAdminInstitucionalConfirmado(pool, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await travarAdminsInstitucionais(client);
    await client.query("INSERT INTO atribuicao (usuario_id, papel) VALUES ($1, 'ADMIN_INSTITUCIONAL')", [usuarioId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function atribuicoesDe(db, usuarioId) {
  const { rows } = await db.query(
    'SELECT id, usuario_id, papel, campus_id, revogada_em FROM atribuicao WHERE usuario_id = $1 AND revogada_em IS NULL',
    [usuarioId],
  );
  return rows;
}

// Contexto de serviço no formato usado pela aplicação: { usuario, atribuicoes }.
export async function contextoDe(db, usuario) {
  return { usuario, atribuicoes: await atribuicoesDe(db, usuario.id) };
}

// Cenário padrão com dois campi (AGENTS.md, seção 13.1).
export async function cenarioDoisCampi(db) {
  const dominios = await criarDominios(db);
  const alfa = await criarCampus(db, { nome: 'Campus Alfa' });
  const beta = await criarCampus(db, { nome: 'Campus Beta' });
  const gama = await criarCampus(db, { nome: 'Campus Gama', ativo: false });
  const novo = (nome) => criarUsuario(db, { dominio: dominios.servidor, nome });

  const adminInst = await novo('Admin Institucional');
  await atribuir(db, adminInst.id, 'ADMIN_INSTITUCIONAL');
  const adminAlfa = await novo('Admin Alfa');
  await atribuir(db, adminAlfa.id, 'ADMIN_CAMPUS', alfa.id);
  await atribuir(db, adminAlfa.id, 'CONSULTA', alfa.id);
  const adminBeta = await novo('Admin Beta');
  await atribuir(db, adminBeta.id, 'ADMIN_CAMPUS', beta.id);
  const consultaAlfa = await novo('Consulta Alfa');
  await atribuir(db, consultaAlfa.id, 'CONSULTA', alfa.id);
  const semAcesso = await novo('Servidor Sem Acesso');
  const estudante = await criarUsuario(db, { tipo: 'ESTUDANTE', dominio: dominios.estudante, nome: 'Estudante' });

  return { dominios, alfa, beta, gama, adminInst, adminAlfa, adminBeta, consultaAlfa, semAcesso, estudante };
}
