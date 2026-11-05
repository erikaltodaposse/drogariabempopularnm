# SPEC — Checkpoint Drogaria

Registro do escopo e das decisões. A base veio do Checkpoint Nil (sistema da Nil Cosméticos, uma funcionária);
aqui ficam as regras herdadas que continuam valendo e o que mudou para a Drogaria Bem Popular.

## 1. Resumo

Aplicação web mobile-first para a Drogaria Bem Popular. Dois funcionários registram ponto, checklist diário com
fotos e fechamento do dia, cada um no próprio celular e com as próprias tarefas. A gerência
distribui as tarefas, confere o dia de cada um e compara o desempenho dos dois.

## 2. Perfis

| Papel | Entrada | Pode |
| --- | --- | --- |
| employee | PIN de 4 a 6 dígitos (único por pessoa) | Próprio dia: check-in, check-out, marcar as próprias tarefas, anexar foto, fechar dia, trocar PIN |
| manager (gerência) | e-mail e senha | Painel da equipe, editor de tarefas com responsável, ajustes, equipe, exportação |

O seed cria dois funcionários, com PINs iniciais `1234` e `5678` e troca obrigatória no primeiro acesso. Até trocar,
a API só responde `/api/me`, `/api/auth/change-pin` e `/api/auth/logout`.

## 3. Regras de negócio

- **Responsável por tarefa** (`checklist_tasks.assignee`): id de um funcionário ou nulo (todos). O snapshot do dia
  de cada pessoa leva só as tarefas dela e as de todos; blocos que ficam vazios saem do dia dela.
- Tarefas automáticas (entrada, saída, fechamento) são sempre de todos: cada pessoa bate o próprio ponto.
- **Meta diária por pessoa** (`settings.meta_pontos`, padrão 100). O checklist padrão dá exatamente 100 para cada um.
- **Sem postagens.** A drogaria não faz postagens: não há roteiro, prompts nem tarefa de postagens. As tabelas
  `posts` e `post_checks` continuam no banco (migrações publicadas não mudam), mas nada as usa.
- `pontos_dia` = soma das tarefas marcadas no snapshot do dia daquela pessoa.
- `adesão` = pontos totais / (dias trabalhados × meta). Dia trabalhado = registro com pelo menos um check.
- Expediente de segunda a sábado (`dias_expediente = 1,2,3,4,5,6`).
- Faixas: Ouro ≥ 95%, Prata 88–94%, Bronze 80–87%, Abaixo < 80%. Só cálculo e exibição.
- Snapshot congelado no primeiro registro do dia. Editar o checklist cria nova versão; o dia de hoje ainda vazio
  é regravado, já filtrado para o dono do dia.
- Foco de limpeza por dia da semana substitui `{foco}` no texto da tarefa.
- Nenhuma rota altera checks de dias anteriores.

## 4. Arquitetura

Igual ao Checkpoint Nil: Node 20+, Express 4, SQLite pelo libSQL (Turso na Vercel, arquivo local no
desenvolvimento), frontend em HTML, CSS e JS puros sem build, fotos no Vercel Blob ou em disco, testes com
`node:test` + `supertest`.

## 5. Decisões

1. **Código copiado do Checkpoint Nil** em vez de começar do zero — o Erik pediu "a ideia do projeto da Nil";
   ponto por NFC, fotos, exportação e backup vêm prontos.
2. **Responsável na própria tarefa do checklist** (migração 4), e não uma tabela de atribuição à parte — o
   checklist já é por dia da semana e versionado; a atribuição segue a mesma versão. O editor filtra por pessoa
   ("Ver tarefas de") e a tarefa nova nasce da pessoa escolhida.
3. **Responsável guardado como id do funcionário.** Trocar a pessoa do cargo é renomear o funcionário em Ajustes;
   o histórico continua ligado ao mesmo registro.
4. **"Todos" significa que cada um faz a sua**, no próprio dia, e não "quem fizer primeiro" — mantém o placar
   individual simples e justo.
5. **Meta igual para os dois** — o editor mostra a soma de cada funcionário e avisa quem ficou abaixo da meta, em
   vez de uma meta por pessoa.
6. **Login continua só por PIN**, sem escolher o nome — os PINs nunca se repetem (troca e PIN provisório recusam
   PIN de outra pessoa).
7. **Novo `GET /api/manager/team`**: o resumo do painel (o mesmo `summarize`) para cada funcionário ativo, as 3
   tarefas que mais falham e o dia de hoje. As rotas individuais (`summary`, `days`, `failures`, `export.csv`)
   continuam com `?user_id`.
8. **Painel com "Equipe lado a lado"** no topo (cartões por pessoa e barras de adesão, tarefas feitas e
   pontualidade, com a frase de quem está à frente) e "Desempenho de …" com seletor de pessoa para o detalhe.
   Cada pessoa tem uma cor, sempre acompanhada do nome.
9. **Equipe em Ajustes**: renomear (`PUT /api/manager/employees/:id`) e PIN provisório
   (`POST /api/manager/employees/:id/reset-pin`), que obriga a troca e derruba as sessões abertas.
10. **Cores da logo oficial (enviada pelo Erik em 05/11, fundo branco)**: vermelho `#E00000` no cabeçalho, botões e
    abas; verde `#1FA51C`/`#037D02` para o que foi feito (tarefa marcada, barras, anel de pontos), já que vermelho em
    progresso leria como erro; amarelo `#FEDF03` na faixa do cabeçalho; azul `#0028AE` como cor de uma pessoa no
    comparativo; texto quase preto, como o "POPULAR BRASIL" da logo. A logo completa fica num cartão branco na tela
    de entrada; o ícone (cabeçalho e navegador) é a cruz da logo em SVG. Fonte cursiva da Nil removida.
11. **Checklist padrão por função** (pedido do Erik em 05/11): o primeiro funcionário, Jaqueline, é do caixa e
    atendimento (abrir a loja, caixa, limpeza do foco, gôndolas, preços, WhatsApp, fechamento de caixa); o segundo,
    Bruno, é o farmacêutico (geladeira com foto da temperatura, receitas e SNGPC, validade, recebimento, reposição,
    controlados). 16 tarefas, 100 pontos para cada um. "Restaurar padrão" aceita vários dias de uma vez.
12. **Roteiro de postagens removido** (05/11: "eles não fazem postagens"): sai a aba Roteiro, a tarefa de
    postagens, os prompts, o estilo da marca em Ajustes e as rotas `/api/manager/posts` e `/api/day/:date/posts`.
    O seed troca o checklist antigo pelo novo só se nenhum dia tiver sido registrado.
13. **Removido o ajuste do snapshot antigo da Nil** (`upgradeLegacyDay`) — esta base começa com banco novo.
14. **Fuso de Manaus mantido** — a confirmar com o Erik.

## 6. Pendências

- Horários de turno e cidade (fuso).
- Revisar com o Erik o checklist padrão e a divisão de tarefas.
- Deploy: criar o banco no Turso, conectar o Blob e cadastrar as variáveis (README, Deploy na Vercel).
