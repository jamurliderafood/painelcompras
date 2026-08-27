/**
 * O que o radar vigia.
 *
 * A lista sai dos grupos que o próprio Flow usa nos lançamentos — não de uma
 * classificação nossa. Grupo novo que o Flow ganhar aparece na varredura sem
 * ninguém mexer aqui: `catalogoDinamico` acrescenta o que vier.
 *
 * Espelho de sql/02-carga.sql — `catalogo.test.ts` falha se divergirem.
 */

import type { DefMetrica } from './varredura';

export const CATALOGO: DefMetrica[] = [
  m('faturamento', 'Faturamento', 'financeiro', 'reais', 'maior_melhor', 0.10, 0.20),
  m('faturamento_dia', 'Faturamento por dia lançado', 'financeiro', 'reais', 'maior_melhor', 0.10, 0.20),
  m('resultado', 'Resultado do período', 'financeiro', 'reais', 'maior_melhor', 0.15, 0.30),
  m('margem', 'Margem', 'financeiro', 'percentual', 'maior_melhor', 0.02, 0.05),
  m('despesa_total', 'Despesa total', 'custos', 'reais', 'menor_melhor', 0.10, 0.20),

  m('cmv', 'CMV por compras', 'custos', 'percentual', 'menor_melhor', 0.015, 0.03),
  m('cmv_reais', 'Compras de mercadoria', 'custos', 'reais', 'menor_melhor', 0.15, 0.30),
  m('mao_de_obra', 'Mão de obra', 'custos', 'percentual', 'menor_melhor', 0.02, 0.04),
  m('encargos', 'Encargos sociais', 'custos', 'percentual', 'menor_melhor', 0.01, 0.02),
  m('utilidades', 'Utilidades', 'custos', 'reais', 'menor_melhor', 0.15, 0.30),
  m('materiais', 'Materiais', 'custos', 'reais', 'menor_melhor', 0.20, 0.40),
  m('prediais', 'Despesas prediais', 'custos', 'reais', 'menor_melhor', 0.15, 0.30),
  m('financeiras', 'Despesas financeiras', 'custos', 'reais', 'menor_melhor', 0.20, 0.40),
  m('publicidade', 'Publicidade', 'custos', 'reais', 'menor_melhor', 0.25, 0.50),
  m('terceiros', 'Terceiros', 'custos', 'reais', 'menor_melhor', 0.20, 0.40),
  m('gerais', 'Despesas gerais', 'custos', 'reais', 'menor_melhor', 0.20, 0.40),
  m('impostos', 'Impostos', 'custos', 'percentual', 'menor_melhor', 0.01, 0.02),

  // Saúde do dado, não da operação. Cliente que para de lançar é o primeiro
  // sintoma de cliente que vai embora, e aparece aqui antes de qualquer
  // indicador financeiro piorar.
  m('dias_lancados', 'Dias com receita lançada', 'saude', 'contagem', 'maior_melhor', 0.10, 0.25),
  m('lancamentos', 'Lançamentos no período', 'saude', 'contagem', 'maior_melhor', 0.25, 0.50),
];

/** grupo do Flow → chave da métrica. O que não estiver aqui é somado na
 *  despesa total e aparece na varredura por nome do grupo. */
export const GRUPO_PARA_METRICA: Record<string, string> = {
  'CMV': 'cmv',
  'Mão-de-Obra': 'mao_de_obra',
  'Encargos Sociais': 'encargos',
  'Utilidades': 'utilidades',
  'Materiais': 'materiais',
  'Despesas Prediais': 'prediais',
  'Despesas Financeiras': 'financeiras',
  'Publicidade': 'publicidade',
  'Terceiros': 'terceiros',
  'Despesas Gerais': 'gerais',
  'Impostos': 'impostos',
};

function m(
  chave: string, rotulo: string, grupo: string,
  unidade: DefMetrica['unidade'], direcao: DefMetrica['direcao'],
  limiarAtencao: number, limiarCritico: number,
): DefMetrica {
  return { chave, rotulo, grupo, unidade, direcao, limiarAtencao, limiarCritico };
}

export const POR_CHAVE = new Map(CATALOGO.map((d) => [d.chave, d]));
