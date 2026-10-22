// Estudantes e vínculos (RF-030 a RF-033) contra o PostgreSQL real, em transações desfeitas.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe, criarOferta } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as estudantes from '../../src/modulos/estudantes/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};

async function cenario(db) {
  const c = await cenarioDoisCampi(db);
  const ofertaAlfa = await criarOferta(db, c.alfa.id);
  const ofertaBeta = await criarOferta(db, c.beta.id);
  const ctx = {
    adminAlfa: await contextoDe(db, c.adminAlfa), adminBeta: await contextoDe(db, c.adminBeta),
    consultaAlfa: await contextoDe(db, c.consultaAlfa), adminInst: await contextoDe(db, c.adminInst),
    estudante: await contextoDe(db, c.estudante), semAcesso: await contextoDe(db, c.semAcesso),
  };
  const pessoa = () => {
    const s = randomUUID().slice(0, 8);
    return { matricula: `M${s}`.toUpperCase(), nome: `Estudante Fictício ${s}`, email: `aluno.${s}@${c.dominios.estudante}` };
  };
  const form = (oferta, p, extra = {}) => ({ ...p, cursoId: oferta.curso.id, periodoId: oferta.ano.id, serie: '1', ...extra });
  const csv = (oferta, linhas, sep = ';') => Buffer.from(['matricula', 'nome', 'email', 'curso', 'serie', 'ano_letivo'].join(sep) + '\n'
    + linhas.map((l) => [l.matricula, l.nome, l.email, l.curso ?? oferta.curso.nome, l.serie ?? '1', l.ano ?? oferta.ano.ano].join(sep)).join('\n'));
  return { ...c, ofertaAlfa, ofertaBeta, ctx, pessoa, form, csv };
}

const contarVinculos = async (db, campusId) => Number((await db.query('SELECT count(*) FROM vinculo_estudante WHERE campus_id = $1', [campusId])).rows[0].count);

