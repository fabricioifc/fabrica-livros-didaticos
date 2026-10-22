// RF-006 — acesso do estudante, contra o PostgreSQL real.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe, criarEstudante, criarUsuario } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import { escopoDoUsuario } from '../../src/modulos/acesso/dominio.js';
import * as acesso from '../../src/modulos/acesso/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const identidade = (email, sub = `sub-${email}`) => ({
  sub, email, email_verified: true, hd: email.split('@')[1], name: 'Estudante Fictício',
});

async function emSavepoint(db, sql, params) {
  await db.query('SAVEPOINT tentativa');
  try {
    return await db.query(sql, params);
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT tentativa');
  }
}

describe('RF-006 — ligação da conta ao cadastro', () => {
  test('CA-006.1: estudante sem cadastro entra, mas não tem dados nem enxerga cadastros', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await criarEstudante(db, { email: `outro@${c.dominios.estudante}` });
    const r = await acesso.registrarLogin(db, identidade(`sem.cadastro@${c.dominios.estudante}`));
    assert.equal(r.usuario.tipo, 'ESTUDANTE');
    assert.equal(r.estudante, null);
    assert.equal((await acesso.carregarContexto(db, r.usuario.id)).estudante, null);
    await comContexto(db, { usuarioId: r.usuario.id, campi: [] }, async (t) => {
      assert.equal((await t.query('SELECT count(*)::int AS n FROM estudante')).rows[0].n, 0);
    });
  }));

  test('primeiro login liga a conta ao cadastro pelo e-mail; os seguintes reaproveitam a ligação', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const cadastro = await criarEstudante(db, { email: `bia@${c.dominios.estudante}` });
    const primeiro = await acesso.registrarLogin(db, identidade(`bia@${c.dominios.estudante}`));
    assert.deepEqual(primeiro.estudante, { id: cadastro.id, matricula: cadastro.matricula, nome: cadastro.nome, usuario_id: primeiro.usuario.id });

    const segundo = await acesso.registrarLogin(db, identidade(`bia@${c.dominios.estudante}`));
    assert.equal(segundo.estudante.id, cadastro.id);
    assert.equal((await acesso.carregarContexto(db, primeiro.usuario.id)).estudante.matricula, cadastro.matricula);

    const { rows } = await db.query("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'acesso.estudante_ligado' AND entidade_id = $1", [cadastro.id]);
    assert.equal(rows[0].n, 1, 'a ligação deve ser auditada uma única vez');
  }));

  test('e-mail com maiúsculas no provedor liga ao cadastro em minúsculas', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const cadastro = await criarEstudante(db, { email: `caio@${c.dominios.estudante}` });
    const r = await acesso.registrarLogin(db, identidade(`Caio@${c.dominios.estudante.toUpperCase()}`));
    assert.equal(r.estudante.id, cadastro.id);
  }));

  test('cadastro já ligado a outra conta não é trocado em silêncio', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const email = `dani@${c.dominios.estudante}`;
    const antiga = await acesso.registrarLogin(db, identidade(email, 'conta-antiga'));
    const cadastro = await criarEstudante(db, { email: `temp-${Date.now()}@${c.dominios.estudante}` });
    // Simula: cadastro ligado à conta antiga, cujo e-mail mudou depois no provedor.
    await db.query('UPDATE usuario SET email = $2 WHERE id = $1', [antiga.usuario.id, `dani.antiga@${c.dominios.estudante}`]);
    await db.query('ALTER TABLE estudante DISABLE TRIGGER estudante_conta_compativel');
    await db.query('UPDATE estudante SET email_institucional = $2, usuario_id = $3 WHERE id = $1', [cadastro.id, email, antiga.usuario.id]);
    await db.query('ALTER TABLE estudante ENABLE TRIGGER estudante_conta_compativel');

    await assert.rejects(acesso.registrarLogin(db, identidade(email, 'conta-nova')), comCodigo('CADASTRO_LIGADO_A_OUTRA_CONTA'));
    const { rows } = await db.query('SELECT usuario_id FROM estudante WHERE id = $1', [cadastro.id]);
    assert.equal(rows[0].usuario_id, antiga.usuario.id);
  }));
});

