// Casos de uso do módulo de acesso contra o PostgreSQL real (RF-001 a RF-005).
// Cada teste roda numa transação desfeita ao final (withRollback).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { usarBancoMigrado } from '../helpers/banco-migrado.js';
import { withRollback } from '../helpers/test-db.js';
import { cenarioDoisCampi, contextoDe, criarUsuario, atribuir, atribuicoesDe } from '../helpers/fixtures.js';
import * as acesso from '../../src/modulos/acesso/servico.js';

const banco = usarBancoMigrado();
const emTransacao = (fn) => () => withRollback(banco.pool, fn);
const comCodigo = (codigo) => (err) => {
  assert.equal(err.codigo, codigo, `esperado ${codigo}, recebido ${err.codigo}: ${err.message}`);
  return true;
};
const identidade = (email, extra = {}) => ({
  sub: `sub-${email}`, email, email_verified: true, hd: email.split('@')[1], name: 'Pessoa Fictícia', ...extra,
});
const contarUsuarios = async (db) => (await db.query('SELECT count(*)::int AS n FROM usuario')).rows[0].n;

describe('RF-001 — login com conta institucional', () => {
  test('CA-001.1/CA-001.2/CA-001.3: identidades recusadas não criam usuário', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    const antes = await contarUsuarios(db);
    const recusadas = [
      [identidade('x@gmail.com'), 'DOMINIO_NAO_PERMITIDO'],
      [identidade(`x@${dominios.servidor}.exemplo.com`), 'DOMINIO_NAO_PERMITIDO'],
      [identidade(`x@${dominios.inativo}`), 'DOMINIO_NAO_PERMITIDO'],
      [identidade(`x@${dominios.servidor}`, { email_verified: false }), 'EMAIL_NAO_VERIFICADO'],
    ];
    for (const [claims, esperado] of recusadas) {
      await assert.rejects(acesso.registrarLogin(db, claims), comCodigo(esperado));
    }
    assert.equal(await contarUsuarios(db), antes);
  }));

  test('primeiro login cria o usuário; os seguintes reutilizam o mesmo registro pelo identificador do Google', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    const claims = identidade(`nova@${dominios.servidor}`);
    const primeiro = await acesso.registrarLogin(db, claims);
    assert.equal(primeiro.usuario.tipo, 'SERVIDOR');
    assert.deepEqual(primeiro.atribuicoes, []);

    const segundo = await acesso.registrarLogin(db, { ...claims, name: 'Nome Atualizado' });
    assert.equal(segundo.usuario.id, primeiro.usuario.id);
    assert.equal(segundo.usuario.nome, 'Nome Atualizado');
    const { rows } = await db.query("SELECT count(*)::int AS n FROM auditoria WHERE acao = 'acesso.usuario_criado' AND entidade_id = $1", [primeiro.usuario.id]);
    assert.equal(rows[0].n, 1);
  }));

  test('estudante entra com o tipo ESTUDANTE e sem atribuições', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    const r = await acesso.registrarLogin(db, identidade(`aluno@${dominios.estudante}`));
    assert.equal(r.usuario.tipo, 'ESTUDANTE');
    assert.deepEqual(r.atribuicoes, []);
  }));

  test('usuário desativado não entra (CA-008.1) e não pode carregar contexto', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    const inativo = await criarUsuario(db, { dominio: dominios.servidor, ativo: false });
    await assert.rejects(
      acesso.registrarLogin(db, { sub: inativo.google_sub, email: inativo.email, email_verified: true, hd: dominios.servidor }),
      comCodigo('USUARIO_DESATIVADO'),
    );
    await assert.rejects(acesso.carregarContexto(db, inativo.id), comCodigo('SESSAO_INVALIDA'));
  }));
});

describe('RF-005 — primeiro administrador institucional', () => {
  // Desativa temporariamente (dentro da transação) os admins existentes para simular uma instalação nova.
  const instalacaoNova = (db) => db.query("UPDATE atribuicao SET revogada_em = now(), revogada_por = usuario_id WHERE papel = 'ADMIN_INSTITUCIONAL' AND revogada_em IS NULL");

  test('CA-005.1: e-mail configurado vira admin institucional quando ainda não há nenhum', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    await instalacaoNova(db);
    const email = `chefe@${dominios.servidor}`;
    const r = await acesso.registrarLogin(db, identidade(email), { emailsAdminInicial: [email] });
    assert.deepEqual(r.atribuicoes.map((a) => [a.papel, a.campus_id]), [['ADMIN_INSTITUCIONAL', null]]);
  }));

  test('a variável não concede acesso quando já existe administrador ativo', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    const email = `tardio@${dominios.servidor}`;
    const r = await acesso.registrarLogin(db, identidade(email), { emailsAdminInicial: [email] });
    assert.deepEqual(r.atribuicoes, []);
  }));

  test('e-mail fora da lista e estudante nunca viram administradores', emTransacao(async (db) => {
    const { dominios } = await cenarioDoisCampi(db);
    await instalacaoNova(db);
    const lista = [`chefe@${dominios.servidor}`, `aluno@${dominios.estudante}`];
    assert.deepEqual((await acesso.registrarLogin(db, identidade(`outro@${dominios.servidor}`), { emailsAdminInicial: lista })).atribuicoes, []);
    assert.deepEqual((await acesso.registrarLogin(db, identidade(`aluno@${dominios.estudante}`), { emailsAdminInicial: lista })).atribuicoes, []);
  }));
});

