// Regras das movimentações manuais de estoque (src/modulos/estoque/dominio.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validarMovimentacao, exigirSaldoSuficiente, tipoPorCaminho } from '../../src/modulos/estoque/dominio.js';

const detalhes = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.detalhes ?? e.message;
  }
  return null;
};

describe('Entrada (RN-69, RF-025)', () => {
  test('quantidade positiva e origem obrigatória', () => {
    assert.deepEqual(validarMovimentacao('ENTRADA', { quantidade: '40', origem: ' PNLD fictício ' }),
      { tipo: 'ENTRADA', quantidade: 40, origem: 'PNLD fictício', justificativa: null });
    assert.ok(detalhes(() => validarMovimentacao('ENTRADA', { quantidade: '40', origem: '' })).origem);
  });

  test('quantidade zero, negativa, fracionária, texto ou acima do limite é recusada', () => {
    for (const quantidade of ['0', '-3', '2.5', 'dez', '', '100001']) {
      assert.ok(detalhes(() => validarMovimentacao('ENTRADA', { quantidade, origem: 'Doação' })).quantidade, quantidade);
    }
  });
});

describe('Baixa e ajuste (RN-70, RN-71, CA-026.1)', () => {
  test('baixa sempre retira e exige justificativa', () => {
    assert.equal(validarMovimentacao('BAIXA', { quantidade: '2', justificativa: 'Danificados por infiltração' }).quantidade, -2);
    assert.ok(detalhes(() => validarMovimentacao('BAIXA', { quantidade: '2', justificativa: '  ' })).justificativa);
  });

  test('ajuste acrescenta ou reduz conforme o sentido, com justificativa', () => {
    const base = { quantidade: '3', justificativa: 'Contagem física de fevereiro' };
    assert.equal(validarMovimentacao('AJUSTE', { ...base, sentido: 'ACRESCIMO' }).quantidade, 3);
    assert.equal(validarMovimentacao('AJUSTE', { ...base, sentido: 'REDUCAO' }).quantidade, -3);
    const erros = detalhes(() => validarMovimentacao('AJUSTE', { quantidade: '3', sentido: '', justificativa: '' }));
    assert.deepEqual(Object.keys(erros).sort(), ['justificativa', 'sentido']);
  });

  test('tipos que não são manuais (entrega, devolução, estorno) não passam por aqui', () => {
    for (const tipo of ['ENTREGA', 'DEVOLUCAO', 'ESTORNO', 'OUTRO']) {
      assert.match(detalhes(() => validarMovimentacao(tipo, {})), /inválido/);
    }
  });
});

describe('Saldo (RN-72, CA-026.2)', () => {
  test('retirada acima do disponível é recusada; até o disponível é aceita', () => {
    assert.match(detalhes(() => exigirSaldoSuficiente(2, -3)).quantidade, /Saldo insuficiente/);
    exigirSaldoSuficiente(2, -2);
    exigirSaldoSuficiente(0, 5);
  });

  test('caminhos da URL correspondem só aos tipos manuais', () => {
    assert.equal(tipoPorCaminho('entrada'), 'ENTRADA');
    assert.equal(tipoPorCaminho('ajuste'), 'AJUSTE');
    assert.equal(tipoPorCaminho('entrega'), null);
  });
});
