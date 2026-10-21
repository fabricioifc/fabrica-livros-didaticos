// Uso: npm run db:seed [-- --dev]
// Aplica db/seeds/*.sql (dados de base) e, com --dev, também db/seeds/dev/*.sql (dados fictícios).
// Os arquivos são idempotentes; --dev é recusado em produção.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { carregarConfig } from '../../config/index.js';

const PASTA = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'seeds');
const config = carregarConfig();
const comDev = process.argv.includes('--dev');
if (comDev && config.ambiente === 'production') {
  console.error('Dados de desenvolvimento não podem ser carregados em produção.');
  process.exit(1);
}

const pastas = comDev ? [PASTA, join(PASTA, 'dev')] : [PASTA];
const pool = new pg.Pool({ connectionString: config.bancoMigracaoUrl, max: 1 });
try {
  for (const pasta of pastas) {
    for (const arquivo of (await readdir(pasta)).filter((f) => f.endsWith('.sql')).sort()) {
      await pool.query(await readFile(join(pasta, arquivo), 'utf8'));
      console.log(`Seed aplicado: ${pasta === PASTA ? '' : 'dev/'}${arquivo}`);
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
