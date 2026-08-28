/**
 * Do JSON do Flow para o que o radar entende.
 *
 * Este arquivo é a única parte do radar que sabe como o Flow guarda as coisas
 * por dentro. Foi o preço combinado quando trocamos a API pelo banco: ganhamos
 * a carteira inteira numa consulta e ganhamos `qtd`/`insumoId` nas compras, e
 * em troca passamos a depender de um formato que não é contrato público.
 *
 * Por isso `conferirEstrutura` existe. Se o Flow renomear um campo, o radar
 * precisa DIZER isso — a falha silenciosa aqui não seria uma tela vazia, seria
 * faturamento zerado com cara de mês ruim.
 *
 * Os nomes não batem com os da API, e a diferença não é cosmética:
 *
 *   API                        banco
 *   insumo.categoria           insumo.cat
 *   insumo.unidade             insumo.uni
 *   (não existia)              insumo.tipo, .comps, .estoqueAtual
 *   (não existia)              lancamento.qtd, .uni, .insumoId, .nfe
 */

import type {
  CmvRegistro, DadosFlow, Desperdicio, Ficha, Insumo, Lancamento,
} from './tipos';

/** Uma linha da tabela `organizacoes` do Flow. */
export interface OrganizacaoBruta {
  id: string;
  nome: string;
  atualizado_em?: string;
  /** JSONB. Vem como objeto pelo supabase-js e como texto quando a leitura
   *  passou por CSV. */
  dados: Record<string, unknown> | string;
}

export interface Organizacao {
  id: string;
  nome: string;
  atualizadoEm?: string;
  /** Restaurante de demonstração do próprio Flow — não é cliente. */
  demo: boolean;
  arquivado: boolean;
  dados: DadosFlow;
  /** O que veio fora do formato esperado. Vazio é o caso normal. */
  avisosDeEstrutura: string[];
}

/** O Flow guarda algumas coleções como lista e outras como objeto indexado por
 *  id, e isso varia com a idade do cadastro. Aceitar os dois é mais barato que
 *  descobrir a diferença em produção. */
function comoLista(x: unknown): Record<string, unknown>[] {
  if (Array.isArray(x)) return x.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  if (x && typeof x === 'object') return comoLista(Object.values(x as object));
  return [];
}

const num = (x: unknown): number | undefined => {
  const n = typeof x === 'string' ? Number(x.replace(',', '.')) : Number(x);
  return Number.isFinite(n) ? n : undefined;
};

const texto = (x: unknown): string | undefined => {
  const s = typeof x === 'string' ? x.trim() : '';
  return s || undefined;
};

/** Data em 'YYYY-MM-DD', sempre. Um lançamento com data em outro formato sairia
 *  de toda janela em silêncio — some da análise sem ninguém notar, que é o pior
 *  tipo de erro que este sistema pode ter. */
const data10 = (x: unknown): string => String(x ?? '').slice(0, 10);

export function lancamentoDe(b: Record<string, unknown>): Lancamento {
  const qtd = num(b.qtd);
  return {
    id: String(b.id ?? ''),
    data: data10(b.data),
    grupo: String(b.grupo ?? ''),
    sub: texto(b.sub),
    descricao: texto(b.descricao),
    valor: num(b.valor) ?? 0,
    forma: texto(b.forma),
    insumoId: texto(b.insumoId),
    // Quantidade zero ou negativa não serve para dividir. Deixar passar como 0
    // produziria preço unitário infinito na primeira conta.
    qtd: qtd !== undefined && qtd > 0 ? qtd : undefined,
    uni: texto(b.uni),
    nfe: texto(b.nfe),
    fornecedor: texto(b.fornecedor),
    importado: b.importado === true,
  };
}

export function insumoDe(b: Record<string, unknown>): Insumo {
  const comps = Array.isArray(b.comps)
    ? (b.comps as unknown[]).filter(Array.isArray).map((c) => {
        const [id, q, u] = c as unknown[];
        return [String(id ?? ''), num(q) ?? 0, texto(u)] as [string, number, string?];
      })
    : undefined;

  return {
    id: String(b.id ?? ''),
    nome: String(b.nome ?? ''),
    categoria: String(b.cat ?? ''),
    subcategoria: texto(b.sub),
    preco: num(b.preco),
    unidade: String(b.uni ?? ''),
    fornecedor: texto(b.fornecedor),
    tipo: texto(b.tipo) as Insumo['tipo'],
    comps: comps?.length ? comps : undefined,
    rendimento: num(b.rendimento),
    estoqueAtual: num(b.estoqueAtual),
    estoqueMin: num(b.estoqueMin),
    grupo: texto(b.grupo),
  };
}

function fichaDe(b: Record<string, unknown>): Ficha {
  return {
    id: String(b.id ?? ''),
    nome: String(b.nome ?? ''),
    cat: String(b.cat ?? ''),
    comps: Array.isArray(b.comps)
      ? (b.comps as unknown[]).filter(Array.isArray).map((c) => {
          const [id, q, u] = c as unknown[];
          return [String(id ?? ''), num(q) ?? 0, texto(u)] as [string, number, string?];
        })
      : [],
    precoVenda: num(b.precoVenda) ?? 0,
    precoIfood: num(b.precoIfood),
    vendasMes: num(b.vendasMes),
    porcoes: num(b.porcoes),
    rendGramas: num(b.rendGramas),
    rendUni: texto(b.rendUni),
    custoEmbalagem: num(b.custoEmbalagem),
  };
}

