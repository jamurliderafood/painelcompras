/**
 * A ligação com o Flow.
 *
 * Um endereço só para toda a carteira — o Flow é multi-cliente numa base só, e
 * quem separa um restaurante do outro é o token. Cada organização tem o seu,
 * gerado no painel de admin do Flow (o restaurante → API de integração).
 *
 * Sobre volume: `/v1/lancamentos` devolve tudo, sem filtro de data, e o
 * recorte é feito aqui dentro. Para o Soffri são 1.009 lançamentos — 228 KB.
 * Quando algum cliente passar de umas dezenas de milhares, vale pedir um
 * parâmetro de data no endpoint em vez de inventar paginação do nosso lado.
 */

import type { DadosFlow, Insumo, Lancamento, ResumoFlow, RetratoPreco } from './tipos';

export const FLOW_API_BASE =
  'https://fvcbxorfstqqeewocxkf.supabase.co/functions/v1/flow-api';

export interface FonteFlow {
  buscar(clienteId: string): Promise<DadosFlow>;
}

export function nomeDaVariavel(clienteId: string): string {
  return `FLOW_TOKEN_${clienteId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export class FlowAPI implements FonteFlow {
  constructor(
    private tokenDe: (clienteId: string) => string | undefined = (id) =>
      process.env[nomeDaVariavel(id)],
    private base = process.env.FLOW_API_BASE ?? FLOW_API_BASE,
  ) {}

  async buscar(clienteId: string): Promise<DadosFlow> {
    const token = this.tokenDe(clienteId);
    if (!token) {
      throw new Error(
        `falta o token do Flow de ${clienteId}: defina ${nomeDaVariavel(clienteId)} ` +
        `com o token gerado em Flow → admin → o restaurante → API de integração`,
      );
    }

    const endpointsOk: string[] = [];
    const endpointsErro: string[] = [];

    // Um endpoint que falha não derruba os outros. Sem os lançamentos não há
    // análise nenhuma; sem os insumos, só a checagem de cadastro fica de fora.
    const ler = async <T>(caminho: string, vazio: T): Promise<T> => {
      try {
        const r = await this.get<T>(caminho, token);
        endpointsOk.push(caminho);
        return r;
      } catch (e) {
        endpointsErro.push(`${caminho}: ${(e as Error).message}`);
        return vazio;
      }
    };

    const [lanc, prod, resumo] = await Promise.all([
      ler<{ lancamentos?: Lancamento[] }>('/v1/lancamentos', {}),
      ler<{ produtos?: Insumo[] }>('/v1/produtos', {}),
      ler<ResumoFlow | undefined>('/v1/resumo', undefined),
    ]);

    return {
      clienteId,
      lancamentos: (lanc.lancamentos ?? []).map(normalizar),
      insumos: prod.produtos ?? [],
      resumo: resumo?.ok ? resumo : undefined,
      endpointsOk,
      endpointsErro,
    };
  }

  private async get<T>(caminho: string, token: string): Promise<T> {
    let ultimoErro: unknown;

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const controle = new AbortController();
      const relogio = setTimeout(() => controle.abort(), 30_000);
      try {
        const resp = await fetch(`${this.base}${caminho}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: controle.signal,
        });
        if (resp.status === 429 || resp.status >= 500) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** tentativa));
          ultimoErro = new Error(`HTTP ${resp.status}`);
          continue;
        }
        if (resp.status === 401 || resp.status === 403) {
          throw new Error('token recusado — pode ter sido revogado no Flow');
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()) as T;
      } catch (e) {
        ultimoErro = e;
        if ((e as Error).message.startsWith('token recusado')) break;
      } finally {
        clearTimeout(relogio);
      }
    }
    throw ultimoErro instanceof Error ? ultimoErro : new Error('falha desconhecida');
  }
}

/** Data em 'YYYY-MM-DD' e valor numérico, sempre. Um lançamento com data em
 *  outro formato sairia de toda janela em silêncio — some da análise sem
 *  ninguém notar, que é o pior tipo de erro que este sistema pode ter. */
function normalizar(l: Lancamento): Lancamento {
  return {
    ...l,
    data: String(l.data ?? '').slice(0, 10),
    valor: Number(l.valor) || 0,
    sub: l.sub?.trim() || undefined,
  };
}

/**
 * Fonte que lê as respostas salvas em arquivo. É como os testes rodam contra
 * dado real sem token e sem rede, e como dá para investigar um cliente sem
 * bater na API a cada tentativa.
 *
 * Além de `flow-produtos.json`, recolhe qualquer `flow-produtos-AAAA-MM-DD.json`
 * na mesma pasta e monta o histórico de preços com eles — assim dá para
 * conferir a detecção de mudança de preço sem esperar dois dias de coleta.
 */
export class FonteArquivo implements FonteFlow {
  constructor(private pasta: string, private id = 'arquivo') {}

  async buscar(clienteId: string): Promise<DadosFlow> {
    const { readFile, readdir } = await import('node:fs/promises');
    const ler = async (nome: string) => {
      try {
        return JSON.parse(await readFile(`${this.pasta}/${nome}`, 'utf8'));
      } catch {
        return {};
      }
    };
    const [lanc, prod, resumo] = await Promise.all([
      ler('flow-lancamentos.json'), ler('flow-produtos.json'), ler('flow-resumo.json'),
    ]);

    const retratosPreco: RetratoPreco[] = [];
    try {
      const arquivos = (await readdir(this.pasta))
        .filter((n) => /^flow-produtos-\d{4}-\d{2}-\d{2}\.json$/.test(n))
        .sort();
      for (const nome of arquivos) {
        const conteudo = await ler(nome);
        retratosPreco.push({
          data: nome.slice('flow-produtos-'.length, -'.json'.length),
          insumos: conteudo.produtos ?? [],
        });
      }
    } catch {
      // Pasta sem retratos datados é o caso normal na primeira rodada.
    }

    return {
      clienteId: clienteId || this.id,
      lancamentos: (lanc.lancamentos ?? []).map(normalizar),
      insumos: prod.produtos ?? [],
      resumo: resumo?.ok ? resumo : undefined,
      retratosPreco,
      endpointsOk: ['arquivo'],
      endpointsErro: [],
    };
  }
}
