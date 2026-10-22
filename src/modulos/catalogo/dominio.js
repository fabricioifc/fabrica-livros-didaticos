// Regras do catálogo de títulos (RF-020; RN-73 a RN-75). Funções puras.
import { z } from 'zod';
import { ErroValidacao } from '../../infra/erros.js';

export const ABRANGENCIAS = Object.freeze({
  SERIE_ESPECIFICA: 'Série específica',
  ENSINO_MEDIO_COMPLETO: 'Ensino médio completo (uso nos três anos)',
});

// ISBN-10 ou ISBN-13 (com ou sem hífens/espaços) → ISBN-13 normalizado; vazio → null.
// Lança Error com mensagem para o usuário quando o número não é válido.
export function normalizarIsbn(texto) {
  const s = String(texto ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (s === '') return null;
  if (/^\d{9}[\dX]$/.test(s)) {
    const soma = [...s].reduce((acc, c, i) => acc + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    if (soma % 11 !== 0) throw new Error('ISBN inválido: confira os dígitos.');
    return comDigitoIsbn13(`978${s.slice(0, 9)}`);
  }
  if (/^97[89]\d{10}$/.test(s)) {
    if (comDigitoIsbn13(s.slice(0, 12)) !== s) throw new Error('ISBN inválido: confira os dígitos.');
    return s;
  }
  throw new Error('ISBN inválido: use 10 ou 13 dígitos (ex.: 978-85-0000-000-0).');
}

function comDigitoIsbn13(doze) {
  const soma = [...doze].reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return `${doze}${(10 - (soma % 10)) % 10}`;
}

// Apresentação: 978-85-0000-000-0 não é inferível sem tabela de grupos; usa blocos 3-10.
export const formatarIsbn = (isbn13) => (isbn13 ? `${isbn13.slice(0, 3)}-${isbn13.slice(3)}` : '');

const opcional = (max, rotulo) => z.string().trim().max(max, `${rotulo}: no máximo ${max} caracteres.`).transform((s) => s || null);

export const esquemaTitulo = z.object({
  titulo: z.string().trim().min(2, 'Informe o título.').max(300, 'Título: no máximo 300 caracteres.'),
  autores: z.string().trim().min(2, 'Informe os autores.').max(300, 'Autores: no máximo 300 caracteres.'),
  isbn: z.string().transform((s, ctx) => {
    try {
      return normalizarIsbn(s);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: e.message });
      return z.NEVER;
    }
  }),
  editora: opcional(150, 'Editora'),
  edicao: opcional(50, 'Edição'),
  volume: opcional(50, 'Volume'),
  anoPublicacao: z.string().trim().refine((s) => s === '' || (/^\d{4}$/.test(s) && Number(s) >= 1900 && Number(s) <= 2100), 'Ano de publicação: entre 1900 e 2100.')
    .transform((s) => (s === '' ? null : Number(s))),
  componente: opcional(100, 'Componente curricular'),
  codigoPrograma: opcional(50, 'Código do programa'),
});

// RN-74 / CA-020.2: série obrigatória (1 a 4) só para série específica; validada à parte para que o
// erro apareça junto com os dos demais campos (o zod não roda refinamentos se algum campo falhar).
const esquemaAbrangencia = z.object({
  abrangencia: z.enum(Object.keys(ABRANGENCIAS), { error: 'Escolha a abrangência.' }),
  serie: z.string().trim(),
}).transform((d, ctx) => {
  if (d.abrangencia !== 'SERIE_ESPECIFICA') return { abrangencia: d.abrangencia, serie: null };
  if (!/^[1-4]$/.test(d.serie)) {
    ctx.addIssue({ code: 'custom', path: ['serie'], message: 'Informe a série (1 a 4) para livro de série específica.' });
    return z.NEVER;
  }
  return { abrangencia: d.abrangencia, serie: Number(d.serie) };
});

export function validarTitulo(entrada) {
  const resultados = [esquemaTitulo.safeParse(entrada), esquemaAbrangencia.safeParse(entrada)];
  const porCampo = {};
  for (const r of resultados) {
    if (!r.success) for (const issue of r.error.issues) porCampo[issue.path[0] ?? 'geral'] ??= issue.message;
  }
  if (Object.keys(porCampo).length) throw new ErroValidacao('Corrija os campos indicados.', porCampo);
  return { ...resultados[0].data, ...resultados[1].data };
}
