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
  /** O período ainda não tem um único dia a cobrir — é o dia 1º do mês, ou um
   *  mês em que a casa não abriu nenhum dia até agora.
   *
   *  Precisa de campo próprio porque "não há o que analisar" e "analisei e o
   *  dado é ruim" são coisas opostas, e a cobertura sozinha não distingue: ela
   *  vale 1 nos dois casos, por convenção. */
  periodoRecemComecado: boolean;
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
  /** Lançamento datado depois do dia analisado. Não entra na janela, mas
   *  quebra a conta de desde quando o cliente tem dado. */
  lancamentosNoFuturo: Lancamento[];
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

export interface Cobertura {
  /** Fração dos dias esperados que têm receita lançada. */
  cobertura: number;
  diasEsperados: DataISO[];
  diasComReceita: number;
  lacunas: DataISO[];
  /** Dias da semana (0 = domingo) em que a casa parece não abrir. */
  diasFechados: number[];
}

/**
 * Quanto de um período está efetivamente lançado.
 *
 * Desconta os dias em que a casa não abre e o último dia da janela — que é o
 * dia analisado, e quase nunca está lançado quando a rodada acontece; contá-lo
 * como falta acusaria o cliente todo dia de não ter lançado o movimento de
 * hoje.
 */
export function coberturaDaJanela(lancamentos: Lancamento[], janela: Janela): Cobertura {
  const diasFechados = diasDeFechamento(lancamentos, janela.fim);
  const comReceita = new Set(
    recortar(lancamentos, janela).filter((l) => l.grupo === 'Receita').map((l) => l.data),
  );
  const diasEsperados = diasDaJanela(janela)
    .filter((d) => d !== janela.fim && !diasFechados.includes(diaDaSemana(d)));
  const lacunas = diasEsperados.filter((d) => !comReceita.has(d));

  // Só conta dia que estava na conta. Contar todo dia com receita contra os
  // dias esperados dava cobertura ACIMA de 100% — 27 de 26 no Aukai, 23 de 22
  // no Soffri — porque o cliente lançou no dia analisado ou num dia que a
  // detecção tinha marcado como fechado. Passa despercebido enquanto a
  // cobertura só serve para rebaixar confiança; vira falha grave quando ela
  // decide se um período serve de base.
  const diasComReceita = diasEsperados.length - lacunas.length;

  return {
    // Sem dia esperado não há o que cobrir; 1 evita anunciar 0% de cobertura
    // por falha da própria detecção.
    cobertura: diasEsperados.length ? diasComReceita / diasEsperados.length : 1,
    diasEsperados,
    diasComReceita,
    lacunas,
    diasFechados,
  };
}

/**
 * A régua de "período completo", e é a mesma que o radar já usava para dizer
 * que a confiança do dado é alta. Não é número novo: abaixo de 95% de cobertura
 * o diagnóstico já rebaixava a confiança do período analisado, e um período que
 * não serve para ser analisado não serve para ser base.
 */
export const COBERTURA_MINIMA = 0.95;

/**
 * O período serve de base de comparação?
 *
 * Regra do Jamur: *"se não tiver dados completos do mês passado, aí você não
 * compara o dado com nenhum período"*. Um mês-base com buraco está subestimado,
 * e tudo que se comparar com ele parece ter crescido — o painel anuncia
 * melhora ou piora que é só lançamento faltando.
 *
 * Exige também que o período tenha algum dia esperado: um mês inteiro de dias
 * fechados devolveria cobertura 1 por convenção, e "100% de nada" não é base.
 */
export function janelaEstaCompleta(
  lancamentos: Lancamento[],
  janela: Janela,
  minima = COBERTURA_MINIMA,
): boolean {
  const c = coberturaDaJanela(lancamentos, janela);
  return c.diasEsperados.length > 0 && c.cobertura >= minima;
}

