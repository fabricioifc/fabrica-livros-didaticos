// Casos de uso do módulo de acesso (RF-001 a RF-005). Cada função abre seu contexto de banco;
// a autorização é verificada aqui (papel) e reforçada no banco (escopo de campus via RLS).
import { z } from 'zod';
import { comContexto, escopoSistema } from '../../infra/db/contexto.js';
import { registrarAuditoria } from '../../infra/auditoria.js';
import { ErroConflito, ErroNaoAutenticado, ErroNaoEncontrado, ErroProibido, ErroValidacao } from '../../infra/erros.js';
import * as dominio from './dominio.js';
import * as repo from './repositorio.js';

const uuid = (rotulo) => z.uuid({ error: `${rotulo} inválido.` });

function validar(esquema, valor) {
  const r = esquema.safeParse(valor);
  if (!r.success) throw new ErroValidacao(r.error.issues[0].message, r.error.issues);
  return r.data;
}

const violouUnicidade = (err) => err?.code === '23505';

// Contexto do usuário logado: { usuario, atribuicoes, estudante }. Sempre lido do banco.
// `estudante` só existe para contas ESTUDANTE ligadas a um cadastro (RF-006).
export async function carregarContexto(executor, usuarioId) {
  validar(uuid('Usuário'), usuarioId);
  return comContexto(executor, { usuarioId, campi: [] }, async (db) => {
    const usuario = await repo.buscarUsuario(db, usuarioId);
    if (!usuario?.ativo) throw new ErroNaoAutenticado('Sessão inválida.', 'SESSAO_INVALIDA');
    if (usuario.tipo === 'ESTUDANTE') {
      return { usuario, atribuicoes: [], estudante: await repo.buscarEstudantePorUsuario(db, usuarioId) };
    }
    return { usuario, atribuicoes: await repo.listarAtribuicoesVigentes(db, usuarioId), estudante: null };
  });
}

// RF-006: liga a conta do estudante ao cadastro pelo e-mail institucional (no primeiro login).
// Sem cadastro, devolve null: o estudante entra, mas não vê nenhum dado (CA-006.1).
async function ligarEstudante(db, usuario) {
  const ligado = await repo.buscarEstudantePorUsuario(db, usuario.id);
  if (ligado) return ligado;
  const cadastro = await repo.buscarEstudantePorEmail(db, usuario.email);
  if (!cadastro) return null;
  if (cadastro.usuario_id && cadastro.usuario_id !== usuario.id) {
    // Outra conta já está ligada a este cadastro (ex.: conta do Google recriada): não troca sozinho.
    throw new ErroNaoAutenticado(
      'Seu cadastro está ligado a outra conta. Procure o setor responsável pelos livros do seu campus.',
      'CADASTRO_LIGADO_A_OUTRA_CONTA',
    );
  }
  const estudante = await repo.ligarEstudanteAoUsuario(db, cadastro.id, usuario.id);
  await registrarAuditoria(db, {
    usuarioId: usuario.id, acao: 'acesso.estudante_ligado', entidade: 'estudante', entidadeId: estudante.id,
  });
  return estudante;
}

const escopoDe = (ctx) => dominio.escopoDoUsuario(ctx.usuario.id, ctx.atribuicoes);

// RF-001, RF-005 e RF-006: registra o login de uma identidade do Google já validada pelo provedor.
export async function registrarLogin(executor, claims, { emailsAdminInicial = [] } = {}) {
  return comContexto(executor, escopoSistema(), async (db) => {
    const identidade = dominio.classificarIdentidade(claims, await repo.listarDominios(db));
    let usuario = await repo.buscarUsuarioPorSub(db, identidade.sub);
    if (usuario && !usuario.ativo) {
      throw new ErroNaoAutenticado('Usuário desativado.', 'USUARIO_DESATIVADO');
    }
    if (usuario) {
      usuario = await repo.atualizarLogin(db, usuario.id, identidade);
    } else {
      usuario = await repo.inserirUsuario(db, identidade);
      await registrarAuditoria(db, {
        usuarioId: usuario.id, acao: 'acesso.usuario_criado', entidade: 'usuario', entidadeId: usuario.id,
        depois: { tipo: usuario.tipo },
      });
    }

    // RF-005: o administrador inicial só é criado enquanto não houver nenhum ativo,
    // para que a variável de ambiente não se torne um acesso permanente.
    if (usuario.tipo === 'SERVIDOR' && emailsAdminInicial.includes(usuario.email)) {
      await repo.travarAdminsInstitucionais(db);
      if ((await repo.contarAdminsInstitucionaisAtivos(db)) === 0) {
        const a = await repo.inserirAtribuicaoSeAusente(db, { usuarioId: usuario.id, papel: 'ADMIN_INSTITUCIONAL' });
        await registrarAuditoria(db, {
          usuarioId: usuario.id, acao: 'acesso.admin_inicial', entidade: 'atribuicao', entidadeId: a.id,
          depois: { papel: a.papel },
        });
      }
    }
    if (usuario.tipo === 'ESTUDANTE') {
      return { usuario, atribuicoes: [], estudante: await ligarEstudante(db, usuario) };
    }
    return { usuario, atribuicoes: await repo.listarAtribuicoesVigentes(db, usuario.id), estudante: null };
  });
}

