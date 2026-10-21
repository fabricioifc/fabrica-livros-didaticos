// Proteções HTTP: cabeçalhos (CSP), sessão em cookie seguro, CSRF e "no-store" (AGENTS.md 5.4 e 9.5).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { ErroProibido } from '../erros.js';

export function cabecalhosDeSeguranca() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
      },
    },
  });
}

export const NOME_COOKIE = 'livros.sid';

export function sessoes({ pool, segredo, producao, inatividadeMinutos }) {
  const Armazenamento = connectPgSimple(session);
  return session({
    name: NOME_COOKIE,
    secret: segredo,
    store: new Armazenamento({ pool, tableName: 'sessao', createTableIfMissing: false, pruneSessionInterval: producao ? 15 * 60 : false }),
    resave: false,
    saveUninitialized: false,
    rolling: true, // expiração por inatividade
    cookie: { httpOnly: true, sameSite: 'lax', secure: producao, maxAge: inatividadeMinutos * 60 * 1000 },
  });
}

// Páginas com dados pessoais não ficam no cache do navegador (RNF-028).
export function semCache(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

// CSRF por token sincronizado na sessão; todo POST exige o campo _csrf.
export function protecaoCsrf(req, res, next) {
  if (req.session && !req.session.csrf) req.session.csrf = randomBytes(32).toString('base64url');
  res.locals.csrfToken = req.session?.csrf ?? '';
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const enviado = Buffer.from(String(req.body?._csrf ?? ''));
  const esperado = Buffer.from(req.session?.csrf ?? '');
  if (esperado.length === 0 || enviado.length !== esperado.length || !timingSafeEqual(enviado, esperado)) {
    return next(new ErroProibido('Sua sessão expirou ou o formulário é inválido. Recarregue a página e tente novamente.'));
  }
  next();
}
