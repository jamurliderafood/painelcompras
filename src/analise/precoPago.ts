/**
 * O preço que o cliente PAGOU, por compra.
 *
 * Este módulo não existia porque não podia existir. Enquanto o radar lia a API
 * do Flow, o lançamento de compra trazia só o valor, e está escrito em
 * `precos.ts`: *"sem quantidade na nota, comparar lançamento com lançamento
 * produz alarme falso constante"* — o tomate do Soffri ia de R$ 40,99 a
 * R$ 28,52 a R$ 49,62 em dez dias, e isso era quantos quilos compraram.
 *
 * O banco tem `qtd`. Então `valor / qtd` é o preço unitário daquela compra,
 * naquele dia, com a nota e o fornecedor do lado. E aí dá para separar o que
 * era impossível separar: **gastar mais por estar caro é diferente de gastar
 * mais por ter comprado mais.**
 *
 * Irmão de `precos.ts`, não substituto. Aquele compara o CADASTRO entre dois
 * retratos nossos e responde "o preço de tabela mudou". Este lê a COMPRA e
 * responde "pagamos mais caro". Quando os dois discordam, o cadastro está
 * desatualizado — e isso também é um achado.
 *
 * ---
 *
 * **A trava que este módulo precisa ter, e por quê.**
 *
 * Medido nas 225 séries de preço da carteira em 27/08/2026:
 *
 *   unidade de peso/volume (kg, g, L, ml) — 75 séries, NENHUMA com variação
 *   acima de 100%, mediana de 4%. Limão R$ 5,99 → R$ 10,90 o quilo, alcatra
 *   R$ 56,90 → R$ 82,90. É preço de verdade.
 *
 *   unidade `un` (ou em branco) — 87 séries, e todo extremo é embalagem:
 *   "Água Mineral s/ Gás, R$ 1,59 → R$ 13,00 (+718%)" é a garrafa contra o
 *   fardo; "Arroz, R$ 5,18 → R$ 28,90 (+458%)" é a unidade contra o pacote de
 *   cinco quilos. A unidade não mudou de rótulo — `un` é o rótulo dos dois.
 *
 * Um quilo é sempre um quilo. Uma "unidade" é o que o fornecedor quiser. Por
 * isso o alerta de preço só sai em peso e volume; em `un`, o módulo calcula,
 * marca como não confiável e deixa fora do painel.
 */

import type { DataISO, Insumo, Lancamento } from '../flow/tipos';
import { inicioConfiavel } from './qualidade';

/** Unidades em que a quantidade quer dizer a mesma coisa em toda nota. */
const UNIDADES_DE_MEDIDA = new Set(['kg', 'g', 'l', 'lt', 'ml']);

export interface CompraDatada {
  data: DataISO;
  precoUnitario: number;
  qtd: number;
  valor: number;
  unidade: string;
  nfe?: string;
  fornecedor?: string;
}

export interface PrecoPago {
  insumoId: string;
  nome: string;
  unidade: string;
  /** Todas as compras do insumo na janela, da mais antiga para a mais nova. */
  compras: CompraDatada[];
  de: number;
  para: number;
  variacao: number;
  primeiraEm: DataISO;
  ultimaEm: DataISO;
  /** Quanto a diferença de preço custou no volume comprado na última compra —
   *  o número que se fala ao telefone. */
  custoDaAlta: number;
  /** Verdadeiro só em unidade de peso ou volume. Em `un` a porcentagem mistura
   *  preço com tamanho de embalagem e não deve virar alerta. */
  confiavel: boolean;
  /** A unidade mudou entre as compras (de 'kg' para 'un'). Aí nem o valor
   *  absoluto é comparável. */
  unidadeMudou: boolean;
  fornecedores: string[];
}

export interface OpcoesPreco {
  /** Variação menor que isto não vira linha. Compra de hortifruti oscila
   *  alguns por cento toda semana e não é notícia. */
  pisoVariacao?: number;
  /** Ignora série cujo gasto na janela é irrelevante — 3% num insumo de R$ 40
   *  no mês não muda decisão nenhuma. */
  pisoGastoReais?: number;
  limite?: number;
}

