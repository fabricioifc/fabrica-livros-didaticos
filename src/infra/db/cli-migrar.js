// Uso: npm run db:migrate — aplica as migrações pendentes com DATABASE_MIGRATION_URL (ou DATABASE_URL).
import pg from 'pg';
import { carregarConfig } from '../../config/index.js';
import { aplicarMigracoes } from './migrar.js';

const config = carregarConfig();
const pool = new pg.Pool({ connectionString: config.bancoMigracaoUrl, max: 1 });
try {
  const aplicadas = await aplicarMigracoes(pool);
  console.log(aplicadas.length ? `Migrações aplicadas: ${aplicadas.join(', ')}` : 'Nenhuma migração pendente.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
