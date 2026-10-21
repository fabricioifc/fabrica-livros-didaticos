# Requisitos — Gestão de Entrega e Devolução de Livros Didáticos

> Situação: **rev. 2, em validação.** Última revisão: 2026-10-21.
> Fontes: [`AGENTS.md`](../AGENTS.md), [`docs/business-rules.md`](business-rules.md) (regras `RN-xx`) e respostas do responsável do projeto às perguntas Q-01 a Q-12 em 2026-10-21 (seção 2.2).
> Tecnologias **não** são definidas aqui; ver [`docs/architecture.md`](architecture.md).

## Convenções

- Requisitos funcionais: `RF-001`…; não funcionais: `RNF-001`…; critérios de aceitação: `CA-<requisito>.<n>` (ex.: `CA-030.2`); dúvidas: `DV-01`…
- Os identificadores são **estáveis**: requisito removido não tem o número reaproveitado (marcar como "Removido").
- **Prioridade:**

| Marca | Significado |
|---|---|
| **MVP** | Essencial para a primeira implantação (Campus Fraiburgo, dados fictícios) |
| **Posterior** | Importante, para uma versão seguinte |
| **Opcional** | Desejável, só com demanda confirmada |

- Requisito que depende de uma dúvida em aberto traz o ID da dúvida (`DV-xx`) e só pode ser implementado de forma isolada e fácil de alterar.
- Testes automatizados devem citar o ID do critério de aceitação que verificam.

---

## 0. Situação da implementação

> Atualizada em 2026-10-21, no commit `6343fe4`. **Atualize esta seção a cada funcionalidade concluída** (e o teste de documentação garante que os IDs citados existem).
> Legenda: ✅ implementado e testado · 🟡 parcial (ver observação) · ⬜ não iniciado. "Testado" = testes automatizados passando; telas também conferidas manualmente no ambiente dev.

### 0.1 Requisitos funcionais

| RF | Situação | Onde está | Observação |
|---|---|---|---|
| RF-001 Login institucional | ✅ | `src/infra/auth/google.js`, `src/modulos/acesso/` (`dominio.js` `classificarIdentidade`, `rotas.js` `/auth/*`) | OIDC com PKCE/state/nonce. Validação real do ID token pela `openid-client`; testes de rota usam provedor falso. Login real conferido manualmente. |
| RF-002 Solicitar acesso | ✅ | `servico.solicitarAcesso`, `POST /acesso/solicitacoes`, tela `escolher-campus` | |
| RF-003 Aprovar/recusar | ✅ | `servico.decidirSolicitacao`, `/acesso/solicitacoes/*`, telas `solicitacoes` e `solicitacao` | Ninguém decide a própria solicitação (D-17). |
| RF-004 Gerenciar perfis | 🟡 | `servico.concederPapel`/`revogarAtribuicao`, `/acesso/campi/:id/equipe`, `/acesso/atribuicoes/:id/revogar` | Interface para Atendimento e Administração do campus. **Sem tela** para conceder Administração institucional ou Consulta institucional (o serviço já permite). D-18: papel de campus só para quem é da equipe. |
| RF-005 Primeiro administrador | ✅ | `servico.registrarLogin` + `BOOTSTRAP_ADMIN_EMAILS` | Só enquanto não houver admin institucional ativo (D-17). |
| RF-006 Acesso do estudante | ✅ | `servico.registrarLogin` (ligação por e-mail), migração 002, tela `estudante` | Mostra nome e matrícula; livros em posse dependem de RF-064. |
| RF-007 Campus de trabalho | ⬜ | | Posterior. Hoje o servidor vê todos os campi em que tem papel. |
| RF-008 Encerrar sessão | ✅ | `POST /auth/sair`, `src/infra/web/seguranca.js` | Sessões no PostgreSQL (migração 003); expiração por inatividade. |
| RF-010 Cadastrar campi | 🟡 | tabela `campus` (migração 001), `db/seeds/dev/001_campi.sql` | Campi existem só por seed. **Sem tela** de cadastro/ativação. |
| RF-011 Configurar o campus | 🟡 | tabela `campus_configuracao` | Tabela e RLS prontas; **sem tela**. |
| RF-012 Períodos, cursos, turmas | ⬜ | | |
| RF-020 a RF-022 Catálogo e adoções | ⬜ | | |
| RF-025 a RF-028 Estoque | ⬜ | | |
| RF-030 a RF-034 Estudantes e vínculos | 🟡 | tabela `estudante` (migração 002) | Só o cadastro global e a ligação com o login. Falta `vinculo_estudante`, importação, cadastro manual, consulta e encerramento de vínculo. |
| RF-040 a RF-047 Entrega, assinatura, identificação | ⬜ | | Depende de estoque, estudantes/vínculos e termo. DV-19 (QR code) em aberto. |
| RF-050 a RF-053 Devolução | ⬜ | | DV-20 (livro danificado) em aberto. |
| RF-060 a RF-065 Prazos, pendências, histórico | ⬜ | | |
| RF-070 a RF-073 Relatórios | ⬜ | | |
| RF-080 a RF-082 Termos e documentos | ⬜ | | |
| RF-090 Registrar auditoria | 🟡 | `src/infra/auditoria.js`, tabela `auditoria` (imutável) | Registra as ações do módulo de acesso; cada novo módulo deve registrar as suas. |
| RF-091 Consultar auditoria | ⬜ | | Posterior. |
| RF-095 Isolamento entre campi | 🟡 | `src/infra/db/contexto.js` (`comContexto`, `SET LOCAL ROLE livros_app`), políticas RLS nas migrações | Garantido e testado para as tabelas existentes (`test/integration/acesso-isolamento.test.js`, `rotas-administracao.test.js`). Cada nova tabela por campus precisa de RLS e testes. |

### 0.2 Requisitos não funcionais

