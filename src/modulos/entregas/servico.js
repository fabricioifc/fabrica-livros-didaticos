// Casos de uso do atendimento: identificar o estudante, preparar e cancelar entregas (RF-040, RF-041, RF-043, RF-046).
// Operar: Operador ou Administração DO campus (a institucional não opera sem atribuição no campus, AGENTS.md 6.1);
// quem só consulta recebe 403 (CA-040.7). Fora do campus: 404. Reforço no banco: RLS, gatilhos e FKs (migração 011).
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroConflito, ErroNaoEncontrado, ErroProibido, ErroValidacao } from '../../infra/erros.js';
import { escopoDoContexto, temAcessoAoCampus, operaCampus } from '../acesso/servico.js';
import { buscarCampusComConfiguracao } from '../campi/repositorio.js';
import { normalizarMatricula } from '../estudantes/dominio.js';
import { termoVigente } from '../termo/servico.js';
import * as dominio from './dominio.js';
import * as repo from './repositorio.js';

export const podeOperar = (ctx, campusId) => operaCampus(ctx, campusId);
export const podeConsultar = (ctx, campusId) => temAcessoAoCampus(ctx, campusId);

const idValido = (id) => z.uuid().safeParse(id).success;

function exigirOperacao(ctx, campusId) {
  if (!podeConsultar(ctx, campusId)) throw new ErroNaoEncontrado();
  if (!podeOperar(ctx, campusId)) throw new ErroProibido();
}

async function carregarCampusAtivo(db, campusId) {
  const campus = await buscarCampusComConfiguracao(db, campusId);
  if (!campus) throw new ErroNaoEncontrado();
  if (!campus.ativo) throw new ErroConflito('Campus desativado: o atendimento está bloqueado.', 'CAMPUS_INATIVO');
  return campus;
}

// Vínculo do atendimento: o campus vem do vínculo no banco, não da URL.
async function carregarVinculo(db, ctx, vinculoId) {
  if (!idValido(vinculoId)) throw new ErroNaoEncontrado();
  const v = await repo.buscarVinculoDoAtendimento(db, vinculoId);
  if (!v) throw new ErroNaoEncontrado();
  exigirOperacao(ctx, v.campus_id);
  return v;
}

const emContexto = (executor, ctx, fn) => comContexto(executor, escopoDoContexto(ctx), fn);

// Tela inicial do atendimento do campus: identificação e entregas aguardando assinatura.
export async function painelDoAtendimento(executor, ctx, campusId) {
  if (!idValido(campusId)) throw new ErroNaoEncontrado();
  exigirOperacao(ctx, campusId);
  return emContexto(executor, ctx, async (db) => ({
    campus: await carregarCampusAtivo(db, campusId), preparadas: await repo.listarPreparadas(db, campusId),
  }));
}

// RF-046: matrícula digitada → vínculo ativo NESTE campus. Mensagem única para "não existe" e
// "sem vínculo ativo aqui", para não revelar estudantes de outros campi (CA-046.2, CA-046.3).
export async function identificarPorMatricula(executor, ctx, campusId, matricula) {
  if (!idValido(campusId)) throw new ErroNaoEncontrado();
  exigirOperacao(ctx, campusId);
  const m = normalizarMatricula(matricula);
  if (!m) throw new ErroValidacao('Corrija os campos indicados.', { matricula: 'Digite a matrícula do estudante.' });
  return emContexto(executor, ctx, async (db) => {
    await carregarCampusAtivo(db, campusId);
    const vinculoId = await repo.buscarVinculoAtivoPorMatricula(db, campusId, m);
    if (!vinculoId) {
      throw new ErroValidacao('Corrija os campos indicados.', { matricula: 'Matrícula não encontrada entre os estudantes com vínculo ativo neste campus.' });
    }
    return { vinculoId, forma: 'MATRICULA_DIGITADA' };
  });
}

// Atendimento do estudante identificado: conferência (CA-046.1) e escolha dos livros, ou a entrega já preparada.
export async function obterAtendimento(executor, ctx, vinculoId) {
  return emContexto(executor, ctx, async (db) => {
    const v = await carregarVinculo(db, ctx, vinculoId);
    if (v.situacao !== 'ATIVO') throw new ErroConflito('O vínculo deste estudante foi encerrado.', 'VINCULO_ENCERRADO');
    const campus = await carregarCampusAtivo(db, v.campus_id);
    const preparada = await repo.buscarPreparadaDoVinculo(db, vinculoId);
    if (preparada) return { campus, vinculo: v, preparada, itens: await repo.listarItens(db, preparada.id) };
    return {
      campus, vinculo: v, preparada: null,
      disponiveis: await repo.listarDisponiveis(db, v.campus_id),
      emPosse: await repo.titulosEmPosse(db, v.campus_id, v.estudante_id),
      termo: await termoVigente(db),
    };
  });
}

