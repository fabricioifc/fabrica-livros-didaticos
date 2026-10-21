// BACKLOG DE TESTES — funcionalidades ainda NÃO implementadas.
// Aparecem como "todo" na saída do node:test; NÃO contam como aprovados.
// Ao implementar a funcionalidade, mova o teste para test/unit ou test/integration
// e escreva as asserções reais. Já implementados: módulo de acesso (test/integration/acesso-*.test.js). IDs: docs/business-rules.md (RN) e docs/requirements.md (CA).
import { describe, test } from 'node:test';

describe('PENDENTE — isolamento entre campi (obrigatório; AGENTS.md seção 13)', () => {
  test.todo('usuário do campus A pede entrega/estudante/estoque do campus B por ID → 404 (CA-095.1)');
  test.todo('listagens, buscas e autocompletes do campus A não retornam dados do campus B (CA-095.1)');
  test.todo('gravar com campus_id do campus B por usuário do campus A → 403 e auditoria (CA-095.2)');
  test.todo('trocar campus de trabalho, campo oculto ou URL para campus não atribuído → 403 (CA-095.3)');
  test.todo('entrega do campus A referenciando vínculo do campus B é recusada também pelo banco (FK composta)');
  test.todo('RLS das tabelas de estoque, estudantes, entregas e devoluções (as do módulo de acesso já são testadas)');
  test.todo('relatórios, pendências, históricos e documentos respeitam o escopo do usuário (CA-070.2)');
  test.todo('exportação CSV respeita filtros e escopo (CA-071.1)');
  test.todo('catálogo é visível a todos, mas estoque e movimentações de outro campus não (RN-73, CA-027.2)');
  test.todo('relatório consolidado só para perfis institucionais; total = soma dos campi (CA-072.1, CA-072.2)');
  test.todo('admin institucional não registra entrega sem atribuição de campus (AGENTS.md 6.1)');
});

describe('PENDENTE — autenticação, sessão e permissões', () => {
  test.todo('rotas protegidas sem sessão redirecionam ao login (RNF-001)');
  test.todo('callback OIDC valida o ID token (assinatura, emissor, audiência, nonce, PKCE) antes de classificar o domínio (RF-001)');
  test.todo('rotas: servidor com solicitação pendente só vê a tela de aguardo (CA-002.1)');
  test.todo('rotas: revogação vale na próxima requisição HTTP, sem esperar o fim da sessão (CA-004.1)');
  test.todo('sessão encerrada (logout) não pode ser reutilizada (CA-008.1)');
  test.todo('matriz de permissões AGENTS.md 6.2 testada por ação × papel × escopo');
  test.todo('Consulta e Estudante não preparam entrega nem por requisição direta (CA-040.7)');
  test.todo('estudante vê só os próprios dados e não tem ação de escrita (CA-064.2, CA-064.3)');
  test.todo('após logout, voltar pelo navegador não mostra dados; respostas com dados pessoais têm no-store (RNF-028)');
});

describe('PENDENTE — identificação do estudante', () => {
  test.todo('matrícula digitada mostra nome, curso e turma; sem vínculo ativo no campus não avança (RN-77, CA-046.1, CA-046.2)');
  test.todo('QR code válido identifica o estudante (RN-78, CA-047.1)');
  test.todo('QR adulterado, de outra chave, de outro sistema ou de versão antiga é recusado (RN-78, CA-047.2)');
  test.todo('QR de estudante de outro campus não abre atendimento (RN-77, CA-095.1)');
});

