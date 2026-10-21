// Persistência do módulo de campi. O escopo é aplicado pelo contexto do banco (RLS, migração 004).
export async function listarCampi(db) {
  const { rows } = await db.query(
    'SELECT id, codigo, nome_oficial, nome_curto, ativo, criado_em FROM campus ORDER BY ativo DESC, nome_curto',
  );
  return rows;
}

export async function buscarCampusComConfiguracao(db, id) {
  const { rows } = await db.query(
    `SELECT c.id, c.codigo, c.nome_oficial, c.nome_curto, c.ativo,
            k.endereco, k.cidade, k.uf, k.cep, k.setor_responsavel, k.email_setor, k.telefone,
            COALESCE(k.permite_entrega_com_pendencia, true) AS permite_entrega_com_pendencia
     FROM campus c LEFT JOIN campus_configuracao k ON k.campus_id = c.id
     WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function inserirCampus(db, { codigo, nomeOficial, nomeCurto }) {
  const { rows } = await db.query(
    'INSERT INTO campus (codigo, nome_oficial, nome_curto) VALUES ($1, $2, $3) RETURNING id, codigo, nome_oficial, nome_curto, ativo',
    [codigo, nomeOficial, nomeCurto],
  );
  await db.query('INSERT INTO campus_configuracao (campus_id) VALUES ($1)', [rows[0].id]);
  return rows[0];
}

export async function atualizarCampus(db, id, { codigo, nomeOficial, nomeCurto }) {
  await db.query(
    'UPDATE campus SET codigo = COALESCE($2, codigo), nome_oficial = $3, nome_curto = $4 WHERE id = $1',
    [id, codigo ?? null, nomeOficial, nomeCurto],
  );
}

export async function salvarConfiguracao(db, id, d) {
  await db.query(
    `INSERT INTO campus_configuracao
       (campus_id, endereco, cidade, uf, cep, setor_responsavel, email_setor, telefone, permite_entrega_com_pendencia)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (campus_id) DO UPDATE SET
       endereco = EXCLUDED.endereco, cidade = EXCLUDED.cidade, uf = EXCLUDED.uf, cep = EXCLUDED.cep,
       setor_responsavel = EXCLUDED.setor_responsavel, email_setor = EXCLUDED.email_setor,
       telefone = EXCLUDED.telefone, permite_entrega_com_pendencia = EXCLUDED.permite_entrega_com_pendencia`,
    [id, d.endereco, d.cidade, d.uf, d.cep, d.setorResponsavel, d.emailSetor, d.telefone, d.permiteEntregaComPendencia],
  );
}

export async function atualizarSituacao(db, id, ativo) {
  const { rows } = await db.query('UPDATE campus SET ativo = $2 WHERE id = $1 RETURNING id, ativo', [id, ativo]);
  return rows[0] ?? null;
}
