/**
 * Contra o quê comparar o dia de hoje.
 *
 * A regra é a que você definiu, e nesta ordem:
 *
 *   1. o mesmo período do **ano passado**;
 *   2. se não houver dado lá, o mesmo período do **mês passado**;
 *   3. se o mês passado não estiver **completo**, não se compara com nada.
 *
 * O terceiro degrau é uma recusa, não uma ressalva: o dado é **ignorado** — não
 * zerado, não "estável". A diferença aparece no painel como "sem base".
 *
 * "Completo" é responsabilidade do `periodoUtilizavel`, abaixo. Sem ele a
 * cascata aceita qualquer mês que tenha um lançamento, e um mês pela metade
 * como base faz tudo parecer que cresceu.
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

/**
 * O primeiro mês que serve de base para comparação.
 *
 * Regra do Jamur, e ela é mais dura do que parece: *"se eles começaram no meio
 * do mês passado, é porque o nosso trabalho começou no meio do mês — nesse
 * caso você não traz histórico nenhum para a análise, só quando ele começar o
 * mês cheio"*.
 *
 * Um cliente que passou a lançar dia 13 de julho não tem julho: tem meia
 * dúzia de semanas soltas. Comparar agosto com esse julho não mede
 * desempenho, mede quando a consultoria entrou. E o erro não é pequeno — na
 * carteira de 27/08/2026 o Matsu Sushi (primeiro lançamento em 13/07) subia
 * ao topo do painel com NOVE indicadores "críticos" e nenhuma meta fora da
 * régua. Todos eram meio mês contra mês inteiro.
 *
 * Ressalvar não bastava. O mês parcial simplesmente não existe como base; a
 * comparação volta quando houver um mês cheio, e até lá o painel diz "sem
 * base", que é a verdade.
 *
 * A tolerância existe porque o dia 1 pode cair em dia de casa fechada: começar
 * no dia 2 ou 3 ainda é começar no mês. Passou disso, o mês não conta.
 */
export function primeiroMesCheio(primeiroLancamento: DataISO, tolerancia = 5): DataISO {
  const [ano, mes, dia] = partes(primeiroLancamento);
  if (dia <= tolerancia) return montar(ano, mes, 1);
  return mes === 12 ? montar(ano + 1, 1, 1) : montar(ano, mes + 1, 1);
}

export interface OpcoesBase {
  alinharDiaSemana?: boolean;
  /** Antes desta data não confiamos no dado do cliente. Restaurante que
   *  começou a lançar em março tem janeiro cheio de zeros que não são queda de
   *  faturamento.
   *
   *  Quem preenche deve passar o começo do primeiro **mês cheio**
   *  (`primeiroMesCheio`), não o primeiro lançamento: meio mês de base é pior
   *  que base nenhuma, porque parece base. */
  dadosDesde?: DataISO;
  /** Veto sobre o período candidato, aplicado a TODO degrau da cascata.
   *
   *  É por aqui que entra a exigência de mês completo: `dadosDesde` só sabe
   *  quando o cliente começou, e não vê o mês que começou cheio e teve duas
   *  semanas sem lançamento no meio. Um mês desses está subestimado, e tudo que
   *  se comparar com ele parece ter crescido.
   *
   *  Fica em `OpcoesBase` — e não no `temBase` de quem chama — porque a
   *  varredura escolhe uma base por indicador, e a regra tem de valer para
   *  todas igualmente. Deixá-la no chamador significaria repeti-la em cada um
   *  e esquecê-la em algum. */
  periodoUtilizavel?: (d: DataISO) => boolean;
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
    if (opts.periodoUtilizavel && !opts.periodoUtilizavel(c.data)) continue;
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
