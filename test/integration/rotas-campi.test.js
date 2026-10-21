// Campi (RF-010, RF-011) pelas rotas HTTP, com sessão real. Os dados são gravados de fato;
// o admin institucional é criado com o mesmo bloqueio dos testes de RF-005 (sem interferência).
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
let inst; // administrador institucional (logado)

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
  inst = await servidor();
  await criarAdminInstitucionalConfirmado(banco.pool, inst.id);
});

after(async () => {
  // Revoga o admin criado aqui, para não deixar administradores extras no banco de testes.
  if (inst) await banco.pool.query("UPDATE atribuicao SET revogada_em = now(), revogada_por = usuario_id WHERE usuario_id = $1 AND revogada_em IS NULL", [inst.id]);
  await srv?.fechar();
  await banco.pool?.end();
});

async function servidor(papeis = [], campus = null) {
  const id = randomUUID().slice(0, 8);
  const claims = { sub: `sub-${id}`, email: `pessoa.${id}@${dominios.servidor}`, email_verified: true, hd: dominios.servidor, name: `Pessoa ${id}` };
  const nav = new Navegador(srv.url);
  await nav.entrar(provedor, claims);
  const { rows } = await banco.pool.query('SELECT id FROM usuario WHERE google_sub = $1', [claims.sub]);
  for (const p of papeis) await atribuir(banco.pool, rows[0].id, p, campus.id);
  return { nav, id: rows[0].id };
}

const post = async (nav, caminho, form = {}, paginaComToken = '/') => {
  const _csrf = Navegador.csrf((await nav.pedir(paginaComToken)).texto);
  return nav.pedir(caminho, { method: 'POST', form: { ...form, _csrf } });
};
const codigoNovo = () => `R${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`;
const formConfig = (extra = {}) => ({
  nomeOficial: 'Instituto Fictício – Campus Configurado', nomeCurto: 'Configurado', endereco: 'Rua Fictícia, 1', cidade: 'Cidade Fictícia',
  uf: 'SC', cep: '00000-000', setorResponsavel: 'Setor Fictício', emailSetor: 'setor@exemplo.teste', telefone: '0000', permiteEntregaComPendencia: 'sim', ...extra,
});

describe('RF-010 pela interface', () => {
  test('admin institucional cadastra campus (com CSRF) e ele aparece para quem vai solicitar acesso', async () => {
    const codigo = codigoNovo();
    const semToken = await inst.nav.pedir('/campi', { method: 'POST', form: { codigo, nomeOficial: 'Instituto Fictício – Campus Rota', nomeCurto: `Rota ${codigo}` } });
    assert.equal(semToken.status, 403);

    const r = await post(inst.nav, '/campi', { codigo, nomeOficial: 'Instituto Fictício – Campus Rota', nomeCurto: `Rota ${codigo}` }, '/campi/novo');
    assert.equal(r.status, 303);
    assert.match((await inst.nav.pedir('/campi')).texto, new RegExp(`Rota ${codigo}`));
    const novato = await servidor();
    assert.match((await novato.nav.pedir('/')).texto, new RegExp(`Campus Rota`));
  });

  test('dados inválidos voltam ao formulário (422) com a mensagem no campo e os valores digitados', async () => {
    const r = await post(inst.nav, '/campi', { codigo: 'x y', nomeOficial: 'abc', nomeCurto: 'Valor digitado' }, '/campi/novo');
    assert.equal(r.status, 422);
    assert.match(r.texto, /Código: de 2 a 10 letras/);
    assert.match(r.texto, /aria-invalid="true"/);
    assert.match(r.texto, /value="Valor digitado"/);
  });

  test('desativar pela interface tira o campus da lista de solicitação', async () => {
    const campus = await criarCampus(banco.pool, { nome: `Desativável ${randomUUID().slice(0, 6)}` });
    const r = await post(inst.nav, `/campi/${campus.id}/desativar`, {}, '/campi');
    assert.equal(r.status, 303);
    const novato = await servidor();
    assert.doesNotMatch((await novato.nav.pedir('/')).texto, new RegExp(campus.codigo));
    const { rows } = await banco.pool.query('SELECT ativo FROM campus WHERE id = $1', [campus.id]);
    assert.equal(rows[0].ativo, false);
  });

  test('admin do campus, Consulta e estudante não acessam a administração de campi', async () => {
    const campus = await criarCampus(banco.pool, { nome: `Alfa ${randomUUID().slice(0, 6)}` });
    const adminCampus = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], campus);
    assert.equal((await adminCampus.nav.pedir('/campi')).status, 403);
    assert.equal((await adminCampus.nav.pedir('/campi/novo')).status, 403);
    assert.equal((await post(adminCampus.nav, '/campi', { codigo: codigoNovo(), nomeOficial: 'Instituto Fictício', nomeCurto: 'X' })).status, 403);
    assert.equal((await post(adminCampus.nav, `/campi/${campus.id}/desativar`)).status, 403);
    assert.equal((await new Navegador(srv.url).pedir('/campi')).status, 303);
  });
});