/** Só compra: grupo CMV, com insumo identificado e quantidade positiva. */
export function comprasComQuantidade(lancamentos: Lancamento[]): Lancamento[] {
  return lancamentos.filter(
    (l) => l.grupo === 'CMV' && l.insumoId && l.qtd && l.qtd > 0 && l.valor > 0,
  );
}

const normalizarUnidade = (u?: string) => (u ?? '').trim().toLowerCase();

/**
 * As séries de preço pago, uma por insumo.
 *
 * Insumo comprado uma vez só não entra: não há variação a medir, e o painel
 * ficaria cheio de linha sem informação.
 */
export function seriesDePreco(
  lancamentos: Lancamento[],
  insumos: Insumo[],
): PrecoPago[] {
  const nomeDe = new Map(insumos.map((i) => [i.id, i.nome]));
  const porInsumo = new Map<string, CompraDatada[]>();

  for (const l of comprasComQuantidade(lancamentos)) {
    const lista = porInsumo.get(l.insumoId!) ?? [];
    lista.push({
      data: l.data,
      precoUnitario: l.valor / l.qtd!,
      qtd: l.qtd!,
      valor: l.valor,
      unidade: normalizarUnidade(l.uni),
      nfe: l.nfe,
      fornecedor: l.fornecedor,
    });
    porInsumo.set(l.insumoId!, lista);
  }

  const saida: PrecoPago[] = [];

  for (const [insumoId, compras] of porInsumo) {
    compras.sort((a, b) => a.data.localeCompare(b.data));
    // Duas compras no mesmo dia são a mesma nota partida em itens — não são
    // dois preços, e tratá-las como série produziria variação de um dia.
    const datas = new Set(compras.map((c) => c.data));
    if (datas.size < 2) continue;

    const primeira = compras[0];
    const ultima = compras[compras.length - 1];
    if (primeira.precoUnitario <= 0) continue;

    const unidades = new Set(compras.map((c) => c.unidade));
    const unidadeMudou = unidades.size > 1;
    const unidade = primeira.unidade;

    saida.push({
      insumoId,
      nome: nomeDe.get(insumoId) ?? insumoId,
      unidade,
      compras,
      de: primeira.precoUnitario,
      para: ultima.precoUnitario,
      variacao: (ultima.precoUnitario - primeira.precoUnitario) / primeira.precoUnitario,
      primeiraEm: primeira.data,
      ultimaEm: ultima.data,
      custoDaAlta: (ultima.precoUnitario - primeira.precoUnitario) * ultima.qtd,
      confiavel: !unidadeMudou && UNIDADES_DE_MEDIDA.has(unidade),
      unidadeMudou,
      fornecedores: [...new Set(compras.map((c) => c.fornecedor).filter((f): f is string => !!f))],
    });
  }

  return saida;
}

export interface ResumoPrecoPago {
  altas: PrecoPago[];
  quedas: PrecoPago[];
  /** Séries que existem mas não viram alerta porque a unidade não permite —
   *  contadas, não escondidas: quem for arrumar o cadastro precisa saber o
   *  tamanho do problema. */
  ignoradasPorUnidade: number;
  /** Compras sem `qtd`: o Flow permite lançar só o valor. Quanto maior este
   *  número, menos o cliente aparece nesta análise — e é uma conversa a ter
   *  com ele, não um defeito do radar. */
  comprasSemQuantidade: number;
  comprasTotal: number;
}

export function resumirPrecoPago(
  lancamentos: Lancamento[],
  insumos: Insumo[],
  opcoes: OpcoesPreco = {},
): ResumoPrecoPago {
  const { pisoVariacao = 0.1, pisoGastoReais = 100, limite = 8 } = opcoes;

  const series = seriesDePreco(lancamentos, insumos);
  const confiaveis = series.filter((s) => s.confiavel);

  const relevante = (s: PrecoPago) =>
    Math.abs(s.variacao) >= pisoVariacao &&
    s.compras.reduce((t, c) => t + c.valor, 0) >= pisoGastoReais;

  const dignas = confiaveis.filter(relevante);

  const compras = lancamentos.filter((l) => l.grupo === 'CMV' && l.valor > 0);

  return {
    altas: dignas
      .filter((s) => s.variacao > 0)
      .sort((a, b) => b.custoDaAlta - a.custoDaAlta)
      .slice(0, limite),
    quedas: dignas
      .filter((s) => s.variacao < 0)
      .sort((a, b) => a.custoDaAlta - b.custoDaAlta)
      .slice(0, limite),
    ignoradasPorUnidade: series.length - confiaveis.length,
    comprasSemQuantidade: compras.filter((l) => !l.qtd || !l.insumoId).length,
    comprasTotal: compras.length,
  };
}

