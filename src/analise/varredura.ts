/**
 * O motor genérico: pega tudo que foi coletado e responde "o que piorou".
 *
 * Vale para qualquer métrica do catálogo, inclusive as que ainda não existem.
 * Ligar uma fonte nova do Flow é acrescentar uma linha em 02-carga.sql e
 * mandar o número na coleta — a vigilância vem de graça.
 *
 * O que este arquivo NÃO faz é explicar a causa. Ele diz "o CMV subiu 2,3
 * pontos". Quem diz por quê é `cmv.ts`, e quem diz qual insumo é `produtos.ts`.
 */

import type { DataISO } from '../flow/tipos';
import { escolherBase, type Base, type OpcoesBase } from './periodo';

export type Unidade = 'reais' | 'percentual' | 'contagem' | 'minutos' | 'dias';
export type Direcao = 'maior_melhor' | 'menor_melhor';
export type Severidade = 'critico' | 'atencao' | 'melhorou' | 'estavel' | 'sem_base';

export interface DefMetrica {
  chave: string;
  rotulo: string;
  grupo: string;
  unidade: Unidade;
  direcao: Direcao;
  limiarAtencao: number;
  limiarCritico: number;
}

export interface Achado {
  metrica: string;
  rotulo: string;
  grupo: string;
  severidade: Severidade;
  titulo: string;
  explicacao: string;
  valorAtual?: number;
  valorBase?: number;
  dataBase?: DataISO;
  baseOrigem: Base['origem'];
  /** Variação relativa (0.12 = 12% pior). Para métricas percentuais é a
   *  diferença em pontos (0.02 = 2 pontos). */
  variacao?: number;
  detalhe: Record<string, unknown>;
}

export interface ContextoAvaliacao extends OpcoesBase {
  /** Ligado quando a comparação é entre JANELAS de tamanho igual (acumulado do
   *  mês contra acumulado do mês), e não entre dias soltos. Nesse caso o aviso
   *  de dia da semana não faz sentido: 26 dias contra 26 dias já têm quase o
   *  mesmo tanto de sábado, e repetir o aviso em todo card ensina o leitor a
   *  pular a linha inteira — inclusive quando ela importar. */
  comparaJanela?: boolean;
  /** Não acender alerta quando a diferença em reais é pequena demais para
   *  alguém agir. 12% a mais numa despesa de R$ 40 não é notícia. */
  pisoRelevanciaReais?: number;
}

/** Como a base é chamada no texto. Muda conforme a comparação seja entre dias
 *  ou entre janelas: dizer "mesmo dia do ano passado" quando o que se comparou
 *  foram 26 dias contra 26 dias é errado, e é o tipo de erro que faz o cliente
 *  desconfiar do painel inteiro com razão. */
function nomeOrigem(origem: Base['origem'], comparaJanela = false): string {
  const unidade = comparaJanela ? 'período' : 'dia';
  if (origem === 'ano_anterior') return `mesmo ${unidade} do ano passado`;
  if (origem === 'mes_anterior') return `mesmo ${unidade} do mês passado`;
  return '';
}

