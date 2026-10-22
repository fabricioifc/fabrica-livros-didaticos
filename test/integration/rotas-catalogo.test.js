// Catálogo de títulos (RF-020) pelas rotas HTTP, com sessão real. Dados gravados de fato, ISBNs aleatórios.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';
import { criarDominios, criarCampus, atribuir, gerarIsbn } from '../helpers/fixtures.js';
import { Navegador, provedorFalso, iniciarServidor } from '../helpers/navegador.js';

const banco = { pool: undefined };
let srv;
let provedor;
let dominios;
let campus;

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
  campus = await criarCampus(banco.pool, { nome: `Catálogo ${randomUUID().slice(0, 6)}` });
});

after(async () => {
  await srv?.fechar();
  await banco.pool?.end();
});

async function pessoa(papeis = [], dominio = dominios.servidor) {
  const id = randomUUID().slice(0, 8);
  const claims = { sub: `sub-${id}`, email: `pessoa.${id}@${dominio}`, email_verified: true, hd: dominio, name: `Pessoa ${id}` };
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
const form = (extra = {}) => ({
  titulo: `Química Fictícia ${randomUUID().slice(0, 6)}`, autores: 'Autor Fictício', isbn: gerarIsbn(), editora: '', edicao: '',
  volume: '', anoPublicacao: '', componente: 'Química', codigoPrograma: '', abrangencia: 'SERIE_ESPECIFICA', serie: '1', ...extra,
});

describe('RF-020 pela interface', () => {
  test('admin do campus cadastra (com CSRF); Consulta encontra o título na busca', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const dados = form();
    assert.equal((await admin.pedir('/catalogo', { method: 'POST', form: dados })).status, 403);
    const r = await post(admin, '/catalogo', dados, '/catalogo/novo');
    assert.equal(r.status, 303);
    assert.match((await admin.pedir(r.local)).texto, /Título cadastrado/);

    const consulta = await pessoa(['CONSULTA']);
    const busca = await consulta.pedir(`/catalogo?q=${encodeURIComponent(dados.titulo)}`);
    assert.equal(busca.status, 200);
    assert.match(busca.texto, new RegExp(dados.titulo));
    assert.doesNotMatch(busca.texto, /Cadastrar título/);
  });

  test('ISBN repetido volta ao formulário (422) com link para o título existente', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const isbn = gerarIsbn();
    const primeiro = await post(admin, '/catalogo', form({ isbn }), '/catalogo/novo');
    const repetido = await post(admin, '/catalogo', form({ isbn: `${isbn.slice(0, 3)}-${isbn.slice(3)}` }), '/catalogo/novo');
    assert.equal(repetido.status, 422);
    assert.match(repetido.texto, /já está no catálogo/);
    assert.match(repetido.texto, new RegExp(`href="${primeiro.local}"`));
  });

  test('série específica sem série e ISBN inválido: 422 com mensagens nos campos', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const r = await post(admin, '/catalogo', form({ serie: '', isbn: '9780306406158' }), '/catalogo/novo');
    assert.equal(r.status, 422);
    assert.match(r.texto, /Informe a série/);
    assert.match(r.texto, /ISBN inválido/);
  });

  test('Consulta não acessa o cadastro; admin do campus não edita (403); estudante não vê o catálogo', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const criado = await post(admin, '/catalogo', form(), '/catalogo/novo');
    const consulta = await pessoa(['CONSULTA']);
    assert.equal((await consulta.pedir('/catalogo/novo')).status, 403);
    assert.equal((await post(consulta, '/catalogo', form(), '/catalogo')).status, 403);
    assert.equal((await admin.pedir(`${criado.local}/editar`)).status, 403);
    assert.equal((await post(admin, criado.local, form(), criado.local)).status, 403);
    const estudante = await pessoa([], dominios.estudante);
    assert.equal((await estudante.pedir('/catalogo')).status, 403);
    assert.equal((await new Navegador(srv.url).pedir('/catalogo')).status, 303);
  });

  test('título inexistente ou id malformado: 404; texto com HTML aparece escapado', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    assert.equal((await admin.pedir('/catalogo/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await admin.pedir('/catalogo/nao-e-uuid')).status, 404);
    const r = await post(admin, '/catalogo', form({ titulo: '<script>alert(1)</script> Fictício' }), '/catalogo/novo');
    const detalhe = (await admin.pedir(r.local)).texto;
    assert.doesNotMatch(detalhe, /<script>alert\(1\)<\/script>/);
    assert.match(detalhe, /&lt;script&gt;/);
  });
});
