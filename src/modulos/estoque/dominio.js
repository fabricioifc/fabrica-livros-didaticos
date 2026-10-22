// Regras das movimentações manuais de estoque (RF-025, RF-026; RN-69 a RN-72). Funções puras.
// Entregas, devoluções e estornos geram movimentações próprias nas etapas seguintes (RF-040+).
import { z } from 'zod';
import { ErroValidacao } from '../../infra/erros.js';

export const TIPOS_MANUAIS = Object.freeze({
  ENTRADA: { rotulo: 'Entrada', titulo: 'Registrar entrada', caminho: 'entrada', sucesso: 'Entrada registrada.' },
  BAIXA: { rotulo: 'Baixa', titulo: 'Registrar baixa', caminho: 'baixa', sucesso: 'Baixa registrada.' },
  AJUSTE: { rotulo: 'Ajuste de inventário', titulo: 'Ajustar inventário', caminho: 'ajuste', sucesso: 'Ajuste registrado.' },
});

export const ROTULOS_TIPO = Object.freeze({
  ENTRADA: 'Entrada', ENTREGA: 'Entrega', DEVOLUCAO: 'Devolução', BAIXA: 'Baixa', AJUSTE: 'Ajuste de inventário', ESTORNO: 'Estorno',
});

export const tipoPorCaminho = (caminho) => Object.keys(TIPOS_MANUAIS).find((t) => TIPOS_MANUAIS[t].caminho === caminho) ?? null;

const QUANTIDADE_MAXIMA = 100000;

const quantidade = z.string().trim()
  .refine((s) => /^\d{1,6}$/.test(s) && Number(s) >= 1 && Number(s) <= QUANTIDADE_MAXIMA, `Informe uma quantidade entre 1 e ${QUANTIDADE_MAXIMA}.`)
  .transform(Number);
const textoObrigatorio = (rotulo, max) => z.string().trim().min(3, `Informe ${rotulo}.`).max(max, `No máximo ${max} caracteres.`);

const esquemas = {
  // RN-69: título, quantidade e origem (ex.: recebimento do PNLD, doação).
  ENTRADA: z.object({ quantidade, origem: textoObrigatorio('a origem', 200) })
    .transform((d) => ({ quantidade: d.quantidade, origem: d.origem, justificativa: null })),
  // RN-70: baixa sempre retira, com justificativa (CA-026.1).
  BAIXA: z.object({ quantidade, justificativa: textoObrigatorio('a justificativa', 500) })
    .transform((d) => ({ quantidade: -d.quantidade, origem: null, justificativa: d.justificativa })),
  // RN-71: diferença da contagem física, para mais ou para menos, com justificativa.
  AJUSTE: z.object({
    quantidade,
    sentido: z.enum(['ACRESCIMO', 'REDUCAO'], { error: 'Escolha se a contagem encontrou livros a mais ou a menos.' }),
    justificativa: textoObrigatorio('a justificativa', 500),
  }).transform((d) => ({ quantidade: d.sentido === 'REDUCAO' ? -d.quantidade : d.quantidade, origem: null, justificativa: d.justificativa })),
};

// Devolve { tipo, quantidade (com sinal), origem, justificativa } ou lança ErroValidacao com erros por campo.
export function validarMovimentacao(tipo, entrada) {
  const esquema = esquemas[tipo];
  if (!esquema) throw new ErroValidacao('Tipo de movimentação inválido.');
  const r = esquema.safeParse(entrada);
  if (!r.success) {
    const porCampo = {};
    for (const issue of r.error.issues) porCampo[issue.path[0] ?? 'geral'] ??= issue.message;
    throw new ErroValidacao('Corrija os campos indicados.', porCampo);
  }
  return { tipo, ...r.data };
}

// RN-72 / CA-026.2: nenhuma movimentação deixa o saldo negativo.
export function exigirSaldoSuficiente(disponivel, quantidade) {
  if (disponivel + quantidade < 0) {
    throw new ErroValidacao('Corrija os campos indicados.', {
      quantidade: `Saldo insuficiente: há ${disponivel} exemplar(es) disponível(is) e a operação retiraria ${-quantidade}.`,
    });
  }
}
