/**
 * Por que o indicador mudou — com nome e sobrenome.
 *
 * Substitui a decomposição em preço / mix / quebra que a primeira versão
 * fazia. Aquela exigia ficha técnica e quantidade vendida; o Flow não tem nem
 * uma nem outra, e insistir nela seria inventar número. O que o dado permite é
 * outra coisa, e é honesta:
 *
 *   1. Separar o que mudou no CUSTO do que mudou no FATURAMENTO. Um CMV que
 *      sobe de 30% para 34% porque as vendas caíram é um problema de venda, e
 *      mandar o dono negociar com fornecedor não resolve nada.
 *
 *   2. Dizer QUEM. Categoria, subcategoria, centro de custo e fornecedor estão
 *      em cada lançamento; dá para ordenar por quanto cada um empurrou o
 *      indicador, em reais e em pontos.
 *
 * O que NÃO dá para separar, e o painel não deve fingir que dá: se o
 * fornecedor cobrou mais caro ou se compramos mais quantidade. Os dois
 * aparecem como "gastou mais reais com Fulano". Separar isso exigiria
 * quantidade na nota, que o Flow não guarda.
 */

export interface Ofensor {
  nome: string;
  antes: number;
  agora: number;
  variacaoReais: number;
  /** Quanto este item sozinho empurrou o indicador, em pontos percentuais.
   *  A soma de todos os ofensores é exatamente a variação do indicador. */
  contribuicaoPontos: number;
  /** A parte da contribuição que veio de gastar mais (ou menos) com este item.
   *  É a única parte acionável: dá para negociar com o fornecedor. */
  contribuicaoCusto: number;
  /** A parte que veio do faturamento ter mudado. Some por rateio em todos os
   *  itens quando a venda cai, e não tem nada a ver com o item.
   *
   *  Sem esta separação o ranking dizia coisas assim: "Mercadorias, de
   *  R$ 16.262 para R$ 15.790, maior ofensor com +6,2 pontos" — gastou menos e
   *  aparece como culpado. Está certo na álgebra e é ilegível para quem decide. */
  contribuicaoFaturamento: number;
  situacao: 'novo' | 'sumiu' | 'variou';
}

/**
 * Compara duas fotografias de uma dimensão (categoria, fornecedor, centro de
 * custo) e devolve quem empurrou o indicador, do pior para o melhor.
 *
 * A contribuição de cada item é `agora/fatAgora − antes/fatAntes`. Somando
 * todos, sobra exatamente a variação do indicador — nada fica fora, e um item
 * que surgiu do nada aparece com o peso inteiro dele.
 */
export function decompor(
  antes: Map<string, number>,
  agora: Map<string, number>,
  fatAntes: number,
  fatAgora: number,
): Ofensor[] {
  if (fatAntes <= 0 || fatAgora <= 0) return [];

  const nomes = new Set([...antes.keys(), ...agora.keys()]);
  const saida: Ofensor[] = [];

  for (const nome of nomes) {
    const a = antes.get(nome) ?? 0;
    const b = agora.get(nome) ?? 0;
    if (a === 0 && b === 0) continue;
    saida.push({
      nome,
      antes: a,
      agora: b,
      variacaoReais: b - a,
      contribuicaoPontos: b / fatAgora - a / fatAntes,
      contribuicaoCusto: (b - a) / fatAgora,
      contribuicaoFaturamento: a * (1 / fatAgora - 1 / fatAntes),
      situacao: a === 0 ? 'novo' : b === 0 ? 'sumiu' : 'variou',
    });
  }

  // Ordenado pelo que dá para fazer alguma coisa a respeito. Ordenar pelo peso
  // total colocaria em primeiro lugar itens que não se mexeram, só porque o
  // faturamento caiu embaixo deles.
  return saida.sort((x, y) => y.contribuicaoCusto - x.contribuicaoCusto);
}

export interface Explicacao {
  indicador: string;
  antes: number;              // o percentual anterior
  agora: number;
  variacao: number;           // em pontos
  /** Gastou mais (ou menos) em reais, com o faturamento de agora. */
  efeitoCusto: number;
  /** O faturamento mudou e o denominador junto — o custo nem se mexeu. */
  efeitoFaturamento: number;
  ofensores: Record<string, Ofensor[]>;
  narrativa: string;
}

