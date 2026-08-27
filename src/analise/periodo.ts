/**
 * Contra o quê comparar o dia de hoje.
 *
 * A regra é a que você definiu: hoje é 26, então a base é 26 de agosto do ano
 * passado; se esse dia não existir, 26 do mês passado; se também não existir,
 * o dado é ignorado. Ignorado — não zerado, não "estável". A diferença
 * aparece no painel como "sem base".
 *
 * Duas armadilhas que este arquivo resolve e que não estavam no enunciado:
 *
 *  1. Dia da semana. 26/08/2026 é quarta; 26/08/2025 foi terça. Num
 *     restaurante isso sozinho move o faturamento em dezenas de por cento,
 *     e vira alarme de queda que não é queda. Por padrão comparamos literal
 *     (o que você pediu) e ANOTAMOS o desencontro no achado. Ligando
 *     `alinharDiaSemana` no cadastro do cliente, a base pula para o dia mais
 *     próximo daquela data que caia no mesmo dia da semana.
 *
 *  2. "Não existir" tem dois sentidos. O dia pode não estar no banco (não
 *     coletamos, cliente ainda não usava o Flow) ou estar lá valendo zero
 *     porque a casa fechou. Zero é um número péssimo de base: qualquer coisa
 *     dividida por ele estoura. Por isso quem decide se a base serve é o
 *     `temBase` que o chamador passa, e ele exige dado presente E utilizável.
 */

import type { DataISO } from '../flow/tipos';

export type OrigemBase = 'ano_anterior' | 'mes_anterior' | 'nenhuma';

export interface Base {
  data: DataISO;
  origem: OrigemBase;
  /** Preenchido quando a base serve, mas com ressalva que muda a leitura. */
  aviso?: string;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function partes(d: DataISO): [number, number, number] {
  const [a, m, dia] = d.split('-').map(Number);
  return [a, m, dia];
}

function montar(ano: number, mes: number, dia: number): DataISO {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diaValido = Math.min(dia, ultimo);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(diaValido).padStart(2, '0')}`;
}

export function diaDaSemana(d: DataISO): number {
  const [a, m, dia] = partes(d);
  return new Date(Date.UTC(a, m - 1, dia)).getUTCDay();
}

export function nomeDoDia(d: DataISO): string {
  return DIAS[diaDaSemana(d)];
}

export function somarDias(d: DataISO, n: number): DataISO {
  const [a, m, dia] = partes(d);
  const t = new Date(Date.UTC(a, m - 1, dia + n));
  return t.toISOString().slice(0, 10);
}

/** Mesma data, um ano antes. 29/02 vira 28/02 — o `montar` corta para o
 *  último dia existente do mês. */
export function anoAnterior(d: DataISO): DataISO {
  const [a, m, dia] = partes(d);
  return montar(a - 1, m, dia);
}

/** Mesma data, um mês antes. 31/03 vira 28 ou 29/02 pela mesma razão:
 *  "dia 31 do mês passado" não existe, e pular para 03/03 seria comparar
 *  com o mês errado. */
export function mesAnterior(d: DataISO): DataISO {
  const [a, m, dia] = partes(d);
  const mesAlvo = m === 1 ? 12 : m - 1;
  const anoAlvo = m === 1 ? a - 1 : a;
  return montar(anoAlvo, mesAlvo, dia);
}

/** O dia mais próximo de `alvo` que cai no mesmo dia da semana de `referencia`.
 *  No máximo três dias para cada lado — passou disso já é outra semana e a
 *  comparação perde o sentido. */
export function alinharDiaSemana(alvo: DataISO, referencia: DataISO): DataISO {
  const querido = diaDaSemana(referencia);
  const atual = diaDaSemana(alvo);
  let delta = querido - atual;
  if (delta > 3) delta -= 7;
  if (delta < -3) delta += 7;
  return somarDias(alvo, delta);
}

export interface OpcoesBase {
  alinharDiaSemana?: boolean;
  /** Antes desta data não confiamos no dado do cliente, mesmo que a API
   *  devolva algo. Restaurante que começou a lançar em março tem janeiro
   *  cheio de zeros que não são queda de faturamento. */
  dadosDesde?: DataISO;
}

/**
 * Escolhe a base seguindo a cascata. `temBase(data)` responde se aquele dia
 * tem dado utilizável para a métrica em questão — quem chama é que sabe,
 * porque a resposta muda por métrica (o faturamento do dia 1 pode existir e o
 * CMV do dia 1 não).
 */
export function escolherBase(
  data: DataISO,
  temBase: (d: DataISO) => boolean,
  opts: OpcoesBase = {},
): Base {
  const candidatos: Array<{ data: DataISO; origem: OrigemBase }> = [];

  for (const [origem, bruto] of [
    ['ano_anterior', anoAnterior(data)],
    ['mes_anterior', mesAnterior(data)],
  ] as Array<[OrigemBase, DataISO]>) {
    if (opts.alinharDiaSemana) {
      const alinhado = alinharDiaSemana(bruto, data);
      candidatos.push({ data: alinhado, origem });
      // Se o alinhado não tiver dado, ainda tentamos o literal antes de
      // descer para o mês passado: uma base imperfeita é melhor que nenhuma.
      if (alinhado !== bruto) candidatos.push({ data: bruto, origem });
    } else {
      candidatos.push({ data: bruto, origem });
    }
  }

  for (const c of candidatos) {
    if (opts.dadosDesde && c.data < opts.dadosDesde) continue;
    if (!temBase(c.data)) continue;

    const aviso =
      diaDaSemana(c.data) !== diaDaSemana(data)
        ? `Base em ${nomeDoDia(c.data)}, dia analisado em ${nomeDoDia(data)} — ` +
          `parte da diferença é movimento de dia da semana, não gestão.`
        : undefined;

    return { data: c.data, origem: c.origem, aviso };
  }

  return { data: '', origem: 'nenhuma' };
}
