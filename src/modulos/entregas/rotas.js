// Rotas do atendimento no balcão (RF-040, RF-041, RF-043, RF-046). A matrícula vai por POST, nunca na URL (regra 14);
// o estudante identificado fica na sessão do servidor e só ele pode receber a entrega (CA-042.8).
import { Router } from 'express';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import { STATUS, FORMAS_IDENTIFICACAO } from './dominio.js';
import * as entregas from './servico.js';

const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function rotasDeEntregas({ pool }) {
  const r = Router();
  const caminhos = ['/campi/:id/atendimento', '/atendimento', '/entregas'];
  r.use(caminhos, exigirServidor);
  r.use(caminhos, (req, res, next) => {
    Object.assign(res.locals, { STATUS, FORMAS_IDENTIFICACAO, dataHora });
    next();
  });

  const exibir = (rota, fn) => r.get(rota, async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  });

  const painel = async (req, res, { status = 200, matricula = '', erros = {} } = {}) => {
    const dados = await entregas.painelDoAtendimento(pool, req.contexto, idDaUrl(req.params.id));
    res.status(status).render('entregas/painel', { titulo: `Atendimento — ${dados.campus.nome_curto}`, ...dados, matricula, erros });
  };
  exibir('/campi/:id/atendimento', (req, res) => painel(req, res));

  r.post('/campi/:id/atendimento/identificar', async (req, res, next) => {
    const matricula = String(req.body?.matricula ?? '');
    try {
      const { vinculoId, forma } = await entregas.identificarPorMatricula(pool, req.contexto, idDaUrl(req.params.id), matricula);
      req.session.atendimento = { vinculoId, forma };
      res.redirect(303, `/atendimento/${vinculoId}`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        await painel(req, res, { status: 422, matricula, erros: err.detalhes ?? {} });
      } catch (err2) {
        next(err2);
      }
    }
  });

  const atendimento = async (req, res, { status = 200, selecionados = [], erros = {} } = {}) => {
    const vinculoId = idDaUrl(req.params.vinculo);
    const dados = await entregas.obterAtendimento(pool, req.contexto, vinculoId);
    const identificado = req.session.atendimento?.vinculoId === vinculoId;
    res.status(status).render('entregas/atendimento', { titulo: 'Atendimento', ...dados, identificado, selecionados, erros });
  };
  exibir('/atendimento/:vinculo', (req, res) => atendimento(req, res));

  r.post('/atendimento/:vinculo/entrega', async (req, res, next) => {
    const b = req.body ?? {};
    const selecionados = [b.titulos ?? []].flat().map(String);
    try {
      const e = await entregas.prepararEntrega(pool, req.contexto, idDaUrl(req.params.vinculo),
        { titulos: b.titulos, confirmacao: String(b.confirmacao ?? '') }, req.session.atendimento);
      avisar(req, 'success', 'Entrega preparada.', 'Ela aguarda a assinatura do estudante na tela. O estoque só é baixado na assinatura.');
      res.redirect(303, `/entregas/${e.id}`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        await atendimento(req, res, { status: 422, selecionados, erros: err.detalhes ?? {} });
      } catch (err2) {
        next(err2);
      }
    }
  });

  exibir('/entregas/:id', async (req, res) => {
    const dados = await entregas.obterEntrega(pool, req.contexto, idDaUrl(req.params.id));
    res.render('entregas/entrega', { titulo: 'Entrega', ...dados });
  });

  r.post('/entregas/:id/cancelar', async (req, res, next) => {
    try {
      const e = await entregas.cancelarEntrega(pool, req.contexto, idDaUrl(req.params.id));
      if (req.session.atendimento?.vinculoId === e.vinculo_id) delete req.session.atendimento;
      avisar(req, 'success', 'Entrega cancelada.', 'O estoque não foi alterado.');
      res.redirect(303, `/campi/${e.campus_id}/atendimento`);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
