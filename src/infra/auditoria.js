// Registro de auditoria de operações de escrita (RNF-003, RF-090). Sem dados pessoais desnecessários.
export async function registrarAuditoria(db, { usuarioId = null, campusId = null, acao, entidade, entidadeId, antes = null, depois = null }) {
  await db.query(
    `INSERT INTO auditoria (usuario_id, campus_id, acao, entidade, entidade_id, antes, depois)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [usuarioId, campusId, acao, entidade, String(entidadeId), antes, depois],
  );
}
