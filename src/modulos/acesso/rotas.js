// Rotas do módulo de acesso: login com o Google, saída, tela inicial e solicitação de campus.
// Toda autorização é feita no serviço; as rotas só traduzem HTTP <-> casos de uso.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ErroAplicacao, ErroNaoAutenticado } from '../../infra/erros.js';
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
  const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

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

  r.get('/auth/login', limiteLogin, async (req, res, next) => {
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

  r.get('/auth/callback', limiteLogin, async (req, res, next) => {
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

  return r;
}
