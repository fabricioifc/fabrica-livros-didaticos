// Persistência do catálogo de títulos (global; RLS na migração 007).
const COLUNAS = `t.id, t.isbn13, t.codigo_programa, t.titulo, t.autores, t.editora, t.edicao, t.volume,
  t.ano_publicacao, t.abrangencia, t.serie, cc.nome AS componente, t.criado_em`;
const DE = 'FROM titulo t LEFT JOIN componente_curricular cc ON cc.id = t.componente_id';

// Busca por título, autores, ISBN (só dígitos) ou componente; títulos mesclados não aparecem.
export async function buscarTitulos(db, { termo, limite, deslocamento }) {
  const digitos = termo.replace(/[\s-]/g, '');
  const params = [termo ? `%${termo}%` : null, /^\d{3,13}$/.test(digitos) ? `%${digitos}%` : null, limite, deslocamento];
  const filtro = `t.mesclado_em_id IS NULL AND ($1::text IS NULL OR t.titulo ILIKE $1 OR t.autores ILIKE $1 OR cc.nome ILIKE $1 OR t.isbn13 LIKE $2)`;
  const { rows } = await db.query(
    `SELECT ${COLUNAS}, count(*) OVER () AS total ${DE} WHERE ${filtro} ORDER BY lower(t.titulo), t.volume NULLS FIRST LIMIT $3 OFFSET $4`,
    params,
  );
  return { titulos: rows, total: rows.length ? Number(rows[0].total) : 0 };
}

export async function buscarTitulo(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS} ${DE} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function buscarPorIsbn(db, isbn13) {
  const { rows } = await db.query(`SELECT ${COLUNAS} ${DE} WHERE t.isbn13 = $1`, [isbn13]);
  return rows[0] ?? null;
}

// Componente curricular pelo nome (sem diferenciar maiúsculas); cria se não existir.
export async function obterOuCriarComponente(db, nome) {
  if (!nome) return null;
  const existente = await db.query('SELECT id FROM componente_curricular WHERE lower(nome) = lower($1)', [nome]);
  if (existente.rows[0]) return existente.rows[0].id;
  const { rows } = await db.query(
    'INSERT INTO componente_curricular (nome) VALUES ($1) ON CONFLICT (lower(nome)) DO NOTHING RETURNING id',
    [nome],
  );
  if (rows[0]) return rows[0].id;
  return (await db.query('SELECT id FROM componente_curricular WHERE lower(nome) = lower($1)', [nome])).rows[0].id;
}

const valores = (d, componenteId) => [
  d.isbn, d.codigoPrograma, d.titulo, d.autores, d.editora, d.edicao, d.volume, d.anoPublicacao, componenteId, d.abrangencia, d.serie,
];

export async function inserirTitulo(db, d, componenteId, criadoPor) {
  const { rows } = await db.query(
    `INSERT INTO titulo (isbn13, codigo_programa, titulo, autores, editora, edicao, volume, ano_publicacao,
                         componente_id, abrangencia, serie, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [...valores(d, componenteId), criadoPor],
  );
  return rows[0].id;
}

export async function atualizarTitulo(db, id, d, componenteId) {
  await db.query(
    `UPDATE titulo SET isbn13 = $2, codigo_programa = $3, titulo = $4, autores = $5, editora = $6, edicao = $7,
            volume = $8, ano_publicacao = $9, componente_id = $10, abrangencia = $11, serie = $12
     WHERE id = $1`,
    [id, ...valores(d, componenteId)],
  );
}