describe('RF-031 — cadastro manual e edição', () => {
  test('cadastra estudante e vínculo; Consulta do campus vê; outro campus não (CA-032.1)', emTransacao(async (db) => {
    const c = await cenario(db);
    const p = c.pessoa();
    const { estudanteId, resumo } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, p));
    assert.equal(resumo.novos, 1);
    const ficha = await estudantes.obterEstudante(db, c.ctx.consultaAlfa, c.alfa.id, estudanteId);
    assert.deepEqual([ficha.estudante.matricula, ficha.ativo.serie, ficha.ativo.ano_letivo], [p.matricula, 1, 2027]);
    await assert.rejects(estudantes.obterEstudante(db, c.ctx.adminBeta, c.beta.id, estudanteId), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(estudantes.obterEstudante(db, c.ctx.adminBeta, c.alfa.id, estudanteId), comCodigo('NAO_ENCONTRADO'));
    assert.equal((await estudantes.listarEstudantes(db, c.ctx.adminBeta, c.beta.id, { situacao: '' })).total, 0);
    const { rows } = await db.query("SELECT campus_id FROM auditoria WHERE acao = 'estudantes.estudante_criado' AND entidade_id = $1", [estudanteId]);
    assert.deepEqual(rows, [{ campus_id: c.alfa.id }]);
  }));

  test('CA-031.1: e-mail de outra matrícula é recusado; mesma matrícula no campus atualiza o vínculo (RN-09)', emTransacao(async (db) => {
    const c = await cenario(db);
    const p = c.pessoa();
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, p));
    await assert.rejects(estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, { ...c.pessoa(), email: p.email })),
      (err) => err.codigo === 'VALIDACAO' && /outra matrícula/.test(err.detalhes.email));
    const r = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, p, { serie: '2' }));
    assert.deepEqual(r.resumo, { novos: 0, novosVinculos: 0, atualizados: 1, semAlteracao: 0 });
    assert.equal((await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId)).ativo.serie, 2);
  }));

  test('CA-031.2: vínculo ativo em outro campus impede novo vínculo; depois de encerrado, o outro campus pode cadastrar', emTransacao(async (db) => {
    const c = await cenario(db);
    const p = c.pessoa();
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, p));
    await assert.rejects(estudantes.cadastrarEstudante(db, c.ctx.adminBeta, c.beta.id, c.form(c.ofertaBeta, p)),
      (err) => err.codigo === 'VALIDACAO' && /outro campus/.test(err.detalhes.matricula));
    const ativo = (await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId)).ativo;
    await estudantes.encerrarVinculo(db, c.ctx.adminAlfa, ativo.id, { situacao: 'TRANSFERIDO', fim: ativo.inicio });
    const r = await estudantes.cadastrarEstudante(db, c.ctx.adminBeta, c.beta.id, c.form(c.ofertaBeta, p, { serie: '2' }));
    assert.equal(r.resumo.novosVinculos, 1);
    // CA-032.2: em Alfa o estudante continua consultável, com o vínculo encerrado; Beta só vê o seu.
    const alfa = await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId);
    assert.deepEqual(alfa.vinculos.map((v) => v.situacao), ['TRANSFERIDO']);
    assert.equal(alfa.ativo, null);
    const beta = await estudantes.obterEstudante(db, c.ctx.adminBeta, c.beta.id, estudanteId);
    assert.deepEqual(beta.vinculos.map((v) => [v.situacao, v.serie]), [['ATIVO', 2]]);
  }));

  test('edição muda nome, e-mail, curso, série e ano; e-mail não muda se o estudante já entrou com ele', emTransacao(async (db) => {
    const c = await cenario(db);
    const p = c.pessoa();
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, p));
    const novo = c.pessoa();
    await estudantes.editarEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId, c.form(c.ofertaAlfa, { ...novo, matricula: 'IGNORADA' }, { serie: '3' }));
    const ficha = await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId);
    assert.deepEqual([ficha.estudante.matricula, ficha.estudante.nome, ficha.estudante.email, ficha.ativo.serie], [p.matricula, novo.nome, novo.email, 3]);
    // Conta de login ligada (RF-006): o e-mail fica fixo.
    const u = await db.query("INSERT INTO usuario (google_sub, email, nome, tipo) VALUES ($1, $2, 'Conta fictícia', 'ESTUDANTE') RETURNING id", [`sub-${randomUUID()}`, novo.email]);
    await db.query('UPDATE estudante SET usuario_id = $2 WHERE id = $1', [estudanteId, u.rows[0].id]);
    await assert.rejects(estudantes.editarEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId, c.form(c.ofertaAlfa, { ...novo, email: c.pessoa().email })),
      (err) => err.codigo === 'VALIDACAO' && /já entrou/.test(err.detalhes.email));
  }));

  test('permissões: Consulta e Operador não cadastram (403); outro campus, estudante e sem acesso: 404', emTransacao(async (db) => {
    const c = await cenario(db);
    await assert.rejects(estudantes.cadastrarEstudante(db, c.ctx.consultaAlfa, c.alfa.id, c.form(c.ofertaAlfa, c.pessoa())), comCodigo('PROIBIDO'));
    for (const ctx of [c.ctx.adminBeta, c.ctx.estudante, c.ctx.semAcesso]) {
      await assert.rejects(estudantes.cadastrarEstudante(db, ctx, c.alfa.id, c.form(c.ofertaAlfa, c.pessoa())), comCodigo('NAO_ENCONTRADO'));
      await assert.rejects(estudantes.listarEstudantes(db, ctx, c.alfa.id), comCodigo('NAO_ENCONTRADO'));
    }
    // Curso e ano letivo de OUTRO campus não servem (CA-012.1, FKs compostas).
    await assert.rejects(estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaBeta, c.pessoa())),
      (err) => err.codigo === 'VALIDACAO' && Boolean(err.detalhes.curso && err.detalhes.anoLetivo));
    // Administração institucional cadastra em qualquer campus.
    assert.equal((await estudantes.cadastrarEstudante(db, c.ctx.adminInst, c.beta.id, c.form(c.ofertaBeta, c.pessoa()))).resumo.novos, 1);
  }));
});

