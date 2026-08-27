/**
 * A carteira.
 *
 * O Flow é multi-cliente numa base só, mas a API separa por token: cada
 * restaurante tem o seu, gerado no painel de admin. Não existe endpoint que
 * liste as organizações — então quem define a carteira do radar é a lista de
 * tokens configurados.
 *
 * Um cliente entra assim, e só assim:
 *
 *   FLOW_TOKEN_SOFFRI_GRILL=flow_xxxxxxxx
 *   FLOW_NOME_SOFFRI_GRILL=Soffri Grill        (opcional, embeleza o painel)
 *   FLOW_METAS_SOFFRI_GRILL={"cmv":0.32}       (opcional, senão vale o padrão)
 *
 * Com `SUPABASE_URL` presente, a carteira vem do nosso banco em vez da
 * variável de ambiente — que é para onde isso deve migrar quando passar de
 * uma dúzia de clientes.
 */

import type { ClienteConfig } from './rodar';
import type { FonteFlow } from '../flow/api';
import { FlowAPI, FonteArquivo } from '../flow/api';
import { META_PADRAO } from '../analise/metas';

const PREFIXO = 'FLOW_TOKEN_';

/** SOFFRI_GRILL → Soffri Grill */
function titulo(sufixo: string): string {
  return sufixo.toLowerCase().split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

function daEnv(): ClienteConfig[] {
  return Object.keys(process.env)
    .filter((chave) => chave.startsWith(PREFIXO) && process.env[chave])
    .map((chave) => {
      const sufixo = chave.slice(PREFIXO.length);
      let metas = META_PADRAO;
      const bruto = process.env[`FLOW_METAS_${sufixo}`];
      if (bruto) {
        try {
          metas = JSON.parse(bruto);
        } catch {
          // Meta mal escrita não pode derrubar a carteira inteira — o cliente
          // entra com a meta padrão e o painel mostra qual é.
        }
      }
      return {
        id: sufixo.toLowerCase().replace(/_/g, '-'),
        nome: process.env[`FLOW_NOME_${sufixo}`] ?? titulo(sufixo),
        metas,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function listarClientes(): Promise<ClienteConfig[]> {
  if (process.env.SUPABASE_URL) {
    const { banco } = await import('../db/supabase');
    const { data, error } = await banco()
      .from('cliente')
      .select('id, nome, cliente_config(*)')
      .eq('ativo', true)
      .order('nome');
    if (error) throw new Error(`não consegui ler a carteira: ${error.message}`);
    return (data ?? []).map((c: any) => ({
      id: c.id,
      nome: c.nome,
      metas: c.cliente_config?.metas ?? META_PADRAO,
      pisoRelevanciaReais: c.cliente_config?.piso_relevancia_reais ?? 200,
    }));
  }

  const daVariavel = daEnv();
  if (daVariavel.length) return daVariavel;

  // Sem token nenhum configurado, resta a leitura por arquivo — é como o
  // painel fica de pé para conferência antes de as credenciais existirem.
  if (process.env.FONTE === 'arquivo') {
    return [{ id: 'soffri-grill', nome: 'Soffri Grill', metas: META_PADRAO }];
  }
  return [];
}

/** `FONTE=arquivo` lê as respostas salvas em `PASTA_FLOW` em vez de bater na
 *  API — investiga um cliente sem gastar chamada e sem o token na máquina. */
export function fonteDe(_cliente: ClienteConfig): FonteFlow {
  if (process.env.FONTE === 'arquivo') {
    return new FonteArquivo(process.env.PASTA_FLOW ?? process.cwd());
  }
  return new FlowAPI();
}

export function hoje(fuso = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());
}
