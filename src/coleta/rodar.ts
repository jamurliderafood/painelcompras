/**
 * A rodada de um cliente.
 *
 * A ordem aqui é uma opinião, formada em cima do dado real do Soffri Grill:
 *
 *   1. O dado presta?   Cobertura de lançamento, reclassificação, cadastro.
 *   2. Está na régua?   Indicador contra a meta. Não precisa de histórico.
 *   3. Piorou?          Comparação com o período anterior.
 *
 * A comparação vem por último de propósito. Com 2,5 meses de histórico ela é a
 * parte mais fraca das três, e é a que mais erra quando o dado tem buraco. Nas
 * versões anteriores ela vinha primeiro, e por isso a primeira leitura do dado
 * real quase produziu um alerta falso.
 *
 * A janela é o acumulado do mês: lançamento financeiro é irregular — compra
 * semanal, aluguel no dia 5 — e dia contra dia mede o calendário.
 */

import type { DataISO, Lancamento, RetratoPreco } from '../flow/tipos';
import type { FonteFlow } from '../flow/api';
import {
  agregar, doGrupo, janelaDoMes, sobreFaturamento, subsDoGrupo, type Agregado, type Janela,
} from '../analise/janela';

// Reexportado porque a rotina de coleta precisa da mesma janela para gravar o
// retrato — se ela calculasse a própria, um dia as duas divergiriam.
export { janelaDoMes };
import {
  diagnosticar, inicioConfiavel, janelaEstaCompleta, porDiaLancado, type Diagnostico,
} from '../analise/qualidade';
import { avaliarMeta, quantoCustaODesvio, META_PADRAO, type AvaliacaoMeta, type Metas } from '../analise/metas';
import { explicarIndicador, type Explicacao } from '../analise/dimensoes';
import { variacoesDeCompra, type ResultadoCompras } from '../analise/compras';
import { resumirPrecos, type ResumoPrecos } from '../analise/precos';
import {
  decomporCompras, resumirPrecoPago,
  type ResultadoDecomposicao, type ResumoPrecoPago,
} from '../analise/precoPago';
import { varrer, type Achado, type DefMetrica } from '../analise/varredura';
import { escolherBase, primeiroMesCheio } from '../analise/periodo';
import {
  cmvRealAnterior, cmvRealDoUltimo, idadeEmDias, type CmvApurado,
} from '../analise/cmvReal';
import { CATALOGO, GRUPO_PARA_METRICA } from '../analise/catalogo';

export interface ClienteConfig {
  id: string;
  nome: string;
  metas?: Metas;
  pisoRelevanciaReais?: number;
}

