// Casos de uso de campi (RF-010, RF-011). Autorização aqui; reforço no banco (migração 004).
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroNaoEncontrado, ErroProibido, ErroValidacao } from '../../infra/erros.js';
import { escopoDoContexto, ehAdministradorInstitucional, administraCampus } from '../acesso/servico.js';
import { esquemaNovoCampus, esquemaConfiguracao, validarCampus } from './dominio.js';
import * as repo from './repositorio.js';

const idValido = (id) => z.uuid().safeParse(id).success;
const codigoDuplicado = (err) => err?.code === '23505' && /codigo/.test(err.constraint ?? err.detail ?? '');

function exigirInstitucional(ctx) {
  if (!ehAdministradorInstitucional(ctx)) throw new ErroProibido();
}

// Campus fora da administração do usuário (ou inexistente): 404, sem revelar qual dos dois.
function exigirAdministracao(ctx, campusId) {
  if (!idValido(campusId) || !administraCampus(ctx, campusId)) throw new ErroNaoEncontrado();
}

// RF-010: lista de todos os campi (ativos e inativos) para a administração institucional.
export async function listarCampi(executor, ctx) {
  exigirInstitucional(ctx);
  return comContexto(executor, escopoDoContexto(ctx), (db) => repo.listarCampi(db));
}

// RF-010: cria um campus; fica utilizável sem alteração de código (CA-010.1).
export async function criarCampus(executor, ctx, entrada) {
  exigirInstitucional(ctx);
  const d = validarCampus(esquemaNovoCampus, entrada);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    let campus;
    try {
      campus = await repo.inserirCampus(db, d);
    } catch (err) {
      if (codigoDuplicado(err)) throw new ErroValidacao('Corrija os campos indicados.', { codigo: 'Já existe um campus com este código.' });
      throw err;
    }
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId: campus.id, acao: 'campus.criado', entidade: 'campus', entidadeId: campus.id,
      depois: { codigo: campus.codigo, nome_oficial: campus.nome_oficial, nome_curto: campus.nome_curto },
    });
    return campus;
  });
}

// RF-011: dados para a tela de configuração (Administração do campus ou institucional).
export async function obterCampus(executor, ctx, campusId) {
  exigirAdministracao(ctx, campusId);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const campus = await repo.buscarCampusComConfiguracao(db, campusId);
    if (!campus) throw new ErroNaoEncontrado();
    return { campus, podeAlterarCodigo: ehAdministradorInstitucional(ctx) };
  });
}

// RF-011 (CA-011.1, CA-011.2): salva nomes e configuração; código só pela administração institucional.
export async function salvarConfiguracao(executor, ctx, campusId, entrada) {
  exigirAdministracao(ctx, campusId);
  const d = validarCampus(esquemaConfiguracao, entrada);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const antes = await repo.buscarCampusComConfiguracao(db, campusId);
    if (!antes) throw new ErroNaoEncontrado();
    if (d.codigo !== undefined && d.codigo !== antes.codigo && !ehAdministradorInstitucional(ctx)) throw new ErroProibido();
    try {
      await repo.atualizarCampus(db, campusId, d);
    } catch (err) {
      if (codigoDuplicado(err)) throw new ErroValidacao('Corrija os campos indicados.', { codigo: 'Já existe um campus com este código.' });
      throw err;
    }
    await repo.salvarConfiguracao(db, campusId, d);
    const depois = await repo.buscarCampusComConfiguracao(db, campusId);
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId, acao: 'campus.configuracao_atualizada', entidade: 'campus', entidadeId: campusId,
      antes, depois,
    });
    return depois;
  });
}

// RF-010 (CA-010.2): ativa ou desativa; campus inativo some da lista de solicitação de acesso.
export async function alterarSituacao(executor, ctx, campusId, ativo) {
  exigirInstitucional(ctx);
  if (!idValido(campusId)) throw new ErroNaoEncontrado();
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const r = await repo.atualizarSituacao(db, campusId, Boolean(ativo));
    if (!r) throw new ErroNaoEncontrado();
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId, acao: ativo ? 'campus.ativado' : 'campus.desativado', entidade: 'campus', entidadeId: campusId,
    });
    return r;
  });
}
