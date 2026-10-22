// Rotas do estoque do campus (RF-025 a RF-028). O campus da URL é só intenção: o serviço verifica o acesso.
import { Router } from 'express';
import { ErroNaoEncontrado } from '../../infra/erros.js';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import { formatarIsbn } from '../catalogo/dominio.js';
import { TIPOS_MANUAIS, ROTULOS_TIPO, tipoPorCaminho } from './dominio.js';
import * as estoque from './servico.js';

const texto = (v) => String(v ?? '');
const lerMovimentacao = (b = {}) => ({
  quantidade: texto(b.quantidade), origem: texto(b.origem), justificativa: texto(b.justificativa), sentido: texto(b.sentido),
});
const dataHora = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export function rotasDeEstoque({ pool }) {
  const r = Router();
  r.use('/campi/:id/estoque', exigirServidor);
  r.use('/campi/:id/estoque', (req, res, next) => {
    Object.assign(res.locals, { formatarIsbn, ROTULOS_TIPO, TIPOS_MANUAIS, dataHora });
    next();
  });

  const exibir = (rota, fn) => r.get(rota, async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  });

  exibir('/campi/:id/estoque', async (req, res) => {
    const dados = await estoque.listarEstoque(pool, req.contexto, idDaUrl(req.params.id), { termo: texto(req.query.q), pagina: req.query.pagina });
    res.render('estoque/lista', { titulo: `Estoque — ${dados.campus.nome_curto}`, ...dados });
  });

  exibir('/campi/:id/estoque/entrada', async (req, res) => {
    const dados = await estoque.buscarTitulosParaEntrada(pool, req.contexto, idDaUrl(req.params.id), { termo: texto(req.query.q) });
    res.render('estoque/escolher-titulo', { titulo: `Registrar entrada — ${dados.campus.nome_curto}`, ...dados });
  });

  exibir('/campi/:id/estoque/movimentacoes', async (req, res) => {
    const dados = await estoque.listarMovimentacoesDoCampus(pool, req.contexto, idDaUrl(req.params.id), { pagina: req.query.pagina });
    res.render('estoque/movimentacoes', { titulo: `Movimentações do estoque — ${dados.campus.nome_curto}`, ...dados });
  });

  exibir('/campi/:id/estoque/titulos/:titulo', async (req, res) => {
    const dados = await estoque.obterTituloNoEstoque(pool, req.contexto, idDaUrl(req.params.id), idDaUrl(req.params.titulo), { pagina: req.query.pagina });
    res.render('estoque/titulo', { titulo: `${dados.titulo.titulo} — estoque de ${dados.campus.nome_curto}`, ...dados });
  });

  // Entrada, baixa e ajuste: uma tela por tipo.
  const tipoDaUrl = (caminho) => {
    const tipo = tipoPorCaminho(caminho);
    if (!tipo) throw new ErroNaoEncontrado();
    return tipo;
  };
  const formulario = async (req, res, { status = 200, valores = {}, erros = {} } = {}) => {
    const tipo = tipoDaUrl(req.params.acao);
    const dados = await estoque.prepararMovimentacao(pool, req.contexto, idDaUrl(req.params.id), idDaUrl(req.params.titulo));
    res.status(status).render('estoque/movimentar', { titulo: TIPOS_MANUAIS[tipo].titulo, tipo, ...dados, valores, erros });
  };

  exibir('/campi/:id/estoque/titulos/:titulo/:acao', (req, res) => formulario(req, res));

  r.post('/campi/:id/estoque/titulos/:titulo/:acao', async (req, res, next) => {
    const valores = lerMovimentacao(req.body);
    try {
      const campusId = idDaUrl(req.params.id);
      const tituloId = idDaUrl(req.params.titulo);
      const tipo = tipoDaUrl(req.params.acao);
      const m = await estoque.registrarMovimentacao(pool, req.contexto, campusId, tituloId, tipo, valores);
      avisar(req, 'success', TIPOS_MANUAIS[tipo].sucesso, `Saldo disponível agora: ${m.saldo.disponivel}.`);
      res.redirect(303, `/campi/${campusId}/estoque/titulos/${tituloId}`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        await formulario(req, res, { status: 422, valores, erros: err.detalhes ?? {} });
      } catch (err2) {
        next(err2);
      }
    }
  });

  return r;
}
