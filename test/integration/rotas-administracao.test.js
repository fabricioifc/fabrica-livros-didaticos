// RF-003 (decisão sobre solicitações) e RF-004 (equipe e papéis) pelas rotas HTTP, com sessão real.
// Cada teste monta campi próprios (nomes aleatórios) para não depender de dados de outros testes.
// Não cria administradores institucionais (ver rotas-acesso.test.js).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';
import { criarDominios, criarCampus, atribuir } from '../helpers/fixtures.js';
import { Navegador, provedorFalso, iniciarServidor } from '../helpers/navegador.js';

const banco = { pool: undefined };
let srv;
let provedor;
let dominios;

before(async () => {
  banco.pool = createTestPool();
  try {
    await banco.pool.query('SELECT 1');
  } catch (err) {
    throw new Error(`${MENSAGEM_BANCO_INDISPONIVEL} (${err.code || err.message})`);
  }
  await aplicarMigracoes(banco.pool);
  provedor = provedorFalso();
  srv = await iniciarServidor({ pool: banco.pool, provedor });
  dominios = await criarDominios(banco.pool);
});

after(async () => {
  await srv?.fechar();
  await banco.pool?.end();
});

const q = (sql, params) => banco.pool.query(sql, params);

// Servidor logado (navegador com sessão) e, opcionalmente, com papéis num campus.
async function servidor(papeis = [], campus = null, dominio = dominios.servidor) {
  const id = randomUUID().slice(0, 8);
  const claims = { sub: `sub-${id}`, email: `pessoa.${id}@${dominio}`, email_verified: true, hd: dominio, name: `Pessoa ${id}` };
  const nav = new Navegador(srv.url);
  await nav.entrar(provedor, claims);
  const { rows } = await q('SELECT id FROM usuario WHERE google_sub = $1', [claims.sub]);
  for (const p of papeis) await atribuir(banco.pool, rows[0].id, p, campus.id);
  return { nav, id: rows[0].id, nome: claims.name };
}

const post = async (nav, caminho, form = {}, paginaComToken = '/') => {
  const _csrf = Navegador.csrf((await nav.pedir(paginaComToken)).texto);
  return nav.pedir(caminho, { method: 'POST', form: { ...form, _csrf } });
};

async function cenario() {
  const sufixo = randomUUID().slice(0, 6);
  const alfa = await criarCampus(banco.pool, { nome: `Alfa ${sufixo}` });
  const beta = await criarCampus(banco.pool, { nome: `Beta ${sufixo}` });
  const adminAlfa = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], alfa);
  const adminBeta = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], beta);
  const consultaAlfa = await servidor(['CONSULTA'], alfa);
  const pedinte = await servidor();
  await post(pedinte.nav, '/acesso/solicitacoes', { campusId: alfa.id });
  const { rows } = await q('SELECT id FROM solicitacao_acesso WHERE usuario_id = $1 AND status = $2', [pedinte.id, 'PENDENTE']);
  return { alfa, beta, adminAlfa, adminBeta, consultaAlfa, pedinte, solicitacaoId: rows[0].id };
}

const statusDa = async (id) => (await q('SELECT status FROM solicitacao_acesso WHERE id = $1', [id])).rows[0].status;
const papeisDe = async (usuarioId, campusId) =>
  (await q('SELECT papel FROM atribuicao WHERE usuario_id = $1 AND campus_id = $2 AND revogada_em IS NULL ', [usuarioId, campusId])).rows.map((r) => r.papel).sort();

