// Validação de anos letivos e cursos (src/modulos/campi/oferta-dominio.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { esquemaAnoLetivo, esquemaCurso, validarOferta } from '../../src/modulos/campi/oferta-dominio.js';

const detalhes = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.detalhes;
  }
  return null;
};
const ano = (extra = {}) => ({ ano: '2027', inicio: '2027-02-10', fim: '2027-12-15', ...extra });

describe('Ano letivo (RF-012)', () => {
  test('aceita o ano digitado no formulário e datas válidas', () => {
    assert.deepEqual(validarOferta(esquemaAnoLetivo, ano()), { ano: 2027, inicio: '2027-02-10', fim: '2027-12-15' });
  });

  test('ano fora de 2000 a 2100, decimal ou vazio é recusado no campo ano', () => {
    for (const valor of ['1999', '2101', '2027.5', 'x', '']) {
      assert.ok(detalhes(() => validarOferta(esquemaAnoLetivo, ano({ ano: valor }))).ano, valor);
    }
  });

  test('término igual ou anterior ao início é recusado no campo fim', () => {
    assert.ok(detalhes(() => validarOferta(esquemaAnoLetivo, ano({ fim: '2027-02-10' }))).fim);
    assert.ok(detalhes(() => validarOferta(esquemaAnoLetivo, ano({ fim: '2027-01-01' }))).fim);
  });

  test('datas inexistentes ou mal formatadas são recusadas', () => {
    for (const inicio of ['2027-02-30', '10/02/2027', '', '2027-13-01']) {
      assert.ok(detalhes(() => validarOferta(esquemaAnoLetivo, ano({ inicio }))).inicio, inicio);
    }
  });
});

describe('Curso (RF-012)', () => {
  test('curso exige nome; espaços nas pontas são removidos', () => {
    assert.ok(detalhes(() => validarOferta(esquemaCurso, { nome: ' ' })).nome);
    assert.deepEqual(validarOferta(esquemaCurso, { nome: '  Técnico Fictício ' }), { nome: 'Técnico Fictício' });
  });
});
