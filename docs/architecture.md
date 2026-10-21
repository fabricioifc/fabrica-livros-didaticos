# Arquitetura da Aplicação — Gestão de Livros Didáticos

> Situação: **definida; implementação do MVP autorizada** (somente dados fictícios). Última revisão: 2026-10-21.
> Documentos relacionados: [`AGENTS.md`](../AGENTS.md) (regras para agentes, isolamento, decisões), skill [`govbr-design-system`](../.claude/skills/govbr-design-system/SKILL.md) (interface).
> Documentos relacionados: [`docs/requirements.md`](requirements.md) (requisitos e prioridades), [`docs/business-rules.md`](business-rules.md) (regras `RN-xx`). Ainda não criado: `docs/data-model.md` (ver seção 16).

## 1. Objetivo

Definir a arquitetura técnica e organizacional da aplicação web que gerencia a entrega, o recebimento e a devolução de livros didáticos no Instituto Federal Catarinense (IFC).

A primeira implantação é no **Campus Fraiburgo**. A aplicação é multi-campus desde o início: outros campi entram por cadastro e configuração, sem mudanças estruturais nem nova instalação.

## 2. Princípios arquiteturais

| Princípio | Como se aplica neste projeto |
|---|---|
| **Simplicidade** | Um monólito modular, uma imagem Docker, um banco PostgreSQL. Sem microsserviços, filas ou cache distribuído. |
| **Separação de responsabilidades** | Camadas de apresentação, aplicação, domínio, persistência e infraestrutura (seção 3.2), com regras de dependência explícitas. |
| **Segurança** | Autorização sempre no backend; reforço no banco (FK compostas e Row-Level Security). A interface nunca é prova de permissão. |
| **Multi-campus** | `campus_id` em todo dado operacional; escopo obrigatório nas consultas (seção 6). |
| **Rastreabilidade** | Entregas, assinaturas, devoluções, movimentações e documentos são imutáveis; correções geram novos registros; auditoria de toda escrita. |
| **Manutenibilidade** | JavaScript simples, poucas dependências, SQL legível, testes automatizados no CI. |
| **Acessibilidade** | GovBR-DS obrigatório (seção 9); meta WCAG 2.1 AA / eMAG. |
| **Responsividade** | Funciona em computador, tablet e celular; atendimento, modo assinatura e área do estudante pensados primeiro para celular. |

## 3. Estilo arquitetural

### 3.1 Monólito modular renderizado no servidor

Adotamos um **monólito modular**: uma única aplicação Node.js, com módulos de negócio bem separados, um backend e um banco compartilhado.

**Ajuste em relação à proposta de "monólito com API REST":** a interface é **HTML renderizado no servidor** (EJS) com formulários nativos, e não uma SPA consumindo uma API JSON. Motivos:

- menos código: não há duas aplicações (frontend e API) para manter;
- funciona bem com o `@govbr-ds/core` e com formulários nativos protegidos por token CSRF;
- as páginas já saem do servidor contendo apenas dados autorizados;
- é compatível com a stack definida (HTML/CSS/JS).

As rotas HTTP seguem convenções orientadas a recursos (seção 8). Endpoints **JSON** existem apenas onde a interface precisa (ex.: validar o QR code lido pela câmera no atendimento) ou para integrações futuras. Uma API REST completa só será criada se houver um consumidor real (ex.: aplicativo móvel ou integração institucional), registrada como decisão.

Não criar microsserviços, filas de mensagens ou infraestrutura distribuída sem necessidade concreta e documentada. Tarefas periódicas (conferir consistência de estoque) rodam como **rotinas agendadas dentro da própria aplicação** ou como comando executado por agendador do sistema.

### 3.2 Camadas

| Camada | Responsabilidade | Neste projeto |
|---|---|---|
| **Apresentação** | Páginas, formulários, navegação, tabelas, relatórios, componentes visuais | Rotas Express (`rotas.js`) que leem a requisição, chamam a aplicação e renderizam templates EJS; arquivos em `src/views` e `public/` |
| **Aplicação** | Casos de uso: "identificar estudante", "preparar entrega", "coletar assinatura", "registrar devolução", "consultar pendências" | `servico.js` de cada módulo: verifica autorização, abre a transação, orquestra domínio e persistência, registra auditoria |
| **Domínio** | Regras de negócio, validações, políticas de movimentação | `dominio.js`: funções puras, **sem acesso a banco, HTTP ou relógio do sistema** (recebem a data como parâmetro); testáveis isoladamente |
| **Persistência** | Consultas e operações no banco | `repositorio.js`: SQL escrito à mão com `pg`, sempre recebendo o escopo de campus ou do estudante |
| **Infraestrutura** | Autenticação, sessão, geração de documentos, configuração, logs, banco, integrações | `src/infra/*` (ou `src/auth`, `src/db`, `src/config`) |

