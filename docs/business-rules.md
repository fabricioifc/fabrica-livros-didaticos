# Regras de Negócio — Gestão de Livros Didáticos

> Situação: **rev. 2, em validação.** Última revisão: 2026-10-21.
> Documentos relacionados: [`AGENTS.md`](../AGENTS.md) (perfis, isolamento, modelo), [`docs/architecture.md`](architecture.md) (módulos e camadas), [`docs/requirements.md`](requirements.md) (requisitos, dúvidas `DV-xx`).

## Como ler este documento

Cada regra tem um identificador (`RN-xx`) e uma situação:

| Marca | Significado |
|---|---|
| ✅ **Confirmada** | Decidida pelo responsável do projeto ou decorrente direta de uma decisão já registrada. Pode ser implementada. |
| 🟡 **Proposta** | Regra sugerida para destravar a modelagem. **Depende de confirmação** (ver o ID indicado e a seção 12). Pode ser implementada de forma isolada e fácil de trocar, sem dados reais. |
| ⛔ **Removida** | Regra que deixou de valer. O ID não é reaproveitado. |

Regras para agentes:

- Testes automatizados devem citar o ID da regra que verificam (ex.: `RN-21`).
- Regras de negócio ficam na camada de **domínio** (funções puras), conforme [`architecture.md`](architecture.md), seção 3.2.
- Ao mudar uma regra, atualizar este documento **antes** do código, com data e motivo.
- Nenhuma regra pode depender do nome de um campus. Diferenças entre campi só por configuração (AGENTS.md, seção 10).

Datas e prazos usam o fuso **America/Sao_Paulo**. "Até a data X" significa até 23:59:59 de X.

## Situação da implementação

> Atualizada em 2026-10-21 (commit `6343fe4`). Visão por requisito: [`requirements.md`](requirements.md), seção 0.

| Regras | Situação | Onde |
|---|---|---|
| RN-73 e RN-74 (catálogo compartilhado, ISBN único, abrangência e série) | ✅ Implementadas e testadas | Migração `007_catalogo.sql`; `src/modulos/catalogo/` |
| RN-75 (quem cria e quem edita títulos) | 🟡 Implementada como proposta (DP-05 em aberto), num ponto único fácil de trocar | `catalogo/servico.js` (`podeCriar`, `podeEditar`) |
| RN-62 e RN-69 a RN-72 (estoque próprio de cada campus; entrada, baixa, ajuste; saldo nunca negativo) | ✅ Implementadas e testadas, inclusive concorrência | Migração `008_estoque.sql`; `src/modulos/estoque/` |
| RN-06 (matrícula e e-mail únicos no IFC) | ✅ Implementada no banco e testada | Migrações `002_estudante.sql` e `009_vinculos.sql` (matrícula não muda); `test/integration/estudantes-servico.test.js` |
| RN-08 a RN-11 (um vínculo ativo no IFC; mudança de série/curso atualiza o vínculo; vínculo encerrado consultável; importação tudo ou nada) | ✅ Implementadas e testadas | Migração `009_vinculos.sql`; `src/modulos/estudantes/` |
| RN-46 (encerramento antecipa o prazo) | 🟡 Data do encerramento gravada e imutável; o prazo dos livros é calculado em RF-061 | `estudantes/servico.encerrarVinculo` |
| RN-07 (estudante entra só com cadastro; somente consulta) | ✅ Implementada e testada | `servico.registrarLogin`; rotas e tela `estudante` |
| RN-05 (só Operador e Admin do campus fazem entregas/devoluções) | 🟡 Papéis e permissões existem; entregas e devoluções ainda não | Módulo de acesso (`dominio.js`, matriz do AGENTS.md 6.2) |
| RN-01 a RN-04 (campus da operação, imutabilidade, snapshot, quantidade) | 🟡 Base pronta (auditoria imutável, atribuição só revogável); aplicam-se aos módulos ainda não implementados | — |
| Todas as demais (RN-12 a RN-45, RN-47 a RN-61, RN-63 a RN-68, RN-76 a RN-79) | ⬜ Não implementadas | Dependem de entregas, devoluções e termos |

Ao implementar uma regra, atualize esta tabela e cite o ID nos testes.

---

## 1. Princípios gerais

