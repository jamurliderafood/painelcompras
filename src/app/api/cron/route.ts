/**
 * A rodada de madrugada. O Vercel Cron chama /api/cron às 8h UTC (5h em
 * Brasília), quando o dia anterior já fechou no Flow.
 *
 * Um cliente que falha não derruba os outros: cada um é gravado como pôde, e
 * o painel mostra a situação da coleta ao lado do resultado. Análise sobre
 * coleta parcial sem avisar que foi parcial é pior do que análise nenhuma.
 */

import { listarClientes, fonteDe, hoje } from '../../../coleta/clientes';
import { analisarCliente } from '../../../coleta/rodar';
import { salvarRelatorio, salvarRetratoPrecos, lerRetratosPreco, temBanco } from '../../../db/supabase';


export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  const segredo = process.env.CRON_SECRET;
  const enviado = req.headers.get('authorization');
  if (segredo && enviado !== `Bearer ${segredo}`) {
    return Response.json({ erro: 'não autorizado' }, { status: 401 });
  }

  const url = new URL(req.url);
  // Hoje. A janela é o acumulado do mês, então o dia corrente entra
  // naturalmente — e o diagnóstico já desconta o próprio dia da conta de
  // dias sem lançamento.
  const data = url.searchParams.get('data') ?? hoje();

  const clientes = await listarClientes();
  const resultado: Array<Record<string, unknown>> = [];

  for (const cliente of clientes) {
    try {
      // O histórico de preços vem do nosso banco: a API do Flow só sabe o
      // cadastro de agora.
      const historico = temBanco() ? await lerRetratosPreco(cliente.id, data) : [];
      const fonte = fonteDe(cliente);
      const r = await analisarCliente(cliente, fonte, data, undefined, historico);
      if (temBanco()) {
        await salvarRelatorio(r);
        await salvarRetratoPrecos(cliente.id, data, (await fonte.buscar(cliente.id)).insumos);
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

  return Response.json({ data, clientes: resultado });
}
