// Persistência do estoque e do livro-razão (migração 008). Toda consulta filtra pelo campus;
// o RLS reforça o escopo. O saldo só muda pelo gatilho ao inserir uma movimentação.
const TITULO = 't.id AS titulo_id, t.titulo, t.volume, t.autores, t.isbn13';

// RF-027: títulos com estoque no campus, com saldo disponível e total baixado.
export async function listarEstoque(db, campusId, { termo, limite, deslocamento }) {
  const digitos = termo.replace(/[\s-]/g, '');
  const { rows } = await db.query(
    `SELECT ${TITULO}, e.disponivel,
            COALESCE((SELECT -sum(m.quantidade) FROM movimentacao_estoque m
                      WHERE m.campus_id = e.campus_id AND m.titulo_id = e.titulo_id AND m.tipo = 'BAIXA'), 0)::int AS baixados,
            count(*) OVER () AS total
       FROM estoque e JOIN titulo t ON t.id = e.titulo_id
      WHERE e.campus_id = $1
        AND ($2::text IS NULL OR t.titulo ILIKE $2 OR t.autores ILIKE $2 OR t.isbn13 LIKE $3)
      ORDER BY lower(t.titulo), t.volume NULLS FIRST
      LIMIT $4 OFFSET $5`,
    [campusId, termo ? `%${termo}%` : null, /^\d{3,13}$/.test(digitos) ? `%${digitos}%` : null, limite, deslocamento],
  );
  return { itens: rows, total: rows.length ? Number(rows[0].total) : 0 };
}

// Saldo de um título no campus (zero se ainda não houve movimentação).
export async function buscarSaldo(db, campusId, tituloId) {
  const { rows } = await db.query(
    `SELECT COALESCE((SELECT disponivel FROM estoque WHERE campus_id = $1 AND titulo_id = $2), 0)::int AS disponivel,
            COALESCE((SELECT -sum(quantidade) FROM movimentacao_estoque
                      WHERE campus_id = $1 AND titulo_id = $2 AND tipo = 'BAIXA'), 0)::int AS baixados`,
    [campusId, tituloId],
  );
  return rows[0];
}

// RF-028: movimentações do campus (opcionalmente de um título), mais recentes primeiro.
export async function listarMovimentacoes(db, campusId, { tituloId = null, limite, deslocamento }) {
  const { rows } = await db.query(
    `SELECT m.id, m.tipo, m.quantidade, m.origem, m.justificativa, m.referencia_tipo, m.referencia_id,
            m.ocorrido_em, u.nome AS responsavel, ${TITULO}, count(*) OVER () AS total
       FROM movimentacao_estoque m
       JOIN titulo t ON t.id = m.titulo_id
       JOIN usuario u ON u.id = m.usuario_id
      WHERE m.campus_id = $1 AND ($2::uuid IS NULL OR m.titulo_id = $2)
      ORDER BY m.ocorrido_em DESC, m.id DESC
      LIMIT $3 OFFSET $4`,
    [campusId, tituloId, limite, deslocamento],
  );
  return { movimentacoes: rows, total: rows.length ? Number(rows[0].total) : 0 };
}

export async function inserirMovimentacao(db, { campusId, tituloId, tipo, quantidade, origem, justificativa, usuarioId }) {
  const { rows } = await db.query(
    `INSERT INTO movimentacao_estoque (campus_id, titulo_id, tipo, quantidade, origem, justificativa, usuario_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, ocorrido_em`,
    [campusId, tituloId, tipo, quantidade, origem, justificativa, usuarioId],
  );
  return rows[0];
}

// Verificação de consistência (CA-027.1, R-09): saldo diferente da soma do livro-razão.
export async function listarDivergencias(db, campusId) {
  const { rows } = await db.query(
    `SELECT e.titulo_id, e.disponivel, COALESCE(sum(m.quantidade), 0)::int AS soma
       FROM estoque e LEFT JOIN movimentacao_estoque m ON m.campus_id = e.campus_id AND m.titulo_id = e.titulo_id
      WHERE e.campus_id = $1
      GROUP BY e.titulo_id, e.disponivel
     HAVING e.disponivel <> COALESCE(sum(m.quantidade), 0)`,
    [campusId],
  );
  return rows;
}
