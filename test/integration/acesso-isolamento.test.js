// Isolamento entre campi reforçado no BANCO (RLS e privilégios), independentemente do serviço.
// Simula código de aplicação defeituoso tentando ler/gravar fora do escopo.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback, resolveTestDatabaseUrl } from '../helpers/test-db.js';
import { cenarioDoisCampi, criarUsuario } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const escopo = (usuarioId, campi, extra = {}) => ({ usuarioId, campi, ...extra });
const contar = async (db, sql, params) => (await db.query(sql, params)).rows[0].n;

// Executa um comando que deve falhar sem abortar a transação do teste.
async function emSavepoint(db, sql, params) {
  await db.query('SAVEPOINT tentativa');
  try {
    return await db.query(sql, params);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT tentativa');
  }
}

// Cria dados nos dois campi: solicitação, auditoria e configuração.
async function cenario(db) {
  const c = await cenarioDoisCampi(db);
  const pedinte = await criarUsuario(db, { dominio: c.dominios.servidor });
  await db.query("INSERT INTO solicitacao_acesso (usuario_id, campus_id) VALUES ($1, $2)", [pedinte.id, c.beta.id]);
  await db.query(
    "INSERT INTO auditoria (usuario_id, campus_id, acao, entidade, entidade_id) VALUES ($1, $2, 'teste', 'x', '1'), ($1, $3, 'teste', 'x', '2')",
    [c.adminInst.id, c.alfa.id, c.beta.id],
  );
  return { ...c, pedinte };
}

describe('RLS — leitura cruzada entre campi', () => {
  test('com escopo do campus A, dados do campus B não aparecem', emTransacao(async (db) => {
    const c = await cenario(db);
    await comContexto(db, escopo(c.adminAlfa.id, [c.alfa.id]), async (t) => {
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM solicitacao_acesso WHERE campus_id = $1', [c.beta.id]), 0);
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM atribuicao WHERE campus_id = $1', [c.beta.id]), 0);
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM campus_configuracao WHERE campus_id = $1', [c.beta.id]), 0);
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM auditoria WHERE campus_id = $1', [c.beta.id]), 0);
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM campus_configuracao WHERE campus_id = $1', [c.alfa.id]), 1);
    });
  }));

  test('sem escopo nenhum (contexto esquecido), nenhuma linha por campus é visível', emTransacao(async (db) => {
    const c = await cenario(db);
    await comContexto(db, escopo(null, []), async (t) => {
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM solicitacao_acesso'), 0);
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM atribuicao'), 0);
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM auditoria'), 0);
    });
  }));

  test('servidor vê a própria solicitação, mas não a de outros, sem ter campus', emTransacao(async (db) => {
    const c = await cenario(db);
    await comContexto(db, escopo(c.pedinte.id, []), async (t) => {
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM solicitacao_acesso'), 1);
    });
    await comContexto(db, escopo(c.semAcesso.id, []), async (t) => {
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM solicitacao_acesso'), 0);
    });
  }));

  test('escopo institucional de leitura enxerga todos os campi', emTransacao(async (db) => {
    const c = await cenario(db);
    await comContexto(db, escopo(c.adminInst.id, [], { escopoInstitucional: true }), async (t) => {
      assert.equal(await contar(t, 'SELECT count(*)::int AS n FROM campus_configuracao WHERE campus_id = ANY($1)', [[c.alfa.id, c.beta.id]]), 2);
    });
  }));
});

describe('RLS — escrita cruzada entre campi', () => {
  const rlsViolada = (err) => err.code === '42501';

  test('com escopo do campus A, não é possível conceder papel no campus B', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(
      comContexto(db, escopo(c.adminAlfa.id, [c.alfa.id]), (t) =>
        t.query("INSERT INTO atribuicao (usuario_id, papel, campus_id) VALUES ($1, 'OPERADOR', $2)", [c.semAcesso.id, c.beta.id])),
      rlsViolada,
    );
  }));

  test('sem administração institucional, não é possível criar papel institucional', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(
      comContexto(db, escopo(c.adminAlfa.id, [c.alfa.id], { escopoInstitucional: true }), (t) =>
        t.query("INSERT INTO atribuicao (usuario_id, papel) VALUES ($1, 'ADMIN_INSTITUCIONAL')", [c.adminAlfa.id])),
      rlsViolada,
    );
  }));

  test('não é possível decidir (UPDATE) solicitação de outro campus', emTransacao(async (db) => {
    const c = await cenario(db);
    await comContexto(db, escopo(c.adminAlfa.id, [c.alfa.id]), async (t) => {
      const r = await t.query("UPDATE solicitacao_acesso SET status = 'APROVADA', decidida_por = $1, decidida_em = now() WHERE campus_id = $2", [c.adminAlfa.id, c.beta.id]);
      assert.equal(r.rowCount, 0);
    });
  }));

  test('não é possível criar solicitação em nome de outra pessoa', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(
      comContexto(db, escopo(c.semAcesso.id, []), (t) =>
        t.query('INSERT INTO solicitacao_acesso (usuario_id, campus_id) VALUES ($1, $2)', [c.consultaAlfa.id, c.alfa.id])),
      rlsViolada,
    );
  }));

  test('auditoria: não é possível registrar ação em nome de outra pessoa', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(
      comContexto(db, escopo(c.adminAlfa.id, [c.alfa.id]), (t) =>
        t.query("INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id) VALUES ($1, 'falsa', 'x', '1')", [c.adminBeta.id])),
      rlsViolada,
    );
  }));
});

