/**
 * A carteira, lida do banco do Flow.
 *
 * Uma consulta devolve os 36 restaurantes. Não há token por cliente, não há
 * cadastro manual, e um restaurante criado hoje no Flow entra na rodada de
 * amanhã sozinho — que era o pedido: *"tenho 25 clientes dentro do flow e não
 * quero ficar cadastrando token"*.
 *
 * **Leitura por Postgres, não pelo supabase-js.** O acesso é o role
 * `radar_leitura`, com `grant select` só em `public.organizacoes`. A
 * alternativa seria a `service_role` do Flow, que dá escrita em tudo — para um
 * processo que só lê, é chave demais na mão de quem não precisa dela.
 *
 * Sobre volume: as 36 organizações somam 5,5 MB, e a maior tem 666 KB. Cabe
 * numa consulta. Quando não couber, o corte natural é por `atualizado_em` —
 * quem não mexeu no Flow desde a última rodada não mudou de número.
 */

import type { DadosFlow } from './tipos';
import type { FonteFlow } from './api';
import { organizacaoDe, type Organizacao, type OrganizacaoBruta } from './organizacao';

const CONSULTA = `
  select id, nome, atualizado_em, dados::text as dados
    from public.organizacoes
   order by nome
`;

export interface FonteCarteira {
  /** Todas as organizações, incluindo demo e arquivadas — quem filtra é quem
   *  chama, porque o painel de diagnóstico quer ver o que foi descartado. */
  organizacoes(): Promise<Organizacao[]>;
}

/**
 * Lê o Postgres do Flow uma vez e serve todos os clientes da mesma leitura.
 *
 * A rodada inteira compartilha uma instância. Se cada cliente abrisse a sua, a
 * carteira faria 36 consultas de 5,5 MB para responder o que uma responde.
 */
export class CarteiraFlow implements FonteCarteira, FonteFlow {
  private cache: Promise<Organizacao[]> | null = null;

  constructor(private conexao = process.env.FLOW_DATABASE_URL) {}

  organizacoes(): Promise<Organizacao[]> {
    if (!this.cache) this.cache = this.carregar();
    return this.cache;
  }

  private async carregar(): Promise<Organizacao[]> {
    if (!this.conexao) {
      throw new Error(
        'falta FLOW_DATABASE_URL — a connection string do Transaction pooler do ' +
        'Supabase do Flow, com o usuário radar_leitura',
      );
    }

    // Import dinâmico para o pacote não entrar no bundle do painel, que não
    // fala com o Flow — só lê o nosso banco.
    const { Client } = await import('pg');
    const cliente = new Client({
      connectionString: this.conexao,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 30_000,
    });

    await cliente.connect();
    try {
      // Sem parâmetro de tipo no `query`: uma interface do TypeScript não
      // satisfaz o `QueryResultRow` do pg (que exige índice de string), e o
      // erro que sai daí é longo e não ajuda ninguém.
      const { rows } = await cliente.query(CONSULTA);
      return (rows as OrganizacaoBruta[]).map(organizacaoDe);
    } finally {
      await cliente.end();
    }
  }

  async buscar(clienteId: string): Promise<DadosFlow> {
    const orgs = await this.organizacoes();
    const org = orgs.find((o) => o.id === clienteId);
    if (!org) {
      throw new Error(
        `${clienteId} não está no Flow — pode ter sido apagado desde a última rodada`,
      );
    }
    return org.dados;
  }
}

/**
 * A mesma carteira, lida de um arquivo exportado do SQL Editor do Flow
 * (Download CSV com `select id, nome, atualizado_em, dados::text from
 * organizacoes`).
 *
 * É como se investiga a carteira inteira sem credencial e sem rede, e é como
 * os testes rodam contra o dado real. O CSV do Supabase tem o JSON num campo
 * só, com aspas duplas escapadas — a leitura precisa ser de CSV de verdade,
 * não `split(',')`.
 */
export class CarteiraArquivo implements FonteCarteira, FonteFlow {
  private cache: Promise<Organizacao[]> | null = null;

  constructor(private caminho: string) {}

  organizacoes(): Promise<Organizacao[]> {
    if (!this.cache) this.cache = this.carregar();
    return this.cache;
  }

  private async carregar(): Promise<Organizacao[]> {
    const { readFile } = await import('node:fs/promises');
    const texto = await readFile(this.caminho, 'utf8');
    return lerCsv(texto).map((linha) =>
      organizacaoDe({
        id: linha.id ?? '',
        nome: linha.nome ?? '',
        atualizado_em: linha.atualizado_em,
        dados: linha.dados ?? '{}',
      }),
    );
  }

  async buscar(clienteId: string): Promise<DadosFlow> {
    const orgs = await this.organizacoes();
    const org = orgs.find((o) => o.id === clienteId || o.nome === clienteId);
    if (!org) throw new Error(`${clienteId} não está no arquivo ${this.caminho}`);
    return org.dados;
  }
}

/**
 * CSV como o Supabase exporta: vírgula, aspas duplas, `""` para aspas dentro
 * do campo, e o JSON inteiro num campo só.
 *
 * Escrito à mão porque a alternativa é uma dependência a mais para ler um
 * arquivo que só o desenvolvimento lê.
 */
export function lerCsv(texto: string): Array<Record<string, string>> {
  const campos: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let entreAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else entreAspas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') { entreAspas = true; continue; }
    if (c === ',') { linha.push(campo); campo = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { linha.push(campo); campos.push(linha); linha = []; campo = ''; continue; }
    campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); campos.push(linha); }

  const [cabecalho, ...resto] = campos;
  if (!cabecalho) return [];
  return resto
    .filter((l) => l.length > 1)
    .map((l) => Object.fromEntries(cabecalho.map((nome, i) => [nome, l[i] ?? ''])));
}