| RNF | Situação | Observação |
|---|---|---|
| RNF-001, RNF-002 Autorização no servidor e no banco | 🟡 | Para o módulo de acesso. Padrão a seguir: serviço verifica papel + `comContexto` + RLS. |
| RNF-003 CSRF, XSS, limite de login | ✅ | Token CSRF em todo POST, CSP restrita, escape no EJS, `LIMITE_LOGIN_15MIN` (padrão 300 por IP). |
| RNF-004 Segredos fora do código | ✅ | `.env` (fora do Git) e `.env.example`; teste de política. |
| RNF-005 HTTPS | ⬜ | Produção (Caddy) ainda não configurada. Cookie `Secure` já é ativado em produção. |
| RNF-006 Expiração de sessão | ✅ | `SESSAO_INATIVIDADE_MINUTOS` (padrão 60). |
| RNF-007, RNF-008 Minimização e dados fictícios | ✅ | Sem CPF; seeds com `@exemplo.invalid`. |
| RNF-010 Sem dados pessoais em logs/URLs | 🟡 | Respeitado no código atual; sem verificação automática de logs. |
| RNF-012 Imutabilidade | 🟡 | Auditoria imutável e atribuição só revogável. Entregas/devoluções ainda não existem. |
| RNF-013, RNF-014 GovBR-DS e acessibilidade | 🟡 | Telas usam `@govbr-ds/core` 3.7.0 local. Falta: fonte **Rawline** (não instalada), JavaScript dos componentes (mensagens sem botão fechar), validação automática de acessibilidade. |
| RNF-018 Responsividade | 🟡 | Tela de entrada conferida a 360 px; demais telas não verificadas formalmente. |
| RNF-019 a RNF-023 Desempenho e disponibilidade | ⬜ | `GET /saude` existe; sem metas medidas nem monitoramento. |
| RNF-024, RNF-025 Manutenção e configuração por dados | 🟡 | Testes automatizados e campi por seed; falta CI (GitHub Actions). |
| RNF-026 Atualização e retorno de versão | ⬜ | Sem deploy de produção. |
| RNF-028 Dispositivo pessoal | 🟡 | `no-store` e logout feitos; câmera ainda não usada. |
| Demais RNF | ⬜ | |

### 0.3 Infraestrutura pronta

- **Banco:** migrações `001_acesso`, `002_estudante`, `003_sessao` (`npm run db:migrate`); seeds `db/seeds/` (base) e `db/seeds/dev/` (fictícios).
- **Ambiente dev:** `compose.yaml` (`npm run dev:up`), login real com Google via `.env`. Ver `README.md`.
- **Testes:** `node:test` + PostgreSQL real em Docker; provedor de login falso para rotas. Ver `docs/testing.md`.
- **Padrões a reutilizar** em novos módulos: `src/modulos/acesso/` (`dominio.js` puro, `repositorio.js` SQL, `servico.js` com `comContexto` e auditoria, `rotas.js`), parciais EJS em `src/views/parciais/`, helpers de teste em `test/helpers/`.

### 0.4 Próximos passos sugeridos (MVP, em ordem de dependência)

1. RF-010/RF-011/RF-012: telas de campi, configuração do campus, períodos letivos, cursos e turmas.
2. RF-020: catálogo de títulos.
3. RF-025 a RF-028: estoque (entrada, baixa, ajuste, livro-razão).
4. RF-030 a RF-033: vínculos de estudantes, importação CSV (DV-11 em aberto), cadastro manual, consulta.
5. RF-080: termo de compromisso versionado.
6. RF-046/RF-047 e RF-040 a RF-044: identificação, entrega e assinatura na tela.
7. RF-050 a RF-053, RF-060 a RF-064, RF-070, RF-071, RF-081: devolução, pendências, relatórios e documentos.

---

## 1. Objetivo e escopo

### 1.1 Problema

Hoje a entrega de livros didáticos aos estudantes é controlada com folhas impressas assinadas à mão. Isso dificulta saber quais livros estão com cada estudante, quais estão atrasados, quantos restam em estoque, e exige guardar papel. Com vários campi, não há visão consolidada nem regras uniformes.

### 1.2 Objetivo

Oferecer uma aplicação web que registre, para cada campus do IFC, o estoque de livros didáticos, a entrega aos estudantes com **assinatura digital do termo de compromisso no ato da entrega**, a devolução e as pendências, sem papel e com histórico confiável.

### 1.3 Escopo incluído

- Cadastro e administração de campi e de suas configurações.
- Acesso de servidores e estudantes com contas institucionais do IFC; aprovação de acesso por campus.
- Catálogo compartilhado de títulos e adoções por campus.
- Estoque por quantidade (entradas, baixas, ajustes).
- Cadastro e importação de estudantes e seus vínculos.
- Entregas com assinatura do estudante na tela do dispositivo do servidor.
- Devoluções (total ou parcial), danos e perdas.
- Pendências, histórico, relatórios e exportação.
- Termos e comprovantes digitais.
- Consulta do estudante aos próprios livros.
- Auditoria das operações.

### 1.4 Contexto de implantação

- **Primeira implantação:** IFC – Campus Fraiburgo, que valida requisitos e fluxos.
- **Multi-campus desde o início:** outros campi entram por cadastro e configuração, sem alteração de código nem nova instalação (AGENTS.md, regras 1, 2, 9 e 10).
- Até a aprovação institucional (DV-01), a aplicação opera **somente com dados fictícios**.

---

## 2. Pressupostos e decisões incorporadas

### 2.1 Pressupostos

| ID | Pressuposto | Origem | Situação |
|---|---|---|---|
| PR-01 | Os livros são majoritariamente do PNLD, para cursos técnicos integrados ao ensino médio. | AGENTS.md P1 | A confirmar (DV-13) |
| PR-02 | A planilha de importação traz o e-mail institucional de cada estudante. | AGENTS.md P3 | A confirmar (DV-11) |
| PR-03 | O servidor que atende usa um celular ou tablet com tela sensível ao toque (e câmera, para ler o QR code) para coletar a assinatura. Geralmente institucional; pode ser pessoal com login institucional. | Respostas Q-08 e DV-05 | Confirmado |
| PR-04 | Volume de referência para desempenho: até 3.000 estudantes ativos e 50.000 itens entregues por campus, até 20 campi. | Estimativa deste documento | A confirmar (DV-12) |
| PR-05 | Os atendimentos acontecem em horário administrativo, em dias úteis. | Estimativa deste documento | A confirmar (DV-12) |

### 2.2 Decisões do responsável do projeto em 2026-10-21 (respostas Q-01 a Q-12)

Estas respostas já estão refletidas em `business-rules.md` (rev. 2), `AGENTS.md` (rev. 3) e `architecture.md`.