| ID | Regra | Situação |
|---|---|---|
| RN-01 | Toda operação (entrega, assinatura, devolução, perda, ajuste, estorno) pertence ao **campus em que foi realizada** e mantém esse campus para sempre, mesmo que o estudante mude de campus depois. | ✅ |
| RN-02 | Registros de entrega, assinatura, devolução, movimentação de estoque e documentos **não são alterados nem apagados**. Erros são corrigidos por **estorno** (novo registro que anula o efeito do anterior), com justificativa obrigatória e auditoria. | ✅ |
| RN-03 | Documentos (termo, comprovante, nada consta) guardam uma **cópia dos dados no momento da operação** (estudante, campus, livros, termo). Mudanças posteriores de cadastro não alteram documentos já emitidos. | ✅ |
| RN-04 | O controle de livros é **por quantidade** de cada título em cada campus; não há identificação individual de exemplares. **Cada campus gerencia seus próprios livros**; não há transferência de livros entre campi (Q-12). | ✅ |
| RN-05 | Somente **Operadores** e **Administradores do campus** realizam entregas e devoluções, apenas no campus em que têm essa atribuição. Perfis de consulta apenas visualizam. | ✅ |

---

## 2. Estudantes e vínculos

| ID | Regra | Situação |
|---|---|---|
| RN-06 | A **matrícula é única em todo o IFC** e identifica o estudante. Não pode haver dois cadastros com a mesma matrícula nem com o mesmo e-mail institucional. | ✅ |
| RN-07 | O estudante só acessa o sistema se o e-mail `@estudantes.ifc.edu.br` usado no login estiver cadastrado. O acesso do estudante é **somente para consulta** (Q-08). | ✅ |
| RN-08 | Um estudante tem **no máximo um vínculo ativo** em todo o IFC. O vínculo informa campus, curso, série e ano letivo (não há turmas — D-21). | ✅ |
| RN-09 | Mudança de série ou de curso dentro do mesmo campus atualiza o vínculo, sem afetar entregas anteriores (que guardam o curso e a série da época — RN-03). | ✅ |
| RN-10 | Estudante com vínculo encerrado (concluído, transferido, evadido, cancelado) **não é apagado**; seu histórico continua consultável. | ✅ |
| RN-11 | Na **importação por planilha**, se houver qualquer linha inválida (matrícula ou e-mail duplicado, e-mail fora do domínio de estudantes, curso ou ano letivo inexistentes, série inválida), **nada é importado** e o sistema lista cada erro com o número da linha (Q-01). | ✅ |
| RN-12 | A matrícula **não muda** quando o estudante é transferido entre campi. | 🟡 DP-04 |

---

## 3. Entrega

### 3.1 Identificação do estudante

| ID | Regra | Situação |
|---|---|---|
| RN-77 | O atendimento começa pela **identificação do estudante pela matrícula**, de uma de duas formas: **leitura de QR code** (RN-78) ou **digitação da matrícula**. O sistema mostra nome, curso e série para o servidor conferir antes de seguir (DV-03). | ✅ |
| RN-78 | O QR code contém um **código emitido e assinado digitalmente pelo sistema** com a matrícula do estudante. Código com assinatura inválida, adulterado ou emitido por outro sistema é recusado. O QR code não contém outros dados pessoais. | ✅ |
| RN-79 | **Origem e validade do QR code:** onde o estudante o obtém (área do estudante, carteirinha impressa ou outro), se expira e como invalidar um código perdido. Até a definição, a digitação da matrícula atende todos os casos. | 🟡 DV-19 |

### 3.2 Preparação

