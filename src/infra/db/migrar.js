// Aplica, em ordem, os arquivos SQL de db/migrations ainda não aplicados.
// Cada migração roda em sua própria transação; um advisory lock impede execuções simultâneas.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PASTA_MIGRACOES = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'migrations');
const CHAVE_LOCK = 7_310_001;

export async function aplicarMigracoes(pool, pasta = PASTA_MIGRACOES) {
  const arquivos = (await readdir(pasta)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const aplicadas = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [CHAVE_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migracao (
      nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT nome FROM schema_migracao');
    const jaAplicadas = new Set(rows.map((r) => r.nome));
    for (const arquivo of arquivos) {
      if (jaAplicadas.has(arquivo)) continue;
      const sql = await readFile(join(pasta, arquivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migracao (nome) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
        aplicadas.push(arquivo);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${arquivo}: ${err.message}`, { cause: err });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [CHAVE_LOCK]).catch(() => {});
    client.release();
  }
  return aplicadas;
}