describe('PENDENTE — entrega e assinatura', () => {
  test.todo('preparar entrega exige vínculo ativo no campus (RN-14, CA-040.1)');
  test.todo('um exemplar por título, sem título repetido na entrega (RN-16, RN-17, CA-040.2)');
  test.todo('título sem saldo não pode ser incluído (RN-19, CA-040.3)');
  test.todo('segunda entrega preparada para o mesmo estudante é recusada (RN-22, CA-040.4)');
  test.todo('entrega permitida em qualquer data, associada ao período do vínculo (RN-15, CA-040.5)');
  test.todo('preparação não altera o estoque (RN-13, CA-040.6)');
  test.todo('avisos: título já em posse, fora das adoções, pendência vencida; confirmação registrada (RN-18, RN-20, RN-21, CA-041.1 a CA-041.4)');
  test.todo('campus configurado para bloquear pendência vencida bloqueia a entrega (RN-21)');
  test.todo('modo assinatura mostra só estudante, campus, termo, livros e área de assinatura (RN-31, CA-042.1)');
  test.todo('assinatura em branco é recusada (RN-32, CA-042.3)');
  test.todo('assinatura baixa o estoque, grava assinatura e termo na mesma transação (RN-27, CA-042.4)');
  test.todo('saldo insuficiente na assinatura → nada é gravado (RN-27, CA-042.4)');
  test.todo('evidências da assinatura gravadas: imagem, traçado, servidor, forma de identificação, versão, hash (RN-33, CA-042.5)');
  test.todo('assinatura dupla é impossível (RN-33, CA-042.6)');
  test.todo('duas assinaturas simultâneas não deixam saldo negativo (RNF-020)');
  test.todo('cancelar entrega preparada não altera estoque (RN-25, CA-043.1)');
  test.todo('estorno: operador só os próprios registros; admin do campus qualquer; justificativa obrigatória (RN-28, CA-044.1, CA-044.2)');
  test.todo('entrega com devolução registrada não pode ser estornada (RN-28, CA-044.3)');
  test.todo('estorno devolve o estoque e mantém o termo marcado como estornado (RN-28, CA-044.4)');
});

describe('PENDENTE — devolução, perdas e danos', () => {
  test.todo('só itens de entregas assinadas do próprio campus e ainda em posse aparecem (RN-37, RN-38, CA-050.1)');
  test.todo('devolução em outro campus é recusada (RN-37, CA-050.6)');
  test.todo('devolução parcial permitida; acima do entregue recusada (RN-39, CA-050.2)');
  test.todo('"devolvido" volta ao estoque; "perdido" não volta (RN-40, CA-050.4)');
  test.todo('danificado e perdido sem justificativa são recusados (RN-66, CA-053.1)');
  test.todo('perda/dano justificado encerra a posse sem bloqueio nem reposição (RN-41, RN-67, CA-053.3)');
  test.todo('erro no meio da devolução não deixa estoque ou posse inconsistentes (rollback)');
  test.todo('estorno de devolução desfaz o estoque e reabre a posse (RN-43, CA-052.2)');
  test.todo('comprovante gerado com campus, livros, resultados e servidor (RN-42, CA-051.1)');
});

describe('PENDENTE — prazos, pendências e histórico', () => {
  test.todo('em posse = entregue (assinado, não estornado) − devolvido com qualquer resultado (RN-48, CA-060.1)');
  test.todo('estudante sem movimentações não tem posse nem pendência');
  test.todo('prazo de série específica = fim do período letivo da entrega (RN-44, CA-061.1)');
  test.todo('prazo de ensino médio completo = fim do período da 3ª série (RN-45, CA-061.2)');
  test.todo('vínculo encerrado antecipa o prazo de todos os livros em posse (RN-46, CA-061.3)');
  test.todo('fronteira de prazo: 23:59:59 do último dia, fuso America/Sao_Paulo (CA-061.5)');
  test.todo('sem tolerância nem prorrogação (RN-47, CA-061.4)');
  test.todo('pendência só aparece após o prazo; antes é "em posse, no prazo" (RN-49)');
  test.todo('devoluções parciais múltiplas não geram contagem duplicada');
  test.todo('histórico do estudante em ordem cronológica com campus e responsável (CA-063.1)');
  test.todo('documentos mantêm o snapshot após mudança de dados do campus (RN-03, CA-081.2)');
});

describe('PENDENTE — estoque, estudantes e catálogo', () => {
  test.todo('saldo nunca negativo; estoque = soma do livro-razão (RN-72, CA-027.1)');
  test.todo('baixa e ajuste exigem justificativa (RN-70, RN-71, CA-026.1)');
  test.todo('importação tudo ou nada, com erros por linha (RN-11, CA-030.1)');
  test.todo('matrícula e e-mail únicos no IFC; um vínculo ativo por estudante (RN-06, RN-08, CA-031.1, CA-031.2)');
  test.todo('ISBN único reaproveita o título existente (RN-73, CA-020.1)');
});

describe('PENDENTE — interface (Playwright, quando houver frontend)', () => {
  test.todo('fluxo identificar estudante → preparar entrega → assinar na tela do celular → efetivar');
  test.todo('fluxo de devolução com justificativa de perda');
  test.todo('aprovação de acesso de servidor pelo admin do campus');
  test.todo('navegação por teclado e verificação automática de acessibilidade nos fluxos principais (RNF-013, RNF-014)');
  test.todo('telas a 360 px sem rolagem horizontal (RNF-018)');
});
