// Regras obrigatórias do AGENTS.md verificáveis por inspeção do repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Arquivos versionados ou ainda não versionados (respeitando o .gitignore).
const arquivosDoRepositorio = () =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: RAIZ,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => existsSync(join(RAIZ, f)));

// Código de produção: fora de documentação, testes, seeds e fixtures (AGENTS.md, regra 13).
const PERMITIDOS = /^(docs\/|test\/|\.claude\/|AGENTS\.md$|README\.md$|.*\/seeds?\/|.*\/fixtures?\/|.*\.example$)/;
const CODIGO = /\.(js|mjs|cjs|ejs|html|css|sql|json|yml|yaml)$/;

const codigoDeProducao = () =>
  arquivosDoRepositorio().filter((f) => CODIGO.test(f) && !PERMITIDOS.test(f) && f !== 'package-lock.json');

test('nenhum arquivo .env real está no repositório (AGENTS.md, regra 17)', () => {
  const envs = arquivosDoRepositorio().filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example'));
  assert.deepEqual(envs, []);
});

test('o .gitignore bloqueia arquivos .env', () => {
  const saida = execFileSync('git', ['check-ignore', '.env', '.env.local', '.env.production'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  assert.equal(saida.trim().split('\n').length, 3);
});

test('código de produção não cita campus por nome (AGENTS.md, regras 2 e 13)', (t) => {
  const arquivos = codigoDeProducao().filter((f) => !f.startsWith('docker/'));
  const temCodigoDaAplicacao = arquivos.some((f) => /^(src|public)\//.test(f));
  if (!temCodigoDaAplicacao) {
    t.skip('PENDENTE: ainda não há código da aplicação em src/ ou public/');
    return;
  }
  const violacoes = arquivos.filter((f) => /fraiburgo/i.test(readFileSync(join(RAIZ, f), 'utf8')));
  assert.deepEqual(violacoes, []);
});

test('domínios de e-mail não aparecem como literais no código (AGENTS.md, regra 16)', (t) => {
  const arquivos = codigoDeProducao().filter((f) => /^(src|public)\//.test(f));
  if (arquivos.length === 0) {
    t.skip('PENDENTE: ainda não há código da aplicação em src/ ou public/');
    return;
  }
  const violacoes = arquivos.filter((f) => /ifc\.edu\.br/i.test(readFileSync(join(RAIZ, f), 'utf8')));
  assert.deepEqual(violacoes, []);
});