export interface RelatorioCliente {
  clienteId: string;
  nome: string;
  data: DataISO;
  janela: Janela;
  janelaBase?: Janela;
  situacao: 'ok' | 'parcial' | 'erro';
  endpointsErro: string[];
  diagnostico: Diagnostico;
  metas: AvaliacaoMeta[];
  achados: Achado[];
  explicacoes: Explicacao[];
  /** Insumos que mudaram de PREÇO, por evento — sem janela mensal, porque nota
   *  fiscal entra quando o cliente compra e não tem cadência. É o que a visão
   *  geral mostra ao lado dos números. */
  precos: ResumoPrecos;
  /** Quanto se GASTOU com cada produto entre os dois períodos. Não é preço:
   *  sem quantidade na nota, gastar mais pode ser preço maior ou compra maior.
   *  Serve para entender a composição do CMV, não para acusar fornecedor. */
  gastos: ResultadoCompras;
  /** O preço PAGO por compra (`valor / qtd`), quando o lançamento tem
   *  quantidade. Diferente de `precos`, que compara o cadastro entre retratos:
   *  este sai da própria nota e vale desde a primeira rodada. */
  precoPago: ResumoPrecoPago;
  /** A diferença de gasto aberta em efeito preço × efeito volume. Vem com a
   *  ressalva junto: base incompleta transforma "comprou mais" em artefato. */
  decomposicao: ResultadoDecomposicao;
  /** Os três números que abrem o cartão da carteira. */
  principais: {
    faturamento: number;
    cmv?: number;
    resultado: number;
    /** De onde saiu o CMV acima. `contagem` é consumo de verdade (estoque
     *  inicial + compras − estoque final ÷ vendas); `compras` é o que se
     *  comprou no período sobre o faturamento — mede compra, não consumo. */
    cmvOrigem: 'contagem' | 'compras';
  };
  /** A última contagem de estoque, quando existe. É o CMV real. */
  cmvReal?: CmvApurado;
  /** A contagem anterior, para dizer se melhorou. */
  cmvRealAnterior?: CmvApurado;
  /** Há quantos dias a contagem foi feita — contagem velha descreve uma casa
   *  que talvez não exista mais. */
  cmvRealIdadeDias?: number;
  /** As métricas do período, como a análise as calculou — já sem os
   *  lançamentos com data no futuro.
   *
   *  Existe para a gravação não recalculá-las por conta própria. O cron fazia
   *  isso, e fazia a partir do dado CRU: o histórico guardava um número e a
   *  tela mostrava outro, e a diferença eram justamente os lançamentos que a
   *  análise descarta. */
  metricas: Record<string, number | undefined>;
  resumo: string;
}

/** Traduz um período agregado nas métricas do catálogo. */
export function metricasDaJanela(lancamentos: Lancamento[], janela: Janela): Record<string, number | undefined> {
  const ag = agregar(lancamentos, janela);
  const fat = ag.faturamento;
  const resultado = fat - ag.despesaTotal;

  const saida: Record<string, number | undefined> = {
    faturamento: fat,
    faturamento_dia: porDiaLancado(fat, ag.diasComReceita),
    despesa_total: ag.despesaTotal,
    resultado,
    margem: sobreFaturamento(resultado, fat),
    cmv: sobreFaturamento(doGrupo(ag, 'CMV'), fat),
    cmv_reais: doGrupo(ag, 'CMV'),
    dias_lancados: ag.diasComReceita,
    lancamentos: ag.lancamentos,
  };

  // Percentuais sobre faturamento para o que faz sentido comparar assim;
  // reais para o resto. Aluguel em porcentagem do faturamento sobe quando a
  // venda cai, e isso confunde mais do que ajuda num painel diário.
  for (const [grupo, metrica] of Object.entries(GRUPO_PARA_METRICA)) {
    const valor = doGrupo(ag, grupo);
    if (metrica === 'cmv') continue;
    const emPercentual = ['mao_de_obra', 'encargos', 'impostos'].includes(metrica);
    saida[metrica] = emPercentual ? sobreFaturamento(valor, fat) : valor;
  }

  return saida;
}