describe('RF-011 pela interface', () => {
  test('admin do campus configura o próprio campus; o código não aparece como campo editável', async () => {
    const campus = await criarCampus(banco.pool, { nome: `Beta ${randomUUID().slice(0, 6)}` });
    const admin = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], campus);
    const pagina = `/campi/${campus.id}/configuracao`;
    const tela = await admin.nav.pedir(pagina);
    assert.equal(tela.status, 200);
    assert.doesNotMatch(tela.texto, /name="codigo"/);

    const r = await post(admin.nav, pagina, formConfig(), pagina);
    assert.equal(r.status, 303);
    assert.match((await admin.nav.pedir(pagina)).texto, /Configuração salva/);
    const { rows } = await banco.pool.query('SELECT c.nome_curto, k.cep, k.uf FROM campus c JOIN campus_configuracao k ON k.campus_id = c.id WHERE c.id = $1', [campus.id]);
    assert.deepEqual(rows[0], { nome_curto: 'Configurado', cep: '00000000', uf: 'SC' });
  });

  test('admin do campus: código forjado → 403; campus de outro por URL → 404', async () => {
    const campusA = await criarCampus(banco.pool, { nome: `A ${randomUUID().slice(0, 6)}` });
    const campusB = await criarCampus(banco.pool, { nome: `B ${randomUUID().slice(0, 6)}` });
    const admin = await servidor(['ADMIN_CAMPUS', 'CONSULTA'], campusA);
    const pagina = `/campi/${campusA.id}/configuracao`;
    assert.equal((await post(admin.nav, pagina, formConfig({ codigo: codigoNovo() }), pagina)).status, 403);
    assert.equal((await admin.nav.pedir(`/campi/${campusB.id}/configuracao`)).status, 404);
    assert.equal((await post(admin.nav, `/campi/${campusB.id}/configuracao`, formConfig(), pagina)).status, 404);
    const { rows } = await banco.pool.query('SELECT codigo FROM campus WHERE id = $1', [campusA.id]);
    assert.equal(rows[0].codigo, campusA.codigo);
  });

  test('erro de validação reexibe os valores digitados e o nome com HTML aparece como texto', async () => {
    const campus = await criarCampus(banco.pool, { nome: `C ${randomUUID().slice(0, 6)}` });
    const pagina = `/campi/${campus.id}/configuracao`;
    const r = await post(inst.nav, pagina, formConfig({ uf: 'XYZ', nomeCurto: '<script>x</script>' }), pagina);
    assert.equal(r.status, 422);
    assert.match(r.texto, /UF: duas letras/);
    assert.doesNotMatch(r.texto, /<script>x<\/script>/);
    assert.match(r.texto, /&lt;script&gt;x&lt;\/script&gt;/);
  });
});
