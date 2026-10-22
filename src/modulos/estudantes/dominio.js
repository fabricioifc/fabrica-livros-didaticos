// Regras do cadastro de estudantes e da planilha de importação (RF-030 a RF-033; RN-06, RN-08, RN-11, RN-46).
// Funções puras. Formato da planilha (proposta enquanto DV-11/DP-03 não for decidida; troca só aqui):
// CSV com cabeçalho, separador ";" ou ",", UTF-8 ou Windows-1252 (Excel), colunas
// matricula; nome; email; curso; serie; ano_letivo (nomes sem diferenciar maiúsculas e acentos).
import { z } from 'zod';
import { ErroValidacao } from '../../infra/erros.js';

export const SITUACOES = Object.freeze({
  ATIVO: 'Ativo', CONCLUIDO: 'Concluído', TRANSFERIDO: 'Transferido', EVADIDO: 'Evadido', CANCELADO: 'Cancelado',
});
export const SITUACOES_ENCERRAMENTO = Object.freeze(['CONCLUIDO', 'TRANSFERIDO', 'EVADIDO', 'CANCELADO']);

export const COLUNAS_PLANILHA = Object.freeze(['matricula', 'nome', 'email', 'curso', 'serie', 'ano_letivo']);
export const LIMITE_LINHAS = 5000;
export const LIMITE_BYTES = 2 * 1024 * 1024;

// Nomes aceitos no cabeçalho para cada coluna (comparados sem acentos, maiúsculas, espaços e pontuação).
const SINONIMOS = {
  matricula: ['matricula'],
  nome: ['nome', 'nomedoestudante', 'nomecompleto'],
  email: ['email', 'emailinstitucional'],
  curso: ['curso'],
  serie: ['serie', 'ano', 'anodocurso'],
  ano_letivo: ['anoletivo'],
};

const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const normalizarMatricula = (s) => String(s ?? '').trim().replace(/\s+/g, '').toUpperCase();
export const normalizarEmail = (s) => String(s ?? '').trim().toLowerCase();
export const normalizarNome = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
export const chaveDeCurso = chave;

// "1", "1ª", "1º", "1ª série", "1 ano" → 1 a 4 (DP-17); outro valor → null.
export function lerSerie(s) {
  const m = /^([1-4])[oa]?(serie|ano)?$/.exec(chave(s));
  return m ? Number(m[1]) : null;
}

const MATRICULA = /^[0-9A-Z][0-9A-Z./-]{2,29}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;

// E-mail precisa estar num domínio de estudantes ativo (configuração, não literal — regra 16).
export const dominioDe = (email) => email.slice(email.lastIndexOf('@') + 1);

// Valida os dados de um estudante já com curso e ano letivo resolvidos para ids do campus.
// Devolve { dados } ou { erros: { campo: mensagem } }.
export function validarDadosEstudante({ matricula, nome, email, cursoId, periodoId, serie }, { dominiosEstudante }) {
  const erros = {};
  const d = { matricula: normalizarMatricula(matricula), nome: normalizarNome(nome), email: normalizarEmail(email), cursoId, periodoId, serie };
  if (!MATRICULA.test(d.matricula)) erros.matricula = 'Matrícula inválida: use de 3 a 30 letras, números, ponto, barra ou hífen.';
  if (d.nome.length < 3 || d.nome.length > 200) erros.nome = 'Informe o nome completo (3 a 200 caracteres).';
  if (!EMAIL.test(d.email) || d.email.length > 200) erros.email = 'E-mail inválido.';
  else if (!dominiosEstudante.includes(dominioDe(d.email))) erros.email = 'Use o e-mail institucional de estudante.';
  if (!cursoId) erros.curso = 'Escolha um curso ativo do campus.';
  if (!periodoId) erros.anoLetivo = 'Escolha um ano letivo cadastrado no campus.';
  if (!Number.isInteger(serie) || serie < 1 || serie > 4) erros.serie = 'Série inválida: use de 1 a 4.';
  return Object.keys(erros).length ? { erros } : { dados: d };
}

// ===== Planilha =====

// UTF-8 (com ou sem BOM); se não for UTF-8 válido, Windows-1252 (padrão do Excel em português).
export function decodificarArquivo(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

// CSV com aspas (RFC 4180). Devolve as linhas como listas de campos, com o número da linha no arquivo.
export function lerCsv(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const separador = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas = [];
  let campos = [];
  let campo = '';
  let aspas = false;
  let numero = 1;
  let inicio = 1;
  const fecharLinha = () => {
    campos.push(campo);
    if (campos.some((c) => c.trim() !== '')) linhas.push({ numero: inicio, campos });
    campos = [];
    campo = '';
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else { if (c === '\n') numero++; campo += c; }
    } else if (c === '"') aspas = true;
    else if (c === separador) { campos.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fecharLinha();
      numero++;
      inicio = numero;
    } else campo += c;
  }
  if (campo !== '' || campos.length) fecharLinha();
  return linhas;
}

// Cabeçalho → posição de cada coluna esperada. Lança ErroValidacao se faltar alguma.
export function mapearCabecalho(campos) {
  const chaves = campos.map(chave);
  const posicoes = {};
  const faltando = [];
  for (const coluna of COLUNAS_PLANILHA) {
    const i = chaves.findIndex((k) => SINONIMOS[coluna].includes(k));
    if (i < 0) faltando.push(coluna);
    else posicoes[coluna] = i;
  }
  if (faltando.length) {
    throw new ErroValidacao(`A primeira linha deve ter os nomes das colunas. Faltando: ${faltando.join(', ')}.`, {
      erros: [{ linha: 1, mensagem: `Colunas obrigatórias: ${COLUNAS_PLANILHA.join('; ')}. Faltando: ${faltando.join(', ')}.` }],
    });
  }
  return posicoes;
}

// Encerramento do vínculo (RF-033): situação e data (não futura, não anterior ao início).
const esquemaEncerramento = z.object({
  situacao: z.enum(SITUACOES_ENCERRAMENTO, { error: 'Escolha o motivo do encerramento.' }),
  fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data do encerramento.'),
});

export function validarEncerramento(entrada, { inicio, hoje }) {
  const r = esquemaEncerramento.safeParse(entrada);
  const erros = {};
  if (!r.success) for (const issue of r.error.issues) erros[issue.path[0]] ??= issue.message;
  const fim = r.success ? r.data.fim : null;
  if (fim && fim < inicio) erros.fim = 'A data do encerramento não pode ser anterior ao início do vínculo.';
  if (fim && fim > hoje) erros.fim = 'A data do encerramento não pode ser futura.';
  if (Object.keys(erros).length) throw new ErroValidacao('Corrija os campos indicados.', erros);
  return r.data;
}
