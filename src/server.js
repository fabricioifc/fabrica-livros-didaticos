// Ponto de entrada: carrega a configuração, conecta ao banco e inicia o servidor HTTP.
import pg from 'pg';
import { carregarConfig } from './config/index.js';
import { criarApp } from './app.js';
import { criarProvedorGoogle } from './infra/auth/google.js';

const config = carregarConfig();
const pool = new pg.Pool({ connectionString: config.bancoUrl, max: 10 });
const provedor = config.google ? criarProvedorGoogle(config.google) : null;
if (!provedor) console.warn('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados: login indisponível.');
if (!config.segredoSessao) console.warn('SESSION_SECRET não configurada: sessões serão perdidas ao reiniciar.');

const servidor = criarApp({ pool, config, provedor }).listen(config.porta, config.host, () => {
  console.log(`Servidor (${config.ambiente}) em http://${config.host}:${config.porta} — acesse ${config.appUrl}`);
});

// Encerramento limpo (docker stop, nodemon ao reiniciar).
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, () => {
    servidor.close(() => pool.end().finally(() => process.exit(0)));
  });
}
