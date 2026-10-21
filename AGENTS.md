# AGENTS.md — Sistema de Gestão de Livros Didáticos do IFC

> Documento de orientação para agentes de desenvolvimento (humanos ou IA).
> **Etapa atual: implementação do MVP** (prioridades em [`docs/requirements.md`](docs/requirements.md), seção 6), somente com dados fictícios. Requisitos que dependem de decisões em aberto (seção 16.2) só podem ser implementados depois da decisão, ou de forma isolada e fácil de trocar.
> Última revisão: 2026-10-21 (rev. 3 — decisões Q-01 a Q-12 e DV-01 a DV-09: assinatura no dispositivo do servidor, identificação por matrícula/QR code, sem transferência de livros entre campi).

---

## 0. Como usar este documento

- **Para continuar o trabalho:** a situação da implementação (o que está pronto, onde está o código, próximos passos) fica em [`docs/requirements.md`](docs/requirements.md), seção 0. Atualize-a ao concluir cada funcionalidade, junto com a tabela de situação de [`docs/business-rules.md`](docs/business-rules.md) e os resultados em [`docs/testing.md`](docs/testing.md).

- Leia as seções 1 (contexto), 2 (regras obrigatórias) e 9 (isolamento e autorização) **antes de qualquer alteração**.
- Leia também [`docs/architecture.md`](docs/architecture.md): camadas, módulos, rotas HTTP, tecnologias e decisões de arquitetura (A-xx). Quando `docs/data-model.md` existir, ele substitui o esboço SQL da seção 7.2.
- Regras de negócio (entrega, assinatura, devolução, prazos, pendências, transferências, perdas) estão em [`docs/business-rules.md`](docs/business-rules.md), com IDs `RN-xx`. Em caso de divergência com este arquivo, prevalece o `business-rules.md`, que deve ser corrigido aqui também.
- Requisitos funcionais e não funcionais, critérios de aceitação, prioridades (MVP) e dúvidas em aberto (`DV-xx`) estão em [`docs/requirements.md`](docs/requirements.md).
- Toda decisão que possa limitar a expansão para outros campi deve ser registrada na seção 15 (Registro de decisões).
- Itens marcados com **[CONFIRMAR]** ainda dependem de validação e não devem ser tratados como definitivos.
- Em caso de conflito entre este documento e uma solicitação pontual, prevalecem as regras da seção 2; registre o conflito e peça orientação.

---

## 1. Contexto institucional

A aplicação gerencia o ciclo dos **livros didáticos**: catálogo de títulos, estoque por campus, entrega aos estudantes com **assinatura do termo de compromisso na tela do dispositivo do servidor**, devolução e relatórios.

- **Instituição:** Instituto Federal Catarinense (IFC).
- **Primeira unidade de implantação e validação:** IFC – Campus Fraiburgo.
- **Escopo arquitetural:** **multi-campus desde a concepção.** Qualquer campus do IFC deve poder ser incluído por cadastro e configuração, sem nova instalação e sem alteração de código-fonte.

O Campus Fraiburgo é a **referência para validar requisitos e fluxos**, não uma restrição arquitetural. Nenhum nome, sigla, endereço ou regra específica de Fraiburgo pode existir no código; esses valores são **dados** (seed/configuração).

### 1.1 Decisões confirmadas e premissas

| # | Item | Status |
|---|------|--------|
| C1 | Hospedagem em **VPS própria do projeto**, com **Docker** e deploy por **GitHub Actions**. | Confirmado |
| C2 | Login exclusivamente via **Google OAuth (OpenID Connect)**. Apenas contas `@ifc.edu.br` (servidores) e `@estudantes.ifc.edu.br` (estudantes). Qualquer outro domínio é recusado. | Confirmado |
| C3 | O servidor **declara seu campus** no primeiro acesso; um administrador **confirma**. Até a confirmação, não vê dados. | Confirmado |
| C4 | Servidor confirmado vê **somente informações do seu campus**. Por padrão recebe perfil de **consulta**; apenas servidores designados (ex.: CGE) operam entregas e devoluções. | Confirmado |
| C5 | Estudante acessa **somente para consulta** e vê **apenas os livros que estão com ele** (e seus termos/comprovantes). | Confirmado |
| C6 | Exemplares controlados **por quantidade** (estoque por campus e título), não individualmente. | Confirmado |
| C7 | **Não** coletar CPF. | Confirmado |
| C8 | **Matrícula única em todo o IFC.** | Confirmado |
| C9 | **Termo de compromisso único** para todos os campi (versionado). Cada campus mantém seu próprio controle de entregas. | Confirmado |
| C10 | O estudante **assina com o dedo na tela do dispositivo do servidor, no ato da entrega**, eliminando a folha impressa. A assinatura vale como aceite por ser **controle interno**; sem tratamento específico para menores (seção 8). | Confirmado |
| C11 | Sem integração com SIGAA nesta fase; estudantes cadastrados por **importação de planilha (CSV)** e cadastro manual. | Confirmado |
| C12 | Até aprovação institucional (LGPD), o sistema opera **somente com dados fictícios**. | Confirmado |
| C13 | Stack: **Node.js + Express + HTML/CSS/JS (renderizado no servidor) + PostgreSQL** (seção 11). | Confirmado |
| C14 | **Não há transferência de livros entre campi**; cada campus gerencia seus livros. Devolução só no campus da entrega. | Confirmado |
| C15 | O estudante é identificado no atendimento pela **matrícula**: leitura de **QR code** com código assinado pelo sistema (ex.: JWT) ou **digitação**. | Confirmado |
| C16 | O dispositivo do atendimento é geralmente **institucional**, mas pode ser **pessoal**, desde que o servidor entre com o e-mail institucional. | Confirmado |
| C17 | Perda ou dano de livro exige apenas **justificativa** registrada pelo servidor; sem reposição, cobrança ou bloqueio. | Confirmado |
| C18 | Estorno de entrega/devolução: o **operador** estorna o que registrou; o **administrador do campus**, qualquer registro do campus. | Confirmado |
| P1 | Os livros são majoritariamente do PNLD, para cursos técnicos integrados ao ensino médio. | [CONFIRMAR] |
| P2 | A matrícula **não muda** quando o estudante é transferido entre campi. | [CONFIRMAR] |
| P3 | O e-mail `@estudantes.ifc.edu.br` de cada estudante consta na planilha de importação (é o elo entre login e cadastro). | [CONFIRMAR] |

---

## 2. Regras obrigatórias para agentes de desenvolvimento

Estas regras são **inegociáveis**. Um PR que viole qualquer uma delas não está concluído.

1. **Não assumir que o Campus Fraiburgo será o único campus atendido.** Todo código, consulta, tela e teste deve funcionar com N campi.
2. **Não implementar regras de negócio que dependam de um nome de campus fixo.** É proibido `if (campus === "Fraiburgo")`, comparação por sigla, ID mágico ou constante equivalente. Diferenças entre campi são configuração (seção 10).
3. **Não utilizar o campus enviado pelo frontend como prova de autorização.** O `campus_id` vindo de URL, formulário, cabeçalho ou cookie é apenas uma *intenção*; o backend sempre verifica se o usuário autenticado possui atribuição **confirmada e vigente** naquele campus para aquela ação. O campus **declarado** no primeiro acesso também não é autorização.
4. **Aplicar isolamento de dados no backend e, quando pertinente, reforçá-lo no banco de dados** (chaves compostas com `campus_id`, restrições, Row-Level Security — seção 9).
5. **Criar testes automatizados que verifiquem o isolamento entre campi e os acessos autorizados**, incluindo o isolamento entre estudantes (seção 13).
6. **Garantir que documentos, relatórios e históricos apresentem a unidade correta** — a unidade responsável *pela operação na data em que ocorreu*.
7. **Preservar a integridade dos registros históricos** mesmo quando houver transferência de estudantes entre campi. Entregas, assinaturas, devoluções e movimentações são imutáveis; correções são feitas por novos registros (estorno/ajuste) com auditoria.
8. **Documentar qualquer decisão que possa limitar a expansão para outras unidades** na seção 15.
9. **Manter o projeto configurável, sem criar ramificações específicas de código para cada campus.**
10. **Considerar o IFC – Campus Fraiburgo como primeira unidade de implantação e validação, não como restrição arquitetural.**

Regras complementares:

11. Toda tabela com dados operacionais de um campus possui coluna `campus_id NOT NULL`.
12. Toda consulta a dados de campus passa pela camada de escopo (seção 9.3).
13. Testes e fixtures usam **no mínimo dois campi** fictícios (ex.: "Campus Alfa" e "Campus Beta"). Fraiburgo aparece apenas no seed de implantação.
14. Nenhum dado pessoal (nome, matrícula, e-mail) em URL, query string ou logs de aplicação. Identificadores em URL são UUIDs.
15. **Nenhum dado real de estudante** em qualquer ambiente até a aprovação registrada em DP-01. Seeds e testes usam apenas dados gerados.
16. Domínios de e-mail aceitos são **configuração** (tabela `dominio_permitido`), não literais espalhados no código.
17. Nenhum segredo (client secret do Google, senhas de banco, chave de sessão) no repositório; usar variáveis de ambiente / GitHub Secrets.
18. **Toda tarefa de frontend segue a skill `govbr-design-system`** (`.claude/skills/govbr-design-system/SKILL.md`), conforme a seção 11.2. Agentes que não carregam skills automaticamente devem ler esse arquivo antes de criar ou alterar interfaces.