// Dados públicos de apresentação (cabeçalho e rodapé): nome da instituição vindo do banco.
export async function obterInstituicao(executor) {
  return comContexto(executor, { usuarioId: null, campi: [] }, (db) => repo.buscarInstituicao(db));
}

// Tela inicial do servidor: campi disponíveis, situação da solicitação e acessos atuais.
export async function painelDoServidor(executor, ctx) {
  if (ctx.usuario.tipo !== 'SERVIDOR') throw new ErroProibido();
  return comContexto(executor, escopoDe(ctx), async (db) => {
    const campiComAcesso = [...new Set(ctx.atribuicoes.filter((a) => a.campus_id).map((a) => a.campus_id))];
    const nomes = new Map((await repo.listarCampiPorId(db, campiComAcesso)).map((c) => [c.id, c.nome_curto]));
    const acessos = campiComAcesso.map((id) => ({
      campusId: id,
      campus: nomes.get(id),
      papeis: ctx.atribuicoes.filter((a) => a.campus_id === id).map((a) => a.papel),
      podeAprovar: dominio.podeDecidirSolicitacao(ctx.atribuicoes, id),
    }));
    const institucionais = ctx.atribuicoes.filter((a) => !a.campus_id).map((a) => a.papel);
    const campiAtivos = await repo.listarCampiAtivos(db);
    const decide = campiQueDecide(ctx);
    const administra = decide === null || decide.length > 0;
    return {
      acessos,
      institucionais,
      ultimaSolicitacao: await repo.buscarUltimaSolicitacao(db, ctx.usuario.id),
      campiAtivos,
      // Atalhos de administração (RF-003, RF-004).
      pendentes: administra
        ? (await repo.listarPendentesDecidiveis(db, { campi: decide ?? [], todos: decide === null, exceto: ctx.usuario.id })).length
        : null,
      campiAdministrados: decide === null
        ? campiAtivos.map((c) => ({ id: c.id, nome: c.nome_curto }))
        : acessos.filter((a) => a.podeAprovar).map((a) => ({ id: a.campusId, nome: a.campus })),
    };
  });
}

// RF-002: servidor declara seu campus. A solicitação não concede nenhum acesso.
export async function solicitarAcesso(executor, ctx, campusId) {
  validar(uuid('Campus'), campusId);
  if (ctx.usuario.tipo !== 'SERVIDOR') throw new ErroProibido();
  if (dominio.papeisNoCampus(ctx.atribuicoes, campusId).size > 0) {
    throw new ErroConflito('Você já tem acesso a este campus.', 'JA_TEM_ACESSO');
  }
  return comContexto(executor, escopoDe(ctx), async (db) => {
    if (!(await repo.buscarCampusAtivo(db, campusId))) throw new ErroValidacao('Campus inválido.');
    let solicitacao;
    try {
      solicitacao = await repo.inserirSolicitacao(db, { usuarioId: ctx.usuario.id, campusId });
    } catch (err) {
      if (violouUnicidade(err)) throw new ErroConflito('Já existe uma solicitação aguardando confirmação.', 'SOLICITACAO_PENDENTE');
      throw err;
    }
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId, acao: 'acesso.solicitacao_criada', entidade: 'solicitacao_acesso',
      entidadeId: solicitacao.id,
    });
    return solicitacao;
  });
}