| ID | Regra | Situação |
|---|---|---|
| RN-13 | A entrega é **preparada** por Operador ou Administrador do campus, escolhendo os livros para o estudante identificado (RN-77). A preparação **não** baixa o estoque. | ✅ |
| RN-14 | O estudante precisa ter **vínculo ativo no campus** em que a entrega é preparada. | ✅ |
| RN-15 | Entregas podem ocorrer **em qualquer data do ano**, pois os livros chegam aos poucos; não há bloqueio por data (Q-02). A entrega fica associada ao **ano letivo do vínculo** do estudante. | ✅ |
| RN-16 | Cada livro entregue é um **item** da entrega (título + quantidade). Uma entrega não pode repetir o mesmo título em dois itens. | ✅ |
| RN-17 | **Quantidade por título: 1** em cada entrega (Q-03). | ✅ |
| RN-18 | Se o estudante **já tem em posse** o mesmo título (de entrega anterior, em qualquer campus), o sistema **avisa** e o operador pode confirmar e seguir; não há bloqueio (Q-04). A confirmação fica registrada na entrega. | ✅ |
| RN-19 | O título deve ter **saldo disponível** no estoque do campus na preparação. A verificação é repetida na assinatura (RN-27). | ✅ |
| RN-20 | Se o campus tiver adoções e o título **não estiver adotado** para o curso/série do estudante, o sistema **avisa** e pede confirmação do operador, sem bloquear (Q-05). | ✅ |
| RN-21 | Estudante com **pendência vencida** (RN-49) **pode receber** nova entrega: o sistema **avisa** e mostra as pendências (Q-06). O campus pode configurar o bloqueio (`permite_entrega_com_pendencia = false`); o padrão é permitir. | ✅ |
| RN-22 | Um estudante pode ter **no máximo uma entrega preparada** (aguardando assinatura) por vez (Q-07). | ✅ |
| RN-23 | A entrega preparada usa a **versão vigente do termo de compromisso** no momento da preparação. Publicar uma nova versão não afeta termos já assinados. | ✅ |
| RN-24 | Preparação e assinatura acontecem **no mesmo atendimento**; **não há expiração automática** (DV-04). Uma entrega preparada e não assinada (ex.: navegador fechado) pode ser **retomada** ou **cancelada** pelo operador. | ✅ |
| RN-25 | Operador ou Administrador do campus pode **cancelar** uma entrega preparada (não assinada), sem justificativa obrigatória. Cancelamento não mexe no estoque. | ✅ |

### 3.3 Efetivação

| ID | Regra | Situação |
|---|---|---|
| RN-26 | A entrega só é **efetivada** quando o estudante assina o termo (seção 4). Antes disso, os livros **não devem ser entregues** fisicamente. | ✅ |
| RN-27 | Na assinatura, em uma única transação: confere saldo de cada título, **baixa o estoque**, registra a assinatura, marca a entrega como assinada e gera o termo. Se faltar saldo de qualquer item, nada é gravado e o operador é avisado. | ✅ |
| RN-28 | Uma entrega assinada pode ser **estornada**, com justificativa, **somente se nenhum item tiver devolução registrada**. O **Operador** estorna as entregas que **ele registrou**; o **Administrador do campus** estorna qualquer entrega do campus (Q-09). O estorno devolve as quantidades ao estoque e mantém o termo original marcado como estornado. | ✅ |

---

## 4. Assinatura do termo

| ID | Regra | Situação |
|---|---|---|
| RN-29 | O termo é **único para todos os campi**, versionado, publicado pelo Administrador institucional. | ✅ |
| RN-30 | O estudante assina **com o dedo na tela do dispositivo do servidor** (celular ou tablet), **no ato da entrega** (Q-08). O servidor conduz o atendimento, mas **nunca assina em nome do estudante**. Não há assinatura no celular do estudante nem por link. | ✅ |
| RN-31 | A tela de assinatura mostra **apenas**: nome e matrícula do estudante, campus, **texto completo do termo**, **lista de livros** e área de assinatura. Nenhum menu ou dado de outro estudante. O estudante pode limpar e refazer a assinatura antes de confirmar. | ✅ |
| RN-32 | A assinatura só é aceita se: a entrega está aguardando assinatura, o vínculo do estudante ainda está ativo, há saldo (RN-27) e a área de assinatura **não está em branco**. | ✅ |
| RN-33 | A assinatura registra: **imagem e traçado** da assinatura, data/hora, servidor que conduziu o atendimento, **forma de identificação** do estudante (QR code ou matrícula digitada), versão do termo, hash do documento, endereço IP e dispositivo. Uma entrega tem **uma única assinatura**. | ✅ |
| RN-34 | O termo assinado fica disponível ao estudante na área de consulta e aos servidores autorizados do campus; **não há impressão nem arquivamento em papel** no fluxo normal. A imagem da assinatura é exibida apenas no termo. | ✅ |
| RN-35 | A assinatura na tela **vale como aceite** do termo, por se tratar de **controle interno**. Não há tratamento diferente para estudantes menores de idade (DV-02). | ✅ |
| RN-36 | **Estudante impossibilitado de assinar** (ex.: deficiência motora, recusa): tratamento adiado. Não implementar até a definição. | 🟡 DV-06 (adiada) |

