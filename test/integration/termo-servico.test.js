// Termo de compromisso versionado (RF-080) contra o PostgreSQL real, em transações desfeitas.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe, atribuir } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as termo from '../../src/modulos/termo/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const texto = (n) => `Versão fictícia ${n} ${Math.random()}: declaro que recebi os livros {livros} e me comprometo a devolvê-los.`;
const publicar = (db, ctx, t) => termo.publicarVersao(db, ctx, { texto: t, confirmacao: 'sim' });

describe('RF-080 — versões do termo', () => {
  test('CA-080.1 e CA-080.2: nova versão vira a vigente; a anterior continua consultável e inalterada', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const inst = await contextoDe(db, c.adminInst);
    const [t1, t2] = [texto(1), texto(2)];
    const v1 = await publicar(db, inst, t1);
    const v2 = await publicar(db, inst, t2);
    assert.equal(v2.versao, v1.versao + 1);
    const consulta = await contextoDe(db, c.consultaAlfa);
    const lista = await termo.listarVersoes(db, consulta);
    assert.equal(lista.vigente.id, v2.id);
    assert.deepEqual(lista.versoes.slice(0, 2).map((v) => v.versao), [v2.versao, v1.versao]);
    const anterior = await termo.obterVersao(db, consulta, v1.id);
    assert.deepEqual([anterior.versao.texto, anterior.vigente], [t1, false]);
    // O hash é calculado pelo banco a partir do texto gravado.
    assert.equal(anterior.versao.hash_texto, createHash('sha256').update(t1, 'utf8').digest('hex'));
    assert.equal(await termo.termoVigente(db).then((v) => v.id), v2.id);
    const { rows } = await db.query("SELECT campus_id FROM auditoria WHERE acao = 'termo.versao_publicada' AND entidade_id = $1", [v2.id]);
    assert.deepEqual(rows, [{ campus_id: null }]);
  }));

  test('sem confirmação, texto igual ao vigente ou marcador desconhecido: recusado', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const inst = await contextoDe(db, c.adminInst);
    const t = texto(3);
    await assert.rejects(termo.publicarVersao(db, inst, { texto: t, confirmacao: '' }), (err) => err.codigo === 'VALIDACAO' && Boolean(err.detalhes.confirmacao));
    await publicar(db, inst, t);
    await assert.rejects(publicar(db, inst, `${t}\r\n`), (err) => err.codigo === 'VALIDACAO' && /igual/.test(err.detalhes.texto));
    await assert.rejects(publicar(db, inst, `${texto(4)} {cpf}`), comCodigo('VALIDACAO'));
  }));

  test('só a administração institucional publica; servidores com acesso consultam; estudante e sem acesso não', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    for (const u of [c.adminAlfa, c.consultaAlfa]) {
      await assert.rejects(publicar(db, await contextoDe(db, u), texto(5)), comCodigo('PROIBIDO'));
      await termo.listarVersoes(db, await contextoDe(db, u));
    }
    await atribuir(db, c.consultaAlfa.id, 'CONSULTA'); // consulta institucional também não publica
    await assert.rejects(publicar(db, await contextoDe(db, c.consultaAlfa), texto(6)), comCodigo('PROIBIDO'));
    for (const u of [c.estudante, c.semAcesso]) {
      await assert.rejects(termo.listarVersoes(db, await contextoDe(db, u)), comCodigo('PROIBIDO'));
    }
    await assert.rejects(termo.obterVersao(db, await contextoDe(db, c.adminAlfa), '00000000-0000-4000-8000-000000000000'), comCodigo('NAO_ENCONTRADO'));
  }));

  test('banco: versões não se alteram nem se apagam; só a administração institucional insere, em nome próprio', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const v = await publicar(db, await contextoDe(db, c.adminInst), texto(7));
    const inst = { usuarioId: c.adminInst.id, campi: [], escopoInstitucional: true, adminInstitucional: true };
    for (const sql of ["UPDATE termo_modelo SET texto = 'alterado' WHERE id = $1", 'DELETE FROM termo_modelo WHERE id = $1']) {
      await assert.rejects(comContexto(db, inst, (x) => x.query(sql, [v.id])), (err) => err.code === '42501', sql);
    }
    const inserir = (escopo, autor) => comContexto(db, escopo, (x) => x.query(
      "INSERT INTO termo_modelo (versao, texto, hash_texto, publicado_por) VALUES (99999, 'Texto qualquer', '', $1)", [autor]));
    await assert.rejects(inserir({ usuarioId: c.adminAlfa.id, campi: [c.alfa.id] }, c.adminAlfa.id), (err) => err.code === '42501');
    await assert.rejects(inserir(inst, c.adminAlfa.id), (err) => err.code === '42501');
  }));
});
