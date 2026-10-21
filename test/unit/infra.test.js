// Configuração e montagem do escopo de banco (src/config, src/infra/db/contexto.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../../src/config/index.js';
import { normalizarEscopo, escopoSistema } from '../../src/infra/db/contexto.js';

describe('carregarConfig', () => {
  test('exige DATABASE_URL', () => {
    assert.throws(() => carregarConfig({}), /DATABASE_URL/);
  });

  test('usa DATABASE_URL para migração quando DATABASE_MIGRATION_URL não é informada', () => {
    const c = carregarConfig({ DATABASE_URL: 'postgres://a' });
    assert.equal(c.bancoMigracaoUrl, 'postgres://a');
    assert.equal(c.ambiente, 'development');
    assert.deepEqual(c.emailsAdminInicial, []);
  });

  test('BOOTSTRAP_ADMIN_EMAILS vira lista normalizada; e-mail inválido é recusado', () => {
    const c = carregarConfig({ DATABASE_URL: 'x', BOOTSTRAP_ADMIN_EMAILS: ' Ana@Exemplo.teste , bia@exemplo.teste,' });
    assert.deepEqual(c.emailsAdminInicial, ['ana@exemplo.teste', 'bia@exemplo.teste']);
    assert.throws(() => carregarConfig({ DATABASE_URL: 'x', BOOTSTRAP_ADMIN_EMAILS: 'não-é-email' }), /BOOTSTRAP_ADMIN_EMAILS/);
  });

  test('NODE_ENV fora da lista é recusado', () => {
    assert.throws(() => carregarConfig({ DATABASE_URL: 'x', NODE_ENV: 'staging' }), /NODE_ENV/);
  });
});

describe('normalizarEscopo', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001';

  test('gera o array de campi sem duplicatas e as flags como texto', () => {
    assert.deepEqual(normalizarEscopo({ usuarioId: A, campi: [A, A], escopoInstitucional: false }), {
      usuarioId: A, campi: `{${A}}`, escopoInstitucional: 'false', adminInstitucional: 'false',
    });
  });

  test('recusa identificadores que não são UUID (impede injeção no array de campi)', () => {
    assert.throws(() => normalizarEscopo({ usuarioId: A, campi: [`${A}},{x`] }), /inválido/);
    assert.throws(() => normalizarEscopo({ usuarioId: "1' OR '1'='1", campi: [] }), /inválido/);
  });

  test('escopo de sistema é institucional e sem usuário', () => {
    assert.deepEqual(normalizarEscopo(escopoSistema()), {
      usuarioId: '', campi: '{}', escopoInstitucional: 'true', adminInstitucional: 'true',
    });
  });
});
