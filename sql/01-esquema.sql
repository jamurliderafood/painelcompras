-- ===========================================================================
-- 01-esquema.sql — Radar Flow
-- ===========================================================================
--
-- O que este banco existe para resolver: o Flow sabe como o restaurante está
-- HOJE. Ele não guarda "como estava no dia 26 de agosto do ano passado" de um
-- jeito que dê para comparar todo dia, em toda a carteira, sozinho. Sem
-- histórico gravado do nosso lado não existe "piorou" — existe só "está".
--
-- Por isso a coleta grava um retrato (snapshot) por cliente por dia, e nunca
-- apaga. A análise lê retratos, nunca a API do Flow.
--
-- Rode uma vez por ambiente. Pode rodar de novo: tudo aqui é idempotente.

begin;

-- ---------------------------------------------------------------------------
-- Carteira
-- ---------------------------------------------------------------------------

create table if not exists cliente (
  id              text primary key,
  nome            text not null,
  -- O Flow é multi-cliente numa base só; quem separa um restaurante do outro é
  -- o token de API. O token NÃO mora aqui — o radar o procura na variável de
  -- ambiente `FLOW_TOKEN_<ID EM MAIÚSCULAS>`. Esta coluna é só anotação para
  -- quem for administrar, e pode ficar vazia.
  flow_token_env  text,
  fuso            text not null default 'America/Sao_Paulo',
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now()
);

-- Ajustes que mudam o julgamento, por cliente. Um delivery aceita CMV 32%;
-- uma pizzaria de rodízio, não. Limiar igual para todo mundo vira alarme que
-- ninguém lê.
create table if not exists cliente_config (
  cliente_id           text primary key references cliente(id) on delete cascade,
  -- métrica → alvo, em fração: {"cmv": 0.32, "mao_de_obra": 0.28}.
  -- Com histórico curto, a régua vale mais que a comparação com o passado —
  -- é o primeiro campo a preencher quando um cliente entra na carteira.
  -- Sem meta, o indicador é registrado e não é julgado.
  metas                jsonb not null default '{"cmv": 0.30}'::jsonb,
  -- Não gritar por variação irrelevante em valor absoluto.
  piso_relevancia_reais numeric(12,2) not null default 200.00
);

-- ---------------------------------------------------------------------------
-- Retratos diários
-- ---------------------------------------------------------------------------

-- Uma linha por rodada de coleta. Serve para saber se o dia foi realmente
-- coletado ou se a API falhou — "faturamento zero" e "não coletamos" são
-- coisas opostas e não podem virar o mesmo silêncio no painel.
create table if not exists coleta (
  id           bigserial primary key,
  cliente_id   text not null references cliente(id) on delete cascade,
  data_ref     date not null,
  situacao     text not null check (situacao in ('ok','parcial','erro')),
  fontes_ok    text[] not null default '{}',
  fontes_erro  text[] not null default '{}',
  detalhe_erro text,
  -- O quanto dá para confiar na análise deste dia: alta | media | baixa.
  -- Sai do diagnóstico de qualidade do dado, e aparece no painel ANTES dos
  -- números — quem lê precisa saber a ressalva antes da conclusão.
  confianca    text check (confianca in ('alta','media','baixa')),
  -- Cobertura de lançamento, lacunas, reclassificações detectadas.
  diagnostico  jsonb not null default '{}'::jsonb,
  iniciada_em  timestamptz not null default now(),
  concluida_em timestamptz,
  unique (cliente_id, data_ref)
);

-- Catálogo do que sabemos vigiar. É aqui que "varre tudo que tem no Flow"
-- deixa de ser promessa: cada coisa que a coleta traz vira uma linha aqui,
-- com o que significa piorar.
create table if not exists metrica (
  chave            text primary key,
  rotulo           text not null,
  grupo            text not null,           -- financeiro | custos | caixa | saude
  unidade          text not null check (unidade in ('reais','percentual','contagem','minutos','dias')),
  direcao          text not null check (direcao in ('maior_melhor','menor_melhor')),
  -- Variação relativa que acende amarelo/vermelho (0.10 = 10%). Para métricas
  -- que já são percentuais (CMV), o motor usa pontos percentuais.
  limiar_atencao   numeric(6,4) not null default 0.1000,
  limiar_critico   numeric(6,4) not null default 0.2000,
  ativa            boolean not null default true
);