export async function analisarCliente(
  cfg: ClienteConfig,
  fonte: FonteFlow,
  data: DataISO,
  catalogo: DefMetrica[] = CATALOGO,
  /** Retratos de preço guardados pelo nosso banco. A API do Flow devolve só o
   *  cadastro de agora; o histórico é nosso. */
  historicoPrecos: RetratoPreco[] = [],
): Promise<RelatorioCliente> {
  const brutos = await fonte.buscar(cfg.id);
  const janela = janelaDoMes(data);

  // **Nada com data no futuro entra na análise.** Existe de verdade na
  // carteira: o Restaurante JK tem lançamentos em novembro de 2026, a Tenda
  // Aldeia em setembro, e outro cliente em 30/08. Provavelmente é mês ou ano
  // digitado errado. Eles saem de tudo — soma, série, preço, decomposição — e
  // reaparecem só no diagnóstico, como aviso de cadastro.
  const futuros = brutos.lancamentos.filter((l) => l.data > data);
  const dados = futuros.length
    ? { ...brutos, lancamentos: brutos.lancamentos.filter((l) => l.data <= data) }
    : brutos;

  const cache = new Map<DataISO, Record<string, number | undefined>>();
  const metricasEm = (d: DataISO) => {
    if (!cache.has(d)) cache.set(d, metricasDaJanela(dados.lancamentos, janelaDoMes(d)));
    return cache.get(d)!;
  };

  const ctx = {
    pisoRelevanciaReais: cfg.pisoRelevanciaReais ?? 200,
    comparaJanela: true,
    // A base nunca é anterior ao primeiro MÊS CHEIO. Duas armadilhas juntas:
    //
    //  - um mês em que o cliente ainda não usava o Flow tem faturamento zero, e
    //    zero como base transforma qualquer coisa em variação absurda;
    //  - o mês em que ele COMEÇOU a lançar é meio mês, e comparar mês inteiro
    //    com meio mês mede quando a consultoria entrou, não desempenho.
    //
    // E não dá para usar `datas[0]`: o King tem um lançamento de 2017 e o Aukai
    // tem de 2022 — um lançamento perdido desarmaria a trava inteira. Por isso
    // o começo vem do `inicioConfiavel`, que ignora o que está muito fora.
    dadosDesde: (() => {
      const datas = dados.lancamentos.map((l) => l.data).sort();
      // `data` como teto: lançamento com data no futuro (o JK tem dois em
      // novembro) não pode virar o começo do histórico.
      const inicio = inicioConfiavel(datas, 60, data);
      return inicio ? primeiroMesCheio(inicio) : undefined;
    })(),
    // O terceiro degrau da cascata: mês passado incompleto não vira base.
    // `dadosDesde` só sabe quando o cliente começou — não vê o mês que começou
    // cheio e teve duas semanas sem lançamento no meio.
    periodoUtilizavel: (d: DataISO) =>
      janelaEstaCompleta(dados.lancamentos, janelaDoMes(d)),
  };

  const base = escolherBase(data, (d) => {
    const v = metricasEm(d).faturamento;
    return v !== undefined && v > 0;
  }, ctx);

  const janelaBase = base.origem === 'nenhuma' ? undefined : janelaDoMes(base.data);

  // 1. O dado presta?
  const diagnostico = diagnosticar(dados.lancamentos, dados.insumos, janela, janelaBase, futuros);

  // 2. Está na régua?
  const metas = cfg.metas ?? META_PADRAO;
  const m = metricasEm(data);

  // O CMV real, quando o cliente conta estoque. É ele que vai para a régua:
  // no JK, "por compras" dizia 58,5% em agosto e a contagem do próprio cliente
  // dizia 45,0% — o cliente segue muito acima da meta de 30%, mas 58,5% era
  // exagero, e exagero num painel custa credibilidade na reunião.
  const real = cmvRealDoUltimo(dados.cmvRegistros, data);
  const realAnterior = cmvRealAnterior(dados.cmvRegistros, data);
  const mComRegua = real ? { ...m, cmv: real.valor } : m;

  const avaliacoes = ([
    ['cmv', real ? `CMV real (contagem de ${diaMes(real.data)})` : 'CMV por compras'],
    ['mao_de_obra', 'Mão de obra'],
    ['margem', 'Margem'],
    ['impostos', 'Impostos'],
  ] as Array<[string, string]>)
    .map(([chave, rotulo]) => avaliarMeta(chave, rotulo, mComRegua[chave], metas))
    .filter((x): x is AvaliacaoMeta => x !== null && x.situacao !== 'sem_meta');

  // 3. Piorou?
  const achados = varrer(catalogo, data, (metrica) => (d) => metricasEm(d)[metrica], ctx);

  // Um grupo com lançamento faltando não pode anunciar melhora. A folha do
  // Soffri sumiu inteira em agosto e a mão de obra "melhorou" 9,7 pontos no
  // dia 26 — melhora que evapora quando alguém lançar o salário.
  const grupoDaMetrica = Object.fromEntries(
    Object.entries(GRUPO_PARA_METRICA).map(([grupo, metrica]) => [metrica, grupo]),
  );
  for (const a of achados) {
    const grupo = grupoDaMetrica[a.metrica];
    const ausencia = diagnostico.ausencias.find((x) => x.grupo === grupo);
    if (!ausencia) continue;
    a.explicacao +=
      ` Ressalva: "${ausencia.sub}" não foi lançado neste período e valia ` +
      `${moeda(ausencia.valorAnterior)} no anterior — este número pode mudar.`;
    a.detalhe = { ...a.detalhe, lancamento_ausente: ausencia };
  }

  const explicacoes: Explicacao[] = [];
  if (janelaBase) {
    const agAgora = agregar(dados.lancamentos, janela);
    const agAntes = agregar(dados.lancamentos, janelaBase);

    for (const [grupo, rotulo] of [['CMV', 'CMV por compras'], ['Mão-de-Obra', 'Mão de obra']] as const) {
      // Grupo com reclassificação detectada não ganha ranking de ofensores. É
      // exatamente aqui que o painel apontaria "proteína bovina, +4,5 pontos"
      // para um dinheiro que só mudou de subcategoria.
      // Reclassificação invalida o ranking: apontaria o culpado errado.
      // Ausência não invalida — o próprio item ausente costuma ser o topo do
      // ranking, e é justamente ele que o consultor precisa ver.
      const suspeito = diagnostico.reclassificacoes.some((r) => r.grupo === grupo);
      const ausencia = diagnostico.ausencias.find((x) => x.grupo === grupo);
      const e = explicarIndicador(
        rotulo,
        doGrupo(agAntes, grupo), agAntes.faturamento,
        doGrupo(agAgora, grupo), agAgora.faturamento,
        suspeito ? {} : { subcategoria: { antes: subsDoGrupo(agAntes, grupo), agora: subsDoGrupo(agAgora, grupo) } },
      );
      if (!e || Math.abs(e.variacao) < 0.005) continue;
      if (suspeito) {
        e.narrativa += ` ${diagnostico.reclassificacoes.find((r) => r.grupo === grupo)!.explicacao}`;
      }
      if (ausencia) {
        e.narrativa +=
          ` Atenção: "${ausencia.sub}" não aparece neste período e valia ` +
          `${moeda(ausencia.valorAnterior)} no anterior. Boa parte desta variação ` +
          `pode ser lançamento pendente, não economia.`;
      }
      explicacoes.push(e);
    }
  }

  const gastos: ResultadoCompras = janelaBase
    ? variacoesDeCompra(dados.lancamentos, janelaBase, janela)
    : { altas: [], quedas: [], suspeitaDeRenomeacao: false };

  // Preço pago não depende de janela: cada compra é um evento datado. Mas
  // olhar o histórico inteiro traria alta de três meses atrás como se fosse
  // notícia — o recorte é a janela atual mais a base, quando existe.
  const desde = janelaBase ? janelaBase.inicio : janela.inicio;
  const precoPago = resumirPrecoPago(
    dados.lancamentos.filter((l) => l.data >= desde && l.data <= janela.fim),
    dados.insumos,
  );

  const decomposicao: ResultadoDecomposicao = janelaBase
    ? decomporCompras(dados.lancamentos, dados.insumos, janelaBase, janela)
    : { efeitos: [] };

  // O retrato de hoje entra junto com os guardados. Se já houver um do mesmo
  // dia, o de agora vence — recoletar o mesmo dia não pode inventar mudança.
  const porData = new Map<DataISO, RetratoPreco>();
  for (const r of [...historicoPrecos, ...(dados.retratosPreco ?? [])]) porData.set(r.data, r);
  porData.set(data, { data, insumos: dados.insumos });
  const precos = resumirPrecos([...porData.values()], data);

  const situacao: RelatorioCliente['situacao'] =
    dados.endpointsOk.length === 0 ? 'erro' : dados.endpointsErro.length ? 'parcial' : 'ok';

  return {
    clienteId: cfg.id,
    nome: cfg.nome,
    data,
    janela,
    janelaBase,
    situacao,
    endpointsErro: dados.endpointsErro,
    diagnostico,
    metas: avaliacoes,
    achados,
    explicacoes,
    precos,
    gastos,
    precoPago,
    decomposicao,
    cmvReal: real,
    cmvRealAnterior: realAnterior,
    // O CMV real entra junto das outras para ser guardado. Não é uma métrica
    // de janela — vem de contagem de estoque, que acontece quando o cliente
    // conta — e por isso não está no catálogo de indicadores vigiados.
    metricas: real ? { ...m, cmv_real: real.valor } : m,
    cmvRealIdadeDias: real ? idadeEmDias(real, data) : undefined,
    principais: {
      faturamento: m.faturamento ?? 0,
      cmv: real ? real.valor : m.cmv,
      cmvOrigem: real ? 'contagem' : 'compras',
      resultado: m.resultado ?? 0,
    },
      resumo: resumir(cfg, diagnostico, avaliacoes, achados, explicacoes, precos, agregar(dados.lancamentos, janela)),
  };
}

