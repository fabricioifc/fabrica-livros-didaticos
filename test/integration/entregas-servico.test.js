// Atendimento: identificação, preparação e cancelamento de entregas (RF-040, RF-041, RF-043, RF-046),
// contra o PostgreSQL real, em transações desfeitas.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import {
  cenarioDoisCampi, contextoDe, atribuir, criarOferta, criarTitulo, criarEstudanteComVinculo, criarTermo, darEntrada,
} from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as entregas from '../../src/modulos/entregas/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};

async function cenario(db) {
  const c = await cenarioDoisCampi(db);
  const operadorAlfa = c.consultaAlfa; // Consulta + Operador em Alfa
  await atribuir(db, operadorAlfa.id, 'OPERADOR', c.alfa.id);
  const ofertaAlfa = await criarOferta(db, c.alfa.id);
  const ofertaBeta = await criarOferta(db, c.beta.id);
  const termo = await criarTermo(db, c.adminInst.id);
  const [t1, t2, semSaldo] = [await criarTitulo(db, c.adminInst.id), await criarTitulo(db, c.adminInst.id), await criarTitulo(db, c.adminInst.id)];
  for (const t of [t1, t2]) {
    await darEntrada(db, { campusId: c.alfa.id, tituloId: t.id, quantidade: 5, usuarioId: c.adminAlfa.id });
    await darEntrada(db, { campusId: c.beta.id, tituloId: t.id, quantidade: 5, usuarioId: c.adminBeta.id });
  }
  const e1 = await criarEstudanteComVinculo(db, { campusId: c.alfa.id, oferta: ofertaAlfa, criadoPor: c.adminAlfa.id, serie: 2 });
  const e2 = await criarEstudanteComVinculo(db, { campusId: c.beta.id, oferta: ofertaBeta, criadoPor: c.adminBeta.id });
  const ctx = { operador: await contextoDe(db, operadorAlfa), adminAlfa: await contextoDe(db, c.adminAlfa), adminBeta: await contextoDe(db, c.adminBeta) };
  const identificado = (e) => ({ vinculoId: e.vinculoId, forma: 'MATRICULA_DIGITADA' });
  return { ...c, operadorAlfa, ofertaAlfa, ofertaBeta, termo, t1, t2, semSaldo, e1, e2, ctx, identificado };
}

const saldo = async (db, campusId, tituloId) => (await db.query('SELECT disponivel FROM estoque WHERE campus_id = $1 AND titulo_id = $2', [campusId, tituloId])).rows[0].disponivel;

describe('RF-046 — identificação pela matrícula digitada', () => {
  test('encontra só estudante com vínculo ativo no campus; os demais casos têm a mesma mensagem (CA-046.2, CA-046.3)', emTransacao(async (db) => {
    const c = await cenario(db);
    const r = await entregas.identificarPorMatricula(db, c.ctx.operador, c.alfa.id, ` ${c.e1.matricula.toLowerCase()} `);
    assert.deepEqual(r, { vinculoId: c.e1.vinculoId, forma: 'MATRICULA_DIGITADA' });
    const mensagens = new Set();
    for (const m of [c.e2.matricula, 'INEXISTENTE']) {
      await assert.rejects(entregas.identificarPorMatricula(db, c.ctx.operador, c.alfa.id, m), (err) => {
        mensagens.add(err.detalhes?.matricula);
        return err.codigo === 'VALIDACAO';
      });
    }
    assert.equal(mensagens.size, 1);
    const atendimento = await entregas.obterAtendimento(db, c.ctx.operador, c.e1.vinculoId);
    assert.deepEqual([atendimento.vinculo.nome, atendimento.vinculo.serie, atendimento.vinculo.ano_letivo], [c.e1.nome, 2, c.ofertaAlfa.ano.ano]);
  }));

  test('CA-040.7: Consulta e administração institucional sem papel no campus não operam (403); outro campus: 404', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(entregas.identificarPorMatricula(db, await contextoDe(db, c.adminInst), c.alfa.id, c.e1.matricula), comCodigo('PROIBIDO'));
    await atribuir(db, c.semAcesso.id, 'CONSULTA', c.alfa.id);
    const consulta = await contextoDe(db, c.semAcesso);
    await assert.rejects(entregas.identificarPorMatricula(db, consulta, c.alfa.id, c.e1.matricula), comCodigo('PROIBIDO'));
    await assert.rejects(entregas.prepararEntrega(db, consulta, c.e1.vinculoId, { titulos: [c.t1.id] }, c.identificado(c.e1)), comCodigo('PROIBIDO'));
    await assert.rejects(entregas.identificarPorMatricula(db, c.ctx.adminBeta, c.alfa.id, c.e1.matricula), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(entregas.obterAtendimento(db, c.ctx.adminBeta, c.e1.vinculoId), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(entregas.obterAtendimento(db, await contextoDe(db, c.estudante), c.e1.vinculoId), comCodigo('NAO_ENCONTRADO'));
  }));
});