**Regras de dependência**

```
rotas (apresentação) ──> servico (aplicação) ──> dominio
                               │
                               └──> repositorio (persistência) ──> db (infra)
```

- Rotas **nunca** acessam o banco nem repositórios diretamente.
- O domínio não importa nada de infraestrutura.
- Um módulo usa outro **somente** pelo `servico.js` do outro (sua interface pública), nunca pelos repositórios internos dele.
- Templates recebem dados já preparados (sem consultas nem regras de negócio dentro das views).
- Todo acesso ao banco passa por `comContexto(contexto, async (db) => ...)`, que abre a transação e define o contexto de RLS (AGENTS.md, seção 9.4).

### 3.3 Estrutura de diretórios

```
src/
  app.js                 montagem do Express, middlewares, rotas
  config/                leitura e validação das variáveis de ambiente
  infra/
    db/                  pool, comContexto(), migrações, seeds
    auth/                Google OIDC, sessão, resolução do contexto do usuário
    autorizacao/         permissões por papel, middleware, escopo de campus
    documentos/          montagem de termos/comprovantes, hash, código de verificação
    log/                 logger estruturado
  modulos/
    campi/               rotas.js servico.js dominio.js repositorio.js
    acesso/              usuários, solicitações de acesso, atribuições
    estudantes/
    catalogo/
    estoque/
    entregas/            inclui a assinatura do termo
    devolucoes/
    pendencias/          pendências e relatórios
    area-estudante/      consulta do estudante (somente leitura)
  views/                 layouts, parciais (componentes de domínio), páginas
public/                  css, js, fontes e arquivos do GovBR-DS servidos localmente
test/                    unidade, integração, isolamento, interface
scripts/                 geração de dados fictícios, verificação de consistência
docker/                  Dockerfile, docker-compose, Caddyfile
docs/                    arquitetura, requisitos, regras de negócio, modelo de dados
```

## 4. Tecnologias

O repositório está vazio; a stack abaixo foi proposta e aprovada pelo responsável do projeto (AGENTS.md, decisões D-07, D-08, D-11 e D-13).

| Componente | Decisão | Justificativa |
|---|---|---|
| Frontend | HTML renderizado no servidor com **EJS**, CSS e **JavaScript puro** apenas onde necessário | Preferência do projeto por HTML/CSS/JS; menos código; compatível com o GovBR-DS core e formulários nativos |
| Backend | **Node.js 24 LTS + Express 5** (JavaScript, módulos ES) | Ecossistema amplo, fácil de manter por equipes rotativas; Fastify foi a alternativa considerada |
| Banco de dados | **PostgreSQL 17** | Relacional, transações, restrições fortes e **Row-Level Security** para reforçar o isolamento entre campi |
| Acesso a dados | `pg` + **SQL escrito à mão** (sem ORM) | Consultas explícitas e revisáveis, filtro de campus sempre visível |
| Migrações | Arquivos SQL versionados (`node-pg-migrate` ou equivalente), executados no deploy | Evolução controlada e reversível do esquema |
| Autenticação | **Google OAuth / OpenID Connect** (`openid-client`), somente `@ifc.edu.br` e `@estudantes.ifc.edu.br` | Contas institucionais existentes; sem senhas locais |
| Sessão | Cookie `httpOnly` com sessão no PostgreSQL | Revogação imediata de acesso |
| Validação | `zod` | Validação e normalização de entradas no backend |
| Interface visual | **GovBR-DS** via `@govbr-ds/core`, arquivos servidos localmente | Padrão obrigatório; ver skill `govbr-design-system` |
| Documentos | Páginas HTML com CSS de impressão (o navegador salva em PDF) | Sem dependências pesadas; PDF no servidor só se surgir necessidade |
| Logs | Logger estruturado em JSON (ex.: `pino`) | Diagnóstico sem dados pessoais |
| Implantação | **Docker Compose** em VPS do projeto, **Caddy** (HTTPS), **GitHub Actions** (CI/CD) | Infraestrutura disponível; deploy reprodutível |
| Identificação por QR code | Token **JWT** assinado pelo servidor (`jose`); leitura pela câmera com a API `BarcodeDetector` do navegador ou biblioteca JS leve (a escolher e registrar) | QR code não pode ser forjado; leitura sem app instalado |
| Assinatura na tela | JavaScript puro (canvas + Pointer Events) | Sem dependência; funciona com toque, caneta e mouse |
| Testes | `node:test` + `supertest` + PostgreSQL real (Docker); **Playwright** para os fluxos críticos de interface | Testes de isolamento precisam do banco real; assinatura na tela do celular precisa de teste de navegador |

