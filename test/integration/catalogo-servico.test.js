// Catálogo de títulos (RF-020) contra o PostgreSQL real, em transações desfeitas.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe, atribuir, gerarIsbn } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as catalogo from '../../src/modulos/catalogo/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const titulo = (extra = {}) => ({
  titulo: `Matemática Fictícia ${Math.random().toString(36).slice(2, 7)}`, autores: 'Autora Fictícia', isbn: gerarIsbn(),
  editora: 'Editora Fictícia', edicao: '1ª', volume: 'Volume único', anoPublicacao: '2024', componente: 'Matemática',
  codigoPrograma: '', abrangencia: 'ENSINO_MEDIO_COMPLETO', serie: '', ...extra,
});

describe('RF-020 — cadastro e consulta', () => {
  test('admin do campus cadastra; o título fica visível para servidores de outro campus (CA-020.3)', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const t = await catalogo.criarTitulo(db, await contextoDe(db, c.adminAlfa), titulo({ titulo: 'Biologia Fictícia Compartilhada' }));
    assert.equal(t.componente, 'Matemática');
    const visao = await catalogo.listarCatalogo(db, await contextoDe(db, c.adminBeta), { termo: 'Biologia Fictícia Compartilhada' });
    assert.deepEqual(visao.titulos.map((x) => x.id), [t.id]);
    const { rows } = await db.query("SELECT campus_id FROM auditoria WHERE acao = 'catalogo.titulo_criado' AND entidade_id = $1", [t.id]);
    assert.deepEqual(rows, [{ campus_id: null }]);
  }));

  test('CA-020.1: ISBN repetido (mesmo escrito como ISBN-10) aponta o título existente', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const isbn13 = gerarIsbn();
    const nove = isbn13.slice(3, 12);
    const resto = (11 - ([...nove].reduce((acc, d, i) => acc + Number(d) * (10 - i), 0) % 11)) % 11;
    const isbn10 = `${nove}${resto === 10 ? 'X' : resto}`; // o mesmo livro escrito como ISBN-10
    const existente = await catalogo.criarTitulo(db, await contextoDe(db, c.adminAlfa), titulo({ isbn: isbn13 }));
    await assert.rejects(
      catalogo.criarTitulo(db, await contextoDe(db, c.adminBeta), titulo({ isbn: isbn10 })),
      (err) => err.codigo === 'VALIDACAO' && /já está no catálogo/.test(err.detalhes.isbn) && err.detalhes.existenteId === existente.id,
    );
  }));

  test('materiais sem ISBN podem coexistir', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    await catalogo.criarTitulo(db, ctx, titulo({ isbn: '' }));
    await catalogo.criarTitulo(db, ctx, titulo({ isbn: '' }));
  }));

  test('CA-020.2: série específica sem série é recusada; com série é gravada', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    await assert.rejects(catalogo.criarTitulo(db, ctx, titulo({ abrangencia: 'SERIE_ESPECIFICA', serie: '' })), comCodigo('VALIDACAO'));
    const t = await catalogo.criarTitulo(db, ctx, titulo({ abrangencia: 'SERIE_ESPECIFICA', serie: '1' }));
    assert.deepEqual([t.abrangencia, t.serie], ['SERIE_ESPECIFICA', 1]);
  }));

  test('componente curricular é reaproveitado sem diferenciar maiúsculas', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    const nome = `Componente Fictício ${Date.now()}`;
    await catalogo.criarTitulo(db, ctx, titulo({ componente: nome }));
    await catalogo.criarTitulo(db, ctx, titulo({ componente: nome.toUpperCase() }));
    const { rows } = await db.query('SELECT count(*)::int AS n FROM componente_curricular WHERE lower(nome) = lower($1)', [nome]);
    assert.equal(rows[0].n, 1);
  }));

  test('busca por ISBN parcial, autor e paginação', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.adminAlfa);
    const autor = `Autor Único ${Date.now()}`;
    const t = await catalogo.criarTitulo(db, ctx, titulo({ autores: autor }));
    assert.deepEqual((await catalogo.listarCatalogo(db, ctx, { termo: autor })).titulos.map((x) => x.id), [t.id]);
    assert.ok((await catalogo.listarCatalogo(db, ctx, { termo: t.isbn13.slice(3, 11) })).titulos.some((x) => x.id === t.id));
    const r = await catalogo.listarCatalogo(db, ctx, { pagina: '999' });
    assert.equal(r.pagina, 999);
    assert.deepEqual(r.titulos, []);
  }));
});

