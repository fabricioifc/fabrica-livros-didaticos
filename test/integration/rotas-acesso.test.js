// Rotas de acesso de ponta a ponta (HTTP + sessão + serviço + banco reais; só o Google é simulado).
// Os dados são gravados de fato (o servidor usa o próprio pool), com nomes aleatórios e fictícios;
// este arquivo NÃO cria administradores institucionais, para não interferir nos testes de RF-005.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';
import { criarDominios, criarCampus, atribuir, criarEstudante } from '../helpers/fixtures.js';
import { Navegador, provedorFalso, iniciarServidor } from '../helpers/navegador.js';

const banco = { pool: undefined };
let srv;
let provedor;
let d; // dados fictícios do cenário

// Um único hook prepara banco, servidor e dados (ordem garantida).
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
  const db = banco.pool;
  const dominios = await criarDominios(db);
  const sufixo = randomUUID().slice(0, 6);
  d = {
    dominios,
    alfa: await criarCampus(db, { nome: `Campus Alfa ${sufixo}` }),
    beta: await criarCampus(db, { nome: `Campus Beta ${sufixo}` }),
    gama: await criarCampus(db, { nome: `Campus Gama ${sufixo}`, ativo: false }),
    sufixo,
  };
});

after(async () => {
  await srv?.fechar();
  await banco.pool?.end();
});

const novaIdentidade = (dominio, extra = {}) => {
  const id = randomUUID().slice(0, 8);
  return { sub: `sub-${id}`, email: `pessoa.${id}@${dominio}`, email_verified: true, hd: dominio, name: `Pessoa ${id}`, ...extra };
};
const usuarioPorSub = async (sub) => (await banco.pool.query('SELECT id FROM usuario WHERE google_sub = $1', [sub])).rows[0];

describe('Página inicial sem sessão', () => {
  test('mostra o botão de entrar, com cabeçalhos de segurança e sem cache', async () => {
    const r = await new Navegador(srv.url).pedir('/');
    assert.equal(r.status, 200);
    assert.match(r.texto, /Entrar com conta institucional/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-powered-by'), null);
  });

  test('arquivos do GovBR-DS e dos ícones são servidos localmente', async () => {
    const nav = new Navegador(srv.url);
    assert.equal((await nav.pedir('/vendor/govbr-ds/core.min.css')).status, 200);
    assert.equal((await nav.pedir('/vendor/fontawesome/css/all.min.css')).status, 200);
    assert.equal((await nav.pedir('/vendor/govbr-ds/../../../package.json')).status, 404);
  });
});

describe('Login (RF-001)', () => {
  test('servidor novo entra; o identificador da sessão muda no login; cookie httpOnly e SameSite=Lax', async () => {
    const nav = new Navegador(srv.url);
    const inicio = await nav.pedir('/auth/login');
    assert.equal(inicio.status, 303);
    assert.match(inicio.local, /^https:\/\/provedor\.teste\//);
    const cookieAntes = nav.cookie;
    assert.ok(cookieAntes, 'o login deve abrir uma sessão para guardar state/nonce');
    assert.match(inicio.setCookie[0], /HttpOnly/i);
    assert.match(inicio.setCookie[0], /SameSite=Lax/i);

    const claims = novaIdentidade(d.dominios.servidor);
    provedor.identidades.set('c1', claims);
    const estado = new URL(inicio.local).searchParams.get('state');
    const retorno = await nav.pedir(`/auth/callback?code=c1&state=${estado}`);
    assert.equal(retorno.status, 303);
    assert.notEqual(nav.cookie, cookieAntes, 'a sessão deve ser regenerada (fixação de sessão)');
    assert.ok(await usuarioPorSub(claims.sub));
  });

  test('state diferente do esperado é recusado e não autentica', async () => {
    const nav = new Navegador(srv.url);
    await nav.pedir('/auth/login');
    provedor.identidades.set('c2', novaIdentidade(d.dominios.servidor));
    const r = await nav.pedir('/auth/callback?code=c2&state=forjado');
    assert.equal(r.status, 400);
    assert.match((await nav.pedir('/')).texto, /Entrar com conta institucional/);
  });

  test('retorno sem login iniciado (ou repetido) não autentica', async () => {
    const nav = new Navegador(srv.url);
    const r = await nav.pedir('/auth/callback?code=x&state=y');
    assert.equal(r.status, 303);
    assert.match((await nav.pedir('/')).texto, /Entrar com conta institucional/);
  });

  test('CA-001.1: domínio não permitido vê a mensagem e não cria usuário nem sessão', async () => {
    const nav = new Navegador(srv.url);
    const claims = novaIdentidade('gmail.com');
    const r = await nav.entrar(provedor, claims);
    assert.equal(r.status, 401);
    assert.match(r.texto, /Use sua conta institucional do IFC/);
    assert.equal(await usuarioPorSub(claims.sub), undefined);
    assert.match((await nav.pedir('/')).texto, /Entrar com conta institucional/);
  });

  test('nome com HTML é exibido como texto (sem XSS)', async () => {
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, novaIdentidade(d.dominios.servidor, { name: '<script>alert(1)</script>' }));
    const pagina = (await nav.pedir('/')).texto;
    assert.doesNotMatch(pagina, /<script>alert\(1\)<\/script>/);
    assert.match(pagina, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});

describe('Limite de tentativas de login', () => {
  test('com limite 10, a 11ª tentativa de iniciar login no mesmo IP recebe 429', async () => {
    const limitado = await iniciarServidor({ pool: banco.pool, provedor, env: { LIMITE_LOGIN_15MIN: '10' } });
    try {
      const nav = new Navegador(limitado.url);
      const status = [];
      for (let i = 0; i < 11; i++) status.push((await nav.pedir('/auth/login')).status);
      assert.deepEqual(status.slice(0, 10), Array(10).fill(303));
      assert.equal(status[10], 429);
    } finally {
      await limitado.fechar();
    }
  });
});

describe('Primeiro acesso do servidor (RF-002) e CSRF', () => {
  test('lista só campi ativos; solicitação exige token CSRF; depois mostra "Aguardando confirmação" (CA-002.1)', async () => {
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, novaIdentidade(d.dominios.servidor));
    const escolha = await nav.pedir('/');
    assert.match(escolha.texto, /Escolha seu campus/);
    assert.match(escolha.texto, new RegExp(`Campus Alfa ${d.sufixo}`));
    assert.doesNotMatch(escolha.texto, new RegExp(`Campus Gama ${d.sufixo}`));

    const semToken = await nav.pedir('/acesso/solicitacoes', { method: 'POST', form: { campusId: d.alfa.id } });
    assert.equal(semToken.status, 403);
    const tokenErrado = await nav.pedir('/acesso/solicitacoes', { method: 'POST', form: { campusId: d.alfa.id, _csrf: 'x'.repeat(43) } });
    assert.equal(tokenErrado.status, 403);

    const _csrf = Navegador.csrf(escolha.texto);
    const invalido = await nav.pedir('/acesso/solicitacoes', { method: 'POST', form: { campusId: d.gama.id, _csrf } });
    assert.equal(invalido.status, 422);

    const ok = await nav.pedir('/acesso/solicitacoes', { method: 'POST', form: { campusId: d.alfa.id, _csrf } });
    assert.equal(ok.status, 303);
    const aguardando = await nav.pedir('/');
    assert.match(aguardando.texto, /Aguardando confirmação/);
    assert.match(aguardando.texto, new RegExp(`Campus Alfa ${d.sufixo}`));
  });
});

describe('Sessão: revogação, desativação e saída', () => {
  test('CA-004.1: atribuição revogada deixa de valer na próxima requisição', async () => {
    const claims = novaIdentidade(d.dominios.servidor);
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, claims);
    const { id } = await usuarioPorSub(claims.sub);
    const a = await atribuir(banco.pool, id, 'CONSULTA', d.alfa.id);
    assert.match((await nav.pedir('/')).texto, /Seus acessos/);

    await banco.pool.query('UPDATE atribuicao SET revogada_em = now(), revogada_por = usuario_id WHERE id = $1', [a.id]);
    const depois = await nav.pedir('/');
    assert.doesNotMatch(depois.texto, /Seus acessos/);
    assert.match(depois.texto, /Escolha seu campus/);
  });

  test('usuário desativado perde a sessão na próxima requisição', async () => {
    const claims = novaIdentidade(d.dominios.servidor);
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, claims);
    await banco.pool.query('UPDATE usuario SET ativo = false WHERE google_sub = $1', [claims.sub]);
    assert.match((await nav.pedir('/')).texto, /Entrar com conta institucional/);
  });

  test('CA-008.1: sair exige CSRF; depois, o cookie antigo não vale mais', async () => {
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, novaIdentidade(d.dominios.servidor));
    const pagina = await nav.pedir('/');
    const cookieAntigo = nav.cookie;
    assert.equal((await nav.pedir('/auth/sair', { method: 'POST', form: {} })).status, 403);

    const saida = await nav.pedir('/auth/sair', { method: 'POST', form: { _csrf: Navegador.csrf(pagina.texto) } });
    assert.equal(saida.status, 303);
    const reutilizado = new Navegador(srv.url);
    reutilizado.cookie = cookieAntigo;
    assert.match((await reutilizado.pedir('/')).texto, /Entrar com conta institucional/);
  });
});

