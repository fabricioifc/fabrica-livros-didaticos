// Persistência do módulo de acesso. SQL explícito; o escopo por campus é aplicado pelo
// contexto do banco (RLS) aberto por comContexto() no serviço.
const COLUNAS_USUARIO = 'id, google_sub, email, nome, tipo, ativo';
const COLUNAS_ATRIBUICAO = 'id, usuario_id, papel, campus_id, concedida_por, concedida_em, revogada_em';

export async function listarDominios(db) {
  const { rows } = await db.query('SELECT dominio, tipo, ativo FROM dominio_permitido');
  return rows;
}

export async function buscarUsuarioPorSub(db, sub) {
  const { rows } = await db.query(`SELECT ${COLUNAS_USUARIO} FROM usuario WHERE google_sub = $1`, [sub]);
  return rows[0] ?? null;
}

export async function buscarUsuario(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS_USUARIO} FROM usuario WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function inserirUsuario(db, { sub, email, nome, tipo }) {
  const { rows } = await db.query(
    `INSERT INTO usuario (google_sub, email, nome, tipo, ultimo_login)
     VALUES ($1, $2, $3, $4, now()) RETURNING ${COLUNAS_USUARIO}`,
    [sub, email, nome, tipo],
  );
  return rows[0];
}

export async function atualizarLogin(db, id, { email, nome }) {
  const { rows } = await db.query(
    `UPDATE usuario SET email = $2, nome = $3, ultimo_login = now() WHERE id = $1 RETURNING ${COLUNAS_USUARIO}`,
    [id, email, nome],
  );
  return rows[0];
}

// Estudante: apenas o necessário para identificar a pessoa na sessão (sem dados extras).
const COLUNAS_ESTUDANTE = 'id, matricula, nome, usuario_id';

export async function buscarEstudantePorUsuario(db, usuarioId) {
  const { rows } = await db.query(`SELECT ${COLUNAS_ESTUDANTE} FROM estudante WHERE usuario_id = $1`, [usuarioId]);
  return rows[0] ?? null;
}

export async function buscarEstudantePorEmail(db, email) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_ESTUDANTE} FROM estudante WHERE email_institucional = $1 FOR UPDATE`,
    [email],
  );
  return rows[0] ?? null;
}

export async function ligarEstudanteAoUsuario(db, estudanteId, usuarioId) {
  const { rows } = await db.query(
    `UPDATE estudante SET usuario_id = $2 WHERE id = $1 AND usuario_id IS NULL RETURNING ${COLUNAS_ESTUDANTE}`,
    [estudanteId, usuarioId],
  );
  return rows[0] ?? null;
}

export async function listarAtribuicoesVigentes(db, usuarioId) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_ATRIBUICAO} FROM atribuicao WHERE usuario_id = $1 AND revogada_em IS NULL`,
    [usuarioId],
  );
  return rows;
}

export async function buscarAtribuicao(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS_ATRIBUICAO} FROM atribuicao WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function contarAdminsInstitucionaisAtivos(db) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM atribuicao a JOIN usuario u ON u.id = a.usuario_id
     WHERE a.papel = 'ADMIN_INSTITUCIONAL' AND a.revogada_em IS NULL AND u.ativo`,
  );
  return rows[0].n;
}

// Concorrência: serializa operações que dependem da contagem de administradores institucionais.
export async function travarAdminsInstitucionais(db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('acesso.admin_institucional'))");
}

// Insere a atribuição se ainda não houver uma vigente igual; devolve null se já existir.
export async function inserirAtribuicaoSeAusente(db, { usuarioId, papel, campusId, concedidaPor }) {
  const { rows } = await db.query(
    `INSERT INTO atribuicao (usuario_id, papel, campus_id, concedida_por)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (SELECT 1 FROM atribuicao WHERE usuario_id = $1 AND papel = $2
                       AND campus_id IS NOT DISTINCT FROM $3 AND revogada_em IS NULL)
     RETURNING ${COLUNAS_ATRIBUICAO}`,
    [usuarioId, papel, campusId ?? null, concedidaPor ?? null],
  );
  return rows[0] ?? null;
}

export async function revogarAtribuicao(db, id, revogadaPor) {
  const { rows } = await db.query(
    `UPDATE atribuicao SET revogada_em = now(), revogada_por = $2
     WHERE id = $1 AND revogada_em IS NULL RETURNING ${COLUNAS_ATRIBUICAO}`,
    [id, revogadaPor],
  );
  return rows[0] ?? null;
}

export async function listarCampiAtivos(db) {
  const { rows } = await db.query('SELECT id, nome_oficial, nome_curto FROM campus WHERE ativo ORDER BY nome_curto');
  return rows;
}

export async function listarCampiPorId(db, ids) {
  const { rows } = await db.query('SELECT id, nome_curto FROM campus WHERE id = ANY($1)', [ids]);
  return rows;
}

// Última solicitação do próprio usuário (pendente ou a decisão mais recente).
export async function buscarUltimaSolicitacao(db, usuarioId) {
  const { rows } = await db.query(
    `SELECT s.id, s.status, s.motivo_recusa, s.solicitada_em, c.nome_curto AS campus
     FROM solicitacao_acesso s JOIN campus c ON c.id = s.campus_id
     WHERE s.usuario_id = $1 ORDER BY s.solicitada_em DESC LIMIT 1`,
    [usuarioId],
  );
  return rows[0] ?? null;
}

export async function buscarInstituicao(db) {
  const { rows } = await db.query('SELECT nome_oficial, sigla FROM instituicao WHERE id = 1');
  return rows[0] ?? null;
}

export async function buscarCampusAtivo(db, id) {
  const { rows } = await db.query('SELECT id, codigo, nome_curto FROM campus WHERE id = $1 AND ativo', [id]);
  return rows[0] ?? null;
}

export async function inserirSolicitacao(db, { usuarioId, campusId }) {
  const { rows } = await db.query(
    `INSERT INTO solicitacao_acesso (usuario_id, campus_id) VALUES ($1, $2)
     RETURNING id, usuario_id, campus_id, status, solicitada_em`,
    [usuarioId, campusId],
  );
  return rows[0];
}

export async function buscarSolicitacao(db, id) {
  const { rows } = await db.query(
    'SELECT id, usuario_id, campus_id, status, decidida_por, motivo_recusa FROM solicitacao_acesso WHERE id = $1 FOR UPDATE',
    [id],
  );
  return rows[0] ?? null;
}

export async function registrarDecisao(db, id, { status, decididaPor, motivo }) {
  const { rows } = await db.query(
    `UPDATE solicitacao_acesso SET status = $2, decidida_por = $3, decidida_em = now(), motivo_recusa = $4
     WHERE id = $1 AND status = 'PENDENTE' RETURNING id, usuario_id, campus_id, status, motivo_recusa`,
    [id, status, decididaPor, motivo ?? null],
  );
  return rows[0] ?? null;
}

export async function listarSolicitacoesPendentes(db, campusId) {
  const { rows } = await db.query(
    `SELECT s.id, s.campus_id, s.solicitada_em, u.id AS usuario_id, u.nome, u.email
     FROM solicitacao_acesso s JOIN usuario u ON u.id = s.usuario_id
     WHERE s.status = 'PENDENTE' AND s.campus_id = $1 ORDER BY s.solicitada_em`,
    [campusId],
  );
  return rows;
}