Não instalar dependências fora desta lista sem registrar a decisão e a justificativa (AGENTS.md, seção 15).

## 5. Módulos de negócio

Cada módulo segue a estrutura da seção 3.3. Detalhes de permissões estão no AGENTS.md (seção 6.2) e de regras no futuro `docs/business-rules.md`.

### 5.1 Campi e configurações (`campi`)

- Cadastro, ativação e desativação de campi (administrador institucional).
- Configurações por campus: nome oficial, endereço, setor responsável, validade da entrega preparada, regras opcionais (AGENTS.md, seção 10).
- **Campus de trabalho:** para servidores com mais de um campus, a interface permite escolher o campus de trabalho; o backend valida essa escolha a cada requisição.
- O Campus Fraiburgo é o primeiro registro do seed de implantação; nenhum código depende dele.

### 5.2 Usuários e permissões (`acesso`)

- Login com Google; usuários identificados pelo identificador estável do Google (`sub`).
- Servidor declara seu campus no primeiro acesso; o administrador do campus confirma. Perfil padrão: **Consulta**; **Operador** apenas para servidores designados (ex.: CGE).
- Perfis: `ADMIN_INSTITUCIONAL`, `ADMIN_CAMPUS`, `OPERADOR`, `CONSULTA` e o acesso implícito de `ESTUDANTE`.
- Um servidor pode ter atribuições em mais de um campus, sempre concedidas por um administrador.
- Autorização verificada no backend em todas as operações protegidas.

### 5.3 Estudantes (`estudantes`)

- Cadastro por importação de planilha (CSV) e manual; sem integração com SIGAA nesta fase.
- Identificação: **matrícula única no IFC** (evita duplicidade), nome, e-mail `@estudantes.ifc.edu.br`. Sem CPF.
- Vínculo acadêmico por campus: curso, série, ano letivo e situação (ativo, transferido, concluído, evadido, cancelado).
- Estudante inativo nunca é apagado; o histórico de entregas e devoluções permanece.
- A importação valida duplicidades (matrícula e e-mail) e informa linhas rejeitadas sem gravar parcialmente.

### 5.4 Catálogo de livros (`catalogo`)

- Títulos **compartilhados entre campi**: ISBN, título, autores, editora, edição, **volume**, ano, componente curricular (disciplina), código do programa (ex.: PNLD).
- **Abrangência de uso** do título, diferenciando:
  - livro de **série específica** (ex.: 1º ano);
  - livro usado durante **os três anos do ensino médio** (ex.: volume único).
  A abrangência influencia o prazo de devolução e o cálculo de pendências (ver `docs/business-rules.md`, a criar).
- Cada campus registra suas **adoções**: quais títulos usa, em quais cursos/séries e com qual quantidade prevista, sem presumir que todos os campi usam as mesmas edições.
- O catálogo (título) é conceitualmente separado do **estoque físico** de cada campus.
- Duplicatas são tratadas por mescla controlada (administrador institucional), sem apagar histórico.

### 5.5 Estoque (`estoque`)

**Decisão vigente:** controle **por quantidade** (campus × título), sem identificação individual de exemplares (AGENTS.md, D-09).

As "situações do exemplar" são representadas assim, sem estados contraditórios:

| Situação | Como é obtida |
|---|---|
| Disponível | Saldo `estoque.disponivel` do campus para o título |
| Entregue (com estudante) | **Calculada**: quantidades entregues em entregas assinadas − quantidades devolvidas |
| Devolvido | Movimentação de devolução; volta ao saldo disponível |
| Danificado | Resultado da devolução, com justificativa; proposta: vai para baixa (a confirmar, DV-20) |
| Indisponível / baixado | Movimentação de perda, baixa ou ajuste |

