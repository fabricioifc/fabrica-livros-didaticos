// Rotas da oferta do campus (RF-012): anos letivos e cursos.
import { Router } from 'express';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import * as oferta from './oferta.js';

const texto = (v) => String(v ?? '');
const vazio = () => ({ ano: {}, curso: {} });
const lerAno = (b) => ({ ano: texto(b.ano), inicio: texto(b.inicio), fim: texto(b.fim) });
const lerCurso = (b) => ({ nome: texto(b.nome) });

export function rotasDeOferta({ pool }) {
  const r = Router();
  r.use(['/campi/:id/oferta', '/oferta'], exigirServidor);

  // Página única do campus; após erro de validação, reexibe o formulário com as mensagens.
  async function pagina(req, res, { status = 200, erros = vazio(), valores = vazio() } = {}) {
    const dados = await oferta.obterOferta(pool, req.contexto, idDaUrl(req.params.id));
    res.status(status).render('campi/oferta', { titulo: `Anos letivos e cursos — ${dados.campus.nome_curto}`, ...dados, erros, valores });
  }

  r.get('/campi/:id/oferta', async (req, res, next) => {
    try {
      await pagina(req, res);
    } catch (err) {
      next(err);
    }
  });

  const criadores = {
    anos: ['ano', lerAno, oferta.criarAnoLetivo, 'Ano letivo cadastrado.'],
    cursos: ['curso', lerCurso, oferta.criarCurso, 'Curso cadastrado.'],
  };
  for (const [caminho, [chave, ler, criar, sucesso]] of Object.entries(criadores)) {
    r.post(`/campi/:id/oferta/${caminho}`, async (req, res, next) => {
      const entrada = ler(req.body ?? {});
      try {
        const id = idDaUrl(req.params.id);
        await criar(pool, req.contexto, id, entrada);
        avisar(req, 'success', sucesso);
        res.redirect(303, `/campi/${id}/oferta#${caminho}`);
      } catch (err) {
        if (err.codigo !== 'VALIDACAO') return next(err);
        try {
          await pagina(req, res, { status: 422, erros: { ...vazio(), [chave]: err.detalhes ?? {} }, valores: { ...vazio(), [chave]: entrada } });
        } catch (err2) {
          next(err2);
        }
      }
    });
  }

  // Edição: página própria por item; o campus vem do registro no banco.
  const editores = {
    anos: ['ano', oferta.obterAnoLetivo, oferta.salvarAnoLetivo, lerAno, 'Ano letivo atualizado.'],
    cursos: ['curso', oferta.obterCurso, oferta.salvarCurso, lerCurso, 'Curso atualizado.'],
  };
  for (const [caminho, [tipo, obter, salvar, ler, sucesso]] of Object.entries(editores)) {
    r.get(`/oferta/${caminho}/:id`, async (req, res, next) => {
      try {
        const item = await obter(pool, req.contexto, idDaUrl(req.params.id));
        res.render('campi/oferta-editar', { titulo: 'Editar', tipo, item, erros: {} });
      } catch (err) {
        next(err);
      }
    });
    r.post(`/oferta/${caminho}/:id`, async (req, res, next) => {
      const entrada = ler(req.body ?? {});
      try {
        const salvo = await salvar(pool, req.contexto, idDaUrl(req.params.id), entrada);
        avisar(req, 'success', sucesso);
        res.redirect(303, `/campi/${salvo.campus_id}/oferta#${caminho}`);
      } catch (err) {
        if (err.codigo !== 'VALIDACAO') return next(err);
        try {
          const item = await obter(pool, req.contexto, req.params.id);
          res.status(422).render('campi/oferta-editar', { titulo: 'Editar', tipo, item: { ...item, ...entrada }, erros: err.detalhes ?? {} });
        } catch (err2) {
          next(err2);
        }
      }
    });
  }

  for (const [acao, ativo] of [['ativar', true], ['desativar', false]]) {
    r.post(`/oferta/cursos/:id/${acao}`, async (req, res, next) => {
      try {
        const c = await oferta.alterarSituacaoCurso(pool, req.contexto, idDaUrl(req.params.id), ativo);
        avisar(req, 'success', ativo ? 'Curso ativado.' : 'Curso desativado.', ativo ? null : 'Ele não é mais oferecido para novos estudantes; os registros existentes continuam.');
        res.redirect(303, `/campi/${c.campus_id}/oferta#cursos`);
      } catch (err) {
        next(err);
      }
    });
  }

  return r;
}