| Pergunta | Decisão | Regras afetadas |
|---|---|---|
| Q-01 | Importação de estudantes é **tudo ou nada**, com relatório de erros. | RN-11 |
| Q-02 | Entregas podem ocorrer **a qualquer momento do ano** (livros chegam aos poucos); não há bloqueio por data. | RN-15 |
| Q-03 | **Um exemplar** de cada título por entrega. | RN-17 |
| Q-04 | Título que o estudante já tem em posse: **apenas avisar** (o operador confirma); não bloquear. | RN-18 |
| Q-05 | Título fora das adoções do curso/série: **avisar e pedir confirmação**. | RN-20 |
| Q-06 | Estudante com pendência vencida **pode receber** nova entrega, **com aviso** (padrão; o campus pode configurar bloqueio). | RN-21 |
| Q-07 | No máximo **uma entrega aguardando assinatura** por estudante. | RN-22 |
| Q-08 | O estudante **assina com o dedo na tela do celular do servidor, no ato da entrega**. O acesso do estudante ao sistema é **para consulta**. Não há assinatura no celular do estudante nem QR code. | RN-24, RN-26, RN-30 a RN-36 |
| Q-09 | **Operador também pode estornar** entregas e devoluções (as que registrou), com justificativa; o Administrador do campus pode estornar qualquer uma do campus. | RN-28, RN-43 |
| Q-10 | Prazos propostos confirmados, **sem tolerância**. | RN-44 a RN-46 |
| Q-11 | **Sem prorrogação** individual de prazo. | RN-47 |
| Q-12 | **Não há transferência de livros entre campi**; cada campus gerencia seus livros. | RN-62 a RN-65 (removidas) |

### 2.3 Respostas às dúvidas (2026-10-21)

| Dúvida | Resposta | Requisitos afetados |
|---|---|---|
| DV-01 | Adiada: não tratar agora. Continua valendo o uso de dados fictícios (RNF-008). | — |
| DV-02 | A assinatura na tela **vale como aceite**, pois o termo é um **controle interno**. Não há tratamento específico para estudantes menores de idade. | RF-042 |
| DV-03 | O estudante é identificado pela **matrícula**: o servidor **lê um QR code** que contém um código assinado digitalmente (ex.: JWT) com a matrícula, **ou digita a matrícula** manualmente, antes de entregar os livros. | RF-046, RF-047 |
| DV-04 | O estudante **assina no mesmo instante** da entrega; não há expiração automática. | RF-043 |
| DV-05 | O dispositivo é **geralmente institucional**, mas pode ser **pessoal**, desde que o servidor entre com o e-mail institucional. | RNF-006, RNF-028 |
| DV-06 | Adiada. | RF-045, RNF-015 |
| DV-09 | Em perda ou dano basta uma **justificativa**: o estudante informa ao servidor qual livro e o motivo, e o servidor registra no sistema. Não há reposição, cobrança nem bloqueio. | RF-050, RF-053 |

---

## 3. Atores

| Ator | Descrição | Escopo |
|---|---|---|
| **Administrador institucional** | Gestão do sistema no IFC: campi, termo de compromisso, domínios permitidos, administradores de campus, catálogo (edição e mescla), relatórios consolidados. Não registra entregas sem atribuição de campus. | Todos os campi |
| **Administrador do campus** | Gestão local: aprova acessos de servidores, designa operadores, configura o campus, mantém estoque, adoções e estudantes; atende e estorna. | Seu(s) campus(i) |
| **Operador (servidor de atendimento)** | Servidor designado (ex.: CGE) que prepara entregas, coleta a assinatura do estudante, registra devoluções e estorna os próprios registros. | Seu(s) campus(i) |
| **Consulta** | Servidor confirmado no campus sem função de atendimento (ex.: coordenação); perfil padrão após aprovação. Também pode ter escopo institucional (gestão, auditoria). | Campus ou institucional |
| **Servidor aguardando aprovação** | Servidor que fez o primeiro acesso e declarou o campus; não vê dados. | Nenhum |
| **Estudante** | Consulta os próprios livros, prazos, termos e comprovantes. Assina o termo **no dispositivo do servidor**, durante o atendimento. | Próprios dados |
| **Sistema** | Rotinas automáticas (ex.: cancelar entregas preparadas abandonadas, verificar consistência do estoque). | — |

Permissões detalhadas: AGENTS.md, seção 6.2.

---

## 4. Requisitos funcionais

### 4.1 Acesso e perfis

**RF-001 — Entrar com conta institucional** · MVP · RN-07
O usuário entra com sua conta institucional do IFC. Apenas os domínios `@ifc.edu.br` (servidores) e `@estudantes.ifc.edu.br` (estudantes), cadastrados como permitidos, são aceitos.
- CA-001.1 Conta de domínio não permitido (ex.: `@gmail.com`) é recusada e nenhum registro de usuário é criado.
- CA-001.2 Domínio parecido (ex.: `ifc.edu.br.exemplo.com`) é recusado.
- CA-001.3 Conta cujo e-mail não foi verificado pelo provedor é recusada.
- CA-001.4 A lista de domínios permitidos é alterável pelo Administrador institucional sem mudança de código.

**RF-002 — Solicitar acesso a um campus (servidor)** · MVP
No primeiro acesso, o servidor escolhe seu campus entre os campi ativos; a solicitação fica pendente.
- CA-002.1 Servidor com solicitação pendente vê apenas a tela "Aguardando confirmação".
- CA-002.2 O campus declarado não concede nenhum acesso a dados antes da aprovação.
- CA-002.3 Há no máximo uma solicitação pendente por servidor.

**RF-003 — Aprovar ou recusar solicitações** · MVP
O Administrador do campus (ou institucional) aprova ou recusa solicitações para o seu campus.
- CA-003.1 Aprovação concede o perfil Consulta naquele campus; o administrador pode conceder Operador no mesmo ato.
- CA-003.2 Recusa exige motivo; o servidor pode solicitar novamente.
- CA-003.3 Administrador do campus A não vê nem decide solicitações do campus B.

**RF-004 — Gerenciar perfis** · MVP
Conceder e revogar perfis conforme a matriz de permissões (AGENTS.md, seção 6.2).
- CA-004.1 Revogação tem efeito na próxima ação do usuário, sem esperar o fim da sessão.
- CA-004.2 Não é possível remover o último Administrador institucional ativo.
- CA-004.3 Toda concessão e revogação aparece na auditoria.

**RF-005 — Primeiro administrador** · MVP
O primeiro Administrador institucional é definido na instalação, sem depender de cadastro manual no banco.
- CA-005.1 Após a instalação, o e-mail configurado entra como Administrador institucional.