function cmvRegistroDe(b: Record<string, unknown>): CmvRegistro {
  return {
    id: String(b.id ?? ''),
    data: data10(b.data),
    ei: num(b.ei) ?? 0,
    ef: num(b.ef) ?? 0,
    compras: num(b.compras) ?? 0,
    vendas: num(b.vendas) ?? 0,
  };
}

function desperdicioDe(b: Record<string, unknown>): Desperdicio {
  return {
    id: String(b.id ?? ''),
    data: data10(b.data),
    nome: String(b.nome ?? ''),
    tipo: String(b.tipo ?? ''),
    refId: String(b.refId ?? ''),
    motivo: String(b.motivo ?? ''),
    acao: String(b.acao ?? ''),
    qtd: num(b.qtd),
    unidade: texto(b.unidade),
    custoUnit: num(b.custoUnit) ?? 0,
    custoTotal: num(b.custoTotal) ?? 0,
    responsavel: texto(b.responsavel),
  };
}

/**
 * Confere que o JSON ainda tem a forma que o radar espera.
 *
 * Não valida tudo — valida o que, se mudar, faz o radar mentir em vez de
 * quebrar. Chave que sumiu é barulho: um restaurante sem nenhum lançamento
 * legitimamente não tem `lancamentos`. O que é grave é campo que mudou de
 * nome DENTRO de um registro que existe.
 */
export function conferirEstrutura(dados: Record<string, unknown>): string[] {
  const avisos: string[] = [];

  const lancs = comoLista(dados.lancamentos);
  if (lancs.length) {
    for (const campo of ['data', 'grupo', 'valor'] as const) {
      const quantos = lancs.filter((l) => l[campo] !== undefined).length;
      if (quantos < lancs.length) {
        avisos.push(
          `lançamento sem "${campo}": ${lancs.length - quantos} de ${lancs.length}. ` +
          `Se o Flow renomeou o campo, todo número deste cliente está errado.`,
        );
      }
    }
    const comData = lancs.filter((l) => /^\d{4}-\d{2}-\d{2}/.test(String(l.data ?? '')));
    if (comData.length < lancs.length) {
      avisos.push(
        `${lancs.length - comData.length} lançamento(s) com data fora de 'AAAA-MM-DD' — ` +
        `esses somem de toda janela sem aparecer em lugar nenhum.`,
      );
    }
  }

  const insumos = comoLista(dados.insumos);
  if (insumos.length) {
    // `cat` e `uni` são os nomes internos. Se um dia virarem `categoria` e
    // `unidade` (os nomes da API), o mapeamento acima devolve string vazia
    // para tudo e ninguém percebe.
    for (const campo of ['cat', 'uni'] as const) {
      const quantos = insumos.filter((i) => i[campo] !== undefined).length;
      if (quantos === 0) {
        avisos.push(
          `nenhum insumo tem "${campo}" — o Flow deve ter renomeado o campo. ` +
          `O radar continua rodando, mas categoria e unidade saem vazias.`,
        );
      }
    }
  }

  return avisos;
}

/** Uma organização do Flow, pronta para análise. */
export function organizacaoDe(bruta: OrganizacaoBruta): Organizacao {
  let dados: Record<string, unknown>;
  try {
    dados = typeof bruta.dados === 'string'
      ? JSON.parse(bruta.dados)
      : (bruta.dados ?? {});
  } catch (e) {
    return {
      id: bruta.id,
      nome: bruta.nome,
      atualizadoEm: bruta.atualizado_em,
      demo: false,
      arquivado: false,
      dados: {
        clienteId: bruta.id, lancamentos: [], insumos: [],
        endpointsOk: [], endpointsErro: [`dados ilegíveis: ${(e as Error).message}`],
      },
      avisosDeEstrutura: [`o JSON de ${bruta.nome} não abriu`],
    };
  }

  const avisosDeEstrutura = conferirEstrutura(dados);

  // A leitura em si é sempre uma fonte lida. Sem isto, um restaurante que
  // ainda não lançou nada sairia com `endpointsOk` vazio, e `rodar.ts` traduz
  // isso como situação 'erro' — os onze clientes parados da carteira
  // apareceriam como falha de leitura em vez de cliente parado, que é
  // exatamente a informação que se quer ver.
  const endpointsOk: string[] = ['organizacoes'];
  const presente = (chave: string) => {
    const tem = comoLista(dados[chave]).length > 0;
    if (tem) endpointsOk.push(chave);
    return tem;
  };
  presente('lancamentos'); presente('insumos'); presente('fichas');
  presente('cmvRegistros'); presente('desperdicios');

  // `cmvAlvo` vem em porcentagem inteira (30), e as metas do radar são fração.
  const alvo = num(dados.cmvAlvo);

  return {
    id: bruta.id,
    nome: bruta.nome,
    atualizadoEm: bruta.atualizado_em,
    demo: dados._demo === true,
    arquivado: dados._arquivado === true,
    avisosDeEstrutura,
    dados: {
      clienteId: bruta.id,
      lancamentos: comoLista(dados.lancamentos).map(lancamentoDe),
      insumos: comoLista(dados.insumos).map(insumoDe),
      cmvAlvo: alvo !== undefined && alvo > 0 ? alvo / 100 : undefined,
      fichas: comoLista(dados.fichas).map(fichaDe),
      cmvRegistros: comoLista(dados.cmvRegistros).map(cmvRegistroDe),
      desperdicios: comoLista(dados.desperdicios).map(desperdicioDe),
      endpointsOk,
      // Estrutura estranha entra como erro de leitura: é o que faz o painel
      // marcar o cliente como 'parcial' em vez de mostrar número liso.
      endpointsErro: avisosDeEstrutura,
    },
  };
}
