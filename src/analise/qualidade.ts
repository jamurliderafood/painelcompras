/**
 * O dado presta?
 *
 * Este arquivo roda ANTES de qualquer análise, e existe por causa de dois
 * enganos que o dado real do Soffri Grill produziu na primeira leitura:
 *
 *  1. Agosto tinha 17 dias com receita lançada onde julho tinha 22. A "queda
 *     de faturamento de 38%" era, em boa parte, lançamento atrasado. Ajustando
 *     por dia efetivamente lançado, a queda é de ~20%.
 *
 *  2. A subcategoria "Entrada de Produtos" caiu de R$ 13.807 para R$ 997
 *     porque pararam de lançar compra em bloco e passaram a detalhar. Toda
 *     subcategoria de proteína e hortifruti "subiu" — o dinheiro mudou de
 *     gaveta. Um ranking de ofensores inocente diria "proteína bovina é o
 *     maior vilão, +4,5 pontos", e o consultor levaria isso para o cliente.
 *
 * Nenhum dos dois é bug de código. São propriedades do dado, e a única defesa
 * é olhar para elas de propósito antes de concluir qualquer coisa.
 */

import type { DataISO, Grupo, Insumo, Lancamento } from '../flow/tipos';
import {
  agregar, diaDaSemana, diasDaJanela, NOME_DIA, recortar, subsDoGrupo, type Janela,
} from './janela';

export type Confianca = 'alta' | 'media' | 'baixa';

export interface Reclassificacao {
  grupo: Grupo;
  sumiram: Array<{ sub: string; antes: number; agora: number }>;
  cresceram: Array<{ sub: string; antes: number; agora: number }>;
  valorMovido: number;
  variacaoDoGrupo: number;
  explicacao: string;
}

export interface Ausencia {
  grupo: Grupo;
  sub: string;
  valorAnterior: number;
}

export interface Diagnostico {
  confianca: Confianca;
  /** Dias com receita lançada ÷ dias em que se esperava lançamento. */
  cobertura: number;
  diasEsperados: number;
  diasComReceita: number;
  lacunas: DataISO[];
  /** Dias da semana em que a casa aparentemente não abre. Não contam como
   *  lacuna — senão todo restaurante que fecha segunda seria acusado de não
   *  lançar. */
  diasFechados: number[];
  reclassificacoes: Reclassificacao[];
  ausencias: Ausencia[];
  insumosSemPreco: number;
  insumosTotal: number;
  lancamentosForaDeFaixa: Lancamento[];
  historicoDesde?: DataISO;
  avisos: string[];
}

/**
 * Descobre em que dias da semana a casa não abre.
 *
 * Olha só os últimos meses, e não o histórico inteiro, por causa do que o dado
 * real do Soffri fez com a primeira versão disto: havia um lançamento solto de
 * 2022 no meio de dados de 2026. O intervalo passou a ter quatro anos, quase
 * nenhum dia tinha receita, e a função concluiu que a casa não abre nenhum dia
 * da semana — o que zerou os "dias esperados" e fez a cobertura sair 0%.
 *
 * Daí as duas defesas: janela recente, e a guarda de sanidade no fim.
 * Restaurante nenhum fecha os sete dias.
 */
export function diasDeFechamento(
  lancamentos: Lancamento[],
  ate?: DataISO,
  diasParaTras = 120,
  limite = 0.2,
): number[] {
  const datas = [...new Set(lancamentos.filter((l) => l.grupo === 'Receita').map((l) => l.data))].sort();
  if (datas.length < 10) return []; // histórico curto demais para afirmar

  const fim = ate ?? datas[datas.length - 1];
  const inicio = new Date(Date.parse(fim) - diasParaTras * 86_400_000).toISOString().slice(0, 10);
  const janela = { inicio: inicio > datas[0] ? inicio : datas[0], fim };

  const comReceita = new Set(datas.filter((d) => d >= janela.inicio && d <= janela.fim));
  const porDiaSemana = new Map<number, { total: number; abertos: number }>();

  for (const d of diasDaJanela(janela)) {
    const dds = diaDaSemana(d);
    const acc = porDiaSemana.get(dds) ?? { total: 0, abertos: 0 };
    acc.total++;
    if (comReceita.has(d)) acc.abertos++;
    porDiaSemana.set(dds, acc);
  }

  const fechados: number[] = [];
  for (const [dds, { total, abertos }] of porDiaSemana) {
    if (total >= 3 && abertos / total <= limite) fechados.push(dds);
  }

  // Se "todo dia é fechado", quem está errado é a detecção, não o restaurante.
  if (fechados.length >= 6) return [];
  return fechados.sort();
}

/**
 * Subcategoria que existia e simplesmente não aparece mais.
 *
 * Diferente de reclassificação: aqui nada cresceu no lugar. As duas leituras
 * possíveis são "parou mesmo de acontecer" e "ainda não foi lançado", e no meio
 * do mês a segunda é a mais provável — foi o que aconteceu com a folha do
 * Soffri, que sumiu inteira em agosto e fez a mão de obra "melhorar" 9,7
 * pontos no dia 26. Anunciar essa melhora seria mentira.
 */