**RF-006 — Acesso do estudante** · MVP · RN-07
O estudante entra com a conta `@estudantes.ifc.edu.br`; se o e-mail estiver cadastrado, acessa a área de consulta.
- CA-006.1 E-mail não cadastrado vê a mensagem "Cadastro não localizado. Procure o setor responsável pelos livros do seu campus." e nenhum dado.
- CA-006.2 O estudante não acessa nenhuma tela de servidor.

**RF-007 — Escolher campus de trabalho** · Posterior
Servidor com atribuição em mais de um campus escolhe em qual está trabalhando.
- CA-007.1 Escolher um campus sem atribuição é recusado e registrado na auditoria.

**RF-008 — Encerrar sessão** · MVP
- CA-008.1 Ao sair, a sessão deixa de valer, inclusive se reutilizada.
- CA-008.2 Sessões inativas expiram após o tempo configurado (RNF-006).

### 4.2 Campi e configurações

**RF-010 — Cadastrar e manter campi** · MVP
O Administrador institucional cadastra, edita, ativa e desativa campi.
- CA-010.1 Um novo campus fica utilizável sem alteração de código nem nova instalação.
- CA-010.2 Campus desativado não aparece para novas solicitações de acesso; seu histórico continua consultável por perfis autorizados.

**RF-011 — Configurar o campus** · MVP
O Administrador do campus mantém nome oficial, endereço, setor responsável, contatos e as opções de regra do campus (ex.: bloquear entrega a estudante com pendência vencida — RN-21/Q-06).
- CA-011.1 Os dados do campus aparecem nos documentos emitidos depois da alteração; documentos anteriores não mudam (RN-03).
- CA-011.2 Administrador do campus A não altera configurações do campus B.

**RF-012 — Períodos letivos, cursos e turmas** · MVP
O Administrador do campus cadastra períodos letivos (início e fim), cursos e turmas (curso, série, período).
- CA-012.1 Turma pertence a um curso e a um período do mesmo campus.
- CA-012.2 O fim do período letivo é usado no cálculo de prazos (RF-061).

### 4.3 Catálogo e adoções

**RF-020 — Manter o catálogo de títulos** · MVP · RN-73 a RN-75
Cadastro de títulos compartilhados: ISBN, título, autores, editora, edição, volume, ano, disciplina, código do programa, **abrangência** (série específica ou ensino médio completo) e série quando aplicável.
- CA-020.1 Não é possível cadastrar dois títulos com o mesmo ISBN; o sistema oferece o título existente.
- CA-020.2 Título de série específica exige a série.
- CA-020.3 Título criado por um campus fica visível para todos os campi.
- CA-020.4 Quem pode editar e mesclar títulos segue DV-08.

**RF-021 — Mesclar títulos duplicados** · Posterior · RN-75, DV-08
- CA-021.1 Após a mescla, o histórico de entregas e estoque do título duplicado aparece no título mantido; nada é apagado.

**RF-022 — Registrar adoções do campus** · Posterior · RN-76
O campus registra, por período letivo, quais títulos adota, para quais cursos/séries e com qual quantidade prevista.
- CA-022.1 Campi diferentes podem adotar títulos e quantidades diferentes.
- CA-022.2 Enquanto o campus não tiver adoções, o aviso de RF-041 (CA-041.2) não é exibido.

### 4.4 Estoque

**RF-025 — Entrada de livros** · MVP · RN-69
O Administrador do campus registra entradas (título, quantidade, origem).
- CA-025.1 O saldo disponível aumenta na quantidade informada e a movimentação fica registrada.

**RF-026 — Baixa e ajuste de inventário** · MVP · RN-70, RN-71
O Administrador do campus registra baixas (perda, extravio, dano no acervo) e ajustes de contagem, com justificativa.
- CA-026.1 Justificativa é obrigatória.
- CA-026.2 Baixa ou ajuste que deixaria o saldo negativo é recusado (RN-72).

**RF-027 — Consultar estoque** · MVP
Consulta por título no campus: disponível, com estudantes (em posse) e baixado.
- CA-027.1 Disponível + em posse corresponde às movimentações registradas (verificável por relatório de consistência).
- CA-027.2 Usuário do campus A não vê o estoque do campus B.

**RF-028 — Histórico de movimentações** · MVP
- CA-028.1 Cada movimentação mostra tipo, quantidade, data/hora, responsável e referência (entrega, devolução, baixa…).

### 4.5 Estudantes

**RF-030 — Importar estudantes por planilha** · MVP · RN-11 (Q-01)
Importação de matrícula, nome, e-mail institucional, curso, turma e período (formato: DV-11).
- CA-030.1 Se houver qualquer linha inválida (matrícula ou e-mail duplicado, e-mail fora do domínio de estudantes, curso ou turma inexistente), **nada** é importado e o sistema lista cada erro com o número da linha.
- CA-030.2 Planilha válida cria ou atualiza estudantes e vínculos no campus do usuário.
- CA-030.3 Somente dados do campus do usuário são afetados.

**RF-031 — Cadastrar e editar estudante manualmente** · MVP · RN-06, RN-08
- CA-031.1 Matrícula e e-mail institucional são únicos em todo o IFC.
- CA-031.2 O estudante tem no máximo um vínculo ativo em todo o IFC.

**RF-032 — Consultar estudante e histórico** · MVP · RN-09, RN-10
Busca por nome, matrícula ou turma; ficha com vínculo, livros em posse, prazos, entregas, devoluções e documentos.
- CA-032.1 Servidor só encontra estudantes com vínculo (atual ou passado) no seu campus.
- CA-032.2 Estudante com vínculo encerrado continua consultável, com histórico completo.
- CA-032.3 Entregas antigas mostram a turma da época, mesmo após mudança de turma.

**RF-033 — Encerrar vínculo** · MVP · RN-46
Registrar conclusão, evasão, cancelamento ou transferência, com data.
- CA-033.1 Ao encerrar, o prazo de todos os livros em posse daquele vínculo passa a ser a data de encerramento.

**RF-034 — Transferir estudante entre campi** · Posterior · RN-57 a RN-61, DV-07
- CA-034.1 O vínculo de origem fica "transferido" e um novo vínculo é criado no destino, com a mesma matrícula.
- CA-034.2 Entregas e pendências anteriores continuam pertencendo ao campus de origem.
- CA-034.3 O que o destino vê sobre pendências da origem segue DV-07.

### 4.6 Entregas