export function diagnosticar(
  lancamentos: Lancamento[],
  insumos: Insumo[],
  janela: Janela,
  base?: Janela,
  /** Lançamentos com data depois do dia analisado. Chegam separados porque a
   *  análise inteira já os descartou — mas quem lê precisa saber que existem. */
  futuros: Lancamento[] = [],
): Diagnostico {
  const {
    cobertura, diasEsperados: esperados, diasComReceita, lacunas, diasFechados: fechados,
  } = coberturaDaJanela(lancamentos, janela);

  const datas = lancamentos.map((l) => l.data).sort();
  const historicoDesde = datas[0];

  const doisMeses = 60 * 86_400_000;
  const inicioDoCorpo = inicioConfiavel(datas, 60, janela.fim);
  const lancamentosForaDeFaixa = lancamentos.filter(
    (l) => inicioDoCorpo && Date.parse(inicioDoCorpo) - Date.parse(l.data) > doisMeses,
  );
  const lancamentosNoFuturo = futuros;

  const reclassificacoes = base ? detectarReclassificacao(lancamentos, base, janela) : [];
  const ausencias = base
    ? detectarAusencias(lancamentos, base, janela, reclassificacoes.map((r) => r.grupo))
    : [];
  // Só insumo COMPRADO precisa de preço. Um `preparado` não tem preço porque
  // o custo dele sai da ficha (`comps`) — cobrar preço de preparado é acusar
  // cadastro incompleto onde o cadastro está certo. No dump de 27/08/2026 os
  // 3.716 insumos `pronto` da carteira têm preço, e os 126 sem preço são
  // preparados, todos eles: a checagem ingênua seria 126 alarmes falsos e
  // nenhum verdadeiro.
  const compraveis = insumos.filter((i) => i.tipo !== 'preparado');
  const insumosSemPreco = compraveis.filter((i) => !i.preco).length;

  const avisos: string[] = [];

  if (esperados.length === 0) {
    avisos.push(
      `O período ${janela.inicio} a ${janela.fim} ainda não tem um dia fechado para ` +
      `analisar — o mês está começando. Os números abaixo são o que foi lançado até ` +
      `agora, e não descrevem o mês.`,
    );
  }
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
  if (insumosTotalFalta(compraveis, insumosSemPreco)) {
    avisos.push(
      `${insumosSemPreco} de ${compraveis.length} insumos comprados estão sem preço no cadastro ` +
      `(${((insumosSemPreco / compraveis.length) * 100).toFixed(0)}%). Enquanto isso não for ` +
      `preenchido, não dá para calcular custo de ficha técnica nem comparar preço de compra.`,
    );
  }
  if (lancamentosNoFuturo.length) {
    avisos.push(
      `${lancamentosNoFuturo.length} lançamento(s) com data no futuro ` +
      `(${[...new Set(lancamentosNoFuturo.map((l) => l.data))].join(', ')}). ` +
      `Não entram na janela deste mês, mas quebram a conta de desde quando o ` +
      `cliente tem dado — provavelmente é ano ou mês digitado errado.`,
    );
  }
  if (lancamentosForaDeFaixa.length) {
    avisos.push(
      `${lancamentosForaDeFaixa.length} lançamento(s) com data muito fora do resto ` +
      `(${lancamentosForaDeFaixa.map((l) => l.data).join(', ')}). Parece erro de digitação e ` +
      `faz o histórico parecer mais longo do que é.`,
    );
  }

  // Sem dia esperado, a cobertura vale 1 por convenção — "cobri tudo que havia
  // para cobrir", quando não havia nada. Deixar isso virar confiança ALTA foi
  // o que aconteceu em 01/09/2026: os trinta clientes abriram o painel com
  // cobertura de 100% e confiança alta sobre um mês que tinha começado naquela
  // manhã. É o pior erro possível aqui — parece confiável e está vazio.
  const periodoRecemComecado = esperados.length === 0;

  let confianca: Confianca = 'alta';
  if (cobertura < 0.95 || reclassificacoes.length || ausencias.length) confianca = 'media';
  if (cobertura < 0.8 || reclassificacoes.length > 1 || ausencias.length > 1) confianca = 'baixa';
  if (periodoRecemComecado) confianca = 'baixa';

  return {
    confianca, periodoRecemComecado, cobertura,
    diasEsperados: esperados.length,
    diasComReceita,
    lacunas, diasFechados: fechados,
    reclassificacoes, ausencias,
    insumosSemPreco, insumosTotal: compraveis.length,
    lancamentosForaDeFaixa,
    lancamentosNoFuturo,
    historicoDesde,
    avisos,
  };
}

/**
 * Desde quando o cliente vem usando o Flow **sem interrupção**.
 *
 * Lançamento perdido lá atrás distorce "desde quando temos dado", que é o que
 * decide contra o que comparar. E há bastante deles: o Soffri tem um de 2022, o
 * Aukai tem de 2022 e 2023, e o King tem de 2017, 2018, 2020, 2022 e 2024.
 *
 * A conta é feita **de trás para frente**, a partir do lançamento mais recente,
 * parando no primeiro vão maior que `vaoMaximoDias`. Duas tentativas anteriores
 * erraram, e cada uma errou de um jeito:
 *
 *  - **Percentil** (o 10º): num histórico contínuo ele cai sempre uns 10%
 *    adiante, então um julho lançado do dia 1 ao 31 virava "começou dia 6".
 *  - **Primeiro vão pequeno, de frente para trás**: basta um PAR de lançamentos
 *    perdidos próximos entre si para a conta parar neles. É o caso do King, com
 *    2020-07-30 e 2020-08-05 a seis dias de distância — a trava de base virava
 *    2020, e o radar comparava agosto de 2026 com agosto de 2025, um ano em que
 *    o cliente não existia no Flow, tratando o zero como base.
 *
 * De trás para frente nenhum dos dois acontece: o que se pergunta é até onde a
 * série de hoje se estende para trás sem buraco, e é exatamente essa a
 * pergunta.
 *
 * Limite conhecido: um cliente que ficou mais de dois meses sem lançar tem o
 * histórico cortado ali. É o certo para o que isto decide — dado de antes de um
 * buraco desse tamanho não serve de base — mas não é "desde quando ele é
 * cliente", e não deve ser usado para isso.
 */
export function inicioConfiavel(
  datasOrdenadas: string[],
  vaoMaximoDias = 60,
  /** Não enxergar além do dia analisado. Sem isto, lançamento com data no
   *  FUTURO vira o ponto de partida da varredura e o cliente parece ter
   *  começado depois de hoje: o Restaurante JK tem dois lançamentos em
   *  novembro de 2026, e eles sozinhos apagavam os seis meses de histórico
   *  dele — o radar passou a dizer "sem base" para o cliente com mais dado da
   *  carteira. */
  ate?: string,
): string | undefined {
  const unicas = [...new Set(datasOrdenadas)].filter((d) => !ate || d <= ate).sort();
  if (!unicas.length) return undefined;

  let inicio = unicas[unicas.length - 1];
  for (let i = unicas.length - 1; i > 0; i--) {
    const vao = (Date.parse(unicas[i]) - Date.parse(unicas[i - 1])) / 86_400_000;
    if (vao > vaoMaximoDias) break;
    inicio = unicas[i - 1];
  }
  return inicio;
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
