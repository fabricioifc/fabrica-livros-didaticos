// Rotas do módulo de acesso: login com o Google, saída, tela inicial e solicitação de campus.
// Toda autorização é feita no serviço; as rotas só traduzem HTTP <-> casos de uso.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ErroAplicacao, ErroNaoAutenticado } from '../../infra/erros.js';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import * as acesso from './servico.js';

const regenerar = (req) => new Promise((ok, falha) => req.session.regenerate((e) => (e ? falha(e) : ok())));
const salvar = (req) => new Promise((ok, falha) => req.session.save((e) => (e ? falha(e) : ok())));
const destruir = (req) => new Promise((ok) => (req.session ? req.session.destroy(() => ok()) : ok()));

// Carrega usuário e atribuições do banco a cada requisição (revogação vale na hora, CA-004.1).
export function carregarUsuario({ pool }) {
  return async (req, res, next) => {
    req.contexto = null;
    const usuarioId = req.session?.usuarioId;
    if (!usuarioId) return next();
    try {
      req.contexto = await acesso.carregarContexto(pool, usuarioId);
      res.locals.usuario = { nome: req.contexto.usuario.nome, tipo: req.contexto.usuario.tipo };
      next();
    } catch (err) {
      if (err instanceof ErroNaoAutenticado) {
        await destruir(req); // usuário desativado ou removido: encerra a sessão
        return next();
      }
      next(err);
    }
  };
}