---

## 5. Devolução

| ID | Regra | Situação |
|---|---|---|
| RN-37 | A devolução é registrada por Operador ou Administrador do **campus em que a entrega foi feita**. Livros **não** podem ser devolvidos em outro campus (RN-04). | ✅ |
| RN-38 | Uma devolução representa **um atendimento** (estudante, servidor que recebeu, campus, data/hora) e contém itens, cada um ligado ao **item de entrega correspondente**. Só itens de entregas **assinadas** podem ser devolvidos. | ✅ |
| RN-39 | Devolução **parcial** é permitida. A soma devolvida de um item **nunca ultrapassa** a quantidade entregue. | ✅ |
| RN-40 | Cada item devolvido tem um **resultado**: | ✅ / 🟡 destino do danificado (DV-20) |
| | • **Devolvido** — em condições de uso; volta ao estoque disponível. Desgaste normal ou pequenos danos vão em observação. | |
| | • **Danificado** — sem condições de uso; exige justificativa (RN-66). Proposta: o livro **não volta** ao estoque disponível (vira baixa). | |
| | • **Perdido** — o estudante não tem o livro; exige justificativa (RN-66) e não volta ao estoque. | |
| RN-41 | Qualquer resultado **encerra a posse** da quantidade correspondente (deixa de ser pendência). | ✅ |
| RN-42 | Toda devolução gera um **comprovante digital**, disponível ao estudante na área de consulta. A devolução **não exige assinatura** do estudante. | ✅ |
| RN-43 | Devolução registrada por engano pode ser **estornada**, com justificativa: o **Operador** estorna as que **registrou**; o **Administrador do campus**, qualquer uma do campus (Q-09). O estorno desfaz o efeito no estoque e reabre a posse. | ✅ |

---

## 6. Prazos de devolução

O prazo depende da **abrangência** do título (AGENTS.md, campo `titulo.abrangencia`). Prazos confirmados, **sem tolerância** (Q-10).

| ID | Regra | Situação |
|---|---|---|
| RN-44 | **Livro de série específica** (ex.: livro do 1º ano): prazo = **término das aulas do ano letivo** da entrega. | ✅ |
| RN-45 | **Livro de uso nos três anos do ensino médio** (ex.: volume único): o estudante **permanece com o livro** entre os anos; prazo = **término das aulas do ano letivo da última série** do estudante (3ª, ou 4ª em cursos de 4 anos — DP-17). | ✅ |
| RN-46 | **Encerramento do vínculo** (transferência, evasão, cancelamento, conclusão antes do previsto): o prazo de **todos** os livros em posse daquele vínculo passa a ser a **data de encerramento do vínculo**. | ✅ |
| RN-47 | **Não há prorrogação** de prazo caso a caso (Q-11). | ✅ |

---

## 7. Pendências

| ID | Regra | Situação |
|---|---|---|
| RN-48 | **Em posse:** quantidade entregue (em entregas assinadas e não estornadas) menos quantidade devolvida com qualquer resultado. | ✅ |
| RN-49 | **Pendência:** livro em posse cujo **prazo de devolução já passou** (seção 6). Antes do prazo, o livro aparece como "em posse, no prazo". | ✅ |
| RN-50 | Pendências e quantidades em posse são **sempre calculadas** a partir de entregas e devoluções; não existe contador salvo. | ✅ |
| RN-51 | Pendências pertencem ao **campus da entrega** e aparecem só para servidores daquele campus (e perfis institucionais). | ✅ |
| RN-52 | O estudante vê na área de consulta todos os livros em posse, com prazo e campus responsável, de todos os campi em que teve vínculo. | ✅ |
| RN-53 | Consultas e relatórios de pendências por estudante, curso, série, título, ano letivo e campus; exportação CSV. | ✅ |

### 7.1 Nada consta

