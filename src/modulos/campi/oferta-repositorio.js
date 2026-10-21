// Persistência de anos letivos (tabela periodo_letivo) e cursos. Escopo aplicado pelo RLS.
const COLUNAS_ANO = "id, campus_id, ano, to_char(inicio, 'YYYY-MM-DD') AS inicio, to_char(fim, 'YYYY-MM-DD') AS fim";

export async function listarAnosLetivos(db, campusId) {
  const { rows } = await db.query(`SELECT ${COLUNAS_ANO} FROM periodo_letivo WHERE campus_id = $1 ORDER BY ano DESC`, [campusId]);
  return rows;
}

export async function listarCursos(db, campusId) {
  const { rows } = await db.query('SELECT id, campus_id, nome, ativo FROM curso WHERE campus_id = $1 ORDER BY ativo DESC, nome', [campusId]);
  return rows;
}

export async function buscarAnoLetivo(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS_ANO} FROM periodo_letivo WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function buscarCurso(db, id) {
  const { rows } = await db.query('SELECT id, campus_id, nome, ativo FROM curso WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function inserirAnoLetivo(db, campusId, { ano, inicio, fim }) {
  const { rows } = await db.query(
    `INSERT INTO periodo_letivo (campus_id, ano, inicio, fim) VALUES ($1, $2, $3, $4) RETURNING ${COLUNAS_ANO}`,
    [campusId, ano, inicio, fim],
  );
  return rows[0];
}

export async function atualizarAnoLetivo(db, id, { ano, inicio, fim }) {
  await db.query('UPDATE periodo_letivo SET ano = $2, inicio = $3, fim = $4 WHERE id = $1', [id, ano, inicio, fim]);
}

export async function inserirCurso(db, campusId, { nome }) {
  const { rows } = await db.query('INSERT INTO curso (campus_id, nome) VALUES ($1, $2) RETURNING id, campus_id, nome, ativo', [campusId, nome]);
  return rows[0];
}

export async function atualizarCurso(db, id, { nome, ativo }) {
  await db.query('UPDATE curso SET nome = COALESCE($2, nome), ativo = COALESCE($3, ativo) WHERE id = $1', [id, nome ?? null, ativo ?? null]);
}