describe('RF-030 — importação por planilha (RN-11)', () => {
  test('CA-030.1: qualquer linha inválida → nada é importado e cada erro aparece com a linha', emTransacao(async (db) => {
    const c = await cenario(db);
    const [a, b] = [c.pessoa(), c.pessoa()];
    const r = await estudantes.importarPlanilha(db, c.ctx.adminAlfa, c.alfa.id, { conteudo: c.csv(c.ofertaAlfa, [
      a, // linha 2: válida
      { ...b, matricula: a.matricula }, // 3: matrícula repetida
      { ...c.pessoa(), email: a.email }, // 4: e-mail repetido
      { ...c.pessoa(), email: 'fora@gmail.com' }, // 5
      { ...c.pessoa(), curso: 'Curso Inexistente' }, // 6
      { ...c.pessoa(), ano: '1999' }, // 7
      { ...c.pessoa(), serie: '5' }, // 8
    ]) });
    assert.deepEqual(r.erros.map((e) => e.linha), [3, 4, 5, 6, 7, 8]);
    assert.match(r.erros.find((e) => e.linha === 6).mensagem, /Curso Inexistente/);
    assert.equal(await contarVinculos(db, c.alfa.id), 0);
  }));

  test('CA-030.2: planilha válida cria; reenviar com mudanças atualiza; Windows-1252 com vírgula é aceito', emTransacao(async (db) => {
    const c = await cenario(db);
    const [a, b] = [c.pessoa(), c.pessoa()];
    const r1 = await estudantes.importarPlanilha(db, c.ctx.adminAlfa, c.alfa.id, { conteudo: c.csv(c.ofertaAlfa, [a, b]) });
    assert.deepEqual(r1.resumo, { linhas: 2, novos: 2, novosVinculos: 0, atualizados: 0, semAlteracao: 0 });
    const texto = c.csv(c.ofertaAlfa, [{ ...a, nome: 'José Fictício', serie: '2ª' }, b], ',').toString('utf8');
    const latin1 = Buffer.from(texto, 'latin1'); // "é" em um byte, como o Excel salva em Windows-1252
    const r2 = await estudantes.importarPlanilha(db, c.ctx.adminAlfa, c.alfa.id, { conteudo: latin1 });
    assert.deepEqual(r2.resumo, { linhas: 2, novos: 0, novosVinculos: 0, atualizados: 1, semAlteracao: 1 });
    const lista = await estudantes.listarEstudantes(db, c.ctx.adminAlfa, c.alfa.id, { termo: 'José Fictício' });
    assert.deepEqual(lista.estudantes.map((e) => e.serie), [2]);
  }));

  test('CA-030.3: estudante ativo em outro campus na planilha → nada é importado; o outro campus não é afetado', emTransacao(async (db) => {
    const c = await cenario(db);
    const deBeta = c.pessoa();
    await estudantes.cadastrarEstudante(db, c.ctx.adminBeta, c.beta.id, c.form(c.ofertaBeta, deBeta));
    const r = await estudantes.importarPlanilha(db, c.ctx.adminAlfa, c.alfa.id, { conteudo: c.csv(c.ofertaAlfa, [c.pessoa(), deBeta]) });
    assert.deepEqual(r.erros.map((e) => [e.linha, /outro campus/.test(e.mensagem)]), [[3, true]]);
    assert.equal(await contarVinculos(db, c.alfa.id), 0);
    assert.equal((await estudantes.listarEstudantes(db, c.ctx.adminBeta, c.beta.id)).total, 1);
  }));

  test('arquivo vazio, sem colunas obrigatórias ou só com cabeçalho é recusado; Consulta não importa', emTransacao(async (db) => {
    const c = await cenario(db);
    const importar = (conteudo, ctx = c.ctx.adminAlfa) => estudantes.importarPlanilha(db, ctx, c.alfa.id, { conteudo: Buffer.from(conteudo) });
    await assert.rejects(importar(''), comCodigo('VALIDACAO'));
    await assert.rejects(importar('matricula;nome\n1;A'), (err) => err.codigo === 'VALIDACAO' && /Faltando/.test(err.message));
    await assert.rejects(importar('matricula;nome;email;curso;serie;ano_letivo\n'), comCodigo('VALIDACAO'));
    await assert.rejects(importar('matricula;nome;email;curso;serie;ano_letivo\n1;A;a@b;c;1;2027', c.ctx.consultaAlfa), comCodigo('PROIBIDO'));
  }));
});

describe('RF-032 e RF-033 — consulta e encerramento', () => {
  test('busca por matrícula, série e situação; vínculo encerrado continua consultável', emTransacao(async (db) => {
    const c = await cenario(db);
    const [a, b] = [c.pessoa(), c.pessoa()];
    await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, a));
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, b, { serie: '3' }));
    const listar = (filtros) => estudantes.listarEstudantes(db, c.ctx.consultaAlfa, c.alfa.id, filtros).then((r) => r.estudantes.map((e) => e.matricula).sort());
    assert.deepEqual(await listar({ termo: a.matricula.slice(2) }), [a.matricula]);
    assert.deepEqual(await listar({ serie: '3' }), [b.matricula]);
    const ativo = (await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId)).ativo;
    await estudantes.encerrarVinculo(db, c.ctx.adminAlfa, ativo.id, { situacao: 'CONCLUIDO', fim: ativo.inicio });
    assert.deepEqual(await listar({ situacao: 'ATIVO' }), [a.matricula]);
    assert.deepEqual(await listar({ situacao: 'ENCERRADO' }), [b.matricula]);
    assert.deepEqual(await listar({ situacao: '' }), [a.matricula, b.matricula].sort());
  }));

  test('CA-033.1: encerramento grava situação, data e responsável; não se repete nem se desfaz', emTransacao(async (db) => {
    const c = await cenario(db);
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, c.pessoa()));
    const ativo = (await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId)).ativo;
    await assert.rejects(estudantes.encerrarVinculo(db, c.ctx.consultaAlfa, ativo.id, { situacao: 'EVADIDO', fim: ativo.inicio }), comCodigo('PROIBIDO'));
    await assert.rejects(estudantes.encerrarVinculo(db, c.ctx.adminBeta, ativo.id, { situacao: 'EVADIDO', fim: ativo.inicio }), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(estudantes.encerrarVinculo(db, c.ctx.adminAlfa, ativo.id, { situacao: 'EVADIDO', fim: '2999-01-01' }), comCodigo('VALIDACAO'));
    await estudantes.encerrarVinculo(db, c.ctx.adminAlfa, ativo.id, { situacao: 'EVADIDO', fim: ativo.inicio });
    const v = (await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId)).vinculos[0];
    assert.deepEqual([v.situacao, v.fim, v.encerrado_por], ['EVADIDO', ativo.inicio, c.adminAlfa.nome]);
    await assert.rejects(estudantes.encerrarVinculo(db, c.ctx.adminAlfa, ativo.id, { situacao: 'CONCLUIDO', fim: ativo.inicio }), comCodigo('VINCULO_ENCERRADO'));
    await assert.rejects(estudantes.editarEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId, c.form(c.ofertaAlfa, c.pessoa())), comCodigo('NAO_ENCONTRADO'));
  }));
});

