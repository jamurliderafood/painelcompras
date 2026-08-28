/**
 * Gravação e leitura do histórico.
 *
 * A coleta escreve aqui todo dia e nunca apaga. É o que torna possível
 * responder "como estava em 26 de agosto do ano passado" mesmo depois de o
 * cliente ter mexido no cadastro, mudado preço ou trocado de sistema.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ClienteConfig, RelatorioCliente } from '../coleta/rodar';
import type { Insumo, RetratoPreco } from '../flow/tipos';


let cliente: SupabaseClient | null = null;

export function banco(): SupabaseClient {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  cliente = createClient(url, chave, { auth: { persistSession: false } });
  return cliente;
}

export function temBanco(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Cadastra a carteira no nosso banco antes de gravar qualquer coisa.
 *
 * As cinco tabelas de histórico têm chave estrangeira para `cliente(id)`, e o
 * `id` passou a ser o UUID da organização no Flow — que nunca esteve nessa
 * tabela. Enquanto a carteira era cadastrada à mão isso não incomodava; desde
 * que ela virou "o que estiver no Flow", ninguém preenche a lista, e a primeira
 * rodada com o banco ligado falharia vinte e oito vezes seguidas, uma por
 * cliente, com erro de chave estrangeira.
 *
 * Roda no começo de cada rodada, e não numa migração de uma vez só, porque
 * restaurante novo aparece no Flow sem avisar ninguém — é justamente o que a
 * troca de arquitetura comprou.
 */
export async function sincronizarClientes(clientes: ClienteConfig[]): Promise<void> {
  if (!clientes.length) return;

  const { error } = await banco().from('cliente').upsert(
    clientes.map((c) => ({ id: c.id, nome: c.nome, ativo: true })),
    { onConflict: 'id' },
  );
  if (error) throw new Error(`cliente: ${error.message}`);

  // A meta vem do `cmvAlvo` do Flow e pode mudar lá. Guardamos para o
  // histórico saber contra que régua o julgamento daquele dia foi feito — sem
  // isso, mudar a meta hoje reescreveria o passado.
  const { error: erroConfig } = await banco().from('cliente_config').upsert(
    clientes.map((c) => ({ cliente_id: c.id, metas: c.metas ?? {} })),
    { onConflict: 'cliente_id' },
  );
  if (erroConfig) throw new Error(`cliente_config: ${erroConfig.message}`);
}

/**
 * O relatório do dia, inteiro, como o painel o consome.
 *
 * `snapshot_metrica` e `achado` continuam sendo gravados — são a série, e
 * respondem "como o CMV andou nos últimos 90 dias". Mas desenhar a tela a
 * partir delas exigiria refazer em SQL a análise que já foi feita, e boa parte
 * do relatório (preço pago, decomposição, diagnóstico) não cabe naquele
 * formato. Guardar o relatório pronto é o que permite o painel abrir sem
 * reler o Flow.
 */
export async function salvarRelatorioCompleto(r: RelatorioCliente): Promise<void> {
  const { error } = await banco().from('relatorio').upsert({
    cliente_id: r.clienteId,
    data_ref: r.data,
    payload: r as unknown as Record<string, unknown>,
    apurado_em: new Date().toISOString(),
  }, { onConflict: 'cliente_id,data_ref' });
  if (error) throw new Error(`relatorio: ${error.message}`);
}

export interface RelatorioSalvo {
  relatorio: RelatorioCliente;
  apuradoEm: string;
}

/** Os relatórios de um dia, para a carteira. */
export async function lerRelatorios(data: string): Promise<RelatorioSalvo[]> {
  const { data: linhas, error } = await banco()
    .from('relatorio')
    .select('payload, apurado_em')
    .eq('data_ref', data);
  if (error) throw new Error(`relatorio: ${error.message}`);
  return (linhas ?? []).map((l: any) => ({
    relatorio: l.payload as RelatorioCliente,
    apuradoEm: l.apurado_em as string,
  }));
}

/** O relatório de um cliente num dia. */
export async function lerRelatorio(
  clienteId: string,
  data: string,
): Promise<RelatorioSalvo | undefined> {
  const { data: linhas, error } = await banco()
    .from('relatorio')
    .select('payload, apurado_em')
    .eq('cliente_id', clienteId)
    .eq('data_ref', data)
    .limit(1);
  if (error) throw new Error(`relatorio: ${error.message}`);
  const l = (linhas ?? [])[0] as any;
  return l ? { relatorio: l.payload as RelatorioCliente, apuradoEm: l.apurado_em } : undefined;
}

/** Grava as métricas apuradas. Separado da gravação dos achados de propósito:
 *  se a regra de análise mudar amanhã, dá para recalcular tudo sem pedir nada
 *  ao Flow. */
