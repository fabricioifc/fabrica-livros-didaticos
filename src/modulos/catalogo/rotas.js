// Rotas do catálogo de títulos (RF-020).
import { Router } from 'express';
import { ErroProibido } from '../../infra/erros.js';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import * as catalogo from './servico.js';
import { ABRANGENCIAS, formatarIsbn } from './dominio.js';

const texto = (v) => String(v ?? '');
const CAMPOS = ['titulo', 'autores', 'isbn', 'editora', 'edicao', 'volume', 'anoPublicacao', 'componente', 'codigoPrograma', 'abrangencia', 'serie'];
const lerFormulario = (b = {}) => Object.fromEntries(CAMPOS.map((c) => [c, texto(b[c])]));

// Valores do formulário a partir de um título salvo.
const paraFormulario = (t) => ({
  titulo: t.titulo, autores: t.autores, isbn: t.isbn13 ?? '', editora: t.editora ?? '', edicao: t.edicao ?? '',
  volume: t.volume ?? '', anoPublicacao: t.ano_publicacao ?? '', componente: t.componente ?? '',
  codigoPrograma: t.codigo_programa ?? '', abrangencia: t.abrangencia, serie: t.serie ?? '',
});

export function rotasDeCatalogo({ pool }) {
  const r = Router();
  r.use('/catalogo', exigirServidor);
  r.use('/catalogo', (req, res, next) => {
    res.locals.ABRANGENCIAS = ABRANGENCIAS;
    res.locals.formatarIsbn = formatarIsbn;
    next();
  });

  r.get('/catalogo', async (req, res, next) => {
    try {
      const resultado = await catalogo.listarCatalogo(pool, req.contexto, { termo: texto(req.query.q), pagina: req.query.pagina });
      res.render('catalogo/lista', { titulo: 'Catálogo de títulos', ...resultado, podeCriar: catalogo.podeCriar(req.contexto) });
    } catch (err) {
      next(err);
    }
  });

  const formulario = (res, { status = 200, item = null, valores = {}, erros = {} }) =>
    res.status(status).render('catalogo/form', { titulo: item ? 'Editar título' : 'Cadastrar título', item, valores, erros });

  r.get('/catalogo/novo', (req, res, next) => {
    if (!catalogo.podeCriar(req.contexto)) return next(new ErroProibido());
    formulario(res, { valores: { abrangencia: '' } });
  });

  r.post('/catalogo', async (req, res, next) => {
    const valores = lerFormulario(req.body);
    try {
      const t = await catalogo.criarTitulo(pool, req.contexto, valores);
      avisar(req, 'success', 'Título cadastrado.', 'Ele já está disponível para todos os campi.');
      res.redirect(303, `/catalogo/${t.id}`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      formulario(res, { status: 422, valores, erros: err.detalhes ?? {} });
    }
  });

  r.get('/catalogo/:id', async (req, res, next) => {
    try {
      const t = await catalogo.obterTitulo(pool, req.contexto, idDaUrl(req.params.id));
      res.render('catalogo/detalhe', { titulo: t.titulo, t, podeEditar: catalogo.podeEditar(req.contexto) });
    } catch (err) {
      next(err);
    }
  });

  r.get('/catalogo/:id/editar', async (req, res, next) => {
    try {
      if (!catalogo.podeEditar(req.contexto)) return next(new ErroProibido());
      const t = await catalogo.obterTitulo(pool, req.contexto, idDaUrl(req.params.id));
      formulario(res, { item: t, valores: paraFormulario(t) });
    } catch (err) {
      next(err);
    }
  });

  r.post('/catalogo/:id', async (req, res, next) => {
    const valores = lerFormulario(req.body);
    try {
      const t = await catalogo.editarTitulo(pool, req.contexto, idDaUrl(req.params.id), valores);
      avisar(req, 'success', 'Título atualizado.');
      res.redirect(303, `/catalogo/${t.id}`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        const item = await catalogo.obterTitulo(pool, req.contexto, req.params.id);
        formulario(res, { status: 422, item, valores, erros: err.detalhes ?? {} });
      } catch (err2) {
        next(err2);
      }
    }
  });

  return r;
}
