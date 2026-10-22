// Termo de compromisso (RF-080; RN-29). Funções puras.
// O texto pode ter marcadores, trocados pelos dados da entrega no termo assinado (RF-081).
import { ErroValidacao } from '../../infra/erros.js';

export const MARCADORES = Object.freeze({
  estudante: 'nome do estudante',
  matricula: 'matrícula',
  curso: 'curso',
  serie: 'série',
  campus: 'nome oficial do campus',
  livros: 'lista dos livros entregues',
  data: 'data da entrega',
});

// Dados FICTÍCIOS para a pré-visualização do texto.
export const EXEMPLO = Object.freeze({
  estudante: 'Estudante Exemplo (fictício)', matricula: '0000000', curso: 'Curso Exemplo', serie: '1ª série',
  campus: 'Campus Exemplo', livros: 'Livro Exemplo 1; Livro Exemplo 2', data: '01/03/2027',
});

const MINIMO = 50;
const MAXIMO = 20000;

// Normaliza quebras de linha e espaços nas pontas; recusa texto curto, longo ou com marcador desconhecido.
export function validarTexto(entrada) {
  const texto = String(entrada ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (texto.length < MINIMO) throw new ErroValidacao('Corrija os campos indicados.', { texto: `Informe o texto completo do termo (pelo menos ${MINIMO} caracteres).` });
  if (texto.length > MAXIMO) throw new ErroValidacao('Corrija os campos indicados.', { texto: `No máximo ${MAXIMO} caracteres.` });
  const desconhecidos = [...new Set([...texto.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).filter((m) => !(m in MARCADORES)))];
  if (desconhecidos.length) {
    throw new ErroValidacao('Corrija os campos indicados.', {
      texto: `Marcador desconhecido: ${desconhecidos.map((m) => `{${m}}`).join(', ')}. Use apenas ${Object.keys(MARCADORES).map((m) => `{${m}}`).join(', ')}.`,
    });
  }
  return texto;
}

// Troca os marcadores pelos dados (texto puro; o escape para HTML é feito pelo template).
export const preencher = (texto, dados) => texto.replace(/\{([^{}\s]+)\}/g, (inteiro, m) => (m in dados ? String(dados[m]) : inteiro));

// Parágrafos (separados por linha em branco), cada um com suas linhas, para exibir sem HTML no texto.
export const paragrafos = (texto) => texto.split(/\n{2,}/).map((p) => p.split('\n'));