---

## 3. Requisitos

Os requisitos estão em [`docs/requirements.md`](docs/requirements.md): requisitos funcionais (`RF-001`…), não funcionais (`RNF-001`…), critérios de aceitação (`CA-xxx.n`), prioridades (MVP, Posterior, Opcional), itens fora do escopo e dúvidas em aberto (`DV-xx`).

Requisitos multi-campus obrigatórios, independentemente da prioridade de cada funcionalidade:

- Cadastrar, ativar e desativar campi sem alteração de código ou nova instalação.
- Identificar o campus de cada vínculo de estudante, atribuição de usuário, estoque, movimentação, entrega, assinatura, devolução, documento e registro de auditoria.
- Isolar os dados entre campi: servidores só veem e alteram dados do(s) campus(i) em que têm atribuição confirmada.
- Cada campus tem seu próprio estoque, vínculos, adoções, configurações e movimentações; **não há transferência de livros entre campi** (C14).
- Catálogo de títulos e termo de compromisso compartilhados, sem compartilhar estoque nem movimentações.
- Relatórios consolidados apenas para atribuição institucional.
- Transferência de **estudante** entre campi preservando o histórico do vínculo anterior.
- Documentos com os dados da unidade vigentes na data da operação (snapshot).

---

## 4. Hierarquia institucional

```
Instituição (IFC)                 ← única; dados institucionais, domínios permitidos, termo de compromisso
 └── Campus (N)                   ← unidade administrativa da gestão local
      └── Dados operacionais      ← estoque, vínculos de estudantes, adoções, entregas, devoluções, documentos
Usuário servidor ── Atribuição (papel + escopo: INSTITUCIONAL ou campus específico)
Usuário estudante ── Estudante (por e-mail institucional) ── Vínculos com campi
```

**Decisão D-01:** o sistema modela **uma** instituição. Expandir para outros IFs exigiria revisão — limitação aceita.

---

## 5. Autenticação e acesso

### 5.1 Login com Google

- Fluxo OpenID Connect (Authorization Code + PKCE) com a biblioteca `openid-client`.
- O backend valida o **ID token** e só aceita o usuário se:
  - `email_verified === true`;
  - a claim `hd` (domínio hospedado do Google Workspace) **e** o sufixo exato do e-mail pertencem a um domínio da tabela `dominio_permitido`;
  - o domínio está ativo.
- O parâmetro `hd` enviado na URL de login é apenas sugestão de interface; **não** é controle de acesso.
- Recomendação: criar o cliente OAuth em um projeto Google Cloud da organização Workspace do IFC, com tela de consentimento do tipo **"Interno"**, o que já impede contas externas [CONFIRMAR se `@estudantes.ifc.edu.br` está na mesma organização Workspace].
- Identificador estável do usuário: claim `sub` do Google (não o e-mail, que pode mudar).

| Domínio (configurável) | Tipo de usuário |
|------------------------|-----------------|
| `ifc.edu.br` | SERVIDOR |
| `estudantes.ifc.edu.br` | ESTUDANTE |
| qualquer outro | **Recusado** (sem criar registro) |

### 5.2 Primeiro acesso de servidor

1. Servidor faz login → registro `usuario` criado com tipo SERVIDOR e **sem atribuições**.
2. Tela obrigatória: escolher **seu campus** (lista de campi ativos) → cria `solicitacao_acesso` com status `PENDENTE`.
3. Enquanto pendente, o servidor vê apenas a tela "Aguardando confirmação".
4. O **administrador do campus escolhido** (ou o administrador institucional) aprova ou recusa. Na aprovação, cria-se a atribuição `CONSULTA` naquele campus; o administrador pode, no mesmo ato, conceder `OPERADOR`.
5. Recusa registra motivo; o servidor pode solicitar novamente (por exemplo, se escolheu o campus errado).
6. Mudança de campus (remoção/redistribuição): nova solicitação; a atribuição antiga é revogada pelo administrador.

**Bootstrap:** o primeiro administrador institucional é definido pela variável de ambiente `BOOTSTRAP_ADMIN_EMAILS` na primeira execução das migrações/seed. Depois disso, administradores são concedidos pela interface.

### 5.3 Acesso de estudante

1. Estudante faz login com conta `@estudantes.ifc.edu.br`.
2. O sistema procura `estudante.email_institucional` igual ao e-mail do token.
   - Encontrado: associa `estudante.usuario_id` (no primeiro acesso) e libera a área do estudante, **somente para consulta** (livros em posse, prazos, termos e comprovantes). O estudante não assina nem altera nada pela própria conta.
   - Não encontrado: mensagem "Cadastro não localizado. Procure o setor responsável pelos livros do seu campus." Nenhum dado é exibido.
3. Estudante **não** passa por aprovação de campus e **não** possui atribuições: o que ele vê é determinado exclusivamente pelo seu `estudante_id`, obtido da sessão.

### 5.4 Sessões

- Sessão em cookie `httpOnly`, `Secure`, `SameSite=Lax`, armazenada no PostgreSQL (`connect-pg-simple` ou equivalente).
- Atribuições **lidas do banco a cada requisição** (ou cache curto invalidado em toda alteração), para que revogações tenham efeito imediato.
- Expiração por inatividade configurável; logout invalida a sessão no servidor.
- **Dispositivo pessoal do servidor (C16):** páginas com dados pessoais enviadas com `Cache-Control: no-store`; nada de dados de estudantes em `localStorage`/`IndexedDB`; após o logout, voltar pelo navegador não exibe dados; a câmera é aberta apenas durante a leitura do QR code e liberada em seguida.

---

## 6. Perfis e permissões

### 6.1 Perfis

| Perfil | Tipo de usuário | Escopo | Como é obtido |
|--------|-----------------|--------|---------------|
| `ADMIN_INSTITUCIONAL` | Servidor | Institucional | Bootstrap ou concedido por outro admin institucional. Poucas pessoas [CONFIRMAR quem]. |
| `ADMIN_CAMPUS` | Servidor | Campus | Concedido pelo admin institucional. Aprova acessos, gerencia operadores, estoque, adoções e estudantes do campus. |
| `OPERADOR` | Servidor | Campus | Concedido pelo admin do campus a servidores designados (ex.: CGE). Identifica o estudante, prepara entregas, coleta a assinatura no próprio dispositivo, registra devoluções e estorna os próprios registros. |
| `CONSULTA` | Servidor | Campus ou institucional | **Padrão** do servidor confirmado no campus. Somente leitura. |
| `ESTUDANTE` | Estudante | Próprios dados | Implícito pelo domínio + cadastro de estudante. **Somente consulta.** |

- `ADMIN_INSTITUCIONAL` só existe com escopo institucional; `ADMIN_CAMPUS` e `OPERADOR` só com escopo de campus.
- Um servidor confirmado num campus tem, no mínimo, `CONSULTA` nele; papéis adicionais se somam.
- O admin institucional **não opera** entregas sem uma atribuição explícita de campus (separação de funções, auditada).

### 6.2 Matriz de permissões

Legenda: ✅ permitido · 🔸 apenas no(s) campus(i) atribuído(s) · 👤 apenas os próprios dados · ❌ negado

| Ação | ADMIN_INST. | ADMIN_CAMPUS | OPERADOR | CONSULTA (campus) | CONSULTA (inst.) | ESTUDANTE |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Cadastrar/ativar/desativar campus | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Gerenciar domínios permitidos e dados institucionais | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Publicar nova versão do termo de compromisso | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Editar configurações do campus | ✅ | 🔸 | ❌ | ❌ | ❌ | ❌ |
| Aprovar/recusar solicitações de acesso | ✅ | 🔸 | ❌ | ❌ | ❌ | ❌ |
| Conceder `ADMIN_CAMPUS` / `CONSULTA` institucional | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Conceder/revogar `OPERADOR` e `CONSULTA` de campus | ✅ | 🔸 | ❌ | ❌ | ❌ | ❌ |
| Criar/editar título no catálogo | ✅ | 🔸 criar* | ❌ | ❌ | ❌ | ❌ |
| Mesclar títulos duplicados | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Consultar catálogo | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manter adoções do campus | ✅ | 🔸 | ❌ | ❌ | ❌ | ❌ |
| Entrada/ajuste/baixa de estoque | ✅ | 🔸 | ❌ | ❌ | ❌ | ❌ |
| Importar/editar estudantes e vínculos | ✅ | 🔸 | ❌ | ❌ | ❌ | ❌ |
| Identificar estudante (QR code ou matrícula digitada) | ❌** | 🔸 | 🔸 | ❌ | ❌ | ❌ |
| Preparar entrega / registrar devolução | ❌** | 🔸 | 🔸 | ❌ | ❌ | ❌ |
| Coletar a assinatura do estudante no próprio dispositivo*** | ❌** | 🔸 | 🔸 | ❌ | ❌ | ❌ |
| Cancelar entrega preparada (não assinada) | ❌** | 🔸 | 🔸 | ❌ | ❌ | ❌ |
| Estornar entrega/devolução efetivada (com justificativa) | ❌** | 🔸 | 🔸 próprios registros | ❌ | ❌ | ❌ |
| Ver entregas, pendências e documentos | ✅ | 🔸 | 🔸 | 🔸 | ✅ | 👤 |
| Registrar transferência de estudante | ✅ | 🔸 destino | ❌ | ❌ | ❌ | ❌ |
| Relatórios do campus | ✅ | 🔸 | 🔸 | 🔸 | ✅ | ❌ |
| Relatórios consolidados | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Consultar auditoria | ✅ | 🔸 | ❌ | ❌ | ✅ | ❌ |