export function formatar(valor: number, unidade: Unidade): string {
  switch (unidade) {
    case 'reais':
      return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'percentual':
      return `${(valor * 100).toFixed(1).replace('.', ',')}%`;
    case 'minutos':
      return `${valor.toFixed(0)} min`;
    case 'dias':
      return `${valor.toFixed(0)} dias`;
    default:
      return valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
}

/**
 * Avalia uma métrica num dia.
 *
 * `serie(data)` devolve o valor daquele dia ou `undefined` se não houver dado.
 * Devolver 0 e devolver `undefined` são coisas diferentes e o chamador precisa
 * respeitar isso: 0 é "faturou nada", `undefined` é "não sabemos".
 */
export function avaliarMetrica(
  def: DefMetrica,
  data: DataISO,
  serie: (d: DataISO) => number | undefined,
  ctx: ContextoAvaliacao = {},
): Achado {
  const atual = serie(data);

  const esqueleto = {
    metrica: def.chave,
    rotulo: def.rotulo,
    grupo: def.grupo,
    detalhe: {} as Record<string, unknown>,
  };

  if (atual === undefined) {
    return {
      ...esqueleto,
      severidade: 'sem_base',
      baseOrigem: 'nenhuma',
      titulo: `${def.rotulo}: sem dado`,
      explicacao: `O Flow não devolveu ${def.rotulo.toLowerCase()} para ${data}.`,
      detalhe: { motivo: 'sem_valor_atual' },
    };
  }

  // Base útil = existe e não é zero. Zero como base transforma qualquer
  // centavo em variação infinita, e a cascata tem que continuar procurando.
  let base = escolherBase(data, (d) => {
    const v = serie(d);
    return v !== undefined && v !== 0;
  }, ctx);

  // Mas "não achei base diferente de zero" não é o mesmo que "não achei base".
  // Um indicador que era zero e continua zero — produto sem ficha técnica,
  // conta vencida — está ótimo, e marcá-lo como ignorado enche o painel de
  // falso silêncio. E sair de zero para alguma coisa é a notícia mais dura que
  // existe, não a ausência de notícia.
  let baseZerada = false;
  if (base.origem === 'nenhuma') {
    base = escolherBase(data, (d) => serie(d) !== undefined, ctx);
    baseZerada = base.origem !== 'nenhuma';
  }

  if (base.origem === 'nenhuma') {
    return {
      ...esqueleto,
      severidade: 'sem_base',
      valorAtual: atual,
      baseOrigem: 'nenhuma',
      titulo: `${def.rotulo}: ${formatar(atual, def.unidade)}`,
      explicacao:
        `Sem base de comparação — não há ${def.rotulo.toLowerCase()} nem no mesmo dia ` +
        `do ano passado nem no do mês passado. O dado foi ignorado na análise, ` +
        `não considerado estável.`,
      detalhe: { motivo: 'sem_base_valida' },
    };
  }

  const valorBase = serie(base.data)!;

  if (baseZerada) {
    const piorou = def.direcao === 'maior_melhor' ? atual < 0 : atual > 0;
    const relevante = !(
      def.unidade === 'reais' &&
      ctx.pisoRelevanciaReais !== undefined &&
      Math.abs(atual) < ctx.pisoRelevanciaReais
    );
    const severidade: Severidade =
      atual === 0 ? 'estavel' : piorou ? (relevante ? 'critico' : 'estavel') : 'melhorou';

    return {
      ...esqueleto,
      severidade,
      titulo:
        atual === 0
          ? `${def.rotulo}: zerado, como na base`
          : `${def.rotulo}: ${formatar(atual, def.unidade)}, saindo do zero`,
      explicacao:
        atual === 0
          ? `Zero em ${data} e zero no ${nomeOrigem(base.origem, ctx.comparaJanela)} (até ${base.data}).`
          : `Era zero no ${nomeOrigem(base.origem, ctx.comparaJanela)} ` +
            `(${ctx.comparaJanela ? 'até ' : ''}${base.data}) e agora é ` +
            `${formatar(atual, def.unidade)}. Não há percentual a calcular — ` +
            `o indicador nasceu neste período.` +
            (ctx.comparaJanela || !base.aviso ? '' : ` ${base.aviso}`),
      valorAtual: atual,
      valorBase: 0,
      dataBase: base.data,
      baseOrigem: base.origem,
      detalhe: {
        base_zerada: true,
        ...(!ctx.comparaJanela && base.aviso ? { aviso: base.aviso } : {}),
      },
    };
  }

  // Percentual compara em pontos; o resto, em variação relativa. Dizer que o
  // CMV "subiu 7%" quando foi de 30% para 32% confunde quem decide.
  const variacaoBruta =
    def.unidade === 'percentual' ? atual - valorBase : (atual - valorBase) / Math.abs(valorBase);

  const piorou = def.direcao === 'maior_melhor' ? variacaoBruta < 0 : variacaoBruta > 0;
  const magnitude = Math.abs(variacaoBruta);

  const irrelevante =
    def.unidade === 'reais' &&
    ctx.pisoRelevanciaReais !== undefined &&
    Math.abs(atual - valorBase) < ctx.pisoRelevanciaReais;

  let severidade: Severidade;
  if (irrelevante || magnitude < def.limiarAtencao) severidade = 'estavel';
  else if (!piorou) severidade = 'melhorou';
  else severidade = magnitude >= def.limiarCritico ? 'critico' : 'atencao';

  const comoVariou =
    def.unidade === 'percentual'
      ? `${variacaoBruta >= 0 ? '+' : '−'}${Math.abs(variacaoBruta * 100).toFixed(1).replace('.', ',')} pontos`
      : `${variacaoBruta >= 0 ? '+' : '−'}${Math.abs(variacaoBruta * 100).toFixed(1).replace('.', ',')}%`;

  const aviso = ctx.comparaJanela ? undefined : base.aviso;

  const explicacao =
    `${formatar(atual, def.unidade)} contra ${formatar(valorBase, def.unidade)} ` +
    `no ${nomeOrigem(base.origem, ctx.comparaJanela)} ` +
    `(${ctx.comparaJanela ? 'até ' : ''}${base.data}) — ${comoVariou}.` +
    (aviso ? ` ${aviso}` : '') +
    (irrelevante ? ' Diferença pequena demais em reais para virar alerta.' : '');

  return {
    ...esqueleto,
    severidade,
    titulo: `${def.rotulo}: ${formatar(atual, def.unidade)} (${comoVariou})`,
    explicacao,
    valorAtual: atual,
    valorBase,
    dataBase: base.data,
    baseOrigem: base.origem,
    variacao: variacaoBruta,
    detalhe: aviso ? { aviso } : {},
  };
}

const ordem: Record<Severidade, number> = {
  critico: 0, atencao: 1, sem_base: 2, melhorou: 3, estavel: 4,
};

/** Varre o catálogo inteiro e devolve tudo, do pior para o melhor. O painel
 *  mostra crítico e atenção; o resto fica disponível para quem abrir o
 *  cliente — inclusive o que melhorou, que é o que você leva para a reunião. */
export function varrer(
  defs: DefMetrica[],
  data: DataISO,
  serieDe: (metrica: string) => (d: DataISO) => number | undefined,
  ctx: ContextoAvaliacao = {},
): Achado[] {
  return defs
    .map((def) => avaliarMetrica(def, data, serieDe(def.chave), ctx))
    .sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || Math.abs(b.variacao ?? 0) - Math.abs(a.variacao ?? 0));
}
