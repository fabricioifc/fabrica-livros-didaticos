// Auxiliares comuns às rotas dos módulos.
import { ErroNaoEncontrado, ErroProibido } from '../erros.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Identificador malformado na URL é tratado como inexistente (404), sem detalhes.
export function idDaUrl(valor) {
  if (!UUID.test(valor)) throw new ErroNaoEncontrado();
  return valor;
}

// Áreas de servidor: sem sessão volta para o início; estudante é proibido (CA-006.2).
export function exigirServidor(req, res, next) {
  if (!req.contexto) return res.redirect(303, '/');
  if (req.contexto.usuario.tipo !== 'SERVIDOR') return next(new ErroProibido());
  next();
}

// Mensagem de resultado exibida uma única vez após um redirecionamento (padrão POST → GET).
export function avisar(req, tipo, titulo, corpo = null) {
  req.session.aviso = { tipo, titulo, corpo };
}

// Torna o aviso disponível às telas e o consome no GET seguinte.
export function consumirAviso(req, res, next) {
  res.locals.aviso = req.session?.aviso ?? null;
  if (req.session?.aviso && req.method === 'GET') delete req.session.aviso;
  next();
}
