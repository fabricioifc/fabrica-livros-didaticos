// Oferta do campus (RF-012: anos letivos e cursos) contra o PostgreSQL real, em transações desfeitas.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as oferta from '../../src/modulos/campi/oferta.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const ano2027 = { ano: '2027', inicio: '2027-02-10', fim: '2027-12-15' };

async function cenario(db) {
  const c = await cenarioDoisCampi(db);
  const ctxAlfa = await contextoDe(db, c.adminAlfa);
  const ctxBeta = await contextoDe(db, c.adminBeta);
  const aAlfa = await oferta.criarAnoLetivo(db, ctxAlfa, c.alfa.id, ano2027);
  const cAlfa = await oferta.criarCurso(db, ctxAlfa, c.alfa.id, { nome: 'Técnico Fictício' });
  const aBeta = await oferta.criarAnoLetivo(db, ctxBeta, c.beta.id, ano2027);
  const cBeta = await oferta.criarCurso(db, ctxBeta, c.beta.id, { nome: 'Técnico Fictício' });
  return { ...c, ctxAlfa, ctxBeta, aAlfa, cAlfa, aBeta, cBeta };
}

describe('RF-012 — anos letivos e cursos', () => {
  test('admin do campus cadastra ano letivo e curso; aparecem na oferta e na auditoria', emTransacao(async (db) => {
    const c = await cenario(db);
    const o = await oferta.obterOferta(db, c.ctxAlfa, c.alfa.id);
    assert.deepEqual(o.anos.map((a) => [a.ano, a.inicio, a.fim]), [[2027, '2027-02-10', '2027-12-15']]);
    assert.deepEqual(o.cursos.map((x) => [x.nome, x.ativo]), [['Técnico Fictício', true]]);
    const { rows } = await db.query("SELECT acao FROM auditoria WHERE campus_id = $1 AND acao LIKE 'oferta.%' ORDER BY id", [c.alfa.id]);
    assert.deepEqual(rows.map((r) => r.acao), ['oferta.ano_letivo_criado', 'oferta.curso_criado']);
  }));

  test('CA-012.1: um ano letivo por ano em cada campus; o mesmo ano em outro campus é permitido', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(
      oferta.criarAnoLetivo(db, c.ctxAlfa, c.alfa.id, { ...ano2027, inicio: '2027-03-01' }),
      (err) => err.codigo === 'VALIDACAO' && /já está cadastrado/.test(err.detalhes.ano),
    );
    assert.equal(c.aBeta.ano, 2027);
  }));

  test('CA-012.1: nome de curso único no campus (sem diferenciar maiúsculas)', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(oferta.criarCurso(db, c.ctxAlfa, c.alfa.id, { nome: 'técnico fictício' }), (err) => err.codigo === 'VALIDACAO' && Boolean(err.detalhes.nome));
  }));

  test('CA-012.2: o término fica gravado e pode ser corrigido, com auditoria do valor anterior', emTransacao(async (db) => {
    const c = await cenario(db);
    await oferta.salvarAnoLetivo(db, c.ctxAlfa, c.aAlfa.id, { ...ano2027, fim: '2027-12-20' });
    assert.equal((await oferta.obterAnoLetivo(db, c.ctxAlfa, c.aAlfa.id)).fim, '2027-12-20');
    const { rows } = await db.query("SELECT antes->>'fim' AS antes, depois->>'fim' AS depois FROM auditoria WHERE acao = 'oferta.ano_letivo_atualizado' AND entidade_id = $1", [c.aAlfa.id]);
    assert.deepEqual(rows[0], { antes: '2027-12-15', depois: '2027-12-20' });
  }));

  test('curso: renomear e desativar; a situação é auditada', emTransacao(async (db) => {
    const c = await cenario(db);
    await oferta.salvarCurso(db, c.ctxAlfa, c.cAlfa.id, { nome: 'Técnico Fictício Renomeado' });
    await oferta.alterarSituacaoCurso(db, c.ctxAlfa, c.cAlfa.id, false);
    const curso = await oferta.obterCurso(db, c.ctxAlfa, c.cAlfa.id);
    assert.deepEqual([curso.nome, curso.ativo], ['Técnico Fictício Renomeado', false]);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'oferta.curso_desativado' AND entidade_id = $1", [c.cAlfa.id]);
    assert.equal(rows[0].n, 1);
  }));

  test('D-21: não existem mais turmas nem rótulo de período no banco', emTransacao(async (db) => {
    const { rows } = await db.query("SELECT to_regclass('public.turma') AS turma, (SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'periodo_letivo' AND column_name = 'rotulo') AS rotulo");
    assert.deepEqual(rows[0], { turma: null, rotulo: 0 });
  }));
});