describe('RF-040 e RF-041 — preparação', () => {
  test('prepara com o termo vigente, um exemplar por título, cópia dos dados e sem mexer no estoque (CA-040.2, CA-040.6)', emTransacao(async (db) => {
    const c = await cenario(db);
    const { id } = await entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t1.id, c.t2.id, c.t1.id] }, c.identificado(c.e1));
    const { entrega, itens } = await entregas.obterEntrega(db, c.ctx.adminAlfa, id);
    assert.equal(entrega.status, 'PREPARADA');
    assert.equal(entrega.termo_versao, c.termo.versao);
    assert.equal(entrega.forma_identificacao, 'MATRICULA_DIGITADA');
    assert.deepEqual(itens.map((i) => i.quantidade), [1, 1]);
    assert.deepEqual([entrega.snapshot_estudante.matricula, entrega.snapshot_estudante.serie, entrega.snapshot_unidade.nomeCurto],
      [c.e1.matricula, 2, 'Campus Alfa']);
    assert.equal(await saldo(db, c.alfa.id, c.t1.id), 5);
    const { rows } = await db.query("SELECT campus_id FROM auditoria WHERE acao = 'entregas.preparada' AND entidade_id = $1", [id]);
    assert.deepEqual(rows, [{ campus_id: c.alfa.id }]);
  }));

  test('CA-042.8: só prepara para o estudante identificado neste atendimento', emTransacao(async (db) => {
    const c = await cenario(db);
    for (const identificacao of [null, { vinculoId: c.e2.vinculoId, forma: 'MATRICULA_DIGITADA' }]) {
      await assert.rejects(entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t1.id] }, identificacao), comCodigo('IDENTIFICACAO_NECESSARIA'));
    }
  }));

  test('CA-040.3: título sem saldo no campus não entra; seleção vazia é recusada', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t1.id, c.semSaldo.id] }, c.identificado(c.e1)), comCodigo('VALIDACAO'));
    await assert.rejects(entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [] }, c.identificado(c.e1)), comCodigo('VALIDACAO'));
  }));

  test('CA-040.4 e RF-043: uma entrega aguardando por estudante; cancelar libera e não mexe no estoque', emTransacao(async (db) => {
    const c = await cenario(db);
    const { id } = await entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t1.id] }, c.identificado(c.e1));
    await assert.rejects(entregas.prepararEntrega(db, c.ctx.adminAlfa, c.e1.vinculoId, { titulos: [c.t2.id] }, c.identificado(c.e1)), comCodigo('ENTREGA_PREPARADA_EXISTENTE'));
    // Outro operador ou a administração do campus podem cancelar (RN-25); Consulta não.
    await atribuir(db, c.semAcesso.id, 'CONSULTA', c.alfa.id);
    await assert.rejects(entregas.cancelarEntrega(db, await contextoDe(db, c.semAcesso), id), comCodigo('PROIBIDO'));
    await assert.rejects(entregas.cancelarEntrega(db, c.ctx.adminBeta, id), comCodigo('NAO_ENCONTRADO'));
    await entregas.cancelarEntrega(db, c.ctx.adminAlfa, id);
    await assert.rejects(entregas.cancelarEntrega(db, c.ctx.operador, id), comCodigo('ENTREGA_NAO_PREPARADA'));
    assert.equal(await saldo(db, c.alfa.id, c.t1.id), 5);
    const nova = await entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t2.id] }, c.identificado(c.e1));
    assert.ok(nova.id);
  }));

  test('CA-041.1 e CA-041.4: título já em posse (inclusive de outro campus) exige confirmação, que fica registrada', emTransacao(async (db) => {
    const c = await cenario(db);
    // O estudante recebeu t1 em Beta (entrega assinada), teve o vínculo encerrado e agora está em Alfa.
    const e3 = await criarEstudanteComVinculo(db, { campusId: c.beta.id, oferta: c.ofertaBeta, criadoPor: c.adminBeta.id });
    const emBeta = await entregas.prepararEntrega(db, c.ctx.adminBeta, e3.vinculoId, { titulos: [c.t1.id] }, c.identificado(e3));
    await db.query("UPDATE entrega SET status = 'ASSINADA' WHERE id = $1", [emBeta.id]); // a assinatura entra na etapa 2
    await db.query("UPDATE vinculo_estudante SET situacao = 'TRANSFERIDO', fim = inicio, encerrado_por = $2 WHERE id = $1", [e3.vinculoId, c.adminBeta.id]);
    const { rows } = await db.query('INSERT INTO vinculo_estudante (campus_id, estudante_id, curso_id, periodo_letivo_id, serie, criado_por) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id',
      [c.alfa.id, e3.id, c.ofertaAlfa.curso.id, c.ofertaAlfa.ano.id, c.adminAlfa.id]);
    const emAlfa = { vinculoId: rows[0].id, forma: 'MATRICULA_DIGITADA' };

    const atendimento = await entregas.obterAtendimento(db, c.ctx.operador, emAlfa.vinculoId);
    assert.ok(atendimento.emPosse.has(c.t1.id));
    await assert.rejects(entregas.prepararEntrega(db, c.ctx.operador, emAlfa.vinculoId, { titulos: [c.t1.id, c.t2.id] }, emAlfa),
      (err) => err.codigo === 'VALIDACAO' && Boolean(err.detalhes.confirmacao) && err.detalhes.avisos[0].tituloId === c.t1.id);
    const { id } = await entregas.prepararEntrega(db, c.ctx.operador, emAlfa.vinculoId, { titulos: [c.t1.id, c.t2.id], confirmacao: 'sim' }, emAlfa);
    const { entrega } = await entregas.obterEntrega(db, c.ctx.operador, id);
    assert.deepEqual(entrega.avisos_confirmados, [{ tipo: 'TITULO_EM_POSSE', tituloId: c.t1.id, confirmadoPor: c.operadorAlfa.id }]);
  }));
});