- Toda alteração de quantidade gera uma linha no **livro-razão** de movimentações (entrada, entrega, devolução, baixa, ajuste, estorno). **Não há transferência de livros entre campi** (AGENTS.md, C14).
- Consulta de estoque por campus e título; consolidada para perfis institucionais.
- Se no futuro um campus precisar de identificação individual, o modelo será estendido com uma tabela de exemplares ligada às mesmas movimentações — mudança registrada como decisão.

### 5.6 Entregas (`entregas`)

- O operador **identifica o estudante pela matrícula** — leitura de QR code com token assinado ou digitação (RN-77 a RN-79) — e **prepara** a entrega: um exemplar por título, com avisos confirmáveis (título já em posse, fora das adoções, pendência vencida).
- A entrega registra **cada título entregue em um item próprio** (com quantidade), além do estudante, do operador responsável, do campus e da data/hora.
- **Aceite:** o estudante **assina com o dedo na tela do dispositivo do servidor**, no ato da entrega (seção 11). Só então a entrega é efetivada e o estoque é baixado. Sem expiração automática.
- Gera o **termo de entrega assinado** (documento digital imutável, com código de verificação).
- Cancelamento antes da assinatura; estorno depois da assinatura com justificativa: o operador estorna os próprios registros, o administrador do campus qualquer registro do campus.
- Histórico consultável por estudante, curso, série, título e ano letivo, dentro do escopo do usuário.

### 5.7 Devoluções (`devolucoes`)

- Uma **devolução** representa um atendimento (quem recebeu, quando, em qual campus) e contém **itens**, cada um ligado ao **item de entrega correspondente**.
- Somente no **campus da entrega**. Cada item registra quantidade, resultado (devolvido, danificado, perdido) e observações; danificado e perdido exigem **justificativa** (qual livro e motivo), sem reposição, cobrança ou bloqueio.
- Devolução parcial permitida; a soma devolvida nunca ultrapassa o entregue.
- Atualiza o estoque na mesma transação.
- Gera **comprovante de devolução** digital, disponível na área do estudante. A devolução não exige assinatura do estudante.

### 5.8 Pendências e relatórios (`pendencias`)

- Pendência = item entregue (assinado) cuja quantidade devolvida é menor que a entregue e cujo prazo de devolução já se aplica.
- **Pendências são sempre calculadas** a partir de entregas e devoluções, nunca guardadas como contador.
- Consultas por estudante, curso, série, ano letivo, título e campus.
- Relatórios de entregas, devoluções, estoque e pendências; exportação CSV e versão para impressão.
- Relatórios consolidados entre campi apenas para perfis institucionais.

### 5.9 Área do estudante (`area-estudante`)

- **Somente consulta:** livros em posse, prazos, termos assinados e comprovantes, de todos os campi em que o estudante teve vínculo.
- Poderá exibir o QR code de identificação, se DV-19 assim definir.
- Acesso restrito aos dados do próprio estudante, identificado pela sessão.

## 6. Arquitetura multi-campus

**Estratégia:** uma única instalação com dados logicamente separados por campus (AGENTS.md, D-07). Detalhes completos em AGENTS.md, seção 9.

| Regra | Implementação |
|---|---|
| Entidades operacionais associadas ao campus | `campus_id NOT NULL` em vínculos, adoções, estoque, movimentações, entregas, assinaturas, devoluções e documentos |
| Validação de escopo no backend | Serviço verifica a atribuição do usuário no campus **do recurso** (lido do banco); repositórios exigem a lista de campi permitidos |
| Campus da interface não é prova de autorização | O campus de trabalho é apenas uma intenção, validado contra as atribuições a cada requisição |
| Sem acesso por troca de identificadores | IDs são UUIDs, mas a proteção é a verificação de escopo; recurso fora do escopo retorna 404 |
| Reforço no banco | Chaves estrangeiras compostas `(campus_id, id)` e Row-Level Security |
| Catálogo compartilhado | Títulos, componentes curriculares e termo de compromisso são globais e legíveis por todos os servidores; estoque, entregas, devoluções e pendências seguem o campus |
| Instalações independentes no futuro | Possível com o mesmo código (o modelo já é multi-campus); não há dependência de Fraiburgo |

**Regras de compartilhamento do catálogo:** qualquer administrador de campus pode cadastrar um título; o ISBN é único, então títulos existentes são reaproveitados; edição e mescla de duplicatas ficam com o administrador institucional (pendente de confirmação, AGENTS.md DP-05). Essas regras serão cobertas por testes (seção 12).

## 7. Modelo de dados conceitual

