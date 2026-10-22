// Estoque do campus (RF-025 a RF-028) pelas rotas HTTP, com sessão real. Dados gravados de fato, nomes aleatórios.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';
import { criarDominios, criarCampus, atribuir, criarTitulo, criarUsuario } from '../helpers/fixtures.js';
import { Navegador, provedorFalso, iniciarServidor } from '../helpers/navegador.js';

const banco = { pool: undefined };
let srv;
let provedor;
let dominios;
let alfa;
let beta;
let titulo;

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
  alfa = await criarCampus(banco.pool, { nome: `Estoque Alfa ${randomUUID().slice(0, 6)}` });
  beta = await criarCampus(banco.pool, { nome: `Estoque Beta ${randomUUID().slice(0, 6)}` });
  const autor = await criarUsuario(banco.pool, { dominio: dominios.servidor });
  titulo = await criarTitulo(banco.pool, autor.id, { titulo: 'Geografia Fictícia' });
});

after(async () => {
  await srv?.fechar();
  await banco.pool?.end();
});

async function pessoa(papeis = [], { campus = alfa, dominio = dominios.servidor } = {}) {
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
const base = (campus = alfa) => `/campi/${campus.id}/estoque/titulos/${titulo.id}`;

describe('RF-025 a RF-028 pela interface', () => {
  test('admin do campus registra entrada (com CSRF) e baixa; saldo e histórico aparecem', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const busca = await admin.pedir(`/campi/${alfa.id}/estoque/entrada?q=${encodeURIComponent(titulo.titulo)}`);
    assert.equal(busca.status, 200);
    assert.match(busca.texto, new RegExp(`${base()}/entrada`));
    assert.equal((await admin.pedir(`${base()}/entrada`, { method: 'POST', form: { quantidade: '5', origem: 'X' } })).status, 403);

    const r = await post(admin, `${base()}/entrada`, { quantidade: '12', origem: 'Recebimento fictício' }, `${base()}/entrada`);
    assert.equal(r.status, 303);
    const pagina = await admin.pedir(r.local);
    assert.match(pagina.texto, /Entrada registrada/);
    assert.match(pagina.texto, /Recebimento fictício/);

    assert.equal((await post(admin, `${base()}/baixa`, { quantidade: '2', justificativa: 'Danificados (fictício)' }, `${base()}/baixa`)).status, 303);
    const lista = await admin.pedir(`/campi/${alfa.id}/estoque`);
    assert.match(lista.texto, /Geografia Fictícia/);
    assert.match((await admin.pedir(`/campi/${alfa.id}/estoque/movimentacoes`)).texto, /Danificados \(fictício\)/);
  });

  test('baixa sem justificativa ou acima do saldo volta ao formulário (422) com a mensagem', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const semJustificativa = await post(admin, `${base()}/baixa`, { quantidade: '1', justificativa: '' }, `${base()}/baixa`);
    assert.equal(semJustificativa.status, 422);
    assert.match(semJustificativa.texto, /Informe a justificativa/);
    const acima = await post(admin, `${base()}/baixa`, { quantidade: '99999', justificativa: 'Teste fictício' }, `${base()}/baixa`);
    assert.equal(acima.status, 422);
    assert.match(acima.texto, /Saldo insuficiente/);
  });

  test('Consulta vê o estoque sem botões; formulário e gravação: 403', async () => {
    const consulta = await pessoa(['CONSULTA']);
    const pagina = await consulta.pedir(base());
    assert.equal(pagina.status, 200);
    assert.doesNotMatch(pagina.texto, /Registrar entrada/);
    assert.equal((await consulta.pedir(`${base()}/baixa`)).status, 403);
    assert.equal((await post(consulta, `${base()}/baixa`, { quantidade: '1', justificativa: 'Teste' }, base())).status, 403);
    assert.equal((await consulta.pedir(`/campi/${alfa.id}/estoque/entrada`)).status, 403);
  });

  test('outro campus, estudante, sem sessão, tipo inválido e ids malformados', async () => {
    const adminBeta = await pessoa(['ADMIN_CAMPUS'], { campus: beta });
    for (const caminho of [`/campi/${alfa.id}/estoque`, base(), `/campi/${alfa.id}/estoque/movimentacoes`, `${base()}/entrada`]) {
      assert.equal((await adminBeta.pedir(caminho)).status, 404, caminho);
    }
    assert.equal((await post(adminBeta, `${base()}/entrada`, { quantidade: '1', origem: 'Teste' }, `/campi/${beta.id}/estoque`)).status, 404);
    assert.equal((await adminBeta.pedir(`${base(beta)}/entrega`)).status, 404);
    assert.equal((await adminBeta.pedir(`/campi/${beta.id}/estoque/titulos/nao-e-uuid`)).status, 404);
    const estudante = await pessoa([], { dominio: dominios.estudante });
    assert.equal((await estudante.pedir(`/campi/${alfa.id}/estoque`)).status, 403);
    assert.equal((await new Navegador(srv.url).pedir(`/campi/${alfa.id}/estoque`)).status, 303);
  });
});