-- O retrato em si: valor de uma métrica, de um cliente, num dia.
create table if not exists snapshot_metrica (
  cliente_id text not null references cliente(id) on delete cascade,
  data_ref   date not null,
  metrica    text not null references metrica(chave),
  valor      numeric(16,4) not null,
  primary key (cliente_id, data_ref, metrica)
);

create index if not exists idx_snapshot_serie
  on snapshot_metrica (cliente_id, metrica, data_ref desc);

-- ---------------------------------------------------------------------------
-- Produto, insumo e nota — o que sustenta o CMV
-- ---------------------------------------------------------------------------

-- Um retrato do cadastro de preços por rodada.
--
-- A API do Flow devolve só o preço de agora, sem histórico — e preço de insumo
-- muda quando entra nota, que é semanal, quinzenal ou quando o cliente resolve
-- comprar. Sem cadência não há janela: a única forma de saber QUANDO um preço
-- mudou é guardar como ele estava ontem. É isso que esta tabela é.
--
-- Guardamos o cadastro inteiro todo dia, e não só o que mudou. Guardar só a
-- diferença economizaria linha e tornaria impossível responder "quanto custava
-- em 12 de agosto" depois que alguém corrigir um cadastro para trás.
create table if not exists retrato_preco (
  cliente_id  text not null references cliente(id) on delete cascade,
  data_ref    date not null,
  insumo_id   text not null,
  nome        text not null,
  unidade     text not null,
  preco       numeric(14,4),
  fornecedor  text,
  categoria   text,
  primary key (cliente_id, data_ref, insumo_id)
);

create index if not exists idx_retrato_preco_serie
  on retrato_preco (cliente_id, insumo_id, data_ref desc);

-- ---------------------------------------------------------------------------
-- Achados — o que o painel mostra
-- ---------------------------------------------------------------------------

create table if not exists achado (
  id           bigserial primary key,
  cliente_id   text not null references cliente(id) on delete cascade,
  data_ref     date not null,
  metrica      text not null,
  severidade   text not null check (severidade in ('critico','atencao','melhorou','estavel','sem_base')),
  titulo       text not null,
  explicacao   text not null,
  valor_atual  numeric(16,4),
  valor_base   numeric(16,4),
  data_base    date,
  -- Como a base foi escolhida: ano_anterior | mes_anterior | nenhuma. Precisa
  -- aparecer no painel: comparar com o mês passado não vale o mesmo que
  -- comparar com o ano passado, e quem lê tem de saber qual foi.
  base_origem  text not null,
  -- Ofensores por categoria e fornecedor, efeito custo x efeito faturamento,
  -- avisos. Fica em jsonb porque cada métrica explica a si mesma de um jeito.
  detalhe      jsonb not null default '{}'::jsonb,
  criado_em    timestamptz not null default now(),
  unique (cliente_id, data_ref, metrica)
);

create index if not exists idx_achado_painel
  on achado (data_ref desc, severidade);

-- ---------------------------------------------------------------------------
-- Quem pode ler
-- ---------------------------------------------------------------------------
--
-- No Supabase, toda tabela é publicada numa API REST automaticamente. Tabela
-- criada por SQL nasce com RLS DESLIGADA, e RLS desligada nessa API significa
-- que a chave `anon` do projeto lê tudo. Aqui dentro está o financeiro dos
-- clientes.
--
-- Ligando RLS e não criando política nenhuma, ninguém lê pela API. O radar
-- continua funcionando porque usa a `service_role`, que passa por cima de RLS
-- por definição — e essa chave só existe no servidor da Vercel, nunca no
-- navegador.
--
-- Se um dia o painel for aberto direto do navegador, é aqui que entram as
-- políticas. Enquanto todo acesso for pelo servidor, o certo é não ter
-- nenhuma.

alter table cliente          enable row level security;
alter table cliente_config   enable row level security;
alter table coleta           enable row level security;
alter table metrica          enable row level security;
alter table snapshot_metrica enable row level security;
alter table retrato_preco    enable row level security;
alter table achado           enable row level security;

commit;