| Entidade conceitual | Representação prevista | Escopo |
|---|---|---|
| Campus | `campus`, `campus_configuracao` | Global / por campus |
| Usuário | `usuario` (servidor ou estudante) | Global |
| Associação usuário–campus | `solicitacao_acesso` (pedido) e `atribuicao` (papel + campus) | Por campus |
| Estudante | `estudante` (matrícula única no IFC) | Global |
| Vínculo acadêmico (curso, série, ano) | `vinculo_estudante`, `curso` | Por campus |
| Ano letivo | `periodo_letivo` | Por campus |
| Título de livro | `titulo`, `componente_curricular` | Global |
| Exemplar físico | **Não é tabela**: representado por `estoque` (saldo) + `movimentacao_estoque` (livro-razão) | Por campus |
| Adoção | `adocao` | Por campus |
| Entrega / item de entrega | `entrega`, `entrega_item` | Por campus |
| Aceite | `assinatura_termo` | Por campus |
| Devolução / item de devolução | `devolucao`, `devolucao_item` | Por campus |
| Transferência de estudante | Encadeamento de vínculos (não há transferência de livros) | Origem/destino |
| Documento | `documento_emitido` (snapshot + código de verificação) | Por campus |
| Termo de compromisso | `termo_modelo` (único, versionado) | Global |
| Registro de auditoria | `auditoria` | Global com campus opcional |

- O modelo preserva o histórico: quem fez cada operação, quando e em qual campus.
- Dados exibidos em documentos (nome do estudante, dados do campus) são **copiados no momento da operação** (snapshot), para que alterações posteriores não mudem documentos antigos.
- **Exceção justificada à regra de não manter contagens:** `estoque.disponivel` é um saldo mantido na mesma transação que o livro-razão, protegido por `CHECK (disponivel >= 0)` e bloqueio de linha, para impedir entregar mais livros do que existem quando há operações simultâneas. Um script compara periodicamente saldo e livro-razão. Pendências e quantidades em posse dos estudantes **não** têm contador.
- O esboço SQL está no AGENTS.md (seção 7.2). A versão normalizada e definitiva ficará em `docs/data-model.md`, que passa a ser a referência do modelo assim que for criado.

## 8. Rotas HTTP e contratos

### 8.1 Rotas de páginas (HTML)

- `GET` para páginas e consultas; `POST` para ações (formulários HTML só enviam GET e POST).
- Recursos no plural e ações explícitas: `GET /entregas`, `GET /entregas/nova`, `POST /entregas`, `GET /entregas/:id`, `POST /entregas/:id/cancelar`, `POST /devolucoes`.
- Padrão **POST → redirecionamento → GET** (código 303) após ações bem-sucedidas, com mensagem de sucesso na página de destino.
- Erros de validação: o formulário é renderizado de novo com status **422**, mensagens por campo e os valores digitados preservados.
- Identificadores em URL são UUIDs; nada de matrícula, nome ou e-mail em URL.

### 8.2 Endpoints JSON

- Prefixo `/api/`, apenas quando a interface precisa (ex.: `POST /api/identificacao` para validar o token do QR code lido pela câmera).
- Mesmas regras de autenticação, autorização e escopo das páginas.
- Erros no formato:

```json
{ "erro": { "codigo": "ESTOQUE_INSUFICIENTE", "mensagem": "Texto para o usuário.", "detalhes": [] } }
```

### 8.3 Códigos HTTP

| Código | Uso |
|---|---|
| 200 / 201 | Sucesso (JSON) |
| 303 | Redirecionamento após POST bem-sucedido |
| 400 | Requisição malformada |
| 401 | Não autenticado (páginas redirecionam para o login) |
| 403 | Autenticado, sem permissão para a ação (inclui campus de trabalho não autorizado) |
| 404 | Recurso inexistente **ou fora do escopo** do usuário |
| 409 | Conflito de estado (entrega já assinada, estoque insuficiente, devolução acima do entregue) |
| 422 | Dados inválidos |
| 429 | Limite de requisições (login) |

### 8.4 Regras gerais

- Toda entrada é validada e normalizada no backend (`zod`), independentemente da interface.
- Respostas trazem apenas os dados necessários para a tela; nunca dados de outro campus ou de outro estudante.
- As rotas e contratos principais serão listados em `docs/api.md` quando a implementação começar.

## 9. Identidade visual e acessibilidade