\* Admin de campus cria títulos; títulos com mesmo ISBN são reaproveitados; mesclas de duplicatas ficam com o admin institucional (DP-05).
\** Somente com atribuição explícita de `ADMIN_CAMPUS`/`OPERADOR` naquele campus.
\*** Quem **desenha** a assinatura é o estudante, na tela do dispositivo do servidor; a ação no sistema é do servidor logado, que nunca assina em nome do estudante. Não há transferência de livros entre campi (C14).

### 6.3 Regras de atribuição

- Atribuições têm vigência e podem ser revogadas com efeito imediato.
- Servidor sem atribuição vigente vê apenas a tela de solicitação/aguardo.
- Toda concessão, revogação, aprovação e recusa é auditada.
- Não é possível remover o último `ADMIN_INSTITUCIONAL` ativo.

---

## 7. Modelagem de dados

### 7.1 Classificação das entidades

| Entidade | Escopo | Justificativa |
|----------|--------|---------------|
| `instituicao` | Global (única) | Dados do IFC para documentos. |
| `dominio_permitido` | Global | Domínios de login e tipo de usuário associado. |
| `campus` | Global | Cadastro das unidades. |
| `campus_configuracao` | Por campus | Seção 10. |
| `usuario` | Global | Conta Google autenticada (servidor ou estudante). |
| `solicitacao_acesso` | Por campus (declarado) | Pedido do servidor; não concede nada até aprovado. |
| `atribuicao` | Global com campus opcional | Papel + escopo. |
| `componente_curricular`, `titulo` | **Global** | Catálogo compartilhado; uma linha por edição (ISBN). |
| `termo_modelo` | **Global**, versionado | Termo único para todos os campi (C9). |
| `periodo_letivo` (ano letivo), `curso` | Por campus | Oferta local. Sem turmas nem semestres (D-21). |
| `adocao` | Por campus | Títulos, cursos/séries e quantidades de cada campus. |
| `estoque` | Por campus | Saldo disponível por título (C6). |
| `movimentacao_estoque` | Por campus | Livro-razão imutável de entradas/saídas. Não há transferência entre campi (C14). |
| `estudante` | **Global** | Matrícula única no IFC (C8); sem CPF (C7). |
| `vinculo_estudante` | Por campus | Matrícula ativa em um campus, com curso, série e ano letivo. |
| `entrega`, `entrega_item` | Por campus (da operação) | Controle interno de cada campus (C9). |
| `assinatura_termo` | Por campus (da entrega) | Imagem e traçado da assinatura feita na tela do servidor e demais evidências (seção 8). |
| `devolucao`, `devolucao_item` | Por campus (que recebeu) | Atendimento + itens ligados aos itens de entrega; imutáveis. |
| `documento_emitido` | Por campus | Snapshot da unidade e código de verificação. |
| `auditoria` | Global com `campus_id` opcional | Ações institucionais não têm campus. |

**Decisão D-02 — identidade do estudante:** como a matrícula é única no IFC, `estudante` é global (matrícula, nome, e-mail institucional). O vínculo com cada campus fica em `vinculo_estudante`. Um **servidor** só enxerga um estudante se houver vínculo (vigente ou encerrado) com um campus em que tem atribuição. O **estudante** enxerga tudo o que é seu, em qualquer campus.

### 7.2 Esquema lógico (PostgreSQL, esboço)

> Esboço para orientar a implementação; nomes e tipos podem ser ajustados, mas as **restrições** devem ser preservadas. A ordem privilegia a leitura, não a ordem das migrações.