**RF-040 — Preparar entrega** · MVP · RN-13, RN-14, RN-16, RN-17, RN-19, RN-22, RN-23 (Q-02, Q-03, Q-07)
O Operador ou Administrador do campus escolhe o estudante e os títulos.
- CA-040.1 O estudante é identificado pela matrícula (RF-046 ou RF-047); só estudantes com vínculo ativo no campus podem ser escolhidos.
- CA-040.2 Cada título aparece uma única vez, com quantidade 1.
- CA-040.3 Título sem saldo disponível não pode ser incluído.
- CA-040.4 Se o estudante já tem uma entrega aguardando assinatura, é preciso concluí-la ou cancelá-la antes.
- CA-040.5 Não há bloqueio por data: entregas podem ser preparadas em qualquer dia do ano (Q-02). A entrega fica associada ao período letivo do vínculo do estudante.
- CA-040.6 A preparação não altera o estoque.
- CA-040.7 Perfis Consulta e Estudante não conseguem preparar entregas (inclusive por requisição direta).

**RF-041 — Avisos na preparação** · MVP · RN-18, RN-20, RN-21 (Q-04, Q-05, Q-06)
- CA-041.1 Título que o estudante já tem em posse gera aviso; o operador pode confirmar e seguir.
- CA-041.2 Título fora das adoções do curso/série gera aviso e exige confirmação (quando houver adoções — RF-022).
- CA-041.3 Estudante com pendência vencida gera aviso com a lista de pendências; a entrega é permitida, salvo se o campus configurou bloqueio.
- CA-041.4 Toda confirmação de aviso fica registrada na entrega.

**RF-042 — Coletar a assinatura do estudante** · MVP · RN-26, RN-27, RN-31 (Q-08)
No ato da entrega, o servidor passa o próprio dispositivo ao estudante, que lê o termo e os livros e assina com o dedo na tela.
- CA-042.1 A tela de assinatura mostra somente: nome e matrícula do estudante, campus, texto completo do termo, lista de livros e área de assinatura; nenhum menu ou dado de outro estudante.
- CA-042.2 O estudante pode limpar e refazer a assinatura antes de confirmar.
- CA-042.3 Assinatura em branco não é aceita.
- CA-042.4 Ao confirmar, em uma única operação: o saldo é conferido, o estoque é baixado, a assinatura é guardada, a entrega passa a "assinada" e o termo é gerado. Se faltar saldo de qualquer item, nada é gravado.
- CA-042.5 A assinatura registra: imagem e traçado, data/hora, servidor que conduziu o atendimento, versão do termo, hash do documento, endereço IP e dispositivo.
- CA-042.6 Uma entrega tem uma única assinatura; tentar assinar de novo é recusado.
- CA-042.7 Funciona na tela de celular com largura de 360 px e em tablets.
- CA-042.8 O estudante que assina é o identificado pela matrícula no início do atendimento (RF-046 ou RF-047); o termo registra como ele foi identificado (QR code ou digitação).
- CA-042.9 A assinatura na tela é aceita como aceite do termo, por se tratar de controle interno (DV-02); não há fluxo diferente para estudantes menores de idade.

**RF-043 — Cancelar entrega preparada** · MVP · RN-25
- CA-043.1 O operador ou o administrador do campus cancela uma entrega não assinada; o estoque não muda.
- CA-043.2 Preparação e assinatura acontecem no mesmo atendimento (DV-04); não há expiração automática. Uma entrega preparada e não assinada (ex.: navegador fechado) pode ser retomada ou cancelada pelo operador.

**RF-044 — Estornar entrega assinada** · MVP · RN-28 (Q-09)
- CA-044.1 O Operador estorna apenas entregas que ele registrou; o Administrador do campus estorna qualquer entrega do campus.
- CA-044.2 Justificativa obrigatória.
- CA-044.3 Não é possível estornar entrega com devolução registrada em qualquer item.
- CA-044.4 O estorno devolve as quantidades ao estoque; o termo original é mantido e marcado como estornado.

**RF-045 — Entrega quando o estudante não pode assinar** · Posterior · DV-06 (adiada)
- CA-045.1 Definido após DV-06; até lá, não implementar.

**RF-046 — Identificar o estudante pela matrícula digitada** · MVP · DV-03
- CA-046.1 O servidor digita a matrícula; o sistema mostra nome, curso e turma para conferência antes de seguir.
- CA-046.2 Matrícula inexistente ou sem vínculo ativo no campus do servidor mostra mensagem clara e não avança.
- CA-046.3 A busca só encontra estudantes com vínculo no campus do servidor (RF-095).

**RF-047 — Identificar o estudante por QR code** · MVP · DV-03, DV-19
O servidor lê, com a câmera do dispositivo, um QR code que contém um código assinado digitalmente pelo sistema (ex.: JWT) com a matrícula do estudante.
- CA-047.1 QR code válido abre o atendimento do estudante correspondente, como em RF-046.
- CA-047.2 QR code com assinatura inválida, adulterado, expirado (se houver validade — DV-19) ou de outro sistema é recusado com mensagem clara.
- CA-047.3 O QR code contém apenas o necessário para identificar o estudante (matrícula e dados de controle do código); nenhum outro dado pessoal.
- CA-047.4 Sem câmera ou sem permissão de câmera, o servidor pode digitar a matrícula (RF-046).
- CA-047.5 Onde o estudante obtém o QR code e por quanto tempo ele vale seguem DV-19.

### 4.7 Devoluções

**RF-050 — Registrar devolução** · MVP · RN-37 a RN-39, RN-41
O Operador ou Administrador do campus da entrega registra a devolução de um ou mais livros do estudante em um único atendimento.
- CA-050.1 Só aparecem itens de entregas assinadas do próprio campus que ainda estão em posse.
- CA-050.2 Devolução parcial é permitida; a soma devolvida nunca passa da quantidade entregue.
- CA-050.3 Cada item tem um resultado (devolvido, danificado, perdido) e observação opcional.
- CA-050.4 "Devolvido" retorna ao estoque disponível. "Danificado" e "perdido" exigem justificativa (RF-053); se o livro danificado volta ao estoque segue DV-20 (proposta atual: não volta).
- CA-050.5 Qualquer resultado encerra a posse daquele item.
- CA-050.6 Livros não podem ser devolvidos em outro campus (Q-12: não há transferência de livros).

