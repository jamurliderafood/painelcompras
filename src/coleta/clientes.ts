/**
 * Quem está na carteira.
 *
 * Antes era a lista de variáveis `FLOW_TOKEN_*`: a API do Flow não tinha
 * endpoint que listasse organizações, então a carteira era o que estivesse
 * cadastrado à mão. Não escala e não era o que o Jamur queria.
 *
 * Agora a carteira é a tabela `organizacoes` do Flow, menos o que não é
 * cliente. Restaurante novo entra sozinho.
 *
 * **O que fica de fora, e só isso:**
 *
 *   - `_demo` — os seis restaurantes de demonstração do próprio Flow.
 *   - `_arquivado` — cliente que saiu. (`_arquivado: false` é comum e não
 *     exclui ninguém; e `status` vale `'ativo'` para as 36 organizações,
 *     inclusive as arquivadas, então `status` não serve de filtro.)
 *
 * **O que NÃO fica de fora: cliente sem lançamento nenhum.** Onze dos vinte e
 * oito clientes reais nunca lançaram nada. É tentador escondê-los para o
 * painel ficar limpo, mas cliente que parou de usar o Flow é exatamente a
 * ligação que o consultor precisa fazer — some da tela e some da cabeça. Eles
 * entram, e o diagnóstico diz que não há dado.
 */

import type { ClienteConfig } from './rodar';
import type { FonteFlow } from '../flow/api';
import { CarteiraArquivo, CarteiraFlow, type FonteCarteira } from '../flow/carteira';
import { META_PADRAO } from '../analise/metas';

/** Uma carteira por rodada, e não uma global.
 *
 *  A leitura são 5,5 MB, e guardá-la num módulo faria uma função morna da
 *  Vercel servir o dado de ontem na rodada de hoje — o pior defeito possível
 *  num sistema cujo trabalho é dizer o que mudou. */
export function abrirCarteira(): FonteCarteira & FonteFlow {
  const arquivo = process.env.DUMP_FLOW;
  if (arquivo) return new CarteiraArquivo(arquivo);
  return new CarteiraFlow();
}

export async function listarClientes(carteira: FonteCarteira): Promise<ClienteConfig[]> {
  const orgs = await carteira.organizacoes();

  const lista = orgs
    .filter((o) => !o.demo && !o.arquivado)
    .map((o) => ({
      id: o.id,
      nome: o.nome,
      // A meta de CMV é a que o cliente definiu no próprio Flow. Na carteira
      // real são 27 no padrão de 30% e um em 38% — os outros alvos que
      // aparecem no banco (28%, 31%, 33%, 35%, 36%) são dos restaurantes de
      // demonstração. Meta inventada por nós seria régua que o cliente nunca
      // aceitou.
      metas: o.dados.cmvAlvo
        ? { ...META_PADRAO, cmv: o.dados.cmvAlvo }
        : META_PADRAO,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  return desambiguar(lista);
}

/** A fonte de um cliente é a própria carteira: ela já leu tudo. */
export function fonteDe(carteira: FonteCarteira & FonteFlow): FonteFlow {
  return carteira;
}

/** Nomes repetidos no Flow ("A lenha" e "À Lenha", quatro "DuZeca") deixam o
 *  painel ambíguo. O dump de 27/08/2026 não tem nenhum, mas já teve — quando
 *  voltar a ter, o desempate é o que distingue, não um número sequencial. */
export function desambiguar(clientes: ClienteConfig[]): ClienteConfig[] {
  const quantos = new Map<string, number>();
  for (const c of clientes) quantos.set(c.nome, (quantos.get(c.nome) ?? 0) + 1);
  return clientes.map((c) =>
    (quantos.get(c.nome) ?? 0) > 1
      ? { ...c, nome: `${c.nome} (${c.id.slice(0, 6)})` }
      : c,
  );
}

export function hoje(fuso = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date());
}