describe('RF-006 — o estudante não acessa funções de servidor (CA-006.2)', () => {
  test('estudante não tem campus nem escopo institucional', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await criarEstudante(db, { email: `eva@${c.dominios.estudante}` });
    const r = await acesso.registrarLogin(db, identidade(`eva@${c.dominios.estudante}`));
    assert.deepEqual(escopoDoUsuario(r.usuario.id, r.atribuicoes), {
      usuarioId: r.usuario.id, campi: [], escopoInstitucional: false, adminInstitucional: false,
    });
  }));

  test('estudante não solicita acesso, não decide solicitações e não concede papéis', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.estudante);
    const s = await acesso.solicitarAcesso(db, await contextoDe(db, c.semAcesso), c.alfa.id);
    await assert.rejects(acesso.solicitarAcesso(db, ctx, c.alfa.id), comCodigo('PROIBIDO'));
    // Fora do escopo do estudante, a solicitação nem é visível: 404, sem revelar que existe.
    await assert.rejects(acesso.decidirSolicitacao(db, ctx, { solicitacaoId: s.id, aprovar: true }), comCodigo('NAO_ENCONTRADO'));
    const { rows } = await db.query('SELECT status FROM solicitacao_acesso WHERE id = $1', [s.id]);
    assert.equal(rows[0].status, 'PENDENTE');
    await assert.rejects(acesso.listarSolicitacoesPendentes(db, ctx, c.alfa.id), comCodigo('PROIBIDO'));
    await assert.rejects(acesso.concederPapel(db, ctx, { usuarioId: c.semAcesso.id, papel: 'CONSULTA', campusId: c.alfa.id }), comCodigo('PROIBIDO'));
  }));

  test('conta de servidor não pode ser ligada a cadastro de estudante (banco)', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const cadastro = await criarEstudante(db, { email: c.semAcesso.email });
    await assert.rejects(
      emSavepoint(db, 'UPDATE estudante SET usuario_id = $2 WHERE id = $1', [cadastro.id, c.semAcesso.id]),
      (err) => err.code === '23514',
    );
  }));
});

describe('RF-006 — isolamento dos cadastros de estudantes (RLS)', () => {
  test('um estudante não enxerga o cadastro de outro', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ana = await criarUsuario(db, { tipo: 'ESTUDANTE', dominio: c.dominios.estudante });
    await criarEstudante(db, { email: ana.email, usuarioId: ana.id });
    await criarEstudante(db, { email: `outro@${c.dominios.estudante}` });
    await comContexto(db, { usuarioId: ana.id, campi: [] }, async (t) => {
      const { rows } = await t.query('SELECT usuario_id FROM estudante');
      assert.deepEqual(rows.map((r) => r.usuario_id), [ana.id]);
    });
  }));

  // Desde a migração 009 (RF-031), a Administração do campus cria cadastros, mas só enxerga
  // estudantes com vínculo no seu campus (CA-032.1); os vínculos são testados em estudantes-servico.test.js.
  test('servidor de campus não enxerga cadastros sem vínculo com o seu campus', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await criarEstudante(db, { email: `fabi@${c.dominios.estudante}` });
    const escopoAdminAlfa = escopoDoUsuario(c.adminAlfa.id, (await contextoDe(db, c.adminAlfa)).atribuicoes);
    await comContexto(db, escopoAdminAlfa, async (t) => {
      assert.equal((await t.query('SELECT count(*)::int AS n FROM estudante')).rows[0].n, 0);
      // O cadastro recém-criado continua invisível até ganhar o vínculo.
      await t.query("INSERT INTO estudante (matricula, nome, email_institucional) VALUES ('X1', 'X', $1)", [`x@${c.dominios.estudante}`]);
      assert.equal((await t.query("SELECT count(*)::int AS n FROM estudante WHERE matricula = 'X1'")).rows[0].n, 0);
    });
    // Sem nenhum campus no escopo, não cria.
    await assert.rejects(
      comContexto(db, { usuarioId: c.semAcesso.id, campi: [] }, (t) =>
        t.query("INSERT INTO estudante (matricula, nome, email_institucional) VALUES ('X2', 'X', $1)", [`y@${c.dominios.estudante}`])),
      (err) => err.code === '42501',
    );
  }));

  test('escopo institucional enxerga os cadastros', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const cadastro = await criarEstudante(db, { email: `gabi@${c.dominios.estudante}` });
    await comContexto(db, escopoDoUsuario(c.adminInst.id, (await contextoDe(db, c.adminInst)).atribuicoes), async (t) => {
      assert.equal((await t.query('SELECT count(*)::int AS n FROM estudante WHERE id = $1', [cadastro.id])).rows[0].n, 1);
    });
  }));
});

describe('Integridade do cadastro de estudante (banco)', () => {
  test('matrícula e e-mail são únicos no IFC; e-mail em maiúsculas e matrícula vazia são recusados', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const e = await criarEstudante(db, { email: `hugo@${c.dominios.estudante}` });
    const inserir = (matricula, email) =>
      emSavepoint(db, "INSERT INTO estudante (matricula, nome, email_institucional) VALUES ($1, 'Nome', $2)", [matricula, email]);
    await assert.rejects(inserir(e.matricula, `novo@${c.dominios.estudante}`), (err) => err.code === '23505');
    await assert.rejects(inserir('NOVA1', e.email_institucional), (err) => err.code === '23505');
    await assert.rejects(inserir('NOVA2', `Maiusc@${c.dominios.estudante}`), (err) => err.code === '23514');
    await assert.rejects(inserir('  ', `vazio@${c.dominios.estudante}`), (err) => err.code === '23514');
  }));
});