// RF-003: lista as solicitações pendentes de um campus para quem pode decidi-las.
export async function listarSolicitacoesPendentes(executor, ctx, campusId) {
  validar(uuid('Campus'), campusId);
  if (!dominio.podeDecidirSolicitacao(ctx.atribuicoes, campusId)) throw new ErroProibido();
  return comContexto(executor, escopoDe(ctx), (db) => repo.listarSolicitacoesPendentes(db, campusId));
}

// Campi em que o usuário decide solicitações (null = todos, para o admin institucional).
function campiQueDecide(ctx) {
  if (dominio.ehAdminInstitucional(ctx.atribuicoes)) return null;
  return [...new Set(ctx.atribuicoes.filter((a) => a.papel === 'ADMIN_CAMPUS' && !a.revogada_em).map((a) => a.campus_id))];
}

// RF-003: todas as solicitações pendentes que o usuário pode decidir.
export async function listarSolicitacoesDecidiveis(executor, ctx) {
  const campi = campiQueDecide(ctx);
  if (campi && campi.length === 0) throw new ErroProibido();
  return comContexto(executor, escopoDe(ctx), (db) =>
    repo.listarPendentesDecidiveis(db, { campi: campi ?? [], todos: campi === null, exceto: ctx.usuario.id }));
}

// RF-003: detalhe de uma solicitação para decisão (fora do escopo: 404).
export async function obterSolicitacaoParaDecisao(executor, ctx, solicitacaoId) {
  validar(uuid('Solicitação'), solicitacaoId);
  return comContexto(executor, escopoDe(ctx), async (db) => {
    const s = await repo.buscarSolicitacaoDetalhada(db, solicitacaoId);
    if (!s || s.usuario_id === ctx.usuario.id) throw new ErroNaoEncontrado();
    if (!dominio.podeDecidirSolicitacao(ctx.atribuicoes, s.campus_id)) throw new ErroProibido();
    return s;
  });
}

// RF-004: equipe do campus (servidores e papéis) para quem administra o campus.
export async function equipeDoCampus(executor, ctx, campusId) {
  validar(uuid('Campus'), campusId);
  if (!dominio.podeDecidirSolicitacao(ctx.atribuicoes, campusId)) throw new ErroNaoEncontrado();
  return comContexto(executor, escopoDe(ctx), async (db) => {
    const campus = await repo.buscarCampus(db, campusId);
    if (!campus) throw new ErroNaoEncontrado();
    return {
      campus,
      membros: await repo.listarEquipe(db, campusId),
      podeConcederOperador: dominio.podeConcederPapel(ctx.atribuicoes, 'OPERADOR', campusId),
      podeConcederAdminCampus: dominio.podeConcederPapel(ctx.atribuicoes, 'ADMIN_CAMPUS', campusId),
    };
  });
}

const esquemaDecisao = z.discriminatedUnion('aprovar', [
  z.object({ solicitacaoId: uuid('Solicitação'), aprovar: z.literal(true), concederOperador: z.boolean().default(false) }),
  z.object({
    solicitacaoId: uuid('Solicitação'),
    aprovar: z.literal(false),
    motivo: z.string({ error: 'Informe o motivo da recusa.' }).trim().min(1, 'Informe o motivo da recusa.'),
  }),
]);

