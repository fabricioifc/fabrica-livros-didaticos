// Persistência das entregas (migração 011). Toda consulta filtra pelo campus; o RLS reforça.

// RF-046: estudante com vínculo ATIVO neste campus, pela matrícula (CA-046.3: só o campus do servidor).
export async function buscarVinculoAtivoPorMatricula(db, campusId, matricula) {
  const { rows } = await db.query(
    `SELECT v.id FROM vinculo_estudante v JOIN estudante e ON e.id = v.estudante_id
      WHERE v.campus_id = $1 AND v.situacao = 'ATIVO' AND e.matricula = $2`,
    [campusId, matricula],
  );
  return rows[0]?.id ?? null;
}

// Vínculo com os dados para conferência (nome, matrícula, curso, série, ano letivo).
export async function buscarVinculoDoAtendimento(db, vinculoId) {
  const { rows } = await db.query(
    `SELECT v.id, v.campus_id, v.estudante_id, v.periodo_letivo_id, v.serie, v.situacao, cu.nome AS curso, pl.ano AS ano_letivo,
            e.nome, e.matricula
       FROM vinculo_estudante v
       JOIN estudante e ON e.id = v.estudante_id
       JOIN curso cu ON cu.campus_id = v.campus_id AND cu.id = v.curso_id
       JOIN periodo_letivo pl ON pl.campus_id = v.campus_id AND pl.id = v.periodo_letivo_id
      WHERE v.id = $1`,
    [vinculoId],
  );
  return rows[0] ?? null;
}

// Livros com exemplar disponível no campus, para a escolha (RN-19).
export async function listarDisponiveis(db, campusId) {
  const { rows } = await db.query(
    `SELECT t.id, t.titulo, t.volume, t.autores, t.abrangencia, t.serie, e.disponivel
       FROM estoque e JOIN titulo t ON t.id = e.titulo_id
      WHERE e.campus_id = $1 AND e.disponivel > 0
      ORDER BY lower(t.titulo), t.volume NULLS FIRST`,
    [campusId],
  );
  return rows;
}

export async function saldosDe(db, campusId, tituloIds) {
  const { rows } = await db.query('SELECT titulo_id, disponivel FROM estoque WHERE campus_id = $1 AND titulo_id = ANY ($2)', [campusId, tituloIds]);
  return new Map(rows.map((r) => [r.titulo_id, r.disponivel]));
}

export async function titulosEmPosse(db, campusId, estudanteId) {
  const { rows } = await db.query('SELECT titulos_em_posse AS id FROM titulos_em_posse($1, $2)', [campusId, estudanteId]);
  return new Set(rows.map((r) => r.id));
}

const COLUNAS_ENTREGA = `en.id, en.campus_id, en.vinculo_id, en.status, en.forma_identificacao, en.avisos_confirmados,
  en.preparada_em, up.nome AS preparada_por_nome, en.preparada_por, en.cancelada_em, uc.nome AS cancelada_por_nome,
  en.snapshot_estudante, en.snapshot_unidade, tm.versao AS termo_versao, v.estudante_id`;
const DE_ENTREGA = `FROM entrega en
  JOIN vinculo_estudante v ON v.campus_id = en.campus_id AND v.id = en.vinculo_id
  JOIN termo_modelo tm ON tm.id = en.termo_modelo_id
  JOIN usuario up ON up.id = en.preparada_por
  LEFT JOIN usuario uc ON uc.id = en.cancelada_por`;

export async function buscarEntrega(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS_ENTREGA} ${DE_ENTREGA} WHERE en.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function buscarPreparadaDoVinculo(db, vinculoId) {
  const { rows } = await db.query(`SELECT ${COLUNAS_ENTREGA} ${DE_ENTREGA} WHERE en.vinculo_id = $1 AND en.status = 'PREPARADA'`, [vinculoId]);
  return rows[0] ?? null;
}

export async function listarItens(db, entregaId) {
  const { rows } = await db.query(
    `SELECT i.titulo_id, t.titulo, t.volume, t.autores, i.quantidade
       FROM entrega_item i JOIN titulo t ON t.id = i.titulo_id
      WHERE i.entrega_id = $1 ORDER BY lower(t.titulo), t.volume NULLS FIRST`,
    [entregaId],
  );
  return rows;
}

// Entregas aguardando assinatura no campus (para retomar ou cancelar, RN-24).
export async function listarPreparadas(db, campusId) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_ENTREGA} ${DE_ENTREGA} WHERE en.campus_id = $1 AND en.status = 'PREPARADA' ORDER BY en.preparada_em`,
    [campusId],
  );
  return rows;
}

export async function listarEntregasDoVinculo(db, vinculoIds) {
  const { rows } = await db.query(
    `SELECT ${COLUNAS_ENTREGA},
            (SELECT count(*)::int FROM entrega_item i WHERE i.entrega_id = en.id) AS itens
       ${DE_ENTREGA} WHERE en.vinculo_id = ANY ($1) ORDER BY en.preparada_em DESC`,
    [vinculoIds],
  );
  return rows;
}

export async function inserirEntrega(db, d) {
  const { rows } = await db.query(
    `INSERT INTO entrega (campus_id, vinculo_id, periodo_letivo_id, termo_modelo_id, forma_identificacao, avisos_confirmados,
                          preparada_por, snapshot_estudante, snapshot_unidade)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [d.campusId, d.vinculoId, d.periodoId, d.termoId, d.formaIdentificacao, JSON.stringify(d.avisos), d.preparadaPor,
      d.snapshotEstudante, d.snapshotUnidade],
  );
  return rows[0].id;
}

export async function inserirItens(db, campusId, entregaId, tituloIds) {
  await db.query(
    'INSERT INTO entrega_item (campus_id, entrega_id, titulo_id) SELECT $1, $2, unnest($3::uuid[])',
    [campusId, entregaId, tituloIds],
  );
}

export async function cancelarEntrega(db, id, usuarioId) {
  const { rowCount } = await db.query(
    "UPDATE entrega SET status = 'CANCELADA', cancelada_por = $2, cancelada_em = now() WHERE id = $1 AND status = 'PREPARADA'",
    [id, usuarioId],
  );
  return rowCount === 1;
}
