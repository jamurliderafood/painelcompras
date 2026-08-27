/**
 * Preço de insumo muda por evento, não por mês.
 *
 * A nota entra quando o cliente compra — semanal, quinzenal, quando der. Não
 * existe cadência, e amarrar isso a uma janela mensal esconde o que interessa:
 * o dia em que o preço mudou.
 *
 * Duas fontes possíveis, e só uma serve:
 *
 *   ✗ o valor do lançamento de CMV. É GASTO, não preço — no Soffri, o tomate
 *     vai de R$ 40,99 a R$ 28,52 a R$ 49,62 em dez dias, e isso é quantos
 *     quilos compraram naquele dia, não quanto custa o quilo. Sem quantidade na
 *     nota, comparar lançamento com lançamento produz alarme falso constante.
 *
 *   ✓ o campo `preco` do cadastro de insumo (`GET /v1/produtos`). Esse é
 *     unitário e é ele que se atualiza quando entra nota nova.
 *
 * O problema do segundo: a API devolve só o valor de agora, sem histórico. A
 * solução é o radar guardar um retrato do cadastro a cada rodada e comparar
 * retrato com retrato. Cada mudança vira um evento datado, e a análise passa a
 * ser "o que mudou de preço desde a última vez", sem janela nenhuma.
 *
 * Consequência honesta: isso só produz resultado a partir da SEGUNDA coleta.
 * Antes disso não há com o que comparar, e o painel diz exatamente isso em vez
 * de mostrar uma lista vazia com cara de "está tudo estável".
 */

import type { DataISO, RetratoPreco } from '../flow/tipos';

export type { RetratoPreco };

export interface MudancaPreco {
  insumoId: string;
  nome: string;
  unidade: string;
  fornecedor?: string;
  categoria?: string;
  de: number;
  para: number;
  variacao: number;
  /** Retrato em que a mudança apareceu. O preço mudou em algum momento entre
   *  este retrato e o anterior — com coleta diária, é o dia. */
  detectadaEm: DataISO;
  /** Desde quando o preço anterior estava valendo, até onde nosso histórico
   *  alcança. */
  vigenteDesde?: DataISO;
  diasNoPrecoAnterior?: number;
  /** A embalagem mudou junto (de 'kg' para 'un', por exemplo). Quando isso
   *  acontece, a porcentagem não quer dizer nada: R$ 45 o pacote de 6 não é
   *  comparável com R$ 9 a unidade. */
  unidadeMudou?: boolean;
}

const dias = (a: DataISO, b: DataISO) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Todas as mudanças de preço entre retratos consecutivos.
 *
 * Insumo que aparece pela primeira vez não gera evento — cadastro novo não é
 * aumento. Insumo que some também não: pode ter sido desativado, e anunciar
 * "queda de 100%" seria mentira.
 */
