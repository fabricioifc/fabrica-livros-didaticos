// Acesso ao banco EXCLUSIVO de testes (docker/compose.test.yml).
// Nunca usa DATABASE_URL: só TEST_DATABASE_URL ou o padrão local abaixo,
// e recusa qualquer endereço que não pareça um banco de testes local.
import pg from 'pg';

export const DEFAULT_TEST_DATABASE_URL =
  'postgres://livros_test:livros_test@127.0.0.1:55432/livros_test';

const HOSTS_PERMITIDOS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'db-test']);

export function resolveTestDatabaseUrl(env = process.env) {
  return env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

export function assertSafeTestDatabase(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('TEST_DATABASE_URL inválida.');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error(`Protocolo não suportado no banco de testes: ${u.protocol}`);
  }
  if (!HOSTS_PERMITIDOS.has(u.hostname)) {
    throw new Error(`Banco de testes deve ser local; host recusado: ${u.hostname}`);
  }
  const nome = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!nome.endsWith('_test')) {
    throw new Error(`Nome do banco de testes deve terminar em "_test"; recebido: "${nome}"`);
  }
  return { host: u.hostname, port: Number(u.port || 5432), database: nome };
}

export function createTestPool(env = process.env) {
  const url = resolveTestDatabaseUrl(env);
  assertSafeTestDatabase(url);
  return new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 3000 });
}

// Executa fn dentro de uma transação que é SEMPRE desfeita.
export async function withRollback(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

export const MENSAGEM_BANCO_INDISPONIVEL =
  'Banco de testes indisponível. Suba-o com "npm run db:test:up" (requer Docker) e rode os testes de novo.';