export async function salvarRetrato(
  clienteId: string,
  data: string,
  metricas: Record<string, number | undefined>,
): Promise<void> {
  const linhas = Object.entries(metricas)
    .filter(([, v]) => v !== undefined && Number.isFinite(v))
    .map(([metrica, valor]) => ({
      cliente_id: clienteId, data_ref: data, metrica, valor: valor as number,
    }));
  if (!linhas.length) return;
  const { error } = await banco().from('snapshot_metrica').upsert(linhas);
  if (error) throw new Error(`snapshot_metrica: ${error.message}`);
}

/** Guarda o cadastro de preços do dia. É o que torna possível dizer, amanhã,
 *  que um insumo mudou de preço hoje. */
export async function salvarRetratoPrecos(
  clienteId: string,
  data: string,
  insumos: Insumo[],
): Promise<void> {
  if (!insumos.length) return;
  const { error } = await banco().from('retrato_preco').upsert(
    insumos.map((i) => ({
      cliente_id: clienteId,
      data_ref: data,
      insumo_id: i.id,
      nome: i.nome,
      unidade: i.unidade,
      preco: i.preco ?? null,
      fornecedor: i.fornecedor ?? null,
      categoria: i.subcategoria ?? i.categoria ?? null,
    })),
    { onConflict: 'cliente_id,data_ref,insumo_id' },
  );
  if (error) throw new Error(`retrato_preco: ${error.message}`);
}

/** Os retratos guardados, do mais antigo para o mais novo. `dias` limita a
 *  leitura: o painel mostra as mudanças recentes, e carregar dois anos de
 *  cadastro para isso seria desperdício. */
export async function lerRetratosPreco(
  clienteId: string,
  ate: string,
  dias = 60,
): Promise<RetratoPreco[]> {
  const desde = new Date(Date.parse(ate) - dias * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await banco()
    .from('retrato_preco')
    .select('data_ref, insumo_id, nome, unidade, preco, fornecedor, categoria')
    .eq('cliente_id', clienteId)
    .gte('data_ref', desde)
    .lte('data_ref', ate)
    .order('data_ref');
  if (error) throw new Error(`retrato_preco: ${error.message}`);

  const porData = new Map<string, Insumo[]>();
  for (const linha of data ?? []) {
    const lista = porData.get(linha.data_ref) ?? [];
    lista.push({
      id: linha.insumo_id, nome: linha.nome, unidade: linha.unidade,
      preco: linha.preco ?? undefined, fornecedor: linha.fornecedor ?? undefined,
      categoria: linha.categoria ?? '', subcategoria: linha.categoria ?? undefined,
    });
    porData.set(linha.data_ref, lista);
  }
  return [...porData.entries()].map(([data_ref, insumos]) => ({ data: data_ref, insumos }));
}

export async function salvarRelatorio(r: RelatorioCliente): Promise<void> {
  const db = banco();

  const { error: erroColeta } = await db.from('coleta').upsert({
    cliente_id: r.clienteId,
    data_ref: r.data,
    situacao: r.situacao,
    fontes_erro: r.endpointsErro,
    detalhe_erro: r.endpointsErro.join('; ') || null,
    confianca: r.diagnostico.confianca,
    diagnostico: r.diagnostico as unknown as Record<string, unknown>,
    concluida_em: new Date().toISOString(),
  }, { onConflict: 'cliente_id,data_ref' });
  if (erroColeta) throw new Error(`coleta: ${erroColeta.message}`);

  const achados = r.achados.map((a) => ({
    cliente_id: r.clienteId,
    data_ref: r.data,
    metrica: a.metrica,
    severidade: a.severidade,
    titulo: a.titulo,
    explicacao: a.explicacao,
    valor_atual: a.valorAtual ?? null,
    valor_base: a.valorBase ?? null,
    data_base: a.dataBase || null,
    base_origem: a.baseOrigem,
    // A explicação do indicador viaja junto do achado dele: quem abre o
    // painel quer ver "subiu 3 pontos" e "por causa de quem" no mesmo lugar.
    detalhe: {
      ...a.detalhe,
      ...(explicacaoDe(r, a.metrica) ? { explicacao_detalhada: explicacaoDe(r, a.metrica) } : {}),
    },
  }));

  if (achados.length) {
    const { error } = await db.from('achado').upsert(achados, { onConflict: 'cliente_id,data_ref,metrica' });
    if (error) throw new Error(`achado: ${error.message}`);
  }
}

/** Casa um achado com a explicação correspondente, quando existe uma. */
function explicacaoDe(r: RelatorioCliente, metrica: string) {
  const rotulos: Record<string, string> = {
    cmv: 'CMV por compras',
    mao_de_obra: 'Mão de obra',
  };
  const rotulo = rotulos[metrica];
  return rotulo ? r.explicacoes.find((e) => e.indicador === rotulo) : undefined;
}