describe('Reforço no banco (RLS, unicidade e imutabilidade)', () => {
  test('com escopo de Beta, estudante e vínculo de Alfa não aparecem; conferência de chaves exige o campus no escopo', emTransacao(async (db) => {
    const c = await cenario(db);
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, c.pessoa()));
    const beta = { usuarioId: c.adminBeta.id, campi: [c.beta.id] };
    await comContexto(db, beta, async (x) => {
      assert.equal((await x.query('SELECT 1 FROM estudante WHERE id = $1', [estudanteId])).rowCount, 0);
      assert.equal((await x.query('SELECT 1 FROM vinculo_estudante WHERE estudante_id = $1', [estudanteId])).rowCount, 0);
      assert.equal((await x.query("UPDATE estudante SET nome = 'invadido' WHERE id = $1", [estudanteId])).rowCount, 0);
    });
    await assert.rejects(comContexto(db, beta, (x) => x.query('SELECT * FROM estudantes_por_chave($1, $2, $3)', [c.alfa.id, ['X'], ['x']])),
      (err) => err.code === '42501');
  }));

  test('RN-08: o banco recusa segundo vínculo ativo, mesmo em outro campus; vínculo encerrado e matrícula não mudam', emTransacao(async (db) => {
    const c = await cenario(db);
    const { estudanteId } = await estudantes.cadastrarEstudante(db, c.ctx.adminAlfa, c.alfa.id, c.form(c.ofertaAlfa, c.pessoa()));
    await assert.rejects(comContexto(db, { usuarioId: c.adminBeta.id, campi: [c.beta.id] }, (x) => x.query(
      'INSERT INTO vinculo_estudante (campus_id, estudante_id, curso_id, periodo_letivo_id, serie, criado_por) VALUES ($1, $2, $3, $4, 1, $5)',
      [c.beta.id, estudanteId, c.ofertaBeta.curso.id, c.ofertaBeta.ano.id, c.adminBeta.id])), (err) => err.code === '23505');
    // Curso de Beta num vínculo de Alfa: FK composta.
    await assert.rejects(comContexto(db, { usuarioId: c.adminAlfa.id, campi: [c.alfa.id] }, (x) => x.query(
      'INSERT INTO vinculo_estudante (campus_id, estudante_id, curso_id, periodo_letivo_id, serie, criado_por, situacao, fim, encerrado_por) VALUES ($1, $2, $3, $4, 1, $5, \'CANCELADO\', current_date, $5)',
      [c.alfa.id, estudanteId, c.ofertaBeta.curso.id, c.ofertaAlfa.ano.id, c.adminAlfa.id])), (err) => err.code === '23503');
    const inst = { usuarioId: c.adminInst.id, campi: [], escopoInstitucional: true, adminInstitucional: true };
    await assert.rejects(comContexto(db, inst, (x) => x.query("UPDATE estudante SET matricula = 'OUTRA' WHERE id = $1", [estudanteId])), (err) => err.code === '23514');
    const ativo = (await estudantes.obterEstudante(db, c.ctx.adminAlfa, c.alfa.id, estudanteId)).ativo;
    await estudantes.encerrarVinculo(db, c.ctx.adminAlfa, ativo.id, { situacao: 'CANCELADO', fim: ativo.inicio });
    await assert.rejects(comContexto(db, inst, (x) => x.query('UPDATE vinculo_estudante SET serie = 2 WHERE id = $1', [ativo.id])), (err) => err.code === '23514');
    await assert.rejects(comContexto(db, inst, (x) => x.query('DELETE FROM vinculo_estudante WHERE id = $1', [ativo.id])), (err) => err.code === '42501');
  }));
});
