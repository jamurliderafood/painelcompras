-- ===========================================================================
-- 02-carga.sql — catálogo de métricas
-- ===========================================================================
--
-- Rode depois de 01-esquema.sql. Pode rodar de novo.
--
-- Os grupos vêm classificados pelo próprio Flow em cada lançamento — CMV,
-- Receita, Mão-de-Obra, Encargos Sociais, Utilidades... Esta lista espelha
-- esses grupos. Grupo novo que o Flow ganhar entra aqui numa linha.

begin;

insert into metrica (chave, rotulo, grupo, unidade, direcao, limiar_atencao, limiar_critico) values
  ('faturamento',      'Faturamento',                  'financeiro', 'reais',      'maior_melhor', 0.1000, 0.2000),
  ('faturamento_dia',  'Faturamento por dia lançado',  'financeiro', 'reais',      'maior_melhor', 0.1000, 0.2000),
  ('resultado',        'Resultado do período',         'financeiro', 'reais',      'maior_melhor', 0.1500, 0.3000),
  ('margem',           'Margem',                       'financeiro', 'percentual', 'maior_melhor', 0.0200, 0.0500),
  ('despesa_total',    'Despesa total',                'custos',     'reais',      'menor_melhor', 0.1000, 0.2000),

  ('cmv',              'CMV por compras',              'custos',     'percentual', 'menor_melhor', 0.0150, 0.0300),
  ('cmv_reais',        'Compras de mercadoria',        'custos',     'reais',      'menor_melhor', 0.1500, 0.3000),
  ('mao_de_obra',      'Mão de obra',                  'custos',     'percentual', 'menor_melhor', 0.0200, 0.0400),
  ('encargos',         'Encargos sociais',             'custos',     'percentual', 'menor_melhor', 0.0100, 0.0200),
  ('utilidades',       'Utilidades',                   'custos',     'reais',      'menor_melhor', 0.1500, 0.3000),
  ('materiais',        'Materiais',                    'custos',     'reais',      'menor_melhor', 0.2000, 0.4000),
  ('prediais',         'Despesas prediais',            'custos',     'reais',      'menor_melhor', 0.1500, 0.3000),
  ('financeiras',      'Despesas financeiras',         'custos',     'reais',      'menor_melhor', 0.2000, 0.4000),
  ('publicidade',      'Publicidade',                  'custos',     'reais',      'menor_melhor', 0.2500, 0.5000),
  ('terceiros',        'Terceiros',                    'custos',     'reais',      'menor_melhor', 0.2000, 0.4000),
  ('gerais',           'Despesas gerais',              'custos',     'reais',      'menor_melhor', 0.2000, 0.4000),
  ('impostos',         'Impostos',                     'custos',     'percentual', 'menor_melhor', 0.0100, 0.0200),

  -- Saúde do dado, não da operação.
  ('dias_lancados',    'Dias com receita lançada',     'saude',      'contagem',   'maior_melhor', 0.1000, 0.2500),
  ('lancamentos',      'Lançamentos no período',       'saude',      'contagem',   'maior_melhor', 0.2500, 0.5000)
on conflict (chave) do update set
  rotulo = excluded.rotulo, grupo = excluded.grupo, unidade = excluded.unidade,
  direcao = excluded.direcao, limiar_atencao = excluded.limiar_atencao,
  limiar_critico = excluded.limiar_critico;

commit;
