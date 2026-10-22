// Estoque do campus (RF-025 a RF-028) contra o PostgreSQL real, em transações desfeitas.
// O teste de concorrência grava de fato (duas transações simultâneas), com nomes aleatórios.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe, atribuir, criarTitulo, criarCampus, criarUsuario, criarDominios } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as estoque from '../../src/modulos/estoque/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const entrada = (quantidade, origem = 'Recebimento fictício') => ({ quantidade: String(quantidade), origem });
const baixa = (quantidade, justificativa = 'Danificados no depósito (fictício)') => ({ quantidade: String(quantidade), justificativa });

async function cenario(db) {
  const c = await cenarioDoisCampi(db);
  return { ...c, titulo: await criarTitulo(db, c.adminInst.id) };
}

describe('RF-025 a RF-028 — movimentações e saldo', () => {
  test('CA-025.1: entrada aumenta o saldo e fica no histórico com responsável e auditoria', emTransacao(async (db) => {
    const c = await cenario(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    const m = await estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'ENTRADA', entrada(30, 'PNLD fictício'));
    assert.equal(m.saldo.disponivel, 30);
    const r = await estoque.obterTituloNoEstoque(db, ctx, c.alfa.id, c.titulo.id);
    assert.deepEqual(r.saldo, { disponivel: 30, baixados: 0 });
    assert.equal(r.movimentacoes.length, 1);
    // CA-028.1: tipo, quantidade, data/hora, responsável e referência (origem).
    const [h] = r.movimentacoes;
    assert.deepEqual([h.tipo, h.quantidade, h.origem, h.responsavel], ['ENTRADA', 30, 'PNLD fictício', c.adminAlfa.nome]);
    assert.ok(h.ocorrido_em instanceof Date);
    const { rows } = await db.query("SELECT campus_id, usuario_id FROM auditoria WHERE acao = 'estoque.entrada' AND entidade_id = $1", [String(m.id)]);
    assert.deepEqual(rows, [{ campus_id: c.alfa.id, usuario_id: c.adminAlfa.id }]);
  }));

  test('CA-026.1: baixa e ajuste sem justificativa são recusados; com justificativa alteram o saldo', emTransacao(async (db) => {
    const c = await cenario(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    await estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'ENTRADA', entrada(10));
    await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'BAIXA', baixa(1, '')), comCodigo('VALIDACAO'));
    await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'AJUSTE', { quantidade: '1', sentido: 'REDUCAO', justificativa: '' }), comCodigo('VALIDACAO'));
    await estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'BAIXA', baixa(2));
    await estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'AJUSTE', { quantidade: '1', sentido: 'REDUCAO', justificativa: 'Contagem física' });
    const m = await estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'AJUSTE', { quantidade: '4', sentido: 'ACRESCIMO', justificativa: 'Contagem física' });
    assert.deepEqual(m.saldo, { disponivel: 11, baixados: 2 });
  }));

  test('CA-026.2: retirada acima do saldo é recusada e nada é gravado', emTransacao(async (db) => {
    const c = await cenario(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    // Título sem nenhuma entrada no campus: saldo zero.
    await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'BAIXA', baixa(1)),
      (err) => err.codigo === 'VALIDACAO' && /Saldo insuficiente/.test(err.detalhes.quantidade));
    await estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'ENTRADA', entrada(3));
    await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'AJUSTE', { quantidade: '4', sentido: 'REDUCAO', justificativa: 'Contagem física' }), comCodigo('VALIDACAO'));
    const r = await estoque.obterTituloNoEstoque(db, ctx, c.alfa.id, c.titulo.id);
    assert.equal(r.saldo.disponivel, 3);
    assert.equal(r.total, 1);
  }));

  test('CA-027.1: saldo de cada título igual à soma do livro-razão; histórico do campus em ordem decrescente', emTransacao(async (db) => {
    const c = await cenario(db);
    const outro = await criarTitulo(db, c.adminInst.id);
    const ctx = await contextoDe(db, c.adminAlfa);
    for (const [t, tipo, dados] of [[c.titulo, 'ENTRADA', entrada(5)], [outro, 'ENTRADA', entrada(7)], [c.titulo, 'BAIXA', baixa(2)]]) {
      await estoque.registrarMovimentacao(db, ctx, c.alfa.id, t.id, tipo, dados);
    }
    assert.deepEqual(await estoque.verificarConsistencia(db, ctx, c.alfa.id), []);
    const lista = await estoque.listarEstoque(db, ctx, c.alfa.id);
    assert.deepEqual(lista.itens.map((i) => [i.titulo_id, i.disponivel, i.baixados]).sort(), [[c.titulo.id, 3, 2], [outro.id, 7, 0]].sort());
    const h = await estoque.listarMovimentacoesDoCampus(db, ctx, c.alfa.id);
    assert.deepEqual(h.movimentacoes.map((m) => m.tipo), ['BAIXA', 'ENTRADA', 'ENTRADA']);
  }));

  test('campus desativado não tem estoque movimentado', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(estoque.registrarMovimentacao(db, await contextoDe(db, c.adminInst), c.gama.id, c.titulo.id, 'ENTRADA', entrada(1)), comCodigo('CAMPUS_INATIVO'));
  }));
});