A interface segue o **GovBR-DS** (https://www.gov.br/ds/), conforme a skill [`govbr-design-system`](../.claude/skills/govbr-design-system/SKILL.md), que é obrigatória em toda tarefa de frontend:

- Componentes oficiais do `@govbr-ds/core` como padrão; Web Components apenas caso a caso, com decisão registrada.
- Proibido recriar componentes oficiais; componentes de domínio (ex.: lista de livros pendentes) são composições de componentes e tokens oficiais.
- Tipografia, cores, espaçamentos, formulários, tabelas, navegação e mensagens conforme a documentação oficial.
- Navegação por teclado, foco visível, contraste AA, campos com rótulos acessíveis.
- Layout responsivo; atendimento, modo assinatura e área do estudante pensados primeiro para celular.
- **Identidade visual do IFC separada da do Governo Federal:** logotipos apenas os oficiais, conforme orientação da Comunicação (AGENTS.md, DP-11).
- **Não declarar conformidade integral** com o GovBR-DS, WCAG ou eMAG sem validação (testes automáticos, revisão manual e, idealmente, teste com usuários e leitor de tela).

## 10. Segurança, privacidade e auditoria

| Tema | Medida |
|---|---|
| Menor privilégio | Perfil padrão de servidor é somente consulta; operação apenas para designados; papel do banco da aplicação sem `BYPASSRLS` e sem permissão de alterar tabelas imutáveis |
| Autenticação e autorização | Google OIDC com validação do token e do domínio no backend; autorização em toda rota protegida |
| Acesso cruzado entre campi | Escopo em serviço, repositório e banco (seção 6) |
| Entradas | Validação e normalização com `zod`; escape automático nos templates; CSRF em todos os formulários |
| Segredos | Variáveis de ambiente e GitHub Secrets; nada versionado |
| Logs | JSON estruturado, sem senhas, tokens, nomes, matrículas ou e-mails; com `usuario_id`, `campus_id` e identificador da requisição |
| Auditoria | Toda escrita registrada (quem, quando, campus, ação, antes/depois); tabela sem `UPDATE`/`DELETE` para a aplicação |
| Retenção | A definir com o encarregado de dados (AGENTS.md, DP-14) |
| LGPD | Minimização (sem CPF), somente dados fictícios até aprovação (DP-01), acesso do estudante apenas aos próprios dados |
| Documentos e assinaturas | Documentos imutáveis, com hash do conteúdo e código de verificação; acesso apenas pelo estudante e pelos servidores autorizados do campus |
| Cabeçalhos | `helmet` com CSP restritiva (sem scripts inline), cookies `Secure`/`httpOnly`/`SameSite=Lax`, limite de tentativas no login |

Nenhum usuário, inclusive administrador, consegue alterar ou apagar registros históricos pela aplicação; correções são novos registros auditados.

## 11. Documentos e assinaturas

Documentos gerados a partir dos dados registrados:

| Documento | Conteúdo |
|---|---|
| **Termo de entrega** (assinado) | Estudante (nome, matrícula, curso, série), campus (nome oficial, endereço, setor), livros e quantidades, data/hora, operador responsável, texto e versão do termo, declaração de recebimento, evidências da assinatura |
| **Comprovante de devolução** | Estudante, campus, livros, quantidades e estado, data/hora, servidor que recebeu, declaração de devolução |
| **Nada consta** | Estudante, campus, data e abrangência (a confirmar, DP-09) |

**Mecanismo de aceite definido** (detalhes no AGENTS.md, seção 8):

- **Identificação:** pela matrícula, com QR code (token assinado pelo sistema) ou digitação, conferida pelo servidor; o estudante assina com o dedo na tela do dispositivo do servidor.
- **Integridade:** hash SHA-256 do documento renderizado (termo + itens + dados + imagem da assinatura), gravado junto à assinatura; documento imutável.
- **Armazenamento:** registro da assinatura e snapshot do documento no banco; o documento é reproduzido idêntico a partir do snapshot.
- **Evidência:** imagem e traçado da assinatura, data/hora, servidor que conduziu o atendimento, forma de identificação, versão do termo, endereço IP e dispositivo.
- **Natureza:** a assinatura na tela **vale como aceite** porque o termo é um **controle interno** (DV-02); sem tratamento específico para menores. Não há certificado digital, e o sistema não deve apresentá-la como assinatura qualificada.
- **Privacidade:** a imagem da assinatura é dado pessoal; aparece apenas no termo.

Formato: páginas HTML com CSS de impressão, que o usuário pode imprimir ou salvar em PDF pelo navegador.

## 12. Testes e qualidade

Testes proporcionais ao risco; regras críticas testáveis sem interface gráfica (camada de domínio pura).

| Prioridade | O que testar | Tipo |
|---|---|---|
| 1 | Isolamento entre campi e entre estudantes; permissões por papel (matriz completa) | Integração com banco real, incluindo RLS |
| 2 | Regras de entrega e devolução; identificação por QR code/matrícula; assinatura (em branco recusada, assinatura dupla, modo assinatura isolado); estorno pelo operador só dos próprios registros | Unidade (domínio) + integração |
| 3 | Duplicidades e inconsistências: estoque nunca negativo sob concorrência, devolução acima do entregue, matrícula duplicada na importação | Integração |
| 4 | Cálculo de pendências (incluindo livros de série específica e de uso nos três anos) | Unidade + integração |
| 5 | Documentos: unidade correta, snapshot preservado, hash confere | Integração |
| 6 | Validação de entradas e códigos HTTP | Integração (`supertest`) |
| 7 | Fluxos de interface: login, identificar estudante → preparar entrega → assinar na tela do celular → efetivar, devolução, aprovação de acesso | Playwright (desktop e celular) + verificação automática de acessibilidade |

Todos os testes rodam no CI a cada PR; falha bloqueia o merge. Fixtures usam no mínimo dois campi fictícios e nunca dados reais.

## 13. Implantação e operação

Infraestrutura identificada: **VPS do projeto** com Docker (AGENTS.md, seção 12).

| Item | Definição |
|---|---|
| Ambientes | Local (Docker Compose), homologação opcional na mesma VPS com banco separado, produção. Configuração por variáveis de ambiente, uma por ambiente |
| Variáveis e segredos | `.env` fora do repositório na VPS (permissão restrita) e GitHub Secrets; arquivo `.env.example` versionado sem valores reais |
| Migrações | SQL versionado, executado por papel de banco próprio antes de a nova versão receber tráfego; nunca apagar dados históricos |
| Logs | JSON na saída padrão dos containers, com rotação configurada no Docker |
| Atualização | GitHub Actions: testes → imagem no GitHub Container Registry (tag = commit) → deploy por SSH (`docker compose pull` e `up -d`) → migrações. Rollback: subir a tag anterior. Procedimento descrito em `docs/operacao.md` (a criar) |
| Backup e restauração | `pg_dump` diário com retenção definida, copiado para fora da VPS; teste de restauração periódico; exportação por campus |
| Monitoramento | Endpoint `GET /saude` (aplicação e conexão com o banco) verificado por um monitor externo de disponibilidade com alerta por e-mail; alerta de espaço em disco e de falha de backup |

Nunca versionar credenciais, segredos ou dados reais de estudantes.

## 14. Decisões

### 14.1 Situação das decisões

| # | Decisão | Situação | Escolha / pendência |
|---|---|---|---|
| 1 | Stack de frontend e backend | ✅ Decidida | Node.js 24 LTS + Express 5 + EJS + JS puro (D-11) |
| 2 | Banco e migrações | ✅ Decidida | PostgreSQL 17; migrações SQL versionadas |
| 3 | Autenticação | ✅ Decidida | Google OIDC, domínios `ifc.edu.br` e `estudantes.ifc.edu.br` (D-08). Pendente: cliente OAuth "Interno" na organização Google do IFC (DP-02) |
| 4 | Permissões e administração dos campi | ✅ Decidida | Quatro papéis + estudante; servidor declara campus e admin confirma (D-06, D-08). Pendente: quem são os administradores (DP-06) |
| 5 | Identificação individual de exemplares | ✅ Decidida | Não; controle por quantidade (D-09) |
| 6 | Aceite/assinatura dos termos | ✅ Decidida | Assinatura com o dedo na tela do dispositivo do servidor, válida como controle interno (D-10); identificação por matrícula/QR code (D-15). Adiado: estudante impossibilitado de assinar (DP-15) |
| 7 | Formatos de documentos e exportação | ✅ Decidida | HTML com CSS de impressão (PDF pelo navegador); exportação CSV |
| 8 | Hospedagem e atualização | ✅ Decidida | VPS + Docker + GitHub Actions (D-07). Adiado: aval para dados reais (DP-01) |
| 9 | Retenção e auditoria | 🟡 Parcial | Auditoria definida; retenção pendente (DP-14) |
| 10 | Acessibilidade e validação da interface | 🟡 Parcial | GovBR-DS + WCAG 2.1 AA/eMAG, testes automáticos e manuais; pendente definir quem valida e se haverá teste com usuários |
| 11 | Estilo das rotas (API REST × páginas no servidor) | ✅ Decidida | Páginas no servidor + JSON pontual (seção 3.1) — **A-01** |
| 12 | Livros de série específica × três anos: prazos de devolução | ✅ Decidida | Término do ano letivo × término da última série; antecipado no encerramento do vínculo ([`business-rules.md`](business-rules.md), RN-44 a RN-47, Q-10) — **A-02** |

### 14.2 Registro de decisões de arquitetura

As decisões D-01 a D-16 estão registradas no AGENTS.md (seção 15). Decisões próprias deste documento:

| ID | Data | Decisão | Justificativa | Alternativas consideradas |
|---|---|---|---|---|
| A-01 | 2026-10-21 | Interface renderizada no servidor; rotas orientadas a recursos; JSON apenas onde necessário | Menos código, compatível com GovBR-DS core e formulários nativos, dados autorizados já no servidor | SPA + API REST completa (dobra a superfície a manter e proteger) |
| A-02 | 2026-10-21 | Título tem `volume` e **abrangência** (série específica ou todo o ensino médio); a regra de prazo de devolução fica em `docs/business-rules.md` | Pedido explícito; afeta pendências | Tratar só pela adoção (não cobre o volume único usado por três anos) |
| A-03 | 2026-10-21 | Devolução com cabeçalho (`devolucao`) e itens (`devolucao_item`) ligados aos itens de entrega | Um comprovante por atendimento; rastreabilidade por item | Somente itens soltos (dificulta o comprovante) |
| A-04 | 2026-10-21 | Saldo de estoque mantido como contador transacional; pendências sempre calculadas | Impede entregas acima do estoque sob concorrência; pendências sem risco de divergência | Saldo calculado a cada consulta (não protege contra concorrência sem bloqueios mais complexos) |
| A-05 | 2026-10-21 | Rotinas periódicas dentro da aplicação, sem fila de mensagens | Volume baixo; simplicidade | Filas/serviços de jobs dedicados |

## 15. Diretrizes para o agente de desenvolvimento

Antes de implementar funcionalidades:

1. Ler este arquivo e o `AGENTS.md`.
2. Consultar [`docs/requirements.md`](requirements.md) (requisitos, critérios de aceitação, prioridade MVP) e [`docs/business-rules.md`](business-rules.md). Regras marcadas como 🟡 podem ser implementadas apenas de forma isolada e fácil de trocar.
3. Identificar decisões pendentes que bloqueiam a tarefa (seção 14.1 e AGENTS.md, seção 16) e avisar antes de seguir.
4. Propor e documentar decisões técnicas novas (seção 14.2 ou AGENTS.md, seção 15).
5. Atualizar `docs/data-model.md` a cada mudança no modelo de dados.
6. Manter a arquitetura simples e as regras de dependência entre camadas (seção 3.2).
7. Atualizar a documentação quando uma decisão arquitetural mudar.
8. Não implementar nada que contradiga as regras de negócio ou o isolamento entre campi.
9. Não introduzir dependências ou serviços fora da seção 4 sem decisão registrada.
10. Validar os fluxos críticos com testes automatizados (seção 12).
11. Em tarefas de frontend, seguir a skill `govbr-design-system`.

**Critério de conclusão:** a arquitetura é compreensível, documentada, testável e adequada à implantação inicial no IFC – Campus Fraiburgo, sem impedir a adoção futura por outros campi.

## 16. Próximos documentos

| Documento | Conteúdo | Situação |
|---|---|---|
| [`docs/requirements.md`](requirements.md) | Requisitos funcionais e não funcionais, critérios de aceitação e prioridades (RF-001…, RNF-001…) | ✅ Criado (rev. 2) |
| [`docs/business-rules.md`](business-rules.md) | Regras de entrega, assinatura, devolução, prazos, pendências, transferências, perdas (RN-01 a RN-79) | ✅ Rev. 2; regras 🟡 aguardam confirmação (seção 12.2 do documento) |
| `docs/data-model.md` | Modelo normalizado definitivo, restrições, índices e políticas RLS | A criar a partir do AGENTS.md, seção 7.2 |
| `docs/api.md` | Rotas e contratos | A criar no início da implementação |
| `docs/operacao.md` | Deploy, atualização, backup, restauração, monitoramento | A criar antes da produção |