// RF-040: prepara a entrega para o estudante identificado neste atendimento (CA-042.8).
// `identificacao` vem da sessão do servidor ({ vinculoId, forma }), nunca do formulário.
export async function prepararEntrega(executor, ctx, vinculoId, { titulos, confirmacao }, identificacao) {
  const selecao = dominio.validarSelecao(titulos);
  try {
    return await emContexto(executor, ctx, async (db) => {
      const v = await carregarVinculo(db, ctx, vinculoId);
      if (identificacao?.vinculoId !== v.id) {
        throw new ErroConflito('Identifique o estudante de novo (matrícula) antes de preparar a entrega.', 'IDENTIFICACAO_NECESSARIA');
      }
      if (v.situacao !== 'ATIVO') throw new ErroConflito('O vínculo deste estudante foi encerrado.', 'VINCULO_ENCERRADO');
      const campus = await carregarCampusAtivo(db, v.campus_id);
      if (await repo.buscarPreparadaDoVinculo(db, v.id)) {
        throw new ErroConflito('Este estudante já tem uma entrega aguardando assinatura. Conclua ou cancele antes.', 'ENTREGA_PREPARADA_EXISTENTE');
      }
      const termo = await termoVigente(db);
      if (!termo) throw new ErroConflito('Nenhuma versão do termo de compromisso foi publicada.', 'SEM_TERMO');
      dominio.exigirSaldo(selecao, await repo.saldosDe(db, v.campus_id, selecao));
      const avisos = dominio.avisosDaSelecao(selecao, await repo.titulosEmPosse(db, v.campus_id, v.estudante_id));
      dominio.exigirConfirmacao(avisos, confirmacao === 'sim');

      const id = await repo.inserirEntrega(db, {
        campusId: v.campus_id, vinculoId: v.id, periodoId: v.periodo_letivo_id, termoId: termo.id,
        formaIdentificacao: identificacao.forma, avisos: avisos.map((a) => ({ ...a, confirmadoPor: ctx.usuario.id })),
        preparadaPor: ctx.usuario.id, snapshotEstudante: dominio.snapshotEstudante(v, v), snapshotUnidade: dominio.snapshotUnidade(campus),
      });
      await repo.inserirItens(db, v.campus_id, id, selecao);
      await registrarAuditoria(db, {
        usuarioId: ctx.usuario.id, campusId: v.campus_id, acao: 'entregas.preparada', entidade: 'entrega', entidadeId: id,
        depois: { titulos: selecao, avisos: avisos.length, termoVersao: termo.versao },
      });
      return { id, campusId: v.campus_id };
    });
  } catch (err) {
    if (err?.code === '23505' && err.constraint === 'ux_entrega_preparada') {
      throw new ErroConflito('Este estudante já tem uma entrega aguardando assinatura. Conclua ou cancele antes.', 'ENTREGA_PREPARADA_EXISTENTE');
    }
    throw err;
  }
}

// Detalhe da entrega: qualquer papel no campus da entrega (ver entregas, AGENTS.md 6.2).
export async function obterEntrega(executor, ctx, entregaId) {
  if (!idValido(entregaId)) throw new ErroNaoEncontrado();
  return emContexto(executor, ctx, async (db) => {
    const entrega = await repo.buscarEntrega(db, entregaId);
    if (!entrega || !podeConsultar(ctx, entrega.campus_id)) throw new ErroNaoEncontrado();
    return { entrega, itens: await repo.listarItens(db, entregaId), podeOperar: podeOperar(ctx, entrega.campus_id) };
  });
}

// RF-043: cancela a entrega preparada (não assinada); o estoque não muda (RN-25).
export async function cancelarEntrega(executor, ctx, entregaId) {
  if (!idValido(entregaId)) throw new ErroNaoEncontrado();
  return emContexto(executor, ctx, async (db) => {
    const entrega = await repo.buscarEntrega(db, entregaId);
    if (!entrega) throw new ErroNaoEncontrado();
    exigirOperacao(ctx, entrega.campus_id);
    if (!(await repo.cancelarEntrega(db, entregaId, ctx.usuario.id))) {
      throw new ErroConflito('Só uma entrega aguardando assinatura pode ser cancelada.', 'ENTREGA_NAO_PREPARADA');
    }
    await registrarAuditoria(db, { usuarioId: ctx.usuario.id, campusId: entrega.campus_id, acao: 'entregas.cancelada', entidade: 'entrega', entidadeId: entregaId });
    return entrega;
  });
}

// Para a ficha do estudante (RF-032): entregas dos vínculos do estudante neste campus.
export const entregasDosVinculos = (db, vinculoIds) => repo.listarEntregasDoVinculo(db, vinculoIds);