// ---------------------------------------------------------------------------

export interface EfeitoCompra {
  insumoId: string;
  nome: string;
  unidade: string;
  gastoAntes: number;
  gastoAgora: number;
  variacaoGasto: number;
  /** Quanto da diferença de gasto veio do preço ter mudado, com o volume de
   *  hoje. */
  efeitoPreco: number;
  /** Quanto veio de ter comprado mais (ou menos), ao preço de antes. */
  efeitoVolume: number;
  qtdAntes: number;
  qtdAgora: number;
  precoAntes: number;
  precoAgora: number;
  confiavel: boolean;
}

/**
 * Por que o gasto com um produto mudou: preço ou volume.
 *
 * `Δgasto = (p₁ − p₀)·q₁ + (q₁ − q₀)·p₀` — a decomposição de sempre, com o
 * efeito preço avaliado no volume novo e o efeito volume no preço velho. A
 * soma fecha exatamente com a diferença de gasto, sem resíduo para explicar.
 *
 * É a resposta que o consultor precisa levar para a ligação. "Você gastou
 * R$ 1.200 a mais com carne" não diz o que fazer. "R$ 900 é preço, R$ 300 é
 * volume" diz: negocie com o fornecedor. E o contrário — "R$ 1.100 é volume"
 * — manda olhar ficha técnica, porção e desperdício, não o fornecedor.
 *
 * Um insumo comprado só num dos dois períodos fica de fora: não existe efeito
 * preço quando não havia preço, e chamar o gasto inteiro de "volume" seria
 * verdade formal e mentira prática.
 */
export interface ResultadoDecomposicao {
  efeitos: EfeitoCompra[];
  /** Quando existe, a decomposição acima NÃO pode ser apresentada como
   *  conclusão. Vem preenchida, e não como um `boolean`, porque quem lê o
   *  painel precisa da frase — não de um ícone de alerta. */
  ressalva?: string;
}

/**
 * Se o período de base tem menos dias de compra lançada que o atual, "volume"
 * quer dizer "lançou mais dias", não "comprou mais".
 *
 * Medido no dump de 27/08/2026: o King começou a lançar compra em 08/07, a
 * Rota do Sabor em 13/07 e o Matsu em 13/07. Para os três, julho tem cerca de
 * metade dos dias de agosto — e a decomposição, feita sem olhar isso, atribui
 * tudo a volume nos três. É matemática correta em cima de janela mentirosa.
 */