export function detectarAusencias(
  lancamentos: Lancamento[],
  antes: Janela,
  agora: Janela,
  jaReclassificados: Grupo[] = [],
): Ausencia[] {
  const agA = agregar(lancamentos, antes);
  const agB = agregar(lancamentos, agora);
  const saida: Ausencia[] = [];

  for (const grupo of agA.porGrupo.keys()) {
    if (grupo === 'Receita' || jaReclassificados.includes(grupo)) continue;
    const totalA = agA.porGrupo.get(grupo) ?? 0;
    if (totalA <= 0) continue;

    const sA = subsDoGrupo(agA, grupo);
    const sB = subsDoGrupo(agB, grupo);

    for (const [sub, valor] of sA) {
      if (valor < totalA * 0.05) continue;
      if ((sB.get(sub) ?? 0) > 0) continue;
      saida.push({ grupo, sub, valorAnterior: valor });
    }
  }

  return saida.sort((a, b) => b.valorAnterior - a.valorAnterior);
}

/**
 * Detecta dinheiro que mudou de gaveta.
 *
 * O padrão é: uma subcategoria pesada praticamente zera, várias outras do mesmo
 * grupo crescem, e o total do grupo mal se move. Quando isso acontece, o
 * ranking de ofensores daquele grupo não vale — e o painel tem de dizer isso em
 * vez de apontar um culpado inventado.
 */
export function detectarReclassificacao(
  lancamentos: Lancamento[],
  antes: Janela,
  agora: Janela,
): Reclassificacao[] {
  const agA = agregar(lancamentos, antes);
  const agB = agregar(lancamentos, agora);
  const saida: Reclassificacao[] = [];

  for (const grupo of new Set([...agA.porGrupo.keys(), ...agB.porGrupo.keys()])) {
    if (grupo === 'Receita') continue;

    const sA = subsDoGrupo(agA, grupo);
    const sB = subsDoGrupo(agB, grupo);
    const totalA = agA.porGrupo.get(grupo) ?? 0;
    const totalB = agB.porGrupo.get(grupo) ?? 0;
    if (totalA <= 0) continue;

    const sumiram: Reclassificacao['sumiram'] = [];
    const cresceram: Reclassificacao['cresceram'] = [];

    for (const sub of new Set([...sA.keys(), ...sB.keys()])) {
      const a = sA.get(sub) ?? 0;
      const b = sB.get(sub) ?? 0;
      // Sumiu: pesava ao menos 10% do grupo e perdeu ao menos 80% do valor.
      if (a >= totalA * 0.1 && b <= a * 0.2) sumiram.push({ sub, antes: a, agora: b });
      // Cresceu: mais que dobrou e passou a pesar ao menos 5% do grupo.
      else if (b >= totalB * 0.05 && b >= a * 2) cresceram.push({ sub, antes: a, agora: b });
    }

    if (!sumiram.length || !cresceram.length) continue;

    const valorMovido = sumiram.reduce((s, x) => s + (x.antes - x.agora), 0);
    const variacaoDoGrupo = totalB - totalA;

    // O teste que separa reclassificação de queda real: se o grupo inteiro
    // caiu tanto quanto a subcategoria que sumiu, então ela realmente parou de
    // acontecer. Se o grupo mal se moveu, o dinheiro só trocou de nome.
    if (valorMovido < totalA * 0.25) continue;
    if (Math.abs(variacaoDoGrupo) >= valorMovido * 0.7) continue;

    const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    saida.push({
      grupo, sumiram, cresceram, valorMovido, variacaoDoGrupo,
      explicacao:
        `Em ${grupo}, ${sumiram.map((x) => `"${x.sub}"`).join(' e ')} praticamente ` +
        `${sumiram.length > 1 ? 'desapareceram' : 'desapareceu'} (${reais(valorMovido)} a menos), ` +
        `enquanto ${cresceram.slice(0, 3).map((x) => `"${x.sub}"`).join(', ')} ` +
        `${cresceram.length > 1 ? 'cresceram' : 'cresceu'} — e o total do grupo mudou só ` +
        `${reais(variacaoDoGrupo)}. Provavelmente mudou o jeito de classificar, não o gasto. ` +
        `O ranking de ofensores deste grupo não é confiável neste período.`,
    });
  }

  return saida;
}

