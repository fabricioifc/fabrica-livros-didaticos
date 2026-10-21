// A documentação é a especificação seguida pelos agentes de desenvolvimento.
// Estes testes impedem referências quebradas e o retorno de decisões já revogadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = [
  'AGENTS.md',
  'docs/architecture.md',
  'docs/business-rules.md',
  'docs/requirements.md',
  'docs/testing.md',
  'README.md',
  '.claude/skills/govbr-design-system/SKILL.md',
];
const ler = (arquivo) => readFileSync(join(RAIZ, arquivo), 'utf8');
const conteudo = Object.fromEntries(DOCS.map((d) => [d, ler(d)]));
const regras = conteudo['docs/business-rules.md'];
const agents = conteudo['AGENTS.md'];
const requisitos = conteudo['docs/requirements.md'];

const idsDefinidos = (texto, prefixo) =>
  new Set([...texto.matchAll(new RegExp(`^\\| (${prefixo}-\\d+) \\|`, 'gm'))].map((m) => m[1]));
const idsCitados = (texto, padrao) => new Set(texto.match(padrao) ?? []);

test('links relativos entre documentos apontam para arquivos existentes', () => {
  const quebrados = [];
  for (const doc of DOCS) {
    for (const [, alvo] of conteudo[doc].matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(alvo)) continue;
      if (!existsSync(join(RAIZ, dirname(doc), alvo))) quebrados.push(`${doc} -> ${alvo}`);
    }
  }
  assert.deepEqual(quebrados, []);
});

test('regras de negócio RN-xx são únicas e sequenciais', () => {
  const ids = [...regras.matchAll(/^\| (RN-\d+) \|/gm)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs duplicados');
  const numeros = ids.map((id) => Number(id.slice(3))).sort((a, b) => a - b);
  numeros.forEach((n, i) => assert.equal(n, i + 1, `lacuna na numeração perto de RN-${i + 1}`));
});

test('toda regra RN-xx citada em qualquer documento existe em business-rules.md', () => {
  const definidas = idsDefinidos(regras, 'RN');
  for (const doc of DOCS) {
    const faltando = [...idsCitados(conteudo[doc], /RN-\d+/g)].filter((id) => !definidas.has(id));
    assert.deepEqual(faltando, [], `${doc} cita regras inexistentes`);
  }
});

test('decisões (C, D, DP) e dúvidas (DV) citadas existem onde são definidas', () => {
  const dp = idsDefinidos(agents, 'DP');
  const d = new Set([...agents.matchAll(/^\| (D-\d+) \|/gm)].map((m) => m[1]));
  const c = new Set([...agents.matchAll(/^\| (C\d+) \|/gm)].map((m) => m[1]));
  const dv = idsDefinidos(requisitos, 'DV');
  for (const doc of DOCS) {
    const t = conteudo[doc];
    assert.deepEqual([...idsCitados(t, /DP-\d+/g)].filter((x) => !dp.has(x)), [], `${doc}: DP inexistente`);
    assert.deepEqual([...idsCitados(t, /\bD-\d+/g)].filter((x) => !d.has(x)), [], `${doc}: D inexistente`);
    assert.deepEqual([...idsCitados(t, /\bC\d{1,2}\b/g)].filter((x) => !c.has(x)), [], `${doc}: C inexistente`);
    assert.deepEqual([...idsCitados(t, /DV-\d+/g)].filter((x) => !dv.has(x)), [], `${doc}: DV inexistente`);
  }
});

test('todo requisito funcional tem critérios de aceitação próprios', () => {
  const blocos = requisitos.split(/^\*\*(?=RF-\d{3} —)/m).slice(1);
  assert.ok(blocos.length > 0, 'nenhum RF encontrado');
  for (const bloco of blocos) {
    const rf = bloco.match(/^RF-(\d{3})/)[1];
    // Só as linhas que DEFINEM critérios ("- CA-xxx.n"); citações a outros RF são permitidas.
    const cas = [...bloco.matchAll(/^- (CA-\d{3}\.\d+)/gm)].map((m) => m[1]);
    assert.ok(cas.length > 0, `RF-${rf} sem critério de aceitação`);
    for (const ca of cas) assert.ok(ca.startsWith(`CA-${rf}.`), `RF-${rf} define ${ca}`);
    assert.equal(new Set(cas).size, cas.length, `RF-${rf} com critério duplicado`);
  }
});

test('todo RF e RNF aparece em exatamente uma prioridade', () => {
  const rf = [...requisitos.matchAll(/^\*\*(RF-\d{3}) —/gm)].map((m) => m[1]);
  const rnf = [...requisitos.matchAll(/^\| (RNF-\d{3}) \|/gm)].map((m) => m[1]);
  const secao = requisitos.split('## 6.')[1].split('## 7.')[0];
  const atribuidos = [];
  for (const m of secao.matchAll(/(RN?F)-(\d{3})(?: a RN?F-(\d{3}))?/g)) {
    for (let i = Number(m[2]); i <= Number(m[3] ?? m[2]); i++) {
      atribuidos.push(`${m[1]}-${String(i).padStart(3, '0')}`);
    }
  }
  const existentes = new Set([...rf, ...rnf]);
  const contagem = (id) => atribuidos.filter((x) => x === id).length;
  assert.deepEqual([...existentes].filter((id) => contagem(id) !== 1), [], 'sem prioridade ou com prioridade duplicada');
  assert.deepEqual(atribuidos.filter((id) => !existentes.has(id)), [], 'prioridade para requisito inexistente');
});

// Regressão: decisões revogadas em 2026-10-21 não podem voltar à especificação.
test('regressão: não há transferência de livros entre campi no modelo (Q-12)', () => {
  assert.doesNotMatch(agents, /CREATE TABLE transferencia_estoque/);
  assert.doesNotMatch(agents, /TRANSF_(SAIDA|ENTRADA)/);
});

test('regressão: entrega preparada não expira automaticamente (DV-04)', () => {
  assert.doesNotMatch(agents, /expira_em|minutos_validade|'EXPIRADA'/);
});

test('regressão: assinatura não é feita pela conta do estudante (Q-08)', () => {
  assert.doesNotMatch(agents, /email_assinante|conta Google que assinou/);
  assert.match(agents, /conduzida_por/);
});

test('regressão: o aviso de etapa permite implementar o MVP', () => {
  assert.doesNotMatch(agents, /Não implementar a aplicação nesta etapa/);
});
