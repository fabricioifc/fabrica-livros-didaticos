// Campi (RF-010, RF-011) contra o PostgreSQL real, cada teste numa transação desfeita.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe } from '../helpers/fixtures.js';
import { comContexto } from '../../src/infra/db/contexto.js';
import * as campi from '../../src/modulos/campi/servico.js';
import * as acesso from '../../src/modulos/acesso/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const configValida = (extra = {}) => ({
  nomeOficial: 'Instituto Fictício – Campus Alfa Renomeado', nomeCurto: 'Alfa Novo', endereco: 'Rua Fictícia, 100', cidade: 'Cidade Fictícia',
  uf: 'sc', cep: '00000-000', setorResponsavel: 'Setor Fictício', emailSetor: 'setor@exemplo.teste', telefone: '(00) 0000-0000',
  permiteEntregaComPendencia: false, ...extra,
});
const codigoNovo = () => `N${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

describe('RF-010 — cadastro e situação dos campi', () => {
  test('CA-010.1: admin institucional cria campus que já aparece para solicitação, com configuração e auditoria', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const codigo = codigoNovo();
    const novo = await campi.criarCampus(db, await contextoDe(db, c.adminInst), { codigo: codigo.toLowerCase(), nomeOficial: 'Instituto Fictício – Campus Novo', nomeCurto: 'Novo' });
    assert.equal(novo.codigo, codigo);
    const painel = await acesso.painelDoServidor(db, await contextoDe(db, c.semAcesso));
    assert.ok(painel.campiAtivos.some((x) => x.id === novo.id));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM campus_configuracao WHERE campus_id = $1', [novo.id])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'campus.criado' AND entidade_id = $1", [novo.id])).rows[0].n, 1);
    await acesso.solicitarAcesso(db, await contextoDe(db, c.semAcesso), novo.id);
  }));

  test('código duplicado é recusado no campo código', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await assert.rejects(
      campi.criarCampus(db, await contextoDe(db, c.adminInst), { codigo: c.alfa.codigo, nomeOficial: 'Instituto Fictício – Outro', nomeCurto: 'Outro' }),
      (err) => err.codigo === 'VALIDACAO' && /Já existe/.test(err.detalhes.codigo),
    );
  }));

  test('só a administração institucional lista, cria, ativa e desativa campi', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    for (const usuario of [c.adminAlfa, c.consultaAlfa, c.estudante]) {
      const ctx = await contextoDe(db, usuario);
      await assert.rejects(campi.listarCampi(db, ctx), comCodigo('PROIBIDO'));
      await assert.rejects(campi.criarCampus(db, ctx, { codigo: codigoNovo(), nomeOficial: 'Instituto Fictício', nomeCurto: 'X' }), comCodigo('PROIBIDO'));
      await assert.rejects(campi.alterarSituacao(db, ctx, c.alfa.id, false), comCodigo('PROIBIDO'));
    }
  }));

  test('CA-010.2: campus desativado some da solicitação; reativado volta; o cadastro continua consultável', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const inst = await contextoDe(db, c.adminInst);
    await campi.alterarSituacao(db, inst, c.beta.id, false);
    const pedinte = await contextoDe(db, c.semAcesso);
    assert.ok(!(await acesso.painelDoServidor(db, pedinte)).campiAtivos.some((x) => x.id === c.beta.id));
    await assert.rejects(acesso.solicitarAcesso(db, pedinte, c.beta.id), comCodigo('VALIDACAO'));
    assert.ok((await campi.listarCampi(db, inst)).some((x) => x.id === c.beta.id && !x.ativo));
    await campi.alterarSituacao(db, inst, c.beta.id, true);
    await acesso.solicitarAcesso(db, pedinte, c.beta.id);
  }));
});

describe('RF-011 — configuração do campus', () => {
  test('admin do campus salva nomes e configuração; dados normalizados e auditoria com antes/depois', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const r = await campi.salvarConfiguracao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, configValida());
    assert.equal(r.nome_curto, 'Alfa Novo');
    assert.equal(r.uf, 'SC');
    assert.equal(r.cep, '00000000');
    assert.equal(r.permite_entrega_com_pendencia, false);
    assert.equal(r.codigo, c.alfa.codigo, 'o código não muda');
    const { rows } = await db.query("SELECT antes->>'nome_curto' AS antes, depois->>'nome_curto' AS depois FROM auditoria WHERE acao = 'campus.configuracao_atualizada' AND entidade_id = $1", [c.alfa.id]);
    assert.deepEqual(rows[0], { antes: 'Campus Alfa', depois: 'Alfa Novo' });
  }));

  test('admin do campus não altera o código (formulário forjado)', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await assert.rejects(campi.salvarConfiguracao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, configValida({ codigo: codigoNovo() })), comCodigo('PROIBIDO'));
  }));

  test('CA-011.2: admin de A não lê nem altera B; Consulta não altera o próprio campus (404)', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const adminAlfa = await contextoDe(db, c.adminAlfa);
    await assert.rejects(campi.obterCampus(db, adminAlfa, c.beta.id), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(campi.salvarConfiguracao(db, adminAlfa, c.beta.id, configValida()), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(campi.salvarConfiguracao(db, await contextoDe(db, c.consultaAlfa), c.alfa.id, configValida()), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(campi.obterCampus(db, adminAlfa, 'nao-e-uuid'), comCodigo('NAO_ENCONTRADO'));
  }));

  test('admin institucional altera o código; código já usado é recusado', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const inst = await contextoDe(db, c.adminInst);
    const codigo = codigoNovo();
    assert.equal((await campi.salvarConfiguracao(db, inst, c.alfa.id, configValida({ codigo }))).codigo, codigo);
    await assert.rejects(campi.salvarConfiguracao(db, inst, c.alfa.id, configValida({ codigo: c.beta.codigo })), (err) => err.codigo === 'VALIDACAO' && /Já existe/.test(err.detalhes.codigo));
  }));

  test('dados inválidos não gravam nada', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await assert.rejects(campi.salvarConfiguracao(db, await contextoDe(db, c.adminAlfa), c.alfa.id, configValida({ uf: 'XYZ', nomeCurto: '' })), comCodigo('VALIDACAO'));
    const { rows } = await db.query('SELECT nome_curto FROM campus WHERE id = $1', [c.alfa.id]);
    assert.equal(rows[0].nome_curto, 'Campus Alfa');
  }));
});

describe('Campi — reforço no banco (RLS e trigger, migração 004)', () => {
  const semPermissao = (err) => err.code === '42501';
  const escopo = (usuarioId, campi, extra = {}) => ({ usuarioId, campi, ...extra });

  test('sem administração institucional não se cria campus nem se altera campus fora do escopo', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const doAlfa = escopo(c.adminAlfa.id, [c.alfa.id]);
    await assert.rejects(
      comContexto(db, doAlfa, (t) => t.query("INSERT INTO campus (codigo, nome_oficial, nome_curto) VALUES ('ZZ9', 'Instituto Fictício', 'ZZ')")),
      semPermissao,
    );
    await comContexto(db, doAlfa, async (t) => {
      const r = await t.query("UPDATE campus SET nome_curto = 'invadido' WHERE id = $1", [c.beta.id]);
      assert.equal(r.rowCount, 0);
    });
  }));

  test('código e situação só mudam com administração institucional, mesmo no próprio campus', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const doAlfa = escopo(c.adminAlfa.id, [c.alfa.id]);
    await assert.rejects(comContexto(db, doAlfa, (t) => t.query("UPDATE campus SET codigo = 'ZZ8' WHERE id = $1", [c.alfa.id])), semPermissao);
    await assert.rejects(comContexto(db, doAlfa, (t) => t.query('UPDATE campus SET ativo = false WHERE id = $1', [c.alfa.id])), semPermissao);
    await comContexto(db, doAlfa, (t) => t.query("UPDATE campus SET nome_curto = 'Alfa Ajustado' WHERE id = $1", [c.alfa.id]));
  }));

  test('a aplicação não apaga campi', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await assert.rejects(
      comContexto(db, escopo(c.adminInst.id, [], { escopoInstitucional: true, adminInstitucional: true }), (t) => t.query('DELETE FROM campus WHERE id = $1', [c.gama.id])),
      semPermissao,
    );
  }));
});
