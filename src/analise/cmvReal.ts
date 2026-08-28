/**
 * O CMV de verdade: o que foi consumido, não o que foi comprado.
 *
 *   consumo = estoque inicial + compras − estoque final
 *   CMV     = consumo / vendas
 *
 * O radar mostrava, até aqui, **CMV por compras** — a soma dos lançamentos do
 * grupo CMV dividida pelo faturamento. É o que dá para calcular sempre, mas
 * mede compra, não consumo: num mês em que a casa compra para o mês seguinte,
 * estoura sem nada ter piorado.
 *
 * O tamanho do engano, medido no Restaurante JK (o único cliente com massa de
 * contagem — 22 delas):
 *
 *   mês       por compras    real
 *   2026-06        45,9%     45,4%
 *   2026-07        44,7%     46,8%
 *   2026-08        58,5%     45,0%   ← 13,5 pontos de diferença
 *
 * Nos meses em que a compra acompanha o consumo os dois coincidem. Em agosto o
 * JK comprou muito mais do que gastou, e o painel anunciava 58,5% quando a
 * contagem do próprio cliente dizia 45%. O diagnóstico "o CMV do JK está muito
 * acima da meta" continua de pé — 45% contra 30% —, mas 58,5% era exagero, e
 * exagero num painel custa credibilidade na reunião.
 *
 * **Qual contagem vale: a última lançada.** Foi a instrução do Jamur, e é a
 * certa — cada contagem já fecha um período (EI, compras, EF e vendas daquele
 * intervalo), então somar várias não melhora nada, e a mais recente é a que
 * descreve como a casa está agora.
 */

import type { CmvRegistro, DataISO } from '../flow/tipos';

export interface CmvApurado {
  /** Fração: 0,45 = 45%. */
  valor: number;
  data: DataISO;
  consumo: number;
  vendas: number;
  estoqueInicial: number;
  compras: number;
  estoqueFinal: number;
}

/**
 * Uma contagem só serve quando tem vendas.
 *
 * Três clientes da carteira (Casa da Nonna, King Restaurante, Montello) têm um
 * "registro" com estoque final preenchido e todo o resto zerado: é o inventário
 * de abertura, o retrato de quanto havia no dia em que começaram a contar. Não
 * é medição de CMV, e dividir por vendas zero produziria `Infinity` — um número
 * que atravessaria o painel inteiro sem ninguém notar de onde veio.
 */
export function contagemServe(r: CmvRegistro): boolean {
  return r.vendas > 0;
}

function apurar(r: CmvRegistro): CmvApurado {
  const consumo = r.ei + r.compras - r.ef;
  return {
    valor: consumo / r.vendas,
    data: r.data,
    consumo,
    vendas: r.vendas,
    estoqueInicial: r.ei,
    compras: r.compras,
    estoqueFinal: r.ef,
  };
}

/** A última contagem utilizável até `ate` — a que descreve como a casa está. */
export function cmvRealDoUltimo(
  registros: CmvRegistro[] = [],
  ate?: DataISO,
): CmvApurado | undefined {
  const uteis = registros
    .filter(contagemServe)
    .filter((r) => !ate || r.data <= ate)
    .sort((a, b) => a.data.localeCompare(b.data));
  const ultimo = uteis[uteis.length - 1];
  return ultimo ? apurar(ultimo) : undefined;
}

/** A contagem anterior à última, para dizer se melhorou ou piorou. Comparação
 *  entre contagens é a única honesta aqui: contagem contra "CMV por compras do
 *  mês passado" seria comparar duas coisas diferentes e chamar de variação. */
export function cmvRealAnterior(
  registros: CmvRegistro[] = [],
  ate?: DataISO,
): CmvApurado | undefined {
  const uteis = registros
    .filter(contagemServe)
    .filter((r) => !ate || r.data <= ate)
    .sort((a, b) => a.data.localeCompare(b.data));
  const penultimo = uteis[uteis.length - 2];
  return penultimo ? apurar(penultimo) : undefined;
}

/** Há quantos dias a contagem foi feita. Uma contagem de três meses atrás
 *  descreve uma casa que talvez não exista mais. */
export function idadeEmDias(c: CmvApurado, hoje: DataISO): number {
  return Math.round((Date.parse(hoje) - Date.parse(c.data)) / 86_400_000);
}