**RF-051 — Comprovante de devolução** · MVP · RN-42
- CA-051.1 Toda devolução gera um comprovante digital com estudante, campus, livros, resultados, data/hora e servidor que recebeu.
- CA-051.2 A devolução não exige assinatura do estudante.

**RF-052 — Estornar devolução** · MVP · RN-43 (Q-09)
- CA-052.1 Mesmas regras de permissão e justificativa de RF-044.
- CA-052.2 O estorno desfaz o efeito no estoque e reabre a posse do item.

**RF-053 — Justificar perda ou dano** · MVP · RN-66, RN-67 (DV-09)
O estudante informa ao servidor qual livro foi perdido ou danificado e o motivo; o servidor registra a justificativa no sistema.
- CA-053.1 Resultado "perdido" ou "danificado" só é aceito com justificativa preenchida.
- CA-053.2 A justificativa aparece no comprovante de devolução, no histórico do estudante e no relatório de perdas e danos.
- CA-053.3 A perda ou dano justificado encerra a posse do livro; não gera reposição, cobrança nem bloqueio de novas entregas.

### 4.8 Prazos, pendências e histórico

**RF-060 — Calcular posse** · MVP · RN-48, RN-50
- CA-060.1 Em posse = entregue (em entregas assinadas e não estornadas) − devolvido com qualquer resultado.
- CA-060.2 Não existe contador salvo de posse ou pendência; o valor é sempre derivado dos registros.

**RF-061 — Calcular prazo de devolução** · MVP · RN-44 a RN-47 (Q-10, Q-11)
- CA-061.1 Livro de série específica: último dia do período letivo da entrega.
- CA-061.2 Livro de ensino médio completo: último dia do período letivo da 3ª série do estudante.
- CA-061.3 Vínculo encerrado: data de encerramento, para todos os livros em posse daquele vínculo.
- CA-061.4 Não há tolerância nem prorrogação individual.
- CA-061.5 Prazos consideram o fuso de Brasília; "até a data X" vale até 23:59:59.

**RF-062 — Consultar pendências** · MVP · RN-49, RN-51, RN-53
Filtros por estudante, turma, curso, título e período letivo; distinção entre "em posse, no prazo" e "pendente (vencido)".
- CA-062.1 Só aparecem pendências de entregas do campus do usuário (ou todos os campi para perfis institucionais).
- CA-062.2 Lista paginada, ordenável e exportável (RF-071).

**RF-063 — Histórico de movimentações por estudante** · MVP
- CA-063.1 Mostra entregas, assinaturas, devoluções e estornos em ordem cronológica, com campus, responsável e data/hora de cada um.

**RF-064 — Área de consulta do estudante** · MVP · RN-52 (Q-08)
- CA-064.1 O estudante vê os livros em posse, prazos e campus responsável, além dos termos e comprovantes, de todos os campi em que teve vínculo.
- CA-064.2 O estudante vê somente os próprios dados; trocar identificadores na requisição não mostra dados de outro estudante.
- CA-064.3 Não há ação de assinatura nem de alteração na área do estudante.
- CA-064.4 Se DV-19 definir que o QR code de identificação é obtido aqui, a área do estudante o exibe (RF-047).

**RF-065 — Nada consta** · Posterior · RN-54 a RN-56, DV-10
- CA-065.1 Emitido apenas quando não há livros em posse no escopo definido em DV-10.

### 4.9 Relatórios e exportação

**RF-070 — Relatórios do campus** · MVP
Entregas e devoluções por período, estoque por título, pendências por turma/curso, perdas e danos.
- CA-070.1 Os totais conferem com as consultas detalhadas.
- CA-070.2 Dados de outros campi nunca aparecem.

**RF-071 — Exportar relatórios em planilha (CSV)** · MVP
- CA-071.1 A exportação respeita os filtros e o escopo do usuário.
- CA-071.2 A planilha abre corretamente com acentuação em editores de planilha comuns.

**RF-072 — Relatórios consolidados** · Posterior
- CA-072.1 Disponíveis apenas para perfis institucionais.
- CA-072.2 O total consolidado é a soma dos campi.

**RF-073 — Versão para impressão** · Posterior
- CA-073.1 Relatórios e documentos têm uma versão legível quando impressos ou salvos em PDF pelo navegador.

### 4.10 Termos e documentos

**RF-080 — Manter o termo de compromisso** · MVP · RN-29, RN-23
O Administrador institucional publica versões do termo, único para todos os campi.
- CA-080.1 Nova versão vale para entregas preparadas depois da publicação; termos já assinados não mudam.
- CA-080.2 Versões anteriores continuam consultáveis.

**RF-081 — Gerar termo de entrega assinado** · MVP · RN-03, RN-33, RN-34
- CA-081.1 O termo contém: estudante (nome, matrícula, curso, turma), campus (nome oficial, endereço, setor), livros, data/hora, servidor responsável, texto e versão do termo, declaração de recebimento, imagem da assinatura e código de verificação.
- CA-081.2 Alterar dados do estudante ou do campus depois não altera o termo emitido.
- CA-081.3 O termo pode ser visualizado pelo estudante e pelos servidores autorizados do campus, e impresso ou salvo em PDF pelo navegador.
- CA-081.4 Não existe fluxo de impressão obrigatória nem arquivamento em papel.

**RF-082 — Verificar autenticidade de documento** · Opcional · DV-15
- CA-082.1 Consulta pelo código de verificação mostra apenas tipo, campus, data e situação, sem dados pessoais.

### 4.11 Auditoria

**RF-090 — Registrar auditoria** · MVP
- CA-090.1 Toda operação de escrita registra quem, quando, em qual campus, a ação e os valores anteriores/novos.
- CA-090.2 Nenhum perfil consegue alterar ou apagar registros de auditoria pela aplicação.

**RF-091 — Consultar auditoria** · Posterior
- CA-091.1 Administrador do campus vê a auditoria do próprio campus; perfis institucionais veem tudo.

### 4.12 Isolamento entre campi (transversal)

**RF-095 — Isolamento de dados por campus** · MVP · AGENTS.md, regras 3 a 5
- CA-095.1 Usuário do campus A que informa identificador de registro do campus B (em endereço, formulário ou requisição) recebe "não encontrado" e nenhum dado.
- CA-095.2 Tentativa de gravar dado no campus B por usuário do campus A é recusada e auditada.
- CA-095.3 O campus escolhido na interface nunca é tratado como permissão.
- CA-095.4 Há testes automatizados cobrindo CA-095.1 a CA-095.3 para cada funcionalidade com dados por campus.
- CA-095.5 Nenhuma regra depende do nome de um campus.