/** '2026-08-24' → '24/08'. */
const diaMes = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

const moeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function resumir(
  cfg: ClienteConfig,
  d: Diagnostico,
  metas: AvaliacaoMeta[],
  achados: Achado[],
  explicacoes: Explicacao[],
  precos: ResumoPrecos,
  ag: Agregado,
): string {
  const partes: string[] = [];

  // A ressalva vem primeiro. Quem lê tem de saber o quanto pode confiar antes
  // de ler o número, não depois.
  if (d.confianca !== 'alta') {
    partes.push(
      `${cfg.nome} — confiança ${d.confianca === 'baixa' ? 'BAIXA' : 'média'} no dado deste período.`,
    );
    partes.push(d.avisos[0]);
  } else {
    partes.push(`${cfg.nome}:`);
  }

  const fora = metas.filter((x) => x.situacao !== 'dentro');
  for (const x of fora.slice(0, 2)) {
    const custo = quantoCustaODesvio(x.distancia, ag.faturamento);
    partes.push(
      `${x.rotulo} em ${(x.valor * 100).toFixed(1).replace('.', ',')}% contra meta de ` +
      `${(x.alvo! * 100).toFixed(0)}%` +
      (custo ? ` — ${moeda(custo)} no período.` : '.'),
    );
  }

  const criticos = achados.filter((a) => a.severidade === 'critico');
  if (criticos.length) {
    partes.push(`${criticos.length} indicador${criticos.length === 1 ? '' : 'es'} piorou contra o período anterior:`);
    for (const a of criticos.slice(0, 3)) partes.push(`${a.titulo}.`);
  } else if (!fora.length) {
    partes.push('nada fora da régua nem pior que o período anterior.');
  }

  for (const e of explicacoes.slice(0, 1)) partes.push(e.narrativa);

  if (precos.altas.length) {
    const pior = precos.altas[0];
    partes.push(
      `${precos.altas.length} insumo${precos.altas.length === 1 ? '' : 's'} subiu de preço — ` +
      `maior alta: ${pior.nome}, ${moeda(pior.de)} para ${moeda(pior.para)} ` +
      `(${(pior.variacao * 100).toFixed(0)}%) em ${pior.detectadaEm}.`,
    );
  }

  const semBase = achados.filter((a) => a.severidade === 'sem_base');
  if (semBase.length === achados.length) {
    partes.push('Não há período anterior para comparar — só a régua vale nesta rodada.');
  }

  return partes.join(' ');
}