export function ressalvaDeCobertura(
  lancamentos: Lancamento[],
  antes: { inicio: DataISO; fim: DataISO },
  agora: { inicio: DataISO; fim: DataISO },
): string | undefined {
  const diasCom = (j: { inicio: DataISO; fim: DataISO }) =>
    new Set(
      lancamentos
        .filter((l) => l.grupo === 'CMV' && l.data >= j.inicio && l.data <= j.fim)
        .map((l) => l.data),
    );

  const base = diasCom(antes);
  const atual = diasCom(agora);
  if (!base.size || !atual.size) return undefined;

  // O cliente já comprava, SEM INTERRUPÇÃO, antes do período de base? Então uma
  // primeira compra no dia 8 é ritmo de compra, não estreia.
  //
  // A checagem tem de ser sobre uso contínuo, e não sobre "existe algum
  // lançamento anterior": o King tem DOIS lançamentos em abril de 2026 e depois
  // 98 dias sem nada — o uso de verdade começa em 08/07. Perguntando só se há
  // lançamento anterior, aqueles dois abonariam julho como mês normal, quando
  // julho é justamente o mês de estreia.
  const compras = lancamentos.filter((l) => l.grupo === 'CMV').map((l) => l.data);
  const inicioDeUso = inicioConfiavel(compras);
  const jaCompravaAntes = inicioDeUso !== undefined && inicioDeUso < antes.inicio;

  const primeiraDaBase = [...base].sort()[0];
  const atraso = Math.round(
    (Date.parse(primeiraDaBase) - Date.parse(antes.inicio)) / 86_400_000,
  );

  if (!jaCompravaAntes && atraso >= 5) {
    return (
      `A primeira compra lançada em ${antes.inicio.slice(0, 7)} é de ${primeiraDaBase} — ` +
      `${atraso} dias depois do começo do período. O cliente passou a lançar compra no meio ` +
      `do mês, então "comprou mais" aqui quer dizer "lançou mais dias". Não usar esta ` +
      `decomposição para falar de volume.`
    );
  }

  if (base.size < atual.size * 0.7) {
    return (
      `${antes.inicio.slice(0, 7)} tem ${base.size} dias com compra lançada contra ` +
      `${atual.size} em ${agora.inicio.slice(0, 7)}. A diferença de volume pode ser ` +
      `lançamento, não compra.`
    );
  }

  return undefined;
}

export function decomporCompras(
  lancamentos: Lancamento[],
  insumos: Insumo[],
  antes: { inicio: DataISO; fim: DataISO },
  agora: { inicio: DataISO; fim: DataISO },
  opcoes: { pisoReais?: number; limite?: number } = {},
): ResultadoDecomposicao {
  const { pisoReais = 100, limite = 10 } = opcoes;
  const nomeDe = new Map(insumos.map((i) => [i.id, i.nome]));

  const acumular = (janela: { inicio: DataISO; fim: DataISO }) => {
    const m = new Map<string, { valor: number; qtd: number; unidades: Set<string> }>();
    for (const l of comprasComQuantidade(lancamentos)) {
      if (l.data < janela.inicio || l.data > janela.fim) continue;
      const a = m.get(l.insumoId!) ?? { valor: 0, qtd: 0, unidades: new Set<string>() };
      a.valor += l.valor;
      a.qtd += l.qtd!;
      a.unidades.add(normalizarUnidade(l.uni));
      m.set(l.insumoId!, a);
    }
    return m;
  };

  const a0 = acumular(antes);
  const a1 = acumular(agora);
  const saida: EfeitoCompra[] = [];

  for (const [insumoId, novo] of a1) {
    const velho = a0.get(insumoId);
    if (!velho) continue;
    if (velho.qtd <= 0 || novo.qtd <= 0) continue;

    const precoAntes = velho.valor / velho.qtd;
    const precoAgora = novo.valor / novo.qtd;
    const unidades = new Set([...velho.unidades, ...novo.unidades]);
    const unidade = [...novo.unidades][0] ?? '';

    const efeitoPreco = (precoAgora - precoAntes) * novo.qtd;
    const efeitoVolume = (novo.qtd - velho.qtd) * precoAntes;

    if (Math.abs(novo.valor - velho.valor) < pisoReais) continue;

    saida.push({
      insumoId,
      nome: nomeDe.get(insumoId) ?? insumoId,
      unidade,
      gastoAntes: velho.valor,
      gastoAgora: novo.valor,
      variacaoGasto: novo.valor - velho.valor,
      efeitoPreco,
      efeitoVolume,
      qtdAntes: velho.qtd,
      qtdAgora: novo.qtd,
      precoAntes,
      precoAgora,
      // Mesma trava do resto do módulo: em `un`, "preço" mistura embalagem, e
      // a decomposição vira uma conta bonita em cima de nada.
      confiavel: unidades.size === 1 && UNIDADES_DE_MEDIDA.has(unidade),
    });
  }

  return {
    efeitos: saida
      .sort((x, y) => Math.abs(y.variacaoGasto) - Math.abs(x.variacaoGasto))
      .slice(0, limite),
    ressalva: ressalvaDeCobertura(lancamentos, antes, agora),
  };
}
