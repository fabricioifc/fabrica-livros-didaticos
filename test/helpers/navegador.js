// Cliente HTTP mínimo para testes de rotas: guarda o cookie de sessão e não segue redirecionamentos.
import { criarApp } from '../../src/app.js';
import { carregarConfig } from '../../src/config/index.js';
import { resolveTestDatabaseUrl } from './test-db.js';

export const configDeTeste = (extra = {}) =>
  carregarConfig({ NODE_ENV: 'test', DATABASE_URL: resolveTestDatabaseUrl(), APP_URL: 'http://localhost:3000', SESSION_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres', ...extra });

// Provedor falso: substitui só o Google; o restante do fluxo (sessão, serviço, banco) é o real.
export function provedorFalso() {
  const identidades = new Map();
  let n = 0;
  return {
    identidades,
    async iniciarLogin() {
      const estado = `estado-${++n}`;
      return { url: `https://provedor.teste/autorizar?state=${estado}`, verificacao: { estado, verificador: 'v', nonce: 'n' } };
    },
    async concluirLogin(url, verificacao) {
      if (url.searchParams.get('state') !== verificacao.estado) throw Object.assign(new Error('state inválido'), { code: 'OAUTH_INVALID_RESPONSE' });
      const claims = identidades.get(url.searchParams.get('code'));
      if (!claims) throw Object.assign(new Error('código inválido'), { code: 'OAUTH_INVALID_GRANT' });
      return claims;
    },
  };
}

export async function iniciarServidor({ pool, provedor, env = {} }) {
  const servidor = criarApp({ pool, config: configDeTeste(env), provedor }).listen(0, '127.0.0.1');
  await new Promise((ok) => servidor.once('listening', ok));
  return { url: `http://127.0.0.1:${servidor.address().port}`, fechar: () => new Promise((ok) => servidor.close(ok)) };
}

export class Navegador {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async pedir(caminho, { method = 'GET', form } = {}) {
    const headers = { accept: 'text/html' };
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const r = await fetch(new URL(caminho, this.base), { method, headers, body, redirect: 'manual' });
    const setCookie = r.headers.getSetCookie();
    for (const c of setCookie) {
      const [par] = c.split(';');
      this.cookie = par.endsWith('=') ? '' : par; // cookie limpo no logout
    }
    const texto = await r.text();
    return { status: r.status, headers: r.headers, texto, setCookie, local: r.headers.get('location') };
  }

  // Token CSRF da última página HTML recebida.
  static csrf(html) {
    return html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  }

  // Fluxo completo de login com o provedor falso.
  async entrar(provedor, claims) {
    const codigo = `codigo-${Math.random().toString(36).slice(2)}`;
    provedor.identidades.set(codigo, claims);
    const inicio = await this.pedir('/auth/login');
    const estado = new URL(inicio.local).searchParams.get('state');
    return this.pedir(`/auth/callback?code=${codigo}&state=${estado}`);
  }
}