export function rotasDeAcesso({ pool, config, provedor }) {
  const r = Router();
  // Contadores separados para início e retorno do login (um não consome o limite do outro).
  const limitador = () => rateLimit({
    windowMs: 15 * 60 * 1000, limit: config.limiteLogin15Min ?? 300, standardHeaders: 'draft-8', legacyHeaders: false,
  });
  const limiteInicioLogin = limitador();
  const limiteRetornoLogin = limitador();

  r.get('/', async (req, res, next) => {
    try {
      const ctx = req.contexto;
      if (!ctx) return res.render('acesso/entrar', { titulo: 'Entrar', loginDisponivel: Boolean(provedor) });
      if (ctx.usuario.tipo === 'ESTUDANTE') {
        return res.render('acesso/estudante', { titulo: 'Área do estudante', estudante: ctx.estudante });
      }
      const painel = await acesso.painelDoServidor(pool, ctx);
      if (painel.acessos.length || painel.institucionais.length) {
        return res.render('acesso/inicio', { titulo: 'Início', ...painel });
      }
      if (painel.ultimaSolicitacao?.status === 'PENDENTE') {
        return res.render('acesso/aguardando', { titulo: 'Aguardando confirmação', solicitacao: painel.ultimaSolicitacao });
      }
      return res.render('acesso/escolher-campus', {
        titulo: 'Escolha seu campus', campi: painel.campiAtivos, recusa: painel.ultimaSolicitacao?.status === 'RECUSADA' ? painel.ultimaSolicitacao : null,
      });
    } catch (err) {
      next(err);
    }
  });

  r.get('/auth/login', limiteInicioLogin, async (req, res, next) => {
    try {
      if (!provedor) return res.redirect(303, '/');
      const { url, verificacao } = await provedor.iniciarLogin();
      req.session.oidc = verificacao;
      await salvar(req);
      res.redirect(303, url);
    } catch (err) {
      next(err);
    }
  });

  r.get('/auth/callback', limiteRetornoLogin, async (req, res, next) => {
    const verificacao = req.session?.oidc;
    if (!provedor || !verificacao) return res.redirect(303, '/');
    delete req.session.oidc; // uso único
    try {
      const claims = await provedor.concluirLogin(new URL(req.originalUrl, config.appUrl), verificacao);
      const { usuario } = await acesso.registrarLogin(pool, claims, { emailsAdminInicial: config.emailsAdminInicial });
      await regenerar(req); // novo identificador de sessão após o login (evita fixação de sessão)
      req.session.usuarioId = usuario.id;
      await salvar(req);
      res.redirect(303, '/');
    } catch (err) {
      if (err instanceof ErroAplicacao) {
        await destruir(req);
        return res.status(err.status).render('acesso/login-recusado', { titulo: 'Acesso não permitido', mensagem: err.message });
      }
      // Falha na troca do código (código reutilizado, state/nonce inválido, provedor fora do ar).
      console.error('Falha no retorno do login:', err.name, err.code ?? '');
      res.status(400).render('acesso/login-recusado', {
        titulo: 'Não foi possível entrar', mensagem: 'Não foi possível concluir o login. Tente novamente.',
      });
    }
  });

  r.post('/auth/sair', async (req, res) => {
    await destruir(req);
    res.clearCookie('livros.sid');
    res.redirect(303, '/');
  });

  // RF-002: servidor declara o campus.
  r.post('/acesso/solicitacoes', async (req, res, next) => {
    try {
      if (!req.contexto) return res.redirect(303, '/');
      await acesso.solicitarAcesso(pool, req.contexto, String(req.body?.campusId ?? ''));
      res.redirect(303, '/');
    } catch (err) {
      if (err.codigo === 'VALIDACAO' && req.contexto?.usuario.tipo === 'SERVIDOR') {
        const painel = await acesso.painelDoServidor(pool, req.contexto);
        return res.status(422).render('acesso/escolher-campus', {
          titulo: 'Escolha seu campus', campi: painel.campiAtivos, recusa: null, erro: 'Selecione um dos campi da lista.',
        });
      }
      next(err);
    }
  });

  // ===== RF-003: decisão sobre solicitações =====
  r.get('/acesso/solicitacoes', exigirServidor, async (req, res, next) => {
    try {
      const solicitacoes = await acesso.listarSolicitacoesDecidiveis(pool, req.contexto);
      res.render('acesso/solicitacoes', { titulo: 'Solicitações de acesso', solicitacoes });
    } catch (err) {
      next(err);
    }
  });

  r.get('/acesso/solicitacoes/:id', exigirServidor, async (req, res, next) => {
    try {
      const s = await acesso.obterSolicitacaoParaDecisao(pool, req.contexto, idDaUrl(req.params.id));
      res.render('acesso/solicitacao', { titulo: 'Analisar solicitação', s, erro: null, motivo: '' });
    } catch (err) {
      next(err);
    }
  });

  r.post('/acesso/solicitacoes/:id/aprovar', exigirServidor, async (req, res, next) => {
    try {
      const { solicitacao } = await acesso.decidirSolicitacao(pool, req.contexto, {
        solicitacaoId: idDaUrl(req.params.id), aprovar: true, concederOperador: req.body?.operador === 'sim',
      });
      avisar(req, 'success', 'Acesso aprovado.', solicitacao.status === 'APROVADA' ? 'O servidor já pode usar o sistema.' : null);
      res.redirect(303, '/acesso/solicitacoes');
    } catch (err) {
      next(err);
    }
  });

  r.post('/acesso/solicitacoes/:id/recusar', exigirServidor, async (req, res, next) => {
    const motivo = String(req.body?.motivo ?? '');
    try {
      await acesso.decidirSolicitacao(pool, req.contexto, { solicitacaoId: idDaUrl(req.params.id), aprovar: false, motivo });
      avisar(req, 'info', 'Solicitação recusada.', 'O servidor verá o motivo e poderá solicitar novamente.');
      res.redirect(303, '/acesso/solicitacoes');
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        const s = await acesso.obterSolicitacaoParaDecisao(pool, req.contexto, req.params.id);
        res.status(422).render('acesso/solicitacao', { titulo: 'Analisar solicitação', s, erro: err.message, motivo });
      } catch (err2) {
        next(err2);
      }
    }
  });

  // ===== RF-004: equipe do campus e papéis =====
  r.get('/acesso/campi/:campusId/equipe', exigirServidor, async (req, res, next) => {
    try {
      const equipe = await acesso.equipeDoCampus(pool, req.contexto, idDaUrl(req.params.campusId));
      res.render('acesso/equipe', { titulo: `Equipe — ${equipe.campus.nome_curto}`, ...equipe, eu: req.contexto.usuario.id });
    } catch (err) {
      next(err);
    }
  });

  r.post('/acesso/campi/:campusId/equipe/papeis', exigirServidor, async (req, res, next) => {
    const campusId = req.params.campusId;
    try {
      await acesso.concederPapel(pool, req.contexto, {
        usuarioId: String(req.body?.usuarioId ?? ''), papel: String(req.body?.papel ?? ''), campusId: idDaUrl(campusId),
      });
      avisar(req, 'success', 'Papel concedido.');
      res.redirect(303, `/acesso/campi/${campusId}/equipe`);
    } catch (err) {
      if (err.codigo === 'PAPEL_JA_ATRIBUIDO' || err.codigo === 'VALIDACAO') {
        avisar(req, 'warning', err.message);
        return res.redirect(303, `/acesso/campi/${campusId}/equipe`);
      }
      next(err);
    }
  });

  r.post('/acesso/atribuicoes/:id/revogar', exigirServidor, async (req, res, next) => {
    try {
      const a = await acesso.revogarAtribuicao(pool, req.contexto, idDaUrl(req.params.id));
      avisar(req, 'success', 'Papel removido.');
      res.redirect(303, a.campus_id ? `/acesso/campi/${a.campus_id}/equipe` : '/');
    } catch (err) {
      if (err.codigo === 'ULTIMO_ADMIN' || err.codigo === 'JA_REVOGADA') {
        avisar(req, 'warning', err.message);
        return res.redirect(303, '/');
      }
      next(err);
    }
  });

  return r;
}
