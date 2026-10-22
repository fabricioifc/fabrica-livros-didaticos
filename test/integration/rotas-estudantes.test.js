// Estudantes e vínculos (RF-030 a RF-033) pelas rotas HTTP, com sessão real. Dados gravados de fato, nomes aleatórios.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestPool, MENSAGEM_BANCO_INDISPONIVEL } from '../helpers/test-db.js';
import { aplicarMigracoes } from '../../src/infra/db/migrar.js';
import { criarDominios, criarCampus, atribuir, criarOferta } from '../helpers/fixtures.js';
import { Navegador, provedorFalso, iniciarServidor } from '../helpers/navegador.js';

const banco = { pool: undefined };
let srv;
let provedor;
let dominios;
let alfa;
let beta;
let oferta;

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
  alfa = await criarCampus(banco.pool, { nome: `Estudantes Alfa ${randomUUID().slice(0, 6)}` });
  beta = await criarCampus(banco.pool, { nome: `Estudantes Beta ${randomUUID().slice(0, 6)}` });
  oferta = await criarOferta(banco.pool, alfa.id);
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
const enviarPlanilha = async (nav, conteudo, { comToken = true } = {}) => {
  const base = `/campi/${alfa.id}/estudantes/importar`;
  const dados = new FormData();
  if (comToken) dados.set('_csrf', Navegador.csrf((await nav.pedir(base)).texto));
  dados.set('arquivo', new Blob([conteudo], { type: 'text/csv' }), 'estudantes.csv');
  return nav.pedir(base, { method: 'POST', multipart: dados });
};
const novaPessoa = () => {
  const s = randomUUID().slice(0, 8);
  return { matricula: `R${s}`.toUpperCase(), nome: `Fictício ${s}`, email: `aluno.${s}@${dominios.estudante}` };
};
const linhaCsv = (p, serie = '1') => [p.matricula, p.nome, p.email, oferta.curso.nome, serie, oferta.ano.ano].join(';');
const CABECALHO = 'matricula;nome;email;curso;serie;ano_letivo';

describe('RF-030 a RF-033 pela interface', () => {
  test('cadastro manual (com CSRF), ficha, edição e encerramento do vínculo', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const p = novaPessoa();
    const form = { ...p, cursoId: oferta.curso.id, periodoId: oferta.ano.id, serie: '1' };
    const novo = `/campi/${alfa.id}/estudantes/novo`;
    assert.equal((await admin.pedir(novo, { method: 'POST', form })).status, 403);
    const r = await post(admin, novo, form, novo);
    assert.equal(r.status, 303);
    assert.doesNotMatch(r.local, new RegExp(p.matricula)); // regra 14: sem matrícula na URL
    const ficha = await admin.pedir(r.local);
    assert.match(ficha.texto, /Estudante cadastrado/);
    assert.match(ficha.texto, new RegExp(p.matricula));

    const editar = `${r.local}/editar`;
    assert.equal((await post(admin, editar, { ...form, serie: '2' }, editar)).status, 303);
    const encerrar = (await admin.pedir(r.local)).texto.match(/href="(\/vinculos\/[^"]+\/encerrar)"/)[1];
    const tela = await admin.pedir(encerrar);
    const hoje = tela.texto.match(/name="fim" type="date"\s+value="([^"]+)"/)[1];
    assert.equal((await post(admin, encerrar, { situacao: 'CONCLUIDO', fim: hoje }, encerrar)).status, 303);
    assert.match((await admin.pedir(r.local)).texto, /Concluído/);
  });

  test('busca por POST guardada na sessão: nome e matrícula não vão para a URL', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const p = novaPessoa();
    const novo = `/campi/${alfa.id}/estudantes/novo`;
    await post(admin, novo, { ...p, cursoId: oferta.curso.id, periodoId: oferta.ano.id, serie: '1' }, novo);
    const lista = `/campi/${alfa.id}/estudantes`;
    const r = await post(admin, `${lista}/busca`, { termo: p.matricula, situacao: '' }, lista);
    assert.equal(r.status, 303);
    assert.equal(r.local, lista);
    const resultado = await admin.pedir(lista);
    assert.match(resultado.texto, new RegExp(p.nome));
    assert.match(resultado.texto, /1 estudante\(s\)/);
  });

  test('importação: planilha válida cria; com erro não grava nada e lista as linhas; CSRF exigido', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const [a, b] = [novaPessoa(), novaPessoa()];
    assert.equal((await enviarPlanilha(admin, `${CABECALHO}\n${linhaCsv(a)}`, { comToken: false })).status, 403);

    const ruim = await enviarPlanilha(admin, `${CABECALHO}\n${linhaCsv(b)}\n${linhaCsv({ ...novaPessoa(), email: 'x@gmail.com' })}`);
    assert.equal(ruim.status, 422);
    assert.match(ruim.texto, /Nada foi importado/);
    assert.match(ruim.texto, /<td>3<\/td><td>Use o e-mail institucional de estudante\.<\/td>/);
    const { rows } = await banco.pool.query('SELECT 1 FROM estudante WHERE matricula = $1', [b.matricula]);
    assert.equal(rows.length, 0);

    const ok = await enviarPlanilha(admin, `${CABECALHO}\n${linhaCsv(a)}\n${linhaCsv(b, '2ª')}`);
    assert.equal(ok.status, 303);
    assert.match((await admin.pedir(ok.local)).texto, /Planilha importada: 2 estudante/);

    const semColunas = await enviarPlanilha(admin, 'matricula;nome\n1;A');
    assert.equal(semColunas.status, 422);
    assert.match(semColunas.texto, /Faltando: email, curso, serie, ano_letivo/);
  });

  test('permissões: Consulta vê a lista sem botões e recebe 403 ao gerir; outro campus 404; estudante 403', async () => {
    const consulta = await pessoa(['CONSULTA']);
    const lista = await consulta.pedir(`/campi/${alfa.id}/estudantes`);
    assert.equal(lista.status, 200);
    assert.doesNotMatch(lista.texto, /Importar planilha/);
    assert.equal((await consulta.pedir(`/campi/${alfa.id}/estudantes/novo`)).status, 403);
    assert.equal((await consulta.pedir(`/campi/${alfa.id}/estudantes/importar`)).status, 403);
    assert.equal((await consulta.pedir(`/campi/${alfa.id}/estudantes/modelo.csv`)).status, 403);

    const adminBeta = await pessoa(['ADMIN_CAMPUS'], { campus: beta });
    assert.equal((await adminBeta.pedir(`/campi/${alfa.id}/estudantes`)).status, 404);
    assert.equal((await adminBeta.pedir(`/campi/${alfa.id}/estudantes/importar`)).status, 404);
    assert.equal((await adminBeta.pedir(`/campi/${alfa.id}/estudantes/${randomUUID()}`)).status, 404);
    assert.equal((await adminBeta.pedir(`/vinculos/${randomUUID()}/encerrar`)).status, 404);
    const estudante = await pessoa([], { dominio: dominios.estudante });
    assert.equal((await estudante.pedir(`/campi/${alfa.id}/estudantes`)).status, 403);
  });

  test('modelo da planilha traz só o cabeçalho', async () => {
    const admin = await pessoa(['ADMIN_CAMPUS', 'CONSULTA']);
    const r = await admin.pedir(`/campi/${alfa.id}/estudantes/modelo.csv`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.equal(r.texto.replace(/^﻿/, '').trim(), CABECALHO);
  });
});
