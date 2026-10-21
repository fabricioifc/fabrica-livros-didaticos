// Protege contra executar testes destrutivos em bancos que não são de teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeTestDatabase,
  resolveTestDatabaseUrl,
  DEFAULT_TEST_DATABASE_URL,
} from '../helpers/test-db.js';

test('usa o banco local de testes quando TEST_DATABASE_URL não está definida', () => {
  assert.equal(resolveTestDatabaseUrl({}), DEFAULT_TEST_DATABASE_URL);
});

test('nunca usa DATABASE_URL, mesmo se definida', () => {
  const url = resolveTestDatabaseUrl({ DATABASE_URL: 'postgres://app:x@prod.exemplo:5432/livros' });
  assert.equal(url, DEFAULT_TEST_DATABASE_URL);
});

test('aceita banco local com nome terminado em _test', () => {
  assert.deepEqual(assertSafeTestDatabase(DEFAULT_TEST_DATABASE_URL), {
    host: '127.0.0.1',
    port: 55432,
    database: 'livros_test',
  });
  assert.equal(assertSafeTestDatabase('postgresql://u:p@localhost/outro_test').database, 'outro_test');
  assert.equal(assertSafeTestDatabase('postgres://u:p@db-test:5432/livros_test').host, 'db-test');
});

test('recusa host remoto', () => {
  assert.throws(
    () => assertSafeTestDatabase('postgres://u:p@livros.exemplo.gov.br:5432/livros_test'),
    /deve ser local/,
  );
});

test('recusa banco local cujo nome não termina em _test (ex.: banco de desenvolvimento)', () => {
  assert.throws(() => assertSafeTestDatabase('postgres://u:p@127.0.0.1:5432/livros'), /_test/);
  assert.throws(() => assertSafeTestDatabase('postgres://u:p@127.0.0.1:5432/test_livros'), /_test/);
  assert.throws(() => assertSafeTestDatabase('postgres://u:p@127.0.0.1:5432/'), /_test/);
});

test('recusa URL inválida ou de outro protocolo', () => {
  assert.throws(() => assertSafeTestDatabase('não é url'), /inválida/);
  assert.throws(() => assertSafeTestDatabase('mysql://u:p@localhost/livros_test'), /Protocolo/);
});
