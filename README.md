# Checkpoint Drogaria

Sistema de tarefas e desempenho da equipe da **Drogaria Bem Popular**. Cada um dos dois funcionários entra
pelo celular com o próprio PIN, marca as tarefas que são dele (com foto quando a tarefa pede).
A gerência distribui as tarefas, acompanha o dia de cada um em tempo real e compara o desempenho dos dois
no painel. Escopo e decisões em [`SPEC.md`](SPEC.md).

Nasceu do Checkpoint Nil (sistema da Nil Cosméticos): mesma base e mesmo layout, com as cores da drogaria,
dois funcionários e tarefas com responsável.

## Como funciona

- **Tarefas com responsável.** Em Gestão → Tarefas, cada tarefa do checklist de cada dia da semana tem um
  responsável: um dos funcionários ou "Todos". O dia de cada pessoa mostra só as tarefas dela e as de todos.
  "Fechar o dia" é sempre de todos (cada um fecha o seu). O app não registra entrada nem saída. Os botões "Ver tarefas de"
  filtram o editor por pessoa, e a tarefa nova adicionada com uma pessoa escolhida já nasce dela.
- **Checklist por função.** O padrão já vem dividido: o primeiro funcionário (Jaqueline) cuida de caixa e
  atendimento; o segundo (Bruno), farmacêutico, da geladeira, receitas e controlados, validade, recebimento e
  estoque. "Restaurar padrão em todos os dias" volta a essa divisão de uma vez.
- **Meta por pessoa.** A meta diária (padrão 100 pontos) vale para cada funcionário. O editor mostra quanto
  cada um soma no dia e avisa se alguém ficou abaixo da meta.
- **Painel da equipe.** Em Gestão → Painel, o cartão "Equipe lado a lado" mostra para cada funcionário: o dia
  de hoje, adesão e faixa de bônus, tarefas feitas, pontualidade, faltas e a tarefa que mais esquece, com
  barras comparando os dois. Abaixo, "Desempenho de …" abre o detalhe de uma pessoa: gráficos, ranking de
  falhas, histórico com fotos e planilha.
- **Contagem de estoque.** Em Gestão → Contagens, a gerência cria uma contagem com as partes do estoque (uma por
  linha, na ordem de contagem). Ela aparece no dia dos dois funcionários: cada um marca a parte que terminou e, se
  parar no meio, anota onde parou. No dia seguinte, quem abrir o app vê "Continue de: …" com a anotação. Guarda só o
  andamento (não as quantidades) e fecha sozinha quando todas as partes estão contadas.
- **Equipe.** Em Gestão → Ajustes → Funcionários, a gerência troca o nome de cada um e define um PIN
  provisório quando alguém esquece o seu.

> Cores tiradas da logo oficial da drogaria: vermelho da marca no cabeçalho e nos botões, verde para o que foi feito,
> amarelo e azul nos detalhes. A logo completa (`public/img/logo-drogaria.jpg`) aparece na tela de entrada; o
> ícone do cabeçalho e do navegador (`logo.svg`, `favicon.png`, `apple-touch-icon.png`) é a cruz da logo.
> Para ajustar, edite as variáveis no topo de `public/css/app.css`.

## Requisitos

- Node.js 22 LTS (funciona no 20 LTS).
- Nada mais: o banco é SQLite, aberto pelo pacote `@libsql/client` (sem compilação).

## Instalação (Windows, PowerShell)

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

No `.env`, para desenvolvimento:

- `NODE_ENV=development` (assim o cookie funciona por `http://` na rede local).
- `DATA_DIR=./data` (ou apague a linha; o padrão já é `./data`).
- `SESSION_SECRET`: gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `MANAGER_EMAIL` e `MANAGER_PASSWORD` (mínimo 8 caracteres) da gerência.
- `EMPLOYEE_1_NAME` e `EMPLOYEE_2_NAME` com o nome dos dois funcionários.

Depois:

```powershell
npm run seed
npm run dev
```

Abra `http://localhost:3000`. Para testar no celular, use `http://IP-DA-MAQUINA:3000` na mesma rede
(o IP aparece em `ipconfig`).

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `PORT` | não | Porta HTTP. Padrão `3000`. |
| `NODE_ENV` | não | `production` liga o cookie `secure` (exige HTTPS). |
| `DATA_DIR` | não | Pasta do banco (`app.db`) e das fotos (`uploads/`). Padrão `./data`. Criada automaticamente. |
| `SESSION_SECRET` | sim | Assina o cookie de sessão. Mínimo 32 caracteres; use 64 aleatórios. |
| `MANAGER_EMAIL` | no seed | E-mail de login da gerência. |
| `MANAGER_PASSWORD` | no seed | Senha da gerência, mínimo 8 caracteres. |
| `MANAGER_NAME` | não | Nome exibido da gerência. Padrão `Gerência`. |
| `EMPLOYEE_1_NAME` | não | Nome do primeiro funcionário (Jaqueline). Padrão `Funcionário 1`. |
| `EMPLOYEE_2_NAME` | não | Nome do segundo funcionário (Bruno). Padrão `Funcionário 2`. |
| `TURSO_DATABASE_URL` | na Vercel | Endereço do banco no Turso (`libsql://...`). Em branco, usa o arquivo `DATA_DIR/app.db`. |
| `TURSO_AUTH_TOKEN` | na Vercel | Token de acesso ao banco do Turso. |
| `BLOB_STORE_ID` ou `BLOB_READ_WRITE_TOKEN` | na Vercel | Criadas sozinhas ao conectar um Vercel Blob ao projeto (a primeira usa OIDC). Sem nenhuma, as fotos ficam em `DATA_DIR/uploads`. |
| `TZ` | não | Use `America/Manaus`. O código já calcula datas nesse fuso de qualquer jeito. |