describe('RF-012 — isolamento e permissões', () => {
  test('admin de A não vê nem altera a oferta de B (404)', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(oferta.obterOferta(db, c.ctxAlfa, c.beta.id), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(oferta.criarAnoLetivo(db, c.ctxAlfa, c.beta.id, { ...ano2027, ano: '2028' }), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(oferta.obterAnoLetivo(db, c.ctxAlfa, c.aBeta.id), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(oferta.salvarAnoLetivo(db, c.ctxAlfa, c.aBeta.id, ano2027), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(oferta.salvarCurso(db, c.ctxAlfa, c.cBeta.id, { nome: 'Invadido' }), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(oferta.alterarSituacaoCurso(db, c.ctxAlfa, c.cBeta.id, false), comCodigo('NAO_ENCONTRADO'));
  }));

  test('Consulta e estudante não mantêm a oferta; admin institucional mantém qualquer campus', emTransacao(async (db) => {
    const c = await cenario(db);
    for (const u of [c.consultaAlfa, c.estudante]) {
      const ctx = await contextoDe(db, u);
      await assert.rejects(oferta.obterOferta(db, ctx, c.alfa.id), comCodigo('NAO_ENCONTRADO'));
      await assert.rejects(oferta.criarCurso(db, ctx, c.alfa.id, { nome: 'Curso X' }), comCodigo('NAO_ENCONTRADO'));
    }
    await oferta.criarCurso(db, await contextoDe(db, c.adminInst), c.beta.id, { nome: 'Curso Institucional Fictício' });
  }));

  test('RLS: com escopo de A, anos letivos e cursos de B não aparecem e não podem ser criados', emTransacao(async (db) => {
    const c = await cenario(db);
    const doAlfa = { usuarioId: c.adminAlfa.id, campi: [c.alfa.id] };
    await comContexto(db, doAlfa, async (t) => {
      for (const tabela of ['periodo_letivo', 'curso']) {
        assert.equal((await t.query(`SELECT count(*)::int AS n FROM ${tabela} WHERE campus_id = $1`, [c.beta.id])).rows[0].n, 0, tabela);
      }
      assert.equal((await t.query("UPDATE curso SET nome = 'invadido' WHERE campus_id = $1", [c.beta.id])).rowCount, 0);
    });
    await assert.rejects(
      comContexto(db, doAlfa, (t) => t.query("INSERT INTO periodo_letivo (campus_id, ano, inicio, fim) VALUES ($1, 2030, '2030-02-01', '2030-12-01')", [c.beta.id])),
      (err) => err.code === '42501',
    );
  }));

  test('a aplicação não apaga anos letivos nem cursos; o campus de um registro não muda', emTransacao(async (db) => {
    const c = await cenario(db);
    const doAlfa = { usuarioId: c.adminAlfa.id, campi: [c.alfa.id, c.beta.id] };
    for (const tabela of ['periodo_letivo', 'curso']) {
      await assert.rejects(comContexto(db, doAlfa, (t) => t.query(`DELETE FROM ${tabela} WHERE campus_id = $1`, [c.alfa.id])), (err) => err.code === '42501', tabela);
    }
    await assert.rejects(comContexto(db, doAlfa, (t) => t.query('UPDATE curso SET campus_id = $2 WHERE id = $1', [c.cAlfa.id, c.beta.id])), (err) => err.code === '23514');
  }));
});
