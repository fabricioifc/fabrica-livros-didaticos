// Montagem da aplicação Express. Rotas de negócio, sessões e login entram na parte 1b.
import express from 'express';

export function criarApp({ pool }) {
  const app = express();
  app.disable('x-powered-by');

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

  app.use((req, res) => {
    res.status(404).json({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Página não encontrada.' } });
  });

  // Erros inesperados: nunca expor detalhes internos ao cliente.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).json({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente.' } });
  });

  return app;
}
