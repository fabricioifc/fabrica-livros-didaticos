// Casos de uso de estudantes e vínculos (RF-030 a RF-033).
// Consultar: qualquer papel vigente no campus ou escopo institucional; fora disso, 404 (CA-032.1).
// Cadastrar, importar, editar e encerrar vínculo: Administração do campus ou institucional (403 para quem só consulta).
// Reforço no banco: RLS de estudante e vínculo, um vínculo ativo por estudante no IFC (migração 009).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { comContexto } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroConflito, ErroNaoEncontrado, ErroProibido, ErroValidacao } from '../../infra/erros.js';
import { escopoDoContexto, temAcessoAoCampus, administraCampus } from '../acesso/servico.js';
import { buscarCampusComConfiguracao } from '../campi/repositorio.js';
import * as dominio from './dominio.js';
import * as repo from './repositorio.js';

export const POR_PAGINA = 25;

export const podeConsultar = (ctx, campusId) => temAcessoAoCampus(ctx, campusId);
export const podeGerir = (ctx, campusId) => administraCampus(ctx, campusId);

const idValido = (id) => z.uuid().safeParse(id).success;

async function carregarCampus(db, ctx, campusId) {
  if (!idValido(campusId) || !podeConsultar(ctx, campusId)) throw new ErroNaoEncontrado();
  const campus = await buscarCampusComConfiguracao(db, campusId);
  if (!campus) throw new ErroNaoEncontrado();
  return campus;
}

async function carregarCampusParaGestao(db, ctx, campusId) {
  const campus = await carregarCampus(db, ctx, campusId);
  if (!podeGerir(ctx, campusId)) throw new ErroProibido();
  if (!campus.ativo) throw new ErroConflito('Campus desativado: o cadastro de estudantes está bloqueado.', 'CAMPUS_INATIVO');
  return campus;
}

const auditar = (db, ctx, campusId, acao, entidade, entidadeId, depois = null) =>
  registrarAuditoria(db, { usuarioId: ctx.usuario.id, campusId, acao, entidade, entidadeId, depois });