// RF-003 (CA-003.1 a CA-003.3): aprova (Consulta, opcionalmente Operador) ou recusa com motivo.
export async function decidirSolicitacao(executor, ctx, entrada) {
  const d = validar(esquemaDecisao, entrada);
  return comContexto(executor, escopoDe(ctx), async (db) => {
    const s = await repo.buscarSolicitacao(db, d.solicitacaoId);
    if (!s) throw new ErroNaoEncontrado();
    if (s.usuario_id === ctx.usuario.id || !dominio.podeDecidirSolicitacao(ctx.atribuicoes, s.campus_id)) {
      throw new ErroProibido();
    }
    if (s.status !== 'PENDENTE') throw new ErroConflito('Esta solicitação já foi decidida.', 'SOLICITACAO_DECIDIDA');

    const decidida = await repo.registrarDecisao(db, s.id, {
      status: d.aprovar ? 'APROVADA' : 'RECUSADA', decididaPor: ctx.usuario.id, motivo: d.aprovar ? null : d.motivo,
    });
    const concedidas = [];
    if (d.aprovar) {
      const papeis = d.concederOperador ? ['CONSULTA', 'OPERADOR'] : ['CONSULTA'];
      for (const papel of papeis) {
        const a = await repo.inserirAtribuicaoSeAusente(db, {
          usuarioId: s.usuario_id, papel, campusId: s.campus_id, concedidaPor: ctx.usuario.id,
        });
        if (a) concedidas.push(a);
      }
    }
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId: s.campus_id,
      acao: d.aprovar ? 'acesso.solicitacao_aprovada' : 'acesso.solicitacao_recusada',
      entidade: 'solicitacao_acesso', entidadeId: s.id, antes: { status: s.status },
      depois: { status: decidida.status, papeis: concedidas.map((a) => a.papel) },
    });
    return { solicitacao: decidida, atribuicoes: concedidas };
  });
}

const esquemaConcessao = z.object({
  usuarioId: uuid('Usuário'),
  papel: z.enum(dominio.PAPEIS, { error: 'Papel inválido.' }),
  campusId: uuid('Campus').nullable().default(null),
});

// RF-004: concede um papel conforme a matriz de permissões.
export async function concederPapel(executor, ctx, entrada) {
  const e = validar(esquemaConcessao, entrada);
  if (!dominio.podeConcederPapel(ctx.atribuicoes, e.papel, e.campusId)) throw new ErroProibido();
  return comContexto(executor, escopoDe(ctx), async (db) => {
    const alvo = await repo.buscarUsuario(db, e.usuarioId);
    if (!alvo || !alvo.ativo || alvo.tipo !== 'SERVIDOR') throw new ErroValidacao('Usuário inválido para receber papéis.');
    if (e.campusId && !(await repo.buscarCampusAtivo(db, e.campusId))) throw new ErroValidacao('Campus inválido.');
    // D-18: papel de campus só para quem já é da equipe do campus (entrou por solicitação aprovada).
    if (e.campusId && !(await repo.ehMembroDoCampus(db, e.usuarioId, e.campusId))) {
      throw new ErroValidacao('O servidor precisa ter acesso aprovado neste campus antes de receber outro papel.');
    }
    const a = await repo.inserirAtribuicaoSeAusente(db, {
      usuarioId: e.usuarioId, papel: e.papel, campusId: e.campusId, concedidaPor: ctx.usuario.id,
    });
    if (!a) throw new ErroConflito('O usuário já tem este papel.', 'PAPEL_JA_ATRIBUIDO');
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId: e.campusId, acao: 'acesso.papel_concedido', entidade: 'atribuicao',
      entidadeId: a.id, depois: { usuario_id: e.usuarioId, papel: e.papel },
    });
    return a;
  });
}

// RF-004 (CA-004.1, CA-004.2): revoga com efeito imediato; nunca o último admin institucional.
export async function revogarAtribuicao(executor, ctx, atribuicaoId) {
  validar(uuid('Atribuição'), atribuicaoId);
  return comContexto(executor, escopoDe(ctx), async (db) => {
    const a = await repo.buscarAtribuicao(db, atribuicaoId);
    if (!a) throw new ErroNaoEncontrado();
    if (!dominio.podeConcederPapel(ctx.atribuicoes, a.papel, a.campus_id)) throw new ErroProibido();
    if (a.revogada_em) throw new ErroConflito('Atribuição já revogada.', 'JA_REVOGADA');
    if (a.papel === 'ADMIN_INSTITUCIONAL') {
      await repo.travarAdminsInstitucionais(db);
      if ((await repo.contarAdminsInstitucionaisAtivos(db)) <= 1) {
        throw new ErroConflito('Não é possível remover o último administrador institucional.', 'ULTIMO_ADMIN');
      }
    }
    const revogada = await repo.revogarAtribuicao(db, a.id, ctx.usuario.id);
    await registrarAuditoria(db, {
      usuarioId: ctx.usuario.id, campusId: a.campus_id, acao: 'acesso.papel_revogado', entidade: 'atribuicao',
      entidadeId: a.id, antes: { usuario_id: a.usuario_id, papel: a.papel },
    });
    return revogada;
  });
}
