// Regras do cadastro de estudantes e da planilha (src/modulos/estudantes/dominio.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerCsv, decodificarArquivo, mapearCabecalho, lerSerie, validarDadosEstudante, validarEncerramento, normalizarMatricula,
} from '../../src/modulos/estudantes/dominio.js';

const DOMINIOS = { dominiosEstudante: ['estudantes.exemplo.teste'] };
const dados = (extra = {}) => ({
  matricula: ' 2027a001 ', nome: '  Ana   Fictícia ', email: ' ANA@Estudantes.Exemplo.Teste ', cursoId: 'c', periodoId: 'p', serie: 1, ...extra,
});

describe('Planilha CSV (RF-030, formato proposto para DV-11)', () => {
  test('separador ";" ou ",", aspas, quebras de linha CRLF e linhas em branco', () => {
    assert.deepEqual(lerCsv('a;b\r\n"1;x";"dito ""assim"""\r\n\r\n2;y').map((l) => [l.numero, l.campos]),
      [[1, ['a', 'b']], [2, ['1;x', 'dito "assim"']], [4, ['2', 'y']]]);
    assert.deepEqual(lerCsv('a,b\n1,2').map((l) => l.campos), [['a', 'b'], ['1', '2']]);
  });

  test('o número da linha considera campos com quebra de linha', () => {
    assert.deepEqual(lerCsv('a;b\n1;"x\ny"\n2;z').map((l) => l.numero), [1, 2, 4]);
  });

  test('UTF-8 com BOM e Windows-1252 (Excel) são lidos', () => {
    assert.equal(decodificarArquivo(Buffer.from('﻿Série', 'utf8')), 'Série');
    assert.equal(decodificarArquivo(Buffer.from([0x53, 0xe9, 0x72, 0x69, 0x65])), 'Série'); // "Série" em Windows-1252
  });

  test('cabeçalho aceita maiúsculas, acentos e sinônimos; coluna faltando é erro na linha 1', () => {
    const pos = mapearCabecalho(['Matrícula', 'Nome', 'E-mail institucional', 'Curso', 'Série', 'Ano letivo']);
    assert.deepEqual(pos, { matricula: 0, nome: 1, email: 2, curso: 3, serie: 4, ano_letivo: 5 });
    assert.throws(() => mapearCabecalho(['matricula', 'nome']), (err) => err.detalhes.erros[0].linha === 1 && /email/.test(err.message));
  });

  test('série de 1 a 4 em formatos comuns (DP-17)', () => {
    for (const [s, n] of [['1', 1], ['2ª', 2], ['3º ano', 3], ['4ª série', 4], ['5', null], ['0', null], ['', null], ['primeira', null]]) {
      assert.equal(lerSerie(s), n, s);
    }
  });
});

describe('Dados do estudante (RN-06)', () => {
  test('normaliza matrícula, nome e e-mail', () => {
    assert.deepEqual(validarDadosEstudante(dados(), DOMINIOS).dados,
      { matricula: '2027A001', nome: 'Ana Fictícia', email: 'ana@estudantes.exemplo.teste', cursoId: 'c', periodoId: 'p', serie: 1 });
    assert.equal(normalizarMatricula(' 12 34 '), '1234');
  });

  test('e-mail fora do domínio de estudantes (inclusive parecido) é recusado', () => {
    for (const email of ['ana@gmail.com', 'ana@estudantes.exemplo.teste.outro.com', 'ana@exemplo.teste', 'sem-arroba']) {
      assert.ok(validarDadosEstudante(dados({ email }), DOMINIOS).erros.email, email);
    }
  });

  test('cada problema aparece no seu campo', () => {
    const { erros } = validarDadosEstudante(dados({ matricula: 'x', nome: 'A', cursoId: null, periodoId: null, serie: null }), DOMINIOS);
    assert.deepEqual(Object.keys(erros).sort(), ['anoLetivo', 'curso', 'matricula', 'nome', 'serie']);
  });
});

describe('Encerramento do vínculo (RF-033)', () => {
  const datas = { inicio: '2027-02-01', hoje: '2027-06-10' };
  test('exige motivo e data entre o início do vínculo e hoje', () => {
    assert.deepEqual(validarEncerramento({ situacao: 'EVADIDO', fim: '2027-06-10' }, datas), { situacao: 'EVADIDO', fim: '2027-06-10' });
    const erro = (entrada) => {
      try {
        validarEncerramento(entrada, datas);
      } catch (e) {
        return e.detalhes;
      }
      return null;
    };
    assert.ok(erro({ situacao: 'ATIVO', fim: '2027-06-01' }).situacao);
    assert.match(erro({ situacao: 'CONCLUIDO', fim: '2027-01-31' }).fim, /anterior/);
    assert.match(erro({ situacao: 'CONCLUIDO', fim: '2027-06-11' }).fim, /futura/);
    assert.ok(erro({ situacao: 'CONCLUIDO', fim: '' }).fim);
  });
});
