// Persistência de estudantes (global) e vínculos (por campus); migrações 002 e 009.
// Toda consulta de servidor filtra pelo campus; o RLS reforça (só vê estudante com vínculo no escopo).
const DATA = (col) => `to_char(${col}, 'YYYY-MM-DD')`;
const COLUNAS_VINCULO = `v.id, v.campus_id, v.estudante_id, v.curso_id, cu.nome AS curso, v.periodo_letivo_id, pl.ano AS ano_letivo,
  v.serie, v.situacao, ${DATA('v.inicio')} AS inicio, ${DATA('v.fim')} AS fim, v.criado_em`;
const DE_VINCULO = `FROM vinculo_estudante v
  JOIN curso cu ON cu.campus_id = v.campus_id AND cu.id = v.curso_id
  JOIN periodo_letivo pl ON pl.campus_id = v.campus_id AND pl.id = v.periodo_letivo_id`;

export async function listarDominiosDeEstudante(db) {
  const { rows } = await db.query("SELECT dominio FROM dominio_permitido WHERE tipo = 'ESTUDANTE' AND ativo");
  return rows.map((r) => r.dominio);
}

export async function listarCursosAtivos(db, campusId) {
  const { rows } = await db.query('SELECT id, nome FROM curso WHERE campus_id = $1 AND ativo ORDER BY nome', [campusId]);
  return rows;
}

export async function listarAnosLetivos(db, campusId) {
  const { rows } = await db.query('SELECT id, ano FROM periodo_letivo WHERE campus_id = $1 ORDER BY ano DESC', [campusId]);
  return rows;
}

// Conferência de unicidade em todo o IFC (função SECURITY DEFINER da migração 009).
export async function estudantesPorChave(db, campusId, matriculas, emails) {
  const { rows } = await db.query('SELECT * FROM estudantes_por_chave($1, $2, $3)', [campusId, matriculas, emails]);
  return rows;
}

export async function buscarEstudante(db, id) {
  const { rows } = await db.query(
    'SELECT id, matricula, nome, email_institucional AS email, usuario_id IS NOT NULL AS conta_ligada FROM estudante WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function buscarVinculoAtivo(db, campusId, estudanteId) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_VINCULO} ${DE_VINCULO} WHERE v.campus_id = $1 AND v.estudante_id = $2 AND v.situacao = 'ATIVO'`,
    [campusId, estudanteId],
  );
  return rows[0] ?? null;
}

export async function buscarVinculo(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS_VINCULO} ${DE_VINCULO} WHERE v.id = $1`, [id]);
  return rows[0] ?? null;
}

// Todos os vínculos do estudante NESTE campus (atuais e encerrados), do mais recente ao mais antigo.
export async function listarVinculosNoCampus(db, campusId, estudanteId) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_VINCULO}, u.nome AS encerrado_por ${DE_VINCULO} LEFT JOIN usuario u ON u.id = v.encerrado_por
      WHERE v.campus_id = $1 AND v.estudante_id = $2 ORDER BY (v.situacao = 'ATIVO') DESC, v.criado_em DESC`,
    [campusId, estudanteId],
  );
  return rows;
}

// RF-032: estudantes com vínculo no campus; mostra o vínculo mais recente de cada um neste campus.
export async function listarEstudantes(db, campusId, { termo, cursoId, serie, situacao, limite, deslocamento }) {
  const { rows } = await db.query(
    `WITH ultimo AS (
       SELECT DISTINCT ON (v.estudante_id) ${COLUNAS_VINCULO} ${DE_VINCULO}
        WHERE v.campus_id = $1
        ORDER BY v.estudante_id, (v.situacao = 'ATIVO') DESC, v.criado_em DESC)
     SELECT e.id AS estudante_id, e.matricula, e.nome, u.curso, u.ano_letivo, u.serie, u.situacao, count(*) OVER () AS total
       FROM ultimo u JOIN estudante e ON e.id = u.estudante_id
      WHERE ($2::text IS NULL OR e.nome ILIKE $2 OR e.matricula ILIKE $2)
        AND ($3::uuid IS NULL OR u.curso_id = $3)
        AND ($4::smallint IS NULL OR u.serie = $4)
        AND ($5::text IS NULL OR ($5 = 'ATIVO') = (u.situacao = 'ATIVO'))
      ORDER BY lower(e.nome), e.matricula
      LIMIT $6 OFFSET $7`,
    [campusId, termo ? `%${termo}%` : null, cursoId, serie, situacao, limite, deslocamento],
  );
  return { estudantes: rows, total: rows.length ? Number(rows[0].total) : 0 };
}

// Sem RETURNING: o estudante recém-criado só fica visível (RLS) depois de ter vínculo no campus.
export async function inserirEstudante(db, { id, matricula, nome, email }) {
  await db.query('INSERT INTO estudante (id, matricula, nome, email_institucional) VALUES ($1, $2, $3, $4)', [id, matricula, nome, email]);
}

export async function atualizarEstudante(db, id, { nome, email }) {
  await db.query('UPDATE estudante SET nome = $2, email_institucional = $3 WHERE id = $1', [id, nome, email]);
}

export async function inserirVinculo(db, { campusId, estudanteId, cursoId, periodoId, serie, criadoPor }) {
  const { rows } = await db.query(
    `INSERT INTO vinculo_estudante (campus_id, estudante_id, curso_id, periodo_letivo_id, serie, criado_por, inicio)
     VALUES ($1, $2, $3, $4, $5, $6, (now() AT TIME ZONE 'America/Sao_Paulo')::date) RETURNING id`,
    [campusId, estudanteId, cursoId, periodoId, serie, criadoPor],
  );
  return rows[0].id;
}

export async function atualizarVinculo(db, id, { cursoId, periodoId, serie }) {
  await db.query('UPDATE vinculo_estudante SET curso_id = $2, periodo_letivo_id = $3, serie = $4 WHERE id = $1', [id, cursoId, periodoId, serie]);
}

export async function encerrarVinculo(db, id, { situacao, fim, encerradoPor }) {
  await db.query('UPDATE vinculo_estudante SET situacao = $2, fim = $3, encerrado_por = $4 WHERE id = $1', [id, situacao, fim, encerradoPor]);
}

export async function dataDeHoje(db) {
  const { rows } = await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje");
  return rows[0].hoje;
}