const pts = (v: number) => {
  const n = Math.abs(v * 100);
  return `${n.toFixed(1).replace('.', ',')} ponto${n >= 2 ? 's' : ''}`;
};
const reais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Explica um indicador que é custo dividido por faturamento (CMV, CMO,
 * impostos).
 *
 *   Δ(C/F) = (C₁−C₀)/F₁  +  C₀·(1/F₁ − 1/F₀)
 *            └ efeito custo ┘  └ efeito faturamento ┘
 *
 * Os dois somam a variação inteira, por identidade algébrica — não é
 * aproximação.
 */
export function explicarIndicador(
  indicador: string,
  custoAntes: number, fatAntes: number,
  custoAgora: number, fatAgora: number,
  dimensoes: Record<string, { antes: Map<string, number>; agora: Map<string, number> }>,
): Explicacao | null {
  if (fatAntes <= 0 || fatAgora <= 0) return null;

  const antes = custoAntes / fatAntes;
  const agora = custoAgora / fatAgora;
  const efeitoCusto = (custoAgora - custoAntes) / fatAgora;
  const efeitoFaturamento = custoAntes * (1 / fatAgora - 1 / fatAntes);

  const ofensores: Record<string, Ofensor[]> = {};
  for (const [dim, { antes: a, agora: b }] of Object.entries(dimensoes)) {
    ofensores[dim] = decompor(a, b, fatAntes, fatAgora)
      .filter((o) => Math.abs(o.contribuicaoCusto) >= 0.0005)
      .slice(0, 8);
  }

  const dec = { indicador, antes, agora, variacao: agora - antes, efeitoCusto, efeitoFaturamento, ofensores };
  return { ...dec, narrativa: narrar(dec, custoAgora - custoAntes, fatAgora - fatAntes) };
}

function narrar(
  d: Omit<Explicacao, 'narrativa'>,
  deltaCusto: number,
  deltaFaturamento: number,
): string {
  const dir = d.variacao > 0 ? 'subiu' : d.variacao < 0 ? 'caiu' : 'não se mexeu';
  const linhas = [
    `${d.indicador} ${dir} de ${(d.antes * 100).toFixed(1).replace('.', ',')}% ` +
      `para ${(d.agora * 100).toFixed(1).replace('.', ',')}%` +
      (d.variacao === 0 ? '.' : ` — ${pts(d.variacao)}.`),
  ];

  // Qual dos dois lados manda. Dizer isso antes dos nomes evita a conversa
  // errada: cobrar o fornecedor quando quem caiu foi a venda.
  const custoManda = Math.abs(d.efeitoCusto) >= Math.abs(d.efeitoFaturamento);
  if (Math.abs(d.efeitoFaturamento) >= 0.001) {
    linhas.push(
      custoManda
        ? `A maior parte veio do gasto (${pts(d.efeitoCusto)}, ${reais(deltaCusto)}); ` +
          `a mudança de faturamento respondeu por ${pts(d.efeitoFaturamento)}.`
        : `Atenção: ${pts(d.efeitoFaturamento)} da variação vieram do FATURAMENTO ` +
          `(${reais(deltaFaturamento)}), não do gasto. O custo em reais mudou ` +
          `${reais(deltaCusto)}. O problema é de venda, não de compra.`,
    );
  } else {
    linhas.push(`Veio do gasto: ${reais(deltaCusto)} de diferença em reais.`);
  }

  for (const [dim, lista] of Object.entries(d.ofensores)) {
    const pior = lista[0];
    if (!pior || pior.contribuicaoCusto <= 0.001) continue;
    const comoMudou =
      pior.situacao === 'novo'
        ? `apareceu agora, com ${reais(pior.agora)}`
        : `foi de ${reais(pior.antes)} para ${reais(pior.agora)}`;
    linhas.push(
      `Por ${dim}, quem mais gastou a mais é ${pior.nome}: ${comoMudou} ` +
      `(${reais(pior.variacaoReais)}, ${pts(pior.contribuicaoCusto)}).`,
    );
  }

  return linhas.join(' ');
}