describe('Isolamento entre campi e permissões (CA-027.2)', () => {
  test('cada campus tem o próprio saldo; listagens e históricos não trazem o outro campus', emTransacao(async (db) => {
    const c = await cenario(db);
    await estoque.registrarMovimentacao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, c.titulo.id, 'ENTRADA', entrada(10));
    await estoque.registrarMovimentacao(db, await contextoDe(db, c.adminBeta), c.beta.id, c.titulo.id, 'ENTRADA', entrada(4));
    const beta = await contextoDe(db, c.adminBeta);
    assert.deepEqual((await estoque.listarEstoque(db, beta, c.beta.id)).itens.map((i) => i.disponivel), [4]);
    assert.equal((await estoque.listarMovimentacoesDoCampus(db, beta, c.beta.id)).total, 1);
  }));

  test('quem não tem papel no campus recebe 404 em toda leitura e escrita (inclusive estudante)', emTransacao(async (db) => {
    const c = await cenario(db);
    await estoque.registrarMovimentacao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, c.titulo.id, 'ENTRADA', entrada(10));
    for (const u of [c.adminBeta, c.semAcesso, c.estudante]) {
      const ctx = await contextoDe(db, u);
      await assert.rejects(estoque.listarEstoque(db, ctx, c.alfa.id), comCodigo('NAO_ENCONTRADO'));
      await assert.rejects(estoque.obterTituloNoEstoque(db, ctx, c.alfa.id, c.titulo.id), comCodigo('NAO_ENCONTRADO'));
      await assert.rejects(estoque.listarMovimentacoesDoCampus(db, ctx, c.alfa.id), comCodigo('NAO_ENCONTRADO'));
      await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'BAIXA', baixa(1)), comCodigo('NAO_ENCONTRADO'));
    }
  }));

  test('Consulta e Operador do campus veem o estoque, mas não movimentam (403)', emTransacao(async (db) => {
    const c = await cenario(db);
    await atribuir(db, c.consultaAlfa.id, 'OPERADOR', c.alfa.id);
    const ctx = await contextoDe(db, c.consultaAlfa);
    const r = await estoque.listarEstoque(db, ctx, c.alfa.id);
    assert.equal(r.podeMovimentar, false);
    await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, c.titulo.id, 'ENTRADA', entrada(1)), comCodigo('PROIBIDO'));
    await assert.rejects(estoque.prepararMovimentacao(db, ctx, c.alfa.id, c.titulo.id), comCodigo('PROIBIDO'));
    await assert.rejects(estoque.buscarTitulosParaEntrada(db, ctx, c.alfa.id, { termo: 'x' }), comCodigo('PROIBIDO'));
  }));

  test('administração institucional consulta e movimenta qualquer campus', emTransacao(async (db) => {
    const c = await cenario(db);
    const inst = await contextoDe(db, c.adminInst);
    const m = await estoque.registrarMovimentacao(db, inst, c.beta.id, c.titulo.id, 'ENTRADA', entrada(2));
    assert.equal(m.saldo.disponivel, 2);
    assert.equal((await estoque.listarEstoque(db, inst, c.beta.id)).total, 1);
  }));

  test('título ou campus inexistente, ou identificador malformado: 404', emTransacao(async (db) => {
    const c = await cenario(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    const inexistente = '00000000-0000-4000-8000-000000000000';
    await assert.rejects(estoque.obterTituloNoEstoque(db, ctx, c.alfa.id, inexistente), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(estoque.registrarMovimentacao(db, ctx, c.alfa.id, 'nao-e-uuid', 'ENTRADA', entrada(1)), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(estoque.listarEstoque(db, await contextoDe(db, c.adminInst), inexistente), comCodigo('NAO_ENCONTRADO'));
  }));
});

describe('Reforço no banco (RLS, imutabilidade e saldo)', () => {
  test('com escopo de Alfa, o estoque e as movimentações de Beta não aparecem e não podem ser gravados', emTransacao(async (db) => {
    const c = await cenario(db);
    await estoque.registrarMovimentacao(db, await contextoDe(db, c.adminBeta), c.beta.id, c.titulo.id, 'ENTRADA', entrada(5));
    const alfa = { usuarioId: c.adminAlfa.id, campi: [c.alfa.id] };
    await comContexto(db, alfa, async (x) => {
      assert.equal((await x.query('SELECT 1 FROM estoque WHERE campus_id = $1', [c.beta.id])).rowCount, 0);
      assert.equal((await x.query('SELECT 1 FROM movimentacao_estoque WHERE campus_id = $1', [c.beta.id])).rowCount, 0);
    });
    const inserir = (escopo, campusId, usuarioId, quantidade = 1) => comContexto(db, escopo, (x) => x.query(
      "INSERT INTO movimentacao_estoque (campus_id, titulo_id, tipo, quantidade, origem, usuario_id) VALUES ($1, $2, 'ENTRADA', $3, 'Teste', $4)",
      [campusId, c.titulo.id, quantidade, usuarioId]));
    await assert.rejects(inserir(alfa, c.beta.id, c.adminAlfa.id), (err) => err.code === '42501');
    // Em nome de outra pessoa também não.
    await assert.rejects(inserir(alfa, c.alfa.id, c.adminBeta.id), (err) => err.code === '42501');
  }));

  test('livro-razão não se altera nem se apaga; saldo não se edita diretamente', emTransacao(async (db) => {
    const c = await cenario(db);
    const m = await estoque.registrarMovimentacao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, c.titulo.id, 'ENTRADA', entrada(5));
    const inst = { usuarioId: c.adminInst.id, campi: [c.alfa.id], escopoInstitucional: true, adminInstitucional: true };
    for (const sql of [
      ['UPDATE movimentacao_estoque SET quantidade = 50 WHERE id = $1', [m.id]],
      ['DELETE FROM movimentacao_estoque WHERE id = $1', [m.id]],
      ['UPDATE estoque SET disponivel = 500 WHERE campus_id = $1', [c.alfa.id]],
      ['DELETE FROM estoque WHERE campus_id = $1', [c.alfa.id]],
      ['INSERT INTO estoque (campus_id, titulo_id, disponivel) VALUES ($1, $2, 9)', [c.beta.id, c.titulo.id]],
    ]) {
      await assert.rejects(comContexto(db, inst, (x) => x.query(...sql)), (err) => err.code === '42501', sql[0]);
    }
  }));

  test('RN-72: o banco recusa movimentação que deixaria o saldo negativo, mesmo sem passar pelo serviço', emTransacao(async (db) => {
    const c = await cenario(db);
    await estoque.registrarMovimentacao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, c.titulo.id, 'ENTRADA', entrada(2));
    await assert.rejects(comContexto(db, { usuarioId: c.adminAlfa.id, campi: [c.alfa.id] }, (x) => x.query(
      "INSERT INTO movimentacao_estoque (campus_id, titulo_id, tipo, quantidade, justificativa, usuario_id) VALUES ($1, $2, 'BAIXA', -3, 'Teste', $3)",
      [c.alfa.id, c.titulo.id, c.adminAlfa.id])), (err) => err.code === '23514' && err.constraint === 'ck_estoque_nao_negativo');
  }));
});

