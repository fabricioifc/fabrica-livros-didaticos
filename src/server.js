// Ponto de entrada: carrega a configuração, conecta ao banco e inicia o servidor HTTP.
import pg from 'pg';
import { carregarConfig } from './config/index.js';
import { criarApp } from './app.js';

const config = carregarConfig();
const pool = new pg.Pool({ connectionString: config.bancoUrl, max: 10 });
const servidor = criarApp({ pool }).listen(config.porta, config.host, () => {
  console.log(`Servidor (${config.ambiente}) em http://${config.host}:${config.porta}`);
});

// Encerramento limpo (docker stop, nodemon ao reiniciar).
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.once(sinal, () => {
    servidor.close(() => pool.end().finally(() => process.exit(0)));
  });
}