```sql
-- ===================== GLOBAIS =====================
CREATE TABLE instituicao (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome_oficial  text NOT NULL,
  sigla         text NOT NULL,
  cnpj          char(14),
  logotipo_arquivo text
);

CREATE TYPE tipo_usuario AS ENUM ('SERVIDOR','ESTUDANTE');

CREATE TABLE dominio_permitido (
  dominio  text PRIMARY KEY,                 -- 'ifc.edu.br', 'estudantes.ifc.edu.br'
  tipo     tipo_usuario NOT NULL,
  ativo    boolean NOT NULL DEFAULT true
);

CREATE TABLE campus (
  id            uuid PRIMARY KEY,
  codigo        text NOT NULL UNIQUE,         -- estável; nunca usado em regra de negócio
  nome_oficial  text NOT NULL,
  nome_curto    text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
  id            uuid PRIMARY KEY,
  google_sub    text NOT NULL UNIQUE,          -- identificador estável do Google
  email         text NOT NULL UNIQUE,
  nome          text NOT NULL,
  tipo          tipo_usuario NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  ultimo_login  timestamptz
);

CREATE TABLE solicitacao_acesso (
  id                 uuid PRIMARY KEY,
  usuario_id         uuid NOT NULL REFERENCES usuario(id),
  campus_id          uuid NOT NULL REFERENCES campus(id),   -- campus DECLARADO
  status             text NOT NULL CHECK (status IN ('PENDENTE','APROVADA','RECUSADA','CANCELADA')),
  solicitada_em      timestamptz NOT NULL DEFAULT now(),
  decidida_por       uuid REFERENCES usuario(id),
  decidida_em        timestamptz,
  motivo_recusa      text
);
CREATE UNIQUE INDEX ux_solicitacao_pendente ON solicitacao_acesso (usuario_id) WHERE status = 'PENDENTE';
CREATE INDEX ix_solicitacao_campus ON solicitacao_acesso (campus_id, status);

CREATE TYPE papel AS ENUM ('ADMIN_INSTITUCIONAL','ADMIN_CAMPUS','OPERADOR','CONSULTA');

CREATE TABLE atribuicao (
  id               uuid PRIMARY KEY,
  usuario_id       uuid NOT NULL REFERENCES usuario(id),
  papel            papel NOT NULL,
  campus_id        uuid NULL REFERENCES campus(id),     -- NULL = institucional
  concedida_por    uuid REFERENCES usuario(id),         -- NULL apenas no bootstrap
  concedida_em     timestamptz NOT NULL DEFAULT now(),
  revogada_por     uuid REFERENCES usuario(id),
  revogada_em      timestamptz,
  CHECK (
    (papel = 'ADMIN_INSTITUCIONAL' AND campus_id IS NULL) OR
    (papel IN ('ADMIN_CAMPUS','OPERADOR') AND campus_id IS NOT NULL) OR
    (papel = 'CONSULTA')
  )
);
CREATE UNIQUE INDEX ux_atribuicao_ativa
  ON atribuicao (usuario_id, papel, COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revogada_em IS NULL;
-- trigger: usuario.tipo deve ser SERVIDOR

CREATE TABLE componente_curricular (id uuid PRIMARY KEY, nome text NOT NULL UNIQUE);

CREATE TABLE titulo (
  id               uuid PRIMARY KEY,
  isbn13           char(13) UNIQUE,
  codigo_programa  text,                       -- ex.: código PNLD
  titulo           text NOT NULL,
  autores          text NOT NULL,
  editora          text,
  edicao           text,
  volume           text,
  abrangencia      text NOT NULL CHECK (abrangencia IN ('SERIE_ESPECIFICA','ENSINO_MEDIO_COMPLETO')),
  serie            smallint,                   -- obrigatória quando SERIE_ESPECIFICA
  ano_publicacao   smallint,
  componente_id    uuid REFERENCES componente_curricular(id),
  mesclado_em_id   uuid REFERENCES titulo(id)  -- deduplicação sem apagar histórico
);

CREATE TABLE termo_modelo (                    -- ÚNICO para todos os campi (C9)
  id            uuid PRIMARY KEY,
  versao        integer NOT NULL UNIQUE,
  texto         text NOT NULL,                 -- pode conter marcadores: {campus}, {estudante}, {itens}
  hash_texto    char(64) NOT NULL,             -- SHA-256
  vigente_de    timestamptz NOT NULL,
  publicado_por uuid NOT NULL REFERENCES usuario(id)
);

CREATE TABLE estudante (                       -- GLOBAL: matrícula única no IFC (C8)
  id                 uuid PRIMARY KEY,
  matricula          text NOT NULL UNIQUE,
  nome               text NOT NULL,
  email_institucional text NOT NULL UNIQUE,    -- elo com o login (@estudantes.ifc.edu.br)
  usuario_id         uuid UNIQUE REFERENCES usuario(id),  -- preenchido no primeiro login
  qr_versao          integer NOT NULL DEFAULT 1,  -- invalida QR codes anteriores ao ser incrementada (seção 8.2, DV-19)
  criado_em          timestamptz NOT NULL DEFAULT now()
);

-- ===================== POR CAMPUS =====================
-- Padrão: toda tabela por campus tem UNIQUE (campus_id, id) para permitir FKs compostas.

CREATE TABLE campus_configuracao (
  campus_id  uuid PRIMARY KEY REFERENCES campus(id),
  endereco   text, cidade text, uf char(2), cep char(8),
  setor_responsavel text,                      -- ex.: "CGE"
  email_setor text, telefone text,
  permite_entrega_com_pendencia boolean NOT NULL DEFAULT true   -- RN-21: padrão é permitir com aviso
);

CREATE TABLE periodo_letivo (                  -- ANO letivo (D-21): um por ano em cada campus
  id uuid PRIMARY KEY, campus_id uuid NOT NULL REFERENCES campus(id),
  ano smallint NOT NULL, inicio date NOT NULL, fim date NOT NULL,   -- fim = término das aulas (prazo, RN-44)
  UNIQUE (campus_id, id), UNIQUE (campus_id, ano)
);
CREATE TABLE curso (
  id uuid PRIMARY KEY, campus_id uuid NOT NULL REFERENCES campus(id), nome text NOT NULL,
  UNIQUE (campus_id, id)
);

CREATE TABLE adocao (
  id uuid PRIMARY KEY, campus_id uuid NOT NULL, periodo_letivo_id uuid NOT NULL,
  titulo_id uuid NOT NULL REFERENCES titulo(id),
  curso_id uuid, serie smallint,
  quantidade_prevista integer CHECK (quantidade_prevista >= 0),
  UNIQUE (campus_id, id),
  FOREIGN KEY (campus_id, periodo_letivo_id) REFERENCES periodo_letivo(campus_id, id),
  FOREIGN KEY (campus_id, curso_id)          REFERENCES curso(campus_id, id)
);

-- Estoque por quantidade (C6)
CREATE TABLE estoque (
  campus_id   uuid NOT NULL REFERENCES campus(id),
  titulo_id   uuid NOT NULL REFERENCES titulo(id),
  disponivel  integer NOT NULL DEFAULT 0 CHECK (disponivel >= 0),
  PRIMARY KEY (campus_id, titulo_id)
);

CREATE TYPE tipo_movimentacao AS ENUM
  ('ENTRADA','ENTREGA','DEVOLUCAO','BAIXA','AJUSTE','ESTORNO');

CREATE TABLE movimentacao_estoque (           -- livro-razão imutável
  id            bigserial PRIMARY KEY,
  campus_id     uuid NOT NULL,
  titulo_id     uuid NOT NULL,
  tipo          tipo_movimentacao NOT NULL,
  quantidade    integer NOT NULL CHECK (quantidade <> 0),   -- positiva = entra, negativa = sai
  referencia_tipo text, referencia_id uuid,                 -- entrega, devolução, estorno...
  justificativa text,
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  ocorrido_em   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campus_id, titulo_id) REFERENCES estoque(campus_id, titulo_id)
);
CREATE INDEX ix_mov_campus_titulo ON movimentacao_estoque (campus_id, titulo_id, ocorrido_em);
-- Invariante: estoque.disponivel = SUM(movimentacao_estoque.quantidade) por (campus, título).
-- Ambos atualizados na MESMA transação; verificação periódica de consistência.

CREATE TABLE vinculo_estudante (
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL REFERENCES campus(id),
  estudante_id uuid NOT NULL REFERENCES estudante(id),
  curso_id uuid NOT NULL, periodo_letivo_id uuid NOT NULL,
  serie smallint NOT NULL CHECK (serie BETWEEN 1 AND 4),   -- DP-17
  situacao text NOT NULL,                         -- ATIVO, TRANSFERIDO, CONCLUIDO, EVADIDO, CANCELADO
  inicio date NOT NULL, fim date,
  UNIQUE (campus_id, id),
  FOREIGN KEY (campus_id, curso_id) REFERENCES curso(campus_id, id),
  FOREIGN KEY (campus_id, periodo_letivo_id) REFERENCES periodo_letivo(campus_id, id)
);
-- no máximo um vínculo ATIVO por estudante em todo o IFC
CREATE UNIQUE INDEX ux_vinculo_ativo ON vinculo_estudante (estudante_id) WHERE situacao = 'ATIVO';
CREATE INDEX ix_vinculo_campus ON vinculo_estudante (campus_id, situacao);

CREATE TYPE status_entrega AS ENUM
  ('PREPARADA','ASSINADA','CANCELADA','ESTORNADA');   -- sem expiração automática (RN-24)

CREATE TABLE entrega (
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL REFERENCES campus(id),   -- campus DA OPERAÇÃO (imutável)
  vinculo_id uuid NOT NULL,
  periodo_letivo_id uuid NOT NULL,                 -- período do vínculo do estudante (RN-15)
  termo_modelo_id uuid NOT NULL REFERENCES termo_modelo(id),
  status status_entrega NOT NULL DEFAULT 'PREPARADA',
  forma_identificacao text NOT NULL CHECK (forma_identificacao IN ('QR_CODE','MATRICULA_DIGITADA')),
  avisos_confirmados jsonb NOT NULL DEFAULT '[]',  -- RN-18, RN-20, RN-21: avisos exibidos e confirmados
  preparada_por uuid NOT NULL REFERENCES usuario(id),
  preparada_em timestamptz NOT NULL DEFAULT now(),
  estornada_por uuid REFERENCES usuario(id),       -- RN-28
  estornada_em timestamptz,
  justificativa_estorno text,
  snapshot_estudante jsonb NOT NULL,               -- nome, matrícula, curso, série na data
  snapshot_unidade   jsonb NOT NULL,               -- nome oficial, endereço, setor na data
  CHECK (status <> 'ESTORNADA' OR (estornada_por IS NOT NULL AND justificativa_estorno IS NOT NULL)),
  UNIQUE (campus_id, id),
  FOREIGN KEY (campus_id, vinculo_id)        REFERENCES vinculo_estudante(campus_id, id),
  FOREIGN KEY (campus_id, periodo_letivo_id) REFERENCES periodo_letivo(campus_id, id)
);
CREATE INDEX ix_entrega_campus_status ON entrega (campus_id, status);
-- RN-22: no máximo uma entrega aguardando assinatura por vínculo
CREATE UNIQUE INDEX ux_entrega_preparada ON entrega (vinculo_id) WHERE status = 'PREPARADA';
CREATE INDEX ix_entrega_vinculo ON entrega (vinculo_id);

CREATE TABLE entrega_item (
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL,
  entrega_id uuid NOT NULL,
  titulo_id uuid NOT NULL REFERENCES titulo(id),
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade = 1),   -- RN-17: um exemplar por título
  UNIQUE (campus_id, id),
  UNIQUE (entrega_id, titulo_id),
  FOREIGN KEY (campus_id, entrega_id) REFERENCES entrega(campus_id, id)
);

CREATE TABLE assinatura_termo (                    -- assinatura feita na tela do dispositivo do servidor (RN-30, RN-33)
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL,
  entrega_id uuid NOT NULL UNIQUE,                 -- uma assinatura por entrega
  estudante_id uuid NOT NULL REFERENCES estudante(id),
  conduzida_por uuid NOT NULL REFERENCES usuario(id), -- servidor logado que conduziu o atendimento
  forma_identificacao text NOT NULL CHECK (forma_identificacao IN ('QR_CODE','MATRICULA_DIGITADA')),
  imagem_png bytea NOT NULL,                       -- imagem da assinatura (dado pessoal: exibida só no termo)
  tracado jsonb NOT NULL,                          -- pontos e tempos do traçado
  termo_versao integer NOT NULL,
  hash_documento char(64) NOT NULL,                -- SHA-256 do termo renderizado + itens + dados + imagem
  assinado_em timestamptz NOT NULL DEFAULT now(),
  ip inet, user_agent text,
  FOREIGN KEY (campus_id, entrega_id) REFERENCES entrega(campus_id, id)
);

CREATE TABLE devolucao (                          -- um atendimento = um comprovante
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL REFERENCES campus(id),   -- campus que RECEBEU
  estudante_id uuid NOT NULL REFERENCES estudante(id),
  recebida_por uuid NOT NULL REFERENCES usuario(id),
  recebida_em timestamptz NOT NULL DEFAULT now(),
  snapshot_estudante jsonb NOT NULL,
  snapshot_unidade   jsonb NOT NULL,
  estornada_por uuid REFERENCES usuario(id),       -- RN-43
  estornada_em timestamptz,
  justificativa_estorno text,
  UNIQUE (campus_id, id)
);

CREATE TABLE devolucao_item (
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL,
  devolucao_id uuid NOT NULL,
  entrega_item_id uuid NOT NULL REFERENCES entrega_item(id),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  resultado text NOT NULL CHECK (resultado IN ('DEVOLVIDO','DANIFICADO','PERDIDO')),
  justificativa text,                              -- RN-66: obrigatória para danificado/perdido
  observacao text,
  CHECK (resultado = 'DEVOLVIDO' OR COALESCE(length(trim(justificativa)), 0) > 0),   -- COALESCE: CHECK NULL seria aceito
  FOREIGN KEY (campus_id, devolucao_id) REFERENCES devolucao(campus_id, id)
);
-- trigger: SUM(devolucao_item.quantidade) por entrega_item <= entrega_item.quantidade
-- trigger: entrega deve estar ASSINADA e pertencer ao mesmo campus da devolução (RN-37)
-- trigger: devoluções estornadas não contam na soma

CREATE TABLE documento_emitido (
  id uuid PRIMARY KEY,
  campus_id uuid NOT NULL REFERENCES campus(id),
  tipo text NOT NULL CHECK (tipo IN ('TERMO_ASSINADO','COMPROVANTE_DEVOLUCAO','NADA_CONSTA')),
  referencia_id uuid NOT NULL,
  estudante_id uuid NOT NULL REFERENCES estudante(id),
  conteudo_snapshot jsonb NOT NULL,                -- tudo o que é exibido no documento
  codigo_verificacao text NOT NULL UNIQUE,         -- aleatório, curto, para validação
  hash_conteudo char(64) NOT NULL,
  emitido_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid REFERENCES usuario(id),
  campus_id uuid REFERENCES campus(id),             -- NULL para ações institucionais
  acao text NOT NULL, entidade text NOT NULL, entidade_id text NOT NULL,
  antes jsonb, depois jsonb, ip inet
);
CREATE INDEX ix_auditoria_campus_data ON auditoria (campus_id, ocorrido_em);
```

