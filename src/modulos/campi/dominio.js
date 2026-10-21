// Validação e normalização dos dados de campus (RF-010, RF-011). Funções puras.
import { z } from 'zod';
import { ErroValidacao } from '../../infra/erros.js';

// Texto opcional: espaços nas pontas removidos; vazio vira null.
const opcional = (max, rotulo) =>
  z.string().trim().max(max, `${rotulo}: no máximo ${max} caracteres.`).transform((s) => s || null);

const nomeOficial = z.string().trim().min(5, 'Informe o nome oficial (mínimo 5 caracteres).').max(200, 'Nome oficial: no máximo 200 caracteres.');
const nomeCurto = z.string().trim().min(2, 'Informe o nome curto (mínimo 2 caracteres).').max(60, 'Nome curto: no máximo 60 caracteres.');
export const codigo = z.string().trim().toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, 'Código: de 2 a 10 letras ou números, sem espaços (ex.: FRA).');

export const esquemaNovoCampus = z.object({ codigo, nomeOficial, nomeCurto });

export const esquemaConfiguracao = z.object({
  codigo: codigo.optional(),
  nomeOficial,
  nomeCurto,
  endereco: opcional(200, 'Endereço'),
  cidade: opcional(100, 'Cidade'),
  uf: z.string().trim().toUpperCase().refine((s) => s === '' || /^[A-Z]{2}$/.test(s), 'UF: duas letras (ex.: SC).').transform((s) => s || null),
  // Aceita "89580-000" ou "89580000".
  cep: z.string().trim().transform((s) => s.replace(/\D/g, '')).refine((s) => s === '' || s.length === 8, 'CEP: 8 dígitos.').transform((s) => s || null),
  setorResponsavel: opcional(100, 'Setor responsável'),
  emailSetor: z.string().trim().refine((s) => s === '' || z.email().safeParse(s).success, 'E-mail do setor inválido.').transform((s) => s.toLowerCase() || null),
  telefone: opcional(30, 'Telefone'),
  permiteEntregaComPendencia: z.boolean(),
});

// Valida e devolve os dados; em erro, lança ErroValidacao com { campo: mensagem } em `detalhes`.
export function validarCampus(esquema, entrada) {
  const r = esquema.safeParse(entrada);
  if (r.success) return r.data;
  const porCampo = {};
  for (const issue of r.error.issues) porCampo[issue.path[0] ?? 'geral'] ??= issue.message;
  throw new ErroValidacao('Corrija os campos indicados.', porCampo);
}