describe('Reforço no banco (RLS, FKs compostas e transições)', () => {
  test('operador de Alfa não grava entrega em Beta nem usa vínculo de Beta; administração institucional sem campus não grava', emTransacao(async (db) => {
    const c = await cenario(db);
    const inserir = (escopo, campusId, vinculoId, periodoId, autor) => comContexto(db, escopo, (x) => x.query(
      `INSERT INTO entrega (campus_id, vinculo_id, periodo_letivo_id, termo_modelo_id, forma_identificacao, preparada_por, snapshot_estudante, snapshot_unidade)
       VALUES ($1, $2, $3, $4, 'MATRICULA_DIGITADA', $5, '{}', '{}')`, [campusId, vinculoId, periodoId, c.termo.id, autor]));
    const alfa = { usuarioId: c.operadorAlfa.id, campi: [c.alfa.id] };
    await assert.rejects(inserir(alfa, c.beta.id, c.e2.vinculoId, c.ofertaBeta.ano.id, c.operadorAlfa.id), (err) => err.code === '42501');
    // Vínculo de Beta com campus Alfa: recusado pelo gatilho (vínculo ativo no campus) ou pela FK composta.
    await assert.rejects(inserir(alfa, c.alfa.id, c.e2.vinculoId, c.ofertaAlfa.ano.id, c.operadorAlfa.id), (err) => ['23514', '23503'].includes(err.code));
    const inst = { usuarioId: c.adminInst.id, campi: [], escopoInstitucional: true, adminInstitucional: true };
    await assert.rejects(inserir(inst, c.alfa.id, c.e1.vinculoId, c.ofertaAlfa.ano.id, c.adminInst.id), (err) => err.code === '42501');
  }));

  test('vínculo encerrado não recebe entrega; transições inválidas, alteração de dados e exclusão são recusadas', emTransacao(async (db) => {
    const c = await cenario(db);
    const { id } = await entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t1.id] }, c.identificado(c.e1));
    const alfa = { usuarioId: c.operadorAlfa.id, campi: [c.alfa.id] };
    for (const [sql, codigo] of [
      ["UPDATE entrega SET status = 'ESTORNADA' WHERE id = $1", '23514'],
      ["UPDATE entrega SET snapshot_estudante = '{}' WHERE id = $1", '23514'],
      ['DELETE FROM entrega WHERE id = $1', '42501'],
      ['DELETE FROM entrega_item WHERE entrega_id = $1', '42501'],
    ]) {
      await assert.rejects(comContexto(db, alfa, (x) => x.query(sql, [id])), (err) => err.code === codigo, sql);
    }
    await entregas.cancelarEntrega(db, c.ctx.operador, id);
    await assert.rejects(comContexto(db, alfa, (x) => x.query('INSERT INTO entrega_item (campus_id, entrega_id, titulo_id) VALUES ($1, $2, $3)', [c.alfa.id, id, c.t2.id])), (err) => err.code === '23514');
    await assert.rejects(comContexto(db, alfa, (x) => x.query("UPDATE entrega SET status = 'ASSINADA' WHERE id = $1", [id])), (err) => err.code === '23514');
    await db.query("UPDATE vinculo_estudante SET situacao = 'EVADIDO', fim = inicio, encerrado_por = $2 WHERE id = $1", [c.e1.vinculoId, c.adminAlfa.id]);
    await assert.rejects(entregas.prepararEntrega(db, c.ctx.operador, c.e1.vinculoId, { titulos: [c.t1.id] }, c.identificado(c.e1)), comCodigo('VINCULO_ENCERRADO'));
  }));
});