### 7.3 Integridade e consistência

- **FK compostas `(campus_id, id)`** entre tabelas do mesmo campus impedem, no banco, que uma entrega do Campus A referencie vínculo, ano letivo ou curso do Campus B.
- **Estoque:** `estoque.disponivel` e `movimentacao_estoque` são alterados na **mesma transação**, com `SELECT ... FOR UPDATE` na linha de estoque. O `CHECK (disponivel >= 0)` impede saldo negativo mesmo sob concorrência.
- **Entrega:** só baixa estoque no momento da **assinatura** (status `ASSINADA`); na assinatura, revalida saldo. Entrega `PREPARADA` não reserva estoque.
- **Devolução:** somente no campus da entrega; soma das devoluções de um item ≤ quantidade entregue; só `DEVOLVIDO` retorna ao estoque; `PERDIDO` não retorna; `DANIFICADO` não retorna (proposta, DV-20). Danificado e perdido exigem justificativa ([`docs/business-rules.md`](docs/business-rules.md), RN-40, RN-66).
- **Estorno:** operador estorna os próprios registros (`preparada_por` / `recebida_por` = usuário); administrador do campus, qualquer registro do campus; justificativa obrigatória; entrega com devolução registrada não pode ser estornada (RN-28, RN-43).
- **Imutabilidade:** o papel de banco da aplicação **não** tem `UPDATE`/`DELETE` em `movimentacao_estoque`, `assinatura_termo`, `devolucao_item`, `documento_emitido`, `auditoria`. `entrega` só pode ter o `status` alterado nas transições válidas e `devolucao` só pode receber a marcação de estorno (triggers).
- **Exclusão lógica** para cadastros (`ativo = false`).

### 7.4 Transferências e histórico

**Estudante transferido (A → B)** — a matrícula é a mesma (P2):

1. O vínculo em A é encerrado (`TRANSFERIDO`, `fim` preenchido); um novo vínculo é criado em B. O índice `ux_vinculo_ativo` garante um único vínculo ativo.
2. Entregas feitas em A continuam pertencendo a A (`entrega.campus_id`).
3. **Pendências em A:** regra padrão — devolver em A antes da transferência; se não ocorrer, permanecem como pendência de A ("estudante transferido"). [CONFIRMAR — DP-08]
4. Servidores de B não veem o histórico de A; no máximo um aviso "possui pendências em outro campus" (sem detalhes). [CONFIRMAR — DP-08]
5. O **estudante** vê na área de consulta todos os seus livros, de A e de B, cada um identificado com o campus responsável.

**Livros:** não há transferência entre campi (C14). Livros de A só podem ser devolvidos em A.

**Servidor que muda de campus:** nova solicitação de acesso; atribuições antigas revogadas. Operações já registradas mantêm o `campus_id` da operação.

**Consultas históricas** usam sempre o `campus_id` e os snapshots gravados no registro, nunca o campus atual do estudante.

---

## 8. Identificação do estudante e assinatura do termo

Objetivo: substituir a folha impressa por uma assinatura que o estudante faz **com o dedo na tela do dispositivo do servidor**, no ato da entrega, sem papel para arquivar. Regras completas: [`docs/business-rules.md`](docs/business-rules.md), seções 3 e 4 (RN-24 a RN-36, RN-77 a RN-79).

### 8.1 Fundamento

- A assinatura na tela **vale como aceite** do termo porque o termo é um **controle interno** do campus (DV-02). Não há tratamento específico para estudantes menores de idade.
- Não é assinatura com certificado digital nem assinatura qualificada; a interface e os documentos não devem apresentá-la como tal.

### 8.2 Identificação do estudante (C15)

1. O operador identifica o estudante pela **matrícula**, de uma de duas formas:
   - **QR code:** a câmera do dispositivo lê um QR code com um **token assinado pelo sistema** (ex.: JWT) contendo a matrícula e dados de controle (`tipo`, emissão, identificador do token e, se houver, validade). Nenhum outro dado pessoal.
   - **Digitação** da matrícula.
2. O backend valida o token (assinatura, tipo, validade, versão) ou a matrícula, confirma vínculo **ativo no campus do operador** e mostra nome, curso e série para conferência.
3. Token inválido, adulterado, expirado ou de outro sistema é recusado; o operador pode digitar a matrícula.
4. **Pendente (DV-19):** onde o estudante obtém o QR code (área do estudante, carteirinha impressa ou outro), se expira e como invalidar um código perdido. Para permitir invalidação sem guardar cada token, o modelo prevê `estudante.qr_versao` (incrementada ao invalidar). Até a definição, a digitação da matrícula atende todos os casos.

### 8.3 Fluxo no balcão

1. **Operador** identifica o estudante (8.2) e escolhe os títulos (um exemplar por título). O sistema exibe avisos — título já em posse, título fora das adoções, pendência vencida — que o operador confirma (RN-18, RN-20, RN-21) → entrega `PREPARADA`.
2. O operador entra no **modo assinatura** e entrega o dispositivo ao estudante. A tela mostra **apenas** nome e matrícula, campus, texto completo do termo, lista de livros e área de assinatura — sem menus nem dados de outros estudantes.
3. O **estudante** lê, desenha a assinatura com o dedo (pode limpar e refazer) e confirma. Assinatura em branco é recusada.
4. O backend, na mesma transação: confere vínculo ativo e saldo, grava `assinatura_termo` (imagem, traçado, servidor que conduziu, forma de identificação, versão do termo, hash, IP, dispositivo), muda a entrega para `ASSINADA`, baixa o estoque e gera `documento_emitido` (TERMO_ASSINADO).
5. A tela mostra a confirmação e pede que o dispositivo seja devolvido ao servidor; o servidor entrega os livros.
6. **Não há expiração automática** (DV-04). Entrega preparada e não assinada (ex.: navegador fechado) pode ser retomada ou cancelada pelo operador.

### 8.4 Regras

- O servidor conduz o atendimento, mas **nunca assina em nome do estudante**. Não há assinatura pelo celular do estudante nem por link.
- O documento assinado é **imutável**; o estudante o consulta na área do estudante, e servidores autorizados do campus no histórico.
- A **imagem da assinatura** é dado pessoal: aparece apenas no termo; nunca em listagens, exportações ou logs.
- Captura da assinatura em JavaScript puro (canvas + Pointer Events), funcionando com toque, caneta e mouse, em telas a partir de 360 px.
- Validação pública opcional: página `/verificar/{codigo}` que confirma a autenticidade mostrando apenas tipo, campus, data e situação — **sem** dados pessoais (DP-12).
- **Estudante impossibilitado de assinar** (ex.: deficiência motora, recusa): **adiado** (DP-15 / DV-06). Não implementar até a definição.
- **Devolução** não exige assinatura do estudante; o comprovante digital fica disponível na área do estudante.

---

## 9. Isolamento de dados e autorização

### 9.1 Princípios

1. **Negar por padrão.** Sem atribuição vigente que conceda a ação no campus do recurso, a resposta é negada.
2. **O campus do recurso vem do banco, não do cliente.** Para recursos existentes, o backend carrega o recurso, lê seu `campus_id` e verifica a atribuição.
3. **Estudante:** o `estudante_id` vem **somente da sessão**; nunca de parâmetro da requisição.
4. **Três camadas:** (a) autorização por ação (middleware/serviço); (b) camada de escopo nos repositórios; (c) reforço no banco (FK compostas + RLS).
5. **Respostas não vazam existência:** recurso fora do escopo retorna `404` em leituras por ID.