## Seed

`npm run seed` cria, se ainda não existirem:

- a gerência, com e-mail e senha do `.env`;
- os dois funcionários, com PINs iniciais `1234` e `5678` e troca obrigatória no primeiro acesso
  (o login é só pelo PIN, por isso os PINs nunca se repetem);
- as configurações padrão (meta 100 por pessoa, turno 08:00–18:00, expediente de segunda a sábado);
- o checklist padrão de 14 tarefas para cada dia da semana, já dividido por função: 100 pontos para cada
  funcionário (o primeiro com caixa e atendimento; o segundo, farmacêutico, com a farmácia).

Pode rodar de novo sem perder nada: o que já existe não é sobrescrito. A única exceção é um banco criado pela
versão anterior, que tinha roteiro de postagens: enquanto nenhum dia tiver sido registrado, o seed troca aquele
checklist pelo padrão por função.

## Banco e migrações

Localmente o banco fica em `DATA_DIR/app.db`; com `TURSO_DATABASE_URL` definida, fica no Turso. O acesso é pelo
cliente libSQL nos dois casos. As migrações rodam sozinhas quando o servidor sobe; para rodar à parte,
use `npm run migrate`.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor com recarga automática (nodemon). |
| `npm start` | Servidor sem recarga. |
| `npm run seed` | Popula usuários, configurações e checklist. |
| `npm run migrate` | Aplica migrações pendentes. |
| `npm run restore -- arquivo.json` | Restaura um backup JSON num banco vazio. |
| `npm test` | Testes (`node:test` + `supertest`). |
| `npm run lint` | ESLint. |

## Exportação e backup pelo app

No Painel da gerência, o cartão **Exportar** tem:

- **Baixar planilha (CSV)**: um dia por linha no período escolhido, do funcionário escolhido, separado por `;`, com BOM UTF-8 (abre direto no Excel).
- **Baixar backup (JSON)**: todos os registros, tarefas, versões do checklist, ajustes e log de auditoria. Não inclui sessões nem os arquivos das fotos.

## Restaurar um backup numa máquina limpa

1. Instale o projeto (`npm install`) e crie o `.env` como acima.
2. **Não** rode o seed: a restauração exige banco vazio.
3. Restaure: `npm run restore -- C:\caminho\checkpoint-backup-AAAA-MM-DD.json`
4. Copie a pasta de fotos (`uploads/`) do backup do servidor para `DATA_DIR/uploads/`.
5. Suba o servidor (`npm start`). Gerência e funcionários entram com as mesmas credenciais de antes.

O teste `tests/export.test.js` confere que painel, ranking, histórico e CSV saem idênticos depois da restauração.

## Deploy na Vercel

A Vercel não guarda arquivos entre uma requisição e outra, então o banco fica no **Turso** (SQLite na nuvem,
plano gratuito) e as fotos no **Vercel Blob**. O repositório já traz `vercel.json` e `api/index.js`; não há build.

1. **Banco no Turso.** Crie a conta em turso.tech, crie um banco (região mais próxima: `gru`, São Paulo) e copie
   o endereço `libsql://...` e um token (botão "Create Token" no painel do banco, ou
   `turso db show --url <nome>` e `turso db tokens create <nome>` na linha de comando).
2. **Fotos no Blob.** No projeto da Vercel, abra Storage, crie um Blob store e conecte ao projeto. A variável
   a Vercel cria sozinha a `BLOB_STORE_ID` (acesso por OIDC) ou, em contas antigas, a
   `BLOB_READ_WRITE_TOKEN`. O app aceita as duas.
3. **Variáveis.** Em Settings, Environment Variables, cadastre para Production:
   - `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` (passo 1);
   - `SESSION_SECRET` com 64 caracteres aleatórios (por exemplo, a saída de
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
   - `NODE_ENV` = `production`;
   - `NODEJS_HELPERS` = `0` (deixa o Express ler o corpo das requisições sem interferência da Vercel).
4. **Contas iniciais.** Cadastre também `MANAGER_EMAIL`, `MANAGER_PASSWORD` (mínimo 8 caracteres) e, se quiser,
   `EMPLOYEE_1_NAME` e `EMPLOYEE_2_NAME`. Na primeira requisição o app cria as tabelas no Turso, a gerência, os dois
   funcionários (PINs `1234` e `5678`, troca no primeiro acesso) e o checklist. Depois disso o seed não sobrescreve nada; trocar a senha nessa variável
   não muda a senha de uma gerência já criada. Rodar `npm run seed` do computador, com as variáveis do Turso, também
   funciona.
5. **Redeploy.** Em Deployments, refaça o último deploy para ele ler as variáveis novas. Se faltar alguma, as rotas
   `/api` respondem `server_not_configured` e o log da função diz qual.

Observações: cada foto chega comprimida (cerca de 300 KB), bem abaixo do limite de 4,5 MB por requisição da Vercel.
O limite de tentativas de login é contado por instância da função. O backup JSON do app continua valendo; as
fotos ficam no Blob e podem ser baixadas pelo painel da Vercel.