describe('RF-003 — solicitações pela interface', () => {
  test('admin do campus vê a pendência no início e na lista; admin de outro campus não', async () => {
    const c = await cenario();
    assert.match((await c.adminAlfa.nav.pedir('/')).texto, /Solicitações de acesso \(1 aguardando\)/);
    assert.match((await c.adminAlfa.nav.pedir('/acesso/solicitacoes')).texto, new RegExp(c.pedinte.nome));
    assert.doesNotMatch((await c.adminBeta.nav.pedir('/acesso/solicitacoes')).texto, new RegExp(c.pedinte.nome));
  });

  test('CA-003.3 por URL: admin de outro campus recebe 404 ao abrir ou aprovar a solicitação', async () => {
    const c = await cenario();
    assert.equal((await c.adminBeta.nav.pedir(`/acesso/solicitacoes/${c.solicitacaoId}`)).status, 404);
    const r = await post(c.adminBeta.nav, `/acesso/solicitacoes/${c.solicitacaoId}/aprovar`, { operador: 'sim' });
    assert.equal(r.status, 404);
    assert.equal(await statusDa(c.solicitacaoId), 'PENDENTE');
  });

  test('Consulta, estudante e visitante não acessam as solicitações', async () => {
    const c = await cenario();
    assert.equal((await c.consultaAlfa.nav.pedir('/acesso/solicitacoes')).status, 403);
    const r = await post(c.consultaAlfa.nav, `/acesso/solicitacoes/${c.solicitacaoId}/aprovar`);
    assert.equal(r.status, 403);
    const estudante = await servidor([], null, dominios.estudante);
    assert.equal((await estudante.nav.pedir('/acesso/solicitacoes')).status, 403);
    assert.equal((await new Navegador(srv.url).pedir('/acesso/solicitacoes')).status, 303);
    assert.equal(await statusDa(c.solicitacaoId), 'PENDENTE');
  });

  test('CA-003.1: aprovação com Atendimento; o servidor passa a ver o início com os papéis', async () => {
    const c = await cenario();
    const semToken = await c.adminAlfa.nav.pedir(`/acesso/solicitacoes/${c.solicitacaoId}/aprovar`, { method: 'POST', form: { operador: 'sim' } });
    assert.equal(semToken.status, 403);
    assert.equal(await statusDa(c.solicitacaoId), 'PENDENTE');

    const r = await post(c.adminAlfa.nav, `/acesso/solicitacoes/${c.solicitacaoId}/aprovar`, { operador: 'sim' }, `/acesso/solicitacoes/${c.solicitacaoId}`);
    assert.equal(r.status, 303);
    assert.match((await c.adminAlfa.nav.pedir(r.local)).texto, /Acesso aprovado/);
    assert.deepEqual(await papeisDe(c.pedinte.id, c.alfa.id), ['OPERADOR', 'CONSULTA'].sort());
    assert.match((await c.pedinte.nav.pedir('/')).texto, /Atendimento \(entregas e devoluções\)/);
  });

  test('CA-003.2: recusa sem motivo volta ao formulário (422); com motivo, o servidor vê o motivo', async () => {
    const c = await cenario();
    const pagina = `/acesso/solicitacoes/${c.solicitacaoId}`;
    const vazio = await post(c.adminAlfa.nav, `${pagina}/recusar`, { motivo: '   ' }, pagina);
    assert.equal(vazio.status, 422);
    assert.match(vazio.texto, /Informe o motivo da recusa/);
    assert.equal(await statusDa(c.solicitacaoId), 'PENDENTE');

    const ok = await post(c.adminAlfa.nav, `${pagina}/recusar`, { motivo: 'Lotação em outro campus' }, pagina);
    assert.equal(ok.status, 303);
    const visao = (await c.pedinte.nav.pedir('/')).texto;
    assert.match(visao, /foi recusada/);
    assert.match(visao, /Lotação em outro campus/);
  });

  test('identificador malformado na URL responde 404', async () => {
    const c = await cenario();
    assert.equal((await c.adminAlfa.nav.pedir('/acesso/solicitacoes/nao-e-uuid')).status, 404);
    assert.equal((await c.adminAlfa.nav.pedir("/acesso/campi/1'%20OR%201=1/equipe")).status, 404);
  });
});

describe('RF-004 — equipe e papéis pela interface', () => {
  test('admin do campus vê a equipe e concede Atendimento a um membro', async () => {
    const c = await cenario();
    const equipe = `/acesso/campi/${c.alfa.id}/equipe`;
    assert.match((await c.adminAlfa.nav.pedir(equipe)).texto, new RegExp(c.consultaAlfa.nome));
    const r = await post(c.adminAlfa.nav, `${equipe}/papeis`, { usuarioId: c.consultaAlfa.id, papel: 'OPERADOR' }, equipe);
    assert.equal(r.status, 303);
    assert.deepEqual(await papeisDe(c.consultaAlfa.id, c.alfa.id), ['CONSULTA', 'OPERADOR'].sort());
  });

  test('D-18: formulário forjado para quem não é da equipe não concede papel', async () => {
    const c = await cenario();
    const equipe = `/acesso/campi/${c.alfa.id}/equipe`;
    const r = await post(c.adminAlfa.nav, `${equipe}/papeis`, { usuarioId: c.adminBeta.id, papel: 'OPERADOR' }, equipe);
    assert.equal(r.status, 303);
    assert.match((await c.adminAlfa.nav.pedir(r.local)).texto, /precisa ter acesso aprovado neste campus/);
    assert.deepEqual(await papeisDe(c.adminBeta.id, c.alfa.id), []);
  });

  test('admin do campus não promove a administrador (formulário forjado → 403)', async () => {
    const c = await cenario();
    const equipe = `/acesso/campi/${c.alfa.id}/equipe`;
    const r = await post(c.adminAlfa.nav, `${equipe}/papeis`, { usuarioId: c.consultaAlfa.id, papel: 'ADMIN_CAMPUS' }, equipe);
    assert.equal(r.status, 403);
    assert.deepEqual(await papeisDe(c.consultaAlfa.id, c.alfa.id), ['CONSULTA']);
  });

  test('admin de outro campus: equipe e revogação por URL respondem 404', async () => {
    const c = await cenario();
    assert.equal((await c.adminBeta.nav.pedir(`/acesso/campi/${c.alfa.id}/equipe`)).status, 404);
    const { rows } = await q('SELECT id FROM atribuicao WHERE usuario_id = $1 AND campus_id = $2', [c.consultaAlfa.id, c.alfa.id]);
    const r = await post(c.adminBeta.nav, `/acesso/atribuicoes/${rows[0].id}/revogar`);
    assert.equal(r.status, 404);
    assert.deepEqual(await papeisDe(c.consultaAlfa.id, c.alfa.id), ['CONSULTA']);
  });

  test('CA-004.1: admin remove um papel e o servidor perde o acesso na próxima página', async () => {
    const c = await cenario();
    const { rows } = await q('SELECT id FROM atribuicao WHERE usuario_id = $1 AND campus_id = $2', [c.consultaAlfa.id, c.alfa.id]);
    const r = await post(c.adminAlfa.nav, `/acesso/atribuicoes/${rows[0].id}/revogar`, {}, `/acesso/campi/${c.alfa.id}/equipe`);
    assert.equal(r.status, 303);
    assert.equal(r.local, `/acesso/campi/${c.alfa.id}/equipe`);
    assert.match((await c.consultaAlfa.nav.pedir('/')).texto, /Escolha seu campus/);
  });
});
