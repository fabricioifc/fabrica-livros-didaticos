// Oferta do campus (RF-012: anos letivos e cursos) pelas rotas HTTP, com sessão real.
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

async function servidor(papeis, campus) {
  const id = randomUUID().slice(0, 8);
  const claims = { sub: `sub-${id}`, email: `pessoa.${id}@${dominios.servidor}`, email_verified: true, hd: dominios.servidor, name: `Pessoa ${id}` };
  const nav = new Navegador(srv.url);
  await nav.entrar(provedor, claims);
  const { rows } = await banco.pool.query('SELECT id FROM usuario WHERE google_sub = $1', [claims.sub]);
  for (const p of papeis) await atribuir(banco.pool, rows[0].id, p, campus.id);
  return nav;
}

const post = async (nav, caminho, form, paginaComToken) => {
  const _csrf = Navegador.csrf((await nav.pedir(paginaComToken)).texto);
  return nav.pedir(caminho, { method: 'POST', form: { ...form, _csrf } });
};

async function cenario() {
  const alfa = await criarCampus(banco.pool, { nome: `Alfa ${randomUUID().slice(0, 6)}` });
  const beta = await criarCampus(banco.pool, { nome: `Beta ${randomUUID().slice(0, 6)}` });
  const admin = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], alfa);
  return { alfa, beta, admin, pagina: `/campi/${alfa.id}/oferta` };
}

describe('RF-012 pela interface', () => {
  test('admin do campus cadastra ano letivo e curso; a página não oferece turmas', async () => {
    const c = await cenario();
    assert.equal((await post(c.admin, `${c.pagina}/anos`, { ano: '2027', inicio: '2027-02-10', fim: '2027-12-15' }, c.pagina)).status, 303);
    assert.equal((await post(c.admin, `${c.pagina}/cursos`, { nome: 'Técnico Fictício' }, c.pagina)).status, 303);
    const tela = (await c.admin.pedir(c.pagina)).texto;
    assert.match(tela, /Curso cadastrado/);
    assert.match(tela, /15\/12\/2027/);
    assert.match(tela, /Técnico Fictício/);
    assert.doesNotMatch(tela, /[Tt]urma/);
  });

  test('ano repetido ou término antes do início voltam à página (422) com a mensagem no campo', async () => {
    const c = await cenario();
    await post(c.admin, `${c.pagina}/anos`, { ano: '2027', inicio: '2027-02-10', fim: '2027-12-15' }, c.pagina);
    const repetido = await post(c.admin, `${c.pagina}/anos`, { ano: '2027', inicio: '2027-03-01', fim: '2027-11-30' }, c.pagina);
    assert.equal(repetido.status, 422);
    assert.match(repetido.texto, /já está cadastrado/);
    const invertido = await post(c.admin, `${c.pagina}/anos`, { ano: '2028', inicio: '2028-12-15', fim: '2028-02-10' }, c.pagina);
    assert.equal(invertido.status, 422);
    assert.match(invertido.texto, /O término deve ser depois do início/);
    assert.match(invertido.texto, /value="2028"/);
  });

  test('edição de ano letivo por URL de outro campus responde 404; do próprio campus funciona', async () => {
    const c = await cenario();
    const adminBeta = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], c.beta);
    await post(c.admin, `${c.pagina}/anos`, { ano: '2027', inicio: '2027-02-10', fim: '2027-12-15' }, c.pagina);
    const { rows: [a] } = await banco.pool.query('SELECT id FROM periodo_letivo WHERE campus_id = $1', [c.alfa.id]);
    assert.equal((await adminBeta.pedir(`/oferta/anos/${a.id}`)).status, 404);
    assert.equal((await post(adminBeta, `/oferta/anos/${a.id}`, { ano: '2027', inicio: '2027-01-01', fim: '2027-12-31' }, '/')).status, 404);
    const ok = await post(c.admin, `/oferta/anos/${a.id}`, { ano: '2027', inicio: '2027-02-10', fim: '2027-12-20' }, `/oferta/anos/${a.id}`);
    assert.equal(ok.status, 303);
    const { rows: [depois] } = await banco.pool.query("SELECT ano, to_char(fim, 'YYYY-MM-DD') AS fim FROM periodo_letivo WHERE id = $1", [a.id]);
    assert.deepEqual(depois, { ano: 2027, fim: '2027-12-20' });
  });

  test('desativar curso pela interface; admin de outro campus não consegue (404)', async () => {
    const c = await cenario();
    const adminBeta = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], c.beta);
    await post(c.admin, `${c.pagina}/cursos`, { nome: 'Curso a Desativar' }, c.pagina);
    const { rows: [curso] } = await banco.pool.query('SELECT id FROM curso WHERE campus_id = $1', [c.alfa.id]);
    assert.equal((await post(adminBeta, `/oferta/cursos/${curso.id}/desativar`, {}, '/')).status, 404);
    assert.equal((await post(c.admin, `/oferta/cursos/${curso.id}/desativar`, {}, c.pagina)).status, 303);
    assert.equal((await banco.pool.query('SELECT ativo FROM curso WHERE id = $1', [curso.id])).rows[0].ativo, false);
  });

  test('Consulta e admin de outro campus não abrem a oferta (404); sem CSRF, 403', async () => {
    const c = await cenario();
    const consulta = await servidor(['CONSULTA'], c.alfa);
    const adminBeta = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], c.beta);
    assert.equal((await consulta.pedir(c.pagina)).status, 404);
    assert.equal((await adminBeta.pedir(c.pagina)).status, 404);
    assert.equal((await c.admin.pedir(`${c.pagina}/cursos`, { method: 'POST', form: { nome: 'Sem token' } })).status, 403);
  });
});
