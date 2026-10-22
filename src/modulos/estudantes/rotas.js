// Rotas de estudantes e vínculos (RF-030 a RF-033). O campus da URL é só intenção: o serviço verifica o acesso.
// Nome e matrícula não vão para a URL (regra 14): a busca é enviada por POST e guardada na sessão.
import { Router } from 'express';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import { SITUACOES, SITUACOES_ENCERRAMENTO, COLUNAS_PLANILHA } from './dominio.js';
import * as estudantes from './servico.js';

const texto = (v) => String(v ?? '');
const lerFormulario = (b = {}) => ({
  matricula: texto(b.matricula), nome: texto(b.nome), email: texto(b.email),
  cursoId: texto(b.cursoId), periodoId: texto(b.periodoId), serie: texto(b.serie),
});
const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');

export function rotasDeEstudantes({ pool }) {
  const r = Router();
  r.use(['/campi/:id/estudantes', '/vinculos'], exigirServidor);
  r.use(['/campi/:id/estudantes', '/vinculos'], (req, res, next) => {
    Object.assign(res.locals, { SITUACOES, SITUACOES_ENCERRAMENTO, COLUNAS_PLANILHA, dataBr });
    next();
  });

  const exibir = (rota, fn) => r.get(rota, async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  });
  // Em erro de validação, reexibe o formulário; outros erros seguem para o tratador geral.
  const enviar = (rota, fn, reexibir) => r.post(rota, async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO' || !reexibir) return next(err);
      try {
        await reexibir(req, res, err);
      } catch (err2) {
        next(err2);
      }
    }
  });

  // ===== Consulta (RF-032) =====
  const buscaDaSessao = (req, campusId) => req.session.buscaEstudantes?.campus === campusId ? req.session.buscaEstudantes.filtros : {};

  exibir('/campi/:id/estudantes', async (req, res) => {
    const campusId = idDaUrl(req.params.id);
    const dados = await estudantes.listarEstudantes(pool, req.contexto, campusId, { ...buscaDaSessao(req, campusId), pagina: req.query.pagina });
    res.render('estudantes/lista', { titulo: `Estudantes — ${dados.campus.nome_curto}`, ...dados });
  });

  r.post('/campi/:id/estudantes/busca', (req, res, next) => {
    try {
      const campusId = idDaUrl(req.params.id);
      const b = req.body ?? {};
      req.session.buscaEstudantes = b.limpar
        ? null
        : { campus: campusId, filtros: { termo: texto(b.termo).slice(0, 100), cursoId: texto(b.cursoId), serie: texto(b.serie), situacao: texto(b.situacao) } };
      res.redirect(303, `/campi/${campusId}/estudantes`);
    } catch (err) {
      next(err);
    }
  });

  // ===== Cadastro manual (RF-031) =====
  const formularioNovo = async (req, res, { status = 200, valores = {}, erros = {} } = {}) => {
    const dados = await estudantes.prepararFormulario(pool, req.contexto, idDaUrl(req.params.id));
    res.status(status).render('estudantes/form', { titulo: 'Cadastrar estudante', ...dados, estudante: null, valores, erros });
  };
  exibir('/campi/:id/estudantes/novo', (req, res) => formularioNovo(req, res));
  enviar('/campi/:id/estudantes/novo', async (req, res) => {
    const campusId = idDaUrl(req.params.id);
    const { estudanteId, resumo } = await estudantes.cadastrarEstudante(pool, req.contexto, campusId, lerFormulario(req.body));
    avisar(req, 'success', resumo.novos ? 'Estudante cadastrado.' : 'Estudante já cadastrado no IFC: vínculo com este campus registrado.');
    res.redirect(303, `/campi/${campusId}/estudantes/${estudanteId}`);
  }, (req, res, err) => formularioNovo(req, res, { status: 422, valores: lerFormulario(req.body), erros: err.detalhes ?? {} }));

  // ===== Importação (RF-030) =====
  const telaImportacao = async (req, res, { status = 200, erros = [], erroArquivo = null } = {}) => {
    const dados = await estudantes.prepararFormulario(pool, req.contexto, idDaUrl(req.params.id));
    res.status(status).render('estudantes/importar', { titulo: 'Importar estudantes', ...dados, erros, erroArquivo });
  };
  exibir('/campi/:id/estudantes/importar', (req, res) => telaImportacao(req, res));
  exibir('/campi/:id/estudantes/modelo.csv', async (req, res) => {
    await estudantes.prepararFormulario(pool, req.contexto, idDaUrl(req.params.id));
    res.type('text/csv; charset=utf-8').attachment('modelo-estudantes.csv').send(`﻿${COLUNAS_PLANILHA.join(';')}\r\n`);
  });
  enviar('/campi/:id/estudantes/importar', async (req, res) => {
    const campusId = idDaUrl(req.params.id);
    const r2 = await estudantes.importarPlanilha(pool, req.contexto, campusId, req.arquivos?.arquivo);
    if (r2.erros.length) return telaImportacao(req, res, { status: 422, erros: r2.erros });
    const s = r2.resumo;
    avisar(req, 'success', `Planilha importada: ${s.linhas} estudante(s).`,
      `Novos: ${s.novos}. Vínculos novos de estudantes já cadastrados: ${s.novosVinculos}. Atualizados: ${s.atualizados}. Sem alteração: ${s.semAlteracao}.`);
    res.redirect(303, `/campi/${campusId}/estudantes`);
  }, (req, res, err) => telaImportacao(req, res, {
    status: 422, erros: err.detalhes?.erros ?? [], erroArquivo: err.detalhes?.erros ? null : (err.detalhes?.arquivo ?? err.message),
  }));

  // ===== Ficha e edição =====
  exibir('/campi/:id/estudantes/:estudante', async (req, res) => {
    const dados = await estudantes.obterEstudante(pool, req.contexto, idDaUrl(req.params.id), idDaUrl(req.params.estudante));
    res.render('estudantes/ficha', { titulo: dados.estudante.nome, ...dados });
  });

  const formularioEdicao = async (req, res, { status = 200, valores = null, erros = {} } = {}) => {
    const dados = await estudantes.prepararEdicao(pool, req.contexto, idDaUrl(req.params.id), idDaUrl(req.params.estudante));
    const atuais = {
      matricula: dados.estudante.matricula, nome: dados.estudante.nome, email: dados.estudante.email,
      cursoId: dados.ativo.curso_id, periodoId: dados.ativo.periodo_letivo_id, serie: String(dados.ativo.serie),
    };
    res.status(status).render('estudantes/form', { titulo: 'Editar estudante', ...dados, valores: valores ?? atuais, erros });
  };
  exibir('/campi/:id/estudantes/:estudante/editar', (req, res) => formularioEdicao(req, res));
  enviar('/campi/:id/estudantes/:estudante/editar', async (req, res) => {
    const campusId = idDaUrl(req.params.id);
    const { estudanteId } = await estudantes.editarEstudante(pool, req.contexto, campusId, idDaUrl(req.params.estudante), lerFormulario(req.body));
    avisar(req, 'success', 'Dados do estudante atualizados.');
    res.redirect(303, `/campi/${campusId}/estudantes/${estudanteId}`);
  }, (req, res, err) => formularioEdicao(req, res, { status: 422, valores: lerFormulario(req.body), erros: err.detalhes ?? {} }));

  // ===== Encerramento do vínculo (RF-033); o campus vem do vínculo no banco =====
  const telaEncerramento = async (req, res, { status = 200, valores = {}, erros = {} } = {}) => {
    const dados = await estudantes.prepararEncerramento(pool, req.contexto, idDaUrl(req.params.id));
    res.status(status).render('estudantes/encerrar', { titulo: 'Encerrar vínculo', ...dados, valores: { fim: dados.hoje, ...valores }, erros });
  };
  exibir('/vinculos/:id/encerrar', (req, res) => telaEncerramento(req, res));
  enviar('/vinculos/:id/encerrar', async (req, res) => {
    const b = req.body ?? {};
    const v = await estudantes.encerrarVinculo(pool, req.contexto, idDaUrl(req.params.id), { situacao: texto(b.situacao), fim: texto(b.fim) });
    avisar(req, 'success', 'Vínculo encerrado.', 'O histórico do estudante continua disponível para consulta.');
    res.redirect(303, `/campi/${v.campus_id}/estudantes/${v.estudante_id}`);
  }, (req, res, err) => telaEncerramento(req, res, { status: 422, valores: { situacao: texto(req.body?.situacao), fim: texto(req.body?.fim) }, erros: err.detalhes ?? {} }));

  return r;
}
