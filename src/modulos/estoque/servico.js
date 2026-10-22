// Casos de uso do estoque do campus (RF-025 a RF-028). Cada campus tem o próprio estoque (C14, RN-62).
// Consultar: qualquer papel vigente no campus ou escopo institucional; fora disso, 404 (CA-027.2).
// Movimentar (entrada, baixa, ajuste): Administração do campus ou institucional; quem só consulta recebe 403.
// Reforço no banco: RLS, livro-razão sem UPDATE/DELETE e saldo nunca negativo (migração 008).
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroConflito, ErroNaoEncontrado, ErroProibido } from '../../infra/erros.js';
import { escopoDoContexto, temAcessoAoCampus, administraCampus } from '../acesso/servico.js';
import { buscarCampusComConfiguracao } from '../campi/repositorio.js';
import { buscarTitulo, buscarTitulos } from '../catalogo/repositorio.js';
import { validarMovimentacao, exigirSaldoSuficiente } from './dominio.js';
import * as repo from './repositorio.js';

export const POR_PAGINA = 25;
export const MOVIMENTACOES_POR_PAGINA = 50;

export const podeConsultar = (ctx, campusId) => temAcessoAoCampus(ctx, campusId);
export const podeMovimentar = (ctx, campusId) => administraCampus(ctx, campusId);

const idValido = (id) => z.uuid().safeParse(id).success;
const paginaDe = (pagina) => Math.max(1, Number.parseInt(pagina, 10) || 1);
const termoDe = (termo) => String(termo ?? '').trim().slice(0, 100);
const paginacao = (total, porPagina) => Math.max(1, Math.ceil(total / porPagina));

// O campus vem da URL só como intenção: sem acesso a ele, a resposta é 404 (não revela se existe).
async function carregarCampus(db, ctx, campusId) {
  if (!idValido(campusId) || !podeConsultar(ctx, campusId)) throw new ErroNaoEncontrado();
  const campus = await buscarCampusComConfiguracao(db, campusId);
  if (!campus) throw new ErroNaoEncontrado();
  return campus;
}

async function carregarTitulo(db, tituloId) {
  if (!idValido(tituloId)) throw new ErroNaoEncontrado();
  const t = await buscarTitulo(db, tituloId);
  if (!t) throw new ErroNaoEncontrado();
  return t;
}

// RF-027: estoque do campus por título.
export async function listarEstoque(executor, ctx, campusId, { termo = '', pagina = 1 } = {}) {
  const p = paginaDe(pagina);
  const busca = termoDe(termo);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    const r = await repo.listarEstoque(db, campusId, { termo: busca, limite: POR_PAGINA, deslocamento: (p - 1) * POR_PAGINA });
    return { campus, ...r, termo: busca, pagina: p, paginas: paginacao(r.total, POR_PAGINA), podeMovimentar: podeMovimentar(ctx, campusId) };
  });
}

// Busca no catálogo para escolher o título de uma entrada (inclui títulos ainda sem estoque no campus).
export async function buscarTitulosParaEntrada(executor, ctx, campusId, { termo = '' } = {}) {
  const busca = termoDe(termo);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    if (!podeMovimentar(ctx, campusId)) throw new ErroProibido();
    const r = busca ? await buscarTitulos(db, { termo: busca, limite: POR_PAGINA, deslocamento: 0 }) : { titulos: [], total: 0 };
    return { campus, ...r, termo: busca };
  });
}

// RF-027 e RF-028 de um título: saldo e histórico de movimentações no campus.
export async function obterTituloNoEstoque(executor, ctx, campusId, tituloId, { pagina = 1 } = {}) {
  const p = paginaDe(pagina);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    const titulo = await carregarTitulo(db, tituloId);
    const saldo = await repo.buscarSaldo(db, campusId, tituloId);
    const h = await repo.listarMovimentacoes(db, campusId, {
      tituloId, limite: MOVIMENTACOES_POR_PAGINA, deslocamento: (p - 1) * MOVIMENTACOES_POR_PAGINA,
    });
    return {
      campus, titulo, saldo, ...h, pagina: p, paginas: paginacao(h.total, MOVIMENTACOES_POR_PAGINA),
      podeMovimentar: podeMovimentar(ctx, campusId),
    };
  });
}

// RF-028: histórico de todas as movimentações do campus.
export async function listarMovimentacoesDoCampus(executor, ctx, campusId, { pagina = 1 } = {}) {
  const p = paginaDe(pagina);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    const h = await repo.listarMovimentacoes(db, campusId, {
      limite: MOVIMENTACOES_POR_PAGINA, deslocamento: (p - 1) * MOVIMENTACOES_POR_PAGINA,
    });
    return { campus, ...h, pagina: p, paginas: paginacao(h.total, MOVIMENTACOES_POR_PAGINA) };
  });
}

// Dados para a tela de uma movimentação (formulário).
export async function prepararMovimentacao(executor, ctx, campusId, tituloId) {
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    if (!podeMovimentar(ctx, campusId)) throw new ErroProibido();
    const titulo = await carregarTitulo(db, tituloId);
    return { campus, titulo, saldo: await repo.buscarSaldo(db, campusId, tituloId) };
  });
}

const saldoNegativoNoBanco = (err) => err?.code === '23514' && err.constraint === 'ck_estoque_nao_negativo';

// RF-025 (entrada) e RF-026 (baixa e ajuste).
export async function registrarMovimentacao(executor, ctx, campusId, tituloId, tipo, entrada) {
  try {
    return await comContexto(executor, escopoDoContexto(ctx), async (db) => {
      const campus = await carregarCampus(db, ctx, campusId);
      if (!podeMovimentar(ctx, campusId)) throw new ErroProibido();
      if (!campus.ativo) throw new ErroConflito('Campus desativado: o estoque não pode ser movimentado.', 'CAMPUS_INATIVO');
      const titulo = await carregarTitulo(db, tituloId);
      const d = validarMovimentacao(tipo, entrada);
      exigirSaldoSuficiente((await repo.buscarSaldo(db, campusId, tituloId)).disponivel, d.quantidade);
      const m = await repo.inserirMovimentacao(db, { campusId, tituloId: titulo.id, ...d, usuarioId: ctx.usuario.id });
      await registrarAuditoria(db, {
        usuarioId: ctx.usuario.id, campusId, acao: `estoque.${tipo.toLowerCase()}`, entidade: 'movimentacao_estoque',
        entidadeId: m.id, depois: { tituloId, quantidade: d.quantidade, origem: d.origem, justificativa: d.justificativa },
      });
      return { id: m.id, ...d, saldo: await repo.buscarSaldo(db, campusId, tituloId) };
    });
  } catch (err) {
    // Corrida: outra operação retirou exemplares entre a verificação e a gravação (o banco recusa).
    if (saldoNegativoNoBanco(err)) throw new ErroConflito('Saldo insuficiente: o estoque mudou durante a operação. Confira o saldo e tente de novo.', 'ESTOQUE_INSUFICIENTE');
    throw err;
  }
}

// CA-027.1: saldo de cada título igual à soma do livro-razão (verificação de consistência, R-09).
export async function verificarConsistencia(executor, ctx, campusId) {
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    await carregarCampus(db, ctx, campusId);
    return repo.listarDivergencias(db, campusId);
  });
}
