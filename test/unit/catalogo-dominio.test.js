// Regras do catálogo (src/modulos/catalogo/dominio.js): ISBN e abrangência.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarIsbn, formatarIsbn, validarTitulo } from '../../src/modulos/catalogo/dominio.js';

const detalhes = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.detalhes;
  }
  return null;
};
const titulo = (extra = {}) => ({
  titulo: 'Matemática Fictícia', autores: 'Autora Fictícia', isbn: '', editora: '', edicao: '', volume: '', anoPublicacao: '',
  componente: 'Matemática', codigoPrograma: '', abrangencia: 'ENSINO_MEDIO_COMPLETO', serie: '', ...extra,
});

describe('ISBN (RN-73)', () => {
  test('ISBN-13 com ou sem hífens é aceito e normalizado', () => {
    assert.equal(normalizarIsbn('978-0-306-40615-7'), '9780306406157');
    assert.equal(normalizarIsbn(' 9780306406157 '), '9780306406157');
  });

  test('ISBN-10 (inclusive com X) é convertido para ISBN-13', () => {
    assert.equal(normalizarIsbn('0-306-40615-2'), '9780306406157');
    assert.equal(normalizarIsbn('0-8044-2957-x'), '9780804429573');
  });

  test('vazio vira null (material sem ISBN)', () => {
    assert.equal(normalizarIsbn(''), null);
    assert.equal(normalizarIsbn('  '), null);
  });

  test('dígito verificador errado, tamanho errado ou prefixo inválido é recusado', () => {
    for (const s of ['9780306406158', '0306406153', '12345', '1230306406157', '978030640615X']) {
      assert.throws(() => normalizarIsbn(s), /ISBN inválido/, s);
    }
  });

  test('formatação para exibição', () => {
    assert.equal(formatarIsbn('9780306406157'), '978-0306406157');
    assert.equal(formatarIsbn(null), '');
  });
});

describe('Abrangência e série (RN-74, CA-020.2)', () => {
  test('série específica exige série de 1 a 4', () => {
    assert.equal(validarTitulo(titulo({ abrangencia: 'SERIE_ESPECIFICA', serie: '2' })).serie, 2);
    for (const serie of ['', '0', '5', 'x']) {
      assert.ok(detalhes(() => validarTitulo(titulo({ abrangencia: 'SERIE_ESPECIFICA', serie }))).serie, serie);
    }
  });

  test('ensino médio completo ignora a série informada', () => {
    assert.equal(validarTitulo(titulo({ serie: '3' })).serie, null);
  });

  test('abrangência ausente ou desconhecida é recusada', () => {
    assert.ok(detalhes(() => validarTitulo(titulo({ abrangencia: '' }))).abrangencia);
    assert.ok(detalhes(() => validarTitulo(titulo({ abrangencia: 'OUTRA' }))).abrangencia);
  });
});

describe('Demais campos', () => {
  test('obrigatórios, opcionais vazios viram null e ano de publicação é validado', () => {
    const d = validarTitulo(titulo({ isbn: '0-306-40615-2', anoPublicacao: '2024' }));
    assert.equal(d.isbn, '9780306406157');
    assert.equal(d.anoPublicacao, 2024);
    assert.equal(d.editora, null);
    const erros = detalhes(() => validarTitulo(titulo({ titulo: ' ', autores: '', anoPublicacao: '24' })));
    assert.deepEqual(Object.keys(erros).sort(), ['anoPublicacao', 'autores', 'titulo']);
  });

  // Regressão: com ISBN inválido, o erro da série não aparecia (o zod parava antes).
  test('erros de campos diferentes aparecem juntos (ISBN inválido + série ausente)', () => {
    const erros = detalhes(() => validarTitulo(titulo({ isbn: '9780306406158', abrangencia: 'SERIE_ESPECIFICA', serie: '' })));
    assert.deepEqual(Object.keys(erros).sort(), ['isbn', 'serie']);
  });

  test('ISBN inválido aparece como erro do campo isbn', () => {
    assert.match(detalhes(() => validarTitulo(titulo({ isbn: '9780306406158' }))).isbn, /ISBN inválido/);
  });
});
