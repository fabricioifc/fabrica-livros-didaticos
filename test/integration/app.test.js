// Servidor HTTP: rota de saúde e respostas padrão, com o banco de testes real.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { criarApp } from '../../src/app.js';

const banco = usarBancoMigrado();

async function iniciar(pool) {
  const servidor = criarApp({ pool }).listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  return { url: `http://127.0.0.1:${servidor.address().port}`, fechar: () => new Promise((ok) => servidor.close(ok)) };
}

describe('GET /saude', () => {
  let srv;
  before(async () => { srv = await iniciar(banco.pool); });
  after(async () => { await srv?.fechar(); });

  test('responde 200 com banco disponível, sem cache e sem identificar o framework', async () => {
    const r = await fetch(`${srv.url}/saude`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: 'ok', banco: 'ok' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('rota inexistente responde 404 no formato de erro padrão', async () => {
    const r = await fetch(`${srv.url}/nao-existe`);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).erro.codigo, 'NAO_ENCONTRADO');
  });
});

describe('GET /saude com banco fora do ar', () => {
  test('responde 503 sem expor detalhes do erro', async () => {
    // Porta sem servidor: a conexão falha rapidamente.
    const pool = new pg.Pool({ connectionString: 'postgres://x:y@127.0.0.1:1/nada_test', connectionTimeoutMillis: 1000 });
    const srv = await iniciar(pool);
    try {
      const r = await fetch(`${srv.url}/saude`);
      assert.equal(r.status, 503);
      const corpo = await r.text();
      assert.deepEqual(JSON.parse(corpo), { status: 'indisponivel', banco: 'falha' });
      assert.doesNotMatch(corpo, /ECONNREFUSED|127\.0\.0\.1|password/i);
    } finally {
      await srv.fechar();
      await pool.end();
    }
  });
});