| ID | Regra | Situação |
|---|---|---|
| RN-54 | O **nada consta** é emitido quando o estudante **não tem nenhum livro em posse** (nem no prazo, nem vencido) no escopo definido em RN-55. | ✅ condição |
| RN-55 | Abrangência: vale **só para o campus emissor** ou exige ausência de posse em **todo o IFC**. | 🟡 DP-09 |
| RN-56 | Perdas e danos **justificados** não impedem o nada consta, pois encerram a posse (RN-41) e não geram obrigação de reposição (RN-67). | ✅ |

---

## 8. Transferências

### 8.1 Estudante entre campi

| ID | Regra | Situação |
|---|---|---|
| RN-57 | A transferência **encerra o vínculo** no campus de origem (situação "transferido") e **cria um vínculo** no campus de destino, com a mesma matrícula. É registrada pelo Administrador do campus de destino (ou institucional). | ✅ |
| RN-58 | Entregas, devoluções e documentos anteriores **continuam pertencendo ao campus de origem**. | ✅ |
| RN-59 | Ao encerrar o vínculo de origem, os livros em posse passam a ter prazo imediato (RN-46). O estudante deve **devolvê-los no campus de origem** (RN-37). | ✅ prazo / 🟡 procedimento (DP-08) |
| RN-60 | Se não devolver, as pendências **continuam no campus de origem**, sinalizadas como "estudante transferido". | 🟡 DP-08 |
| RN-61 | O campus de destino vê apenas o aviso "**possui pendências em outro campus**", sem detalhes, e esse aviso **não bloqueia** entregas no destino. | 🟡 DP-08 |

### 8.2 Livros entre campi

| ID | Regra | Situação |
|---|---|---|
| RN-62 | **Não há transferência de livros entre campi.** Cada campus gerencia seu estoque com entradas, baixas e ajustes (seção 9.2) (Q-12). | ✅ |
| RN-63 | *(Recebimento de transferência.)* | ⛔ Removida em 2026-10-21 (Q-12) |
| RN-64 | *(Cancelamento de transferência.)* | ⛔ Removida em 2026-10-21 (Q-12) |
| RN-65 | *(Limites de transferência.)* | ⛔ Removida em 2026-10-21 (Q-12) |

---

## 9. Perdas, danos e ajustes

### 9.1 Livros com estudantes

| ID | Regra | Situação |
|---|---|---|
| RN-66 | Perda ou dano é registrado na **devolução** (resultado "perdido" ou "danificado", RN-40) com **justificativa obrigatória**: o estudante informa ao servidor **qual livro e o motivo**, e o servidor registra no sistema (DV-09). | ✅ |
| RN-67 | A justificativa é a **única consequência**: não há reposição, cobrança nem bloqueio de novas entregas (DV-09). | ✅ |
| RN-68 | Livro **perdido** não volta ao estoque. Livro **danificado** segue RN-40 (proposta: não volta). A justificativa aparece no comprovante, no histórico do estudante e no relatório de perdas e danos. | ✅ / 🟡 DV-20 |

### 9.2 Estoque do campus

| ID | Regra | Situação |
|---|---|---|
| RN-69 | **Entrada** de estoque (recebimento de livros do programa, doações) por Administrador do campus, informando título, quantidade e origem. | ✅ |
| RN-70 | **Baixa** (perda, extravio ou dano no acervo do campus) por Administrador do campus, com justificativa obrigatória. | ✅ |
| RN-71 | **Ajuste de inventário** (diferença encontrada na contagem física) por Administrador do campus, com justificativa e valor positivo ou negativo. | ✅ |
| RN-72 | O saldo disponível **nunca fica negativo**; toda alteração gera uma movimentação no livro-razão. | ✅ |

---

## 10. Catálogo e adoções

| ID | Regra | Situação |
|---|---|---|
| RN-73 | O catálogo de títulos é **compartilhado** por todos os campi. O ISBN é único: se o título já existe, é reaproveitado. | ✅ |
| RN-74 | Todo título tem **abrangência** (série específica ou ensino médio completo); título de série específica informa a **série**. | ✅ |
| RN-75 | Administradores de campus **criam** títulos; **edição e mescla** de duplicatas ficam com o Administrador institucional. | 🟡 DP-05 |
| RN-76 | Cada campus registra suas **adoções** por período letivo (título, curso/série, quantidade prevista). Campi podem adotar títulos e quantidades diferentes. | ✅ |

