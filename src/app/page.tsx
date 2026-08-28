/**
 * A carteira: um cartão por cliente, o mínimo para decidir com quem falar.
 *
 * Três números, os produtos cuja compra mais mudou, e um link. Tudo o mais —
 * diagnóstico do dado, decomposição, indicador por indicador — mora na página
 * do cliente. A regra aqui é: se não muda a decisão de para quem ligar hoje,
 * não entra.
 */

import { hoje } from '../coleta/clientes';
import { carregarCarteira, falhou, type Falha } from '../coleta/painel';
import type { RelatorioCliente } from '../coleta/rodar';

export const dynamic = 'force-dynamic';

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

/** '2026-08-24' → '24/08'. */
const diaMes = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

export default async function Painel({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const { data: dataParam } = await searchParams;
  const data = dataParam ?? hoje();

  const { relatorios, fonte, apuradoEm } = await carregarCarteira(data);

  // Ordem: com quem falar primeiro. Dado ruim pesa porque, nesse caso, não se
  // sabe se piorou — e descobrir isso é mais urgente que qualquer variação.
  const gravidade = (r: RelatorioCliente) =>
    r.metas.filter((m) => m.situacao === 'muito_acima').length * 20 +
    r.achados.filter((a) => a.severidade === 'critico').length * 10 +
    r.metas.filter((m) => m.situacao === 'acima').length * 5 +
    (r.diagnostico.confianca === 'baixa' ? 15 : r.diagnostico.confianca === 'media' ? 5 : 0);

  const lidos = relatorios.filter((r): r is RelatorioCliente => !falhou(r));
  const falhos = relatorios.filter(falhou);

  // Cliente que não lançou receita nenhuma no período não tem número para pôr
  // no cartão — e são muitos: dezenove dos vinte e oito da carteira em
  // 27/08/2026. Misturados na lista, o peso de "confiança baixa" os promovia
  // em bloco e empurrava para baixo quem tem problema medido (o Sabor Mineiro,
  // 38,4% de CMV contra meta de 30%, caía para a décima posição, atrás de três
  // clientes sem dado nenhum).
  //
  // Não somem: viram uma faixa no rodapé. Cliente que parou de lançar é
  // exatamente a ligação que precisa ser feita — só não é a mesma conversa de
  // quem está com o CMV estourado.
  // Sem receita lançada E sem contagem de estoque. A contagem carrega as
  // próprias vendas, então um cliente pode ter CMV medido sem lançar receita
  // nenhuma — é o caso da DuZeca Pizzaria, com CMV real de 37,7% e nenhum
  // lançamento de receita. Mandá-la para o rodapé esconderia justamente o
  // número que ela tem.
  const temNumero = (r: RelatorioCliente) =>
    r.diagnostico.diasComReceita > 0 || r.cmvReal !== undefined;

  const semLancamento = lidos.filter((r) => !temNumero(r));
  const ok = lidos.filter(temNumero)
    .sort((a, b) => gravidade(b) - gravidade(a));

  return (
    <>
      <h1>Carteira em {data.split('-').reverse().join('/')}</h1>
      <p className="legenda">
        Acumulado do mês contra o mesmo intervalo do ano passado — ou do mês passado,
        quando o ano passado não existe. Clique no cliente para o detalhe.
      </p>
      <p className="legenda">
        {/* De que horas são os números. "Rodou e está assim" e "ainda não rodou
            hoje" são coisas diferentes, e quem lê precisa saber qual das duas
            está vendo antes de ligar para o cliente. */}
        {fonte === 'banco' && apuradoEm
          ? <>Números apurados às {hora(apuradoEm)}. Para reler o Flow de um cliente, abra o detalhe dele.</>
          : <>Lido do Flow agora — a rodada de hoje ainda não passou por aqui.</>}
      </p>

      {falhos.map((f) => (
        <div className="cartao" key={f.clienteId}>
          <div className="cabecalho-cartao">
            <h3>{f.nome}</h3>
            <span className="selo critico">coleta falhou</span>
          </div>
          <p className="legenda">{f.erro}</p>
        </div>
      ))}

      {ok.map((r) => {
        const meta = r.metas.find((m) => m.metrica === 'cmv');
        const conf = r.diagnostico.confianca;
        const foraDaMeta = r.metas.filter((m) => m.situacao !== 'dentro').length;
        const piorou = r.achados.filter((a) => a.severidade === 'critico').length;

        return (
          <a className="cartao cartao-link" href={`/cliente/${r.clienteId}?data=${data}`} key={r.clienteId}>
            <div className="cabecalho-cartao">
              <h3>{r.nome}</h3>
              <div className="selos">
                {conf !== 'alta' && (
                  <span className={`selo ${conf === 'baixa' ? 'critico' : 'atencao'}`}>
                    dado {conf === 'baixa' ? 'ruim' : 'médio'}
                  </span>
                )}
                {foraDaMeta > 0 && <span className="selo critico">fora da meta</span>}
                {piorou > 0 && <span className="selo atencao">{piorou} piorou</span>}
                {conf === 'alta' && !foraDaMeta && !piorou && (
                  <span className="selo melhorou">em ordem</span>
                )}
              </div>
            </div>

            <div className="numeros">
              <div className="numero">
                <span className="rotulo">Faturamento</span>
                {/* Faturamento zero num cliente que tem contagem não é
                    faturamento zero — é receita não lançada. Um "R$ 0" grande
                    ao lado de um CMV medido leria como casa parada. */}
                <strong>
                  {r.diagnostico.diasComReceita > 0 ? moeda(r.principais.faturamento) : '—'}
                </strong>
                {r.diagnostico.diasComReceita === 0 && (
                  <span className="rotulo">receita não lançada</span>
                )}
              </div>
              <div className="numero">
                {/* "CMV" sozinho mentia por omissão: era CMV POR COMPRAS, que
                    mede o que a casa comprou, não o que consumiu. No JK a
                    diferença chegou a 13,5 pontos num mês. O rótulo agora diz
                    de onde o número saiu, e a contagem diz de quando é. */}
                <span className="rotulo">
                  {r.principais.cmvOrigem === 'contagem'
                    ? `CMV real · contagem de ${diaMes(r.cmvReal!.data)}`
                    : 'CMV por compras'}
                </span>
                <strong className={meta && meta.situacao !== 'dentro' ? 'critico' : ''}>
                  {r.principais.cmv !== undefined ? pct(r.principais.cmv) : '—'}
                </strong>
                {meta?.alvo !== undefined && (
                  <span className="rotulo">meta {pct(meta.alvo)}</span>
                )}
                {r.principais.cmvOrigem === 'contagem' && r.cmvRealIdadeDias! > 45 && (
                  <span className="rotulo">contagem de {r.cmvRealIdadeDias} dias atrás</span>
                )}
              </div>
              <div className="numero">
                <span className="rotulo">Resultado</span>
                <strong className={r.principais.resultado < 0 ? 'critico' : ''}>
                  {moeda(r.principais.resultado)}
                </strong>
              </div>
            </div>

            {r.precos.retratos < 2 ? (
              <p className="linha-compras legenda">
                Primeira coleta deste cliente — o preço de insumo é comparado entre
                coletas, então a partir da próxima rodada o radar mostra o que mudou.
              </p>
            ) : r.precos.altas.length === 0 && r.precos.quedas.length === 0 ? (
              <p className="linha-compras legenda">
                Nenhum insumo mudou de preço desde {r.precos.primeiroRetrato}.
              </p>
            ) : (
              <p className="linha-compras">
                <span className="rotulo">Preço de insumo:</span>{' '}
                {r.precos.altas.slice(0, 3).map((m, i) => (
                  <span key={m.insumoId}>
                    {i > 0 && ' · '}
                    {m.nome} <strong className="critico">+{pct(m.variacao)}</strong>
                    <span className="rotulo"> em {m.detectadaEm.slice(8)}/{m.detectadaEm.slice(5, 7)}</span>
                  </span>
                ))}
                {r.precos.quedas.length > 0 && (
                  <>
                    {r.precos.altas.length > 0 && ' · '}
                    <span className="melhorou">
                      {r.precos.quedas.length} em queda
                    </span>
                  </>
                )}
              </p>
            )}

            <span className="ver-detalhe">ver detalhe →</span>
          </a>
        );
      })}

      {semLancamento.length > 0 && (
        <div className="cartao">
          <div className="cabecalho-cartao">
            <h3>
              {semLancamento.length} cliente{semLancamento.length === 1 ? '' : 's'} sem
              receita lançada no período
            </h3>
            <span className="selo atencao">nada a analisar</span>
          </div>
          <p className="legenda">
            Não há número para comparar enquanto não houver lançamento. É a
            conversa de <em>voltar a usar o Flow</em>, não a de resultado.
          </p>
          <p className="linha-compras">
            {semLancamento
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((r, i) => (
                <span key={r.clienteId}>
                  {i > 0 && ' · '}
                  <a href={`/cliente/${r.clienteId}?data=${data}`}>{r.nome}</a>
                </span>
              ))}
          </p>
        </div>
      )}

      {ok.length === 0 && semLancamento.length === 0 && falhos.length === 0 && (
        <div className="cartao">
          Nenhum cliente na carteira. Ela vem da tabela <code>organizacoes</code> do
          Flow — se está vazia, falta <code>FLOW_DATABASE_URL</code> (a connection
          string do Transaction pooler, com o usuário <code>radar_leitura</code>),
          ou o banco respondeu só com restaurantes de demonstração e arquivados.
        </div>
      )}
    </>
  );
}
