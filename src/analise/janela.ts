/**
 * Recorte e soma. A parte sem opinião do sistema.
 */

import type { DataISO, Grupo, Lancamento } from '../flow/tipos';

export interface Janela {
  inicio: DataISO;
  fim: DataISO;
}

export const dentro = (d: DataISO, j: Janela) => d >= j.inicio && d <= j.fim;

export const recortar = (l: Lancamento[], j: Janela) => l.filter((x) => dentro(x.data, j));

/** Do dia 1 do mês até a data. */
export function janelaDoMes(data: DataISO): Janela {
  return { inicio: `${data.slice(0, 7)}-01`, fim: data };
}

export function diasDaJanela(j: Janela): DataISO[] {
  const saida: DataISO[] = [];
  const [a, m, d] = j.inicio.split('-').map(Number);
  for (let i = 0; ; i++) {
    const dia = new Date(Date.UTC(a, m - 1, d + i)).toISOString().slice(0, 10);
    if (dia > j.fim) break;
    saida.push(dia);
  }
  return saida;
}

export function diaDaSemana(d: DataISO): number {
  const [a, m, dia] = d.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, dia)).getUTCDay();
}

export const NOME_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface Agregado {
  janela: Janela;
  faturamento: number;
  despesaTotal: number;
  porGrupo: Map<Grupo, number>;
  /** grupo → subcategoria → valor. É por aqui que se descobre QUEM. */
  porSub: Map<Grupo, Map<string, number>>;
  /** Dias distintos com lançamento de receita — a medida de quanto o cliente
   *  realmente alimentou o sistema no período. */
  diasComReceita: number;
  lancamentos: number;
}

export function agregar(lancamentos: Lancamento[], janela: Janela): Agregado {
  const dentroDaJanela = recortar(lancamentos, janela);

  const ag: Agregado = {
    janela,
    faturamento: 0,
    despesaTotal: 0,
    porGrupo: new Map(),
    porSub: new Map(),
    diasComReceita: 0,
    lancamentos: dentroDaJanela.length,
  };

  const diasReceita = new Set<DataISO>();

  for (const l of dentroDaJanela) {
    ag.porGrupo.set(l.grupo, (ag.porGrupo.get(l.grupo) ?? 0) + l.valor);

    if (!ag.porSub.has(l.grupo)) ag.porSub.set(l.grupo, new Map());
    const subs = ag.porSub.get(l.grupo)!;
    const chave = l.sub ?? '(sem subcategoria)';
    subs.set(chave, (subs.get(chave) ?? 0) + l.valor);

    if (l.grupo === 'Receita') {
      ag.faturamento += l.valor;
      diasReceita.add(l.data);
    } else {
      ag.despesaTotal += l.valor;
    }
  }

  ag.diasComReceita = diasReceita.size;
  return ag;
}

export const doGrupo = (ag: Agregado, g: Grupo) => ag.porGrupo.get(g) ?? 0;

export const subsDoGrupo = (ag: Agregado, g: Grupo) =>
  ag.porSub.get(g) ?? new Map<string, number>();

/** Indicador percentual sobre faturamento. Devolve `undefined` — nunca zero —
 *  quando não há faturamento: zero é uma afirmação, e afirmação errada vira
 *  alerta falso. */
export function sobreFaturamento(valor: number, faturamento: number): number | undefined {
  return faturamento > 0 ? valor / faturamento : undefined;
}
