/**
 * A rodada diária. O Vercel Cron chama às 8h UTC — 5h de Brasília, quando o
 * dia anterior já fechou e ninguém está lançando.
 *
 * Um cliente que falha não derruba os outros: cada um é gravado como deu, e a
 * resposta diz o que aconteceu com cada um. Análise sobre coleta parcial sem
 * avisar que foi parcial é pior que análise nenhuma.
 */

import { listarClientes, fonteDe, hoje } from '../../../coleta/clientes';
import { analisarCliente, metricasDaJanela, janelaDoMes } from '../../../coleta/rodar';
import {
  lerRetratosPreco, salvarRelatorio, salvarRetratoPrecos, salvarRetrato, temBanco,
} from '../../../db/supabase';

export const dynamic = 'force-dynamic';

/**
 * O plano Hobby da Vercel limita função a 60 segundos. Com um punhado de
 * clientes sobra tempo; quando a carteira crescer, o caminho é chamar
 * `/api/cron?cliente=<id>` uma vez por cliente em vez de aumentar isto — o
 * limite é do plano, não do código.
 */
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const segredo = process.env.CRON_SECRET;
  const enviado = req.headers.get('authorization');
  if (segredo && enviado !== `Bearer ${segredo}`) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  const url = new URL(req.url);
  // Hoje. A janela é o acumulado do mês, então o dia corrente entra
  // naturalmente — e o diagnóstico já desconta o próprio dia da conta de dias
  // sem lançamento.
  const data = url.searchParams.get('data') ?? hoje();
  const so = url.searchParams.get('cliente');

  const clientes = (await listarClientes()).filter((c) => !so || c.id === so);
  const resultado: Array<Record<string, unknown>> = [];

  for (const cliente of clientes) {
    try {
      const fonte = fonteDe(cliente);
      // Uma leitura da API por cliente. A versão anterior buscava duas vezes
      // — uma para analisar e outra para guardar os preços — e o payload de
      // lançamentos vinha inteiro nas duas.
      const dados = await fonte.buscar(cliente.id);
      const fonteJaLida = { buscar: async () => dados };

      const historico = temBanco() ? await lerRetratosPreco(cliente.id, data) : [];
      const r = await analisarCliente(cliente, fonteJaLida, data, undefined, historico);

      if (temBanco()) {
        await salvarRetrato(cliente.id, data, metricasDaJanela(dados.lancamentos, janelaDoMes(data)));
        await salvarRetratoPrecos(cliente.id, data, dados.insumos);
        await salvarRelatorio(r);
      }

      resultado.push({
        cliente: cliente.id,
        situacao: r.situacao,
        confianca: r.diagnostico.confianca,
        cobertura: Number(r.diagnostico.cobertura.toFixed(2)),
        fora_da_meta: r.metas.filter((m) => m.situacao !== 'dentro').length,
        precos_mudaram: r.precos.altas.length + r.precos.quedas.length,
        criticos: r.achados.filter((a) => a.severidade === 'critico').length,
        atencao: r.achados.filter((a) => a.severidade === 'atencao').length,
        sem_base: r.achados.filter((a) => a.severidade === 'sem_base').length,
      });
    } catch (e) {
      resultado.push({ cliente: cliente.id, situacao: 'erro', erro: (e as Error).message });
    }
  }

  return Response.json({ data, gravado: temBanco(), clientes: resultado });
}