### 9.2 Contexto de requisição

```
req.contexto = {
  usuario_id, tipo,                  // SERVIDOR | ESTUDANTE
  estudante_id,                      // apenas se ESTUDANTE (resolvido no login)
  atribuicoes,                       // lidas do banco a cada requisição
  campus_trabalho_id,                // intenção vinda da UI; validada contra atribuicoes
  campiPermitidos(acao)              // derivado das atribuições, nunca do cliente
}
```

### 9.3 Camada de escopo (backend)

- Todo repositório de entidade por campus exige `campiPermitidos` e aplica `WHERE campus_id = ANY($1)`; não existe função pública que liste dados de campus sem escopo.
- Repositórios da área do estudante filtram por `estudante_id` da sessão.
- Exceções (relatórios consolidados, rotinas do sistema como a verificação de consistência do estoque) usam escopo institucional explícito, disponível só com atribuição institucional ou para processo de sistema identificado — e são auditadas.
- SQL é escrito à mão (sem ORM) justamente para ser revisável; revisão de código deve conferir o filtro de escopo em toda consulta nova.

### 9.4 Reforço no banco (Row-Level Security)

- A aplicação conecta com um papel **sem** `BYPASSRLS` e que **não** é dono das tabelas. Migrações rodam com outro papel.
- Em cada transação: `SET LOCAL app.campi = '{...}'`, `SET LOCAL app.escopo_institucional = 'true|false'`, `SET LOCAL app.estudante_id = '...'`.

```sql
ALTER TABLE entrega ENABLE ROW LEVEL SECURITY;
ALTER TABLE entrega FORCE ROW LEVEL SECURITY;

CREATE POLICY p_entrega_servidor ON entrega
  USING (
    current_setting('app.escopo_institucional', true) = 'true'
    OR campus_id = ANY (current_setting('app.campi', true)::uuid[])
  )
  WITH CHECK (campus_id = ANY (current_setting('app.campi', true)::uuid[]));

CREATE POLICY p_entrega_estudante ON entrega FOR SELECT
  USING (vinculo_id IN (
    SELECT id FROM vinculo_estudante
    WHERE estudante_id = NULLIF(current_setting('app.estudante_id', true), '')::uuid));
```

- `WITH CHECK` não inclui o escopo institucional: escrita sempre exige campus explícito.
- Com pool de conexões (`pg.Pool`), `SET LOCAL` exige transação explícita por requisição; um helper `comContexto(req, async (db) => ...)` deve ser a única forma de acessar o banco nas rotas.
- RLS é **reforço**, não substitui as verificações do backend.

### 9.5 Outros vetores

- **CSRF:** token em todos os formulários (páginas renderizadas no servidor) + `SameSite=Lax`.
- **XSS:** templates com escape automático; CSP restritiva; sem `innerHTML` com dados do usuário.
- **Buscas/autocompletes** respeitam escopo.
- **Exportações (CSV/relatórios):** filtro aplicado na consulta, nunca na renderização.
- **Modo assinatura:** só abre para entrega `PREPARADA` do campus do operador; não exibe menus nem dados de outros estudantes.
- **QR code de identificação:** o token é validado no servidor (assinatura, tipo, validade, versão); o conteúdo lido nunca é confiável por si só, e o estudante encontrado ainda precisa ter vínculo ativo no campus do operador.
- **Cache e jobs** incluem `campus_id`/escopo na chave e no contexto.
- **Logs** sem dados pessoais.

---

## 10. Configurações

**Institucionais** (únicas): nome e sigla do IFC, logotipo, domínios permitidos, termo de compromisso (versionado).

**Por campus** (`campus` / `campus_configuracao`):

| Configuração | Observação |
|--------------|------------|
| Nome oficial, nome curto, código | Usados em documentos. |
| Endereço, cidade/UF, CEP, telefone, e-mail do setor | Snapshot nas entregas e documentos. |
| Setor responsável (ex.: CGE) | Exibido nos documentos e na área do estudante. |
| Permitir entrega a estudante com pendência vencida | Booleano; padrão **permitir com aviso** (RN-21). |
| Período letivo vigente | Via `periodo_letivo`. |

**Diretriz de simplicidade:** adicionar configuração **somente** quando houver diferença real e confirmada entre campi. Sem motor de regras, workflows configuráveis ou campos dinâmicos.

---

## 11. Stack tecnológica

| Camada | Escolha |
|--------|---------|
| Runtime | **Node.js 24 LTS** (JavaScript, módulos ES) |
| Framework HTTP | **Express 5** |
| Interface | **HTML renderizado no servidor (EJS)** + JavaScript puro apenas onde necessário (captura da assinatura, leitura do QR code) |
| Design System | **Padrão Digital de Governo (GovBR-DS)** via `@govbr-ds/core`, servido localmente (seção 11.2) |
| Banco | **PostgreSQL 17** |
| Acesso ao banco | `pg` + SQL escrito à mão; migrações versionadas em SQL (`node-pg-migrate` ou equivalente) |
| Autenticação | `openid-client` (Google OIDC) |
| Sessão | `express-session` + store PostgreSQL |
| Validação | `zod` |
| Segurança HTTP | `helmet`, proteção CSRF, `express-rate-limit` no login |
| Documentos | Páginas HTML com CSS de impressão (o navegador salva em PDF); geração de PDF no servidor só se necessário |
| Token do QR code | `jose` (JWT assinado pelo servidor); geração do QR code em SVG (ex.: `qrcode`) só se DV-19 definir que o sistema o exibe |
| Leitura do QR code | API `BarcodeDetector` do navegador quando disponível; biblioteca JS leve como alternativa (escolher na implementação e registrar) |
| Assinatura na tela | JavaScript puro (canvas + Pointer Events), sem biblioteca |
| Testes | `node:test` + `supertest` + PostgreSQL real em Docker; Playwright para fluxos críticos de interface |
| Qualidade | ESLint + Prettier; `// @ts-check` com JSDoc nos módulos de domínio (opcional) |

Diretrizes: poucas dependências, todas com versão fixada (`package-lock.json`); sem framework de frontend; sem ORM.

### 11.1 Estrutura e camadas

A estrutura de diretórios, as camadas (apresentação, aplicação, domínio, persistência, infraestrutura) e as regras de dependência entre elas estão em [`docs/architecture.md`](docs/architecture.md), seções 3.2 e 3.3. Skills de projeto ficam em `/.claude/skills`.

### 11.2 Interface e Design System (obrigatório em tarefas de frontend)

Toda criação ou alteração de páginas, parciais EJS, CSS ou JS de navegador deve seguir a skill **`govbr-design-system`** (`.claude/skills/govbr-design-system/SKILL.md`). Em resumo:

- Referência principal: https://www.gov.br/ds/. Consultar a página oficial do componente (abas Visão Geral, Códigos, Acessibilidade) e a versão instalada do pacote **antes** de usá-lo; nunca inventar classes, propriedades, eventos, métodos ou componentes.
- Implementação padrão: **`@govbr-ds/core`** (HTML/CSS/JS), compatível com páginas renderizadas no servidor e formulários nativos. Web Components (`@govbr-ds/webcomponents`) apenas caso a caso, com decisão registrada na seção 15. Sem frameworks de frontend.
- Arquivos do DS, fonte Rawline e ícones servidos localmente (sem CDN externo), por segurança e CSP.
- Proibido criar componentes que dupliquem os oficiais; componentes de domínio (ex.: lista de livros pendentes) são parciais EJS compostas de componentes e tokens oficiais.
- GovBR-DS (padrão de interface) ≠ identidade visual do IFC (marca). Logotipos apenas os oficiais, e somente após DP-11.
- Acessibilidade WCAG 2.1 AA/eMAG, navegação por teclado, foco visível, contraste e responsividade (mobile-first no atendimento, no modo assinatura e na área do estudante).
- O **checklist da seção 8 da skill** faz parte do Definition of Done de qualquer tarefa de frontend.

---

## 12. Implantação e operação

### 12.1 Modelo

**Instalação única compartilhada com isolamento lógico por campus** (decisão D-07), hospedada na **VPS do projeto**.

```
Internet ──HTTPS──> Caddy (TLS automático) ──> app (Node, container) ──> PostgreSQL (container, volume persistente)
```

- `docker-compose.yml` com serviços `caddy`, `app`, `db`; banco **não** exposto para a internet.
- Domínio neutro (ex.: `livros.<dominio>`), **sem** referência a Fraiburgo, para não criar dependência do primeiro campus.
- Ambientes: **local** (compose de desenvolvimento), **homologação** (opcional, na mesma VPS, banco separado) e **produção**. Todos com dados fictícios até DP-01.
- **Desenvolvimento local:** `compose.yaml` na raiz (`npm run dev:up`), descrito no [`README.md`](README.md). O login da aplicação (`livros_app_dev`) só tem os privilégios de `livros_app`, como em produção; testes usam outro banco (`docker/compose.test.yml`).

