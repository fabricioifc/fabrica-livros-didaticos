// Formulários com arquivo (multipart/form-data), sem dependência externa: usa o leitor de
// formulários nativo do Node (Request.formData). Campos de texto vão para req.body (para o CSRF
// funcionar igual aos demais formulários) e arquivos para req.arquivos = { campo: { nome, conteudo } }.
import express from 'express';
import { ErroValidacao } from '../erros.js';

export function formularioComArquivo({ limiteBytes = 3 * 1024 * 1024 } = {}) {
  const lerCorpo = express.raw({ type: 'multipart/form-data', limit: limiteBytes });
  return (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    lerCorpo(req, res, async (err) => {
      if (err) {
        return next(err.type === 'entity.too.large'
          ? new ErroValidacao('Arquivo grande demais.', { arquivo: 'Arquivo grande demais. Divida a planilha.' })
          : err);
      }
      try {
        const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const dados = await new Request('http://formulario.local', {
          method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: corpo,
        }).formData();
        req.body = {};
        req.arquivos = {};
        for (const [campo, valor] of dados.entries()) {
          if (typeof valor === 'string') req.body[campo] = valor;
          else req.arquivos[campo] = { nome: valor.name, conteudo: Buffer.from(await valor.arrayBuffer()) };
        }
        next();
      } catch {
        next(new ErroValidacao('Formulário inválido.'));
      }
    });
  };
}
