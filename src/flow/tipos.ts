/**
 * O que a API do Flow devolve.
 *
 * Conferido contra a resposta real do Soffri Grill em 26/08/2026, não contra
 * documentação. As duas versões anteriores deste arquivo foram escritas a
 * partir de suposição sobre que sistema era o Flow, e as duas estavam erradas.
 *
 *   GET /v1/resumo       o mês corrente já somado
 *   GET /v1/lancamentos  todos os lançamentos, sem filtro de data
 *   GET /v1/produtos     o cadastro de insumos com preço
 *
 * O que a API NÃO expõe hoje: fichas técnicas, contagem de estoque e o
 * histórico de CMV por inventário (`cmvRegistros`). Esses dados existem dentro
 * do Flow — dá para acrescentar os endpoints, porque a API é da Lidera. Sem
 * eles não existe CMV real nem decomposição em preço/mix/quebra; o que dá é
 * CMV por compras, que é compra e não consumo.
 */

export type DataISO = string; // 'YYYY-MM-DD'

/** O `grupo` vem classificado pelo próprio Flow. É melhor que qualquer
 *  heurística nossa e substitui a que a versão anterior tinha. */
export type Grupo =
  | 'Receita'
  | 'CMV'
  | 'Mão-de-Obra'
  | 'Encargos Sociais'
  | 'Materiais'
  | 'Utilidades'
  | 'Terceiros'
  | 'Despesas Prediais'
  | 'Despesas Gerais'
  | 'Despesas Financeiras'
  | 'Publicidade'
  | 'Impostos'
  | (string & {}); // o Flow pode ganhar grupos novos sem quebrar o radar

export interface Lancamento {
  id: string;
  data: DataISO;
  grupo: Grupo;
  /** Subcategoria. Em Receita é a forma de pagamento (PIX, Cartão, Vale);
   *  em CMV é o tipo de compra (Hortifruti, Proteínas - Bovinas). */
  sub?: string;
  descricao?: string;
  valor: number;
  forma?: string;
}

export interface Insumo {
  id: string;
  nome: string;
  categoria: string;
  subcategoria?: string;
  /** Ausente em 63 dos 291 insumos do Soffri. Insumo sem preço não entra em
   *  conta nenhuma e é contado como falha de cadastro. */
  preco?: number;
  unidade: string;
  fornecedor?: string;
}

/** O `/v1/resumo` do mês corrente, como o Flow calcula. Guardamos para
 *  conferência: se a nossa conta discordar da dele, é sinal de que
 *  interpretamos algum grupo de forma diferente, e quem está errado
 *  provavelmente somos nós. */
export interface ResumoFlow {
  ok: boolean;
  mes: string;            // 'YYYY-MM'
  faturamento: number;
  despesas: number;
  cmv_valor: number;
  cmv_pct: number;        // já em porcentagem: 46.11
  lucro: number;
  lancamentos_no_mes: number;
}

/** O cadastro de insumos como estava num dia. A API só devolve o de agora; o
 *  histórico é construído pelo radar, guardando um retrato por rodada — é o
 *  que permite saber QUANDO um preço mudou, já que nota fiscal entra sem
 *  cadência nenhuma. */
export interface RetratoPreco {
  data: DataISO;
  insumos: Insumo[];
}

export interface DadosFlow {
  clienteId: string;
  lancamentos: Lancamento[];
  insumos: Insumo[];
  resumo?: ResumoFlow;
  /** Retratos anteriores do cadastro de preços, quando a fonte souber deles.
   *  A API não sabe — quem guarda é o nosso banco. */
  retratosPreco?: RetratoPreco[];
  endpointsOk: string[];
  endpointsErro: string[];
}