// Violação de unicidade por cadastro simultâneo (a conferência prévia não viu): pede para repetir.
function traduzirErroDoBanco(err) {
  if (err?.code === '23505' && ['ux_vinculo_ativo', 'estudante_matricula_key', 'estudante_email_institucional_key'].includes(err.constraint)) {
    return new ErroConflito('Outro cadastro do mesmo estudante foi feito ao mesmo tempo. Confira e tente de novo.', 'CADASTRO_SIMULTANEO');
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

// Curso ativo e ano letivo do campus, para o formulário e para resolver os nomes da planilha.
async function ofertaDoCampus(db, campusId) {
  const [cursos, anos] = await Promise.all([repo.listarCursosAtivos(db, campusId), repo.listarAnosLetivos(db, campusId)]);
  return { cursos, anos };
}

// Núcleo comum ao cadastro manual, à edição e à importação (RN-06, RN-08, RN-11).
// `linhas`: [{ linha, matricula, nome, email, cursoId, periodoId, serie }] já validadas.
// conferirCadastros não grava nada: devolve os erros por linha e marca o estudante existente de cada linha.
async function conferirCadastros(db, campusId, linhas) {
  const erros = [];
  const erro = (l, campo, mensagem) => erros.push({ linha: l.linha, campo, mensagem });

  // Repetições dentro do próprio arquivo.
  const vistas = { matricula: new Map(), email: new Map() };
  for (const l of linhas) {
    for (const campo of ['matricula', 'email']) {
      const anterior = vistas[campo].get(l[campo]);
      if (anterior) erro(l, campo, `${campo === 'matricula' ? 'Matrícula' : 'E-mail'} repetido (já aparece na linha ${anterior}).`);
      else vistas[campo].set(l[campo], l.linha);
    }
  }

  // Unicidade em todo o IFC, sem expor dados de outros campi.
  const existentes = await repo.estudantesPorChave(db, campusId, linhas.map((l) => l.matricula), linhas.map((l) => l.email));
  const porMatricula = new Map(existentes.filter((e) => e.matricula).map((e) => [e.matricula, e]));
  const porEmail = new Map(existentes.filter((e) => e.email).map((e) => [e.email, e]));
  for (const l of linhas) {
    const pelaMatricula = porMatricula.get(l.matricula);
    const peloEmail = porEmail.get(l.email);
    if (peloEmail && peloEmail.estudante_id !== pelaMatricula?.estudante_id) {
      erro(l, 'email', 'Este e-mail já está cadastrado para outra matrícula.');
    }
    if (pelaMatricula?.vinculo_ativo === 'OUTRO') {
      erro(l, 'matricula', 'Estudante com vínculo ativo em outro campus. O vínculo de lá precisa ser encerrado antes (transferência ainda não disponível).');
    }
    if (pelaMatricula && !peloEmail && pelaMatricula.conta_ligada) {
      erro(l, 'email', 'O e-mail não pode ser trocado: o estudante já entrou no sistema com o e-mail cadastrado.');
    }
    l.existente = pelaMatricula ?? null;
  }
  return erros;
}

// Grava linhas já conferidas (sem erros).
async function gravarCadastros(db, ctx, campusId, linhas) {
  const resumo = { novos: 0, novosVinculos: 0, atualizados: 0, semAlteracao: 0 };
  for (const l of linhas) {
    const dadosVinculo = { cursoId: l.cursoId, periodoId: l.periodoId, serie: l.serie };
    if (!l.existente) {
      const id = randomUUID();
      await repo.inserirEstudante(db, { id, matricula: l.matricula, nome: l.nome, email: l.email });
      const vinculoId = await repo.inserirVinculo(db, { campusId, estudanteId: id, ...dadosVinculo, criadoPor: ctx.usuario.id });
      await auditar(db, ctx, campusId, 'estudantes.estudante_criado', 'estudante', id);
      await auditar(db, ctx, campusId, 'estudantes.vinculo_criado', 'vinculo_estudante', vinculoId, dadosVinculo);
      resumo.novos++;
      l.estudanteId = id;
      continue;
    }
    const estudanteId = l.existente.estudante_id;
    l.estudanteId = estudanteId;
    let mudou = false;
    const ativo = await repo.buscarVinculoAtivo(db, campusId, estudanteId);
    if (!ativo) {
      const vinculoId = await repo.inserirVinculo(db, { campusId, estudanteId, ...dadosVinculo, criadoPor: ctx.usuario.id });
      await auditar(db, ctx, campusId, 'estudantes.vinculo_criado', 'vinculo_estudante', vinculoId, dadosVinculo);
      resumo.novosVinculos++;
    } else if (ativo.curso_id !== l.cursoId || ativo.periodo_letivo_id !== l.periodoId || ativo.serie !== l.serie) {
      // RN-09: mudança de curso, série ou ano letivo atualiza o vínculo; entregas guardam os dados da época.
      await repo.atualizarVinculo(db, ativo.id, dadosVinculo);
      await auditar(db, ctx, campusId, 'estudantes.vinculo_atualizado', 'vinculo_estudante', ativo.id, dadosVinculo);
      mudou = true;
    }
    // Agora o vínculo ativo é deste campus: o cadastro global pode ser atualizado (RLS).
    const atual = await repo.buscarEstudante(db, estudanteId);
    const campos = ['nome', 'email'].filter((c) => atual[c] !== l[c]);
    if (campos.length) {
      await repo.atualizarEstudante(db, estudanteId, { nome: l.nome, email: l.email });
      await auditar(db, ctx, campusId, 'estudantes.estudante_atualizado', 'estudante', estudanteId, { campos });
      mudou = true;
    }
    if (ativo) resumo[mudou ? 'atualizados' : 'semAlteracao']++;
  }
  return resumo;
}

// Confere tudo e só grava se não houver nenhum erro.
async function aplicarCadastros(db, ctx, campusId, linhas) {
  const erros = await conferirCadastros(db, campusId, linhas);
  if (erros.length) return { erros, resumo: null };
  return { erros: [], resumo: await gravarCadastros(db, ctx, campusId, linhas) };
}

// Erros de linha única (cadastro manual/edição) viram erros por campo do formulário.
function exigirSemErros({ erros }) {
  if (!erros.length) return;
  throw new ErroValidacao('Corrija os campos indicados.', Object.fromEntries(erros.map((e) => [e.campo, e.mensagem])));
}

// Resolve curso e ano letivo escolhidos no formulário (ids) contra a oferta do campus.
function resolverFormulario(entrada, oferta, dominiosEstudante) {
  const curso = oferta.cursos.find((c) => c.id === entrada.cursoId);
  const ano = oferta.anos.find((a) => a.id === entrada.periodoId);
  const r = dominio.validarDadosEstudante({
    matricula: entrada.matricula, nome: entrada.nome, email: entrada.email,
    cursoId: curso?.id ?? null, periodoId: ano?.id ?? null, serie: dominio.lerSerie(entrada.serie),
  }, { dominiosEstudante });
  if (r.erros) throw new ErroValidacao('Corrija os campos indicados.', r.erros);
  return { linha: 1, ...r.dados };
}

// ===== Consulta (RF-032) =====

export async function listarEstudantes(executor, ctx, campusId, { termo = '', cursoId = '', serie = '', situacao = 'ATIVO', pagina = 1 } = {}) {
  const p = Math.max(1, Number.parseInt(pagina, 10) || 1);
  const filtros = {
    termo: String(termo).trim().slice(0, 100),
    cursoId: idValido(cursoId) ? cursoId : null,
    serie: dominio.lerSerie(serie),
    situacao: ['ATIVO', 'ENCERRADO'].includes(situacao) ? situacao : null,
  };
  return emContexto(executor, ctx, async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    const r = await repo.listarEstudantes(db, campusId, { ...filtros, limite: POR_PAGINA, deslocamento: (p - 1) * POR_PAGINA });
    return {
      campus, ...r, filtros, pagina: p, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)),
      cursos: await repo.listarCursosAtivos(db, campusId), podeGerir: podeGerir(ctx, campusId),
    };
  });
}

