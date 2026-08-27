/**
 * Indicador contra a meta.
 *
 * Com 2,5 meses de histórico, comparar com o passado entrega pouco: não existe
 * "mesmo período do ano passado" e o mês anterior pode ter sido tão ruim
 * quanto. O que entrega valor imediato é a régua: o CMV do Soffri está em 46%,
 * e isso é grave contra qualquer meta razoável — independente de agosto ter
 * sido melhor ou pior que julho.
 *
 * Por isso a meta vem antes da comparação na ordem de leitura do painel.
 *
 * Só o CMV tem valor padrão, e é o padrão do próprio Flow (30%). Para os
 * outros indicadores eu deliberadamente NÃO inventei número: régua de mão de
 * obra e de despesa fixa muda com o modelo do negócio, e um alvo chutado por
 * mim viraria alerta com cara de autoridade. Enquanto a consultoria não
 * definir, o indicador simplesmente não é avaliado contra meta.
 */

export type SituacaoMeta = 'dentro' | 'acima' | 'muito_acima' | 'sem_meta';

export interface AvaliacaoMeta {
  metrica: string;
  rotulo: string;
  valor: number;
  alvo?: number;
  situacao: SituacaoMeta;
  /** Distância em pontos percentuais. Positivo = pior que a meta. */
  distancia?: number;
  explicacao: string;
}

/** metrica → alvo, em fração (0.30 = 30%). */
export type Metas = Record<string, number>;

/** O padrão do Flow para CMV. Vale como ponto de partida até a consultoria
 *  cadastrar a meta real de cada restaurante. */
export const META_PADRAO: Metas = { cmv: 0.30 };

const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const pts = (v: number) => `${Math.abs(v * 100).toFixed(1).replace('.', ',')} pontos`;

export function avaliarMeta(
  metrica: string,
  rotulo: string,
  valor: number | undefined,
  metas: Metas,
): AvaliacaoMeta | null {
  if (valor === undefined) return null;

  const alvo = metas[metrica];
  if (alvo === undefined) {
    return {
      metrica, rotulo, valor, situacao: 'sem_meta',
      explicacao:
        `${pct(valor)} no período. Sem meta cadastrada para este cliente — ` +
        `o número fica registrado, mas não é julgado.`,
    };
  }

  const distancia = valor - alvo;
  const situacao: SituacaoMeta =
    distancia <= 0 ? 'dentro' : distancia >= alvo * 0.25 ? 'muito_acima' : 'acima';

  const explicacao =
    situacao === 'dentro'
      ? `${pct(valor)} contra meta de ${pct(alvo)} — dentro, com folga de ${pts(distancia)}.`
      : `${pct(valor)} contra meta de ${pct(alvo)} — ${pts(distancia)} acima` +
        (situacao === 'muito_acima'
          ? '. É distância grande o bastante para ser o assunto principal da reunião.'
          : '.');

  return { metrica, rotulo, valor, alvo, situacao, distancia, explicacao };
}

/** Quanto sairia do custo se o indicador voltasse à meta. É o número que faz
 *  o dono se mexer — "seu CMV está 16 pontos acima" convence menos que
 *  "são R$ 7.400 por mês". */
export function quantoCustaODesvio(
  distancia: number | undefined,
  faturamento: number,
): number | undefined {
  return distancia !== undefined && distancia > 0 ? distancia * faturamento : undefined;
}