describe('Estudante (RF-006)', () => {
  test('CA-006.1: sem cadastro, vê só a mensagem de cadastro não localizado', async () => {
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, novaIdentidade(d.dominios.estudante));
    const r = await nav.pedir('/');
    assert.match(r.texto, /Cadastro não localizado/);
    assert.doesNotMatch(r.texto, /Matrícula:/);
  });

  test('com cadastro, vê o próprio nome e matrícula', async () => {
    const claims = novaIdentidade(d.dominios.estudante);
    const cadastro = await criarEstudante(banco.pool, { email: claims.email });
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, claims);
    const r = await nav.pedir('/');
    assert.match(r.texto, new RegExp(cadastro.matricula));
  });

  test('CA-006.2: estudante não consegue solicitar acesso de servidor', async () => {
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, novaIdentidade(d.dominios.estudante));
    const pagina = await nav.pedir('/');
    const r = await nav.pedir('/acesso/solicitacoes', { method: 'POST', form: { campusId: d.alfa.id, _csrf: Navegador.csrf(pagina.texto) } });
    assert.equal(r.status, 403);
  });
});

describe('Servidor com acesso', () => {
  test('vê os campi e papéis apenas das próprias atribuições', async () => {
    const claims = novaIdentidade(d.dominios.servidor);
    const nav = new Navegador(srv.url);
    await nav.entrar(provedor, claims);
    const { id } = await usuarioPorSub(claims.sub);
    await atribuir(banco.pool, id, 'CONSULTA', d.alfa.id);
    await atribuir(banco.pool, id, 'OPERADOR', d.alfa.id);
    const r = await nav.pedir('/');
    assert.match(r.texto, new RegExp(`Campus Alfa ${d.sufixo}`));
    assert.match(r.texto, /Atendimento \(entregas e devoluções\)/);
    assert.doesNotMatch(r.texto, new RegExp(`Campus Beta ${d.sufixo}`));
  });
});