describe('Concorrência (RN-72)', () => {
  test('duas baixas simultâneas do último exemplar: só uma é gravada e o saldo não fica negativo', async () => {
    const pool = banco.pool;
    const dominios = await criarDominios(pool);
    const campus = await criarCampus(pool, { nome: 'Campus Concorrência' });
    const admin = await criarUsuario(pool, { dominio: dominios.servidor, nome: 'Admin Concorrência' });
    await atribuir(pool, admin.id, 'ADMIN_CAMPUS', campus.id);
    const titulo = await criarTitulo(pool, admin.id);
    const ctx = await contextoDe(pool, admin);
    await estoque.registrarMovimentacao(pool, ctx, campus.id, titulo.id, 'ENTRADA', entrada(1));

    const resultados = await Promise.allSettled([1, 2].map(() =>
      estoque.registrarMovimentacao(pool, ctx, campus.id, titulo.id, 'BAIXA', baixa(1))));
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    const falha = resultados.find((r) => r.status === 'rejected').reason;
    assert.ok(['ESTOQUE_INSUFICIENTE', 'VALIDACAO'].includes(falha.codigo), falha.message);
    const r = await estoque.obterTituloNoEstoque(pool, ctx, campus.id, titulo.id);
    assert.deepEqual(r.saldo, { disponivel: 0, baixados: 1 });
    assert.deepEqual(await estoque.verificarConsistencia(pool, ctx, campus.id), []);
  });
});