describe('RF-002 — solicitação de acesso a um campus', () => {
  test('CA-002.1/CA-002.2: solicitação fica pendente e não concede acesso', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const s = await acesso.solicitarAcesso(db, await contextoDe(db, c.semAcesso), c.alfa.id);
    assert.equal(s.status, 'PENDENTE');
    const ctx = await acesso.carregarContexto(db, c.semAcesso.id);
    assert.deepEqual(ctx.atribuicoes, []);
  }));

  test('CA-002.3: no máximo uma solicitação pendente por servidor', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.semAcesso);
    await acesso.solicitarAcesso(db, ctx, c.alfa.id);
    await assert.rejects(acesso.solicitarAcesso(db, ctx, c.beta.id), comCodigo('SOLICITACAO_PENDENTE'));
  }));

  test('campus inativo ou inexistente é recusado; estudante não solicita', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const ctx = await contextoDe(db, c.semAcesso);
    await assert.rejects(acesso.solicitarAcesso(db, ctx, c.gama.id), comCodigo('VALIDACAO'));
    await assert.rejects(acesso.solicitarAcesso(db, ctx, '00000000-0000-4000-8000-000000000000'), comCodigo('VALIDACAO'));
    await assert.rejects(acesso.solicitarAcesso(db, ctx, 'não-é-uuid'), comCodigo('VALIDACAO'));
    await assert.rejects(acesso.solicitarAcesso(db, await contextoDe(db, c.estudante), c.alfa.id), comCodigo('PROIBIDO'));
  }));

  test('servidor que já tem acesso ao campus não solicita de novo', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await assert.rejects(acesso.solicitarAcesso(db, await contextoDe(db, c.consultaAlfa), c.alfa.id), comCodigo('JA_TEM_ACESSO'));
  }));
});

describe('RF-003 — decisão sobre solicitações', () => {
  const pedir = async (db, c, usuario, campus) => acesso.solicitarAcesso(db, await contextoDe(db, usuario), campus.id);

  test('CA-003.1: aprovação concede Consulta; com a opção, também Operador', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const s = await pedir(db, c, c.semAcesso, c.alfa);
    const r = await acesso.decidirSolicitacao(db, await contextoDe(db, c.adminAlfa), { solicitacaoId: s.id, aprovar: true, concederOperador: true });
    assert.equal(r.solicitacao.status, 'APROVADA');
    const papeis = (await atribuicoesDe(db, c.semAcesso.id)).map((a) => `${a.papel}@${a.campus_id}`).sort();
    assert.deepEqual(papeis, [`CONSULTA@${c.alfa.id}`, `OPERADOR@${c.alfa.id}`]);
  }));

  test('CA-003.2: recusa exige motivo e não concede papéis', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const s = await pedir(db, c, c.semAcesso, c.alfa);
    const admin = await contextoDe(db, c.adminAlfa);
    await assert.rejects(acesso.decidirSolicitacao(db, admin, { solicitacaoId: s.id, aprovar: false, motivo: '   ' }), comCodigo('VALIDACAO'));
    const r = await acesso.decidirSolicitacao(db, admin, { solicitacaoId: s.id, aprovar: false, motivo: 'Lotado em outro campus' });
    assert.equal(r.solicitacao.status, 'RECUSADA');
    assert.deepEqual(await atribuicoesDe(db, c.semAcesso.id), []);
    // Após a recusa, pode solicitar novamente.
    await pedir(db, c, c.semAcesso, c.beta);
  }));

  test('CA-003.3: admin do campus A não vê nem decide solicitações do campus B', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const s = await pedir(db, c, c.semAcesso, c.beta);
    const adminAlfa = await contextoDe(db, c.adminAlfa);
    await assert.rejects(acesso.decidirSolicitacao(db, adminAlfa, { solicitacaoId: s.id, aprovar: true }), comCodigo('NAO_ENCONTRADO'));
    await assert.rejects(acesso.listarSolicitacoesPendentes(db, adminAlfa, c.beta.id), comCodigo('PROIBIDO'));
    const doBeta = await acesso.listarSolicitacoesPendentes(db, await contextoDe(db, c.adminBeta), c.beta.id);
    assert.deepEqual(doBeta.map((x) => x.id), [s.id]);
  }));

  test('Consulta não decide; ninguém aprova a própria solicitação; decisão não se repete', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const s = await pedir(db, c, c.semAcesso, c.alfa);
    await assert.rejects(acesso.decidirSolicitacao(db, await contextoDe(db, c.consultaAlfa), { solicitacaoId: s.id, aprovar: true }), comCodigo('PROIBIDO'));

    const propria = await pedir(db, c, c.adminBeta, c.alfa);
    await atribuir(db, c.adminBeta.id, 'ADMIN_CAMPUS', c.alfa.id); // mesmo sendo admin de Alfa
    await assert.rejects(acesso.decidirSolicitacao(db, await contextoDe(db, c.adminBeta), { solicitacaoId: propria.id, aprovar: true }), comCodigo('PROIBIDO'));

    const admin = await contextoDe(db, c.adminAlfa);
    await acesso.decidirSolicitacao(db, admin, { solicitacaoId: s.id, aprovar: true });
    await assert.rejects(acesso.decidirSolicitacao(db, admin, { solicitacaoId: s.id, aprovar: true }), comCodigo('SOLICITACAO_DECIDIDA'));
  }));

  test('admin institucional decide em qualquer campus', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const s = await pedir(db, c, c.semAcesso, c.beta);
    const r = await acesso.decidirSolicitacao(db, await contextoDe(db, c.adminInst), { solicitacaoId: s.id, aprovar: true });
    assert.equal(r.solicitacao.status, 'APROVADA');
  }));
});

