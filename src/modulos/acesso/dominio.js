// Regras do módulo de acesso: funções puras, sem banco nem HTTP (docs/architecture.md, seção 3.2).
// Referências: AGENTS.md seções 5 e 6; docs/requirements.md RF-001 a RF-005.
import { ErroNaoAutenticado, ErroValidacao } from '../../infra/erros.js';

export const PAPEIS = Object.freeze(['ADMIN_INSTITUCIONAL', 'ADMIN_CAMPUS', 'OPERADOR', 'CONSULTA']);

// RF-001 (CA-001.1 a CA-001.3): decide se uma identidade do Google pode entrar e com qual tipo.
// `claims`: { sub, email, email_verified, hd, name }; `dominios`: linhas de dominio_permitido.
export function classificarIdentidade(claims, dominios) {
  if (!claims?.sub || typeof claims.email !== 'string') {
    throw new ErroNaoAutenticado('Identidade incompleta.', 'IDENTIDADE_INVALIDA');
  }
  if (claims.email_verified !== true) {
    throw new ErroNaoAutenticado('E-mail não verificado pelo provedor.', 'EMAIL_NAO_VERIFICADO');
  }
  const email = claims.email.trim().toLowerCase();
  const partes = email.split('@');
  if (partes.length !== 2 || !partes[0]) {
    throw new ErroNaoAutenticado('E-mail inválido.', 'IDENTIDADE_INVALIDA');
  }
  const dominio = partes[1];
  const permitido = dominios.find((d) => d.ativo && d.dominio === dominio);
  // O domínio do Workspace (hd) precisa coincidir exatamente com o do e-mail.
  if (!permitido || String(claims.hd ?? '').toLowerCase() !== dominio) {
    throw new ErroNaoAutenticado('Use sua conta institucional do IFC.', 'DOMINIO_NAO_PERMITIDO');
  }
  const nome = String(claims.name ?? '').trim() || email;
  return { sub: String(claims.sub), email, nome, tipo: permitido.tipo };
}

export const vigentes = (atribuicoes) => atribuicoes.filter((a) => !a.revogada_em);

export const ehAdminInstitucional = (atribuicoes) =>
  vigentes(atribuicoes).some((a) => a.papel === 'ADMIN_INSTITUCIONAL');

export const papeisNoCampus = (atribuicoes, campusId) =>
  new Set(vigentes(atribuicoes).filter((a) => a.campus_id === campusId).map((a) => a.papel));

// Escopo aplicado no banco (RLS): derivado só das atribuições vigentes.
export function escopoDoUsuario(usuarioId, atribuicoes) {
  const ativas = vigentes(atribuicoes);
  return {
    usuarioId,
    campi: [...new Set(ativas.filter((a) => a.campus_id).map((a) => a.campus_id))],
    escopoInstitucional: ativas.some((a) => a.campus_id == null),
    adminInstitucional: ehAdminInstitucional(ativas),
  };
}

// RF-003: aprovar/recusar solicitações do campus.
export function podeDecidirSolicitacao(atribuicoes, campusId) {
  return ehAdminInstitucional(atribuicoes) || papeisNoCampus(atribuicoes, campusId).has('ADMIN_CAMPUS');
}

export function validarPapelEscopo(papel, campusId) {
  if (!PAPEIS.includes(papel)) throw new ErroValidacao('Papel inválido.');
  if (papel === 'ADMIN_INSTITUCIONAL' && campusId) {
    throw new ErroValidacao('Administrador institucional não tem campus.');
  }
  if ((papel === 'ADMIN_CAMPUS' || papel === 'OPERADOR') && !campusId) {
    throw new ErroValidacao('Este papel exige um campus.');
  }
}

// RF-004, matriz AGENTS.md 6.2: quem concede (ou revoga) cada papel.
export function podeConcederPapel(atribuicoes, papel, campusId) {
  validarPapelEscopo(papel, campusId);
  if (ehAdminInstitucional(atribuicoes)) return true;
  const institucional = papel === 'ADMIN_INSTITUCIONAL' || papel === 'ADMIN_CAMPUS' || campusId == null;
  if (institucional) return false;
  return papeisNoCampus(atribuicoes, campusId).has('ADMIN_CAMPUS');
}