export function mudancasDePreco(
  retratos: RetratoPreco[],
  desde?: DataISO,
): MudancaPreco[] {
  const ordenados = [...retratos].sort((a, b) => a.data.localeCompare(b.data));
  if (ordenados.length < 2) return [];

  // Desde quando cada preço está valendo, para saber há quanto tempo o insumo
  // não mudava — um item que ficou dois meses no mesmo preço e subiu 20% é
  // notícia diferente de um que oscila toda semana.
  const vigenteDesde = new Map<string, DataISO>();
  const mudancas: MudancaPreco[] = [];

  for (let i = 1; i < ordenados.length; i++) {
    const anterior = new Map(ordenados[i - 1].insumos.map((x) => [x.id, x]));
    const atual = ordenados[i];

    for (const insumo of atual.insumos) {
      const antes = anterior.get(insumo.id);
      if (!antes) continue;                       // cadastro novo
      if (antes.preco === undefined || insumo.preco === undefined) continue;

      // A embalagem mudar sozinha também é mudança: R$ 45 o pacote de 6 virar
      // R$ 45 a unidade é uma alta de 500% por unidade, com o mesmo número na
      // tela. Vira evento, marcado, sem porcentagem.
      const unidadeMudou = antes.unidade !== insumo.unidade;
      if (antes.preco === insumo.preco && !unidadeMudou) continue;
      if (antes.preco === 0) continue;            // não há percentual a partir de zero

      const inicio = vigenteDesde.get(insumo.id) ?? ordenados[0].data;
      mudancas.push({
        insumoId: insumo.id,
        nome: insumo.nome,
        unidade: insumo.unidade,
        fornecedor: insumo.fornecedor,
        categoria: insumo.subcategoria ?? insumo.categoria,
        de: antes.preco,
        para: insumo.preco,
        variacao: (insumo.preco - antes.preco) / antes.preco,
        detectadaEm: atual.data,
        vigenteDesde: inicio,
        diasNoPrecoAnterior: dias(inicio, atual.data),
        unidadeMudou,
      });
      vigenteDesde.set(insumo.id, atual.data);
    }
  }

  return mudancas
    .filter((m) => !desde || m.detectadaEm >= desde)
    .sort((a, b) => b.detectadaEm.localeCompare(a.detectadaEm) || Math.abs(b.variacao) - Math.abs(a.variacao));
}

export interface ResumoPrecos {
  /** Quantos retratos existem. Com menos de dois não há o que comparar. */
  retratos: number;
  primeiroRetrato?: DataISO;
  ultimoRetrato?: DataISO;
  altas: MudancaPreco[];
  quedas: MudancaPreco[];
  /** Mudanças em que a embalagem mudou junto — a porcentagem não vale. */
  suspeitas: MudancaPreco[];
}

/** As mudanças dos últimos `janelaDias` dias, separadas por direção.
 *
 *  A janela aqui existe só para o painel não crescer sem fim; ela não define a
 *  análise. Um preço que mudou há 40 dias e não mudou mais continua sendo o
 *  preço vigente, e aparece no histórico do insumo. */
export function resumirPrecos(
  retratos: RetratoPreco[],
  ate: DataISO,
  janelaDias = 30,
  pisoVariacao = 0.03,
): ResumoPrecos {
  const ordenados = [...retratos].sort((a, b) => a.data.localeCompare(b.data));
  const desde = new Date(Date.parse(ate) - janelaDias * 86_400_000).toISOString().slice(0, 10);
  const todas = mudancasDePreco(ordenados, desde).filter((m) => m.detectadaEm <= ate);

  // Mudança de embalagem passa por cima do piso: ela pode vir com variação
  // zero de preço e ainda assim ser a maior mudança de custo do mês.
  const relevantes = todas.filter((m) => m.unidadeMudou || Math.abs(m.variacao) >= pisoVariacao);

  return {
    retratos: ordenados.length,
    primeiroRetrato: ordenados[0]?.data,
    ultimoRetrato: ordenados[ordenados.length - 1]?.data,
    altas: relevantes.filter((m) => !m.unidadeMudou && m.variacao > 0),
    quedas: relevantes.filter((m) => !m.unidadeMudou && m.variacao < 0),
    suspeitas: relevantes.filter((m) => m.unidadeMudou),
  };
}

/** A linha do tempo de um insumo, para a página do cliente. */
export function historicoDoInsumo(
  retratos: RetratoPreco[],
  insumoId: string,
): Array<{ data: DataISO; preco: number }> {
  const saida: Array<{ data: DataISO; preco: number }> = [];
  let ultimo: number | undefined;

  for (const r of [...retratos].sort((a, b) => a.data.localeCompare(b.data))) {
    const insumo = r.insumos.find((x) => x.id === insumoId);
    if (!insumo || insumo.preco === undefined) continue;
    if (insumo.preco !== ultimo) {
      saida.push({ data: r.data, preco: insumo.preco });
      ultimo = insumo.preco;
    }
  }
  return saida;
}