### 12.2 CI/CD (GitHub Actions)

1. **Em todo PR:** lint + testes (serviço PostgreSQL no workflow), incluindo a suíte de isolamento. PR não pode ser mesclado com falha.
2. **Na branch principal:** build da imagem Docker → publicação no GitHub Container Registry (tag = SHA do commit).
3. **Deploy:** via SSH na VPS (chave dedicada em GitHub Secrets) → `docker compose pull && docker compose up -d` → migrações executadas antes de a nova versão receber tráfego.
4. Rollback: subir a tag anterior.

### 12.3 Segredos

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `QR_TOKEN_SECRET` (assinatura dos tokens de identificação), `DATABASE_URL` (papel da aplicação), `DATABASE_MIGRATION_URL` (papel de migração), `BOOTSTRAP_ADMIN_EMAILS`. Guardados em GitHub Secrets e em `.env` na VPS (fora do repositório, permissão restrita).

### 12.4 Backups

- `pg_dump` diário com retenção definida, **copiado para fora da VPS**.
- Teste de restauração periódico.
- Script de exportação por `campus_id` para restaurações seletivas.

---

## 13. Estratégia de testes

Como executar, organização das pastas, regras para escrever testes e resultado da última execução: [`docs/testing.md`](docs/testing.md). Resumo: `npm ci`, `npm run db:test:up`, `npm test`.

### 13.1 Fixtures obrigatórias

- Campi **Alfa** e **Beta** (ativos) e **Gama** (inativo).
- Servidores: admin institucional; consulta institucional; admin de Alfa; operador de Alfa; consulta de Alfa; operador de Alfa **e** Beta; servidor com solicitação pendente; com solicitação recusada; com atribuição revogada.
- Estudantes: E1 (Alfa), E2 (Beta), E3 transferido de Alfa para Beta com pendência em Alfa, E4 cadastrado mas nunca logado, E5 com vínculo encerrado.
- Tokens de QR code: válido, adulterado, assinado com outra chave, expirado, de versão antiga (`qr_versao`), de estudante de outro campus.
- Contas inválidas: `@gmail.com`, domínio parecido (`ifc.edu.br.exemplo.com`), `email_verified = false`.
- Todos os dados gerados (sem dados reais).

### 13.2 Testes obrigatórios

| Categoria | Exemplos |
|-----------|----------|
| Login | Domínios não permitidos recusados; sufixo parecido recusado; `email_verified=false` recusado; servidor novo sem acesso até aprovação; estudante sem cadastro não vê nada. |
| Solicitação de acesso | Admin de Alfa não aprova solicitação para Beta; campus declarado não concede acesso. |
| Leitura cruzada | Operador/consulta de Alfa pede entrega/estudante/estoque de Beta por ID → 404; listagens não trazem Beta. |
| Escrita cruzada | Operador de Alfa tenta entrega com `campus_id = Beta` → 403; tenta usar vínculo de Beta → rejeitado no backend **e** no banco. |
| Manipulação do cliente | Trocar `campus_trabalho_id`, campos ocultos ou URL para campus não atribuído → 403 + auditoria. |
| Papéis | Matriz da seção 6.2 testada por ação × papel × escopo (teste parametrizado). `CONSULTA` não consegue preparar entrega. |
| Revogação | Após revogar, a próxima requisição é negada. |
| Estudante | E1 vê só os próprios livros; trocar identificadores na requisição não mostra dados de E2; E3 vê livros de Alfa e Beta com o campus correto; o estudante não tem nenhuma ação de escrita. |
| Identificação | QR válido identifica o estudante; QR adulterado, de outra chave, expirado ou de versão antiga é recusado; matrícula de estudante sem vínculo ativo no campus do operador não avança (RN-77 a RN-79). |
| Assinatura | Assinatura em branco recusada; assinatura dupla impossível; modo assinatura de entrega de outro campus → 404; saldo insuficiente na assinatura → falha sem efeitos parciais; hash do documento confere; segunda entrega preparada para o mesmo estudante é recusada (RN-22). |
| Avisos | Título já em posse, fora das adoções e pendência vencida geram aviso; a confirmação fica registrada; campus configurado para bloquear pendência vencida bloqueia (RN-18, RN-20, RN-21). |
| Estorno | Operador estorna só os próprios registros; admin do campus estorna qualquer um do campus; sem justificativa → recusado; entrega com devolução não pode ser estornada (RN-28, RN-43). |
| Devolução | Só no campus da entrega; acima do entregue → recusada; danificado/perdido sem justificativa → recusado (RN-37, RN-39, RN-66). |
| Estoque | Saldo nunca negativo sob concorrência (duas assinaturas simultâneas); estoque = soma do livro-razão. |
| Dispositivo | Após logout, voltar pelo navegador não mostra dados; respostas com dados pessoais têm `Cache-Control: no-store`. |
| RLS | Com o papel da aplicação e `app.campi = {Alfa}`, `SELECT` em dados de Beta retorna 0 linhas; `INSERT` com Beta falha. |
| Pool | Requisições sequenciais de usuários de campi diferentes na mesma conexão não herdam contexto. |
| Relatórios | Consolidados negados a perfis de campus; totais = soma dos campi. |
| Documentos | Termo de Alfa traz dados de Alfa; após mudar endereço de Alfa, documento antigo mantém o snapshot. |
| Imutabilidade | `UPDATE`/`DELETE` em tabelas imutáveis pelo papel da aplicação falha. |
| Código | Verificação que falha se "Fraiburgo" (ou códigos de campus) aparecer fora de seeds/fixtures/documentação, ou se domínios de e-mail aparecerem como literais fora da configuração. |

---

## 14. Critérios de conclusão (Definition of Done)

Uma funcionalidade só está concluída quando:

- [ ] Atende ao requisito e respeita as regras da seção 2.
- [ ] Entidades novas classificadas como globais ou por campus (seção 7.1); se por campus: `campus_id NOT NULL`, `UNIQUE (campus_id, id)`, FKs compostas, índice iniciando por `campus_id` e política RLS.
- [ ] Toda rota verifica autorização no backend com base nas atribuições (servidor) ou no `estudante_id` da sessão (estudante).
- [ ] Testes de isolamento e de autorização por papel escritos e passando no CI.
- [ ] Documentos e relatórios exibem a unidade da operação (snapshot).
- [ ] Operações de escrita auditadas com `campus_id` e `usuario_id`.
- [ ] Nenhum valor específico de campus ou domínio no código; configurações novas documentadas na seção 10.
- [ ] Decisões com impacto na expansão registradas na seção 15.
- [ ] Migrações com plano de rollback; sem `DELETE` de dados históricos.
- [ ] Sem dados pessoais em URLs ou logs; apenas dados fictícios.
- [ ] Telas usáveis no celular (obrigatório para o atendimento, o modo assinatura e a área do estudante).
- [ ] Testes citam os IDs das regras (`RN-xx`) e critérios de aceitação (`CA-xxx.n`) que verificam.
- [ ] Em tarefas de frontend: checklist da skill `govbr-design-system` (seção 8 da skill) cumprido, com links da documentação oficial consultada citados no PR.

**Situação desta etapa (documentação):**

- [x] Arquitetura multi-campus, perfis, modelagem, isolamento, assinatura, stack, implantação e testes documentados.
- [x] Decisões do responsável do projeto incorporadas (seção 1.1).
- [x] Requisitos, regras de negócio e arquitetura em `docs/`.
- [x] Aprovação para iniciar a implementação (2026-10-21), começando pelo MVP.
- [ ] Decisões pendentes (seção 16.2) respondidas — não bloqueiam o início; cada uma bloqueia só os requisitos indicados.

---

## 15. Registro de decisões (ADR resumido)