// Ficha: dados do estudante e seus vínculos NESTE campus (atuais e encerrados, RN-10 / CA-032.2).
export async function obterEstudante(executor, ctx, campusId, estudanteId) {
  return emContexto(executor, ctx, async (db) => {
    const campus = await carregarCampus(db, ctx, campusId);
    if (!idValido(estudanteId)) throw new ErroNaoEncontrado();
    const vinculos = await repo.listarVinculosNoCampus(db, campusId, estudanteId);
    if (!vinculos.length) throw new ErroNaoEncontrado();
    const estudante = await repo.buscarEstudante(db, estudanteId);
    if (!estudante) throw new ErroNaoEncontrado();
    return { campus, estudante, vinculos, ativo: vinculos.find((v) => v.situacao === 'ATIVO') ?? null, podeGerir: podeGerir(ctx, campusId) };
  });
}

// ===== Cadastro manual e edição (RF-031) =====

export async function prepararFormulario(executor, ctx, campusId) {
  return emContexto(executor, ctx, async (db) => {
    const campus = await carregarCampusParaGestao(db, ctx, campusId);
    return { campus, ...(await ofertaDoCampus(db, campusId)) };
  });
}

// Matrícula nova: cria estudante e vínculo. Matrícula já existente (sem vínculo ativo em outro campus):
// cria ou atualiza o vínculo deste campus, como na importação.
export async function cadastrarEstudante(executor, ctx, campusId, entrada) {
  return emContexto(executor, ctx, async (db) => {
    await carregarCampusParaGestao(db, ctx, campusId);
    const linha = resolverFormulario(entrada, await ofertaDoCampus(db, campusId), await repo.listarDominiosDeEstudante(db));
    const r = await aplicarCadastros(db, ctx, campusId, [linha]);
    exigirSemErros(r);
    return { estudanteId: linha.estudanteId, resumo: r.resumo };
  });
}

export async function prepararEdicao(executor, ctx, campusId, estudanteId) {
  return emContexto(executor, ctx, async (db) => {
    const campus = await carregarCampusParaGestao(db, ctx, campusId);
    if (!idValido(estudanteId)) throw new ErroNaoEncontrado();
    const ativo = await repo.buscarVinculoAtivo(db, campusId, estudanteId);
    if (!ativo) throw new ErroNaoEncontrado();
    return { campus, estudante: await repo.buscarEstudante(db, estudanteId), ativo, ...(await ofertaDoCampus(db, campusId)) };
  });
}

// Edita nome, e-mail, curso, série e ano letivo de quem tem vínculo ativo neste campus. A matrícula não muda.
export async function editarEstudante(executor, ctx, campusId, estudanteId, entrada) {
  return emContexto(executor, ctx, async (db) => {
    await carregarCampusParaGestao(db, ctx, campusId);
    if (!idValido(estudanteId)) throw new ErroNaoEncontrado();
    if (!(await repo.buscarVinculoAtivo(db, campusId, estudanteId))) throw new ErroNaoEncontrado();
    const estudante = await repo.buscarEstudante(db, estudanteId);
    const linha = resolverFormulario({ ...entrada, matricula: estudante.matricula }, await ofertaDoCampus(db, campusId), await repo.listarDominiosDeEstudante(db));
    exigirSemErros(await aplicarCadastros(db, ctx, campusId, [linha]));
    return { estudanteId };
  });
}

// ===== Importação por planilha (RF-030) =====

