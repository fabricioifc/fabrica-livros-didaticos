// Regras puras do módulo de acesso (src/modulos/acesso/dominio.js).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classificarIdentidade,
  escopoDoUsuario,
  podeDecidirSolicitacao,
  podeConcederPapel,
  validarPapelEscopo,
} from '../../src/modulos/acesso/dominio.js';

const DOMINIOS = [
  { dominio: 'servidores.teste', tipo: 'SERVIDOR', ativo: true },
  { dominio: 'estudantes.servidores.teste', tipo: 'ESTUDANTE', ativo: true },
  { dominio: 'antigo.teste', tipo: 'SERVIDOR', ativo: false },
];
const claims = (extra = {}) => ({
  sub: '123', email: 'ana@servidores.teste', email_verified: true, hd: 'servidores.teste', name: 'Ana', ...extra,
});
const codigo = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.codigo;
  }
  return 'SEM_ERRO';
};

describe('classificarIdentidade (RF-001)', () => {
  test('servidor com domínio permitido e Workspace correspondente é aceito', () => {
    assert.deepEqual(classificarIdentidade(claims(), DOMINIOS), {
      sub: '123', email: 'ana@servidores.teste', nome: 'Ana', tipo: 'SERVIDOR',
    });
  });

  test('estudante recebe o tipo do seu domínio; e-mail é normalizado em minúsculas', () => {
    const r = classificarIdentidade(
      claims({ email: ' Bia@Estudantes.Servidores.Teste ', hd: 'estudantes.servidores.teste' }),
      DOMINIOS,
    );
    assert.equal(r.tipo, 'ESTUDANTE');
    assert.equal(r.email, 'bia@estudantes.servidores.teste');
  });

  test('CA-001.1: domínio fora da lista é recusado', () => {
    assert.equal(codigo(() => classificarIdentidade(claims({ email: 'x@gmail.com', hd: 'gmail.com' }), DOMINIOS)), 'DOMINIO_NAO_PERMITIDO');
  });

  test('CA-001.2: domínio parecido ou subdomínio não cadastrado é recusado', () => {
    for (const d of ['servidores.teste.exemplo.com', 'xservidores.teste', 'sub.servidores.teste']) {
      assert.equal(codigo(() => classificarIdentidade(claims({ email: `a@${d}`, hd: d }), DOMINIOS)), 'DOMINIO_NAO_PERMITIDO', d);
    }
  });

  test('CA-001.2: e-mail permitido com Workspace (hd) ausente ou diferente é recusado', () => {
    assert.equal(codigo(() => classificarIdentidade(claims({ hd: undefined }), DOMINIOS)), 'DOMINIO_NAO_PERMITIDO');
    assert.equal(codigo(() => classificarIdentidade(claims({ hd: 'gmail.com' }), DOMINIOS)), 'DOMINIO_NAO_PERMITIDO');
  });

  test('CA-001.3: e-mail não verificado é recusado (inclusive valor não booleano)', () => {
    assert.equal(codigo(() => classificarIdentidade(claims({ email_verified: false }), DOMINIOS)), 'EMAIL_NAO_VERIFICADO');
    assert.equal(codigo(() => classificarIdentidade(claims({ email_verified: 'true' }), DOMINIOS)), 'EMAIL_NAO_VERIFICADO');
  });

  test('domínio desativado é recusado', () => {
    assert.equal(codigo(() => classificarIdentidade(claims({ email: 'a@antigo.teste', hd: 'antigo.teste' }), DOMINIOS)), 'DOMINIO_NAO_PERMITIDO');
  });

  test('identidade sem sub, sem e-mail ou com e-mail malformado é recusada', () => {
    assert.equal(codigo(() => classificarIdentidade(claims({ sub: '' }), DOMINIOS)), 'IDENTIDADE_INVALIDA');
    assert.equal(codigo(() => classificarIdentidade(claims({ email: undefined }), DOMINIOS)), 'IDENTIDADE_INVALIDA');
    assert.equal(codigo(() => classificarIdentidade(claims({ email: 'a@b@servidores.teste' }), DOMINIOS)), 'IDENTIDADE_INVALIDA');
    assert.equal(codigo(() => classificarIdentidade(claims({ email: '@servidores.teste' }), DOMINIOS)), 'IDENTIDADE_INVALIDA');
  });

  test('sem nome no provedor, usa o e-mail como nome', () => {
    assert.equal(classificarIdentidade(claims({ name: '  ' }), DOMINIOS).nome, 'ana@servidores.teste');
  });
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const at = (papel, campus_id = null, revogada_em = null) => ({ papel, campus_id, revogada_em });

describe('escopoDoUsuario (base do RLS)', () => {
  test('servidor sem atribuições não tem campus nem escopo institucional (CA-002.2)', () => {
    assert.deepEqual(escopoDoUsuario('u', []), { usuarioId: 'u', campi: [], escopoInstitucional: false, adminInstitucional: false });
  });

  test('campi vêm só das atribuições vigentes; revogadas são ignoradas', () => {
    const e = escopoDoUsuario('u', [at('CONSULTA', A), at('OPERADOR', A), at('CONSULTA', B, '2026-01-01')]);
    assert.deepEqual(e.campi, [A]);
  });

  test('Consulta institucional lê tudo, mas não é administrador', () => {
    const e = escopoDoUsuario('u', [at('CONSULTA')]);
    assert.equal(e.escopoInstitucional, true);
    assert.equal(e.adminInstitucional, false);
  });

  test('administrador institucional tem escopo e administração institucionais', () => {
    const e = escopoDoUsuario('u', [at('ADMIN_INSTITUCIONAL')]);
    assert.equal(e.escopoInstitucional, true);
    assert.equal(e.adminInstitucional, true);
  });
});

describe('podeDecidirSolicitacao (RF-003)', () => {
  test('admin do campus decide no próprio campus e não no outro (CA-003.3)', () => {
    assert.equal(podeDecidirSolicitacao([at('ADMIN_CAMPUS', A)], A), true);
    assert.equal(podeDecidirSolicitacao([at('ADMIN_CAMPUS', A)], B), false);
  });

  test('admin institucional decide em qualquer campus', () => {
    assert.equal(podeDecidirSolicitacao([at('ADMIN_INSTITUCIONAL')], B), true);
  });

  test('Operador, Consulta e admin revogado não decidem', () => {
    assert.equal(podeDecidirSolicitacao([at('OPERADOR', A), at('CONSULTA', A)], A), false);
    assert.equal(podeDecidirSolicitacao([at('CONSULTA')], A), false);
    assert.equal(podeDecidirSolicitacao([at('ADMIN_CAMPUS', A, '2026-01-01')], A), false);
  });
});

describe('podeConcederPapel (matriz AGENTS.md 6.2)', () => {
  const adminA = [at('ADMIN_CAMPUS', A)];
  const inst = [at('ADMIN_INSTITUCIONAL')];

  test('admin do campus concede Operador e Consulta só no próprio campus', () => {
    assert.equal(podeConcederPapel(adminA, 'OPERADOR', A), true);
    assert.equal(podeConcederPapel(adminA, 'CONSULTA', A), true);
    assert.equal(podeConcederPapel(adminA, 'OPERADOR', B), false);
  });

  test('admin do campus não concede papéis institucionais nem outro admin de campus', () => {
    assert.equal(podeConcederPapel(adminA, 'ADMIN_CAMPUS', A), false);
    assert.equal(podeConcederPapel(adminA, 'ADMIN_INSTITUCIONAL', null), false);
    assert.equal(podeConcederPapel(adminA, 'CONSULTA', null), false);
  });

  test('admin institucional concede qualquer papel válido', () => {
    assert.equal(podeConcederPapel(inst, 'ADMIN_CAMPUS', B), true);
    assert.equal(podeConcederPapel(inst, 'ADMIN_INSTITUCIONAL', null), true);
    assert.equal(podeConcederPapel(inst, 'CONSULTA', null), true);
  });

  test('Operador e Consulta não concedem nada', () => {
    assert.equal(podeConcederPapel([at('OPERADOR', A)], 'CONSULTA', A), false);
    assert.equal(podeConcederPapel([at('CONSULTA')], 'CONSULTA', A), false);
  });
});

describe('validarPapelEscopo', () => {
  test('combinações inválidas de papel e campus são recusadas', () => {
    assert.throws(() => validarPapelEscopo('ADMIN_INSTITUCIONAL', A), /não tem campus/);
    assert.throws(() => validarPapelEscopo('ADMIN_CAMPUS', null), /exige um campus/);
    assert.throws(() => validarPapelEscopo('OPERADOR', null), /exige um campus/);
    assert.throws(() => validarPapelEscopo('SUPERUSUARIO', A), /Papel inválido/);
  });

  test('Consulta aceita campus ou escopo institucional', () => {
    assert.doesNotThrow(() => validarPapelEscopo('CONSULTA', A));
    assert.doesNotThrow(() => validarPapelEscopo('CONSULTA', null));
  });
});