| ID | Data | Decisão | Impacto na expansão |
|----|------|---------|---------------------|
| D-01 | 2026-10-21 | Uma única instituição (IFC). | Limita uso por outros IFs sem revisão. **Aceito.** |
| D-02 | 2026-10-21 | `estudante` global (matrícula única no IFC), vínculos por campus; servidor vê estudante só via vínculo com seu campus. | Favorece transferências. |
| D-03 | 2026-10-21 | Catálogo de títulos global; adoções e estoque por campus. | Nenhum. |
| D-04 | 2026-10-21 | Registros operacionais guardam o campus da operação e snapshots; são imutáveis. | Nenhum. |
| D-05 | 2026-10-21 | Isolamento em três camadas com PostgreSQL (FK compostas + RLS). | Vincula ao PostgreSQL. **Aceito.** |
| D-06 | 2026-10-21 | Papéis: ADMIN_INSTITUCIONAL, ADMIN_CAMPUS, OPERADOR, CONSULTA (padrão), ESTUDANTE (implícito). | Nenhum. |
| D-07 | 2026-10-21 | Instalação única compartilhada, em VPS do projeto, Docker + GitHub Actions, domínio neutro. | Nenhum; novos campi entram por cadastro. Mudança futura para infraestrutura do IFC é troca de servidor. |
| D-08 | 2026-10-21 | Login somente Google OIDC; domínios permitidos configuráveis; servidor declara campus e admin confirma. | Nenhum; novos campi aparecem automaticamente na lista. |
| D-09 | 2026-10-21 | Controle de estoque por quantidade com livro-razão. | Campus que precisar de controle individual exigirá extensão do modelo. **Aceito.** |
| D-10 | 2026-10-21 | Termo único institucional, versionado; o estudante assina com o dedo na tela do dispositivo do servidor, no ato da entrega; vale como aceite por ser controle interno; entrega só se efetiva após assinatura. *(Revisada em 2026-10-21: antes previa assinatura pelo celular do estudante.)* | Nenhum. |
| D-11 | 2026-10-21 | Stack: Node.js 24 LTS + Express 5 + EJS + PostgreSQL 17, sem ORM e sem framework de frontend. | Nenhum. |
| D-12 | 2026-10-21 | Sem integração com SIGAA; importação CSV. | Integração futura pode ser adicionada como outra forma de importação. |
| D-13 | 2026-10-21 | Interface segue o GovBR-DS usando `@govbr-ds/core` (HTML/CSS/JS) como implementação padrão; Web Components só caso a caso. Regras na skill `govbr-design-system`. O DS recomenda Web Components de modo geral; o core foi escolhido por se adequar a páginas renderizadas no servidor e formulários nativos. | Nenhum; padrão de interface único para todos os campi. |
| D-14 | 2026-10-21 | Sem transferência de livros entre campi; devolução só no campus da entrega (Q-12). | Nenhum; se surgir a necessidade, exigirá novo fluxo e decisão. |
| D-15 | 2026-10-21 | Estudante identificado no atendimento por matrícula: QR code com JWT assinado pelo servidor ou digitação; invalidação por `estudante.qr_versao` (DV-03). | Nenhum. |
| D-16 | 2026-10-21 | Perda/dano apenas com justificativa; operador estorna os próprios registros; sem expiração de entrega preparada (DV-04, DV-09, Q-09). | Nenhum. |
| D-17 | 2026-10-21 | Implementação do acesso: toda transação da aplicação roda com `SET LOCAL ROLE livros_app` (sem `BYPASSRLS`); o usuário de login da aplicação é membro de `livros_app`. `BOOTSTRAP_ADMIN_EMAILS` só cria administrador enquanto não houver **nenhum** administrador institucional ativo, para não virar acesso permanente. Ninguém decide a própria solicitação de acesso. | Nenhum. |
| D-18 | 2026-10-21 | Papel de campus (Operador, Consulta, Admin do campus) só é concedido a quem **já tem papel vigente naquele campus**, isto é, entrou por solicitação aprovada. Fluxo: solicitar → aprovar → promover. Impede que um admin conceda papéis a servidores alheios ao campus. | Nenhum; novo campus: o servidor solicita acesso, o admin institucional aprova e o promove a admin do campus. |
| D-19 | 2026-10-21 | Campus: só a administração institucional cria, ativa/desativa e altera o **código**; a Administração do campus edita nomes oficial/curto, endereço, contato e regras do próprio campus (RF-011). Reforçado no banco (migração 004: RLS + trigger). | Nenhum. |
| D-20 | 2026-10-21 | Oferta do campus (RF-012) no módulo `campi`: anos letivos e cursos por campus, com RLS e sem exclusão (correção por edição; curso sai de uso por desativação). Enquanto o JavaScript do GovBR-DS não é carregado, datas usam o campo de data nativo dentro de `br-input` e escolhas usam `br-radio`, em vez do DateTimePicker e do Select oficiais. | Nenhum. Trocar pelos componentes oficiais ao carregar o JavaScript do DS. |
| D-21 | 2026-10-21 | **RF-012 simplificado** a pedido do responsável do projeto: os livros são anuais; **não há turmas nem semestres**. A oferta do campus é **ano letivo** (um por ano, com início e término das aulas) **+ curso**; o estudante será associado a curso, série e ano letivo no vínculo. Tabela `turma` removida (migração 006); `periodo_letivo` passa a representar o ano letivo (coluna `ano`). | Nenhum. |

---

## 16. Riscos e decisões pendentes

### 16.1 Riscos

| ID | Risco | Impacto | Mitigação |
|----|-------|---------|-----------|
| R-01 | Vazamento de dados entre campi ou entre estudantes | Alto (LGPD) | Camada de escopo, RLS, testes da seção 13, revisão. |
| R-02 | Dados de estudantes (muitos menores) em VPS fora da infraestrutura do IFC | Alto | Somente dados fictícios até DP-01; HTTPS, backups criptografados, acesso SSH restrito. |
| R-03 | Uso de celular **pessoal** do servidor no atendimento (perda, compartilhamento, sessão aberta) | Médio | Login institucional, expiração por inatividade, `no-store`, nada salvo no aparelho, logout fácil (seção 5.4). |
| R-04 | QR code copiado ou fotografado por terceiros | Baixo | Só identifica (não autoriza nada); o servidor confere nome, curso e série; invalidação por `qr_versao`; validade conforme DV-19. |
| R-05 | E-mail do estudante ausente ou errado na planilha → não consegue consultar seus livros | Baixo | Validação na importação; não afeta entrega nem assinatura. |
| R-06 | Servidor escolhe campus errado e é aprovado por engano | Baixo | Aprovação pelo admin do campus; revogação simples; auditoria. |
| R-07 | Requisitos de Fraiburgo tratados como universais | Médio | Validar com um segundo campus antes da expansão. |
| R-08 | Generalização excessiva | Médio | Diretriz da seção 10. |
| R-09 | Divergência entre saldo e livro-razão | Médio | Mesma transação; script de verificação de consistência. |
| R-10 | Ponto único de falha (uma VPS) | Médio | Backups fora da VPS, restauração testada, deploy reprodutível por Docker. |
| R-11 | Manutenção depender de uma pessoa | Alto | Documentação, CI, código simples; definir equipe mantenedora antes da expansão. |

### 16.2 Decisões a confirmar

| ID | Decisão | Responsável sugerido |
|----|---------|----------------------|
| DP-01 | Aval da DTI/encarregado de dados (LGPD) para usar **dados reais** na VPS do projeto, ou migração para infraestrutura do IFC — **adiada** (DV-01); só dados fictícios até lá | DTI / Encarregado de dados |
| DP-02 | Criação do cliente OAuth na organização Google Workspace do IFC (tipo "Interno") e se `@estudantes.ifc.edu.br` pertence à mesma organização | DTI |
| DP-03 | Formato da planilha de importação de estudantes (colunas mínimas: matrícula, nome, e-mail institucional, curso, série, ano letivo) | Registro Acadêmico / CGE |
| DP-04 | A matrícula se mantém na transferência entre campi? (P2) | Registro Acadêmico |
| DP-05 | Curadoria do catálogo: centralizada × distribuída | PROEN / Bibliotecas |
| DP-06 | Quem serão os administradores institucionais e o admin do Campus Fraiburgo | Gestão |
| DP-07 | ~~Validade da assinatura para o termo e menores~~ — **resolvida** (DV-02): vale como controle interno; sem tratamento para menores | — |
| DP-08 | Estudante transferido com pendências: devolver antes × devolver no destino; aviso ao campus de destino | PROEN / Encarregado de dados |
| DP-09 | Abrangência do "nada consta" (campus × IFC) | PROEN |
| DP-10 | Consequências de perda — **resolvida** (DV-09): só justificativa. Em aberto: livro danificado volta ao estoque? (DV-20) | CGE |
| DP-11 | Uso de marcas na interface e nos documentos: logotipo do IFC/campus, marca gov.br no cabeçalho (prevista no Padrão Mínimo do GovBR-DS) e manual de identidade visual a seguir | Comunicação |
| DP-12 | Página pública de verificação de documentos (sim/não) | Gestão |
| DP-13 | Programa de origem dos livros (PNLD ou outro) e obrigações de prestação de contas | PROEN |
| DP-14 | Política de retenção dos dados após conclusão/saída do estudante | Encarregado de dados |
| DP-15 | Estudante impossibilitado de assinar (ex.: deficiência motora, recusa) — **adiada** (DV-06) | CGE / PROEN |
| DP-16 | Origem e validade do QR code de identificação; como invalidar código perdido (DV-19) | Responsável do projeto / CGE |
| DP-17 | A série vai de 1 a 4 (cursos integrados de até 4 anos)? O vínculo aceitará 1 a 4; RN-45 considera a última série do curso | CGE / PROEN |

---

## 17. Fora do escopo

A lista completa está em [`docs/requirements.md`](docs/requirements.md), seção 7. Em resumo, não implementar sem decisão explícita:

- Integração com SIGAA.
- Controle individual de exemplares.
- Transferência de livros entre campi.
- Assinatura pelo celular do estudante ou por link; assinatura com certificado ICP-Brasil ou gov.br.
- Reposição, cobrança ou bloqueio por perda/dano.
- Notificações por e-mail.
- Uso de dados reais antes de DP-01.
