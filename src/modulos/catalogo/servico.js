// Casos de uso do catálogo de títulos (RF-020). Catálogo global, compartilhado entre campi (CA-020.3).
// Consultar: servidores com acesso. Criar: Administração de campus ou institucional.
// Editar: só institucional (RN-75, proposta pendente de DP-05 — ver podeEditar).
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroNaoEncontrado, ErroProibido, ErroValidacao } from '../../infra/erros.js';
import { escopoDoContexto, temAcessoDeServidor, administraAlgumCampus, ehAdministradorInstitucional } from '../acesso/servico.js';
import { validarTitulo } from './dominio.js';
import * as repo from './repositorio.js';

export const POR_PAGINA = 25;

// Ponto único das permissões do catálogo (trocar aqui se DP-05 decidir diferente).
export const podeConsultar = (ctx) => temAcessoDeServidor(ctx);
export const podeCriar = (ctx) => administraAlgumCampus(ctx);
export const podeEditar = (ctx) => ehAdministradorInstitucional(ctx);

function exigir(permitido) {
  if (!permitido) throw new ErroProibido();
}

// CA-020.1: ISBN repetido não cria outro título; aponta o existente.
async function exigirIsbnLivre(db, isbn, exceto = null) {
  if (!isbn) return;
  const existente = await repo.buscarPorIsbn(db, isbn);
  if (existente && existente.id !== exceto) {
    throw new ErroValidacao('Corrija os campos indicados.', {
      isbn: `Este ISBN já está no catálogo: "${existente.titulo}". Use o título existente.`,
      existenteId: existente.id,
    });
  }
}

const isbnDuplicadoNoBanco = (err) => err?.code === '23505' && err.constraint === 'ux_titulo_isbn';

export async function listarCatalogo(executor, ctx, { termo = '', pagina = 1 } = {}) {
  exigir(podeConsultar(ctx));
  const p = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const busca = String(termo).trim().slice(0, 100);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const r = await repo.buscarTitulos(db, { termo: busca, limite: POR_PAGINA, deslocamento: (p - 1) * POR_PAGINA });
    return { ...r, termo: busca, pagina: p, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)) };
  });
}

export async function obterTitulo(executor, ctx, id) {
  exigir(podeConsultar(ctx));
  if (!z.uuid().safeParse(id).success) throw new ErroNaoEncontrado();
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const t = await repo.buscarTitulo(db, id);
    if (!t) throw new ErroNaoEncontrado();
    return t;
  });
}

export async function criarTitulo(executor, ctx, entrada) {
  exigir(podeCriar(ctx));
  const d = validarTitulo(entrada);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    await exigirIsbnLivre(db, d.isbn);
    const componenteId = await repo.obterOuCriarComponente(db, d.componente);
    let id;
    try {
      id = await repo.inserirTitulo(db, d, componenteId, ctx.usuario.id);
    } catch (err) {
      // Corrida: outro cadastro com o mesmo ISBN entre a verificação e a gravação.
      if (isbnDuplicadoNoBanco(err)) throw new ErroValidacao('Corrija os campos indicados.', { isbn: 'Este ISBN já está no catálogo.' });
      throw err;
    }
    await registrarAuditoria(db, { usuarioId: ctx.usuario.id, acao: 'catalogo.titulo_criado', entidade: 'titulo', entidadeId: id, depois: d });
    return repo.buscarTitulo(db, id);
  });
}

export async function editarTitulo(executor, ctx, id, entrada) {
  exigir(podeEditar(ctx));
  if (!z.uuid().safeParse(id).success) throw new ErroNaoEncontrado();
  const d = validarTitulo(entrada);
  return comContexto(executor, escopoDoContexto(ctx), async (db) => {
    const antes = await repo.buscarTitulo(db, id);
    if (!antes) throw new ErroNaoEncontrado();
    await exigirIsbnLivre(db, d.isbn, id);
    const componenteId = await repo.obterOuCriarComponente(db, d.componente);
    await repo.atualizarTitulo(db, id, d, componenteId);
    await registrarAuditoria(db, { usuarioId: ctx.usuario.id, acao: 'catalogo.titulo_atualizado', entidade: 'titulo', entidadeId: id, antes, depois: d });
    return repo.buscarTitulo(db, id);
  });
}
