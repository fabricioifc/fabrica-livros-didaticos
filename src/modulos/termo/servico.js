// Casos de uso do termo de compromisso (RF-080). Termo único para todos os campi (RN-29, C9).
// Consultar: servidores com acesso. Publicar nova versão: só administração institucional.
// As entregas (RF-040) usam termoVigente() ao serem preparadas (RN-23).
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroNaoEncontrado, ErroProibido, ErroValidacao } from '../../infra/erros.js';
import { escopoDoContexto, temAcessoDeServidor, ehAdministradorInstitucional } from '../acesso/servico.js';
import { validarTexto } from './dominio.js';
import * as repo from './repositorio.js';

export const podeConsultar = (ctx) => temAcessoDeServidor(ctx);
export const podePublicar = (ctx) => ehAdministradorInstitucional(ctx);

function exigir(permitido) {
  if (!permitido) throw new ErroProibido();
}

export async function listarVersoes(executor, ctx) {
  exigir(podeConsultar(ctx));
  return comContexto(executor, escopoDoContexto(ctx), async (db) => ({
    versoes: await repo.listarVersoes(db), vigente: await repo.buscarVigente(db),
  }));
}

export async function obterVersao(executor, ctx, id) {
  exigir(podeConsultar(ctx));
  if (!z.uuid().safeParse(id).success) throw new ErroNaoEncontrado();
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const versao = await repo.buscarVersao(db, id);
    if (!versao) throw new ErroNaoEncontrado();
    const vigente = await repo.buscarVigente(db);
    return { versao, vigente: vigente?.id === versao.id };
  });
}

export async function prepararPublicacao(executor, ctx) {
  exigir(podePublicar(ctx));
  return comContexto(executor, escopoDoContexto(ctx), async (db) => ({ vigente: await repo.buscarVigente(db) }));
}

// CA-080.1: a nova versão vale a partir da publicação; termos já assinados guardam a versão que usaram.
export async function publicarVersao(executor, ctx, { texto, confirmacao }) {
  exigir(podePublicar(ctx));
  const t = validarTexto(texto);
  if (confirmacao !== 'sim') {
    throw new ErroValidacao('Corrija os campos indicados.', { confirmacao: 'Confirme que a nova versão vale para todos os campi.' });
  }
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const atual = await repo.buscarVigente(db);
    if (atual?.texto === t) throw new ErroValidacao('Corrija os campos indicados.', { texto: 'O texto é igual ao da versão vigente.' });
    const nova = await repo.inserirVersao(db, { texto: t, publicadoPor: ctx.usuario.id });
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, acao: 'termo.versao_publicada', entidade: 'termo_modelo', entidadeId: nova.id, depois: { versao: nova.versao },
    });
    return nova;
  });
}

// Para os demais módulos (entrega): versão vigente dentro de uma transação já aberta.
export const termoVigente = (db) => repo.buscarVigente(db);
