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

// Título fictício no catálogo (global), sem ISBN por padrão.
export async function criarTitulo(db, criadoPor, { titulo = 'Livro Fictício', isbn13 = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO titulo (titulo, autores, isbn13, abrangencia, criado_por) VALUES ($1, 'Autoria Fictícia', $2, 'ENSINO_MEDIO_COMPLETO', $3)
     RETURNING id, titulo`,
    [`${titulo} ${sufixo()}`, isbn13, criadoPor],
  );
  return rows[0];
}

// Oferta mínima de um campus: um curso ativo e um ano letivo.
export async function criarOferta(db, campusId, { curso = 'Técnico Fictício', ano = 2027 } = {}) {
  const c = await db.query('INSERT INTO curso (campus_id, nome) VALUES ($1, $2) RETURNING id, nome', [campusId, `${curso} ${sufixo()}`]);
  const p = await db.query(
    "INSERT INTO periodo_letivo (campus_id, ano, inicio, fim) VALUES ($1, $2::int, make_date($2::int, 2, 1), make_date($2::int, 12, 15)) RETURNING id, ano",
    [campusId, ano],
  );
  return { curso: c.rows[0], ano: p.rows[0] };
}

// Estudante com vínculo (ativo, por padrão) no campus, com o curso e o ano letivo de criarOferta.
export async function criarEstudanteComVinculo(db, { campusId, oferta, criadoPor, serie = 1, dominio = 'exemplo.teste' }) {
  const e = await criarEstudante(db, { email: `aluno.${sufixo()}@${dominio}` });
  const { rows } = await db.query(
    `INSERT INTO vinculo_estudante (campus_id, estudante_id, curso_id, periodo_letivo_id, serie, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [campusId, e.id, oferta.curso.id, oferta.ano.id, serie, criadoPor],
  );
  return { ...e, vinculoId: rows[0].id };
}

// Nova versão do termo (global): o número segue o mesmo bloqueio usado pela aplicação.
export async function criarTermo(db, autorId) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('termo_modelo.versao'))");
  const { rows } = await db.query(
    `INSERT INTO termo_modelo (versao, texto, hash_texto, publicado_por)
     SELECT COALESCE(max(versao), 0) + 1, $1, '', $2 FROM termo_modelo RETURNING id, versao`,
    [`Termo fictício ${sufixo()}: declaro que recebi {livros}.`, autorId],
  );
  return rows[0];
}

// Entrada de estoque (o gatilho da migração 008 atualiza o saldo).
export async function darEntrada(db, { campusId, tituloId, quantidade, usuarioId }) {
  await db.query(
    "INSERT INTO movimentacao_estoque (campus_id, titulo_id, tipo, quantidade, origem, usuario_id) VALUES ($1, $2, 'ENTRADA', $3, 'Teste', $4)",
    [campusId, tituloId, quantidade, usuarioId],
  );
}

// Cadastro de estudante (matrícula fictícia), opcionalmente já ligado a uma conta.
export async function criarEstudante(db, { email, nome = 'Estudante Fictício', usuarioId = null } = {}) {
  const s = sufixo();
  const { rows } = await db.query(
    `INSERT INTO estudante (matricula, nome, email_institucional, usuario_id) VALUES ($1, $2, $3, $4)
     RETURNING id, matricula, nome, email_institucional, usuario_id`,
    [`MAT${s.toUpperCase()}`, `${nome} ${s}`, email ?? `aluno.${s}@exemplo.teste`, usuarioId],
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
