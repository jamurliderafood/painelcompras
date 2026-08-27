/**
 * Gravação e leitura do histórico.
 *
 * A coleta escreve aqui todo dia e nunca apaga. É o que torna possível
 * responder "como estava em 26 de agosto do ano passado" mesmo depois de o
 * cliente ter mexido no cadastro, mudado preço ou trocado de sistema.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RelatorioCliente } from '../coleta/rodar';
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