---

## 11. Relação entre estados

### Entrega

```
PREPARADA ──assinatura──> ASSINADA ──estorno (RN-28)──> ESTORNADA
    │
    └──cancelamento (RN-25)──> CANCELADA
```

Não há expiração automática (RN-24). O tratamento do estudante impossibilitado de assinar (RN-36) está adiado.

### Livro com o estudante (calculado)

```
em posse, no prazo ──prazo passa──> pendente (vencido)
        │                                │
        └────── devolução (qualquer resultado) ──────> encerrado
```

---

## 12. Decisões e pontos em aberto

### 12.1 Decisões incorporadas (2026-10-21)

| ID | Decisão | Regras |
|---|---|---|
| Q-01 | Importação tudo ou nada, com relatório de erros. | RN-11 |
| Q-02 | Entregas em qualquer data; sem bloqueio por período. | RN-15 |
| Q-03 | Um exemplar de cada título por entrega. | RN-17 |
| Q-04 | Título já em posse: apenas avisar. | RN-18 |
| Q-05 | Título fora das adoções: avisar e confirmar. | RN-20 |
| Q-06 | Pendência vencida: permitir com aviso (campus pode bloquear). | RN-21 |
| Q-07 | Uma entrega aguardando assinatura por estudante. | RN-22 |
| Q-08 | Assinatura com o dedo na tela do dispositivo do servidor; estudante só consulta. | RN-07, RN-30 a RN-34 |
| Q-09 | Operador estorna o que registrou; administrador do campus, qualquer registro. | RN-28, RN-43 |
| Q-10 | Prazos confirmados, sem tolerância. | RN-44 a RN-46 |
| Q-11 | Sem prorrogação individual. | RN-47 |
| Q-12 | Sem transferência de livros entre campi. | RN-04, RN-62 a RN-65 |
| DV-01 | Uso de dados reais: adiado; apenas dados fictícios. | — |
| DV-02 | Assinatura na tela vale como aceite (controle interno); sem tratamento para menores. | RN-35 |
| DV-03 | Identificação por matrícula, via QR code assinado ou digitação. | RN-77, RN-78 |
| DV-04 | Assinatura no mesmo instante; sem expiração. | RN-24 |
| DV-05 | Dispositivo institucional ou pessoal, com login institucional. | RN-30 |
| DV-06 | Estudante impossibilitado de assinar: adiado. | RN-36 |
| DV-09 | Perda/dano: só justificativa, registrada pelo servidor. | RN-66 a RN-68 |

### 12.2 Em aberto

| ID | Pergunta | Proposta atual | Quem decide |
|---|---|---|---|
| DV-19 | Origem e validade do QR code de identificação | Até a definição, usar a matrícula digitada | Responsável do projeto / CGE |
| DV-20 | Livro danificado volta ao estoque disponível? | Não; vira baixa | CGE |
| DP-04 | Matrícula muda na transferência? | Não muda | Registro Acadêmico |
| DP-05 | Curadoria do catálogo | Campus cria; institucional edita e mescla | PROEN / Bibliotecas |
| DP-08 | Transferência com pendências: procedimento e o que o destino vê | Devolver na origem; destino vê só um aviso sem bloqueio | PROEN |
| DP-09 | Abrangência do nada consta | A definir | PROEN |
| DV-06 | Estudante impossibilitado de assinar | Adiada | CGE / PROEN |

## Histórico

| Data | Revisão | Alteração |
|---|---|---|
| 2026-10-21 | 1 | Criação do documento. |
| 2026-10-21 | 3 | RF-012 simplificado (D-21): sem turmas nem semestres; vínculo com curso, série e ano letivo; prazos pelo término das aulas do ano letivo (RN-08, RN-09, RN-11, RN-15, RN-44, RN-45, RN-53, RN-77). |
| 2026-10-21 | 2 | Incorporadas as decisões Q-01 a Q-12 e DV-01 a DV-09: assinatura no dispositivo do servidor, identificação por matrícula/QR code (novas RN-77 a RN-79), sem expiração, estorno pelo operador, sem transferência de livros (RN-63 a RN-65 removidas), perda/dano apenas com justificativa. |