describe('RF-020 — permissões (RN-75, proposta DP-05)', () => {
  test('Consulta e Operador consultam, mas não cadastram', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await atribuir(db, c.consultaAlfa.id, 'OPERADOR', c.alfa.id);
    const ctx = await contextoDe(db, c.consultaAlfa);
    await catalogo.listarCatalogo(db, ctx);
    await assert.rejects(catalogo.criarTitulo(db, ctx, titulo()), comCodigo('PROIBIDO'));
  }));

  test('estudante e servidor sem acesso não consultam o catálogo', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    for (const u of [c.estudante, c.semAcesso]) {
      await assert.rejects(catalogo.listarCatalogo(db, await contextoDe(db, u)), comCodigo('PROIBIDO'));
    }
  }));

  test('CA-020.4: admin do campus não edita; admin institucional edita e o ISBN continua único', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const a = await catalogo.criarTitulo(db, await contextoDe(db, c.adminAlfa), titulo());
    const b = await catalogo.criarTitulo(db, await contextoDe(db, c.adminAlfa), titulo());
    await assert.rejects(catalogo.editarTitulo(db, await contextoDe(db, c.adminAlfa), a.id, titulo()), comCodigo('PROIBIDO'));
    const inst = await contextoDe(db, c.adminInst);
    const editado = await catalogo.editarTitulo(db, inst, a.id, titulo({ titulo: 'Título Corrigido', isbn: a.isbn13 }));
    assert.equal(editado.titulo, 'Título Corrigido');
    await assert.rejects(catalogo.editarTitulo(db, inst, a.id, titulo({ isbn: b.isbn13 })), (err) => err.codigo === 'VALIDACAO' && err.detalhes.existenteId === b.id);
  }));

  test('banco: sem administração institucional não se altera título; ninguém apaga; autoria é fixa', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const t = await catalogo.criarTitulo(db, await contextoDe(db, c.adminAlfa), titulo());
    await comContexto(db, { usuarioId: c.adminAlfa.id, campi: [c.alfa.id] }, async (x) => {
      assert.equal((await x.query("UPDATE titulo SET titulo = 'invadido' WHERE id = $1", [t.id])).rowCount, 0);
    });
    const inst = { usuarioId: c.adminInst.id, campi: [], escopoInstitucional: true, adminInstitucional: true };
    await assert.rejects(comContexto(db, inst, (x) => x.query('DELETE FROM titulo WHERE id = $1', [t.id])), (err) => err.code === '42501');
    await assert.rejects(comContexto(db, inst, (x) => x.query('UPDATE titulo SET criado_por = $2 WHERE id = $1', [t.id, c.adminInst.id])), (err) => err.code === '23514');
  }));

  test('banco: ninguém registra título em nome de outra pessoa nem sem campus no escopo', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const inserir = (escopo, criadoPor) => comContexto(db, escopo, (x) => x.query(
      "INSERT INTO titulo (titulo, autores, abrangencia, criado_por) VALUES ('X', 'Y', 'ENSINO_MEDIO_COMPLETO', $1)", [criadoPor]));
    await assert.rejects(inserir({ usuarioId: c.adminAlfa.id, campi: [c.alfa.id] }, c.adminBeta.id), (err) => err.code === '42501');
    await assert.rejects(inserir({ usuarioId: c.semAcesso.id, campi: [] }, c.semAcesso.id), (err) => err.code === '42501');
  }));
});
