// Montagem da aplicação Express (docs/architecture.md, seção 3).
import express from 'express';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErroAplicacao } from './infra/erros.js';
import { cabecalhosDeSeguranca, sessoes, semCache, protecaoCsrf, NOME_COOKIE } from './infra/web/seguranca.js';
import { carregarUsuario, rotasDeAcesso } from './modulos/acesso/rotas.js';
import { rotasDeCampi } from './modulos/campi/rotas.js';
import { rotasDeOferta } from './modulos/campi/rotas-oferta.js';
import { rotasDeCatalogo } from './modulos/catalogo/rotas.js';
import { rotasDeEstoque } from './modulos/estoque/rotas.js';
import { rotasDeEstudantes } from './modulos/estudantes/rotas.js';
import { rotasDoTermo } from './modulos/termo/rotas.js';
import { rotasDeEntregas } from './modulos/entregas/rotas.js';
import { formularioComArquivo } from './infra/web/multipart.js';
import { consumirAviso } from './infra/web/rotas.js';
import { obterInstituicao } from './modulos/acesso/servico.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const estatico = (pasta) => express.static(pasta, { index: false, fallthrough: false, maxAge: '7d' });

// `config` e `provedor` são opcionais para manter /saude utilizável isoladamente (ex.: testes).
export function criarApp({ pool, config, provedor = null }) {
  const app = express();
  app.disable('x-powered-by');
  if (config?.ambiente === 'production') app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', join(RAIZ, 'src', 'views'));

  app.use(cabecalhosDeSeguranca());

  // Arquivos do GovBR-DS e ícones servidos localmente (sem CDN), na versão instalada.
  app.use('/vendor/govbr-ds', estatico(join(RAIZ, 'node_modules', '@govbr-ds', 'core', 'dist')));
  app.use('/vendor/fontawesome/css', estatico(join(RAIZ, 'node_modules', '@fortawesome', 'fontawesome-free', 'css')));
  app.use('/vendor/fontawesome/webfonts', estatico(join(RAIZ, 'node_modules', '@fortawesome', 'fontawesome-free', 'webfonts')));
  app.use('/static', estatico(join(RAIZ, 'public')));

  // Monitoramento de disponibilidade (docs/architecture.md, seção 13). Sem dados sensíveis.
  app.get('/saude', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', banco: 'ok' });
    } catch {
      res.status(503).json({ status: 'indisponivel', banco: 'falha' });
    }
  });

  if (config) {
    app.use(semCache);
    app.use(express.urlencoded({ extended: false, limit: '20kb' }));
    app.use(sessoes({
      pool,
      // Fora de produção, sem SESSION_SECRET, usa um segredo aleatório (sessões caem ao reiniciar).
      segredo: config.segredoSessao ?? randomBytes(32).toString('hex'),
      producao: config.ambiente === 'production',
      inatividadeMinutos: config.inatividadeMinutos,
    }));
    app.use(async (req, res, next) => {
      res.locals.instituicao = null;
      res.locals.usuario = null;
      res.locals.csrfToken = '';
      try {
        res.locals.instituicao = await obterInstituicao(pool);
        next();
      } catch (err) {
        next(err);
      }
    });
    app.use(carregarUsuario({ pool }));
    app.use(formularioComArquivo()); // antes do CSRF: o token vem nos campos do formulário
    app.use(protecaoCsrf);
    app.use(consumirAviso);
    app.use(rotasDeAcesso({ pool, config, provedor }));
    app.use(rotasDeCampi({ pool }));
    app.use(rotasDeOferta({ pool }));
    app.use(rotasDeCatalogo({ pool }));
    app.use(rotasDeEstoque({ pool }));
    app.use(rotasDeEstudantes({ pool }));
    app.use(rotasDoTermo({ pool }));
    app.use(rotasDeEntregas({ pool }));
  }

  app.use((req, res) => {
    res.status(404);
    if (req.accepts(['html', 'json']) === 'html' && config) return res.render('erro', { titulo: 'Página não encontrada', mensagem: 'Página não encontrada.' });
    res.json({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Página não encontrada.' } });
  });

  // Erros: mensagens de negócio são exibidas; erros inesperados nunca expõem detalhes internos.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const conhecido = err instanceof ErroAplicacao;
    if (!conhecido) console.error(err);
    const status = conhecido ? err.status : 500;
    const mensagem = conhecido ? err.message : 'Erro interno. Tente novamente.';
    res.status(status);
    if (req.accepts(['html', 'json']) === 'html' && config) return res.render('erro', { titulo: 'Erro', mensagem });
    res.json({ erro: { codigo: conhecido ? err.codigo : 'ERRO_INTERNO', mensagem } });
  });

  return app;
}

export { NOME_COOKIE };
