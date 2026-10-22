// Regras do texto do termo de compromisso (src/modulos/termo/dominio.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { validarTexto, preencher, paragrafos, EXEMPLO } from '../../src/modulos/termo/dominio.js';

const LONGO = 'Declaro que recebi os livros didáticos listados e me comprometo a devolvê-los no prazo.';
const erro = (texto) => {
  try {
    validarTexto(texto);
  } catch (e) {
    return e.detalhes.texto;
  }
  return null;
};

describe('Texto do termo (RF-080)', () => {
  test('normaliza quebras de linha e espaços; recusa texto curto ou longo demais', () => {
    assert.equal(validarTexto(`  ${LONGO}  \r\n\r\nSegundo parágrafo.   \r\n`), `${LONGO}\n\nSegundo parágrafo.`);
    assert.match(erro('Curto demais.'), /pelo menos 50/);
    assert.match(erro('x'.repeat(20001)), /No máximo/);
  });

  test('aceita só os marcadores conhecidos', () => {
    assert.equal(validarTexto(`${LONGO} Eu, {estudante}, matrícula {matricula}, recebi: {livros}.`).includes('{livros}'), true);
    assert.match(erro(`${LONGO} {cpf} e {nome}`), /\{cpf\}, \{nome\}/);
  });

  test('preenche os marcadores e separa parágrafos sem interpretar HTML', () => {
    assert.equal(preencher('Eu, {estudante}, no {campus}. {outro}', EXEMPLO), `Eu, ${EXEMPLO.estudante}, no ${EXEMPLO.campus}. {outro}`);
    assert.deepEqual(paragrafos('a\nb\n\n\nc'), [['a', 'b'], ['c']]);
  });
});
