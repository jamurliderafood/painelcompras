/**
 * Dados de teste com a forma do dado real.
 *
 * Os números e os defeitos vêm da leitura do Soffri Grill em 26/08/2026: o mês
 * corrente com dias faltando, e a subcategoria de compra em bloco que some
 * quando o cliente passa a detalhar. Não é dado do cliente — é a forma dele.
 */

import type { DadosFlow, Insumo, Lancamento } from '../src/flow/tipos';
import type { FonteFlow } from '../src/flow/api';

export class FonteMemoria implements FonteFlow {
  constructor(private lancamentos: Lancamento[], private insumos: Insumo[] = []) {}
  async buscar(clienteId: string): Promise<DadosFlow> {
    return {
      clienteId,
      lancamentos: this.lancamentos,
      insumos: this.insumos,
      endpointsOk: ['memoria'],
      endpointsErro: [],
    };
  }
}

let seq = 0;
export function lanc(
  data: string, grupo: string, valor: number, sub?: string,
): Lancamento {
  return { id: `l${seq++}`, data, grupo, sub, valor };
}

function diasDoMes(ano: number, mes: number, ate: number): string[] {
  return Array.from({ length: ate }, (_, i) =>
    `${ano}-${String(mes).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

export interface OpcoesMes {
  ano?: number;
  mes: number;
  ate: number;
  receitaPorDia: number;
  /** Dias do mês (número) sem lançamento de receita — as lacunas. */
  pularDias?: number[];
  /** Dia da semana em que a casa fecha (0 = domingo). */
  fechaEm?: number;
  /** grupo → total do mês, distribuído em quatro lançamentos. */
  despesas?: Record<string, number>;
  /** Subcategorias do CMV: nome → total do mês. */
  subsCmv?: Record<string, number>;
}

/** Monta um mês inteiro de lançamentos com a forma do Flow. */
export function mes(o: OpcoesMes): Lancamento[] {
  const ano = o.ano ?? 2026;
  const saida: Lancamento[] = [];

  for (const dia of diasDoMes(ano, o.mes, o.ate)) {
    const n = Number(dia.slice(-2));
    if (o.pularDias?.includes(n)) continue;
    if (o.fechaEm !== undefined) {
      const [a, m, d] = dia.split('-').map(Number);
      if (new Date(Date.UTC(a, m - 1, d)).getUTCDay() === o.fechaEm) continue;
    }
    // Duas formas de pagamento por dia, como no Flow real.
    saida.push(lanc(dia, 'Receita', o.receitaPorDia * 0.6, 'PIX'));
    saida.push(lanc(dia, 'Receita', o.receitaPorDia * 0.4, 'Cartão de Crédito'));
  }

  const quatroDias = [5, 11, 18, 24].filter((d) => d <= o.ate)
    .map((d) => `${ano}-${String(o.mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

  for (const [grupo, total] of Object.entries(o.despesas ?? {})) {
    for (const dia of quatroDias) saida.push(lanc(dia, grupo, total / quatroDias.length));
  }

  for (const [sub, total] of Object.entries(o.subsCmv ?? {})) {
    for (const dia of quatroDias) saada(saida, dia, total / quatroDias.length, sub);
  }

  return saida;
}

const saada = (arr: Lancamento[], dia: string, valor: number, sub: string) =>
  arr.push(lanc(dia, 'CMV', valor, sub));

export const insumo = (nome: string, preco?: number): Insumo => ({
  id: `i${seq++}`, nome, categoria: 'CMV', subcategoria: 'Mercearia', preco, unidade: 'un',
});
