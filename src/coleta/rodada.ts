/**
 * Uma rodada: analisar e guardar.
 *
 * Existe porque duas coisas precisam fazer exatamente o mesmo: o cron da
 * madrugada e o botão "atualizar agora" do painel. Enquanto era código solto
 * dentro da rota do cron, o botão teria de repetir a sequência de gravação — e
 * repetir sequência de gravação é como se produz banco com metade dos dados
 * atualizados.
 */

import type { DataISO } from '../flow/tipos';
import type { FonteFlow } from '../flow/api';
import { analisarCliente, janelaDoMes, type ClienteConfig, type RelatorioCliente } from './rodar';
import {
  lerRetratosPreco, salvarRelatorio, salvarRelatorioCompleto, salvarRetrato,
  salvarRetratoPrecos, temBanco,
} from '../db/supabase';

/**
 * Analisa um cliente e grava tudo que a rodada produz.
 *
 * Sem banco configurado, analisa e devolve — é como o painel roda em
 * desenvolvimento, contra o dump em disco.
 */
export async function rodarCliente(
  cliente: ClienteConfig,
  fonte: FonteFlow,
  data: DataISO,
): Promise<RelatorioCliente> {
  // Uma leitura por cliente. A versão anterior buscava duas vezes — uma para
  // analisar e outra para guardar os preços — e o payload vinha inteiro nas
  // duas.
  const dados = await fonte.buscar(cliente.id);
  const fonteJaLida: FonteFlow = { buscar: async () => dados };

  const historico = temBanco() ? await lerRetratosPreco(cliente.id, data) : [];
  const r = await analisarCliente(cliente, fonteJaLida, data, undefined, historico);

  if (temBanco()) {
    // As métricas vêm do relatório, não recalculadas daqui. Recalcular a
    // partir de `dados.lancamentos` guardava um número diferente do que a tela
    // mostra: a análise descarta lançamento com data no futuro, e a gravação
    // não descartava.
    await salvarRetrato(cliente.id, data, r.metricas);
    await salvarRetratoPrecos(cliente.id, data, dados.insumos);
    await salvarRelatorio(r);
    await salvarRelatorioCompleto(r);
  }

  return r;
}

export { janelaDoMes };
