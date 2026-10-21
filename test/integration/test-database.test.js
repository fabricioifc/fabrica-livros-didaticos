// Verifica o banco exclusivo de testes e o mecanismo de isolamento entre testes.
// Falha (não é ignorado) se o banco não estiver disponível.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestPool, withRollback, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';

let pool;

before(async () => {
  pool = createTestPool();
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end();
    pool = undefined;
    throw new Error(`${MENSAGEM_BANCO_INDISPONIVEL} (${err.code || err.message})`);
  }
});

after(async () => {
  await pool?.end();
});

test('banco de testes é PostgreSQL 17 (versão prevista na arquitetura)', async () => {
  const { rows } = await pool.query('SHOW server_version_num');
  const versao = Number(rows[0].server_version_num);
  assert.ok(versao >= 170000 && versao < 180000, `versão encontrada: ${versao}`);
});

test('conexão aponta para o banco livros_test', async () => {
  const { rows } = await pool.query('SELECT current_database() AS nome');
  assert.equal(rows[0].nome, 'livros_test');
});

test('withRollback desfaz tudo o que o teste gravou', async () => {
  await withRollback(pool, async (db) => {
    await db.query('CREATE TABLE tmp_isolamento (id int)');
    await db.query('INSERT INTO tmp_isolamento VALUES (1)');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM tmp_isolamento');
    assert.equal(rows[0].n, 1);
  });
  const { rows } = await pool.query("SELECT to_regclass('public.tmp_isolamento') AS tabela");
  assert.equal(rows[0].tabela, null);
});

test('withRollback desfaz as gravações mesmo quando o teste lança erro', async () => {
  await assert.rejects(
    withRollback(pool, async (db) => {
      await db.query('CREATE TABLE tmp_erro (id int)');
      throw new Error('falha simulada');
    }),
    /falha simulada/,
  );
  const { rows } = await pool.query("SELECT to_regclass('public.tmp_erro') AS tabela");
  assert.equal(rows[0].tabela, null);
});
