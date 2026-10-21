// Validação e normalização dos dados de campus (src/modulos/campi/dominio.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { esquemaNovoCampus, esquemaConfiguracao, validarCampus } from '../../src/modulos/campi/dominio.js';

const config = (extra = {}) => ({
  nomeOficial: 'Instituto Fictício – Campus Alfa', nomeCurto: 'Alfa', endereco: '', cidade: '', uf: '', cep: '',
  setorResponsavel: '', emailSetor: '', telefone: '', permiteEntregaComPendencia: true, ...extra,
});
const detalhes = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.detalhes;
  }
  return null;
};

describe('Novo campus (RF-010)', () => {
  test('código é normalizado em maiúsculas e sem espaços nas pontas', () => {
    assert.deepEqual(validarCampus(esquemaNovoCampus, { codigo: ' fra ', nomeOficial: ' Campus Fictício ', nomeCurto: 'Fic' }), {
      codigo: 'FRA', nomeOficial: 'Campus Fictício', nomeCurto: 'Fic',
    });
  });

  test('código inválido, nome oficial curto e nome curto vazio geram erro em cada campo', () => {
    const d = detalhes(() => validarCampus(esquemaNovoCampus, { codigo: 'F R', nomeOficial: 'abc', nomeCurto: ' ' }));
    assert.deepEqual(Object.keys(d).sort(), ['codigo', 'nomeCurto', 'nomeOficial']);
  });

  test('código com caracteres especiais ou longo demais é recusado', () => {
    for (const codigo of ['F-R', 'Á1', 'A', 'ABCDEFGHIJK']) {
      assert.ok(detalhes(() => validarCampus(esquemaNovoCampus, { codigo, nomeOficial: 'Campus Fictício', nomeCurto: 'Fic' })).codigo, codigo);
    }
  });
});

describe('Configuração do campus (RF-011)', () => {
  test('campos vazios viram null; UF, CEP e e-mail são normalizados', () => {
    const d = validarCampus(esquemaConfiguracao, config({ uf: 'sc', cep: '89580-000', emailSetor: ' CGE@Exemplo.TESTE ' }));
    assert.equal(d.uf, 'SC');
    assert.equal(d.cep, '89580000');
    assert.equal(d.emailSetor, 'cge@exemplo.teste');
    assert.equal(d.endereco, null);
    assert.equal(d.codigo, undefined);
  });

  test('UF, CEP e e-mail inválidos geram erro no campo correspondente', () => {
    const d = detalhes(() => validarCampus(esquemaConfiguracao, config({ uf: 'Santa Catarina', cep: '123', emailSetor: 'nao-e-email' })));
    assert.deepEqual(Object.keys(d).sort(), ['cep', 'emailSetor', 'uf']);
  });

  test('textos acima do limite são recusados', () => {
    assert.ok(detalhes(() => validarCampus(esquemaConfiguracao, config({ endereco: 'x'.repeat(201) }))).endereco);
  });
});
