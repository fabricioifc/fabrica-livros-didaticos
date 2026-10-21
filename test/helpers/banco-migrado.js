// Prepara o banco de testes com as migrações aplicadas (uma vez por arquivo de teste;
// o advisory lock do migrador evita corrida entre arquivos executados em paralelo).
import { before, after } from 'node:test';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from './test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';

export function usarBancoMigrado() {
  const estado = { pool: undefined };
  before(async () => {
    const pool = createTestPool();
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      await pool.end();
      throw new Error(`${MENSAGEM_BANCO_INDISPONIVEL} (${err.code || err.message})`);
    }
    await aplicarMigracoes(pool);
    estado.pool = pool;
  });
  after(async () => {
    await estado.pool?.end();
  });
  return estado;
}
