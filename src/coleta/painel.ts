/**
 * De onde o painel tira os números.
 *
 * Decisão do Jamur: **a foto por padrão, com botão de atualizar.** Abrir o
 * painel lendo o Flow inteiro a cada carregamento — 5,5 MB, vinte e oito
 * restaurantes — funcionava com um cliente e não funciona com vinte e oito. A
 * rodada da madrugada já apura tudo; o painel mostra o que ela apurou, diz de
 * que horas é, e oferece reler um cliente quando alguém quiser.
 *
 * A leitura ao vivo continua existindo como reserva, e ela é o caminho normal
 * em dois casos: sem banco configurado (o desenvolvimento, contra o dump em
 * disco) e antes da primeira rodada do dia. Cair para o Flow é melhor que
 * mostrar tela vazia — mas o painel diz qual dos dois está vendo, porque
 * "ainda não rodou hoje" e "rodou e está assim" são coisas diferentes.
 */

import type { DataISO } from '../flow/tipos';
import { abrirCarteira, fonteDe, listarClientes } from './clientes';
import { analisarCliente, type RelatorioCliente } from './rodar';
import { lerRelatorio, lerRelatorios, temBanco } from '../db/supabase';

/**
 * Completa uma foto gravada por uma versão anterior do radar.
 *
 * O relatório guardado no banco é um **contrato entre versões**: a rodada de
 * hoje grava, e o painel de amanhã — já com código novo — lê. Campo que eu
 * acrescento hoje não existe nas fotos de ontem, e ler `undefined[0]` derruba
 * a página inteira. Foi o que aconteceu em 02/09/2026, quando `ultimosAtualizados`
 * entrou: o painel subiu quebrado até a rodada seguinte regravar as fotos.
 *
 * A alternativa seria versionar o payload e migrar. Para um relatório que é
 * regravado todo dia às 5h, completar o que falta na leitura custa menos e
 * falha melhor: no pior caso a seção nova fica vazia por um dia.
 */
export function completar(r: RelatorioCliente): RelatorioCliente {
  return {
    ...r,
    diagnostico: { ...r.diagnostico, periodoRecemComecado: r.diagnostico?.periodoRecemComecado ?? false },
    metricas: r.metricas ?? {},
    precos: {
      ...r.precos,
      altas: r.precos?.altas ?? [],
      quedas: r.precos?.quedas ?? [],
      suspeitas: r.precos?.suspeitas ?? [],
      quedasOcultas: r.precos?.quedasOcultas ?? 0,
      ultimosAtualizados: r.precos?.ultimosAtualizados ?? [],
    },
    precoPago: r.precoPago ?? {
      altas: [], quedas: [], ignoradasPorUnidade: 0,
      comprasSemQuantidade: 0, comprasTotal: 0,
    },
    decomposicao: r.decomposicao ?? { efeitos: [] },
    gastos: r.gastos ?? { altas: [], quedas: [], suspeitaDeRenomeacao: false },
  };
}

export interface Falha {
  clienteId: string;
  nome: string;
  erro: string;
}

export const falhou = (r: RelatorioCliente | Falha): r is Falha => 'erro' in r;

export interface CarteiraDoDia {
  relatorios: Array<RelatorioCliente | Falha>;
  /** 'banco' = a foto da rodada; 'ao_vivo' = lido do Flow agora. */
  fonte: 'banco' | 'ao_vivo';
  /** Quando a foto foi tirada. Só existe quando a fonte é o banco. */
  apuradoEm?: string;
}

export async function carregarCarteira(data: DataISO): Promise<CarteiraDoDia> {
  if (temBanco()) {
    const salvos = await lerRelatorios(data);
    if (salvos.length) {
      return {
        relatorios: salvos.map((s) => completar(s.relatorio)),
        fonte: 'banco',
        // O mais antigo, não o mais novo: se um cliente foi atualizado agora e
        // os outros são das 5h, dizer "atualizado agora" mentiria sobre
        // vinte e sete deles.
        apuradoEm: salvos.map((s) => s.apuradoEm).sort()[0],
      };
    }
  }
  return { relatorios: await aoVivo(data), fonte: 'ao_vivo' };
}

export interface ClienteDoDia {
  relatorio?: RelatorioCliente;
  erro?: string;
  fonte: 'banco' | 'ao_vivo';
  apuradoEm?: string;
}

export async function carregarCliente(id: string, data: DataISO): Promise<ClienteDoDia> {
  if (temBanco()) {
    const salvo = await lerRelatorio(id, data);
    if (salvo) {
      return { relatorio: completar(salvo.relatorio), fonte: 'banco', apuradoEm: salvo.apuradoEm };
    }
  }

  const carteira = abrirCarteira();
  const cliente = (await listarClientes(carteira)).find((c) => c.id === id);
  if (!cliente) return { erro: 'Cliente não encontrado no Flow.', fonte: 'ao_vivo' };

  try {
    return {
      relatorio: await analisarCliente(cliente, fonteDe(carteira), data),
      fonte: 'ao_vivo',
    };
  } catch (e) {
    return { erro: (e as Error).message, fonte: 'ao_vivo' };
  }
}

/**
 * A carteira inteira, lida do Flow agora.
 *
 * Não grava nada. Desenhar uma página não pode ter efeito colateral no banco:
 * quem grava é a rodada, e ela é disparada pelo cron ou pelo botão.
 */
async function aoVivo(data: DataISO): Promise<Array<RelatorioCliente | Falha>> {
  const carteira = abrirCarteira();
  const clientes = await listarClientes(carteira);
  return Promise.all(
    clientes.map(async (c): Promise<RelatorioCliente | Falha> => {
      try {
        return await analisarCliente(c, fonteDe(carteira), data);
      } catch (e) {
        return { erro: (e as Error).message, nome: c.nome, clienteId: c.id };
      }
    }),
  );
}

/** Só para o teste — o nome deixa claro que ninguém deve chamar isto em
 *  produção sem passar pelo carregamento. */
export { completar as completarParaTeste };
