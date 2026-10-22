// Rotas do termo de compromisso (RF-080).
import { Router } from 'express';
import { ErroProibido } from '../../infra/erros.js';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import { MARCADORES, EXEMPLO, preencher, paragrafos } from './dominio.js';
import * as termo from './servico.js';

const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function rotasDoTermo({ pool }) {
  const r = Router();
  r.use('/termo', exigirServidor);
  r.use('/termo', (req, res, next) => {
    Object.assign(res.locals, { MARCADORES, EXEMPLO, preencher, paragrafos, dataHora });
    next();
  });

  r.get('/termo', async (req, res, next) => {
    try {
      const dados = await termo.listarVersoes(pool, req.contexto);
      res.render('termo/lista', { titulo: 'Termo de compromisso', ...dados, podePublicar: termo.podePublicar(req.contexto) });
    } catch (err) {
      next(err);
    }
  });

  const formulario = async (req, res, { status = 200, valores = null, erros = {} } = {}) => {
    const { vigente } = await termo.prepararPublicacao(pool, req.contexto);
    res.status(status).render('termo/nova', { titulo: 'Publicar nova versão do termo', vigente, valores: valores ?? { texto: vigente?.texto ?? '' }, erros });
  };

  r.get('/termo/nova', async (req, res, next) => {
    try {
      if (!termo.podePublicar(req.contexto)) throw new ErroProibido();
      await formulario(req, res);
    } catch (err) {
      next(err);
    }
  });

  r.post('/termo/nova', async (req, res, next) => {
    const valores = { texto: String(req.body?.texto ?? ''), confirmacao: String(req.body?.confirmacao ?? '') };
    try {
      const nova = await termo.publicarVersao(pool, req.contexto, valores);
      avisar(req, 'success', `Versão ${nova.versao} publicada.`, 'Ela vale para as entregas preparadas a partir de agora, em todos os campi. Termos já assinados não mudam.');
      res.redirect(303, `/termo/${nova.id}`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        await formulario(req, res, { status: 422, valores, erros: err.detalhes ?? {} });
      } catch (err2) {
        next(err2);
      }
    }
  });

  r.get('/termo/:id', async (req, res, next) => {
    try {
      const dados = await termo.obterVersao(pool, req.contexto, idDaUrl(req.params.id));
      res.render('termo/versao', { titulo: `Termo de compromisso — versão ${dados.versao.versao}`, ...dados });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
