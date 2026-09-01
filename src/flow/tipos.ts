/**
 * O que o Flow guarda.
 *
 * Duas versões deste arquivo foram escritas contra a API de integração
 * (`/v1/lancamentos`, `/v1/produtos`, `/v1/resumo`). A terceira é escrita
 * contra o BANCO — `organizacoes.dados`, o JSONB onde o Flow guarda o
 * restaurante inteiro. Conferido contra o dump real das 36 organizações em
 * 27/08/2026, não contra documentação.
 *
 * A troca vale a pena por dois motivos, e o segundo é maior que o primeiro:
 *
 *  1. Uma consulta devolve a carteira toda. Não há token por cliente, e um
 *     restaurante novo entra sozinho na rodada seguinte.
 *
 *  2. **O banco tem o que a API não tinha.** O lançamento de CMV guarda
 *     `qtd`, `uni`, `insumoId` e `nfe`. Enquanto o radar lia a API, "sem
 *     quantidade na nota não dá para separar preço de volume" era uma
 *     limitação de projeto — está escrito assim em `precos.ts`. Não é mais:
 *     em 1.804 lançamentos da carteira a quantidade está lá.
 *
 * O custo: passamos a depender do formato interno do Flow em vez do contrato
 * da API. Por isso `organizacao.ts` confere a estrutura e reclama, em vez de
 * produzir número errado em silêncio.
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

  // --- o que só o banco tem ---

  /** Liga o lançamento ao cadastro de insumo. Presente em 2.533 dos 6.631
   *  lançamentos da carteira. Quando existe, o produto comprado é conhecido
   *  com certeza — não é preciso adivinhar pelo texto da `descricao`. */
  insumoId?: string;
  /** Quantidade comprada, na unidade `uni`. **É este campo que torna possível
   *  separar preço de volume**: `valor / qtd` é o preço unitário pago naquela
   *  compra. Sem ele, um lançamento maior tanto pode ser preço em alta quanto
   *  compra em dobro. */
  qtd?: number;
  uni?: string;
  /** Número da nota fiscal, quando a compra entrou por importação de NF-e. */
  nfe?: string;
  fornecedor?: string;
  /** O lançamento veio de importação (extrato, NF-e) e não da digitação. */
  importado?: boolean;
}

export interface Insumo {
  id: string;
  nome: string;
  categoria: string;
  subcategoria?: string;
  /** **Preço por unidade de medida** — R$ por quilo, por litro, por unidade.
   *
   *  Atenção: o Flow NÃO guarda esse número. Ele guarda o preço da EMBALAGEM
   *  (`precoEmbalagem`) e quanto ela contém (`qtdEmbalagem`); o unitário é a
   *  divisão dos dois, e é o que o próprio Flow mostra na coluna "custo por
   *  unidade". O radar faz essa conta no mapeamento, para que nada aqui dentro
   *  precise lembrar dela.
   *
   *  Por que importa: 1.602 dos 3.903 insumos da carteira têm embalagem
   *  diferente de 1. Comparar preço de embalagem entre dois dias mistura
   *  "ficou mais caro" com "comprou pacote maior" — o alho-poró do Soffri
   *  aparecia subindo 124% quando o que mudou foi o tamanho da compra.
   *
   *  Ausente ou zerado em insumo `preparado`, onde é normal: o custo sai da
   *  ficha (`comps`), não de compra. Um `pronto` sem preço é falha de cadastro
   *  de verdade — e são 808 na carteira. */
  preco?: number;
  /** O preço da embalagem, como o Flow guarda. Fica para conferência: é ele
   *  que o cliente vê na nota. */
  precoEmbalagem?: number;
  /** Quanto a embalagem contém, na unidade `unidade`. R$ 7,77 o óleo de
   *  0,900 L dá R$ 8,63 por litro. */
  qtdEmbalagem?: number;
  unidade: string;
  fornecedor?: string;

  // --- o que só o banco tem ---

  /** `pronto` é comprado; `preparado` é produzido na casa a partir de outros
   *  insumos. A distinção importa para não acusar cadastro incompleto onde
   *  não há. */
  tipo?: 'pronto' | 'preparado' | (string & {});
  /** Composição de um preparado: `[insumoId, quantidade, unidade?]`. */
  comps?: Array<[string, number, string?]>;
  /** Quanto o preparado rende, na unidade dele. */
  rendimento?: number;
  estoqueAtual?: number;
  estoqueMin?: number;
  /** O grupo financeiro do insumo (CMV, Materiais...). Fica vazio em 1.376
   *  dos 3.903 — não dá para usar como filtro confiável. */
  grupo?: string;
}

/** Ficha técnica de um item de venda. `comps` é `[insumoId, qtd, unidade?]`. */
export interface Ficha {
  id: string;
  nome: string;
  cat: string;
  comps: Array<[string, number, string?]>;
  precoVenda: number;
  precoIfood?: number;
  /** Quanto o cliente diz que vende por mês. É digitado, não medido. */
  vendasMes?: number;
  porcoes?: number;
  rendGramas?: number;
  rendUni?: string;
  custoEmbalagem?: number;
}

/** Uma contagem de estoque fechada: estoque inicial, compras, estoque final e
 *  vendas do período. É o que permite CMV **real** (consumo), em vez de CMV
 *  por compras. Raro: 44 registros na carteira inteira, 22 deles num cliente
 *  só. Serve para um cliente hoje, não para a carteira. */
export interface CmvRegistro {
  id: string;
  data: DataISO;
  ei: number;
  ef: number;
  compras: number;
  vendas: number;
}

export interface Desperdicio {
  id: string;
  data: DataISO;
  nome: string;
  tipo: string;
  refId: string;
  motivo: string;
  acao: string;
  qtd?: number;
  unidade?: string;
  custoUnit: number;
  custoTotal: number;
  responsavel?: string;
}

/** O cadastro de insumos como estava num dia. O banco só guarda o de agora; o
 *  histórico é construído pelo radar, guardando um retrato por rodada.
 *
 *  Continua valendo para o preço de CADASTRO. O preço PAGO por compra, agora
 *  que `qtd` existe, não depende de retrato nenhum — sai do próprio
 *  lançamento, já datado. */
export interface RetratoPreco {
  data: DataISO;
  insumos: Insumo[];
}

export interface DadosFlow {
  clienteId: string;
  lancamentos: Lancamento[];
  insumos: Insumo[];
  /** Metas que o próprio Flow guarda. Hoje só o alvo de CMV (`cmvAlvo`), em
   *  fração: 0,30. Dos 28 clientes reais, 27 estão no padrão de 30% e um em
   *  38%. Não inventar meta que o Flow não tem. */
  cmvAlvo?: number;
  fichas?: Ficha[];
  cmvRegistros?: CmvRegistro[];
  desperdicios?: Desperdicio[];
  /** Retratos anteriores do cadastro de preços, quando a fonte souber deles. */
  retratosPreco?: RetratoPreco[];
  /** O que foi lido e o que falhou. Mantém o nome de quando as fontes eram
   *  endpoints HTTP; hoje uma "fonte" é uma chave do JSON da organização. */
  endpointsOk: string[];
  endpointsErro: string[];
}
