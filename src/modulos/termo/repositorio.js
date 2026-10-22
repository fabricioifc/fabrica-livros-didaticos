// Persistência das versões do termo de compromisso (global; migração 010).
const COLUNAS = 't.id, t.versao, t.texto, t.hash_texto, t.vigente_de, u.nome AS publicado_por';
const DE = 'FROM termo_modelo t JOIN usuario u ON u.id = t.publicado_por';

export async function listarVersoes(db) {
  const { rows } = await db.query(`SELECT t.id, t.versao, t.vigente_de, u.nome AS publicado_por ${DE} ORDER BY t.versao DESC`);
  return rows;
}

// Versão vigente: a mais recente já em vigor (RN-23: é a usada ao preparar uma entrega).
export async function buscarVigente(db) {
  const { rows } = await db.query(`SELECT ${COLUNAS} ${DE} WHERE t.vigente_de <= now() ORDER BY t.vigente_de DESC, t.versao DESC LIMIT 1`);
  return rows[0] ?? null;
}

export async function buscarVersao(db, id) {
  const { rows } = await db.query(`SELECT ${COLUNAS} ${DE} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

// Número da nova versão sob bloqueio, para duas publicações simultâneas não disputarem o mesmo número.
export async function inserirVersao(db, { texto, publicadoPor }) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('termo_modelo.versao'))");
  const { rows } = await db.query(
    `INSERT INTO termo_modelo (versao, texto, hash_texto, publicado_por)
     SELECT COALESCE(max(versao), 0) + 1, $1, '', $2 FROM termo_modelo
     RETURNING id, versao`,
    [texto, publicadoPor],
  );
  return rows[0];
}