describe('RF-004 — concessão e revogação de papéis', () => {
  test('admin do campus concede Operador no próprio campus; não concede admin nem em outro campus', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const admin = await contextoDe(db, c.adminAlfa);
    const a = await acesso.concederPapel(db, admin, { usuarioId: c.consultaAlfa.id, papel: 'OPERADOR', campusId: c.alfa.id });
    assert.equal(a.papel, 'OPERADOR');
    await assert.rejects(acesso.concederPapel(db, admin, { usuarioId: c.consultaAlfa.id, papel: 'ADMIN_CAMPUS', campusId: c.alfa.id }), comCodigo('PROIBIDO'));
    await assert.rejects(acesso.concederPapel(db, admin, { usuarioId: c.semAcesso.id, papel: 'OPERADOR', campusId: c.beta.id }), comCodigo('PROIBIDO'));
    await assert.rejects(acesso.concederPapel(db, admin, { usuarioId: c.consultaAlfa.id, papel: 'OPERADOR', campusId: c.alfa.id }), comCodigo('PAPEL_JA_ATRIBUIDO'));
  }));

  test('estudante não recebe papéis', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    await assert.rejects(
      acesso.concederPapel(db, await contextoDe(db, c.adminInst), { usuarioId: c.estudante.id, papel: 'CONSULTA', campusId: c.alfa.id }),
      comCodigo('VALIDACAO'),
    );
  }));

  test('CA-004.1: revogação vale no próximo carregamento de contexto', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const [consulta] = await atribuicoesDe(db, c.consultaAlfa.id);
    await acesso.revogarAtribuicao(db, await contextoDe(db, c.adminAlfa), consulta.id);
    assert.deepEqual((await acesso.carregarContexto(db, c.consultaAlfa.id)).atribuicoes, []);
  }));

  test('admin do campus A não revoga atribuição do campus B (não a enxerga)', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const [adminDoBeta] = await atribuicoesDe(db, c.adminBeta.id);
    await assert.rejects(acesso.revogarAtribuicao(db, await contextoDe(db, c.adminAlfa), adminDoBeta.id), comCodigo('NAO_ENCONTRADO'));
  }));

  test('CA-004.2: o último admin institucional não pode ser removido; havendo dois, pode', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    // Garante que, nesta transação, só existe o admin do cenário.
    await db.query("UPDATE atribuicao SET revogada_em = now(), revogada_por = usuario_id WHERE papel = 'ADMIN_INSTITUCIONAL' AND revogada_em IS NULL AND usuario_id <> $1", [c.adminInst.id]);
    const ctx = await contextoDe(db, c.adminInst);
    const [unico] = ctx.atribuicoes;
    await assert.rejects(acesso.revogarAtribuicao(db, ctx, unico.id), comCodigo('ULTIMO_ADMIN'));

    const segundo = await acesso.concederPapel(db, ctx, { usuarioId: c.semAcesso.id, papel: 'ADMIN_INSTITUCIONAL', campusId: null });
    await acesso.revogarAtribuicao(db, ctx, segundo.id);
    await assert.rejects(acesso.revogarAtribuicao(db, ctx, segundo.id), comCodigo('JA_REVOGADA'));
  }));

  test('CA-004.3: concessões e revogações ficam na auditoria com quem fez e o campus', emTransacao(async (db) => {
    const c = await cenarioDoisCampi(db);
    const admin = await contextoDe(db, c.adminAlfa);
    const a = await acesso.concederPapel(db, admin, { usuarioId: c.consultaAlfa.id, papel: 'OPERADOR', campusId: c.alfa.id });
    await acesso.revogarAtribuicao(db, admin, a.id);
    const { rows } = await db.query('SELECT acao, usuario_id, campus_id FROM auditoria WHERE entidade_id = $1 ORDER BY id', [a.id]);
    assert.deepEqual(rows.map((r) => [r.acao, r.usuario_id, r.campus_id]), [
      ['acesso.papel_concedido', c.adminAlfa.id, c.alfa.id],
      ['acesso.papel_revogado', c.adminAlfa.id, c.alfa.id],
    ]);
  }));
});