---

## 5. Requisitos não funcionais

| ID | Categoria | Requisito | Critério de aceitação | Prioridade |
|---|---|---|---|---|
| RNF-001 | Segurança | Autorização verificada no servidor em toda operação; ocultar botões não é controle de acesso. | Testes de permissão por perfil × ação passam; chamadas diretas sem permissão retornam erro. | MVP |
| RNF-002 | Segurança | Isolamento entre campi e entre estudantes reforçado também no banco de dados. | Teste com acesso direto ao banco usando as credenciais da aplicação não retorna dados fora do escopo. | MVP |
| RNF-003 | Segurança | Proteção contra envio forjado de formulários, injeção de scripts e excesso de tentativas de login. | Formulário sem token de proteção é recusado; conteúdo digitado é exibido como texto; tentativas repetidas são limitadas. | MVP |
| RNF-004 | Segurança | Segredos fora do código versionado. | Revisão do repositório não encontra credenciais. | MVP |
| RNF-005 | Segurança | Comunicação somente por HTTPS. | Acesso por HTTP é redirecionado para HTTPS. | MVP |
| RNF-006 | Segurança | Sessões expiram por inatividade e podem ser encerradas pelo usuário. | Sessão inativa pelo tempo configurado exige novo login. | MVP |
| RNF-007 | Privacidade | Minimização de dados: sem CPF; apenas dados necessários ao controle dos livros. | Modelo de dados não contém CPF nem campos sem uso. | MVP |
| RNF-008 | Privacidade | Somente dados fictícios até aprovação institucional (DV-01). | Seeds e testes usam apenas dados gerados. | MVP |
| RNF-009 | Privacidade | Imagem da assinatura é dado pessoal: exibida apenas no termo, para o estudante e servidores autorizados do campus. | Imagem não aparece em listagens, exportações ou logs. | MVP |
| RNF-010 | Privacidade | Logs sem nomes, matrículas, e-mails, assinaturas ou tokens; dados pessoais nunca em endereços (URLs). | Revisão de logs e rotas não encontra esses dados. | MVP |
| RNF-011 | Privacidade | Política de retenção dos dados definida antes do uso com dados reais. | Documento de retenção aprovado (DV-14). | Posterior |
| RNF-012 | Rastreabilidade | Registros de entrega, assinatura, devolução, movimentação e documentos são imutáveis; correções por estorno. | Tentativas de alteração/exclusão pela aplicação falham. | MVP |
| RNF-013 | Acessibilidade | Interface conforme o Padrão Digital de Governo (GovBR-DS) e WCAG 2.1 nível AA / eMAG. | Verificação automática sem erros críticos e revisão manual dos fluxos principais; checklist da skill `govbr-design-system` cumprido. | MVP |
| RNF-014 | Acessibilidade | Operação completa por teclado, foco visível, contraste adequado, campos com rótulos, mensagens de erro associadas. | Fluxos de entrega, devolução e consulta executáveis só com teclado. | MVP |
| RNF-015 | Acessibilidade | A assinatura na tela não pode ser a única forma de concluir o atendimento para estudantes impossibilitados de assinar. | Depende de DV-06 (adiada). | Posterior |
| RNF-016 | Usabilidade | Atendimento de entrega rápido no balcão. | Meta: preparar e concluir a entrega de 10 livros a um estudante em até 2 minutos (a validar com a CGE). | MVP |
| RNF-017 | Usabilidade | Textos claros, em português, seguindo as orientações de escrita do GovBR-DS; mensagens de erro dizem o que fazer. | Revisão de textos no checklist de interface. | MVP |
| RNF-018 | Responsividade | Uso em computador, tablet e celular; telas de atendimento e assinatura pensadas para celular. | Sem rolagem horizontal da página em 320 px; zoom de 200% sem perda de conteúdo. | MVP |
| RNF-019 | Desempenho | Respostas rápidas com o volume de referência (PR-04). | 95% das páginas e ações em até 2 segundos; relatórios e importações de até 3.000 linhas em até 30 segundos. | MVP |
| RNF-020 | Desempenho | Operações simultâneas não geram estoque negativo nem dupla entrega. | Teste com operações concorrentes mantém o saldo correto. | MVP |
| RNF-021 | Disponibilidade | Disponível no horário de atendimento (PR-05). | Meta proposta: 99% no horário administrativo, medida mensalmente (DV-12). | MVP |
| RNF-022 | Disponibilidade | Monitoramento da disponibilidade com alerta. | Indisponibilidade gera alerta aos responsáveis. | MVP |
| RNF-023 | Recuperação | Cópia de segurança diária fora do servidor e restauração testada. | Meta proposta: perda máxima de 24 h de dados e restauração em até 4 h (DV-12). | MVP |
| RNF-024 | Manutenção | Código organizado em módulos, documentado e coberto por testes automatizados executados a cada alteração. | Alterações só são aceitas com testes passando. | MVP |
| RNF-025 | Manutenção | Configuração por campus feita por dados, sem ramificações de código por campus. | Incluir um campus de teste não exige alteração de código. | MVP |
| RNF-026 | Manutenção | Atualizações com procedimento documentado e possibilidade de voltar à versão anterior. | Procedimento de atualização e retorno testado em homologação. | MVP |
| RNF-027 | Compatibilidade | Versões atuais dos navegadores mais usados (desktop e celular). | Fluxos principais testados em pelo menos dois navegadores e um celular. | MVP |
| RNF-028 | Segurança | Uso em dispositivo pessoal do servidor (DV-05): o acesso exige login institucional, nenhum dado de estudante fica guardado no aparelho após sair, e a câmera só é usada durante a leitura do QR code. | Após sair, voltar pelo navegador não mostra dados; páginas com dados pessoais não ficam em cache do navegador; a câmera é liberada ao fechar a leitura. | MVP |

---

## 6. Resumo de prioridades

| Prioridade | Requisitos |
|---|---|
| **MVP** | RF-001 a RF-006, RF-008, RF-010 a RF-012, RF-020, RF-025 a RF-028, RF-030 a RF-033, RF-040 a RF-044, RF-046, RF-047, RF-050 a RF-053, RF-060 a RF-064, RF-070, RF-071, RF-080, RF-081, RF-090, RF-095; RNF-001 a RNF-010, RNF-012 a RNF-014, RNF-016 a RNF-028 |
| **Posterior** | RF-007, RF-021, RF-022, RF-034, RF-045, RF-065, RF-072, RF-073, RF-091; RNF-011, RNF-015 |
| **Opcional** | RF-082 |