// Tudo ou nada (RN-11, CA-030.1): devolve { erros } (nada gravado) ou { resumo }.
export async function importarPlanilha(executor, ctx, campusId, arquivo) {
  return emContexto(executor, ctx, async (db) => {
    await carregarCampusParaGestao(db, ctx, campusId);
    if (!arquivo?.conteudo?.length) throw new ErroValidacao('Escolha o arquivo da planilha (CSV).', { arquivo: 'Escolha o arquivo da planilha (CSV).' });
    if (arquivo.conteudo.length > dominio.LIMITE_BYTES) throw new ErroValidacao('Arquivo maior que 2 MB.', { arquivo: 'Arquivo maior que 2 MB. Divida a planilha.' });

    const [cabecalho, ...dados] = dominio.lerCsv(dominio.decodificarArquivo(arquivo.conteudo));
    if (!cabecalho) throw new ErroValidacao('Arquivo vazio.', { arquivo: 'O arquivo está vazio.' });
    if (!dados.length) throw new ErroValidacao('A planilha não tem estudantes.', { arquivo: 'A planilha só tem o cabeçalho.' });
    if (dados.length > dominio.LIMITE_LINHAS) {
      throw new ErroValidacao('Planilha grande demais.', { arquivo: `No máximo ${dominio.LIMITE_LINHAS} estudantes por arquivo.` });
    }
    const pos = dominio.mapearCabecalho(cabecalho.campos);
    const oferta = await ofertaDoCampus(db, campusId);
    const cursos = new Map(oferta.cursos.map((c) => [dominio.chaveDeCurso(c.nome), c.id]));
    const anos = new Map(oferta.anos.map((a) => [String(a.ano), a.id]));
    const dominiosEstudante = await repo.listarDominiosDeEstudante(db);

    const erros = [];
    const linhas = [];
    for (const { numero, campos } of dados) {
      const valor = (coluna) => String(campos[pos[coluna]] ?? '').trim();
      const r = dominio.validarDadosEstudante({
        matricula: valor('matricula'), nome: valor('nome'), email: valor('email'),
        cursoId: cursos.get(dominio.chaveDeCurso(valor('curso'))) ?? null,
        periodoId: anos.get(valor('ano_letivo')) ?? null,
        serie: dominio.lerSerie(valor('serie')),
      }, { dominiosEstudante });
      if (r.erros) {
        for (const [campo, mensagem] of Object.entries(r.erros)) {
          const detalhe = campo === 'curso' ? `Curso "${valor('curso')}" não encontrado entre os cursos ativos do campus.`
            : campo === 'anoLetivo' ? `Ano letivo "${valor('ano_letivo')}" não cadastrado no campus.` : mensagem;
          erros.push({ linha: numero, campo, mensagem: detalhe });
        }
      } else linhas.push({ linha: numero, ...r.dados });
    }
    // Repetições e conflitos com o cadastro do IFC também entram na lista, para corrigir tudo de uma vez.
    erros.push(...(await conferirCadastros(db, campusId, linhas)));
    if (erros.length) return { erros: ordenar(erros), resumo: null };

    const resumo = await gravarCadastros(db, ctx, campusId, linhas);
    await auditar(db, ctx, campusId, 'estudantes.planilha_importada', 'campus', campusId, { linhas: linhas.length, ...resumo });
    return { erros: [], resumo: { linhas: linhas.length, ...resumo } };
  });
}

const ordenar = (erros) => erros.sort((a, b) => a.linha - b.linha);

// ===== Encerramento do vínculo (RF-033) =====

async function carregarVinculoParaGestao(db, ctx, vinculoId) {
  if (!idValido(vinculoId)) throw new ErroNaoEncontrado();
  const v = await repo.buscarVinculo(db, vinculoId);
  if (!v || !podeConsultar(ctx, v.campus_id)) throw new ErroNaoEncontrado();
  if (!podeGerir(ctx, v.campus_id)) throw new ErroProibido();
  return v;
}

export async function prepararEncerramento(executor, ctx, vinculoId) {
  return emContexto(executor, ctx, async (db) => {
    const vinculo = await carregarVinculoParaGestao(db, ctx, vinculoId);
    if (vinculo.situacao !== 'ATIVO') throw new ErroConflito('Este vínculo já está encerrado.', 'VINCULO_ENCERRADO');
    return { vinculo, estudante: await repo.buscarEstudante(db, vinculo.estudante_id), hoje: await repo.dataDeHoje(db) };
  });
}

// CA-033.1: a data de encerramento é gravada no vínculo; ela passa a ser o prazo dos livros em posse (RN-46, RF-061).
export async function encerrarVinculo(executor, ctx, vinculoId, entrada) {
  return emContexto(executor, ctx, async (db) => {
    const v = await carregarVinculoParaGestao(db, ctx, vinculoId);
    if (v.situacao !== 'ATIVO') throw new ErroConflito('Este vínculo já está encerrado.', 'VINCULO_ENCERRADO');
    const d = dominio.validarEncerramento(entrada, { inicio: v.inicio, hoje: await repo.dataDeHoje(db) });
    await repo.encerrarVinculo(db, v.id, { ...d, encerradoPor: ctx.usuario.id });
    await auditar(db, ctx, v.campus_id, 'estudantes.vinculo_encerrado', 'vinculo_estudante', v.id, d);
    return { ...v, ...d };
  });
}
