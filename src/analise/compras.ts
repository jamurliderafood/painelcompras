/**
 * Produtos que mudaram de compra.
 *
 * No Flow, o nome do produto comprado vive no campo `descricao` do lançamento
 * de CMV — "Tomate", "Coxão Mole", "Rúcula". Não há cadastro ligando lançamento
 * a produto, então agrupar por esse texto é o que existe.
 *
 * E texto digitado à mão traz dois problemas, os dois vistos no dado real do
 * Soffri Grill:
 *
 *  1. O MESMO produto aparece escrito de jeitos diferentes entre períodos.
 *     "ancho / contra filé 33,605 kg" em julho virou "contra file" em agosto —
 *     o peso saiu do nome e o acento também. Sem normalizar, o painel anuncia
 *     um produto novo de R$ 2.242 e a some de outro de R$ 1.495, quando é a
 *     mesma carne.
 *
 *  2. Mudou a granularidade. Em julho lançavam "Mercado" (R$ 8.075 num nome
 *     só); em agosto passaram a detalhar item a item. Aí não existe
 *     comparação possível, e a única resposta honesta é dizer isso em vez de
 *     rankear.
 *
 * A normalização resolve o primeiro. Para o segundo, o módulo devolve uma
 * suspeita, e quem chama decide não mostrar o ranking.
 */

import type { DataISO, Lancamento } from '../flow/tipos';
import { recortar, type Janela } from './janela';

export interface VariacaoCompra {
  produto: string;
  antes: number;
  agora: number;
  variacaoReais: number;
  /** `undefined` quando não havia compra antes — não existe percentual a
   *  partir de zero, e inventar "+∞%" só polui o painel. */
  variacaoPct?: number;
  situacao: 'novo' | 'sumiu' | 'variou';
  /** Quantas grafias diferentes foram agrupadas neste produto. Mais de uma é
   *  sinal de cadastro solto — útil para quem for arrumar o lançamento. */
  grafias: number;
}

export interface ResultadoCompras {
  altas: VariacaoCompra[];
  quedas: VariacaoCompra[];
  /** Quando verdadeiro, a lista acima não deve ser apresentada como conclusão:
   *  o cliente mudou o jeito de nomear ou de agrupar as compras. */
  suspeitaDeRenomeacao: boolean;
  explicacaoDaSuspeita?: string;
}

/** Tira acento, caixa, pontuação solta e o peso/quantidade que às vezes vem
 *  colado no nome. É o suficiente para "Ancho / Contra Filé 33,605 Kg" e
 *  "ancho / contra file" caírem no mesmo balde. */
export function normalizarProduto(nome: string): string {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\d+[.,]?\d*\s*(kg|kgs|g|gr|un|und|unid|l|lt|ml|cx|pct|fardo|pc|pcs)\b/g, '')
    .replace(/\b\d+[.,]?\d*\b/g, '')
    .replace(/[^a-z\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface OpcoesCompras {
  grupo?: string;
  /** Variação menor que isto em reais não vira linha no painel. */
  pisoReais?: number;
  limite?: number;
}

export function variacoesDeCompra(
  lancamentos: Lancamento[],
  antes: Janela,
  agora: Janela,
  opts: OpcoesCompras = {},
): ResultadoCompras {
  const grupo = opts.grupo ?? 'CMV';
  const piso = opts.pisoReais ?? 150;
  const limite = opts.limite ?? 8;

  const somar = (janela: Janela) => {
    const total = new Map<string, { valor: number; grafias: Set<string>; rotulo: string }>();
    for (const l of recortar(lancamentos, janela)) {
      if (l.grupo !== grupo) continue;
      const bruto = (l.descricao ?? '').trim();
      if (!bruto) continue;
      const chave = normalizarProduto(bruto);
      if (!chave) continue;
      const acc = total.get(chave) ?? { valor: 0, grafias: new Set<string>(), rotulo: bruto };
      acc.valor += l.valor;
      acc.grafias.add(bruto);
      total.set(chave, acc);
    }
    return total;
  };

  const a = somar(antes);
  const b = somar(agora);

  const linhas: VariacaoCompra[] = [];
  for (const chave of new Set([...a.keys(), ...b.keys()])) {
    const antesV = a.get(chave)?.valor ?? 0;
    const agoraV = b.get(chave)?.valor ?? 0;
    const grafias = new Set([...(a.get(chave)?.grafias ?? []), ...(b.get(chave)?.grafias ?? [])]);
    linhas.push({
      produto: b.get(chave)?.rotulo ?? a.get(chave)!.rotulo,
      antes: antesV,
      agora: agoraV,
      variacaoReais: agoraV - antesV,
      variacaoPct: antesV > 0 ? (agoraV - antesV) / antesV : undefined,
      situacao: antesV === 0 ? 'novo' : agoraV === 0 ? 'sumiu' : 'variou',
      grafias: grafias.size,
    });
  }

  const relevantes = linhas.filter((x) => Math.abs(x.variacaoReais) >= piso);
  const altas = relevantes.filter((x) => x.variacaoReais > 0)
    .sort((x, y) => y.variacaoReais - x.variacaoReais).slice(0, limite);
  const quedas = relevantes.filter((x) => x.variacaoReais < 0)
    .sort((x, y) => x.variacaoReais - y.variacaoReais).slice(0, limite);

  // A suspeita: muito dinheiro em produtos que sumiram E muito dinheiro em
  // produtos que nasceram, ao mesmo tempo. Compra normal não faz isso — quem
  // faz é mudança de nomenclatura ou de granularidade do lançamento.
  const totalAntes = [...a.values()].reduce((s, x) => s + x.valor, 0);
  const sumido = linhas.filter((x) => x.situacao === 'sumiu').reduce((s, x) => s + x.antes, 0);
  const nascido = linhas.filter((x) => x.situacao === 'novo').reduce((s, x) => s + x.agora, 0);

  const suspeita = totalAntes > 0 && sumido >= totalAntes * 0.25 && nascido >= totalAntes * 0.25;
  const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return {
    altas,
    quedas,
    suspeitaDeRenomeacao: suspeita,
    explicacaoDaSuspeita: suspeita
      ? `${reais(sumido)} em produtos que deixaram de aparecer e ${reais(nascido)} em ` +
        `produtos que apareceram do nada, no mesmo período. Isso não é compra mudando — ` +
        `é o jeito de escrever ou de agrupar o lançamento que mudou. A comparação por ` +
        `produto só volta a valer quando os dois períodos usarem o mesmo padrão.`
      : undefined,
  };
}