O MVP atende a um campus com ciclo completo: acesso, estoque, estudantes, entrega com assinatura, devolução, pendências, relatórios básicos, documentos e auditoria — já com isolamento multi-campus.

---

## 7. Fora do escopo

Não implementar sem decisão explícita registrada:

- Integração com o SIGAA ou outro sistema acadêmico (cadastro por planilha e manual).
- Controle individual de exemplares (etiqueta, tombo, código por livro).
- **Transferência de livros entre campi** (Q-12).
- Devolução de livros em campus diferente do da entrega.
- Assinatura no celular do estudante ou por link (Q-08). O QR code serve **apenas para identificar** o estudante (RF-047).
- Reposição, cobrança ou bloqueio por perda ou dano de livro (DV-09).
- Assinatura com certificado digital (ICP-Brasil) ou gov.br.
- Prorrogação individual de prazos (Q-11).
- Multas ou bloqueios financeiros.
- Notificações por e-mail, SMS ou aplicativo.
- Aplicativo móvel nativo.
- Login com contas fora dos domínios institucionais permitidos; senhas locais.
- Coleta de CPF ou outros documentos pessoais.
- Uso por outras instituições além do IFC.
- Empréstimo de acervo de biblioteca ou livros não didáticos.
- Uso com dados reais de estudantes antes de DV-01.

---

## 8. Dúvidas a esclarecer antes do desenvolvimento

As referências `DP-xx` são do AGENTS.md (seção 16). Os identificadores são estáveis: dúvidas respondidas continuam na tabela 8.2.

### 8.1 Em aberto (ordenadas por impacto no MVP)

| ID | Dúvida | Impacto | Quem decide | Ref. |
|---|---|---|---|---|
| DV-19 | **QR code de identificação:** onde o estudante obtém o QR code (exibido na área do estudante no celular dele, impresso na carteirinha ou outro)? Ele expira? Se for impresso, como invalidar um código perdido? Estudantes sem celular usam a digitação da matrícula? | RF-047, RF-064 | Responsável do projeto / CGE | Nova |
| DV-20 | Livro **danificado** devolvido volta ao estoque disponível ou é baixado? (proposta: baixado) | RF-050 | CGE | DP-10 |
| DV-11 | Formato da planilha de estudantes (colunas, inclusão do e-mail institucional). | RF-030 | Registro Acadêmico / CGE | DP-03 |
| DV-12 | Volumes reais (estudantes, livros, campi) e horários de atendimento; metas de disponibilidade e recuperação aceitáveis. | RNF-016, RNF-019, RNF-021, RNF-023 | CGE / DTI | Nova |
| DV-16 | Quem serão os administradores institucionais e o administrador do Campus Fraiburgo? | Implantação | Gestão | DP-06 |
| DV-08 | Quem edita e mescla títulos do catálogo compartilhado? | RF-020, RF-021 | PROEN / Bibliotecas | DP-05 |
| DV-07 | Estudante transferido com pendências: devolve antes na origem? O destino vê algum aviso? | RF-034 (Posterior) | PROEN | DP-08 |
| DV-17 | A matrícula se mantém na transferência entre campi? | RF-034 (Posterior) | Registro Acadêmico | DP-04 |
| DV-10 | O nada consta vale para o campus ou para todo o IFC? | RF-065 (Posterior) | PROEN | DP-09 |
| DV-13 | Origem dos livros (PNLD ou outro) e obrigações de prestação de contas que exijam relatórios específicos. | RF-070 | PROEN | DP-13 |
| DV-14 | Política de retenção de dados de estudantes e assinaturas após a saída do estudante. | RNF-011 | Encarregado de dados | DP-14 |
| DV-15 | Haverá verificação pública de documentos pelo código? | RF-082 (Opcional) | Gestão | DP-12 |
| DV-18 | Uso de logotipo do IFC/campus e da marca gov.br na interface e nos documentos. | RF-081 | Comunicação | DP-11 |

### 8.2 Respondidas ou adiadas

| ID | Dúvida | Situação (2026-10-21) |
|---|---|---|
| DV-01 | Aval para usar dados reais na VPS do projeto. | **Adiada.** Seguem apenas dados fictícios (RNF-008). |
| DV-02 | Assinatura desenhada vale como aceite? Menores de idade? | **Respondida:** vale, é controle interno; sem tratamento para menores. |
| DV-03 | Como identificar o estudante antes da assinatura? | **Respondida:** QR code com código assinado contendo a matrícula, ou matrícula digitada (RF-046, RF-047). Detalhes do QR code em DV-19. |
| DV-04 | Entregas preparadas e não assinadas expiram? | **Respondida:** o estudante assina no mesmo instante; sem expiração automática. |
| DV-05 | Dispositivo do atendimento é pessoal ou institucional? | **Respondida:** geralmente institucional; pode ser pessoal com login institucional (RNF-028). |
| DV-06 | Entrega quando o estudante não pode assinar. | **Adiada** (RF-045, RNF-015 em Posterior). |
| DV-09 | Consequências de perda ou dano. | **Respondida:** apenas justificativa registrada pelo servidor; sem reposição, cobrança ou bloqueio (RF-053). Destino do livro danificado em DV-20. |

---

## 9. Pendências de documentação

As decisões das seções 2.2 e 2.3 foram aplicadas em 2026-10-21 em `docs/business-rules.md` (rev. 2), `AGENTS.md` (rev. 3) e `docs/architecture.md`. Falta criar `docs/data-model.md` (modelo definitivo a partir do AGENTS.md, seção 7.2) antes ou durante a primeira implementação do banco.

## Histórico

| Data | Revisão | Alteração |
|---|---|---|
| 2026-10-21 | 1 | Criação do documento, incorporando as respostas Q-01 a Q-12. |
| 2026-10-21 | 2 | Respostas às dúvidas DV-01 a DV-09: novos RF-046, RF-047 e RNF-028; RF-053 passa a MVP; RF-045 e RNF-015 passam a Posterior; novas dúvidas DV-19 e DV-20. |
| 2026-10-21 | 3 | Seção 9 atualizada: decisões aplicadas nos demais documentos. |
