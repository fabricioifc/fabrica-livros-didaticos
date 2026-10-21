// Casos de uso da oferta do campus: anos letivos e cursos (RF-012, simplificado em D-21).
// Quem administra o campus (Administração do campus ou institucional) mantém a oferta;
// fora disso, 404. Reforço no banco: RLS (migrações 005 e 006).
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroNaoEncontrado, ErroValidacao } from '../../infra/erros.js';
import { escopoDoContexto, administraCampus } from '../acesso/servico.js';
import { buscarCampusComConfiguracao } from './repositorio.js';
import { esquemaAnoLetivo, esquemaCurso, validarOferta } from './oferta-dominio.js';
import * as repo from './oferta-repositorio.js';

const idValido = (id) => z.uuid().safeParse(id).success;

function exigirAdministracao(ctx, campusId) {
  if (!idValido(campusId) || !administraCampus(ctx, campusId)) throw new ErroNaoEncontrado();
}

// Converte violações de unicidade do banco em erro no campo do formulário.
function traduzirErroDoBanco(err) {
  const campos = {
    ux_periodo_ano: ['ano', 'Este ano letivo já está cadastrado neste campus.'],
    ux_curso_nome: ['nome', 'Já existe um curso com este nome neste campus.'],
  };
  if (err?.code === '23505' && campos[err.constraint]) {
    const [campo, msg] = campos[err.constraint];
    return new ErroValidacao('Corrija os campos indicados.', { [campo]: msg });
  }
  return err;
}

async function emContexto(executor, ctx, fn) {
  try {
    return await comContexto(executor, escopoDoContexto(ctx), fn);
  } catch (err) {
    throw traduzirErroDoBanco(err);
  }
}

const auditar = (db, ctx, campusId, acao, entidade, entidadeId, antes, depois) =>
  registrarAuditoria(db, { usuarioId: ctx.usuario.id, campusId, acao, entidade, entidadeId, antes, depois });

// Registro existente: o campus vem do banco; fora da administração do usuário, 404.
async function carregar(db, ctx, busca, id) {
  if (!idValido(id)) throw new ErroNaoEncontrado();
  const r = await busca(db, id);
  if (!r || !administraCampus(ctx, r.campus_id)) throw new ErroNaoEncontrado();
  return r;
}

// Tela da oferta do campus.
export async function obterOferta(executor, ctx, campusId) {
  exigirAdministracao(ctx, campusId);
  return emContexto(executor, ctx, async (db) => {
    const campus = await buscarCampusComConfiguracao(db, campusId);
    if (!campus) throw new ErroNaoEncontrado();
    return { campus, anos: await repo.listarAnosLetivos(db, campusId), cursos: await repo.listarCursos(db, campusId) };
  });
}

// ===== Anos letivos =====
export async function criarAnoLetivo(executor, ctx, campusId, entrada) {
  exigirAdministracao(ctx, campusId);
  const d = validarOferta(esquemaAnoLetivo, entrada);
  return emContexto(executor, ctx, async (db) => {
    const a = await repo.inserirAnoLetivo(db, campusId, d);
    await auditar(db, ctx, campusId, 'oferta.ano_letivo_criado', 'periodo_letivo', a.id, null, d);
    return a;
  });
}

export async function obterAnoLetivo(executor, ctx, id) {
  return emContexto(executor, ctx, (db) => carregar(db, ctx, repo.buscarAnoLetivo, id));
}

// CA-012.2: o término é a base do prazo de devolução; alterações ficam auditadas.
export async function salvarAnoLetivo(executor, ctx, id, entrada) {
  const d = validarOferta(esquemaAnoLetivo, entrada);
  return emContexto(executor, ctx, async (db) => {
    const antes = await carregar(db, ctx, repo.buscarAnoLetivo, id);
    await repo.atualizarAnoLetivo(db, id, d);
    await auditar(db, ctx, antes.campus_id, 'oferta.ano_letivo_atualizado', 'periodo_letivo', id, antes, d);
    return { ...antes, ...d };
  });
}

// ===== Cursos =====
export async function criarCurso(executor, ctx, campusId, entrada) {
  exigirAdministracao(ctx, campusId);
  const d = validarOferta(esquemaCurso, entrada);
  return emContexto(executor, ctx, async (db) => {
    const c = await repo.inserirCurso(db, campusId, d);
    await auditar(db, ctx, campusId, 'oferta.curso_criado', 'curso', c.id, null, d);
    return c;
  });
}

export async function obterCurso(executor, ctx, cursoId) {
  return emContexto(executor, ctx, (db) => carregar(db, ctx, repo.buscarCurso, cursoId));
}

export async function salvarCurso(executor, ctx, cursoId, entrada) {
  const d = validarOferta(esquemaCurso, entrada);
  return emContexto(executor, ctx, async (db) => {
    const antes = await carregar(db, ctx, repo.buscarCurso, cursoId);
    await repo.atualizarCurso(db, cursoId, { nome: d.nome });
    await auditar(db, ctx, antes.campus_id, 'oferta.curso_atualizado', 'curso', cursoId, { nome: antes.nome }, d);
    return { ...antes, ...d };
  });
}

// Curso desativado deixa de ser oferecido para novos vínculos; os registros existentes continuam.
export async function alterarSituacaoCurso(executor, ctx, cursoId, ativo) {
  return emContexto(executor, ctx, async (db) => {
    const antes = await carregar(db, ctx, repo.buscarCurso, cursoId);
    await repo.atualizarCurso(db, cursoId, { ativo: Boolean(ativo) });
    await auditar(db, ctx, antes.campus_id, ativo ? 'oferta.curso_ativado' : 'oferta.curso_desativado', 'curso', cursoId);
    return { ...antes, ativo: Boolean(ativo) };
  });
}
