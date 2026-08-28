-- ===========================================================================
-- 04-carteira-automatica.sql — a carteira deixou de ser cadastrada à mão
-- ===========================================================================
--
-- Rode depois de 01 e 02. Pode rodar de novo sem estragar nada.
--
-- O `03-carteira.sql` cadastrava cada restaurante à mão, com o nome da variável
-- de ambiente que guardava o token dele. Isso acabou: o radar lê a tabela
-- `organizacoes` do Flow e a carteira é o que estiver lá. Quem passa a
-- preencher a tabela `cliente` é o próprio radar, no começo de cada rodada
-- (`sincronizarClientes`).
--
-- Sem isso NADA é gravado. As cinco tabelas de histórico têm chave estrangeira
-- para `cliente(id)`, e o `id` agora é o UUID da organização no Flow — que
-- nunca esteve nesta tabela. Na primeira rodada com o banco ligado, as vinte e
-- oito gravações falhariam, uma a uma, com erro de chave estrangeira.

begin;

-- O `id` deixou de ser um apelido nosso ('soffri-grill') e passou a ser o UUID
-- da organização no Flow. Continua `text` — não vale trocar para `uuid` e
-- perder as linhas antigas por causa de um tipo.
comment on column cliente.id is
  'UUID da organização no Flow. Preenchido pelo radar em cada rodada.';

comment on column cliente.flow_token_env is
  'Obsoleto. A carteira vem do banco do Flow; não há mais token por cliente.';

-- ---------------------------------------------------------------------------
-- O relatório do dia, inteiro
-- ---------------------------------------------------------------------------
--
-- As tabelas `snapshot_metrica` e `achado` guardam a série para consulta: elas
-- respondem "como o CMV do Soffri andou nos últimos 90 dias". São normalizadas
-- de propósito, e é isso que as torna ruins para desenhar a tela — reconstruir
-- o relatório inteiro a partir delas exigiria refazer, em SQL, a análise que
-- já foi feita em TypeScript.
--
-- Esta tabela guarda o relatório como ele foi calculado. O painel abre lendo
-- daqui, instantâneo, sem tocar no Flow. As outras continuam existindo, e para
-- o que elas servem: gráfico de série e consulta histórica.
--
-- Sim, é o mesmo dado em dois formatos. A alternativa é o painel reler 5,5 MB
-- do Flow a cada carregamento de página, que é o que ele fazia.
create table if not exists relatorio (
  cliente_id  text not null references cliente(id) on delete cascade,
  data_ref    date not null,
  -- O RelatorioCliente serializado, como o painel o consome.
  payload     jsonb not null,
  -- Quando esta foto foi tirada. O painel mostra ao lado do botão de atualizar,
  -- porque "os números são das 5h" muda o que se faz com eles.
  apurado_em  timestamptz not null default now(),
  primary key (cliente_id, data_ref)
);

create index if not exists idx_relatorio_data on relatorio (data_ref desc);

alter table relatorio enable row level security;

-- ---------------------------------------------------------------------------
-- O CMV real entra no catálogo
-- ---------------------------------------------------------------------------
--
-- `snapshot_metrica.metrica` tem chave estrangeira para `metrica(chave)`, então
-- métrica que não estiver aqui não pode ser gravada.
--
-- O CMV real é medido por CONTAGEM DE ESTOQUE, e contagem não tem cadência:
-- o Soffri tem cinco, o JK tem vinte e duas, a maioria tem uma ou nenhuma. Por
-- isso ele fica FORA do catálogo de indicadores vigiados (`src/analise/
-- catalogo.ts`), que compara janela contra janela — ali ele produziria "sem
-- base" todo dia. Aqui ele entra só para poder ser guardado: a série dele é
-- contagem contra contagem, não dia contra dia.
insert into metrica (chave, rotulo, grupo, unidade, direcao, limiar_atencao, limiar_critico) values
  ('cmv_real', 'CMV real (contagem de estoque)', 'custos', 'percentual', 'menor_melhor', 0.0150, 0.0300)
on conflict (chave) do update set rotulo = excluded.rotulo;

commit;