export function diagnosticar(
  lancamentos: Lancamento[],
  insumos: Insumo[],
  janela: Janela,
  base?: Janela,
): Diagnostico {
  const fechados = diasDeFechamento(lancamentos, janela.fim);
  const comReceita = new Set(
    recortar(lancamentos, janela).filter((l) => l.grupo === 'Receita').map((l) => l.data),
  );

  // O último dia da janela é o dia analisado, e quase nunca está lançado
  // quando a rodada acontece — contá-lo como falta acusaria o cliente todo dia
  // de não ter lançado o movimento de hoje.
  const esperados = diasDaJanela(janela)
    .filter((d) => d !== janela.fim && !fechados.includes(diaDaSemana(d)));
  const lacunas = esperados.filter((d) => !comReceita.has(d));
  // Sem dia esperado não há o que cobrir; 1 evita anunciar 0% de cobertura
  // por falha da própria detecção.
  const cobertura = esperados.length ? comReceita.size / esperados.length : 1;

  const datas = lancamentos.map((l) => l.data).sort();
  const historicoDesde = datas[0];

  // Lançamento solto muito antes do resto — no Soffri havia um de 2022 entre
  // dados de 2026. Não estraga soma nenhuma, mas distorce "desde quando temos
  // dado", que é o que decide se a comparação com o ano passado existe.
  const doisMeses = 60 * 86_400_000;
  const corpo = datas.filter((d) => d >= (datas[Math.floor(datas.length * 0.1)] ?? d));
  const inicioDoCorpo = corpo[0];
  const lancamentosForaDeFaixa = lancamentos.filter(
    (l) => inicioDoCorpo && Date.parse(inicioDoCorpo) - Date.parse(l.data) > doisMeses,
  );

  const reclassificacoes = base ? detectarReclassificacao(lancamentos, base, janela) : [];
  const ausencias = base
    ? detectarAusencias(lancamentos, base, janela, reclassificacoes.map((r) => r.grupo))
    : [];
  const insumosSemPreco = insumos.filter((i) => !i.preco).length;

  const avisos: string[] = [];

  if (lacunas.length) {
    avisos.push(
      `${lacunas.length} dia${lacunas.length === 1 ? '' : 's'} sem lançamento de receita ` +
      `no período (${lacunas.slice(0, 6).join(', ')}${lacunas.length > 6 ? '…' : ''}). ` +
      `Faturamento e todo indicador que divide por ele estão subestimados.`,
    );
  }
  if (fechados.length) {
    avisos.push(
      `A casa parece não abrir ${fechados.map((d) => NOME_DIA[d]).join(' e ')} — ` +
      `esses dias não foram contados como falta.`,
    );
  }
  for (const r of reclassificacoes) avisos.push(r.explicacao);
  if (ausencias.length) {
    const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const total = ausencias.reduce((s2, a) => s2 + a.valorAnterior, 0);
    avisos.push(
      `${ausencias.length} lançamento${ausencias.length === 1 ? '' : 's'} recorrente${ausencias.length === 1 ? '' : 's'} ` +
      `do período anterior não aparece${ausencias.length === 1 ? '' : 'm'} neste — ` +
      ausencias.map((a) => `${a.sub} (${reais(a.valorAnterior)}, ${a.grupo})`).join('; ') +
      `. Somam ${reais(total)}. Provavelmente ainda não foram lançados; enquanto não forem, ` +
      `esses grupos parecem melhores do que estão, e o resultado do período está superestimado.`,
    );
  }
  if (insumosTotalFalta(insumos, insumosSemPreco)) {
    avisos.push(
      `${insumosSemPreco} de ${insumos.length} insumos estão sem preço no cadastro ` +
      `(${((insumosSemPreco / insumos.length) * 100).toFixed(0)}%). Enquanto isso não for ` +
      `preenchido, não dá para calcular custo de ficha técnica nem comparar preço de compra.`,
    );
  }
  if (lancamentosForaDeFaixa.length) {
    avisos.push(
      `${lancamentosForaDeFaixa.length} lançamento(s) com data muito fora do resto ` +
      `(${lancamentosForaDeFaixa.map((l) => l.data).join(', ')}). Parece erro de digitação e ` +
      `faz o histórico parecer mais longo do que é.`,
    );
  }

  let confianca: Confianca = 'alta';
  if (cobertura < 0.95 || reclassificacoes.length || ausencias.length) confianca = 'media';
  if (cobertura < 0.8 || reclassificacoes.length > 1 || ausencias.length > 1) confianca = 'baixa';

  return {
    confianca, cobertura,
    diasEsperados: esperados.length,
    diasComReceita: comReceita.size,
    lacunas, diasFechados: fechados,
    reclassificacoes, ausencias,
    insumosSemPreco, insumosTotal: insumos.length,
    lancamentosForaDeFaixa,
    historicoDesde,
    avisos,
  };
}

const insumosTotalFalta = (insumos: Insumo[], semPreco: number) =>
  insumos.length > 0 && semPreco / insumos.length >= 0.1;

/**
 * Faturamento por dia efetivamente lançado.
 *
 * É a comparação justa quando falta dia: R$ 46.282 em 17 dias contra R$ 74.559
 * em 22 dias não são 38% de queda, são 20%. O número bruto continua valendo
 * para caixa — o dinheiro que entrou foi mesmo aquele — mas para dizer se o
 * movimento caiu, é este aqui.
 */
export function porDiaLancado(total: number, diasComReceita: number): number | undefined {
  return diasComReceita > 0 ? total / diasComReceita : undefined;
}
