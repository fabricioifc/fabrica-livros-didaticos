// Termo de compromisso (RF-080) pelas rotas HTTP, com sessão real. Versões gravadas de fato (texto aleatório).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';
import { criarDominios, criarCampus, atribuir, criarAdminInstitucionalConfirmado } from '../helpers/fixtures.js';
import { Navegador, provedorFalso, iniciarServidor } from '../helpers/navegador.js';

const banco = { pool: undefined };
let srv;
let provedor;
let dominios;
let campus;
let instId;

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
  campus = await criarCampus(banco.pool, { nome: `Termo ${randomUUID().slice(0, 6)}` });
});

after(async () => {
  // Revoga o admin criado aqui, para não deixar administradores extras no banco de testes.
  if (instId) await banco.pool.query('UPDATE atribuicao SET revogada_em = now(), revogada_por = usuario_id WHERE usuario_id = $1 AND revogada_em IS NULL', [instId]);
  await srv?.fechar();
  await banco.pool?.end();
});

async function pessoa(papeis = [], { dominio = dominios.servidor, institucional = false } = {}) {
  const id = randomUUID().slice(0, 8);
  const claims = { sub: `sub-${id}`, email: `pessoa.${id}@${dominio}`, email_verified: true, hd: dominio, name: `Pessoa ${id}` };
  const nav = new Navegador(srv.url);
  await nav.entrar(provedor, claims);
  const { rows } = await banco.pool.query('SELECT id FROM usuario WHERE google_sub = $1', [claims.sub]);
  for (const p of papeis) await atribuir(banco.pool, rows[0].id, p, campus.id);
  if (institucional) {
    instId = rows[0].id;
    await criarAdminInstitucionalConfirmado(banco.pool, instId);
  }
  return nav;
}

const post = async (nav, caminho, form, paginaComToken) => {
  const _csrf = Navegador.csrf((await nav.pedir(paginaComToken)).texto);
  return nav.pedir(caminho, { method: 'POST', form: { ...form, _csrf } });
};

describe('RF-080 pela interface', () => {
  test('administração institucional publica (com CSRF e confirmação); Consulta vê o texto escapado', async () => {
    const inst = await pessoa([], { institucional: true });
    const marca = randomUUID().slice(0, 8);
    const texto = `Termo fictício ${marca}. Eu, {estudante}, declaro que recebi <b>os livros</b>: {livros}.\n\nSegundo parágrafo do termo.`;
    assert.equal((await inst.pedir('/termo/nova', { method: 'POST', form: { texto, confirmacao: 'sim' } })).status, 403);
    const semConfirmar = await post(inst, '/termo/nova', { texto }, '/termo/nova');
    assert.equal(semConfirmar.status, 422);
    assert.match(semConfirmar.texto, /Confirme/);

    const r = await post(inst, '/termo/nova', { texto, confirmacao: 'sim' }, '/termo/nova');
    assert.equal(r.status, 303);
    const pagina = await inst.pedir(r.local);
    assert.match(pagina.texto, /publicada/);
    assert.match(pagina.texto, /dados fictícios/);

    const consulta = await pessoa(['CONSULTA']);
    const lista = await consulta.pedir('/termo');
    assert.equal(lista.status, 200);
    assert.match(lista.texto, new RegExp(`Termo fictício ${marca}`));
    assert.match(lista.texto, /&lt;b&gt;os livros&lt;\/b&gt;/);
    assert.doesNotMatch(lista.texto, /Publicar nova versão/);
  });

  test('Administração do campus não publica (403); estudante não vê (403); sem sessão volta ao início', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    assert.equal((await admin.pedir('/termo/nova')).status, 403);
    assert.equal((await post(admin, '/termo/nova', { texto: 'x'.repeat(60), confirmacao: 'sim' }, '/termo')).status, 403);
    const estudante = await pessoa([], { dominio: dominios.estudante });
    assert.equal((await estudante.pedir('/termo')).status, 403);
    assert.equal((await new Navegador(srv.url).pedir('/termo')).status, 303);
    assert.equal((await admin.pedir('/termo/nao-e-uuid')).status, 404);
  });
});
