// Regras da preparação de entregas (RF-040, RF-041; RN-16 a RN-22). Funções puras.
import { z } from 'zod';
import { ErroValidacao } from '../../infra/erros.js';

export const STATUS = Object.freeze({
  PREPARADA: 'Aguardando assinatura', ASSINADA: 'Assinada', CANCELADA: 'Cancelada', ESTORNADA: 'Estornada',
});
export const FORMAS_IDENTIFICACAO = Object.freeze({ MATRICULA_DIGITADA: 'Matrícula digitada', QR_CODE: 'QR code' });
export const MAXIMO_TITULOS = 30;

const uuid = z.uuid();

// Títulos escolhidos (um exemplar de cada, RN-16 e RN-17). Aceita um valor ou uma lista do formulário.
export function validarSelecao(valor) {
  const lista = (Array.isArray(valor) ? valor : valor ? [valor] : []).map(String);
  if (!lista.length) throw new ErroValidacao('Corrija os campos indicados.', { titulos: 'Escolha pelo menos um livro.' });
  if (lista.length > MAXIMO_TITULOS) throw new ErroValidacao('Corrija os campos indicados.', { titulos: `No máximo ${MAXIMO_TITULOS} livros por entrega.` });
  if (!lista.every((id) => uuid.safeParse(id).success)) throw new ErroValidacao('Corrija os campos indicados.', { titulos: 'Seleção inválida.' });
  return [...new Set(lista)];
}

// RN-19 / CA-040.3: cada título escolhido precisa de saldo no campus.
export function exigirSaldo(selecao, saldos) {
  const sem = selecao.filter((id) => !(saldos.get(id) > 0));
  if (sem.length) {
    throw new ErroValidacao('Corrija os campos indicados.', { titulos: 'Há livro sem exemplar disponível no estoque. Atualize a página e escolha de novo.' });
  }
}

// RN-18 (CA-041.1): avisos que o operador precisa confirmar. Devolve a lista a registrar na entrega (CA-041.4).
// Pendência vencida (RN-21) entra com o cálculo de prazos (RF-061); adoções (RN-20), com RF-022.
export function avisosDaSelecao(selecao, emPosse) {
  return selecao.filter((id) => emPosse.has(id)).map((tituloId) => ({ tipo: 'TITULO_EM_POSSE', tituloId }));
}

export function exigirConfirmacao(avisos, confirmado) {
  if (avisos.length && !confirmado) {
    throw new ErroValidacao('Confirme os avisos para continuar.', {
      confirmacao: 'O estudante já tem em posse livro(s) escolhido(s). Confirme para entregar mesmo assim.', avisos,
    });
  }
}

// RN-03: cópia dos dados na data da operação (o termo e o histórico não mudam depois).
export const snapshotEstudante = (e, v) => ({
  nome: e.nome, matricula: e.matricula, curso: v.curso, serie: v.serie, anoLetivo: v.ano_letivo,
});
export const snapshotUnidade = (c) => ({
  nomeOficial: c.nome_oficial, nomeCurto: c.nome_curto, endereco: c.endereco, cidade: c.cidade, uf: c.uf, cep: c.cep,
  setorResponsavel: c.setor_responsavel, emailSetor: c.email_setor, telefone: c.telefone,
});
