/**
 * A carteira: um cartão por cliente, o mínimo para decidir com quem falar.
 *
 * Três números, os produtos cuja compra mais mudou, e um link. Tudo o mais —
 * diagnóstico do dado, decomposição, indicador por indicador — mora na página
 * do cliente. A regra aqui é: se não muda a decisão de para quem ligar hoje,
 * não entra.
 */

import { listarClientes, fonteDe, hoje } from '../coleta/clientes';
import { analisarCliente, type RelatorioCliente } from '../coleta/rodar';

export const dynamic = 'force-dynamic';

type Falha = { erro: string; nome: string; clienteId: string };
const falhou = (r: RelatorioCliente | Falha): r is Falha => 'erro' in r;

const moeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

export default async function Painel({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const { data: dataParam } = await searchParams;
  const data = dataParam ?? hoje();

  const clientes = await listarClientes();
  const relatorios = await Promise.all(
    clientes.map(async (c): Promise<RelatorioCliente | Falha> => {
      try {
        return await analisarCliente(c, fonteDe(c), data);
      } catch (e) {
        return { erro: (e as Error).message, nome: c.nome, clienteId: c.id };
      }
    }),
  );

  // Ordem: com quem falar primeiro. Dado ruim pesa porque, nesse caso, não se
  // sabe se piorou — e descobrir isso é mais urgente que qualquer variação.
  const gravidade = (r: RelatorioCliente) =>
    r.metas.filter((m) => m.situacao === 'muito_acima').length * 20 +
    r.achados.filter((a) => a.severidade === 'critico').length * 10 +
    r.metas.filter((m) => m.situacao === 'acima').length * 5 +
    (r.diagnostico.confianca === 'baixa' ? 15 : r.diagnostico.confianca === 'media' ? 5 : 0);

  const ok = relatorios.filter((r): r is RelatorioCliente => !falhou(r))
    .sort((a, b) => gravidade(b) - gravidade(a));
  const falhos = relatorios.filter(falhou);

  return (
    <>
      <h1>Carteira em {data.split('-').reverse().join('/')}</h1>
      <p className="legenda">
        Acumulado do mês contra o mesmo intervalo do ano passado — ou do mês passado,
        quando o ano passado não existe. Clique no cliente para o detalhe.
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
                <strong>{moeda(r.principais.faturamento)}</strong>
              </div>
              <div className="numero">
                <span className="rotulo">CMV</span>
                <strong className={meta && meta.situacao !== 'dentro' ? 'critico' : ''}>
                  {r.principais.cmv !== undefined ? pct(r.principais.cmv) : '—'}
                </strong>
                {meta?.alvo !== undefined && (
                  <span className="rotulo">meta {pct(meta.alvo)}</span>
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

      {ok.length === 0 && falhos.length === 0 && (
        <div className="cartao">
          Nenhum cliente na carteira. Um cliente entra com uma variável
          <code> FLOW_TOKEN_&lt;NOME&gt;</code>, com o token gerado no Flow em
          admin → o restaurante → API de integração.
        </div>
      )}
    </>
  );
}