describe('Imutabilidade e integridade no banco', () => {
  const semPermissao = (err) => err.code === '42501';
  const checkViolado = (err) => err.code === '23514';

  test('a aplicação não altera nem apaga auditoria (nem com escopo institucional)', emTransacao(async (db) => {
    const c = await cenario(db);
    const admin = escopo(c.adminInst.id, [], { escopoInstitucional: true, adminInstitucional: true });
    await assert.rejects(comContexto(db, admin, (t) => t.query("UPDATE auditoria SET acao = 'x'")), semPermissao);
    await assert.rejects(comContexto(db, admin, (t) => t.query('DELETE FROM auditoria')), semPermissao);
  }));

  test('a aplicação não apaga atribuições; só revoga', emTransacao(async (db) => {
    const c = await cenario(db);
    const admin = escopo(c.adminInst.id, [], { escopoInstitucional: true, adminInstitucional: true });
    await assert.rejects(comContexto(db, admin, (t) => t.query('DELETE FROM atribuicao')), semPermissao);
    await assert.rejects(
      comContexto(db, admin, (t) => t.query("UPDATE atribuicao SET papel = 'ADMIN_INSTITUCIONAL', campus_id = NULL WHERE usuario_id = $1", [c.consultaAlfa.id])),
      checkViolado,
    );
  }));

  test('estudante não recebe atribuição nem diretamente no banco', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(
      db.query("INSERT INTO atribuicao (usuario_id, papel, campus_id) VALUES ($1, 'CONSULTA', $2)", [c.estudante.id, c.alfa.id]),
      checkViolado,
    );
  }));

  test('combinações inválidas de papel e campus são recusadas pelo banco', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(emSavepoint(db, "INSERT INTO atribuicao (usuario_id, papel) VALUES ($1, 'OPERADOR')", [c.semAcesso.id]), checkViolado);
    await assert.rejects(emSavepoint(db, "INSERT INTO atribuicao (usuario_id, papel, campus_id) VALUES ($1, 'ADMIN_INSTITUCIONAL', $2)", [c.semAcesso.id, c.alfa.id]), checkViolado);
    await assert.rejects(emSavepoint(db, "INSERT INTO atribuicao (usuario_id, papel) VALUES ($1, 'ADMIN_CAMPUS')", [c.semAcesso.id]), checkViolado);
  }));

  // Regressão: o CHECK aceitava motivo NULL (length(NULL) é NULL).
  test('recusa de solicitação sem motivo (NULL, vazio ou só espaços) é barrada pelo banco', emTransacao(async (db) => {
    const c = await cenario(db);
    for (const motivo of [null, '', '   ']) {
      await assert.rejects(
        emSavepoint(db, "UPDATE solicitacao_acesso SET status = 'RECUSADA', decidida_por = $1, decidida_em = now(), motivo_recusa = $3 WHERE usuario_id = $2", [c.adminBeta.id, c.pedinte.id, motivo]),
        checkViolado,
        `motivo ${JSON.stringify(motivo)} foi aceito`,
      );
    }
  }));
});

describe('Contexto não vaza entre requisições na mesma conexão', () => {
  test('após uma transação com escopo do campus A, a próxima na mesma conexão não herda o escopo', async () => {
    const pool = new pg.Pool({ connectionString: resolveTestDatabaseUrl(), max: 1 });
    try {
      const A = 'aaaaaaaa-0000-4000-8000-000000000001';
      await comContexto(pool, escopo(A, [A], { escopoInstitucional: true }), async () => {});
      const { rows } = await pool.query(
        "SELECT current_setting('app.campi', true) AS campi, current_setting('app.escopo_institucional', true) AS inst, current_user AS papel",
      );
      assert.ok(!rows[0].campi, `app.campi vazou: ${rows[0].campi}`);
      assert.ok(rows[0].inst !== 'true', 'escopo institucional vazou');
      assert.notEqual(rows[0].papel, 'livros_app');
    } finally {
      await pool.end();
    }
  });
});
