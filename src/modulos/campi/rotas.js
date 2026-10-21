// Rotas de campi (RF-010, RF-011). Autorização no serviço; aqui só HTTP <-> casos de uso.
import { Router } from 'express';
import { idDaUrl, exigirServidor, avisar } from '../../infra/web/rotas.js';
import * as campi from './servico.js';

const texto = (v) => String(v ?? '');

// Campos do formulário de configuração. `codigo` só é enviado pela administração institucional.
function dadosDoFormulario(body = {}) {
  const dados = {
    nomeOficial: texto(body.nomeOficial),
    nomeCurto: texto(body.nomeCurto),
    endereco: texto(body.endereco),
    cidade: texto(body.cidade),
    uf: texto(body.uf),
    cep: texto(body.cep),
    setorResponsavel: texto(body.setorResponsavel),
    emailSetor: texto(body.emailSetor),
    telefone: texto(body.telefone),
    permiteEntregaComPendencia: body.permiteEntregaComPendencia === 'sim',
  };
  if (Object.hasOwn(body, 'codigo')) dados.codigo = texto(body.codigo);
  return dados;
}

// Valores para reexibir o formulário após erro (mesmos nomes de coluna usados na tela).
const valoresDoFormulario = (campus, d) => ({
  ...campus,
  codigo: d.codigo ?? campus.codigo,
  nome_oficial: d.nomeOficial, nome_curto: d.nomeCurto, endereco: d.endereco, cidade: d.cidade, uf: d.uf, cep: d.cep,
  setor_responsavel: d.setorResponsavel, email_setor: d.emailSetor, telefone: d.telefone,
  permite_entrega_com_pendencia: d.permiteEntregaComPendencia,
});

export function rotasDeCampi({ pool }) {
  const r = Router();
  r.use('/campi', exigirServidor);

  r.get('/campi', async (req, res, next) => {
    try {
      res.render('campi/lista', { titulo: 'Campi', campi: await campi.listarCampi(pool, req.contexto) });
    } catch (err) {
      next(err);
    }
  });

  r.get('/campi/novo', async (req, res, next) => {
    try {
      await campi.listarCampi(pool, req.contexto); // mesma autorização da lista
      res.render('campi/novo', { titulo: 'Novo campus', valores: {}, erros: {} });
    } catch (err) {
      next(err);
    }
  });

  r.post('/campi', async (req, res, next) => {
    const valores = { codigo: texto(req.body?.codigo), nomeOficial: texto(req.body?.nomeOficial), nomeCurto: texto(req.body?.nomeCurto) };
    try {
      const campus = await campi.criarCampus(pool, req.contexto, valores);
      avisar(req, 'success', `Campus ${campus.nome_curto} cadastrado.`, 'Ele já aparece para os servidores solicitarem acesso.');
      res.redirect(303, '/campi');
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      res.status(422).render('campi/novo', { titulo: 'Novo campus', valores, erros: err.detalhes ?? {} });
    }
  });

  r.get('/campi/:id/configuracao', async (req, res, next) => {
    try {
      const { campus, podeAlterarCodigo } = await campi.obterCampus(pool, req.contexto, idDaUrl(req.params.id));
      res.render('campi/configuracao', { titulo: `Configuração — ${campus.nome_curto}`, campus, podeAlterarCodigo, erros: {} });
    } catch (err) {
      next(err);
    }
  });

  r.post('/campi/:id/configuracao', async (req, res, next) => {
    const d = dadosDoFormulario(req.body);
    try {
      const id = idDaUrl(req.params.id);
      await campi.salvarConfiguracao(pool, req.contexto, id, d);
      avisar(req, 'success', 'Configuração salva.', 'Os novos dados valem para os próximos documentos.');
      res.redirect(303, `/campi/${id}/configuracao`);
    } catch (err) {
      if (err.codigo !== 'VALIDACAO') return next(err);
      try {
        const { campus, podeAlterarCodigo } = await campi.obterCampus(pool, req.contexto, req.params.id);
        res.status(422).render('campi/configuracao', {
          titulo: `Configuração — ${campus.nome_curto}`, campus: valoresDoFormulario(campus, d), podeAlterarCodigo, erros: err.detalhes ?? {},
        });
      } catch (err2) {
        next(err2);
      }
    }
  });

  for (const [acao, ativo] of [['ativar', true], ['desativar', false]]) {
    r.post(`/campi/:id/${acao}`, async (req, res, next) => {
      try {
        await campi.alterarSituacao(pool, req.contexto, idDaUrl(req.params.id), ativo);
        avisar(req, 'success', ativo ? 'Campus ativado.' : 'Campus desativado.',
          ativo ? null : 'Ele não aparece mais para novas solicitações de acesso; o histórico continua disponível.');
        res.redirect(303, '/campi');
      } catch (err) {
        next(err);
      }
    });
  }

  return r;
}
