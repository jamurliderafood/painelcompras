/**
 * Um cliente por inteiro, na ordem em que se deve ler:
 * o dado presta → está na régua → piorou.
 */

import { listarClientes, fonteDe, hoje } from '../../../coleta/clientes';
import { analisarCliente } from '../../../coleta/rodar';
import { formatar } from '../../../analise/varredura';
import { POR_CHAVE } from '../../../analise/catalogo';
import { quantoCustaODesvio } from '../../../analise/metas';
import { NOME_DIA } from '../../../analise/janela';

export const dynamic = 'force-dynamic';

const pontos = (v: number) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2).replace('.', ',')} pt`;
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;
const br = (d: string) => d.split('-').reverse().join('/');

const ORIGEM: Record<string, string> = {
  ano_anterior: 'ano passado', mes_anterior: 'mês passado', nenhuma: '—',
};

export default async function Cliente({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ data?: string }>;
}) {
  const { id } = await params;
  const { data: dataParam } = await searchParams;
  const data = dataParam ?? hoje();

  const cliente = (await listarClientes()).find((c) => c.id === id);
  if (!cliente) return <p>Cliente não encontrado.</p>;

  const r = await analisarCliente(cliente, fonteDe(cliente), data);
  const d = r.diagnostico;

  const piorou = r.achados.filter((a) => ['critico', 'atencao'].includes(a.severidade));
  const resto = r.achados.filter((a) => !['critico', 'atencao'].includes(a.severidade));
  const faturamento = r.achados.find((a) => a.metrica === 'faturamento')?.valorAtual ?? 0;

  return (
    <>
      <h1>{r.nome}</h1>
      <p className="legenda">
        {br(r.janela.inicio)} a {br(r.janela.fim)}
        {r.janelaBase
          ? ` · comparado com ${br(r.janelaBase.inicio)} a ${br(r.janelaBase.fim)}`
          : ' · sem período anterior para comparar'}
      </p>
      <p className="resumo">{r.resumo}</p>

      {r.situacao === 'parcial' && (
        <p className="aviso">Coleta parcial — {r.endpointsErro.join('; ')}.</p>
      )}

      {/* 1 ─────────────────────────────────────────────────────────────── */}
      <h2>
        1 · O dado presta?{' '}
        <span className={d.confianca === 'alta' ? 'melhorou' : d.confianca === 'baixa' ? 'critico' : 'atencao'}>
          confiança {d.confianca === 'media' ? 'média' : d.confianca}
        </span>
      </h2>
      <div className="cartao">
        <div className="efeitos">
          <div className="efeito">
            <div className="rotulo">Dias com receita lançada</div>
            <div className="valor">{d.diasComReceita} / {d.diasEsperados}</div>
          </div>
          <div className="efeito">
            <div className="rotulo">Cobertura</div>
            <div className={`valor ${d.cobertura < 0.8 ? 'critico' : ''}`}>{pct(d.cobertura)}</div>
          </div>
          <div className="efeito">
            <div className="rotulo">Insumos sem preço</div>
            <div className="valor">{d.insumosSemPreco} / {d.insumosTotal}</div>
          </div>
        </div>

        {d.avisos.length === 0 ? (
          <p className="resumo">Nada a apontar no dado deste período.</p>
        ) : (
          d.avisos.map((a, i) => <p className="aviso" key={i}>{a}</p>)
        )}

        {d.lacunas.length > 0 && (
          <p className="legenda">
            Dias sem lançamento: {d.lacunas.map(br).join(', ')}.
            {d.diasFechados.length > 0 &&
              ` Não contamos ${d.diasFechados.map((x) => NOME_DIA[x]).join(' e ')}, que a casa não abre.`}
          </p>
        )}
      </div>

      {/* 2 ─────────────────────────────────────────────────────────────── */}
      <h2>2 · Está na régua?</h2>
      <div className="cartao">
        {r.metas.length === 0 ? (
          <p className="resumo">
            Nenhuma meta cadastrada para este cliente. Com histórico curto, a régua é o que
            entrega valor — vale preencher antes de qualquer outra coisa.
          </p>
        ) : (
          <table>
            <thead>
              <tr><th>Indicador</th><th className="num">Hoje</th><th className="num">Meta</th><th className="num">Custa</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {r.metas.map((m) => {
                const custo = quantoCustaODesvio(m.distancia, faturamento);
                return (
                  <tr key={m.metrica}>
                    <td>{m.rotulo}</td>
                    <td className="num">{pct(m.valor)}</td>
                    <td className="num">{m.alvo !== undefined ? pct(m.alvo) : '—'}</td>
                    <td className="num critico">{custo ? reais(custo) : '—'}</td>
                    <td className={m.situacao === 'dentro' ? 'melhorou' : m.situacao === 'muito_acima' ? 'critico' : 'atencao'}>
                      {m.explicacao}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 3 ─────────────────────────────────────────────────────────────── */}
      <h2>3 · Piorou?</h2>
      {!r.janelaBase ? (
        <div className="cartao">
          Não há período anterior com faturamento para comparar. O histórico deste cliente
          começa em {d.historicoDesde ? br(d.historicoDesde) : '—'}.
        </div>
      ) : piorou.length === 0 ? (
        <div className="cartao">Nada piorou além do normal neste período.</div>
      ) : (
        <div className="cartao">
          <table>
            <thead>
              <tr>
                <th>Indicador</th><th className="num">Agora</th><th className="num">Base</th>
                <th>Comparado com</th><th>O que aconteceu</th>
              </tr>
            </thead>
            <tbody>
              {piorou.map((a) => {
                const un = POR_CHAVE.get(a.metrica)?.unidade ?? 'contagem';
                return (
                  <tr key={a.metrica}>
                    <td className={a.severidade}>{a.rotulo}</td>
                    <td className="num">{a.valorAtual !== undefined ? formatar(a.valorAtual, un) : '—'}</td>
                    <td className="num">{a.valorBase !== undefined ? formatar(a.valorBase, un) : '—'}</td>
                    <td>{ORIGEM[a.baseOrigem]}<br /><span className="legenda">até {a.dataBase}</span></td>
                    <td>{a.explicacao}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {r.explicacoes.map((e) => (
        <div key={e.indicador}>
          <h2>{e.indicador} — de onde veio a diferença</h2>
          <div className="cartao">
            <div className="efeitos">
              <div className="efeito">
                <div className="rotulo">Efeito custo</div>
                <div className="valor">{pontos(e.efeitoCusto)}</div>
              </div>
              <div className="efeito">
                <div className="rotulo">Efeito faturamento</div>
                <div className="valor">{pontos(e.efeitoFaturamento)}</div>
              </div>
              <div className="efeito">
                <div className="rotulo">Variação total</div>
                <div className="valor">{pontos(e.variacao)}</div>
              </div>
            </div>
            <p className="resumo">{e.narrativa}</p>

            {Object.keys(e.ofensores).length === 0 ? (
              <p className="aviso">
                Ranking de ofensores suprimido neste grupo: o dado indica mudança de
                classificação, e apontar um culpado aqui seria apontar o errado.
              </p>
            ) : (
              Object.entries(e.ofensores).map(([dim, lista]) =>
                lista.length === 0 ? null : (
                  <table key={dim}>
                    <thead>
                      <tr>
                        <th>{dim[0].toUpperCase() + dim.slice(1)}</th>
                        <th className="num">Antes</th><th className="num">Agora</th>
                        <th className="num">Diferença</th>
                        <th className="num">Efeito gasto</th><th className="num">Efeito venda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((o) => (
                        <tr key={o.nome}>
                          <td>{o.nome}{o.situacao === 'novo' ? ' (novo)' : o.situacao === 'sumiu' ? ' (sumiu)' : ''}</td>
                          <td className="num">{reais(o.antes)}</td>
                          <td className="num">{reais(o.agora)}</td>
                          <td className={`num ${o.variacaoReais > 0 ? 'critico' : 'melhorou'}`}>{reais(o.variacaoReais)}</td>
                          <td className={`num ${o.contribuicaoCusto > 0 ? 'critico' : ''}`}>{pontos(o.contribuicaoCusto)}</td>
                          <td className="num estavel">{pontos(o.contribuicaoFaturamento)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ),
              )
            )}
          </div>
        </div>
      ))}

      <h2>Preço de insumo</h2>
      <div className="cartao">
        <p className="legenda">
          Nota fiscal entra quando o cliente compra — semanal, quinzenal, sem cadência.
          Por isso aqui não há janela de mês: o radar guarda um retrato do cadastro de
          preços a cada rodada e mostra o dia em que cada preço mudou.
        </p>
        {r.precos.retratos < 2 ? (
          <p className="aviso">
            Só existe um retrato de preços ({r.precos.ultimoRetrato}). A comparação começa
            na próxima coleta — não há como saber o que mudou olhando um retrato só.
          </p>
        ) : r.precos.altas.length === 0 && r.precos.quedas.length === 0 && r.precos.suspeitas.length === 0 ? (
          <p className="resumo">
            Nenhum preço mudou entre {r.precos.primeiroRetrato} e {r.precos.ultimoRetrato}.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Insumo</th><th>Fornecedor</th>
                <th className="num">De</th><th className="num">Para</th>
                <th className="num">Variação</th><th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {[...r.precos.altas, ...r.precos.quedas, ...r.precos.suspeitas].map((m) => (
                <tr key={m.insumoId + m.detectadaEm}>
                  <td>
                    {m.nome}
                    {m.categoria && <span className="legenda"> · {m.categoria}</span>}
                  </td>
                  <td>{m.fornecedor ?? '—'}</td>
                  <td className="num">{reais(m.de)}</td>
                  <td className="num">{reais(m.para)}</td>
                  <td className={`num ${m.variacao > 0 ? 'critico' : 'melhorou'}`}>
                    {m.unidadeMudou ? '—' : pct(m.variacao)}
                  </td>
                  <td>
                    {br(m.detectadaEm)}
                    {m.diasNoPrecoAnterior !== undefined && m.diasNoPrecoAnterior > 0 && (
                      <span className="legenda"><br />após {m.diasNoPrecoAnterior} dias no preço anterior</span>
                    )}
                    {m.unidadeMudou && (
                      <span className="legenda"><br />embalagem mudou — a % não vale</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Gasto por produto</h2>
      <div className="cartao">
        {!r.janelaBase ? (
          <p className="resumo">Sem período anterior para comparar.</p>
        ) : r.gastos.suspeitaDeRenomeacao ? (
          <p className="aviso">{r.gastos.explicacaoDaSuspeita}</p>
        ) : r.gastos.altas.length === 0 && r.gastos.quedas.length === 0 ? (
          <p className="resumo">Nenhuma compra variou de forma relevante no período.</p>
        ) : (
          <>
            <p className="legenda">
              Quanto se gastou com cada produto no período, do texto que o cliente digita
              no lançamento; grafias diferentes do mesmo item foram agrupadas.{' '}
              <strong>Isto é gasto, não preço</strong> — sem quantidade na nota, gastar mais
              pode ser preço maior ou compra maior. Para preço, veja a seção acima.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Antes</th>
                  <th className="num">Agora</th>
                  <th className="num">Diferença</th>
                  <th className="num">%</th>
                </tr>
              </thead>
              <tbody>
                {[...r.gastos.altas, ...r.gastos.quedas].map((c) => (
                  <tr key={c.produto}>
                    <td>
                      {c.produto}
                      {c.situacao === 'novo' && <span className="legenda"> (novo)</span>}
                      {c.situacao === 'sumiu' && <span className="legenda"> (sumiu)</span>}
                      {c.grafias > 1 && <span className="legenda"> · {c.grafias} grafias</span>}
                    </td>
                    <td className="num">{reais(c.antes)}</td>
                    <td className="num">{reais(c.agora)}</td>
                    <td className={`num ${c.variacaoReais > 0 ? 'critico' : 'melhorou'}`}>
                      {reais(c.variacaoReais)}
                    </td>
                    <td className="num">
                      {c.variacaoPct !== undefined ? pct(c.variacaoPct) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <h2>Demais indicadores</h2>
      <div className="cartao">
        <table>
          <thead><tr><th>Indicador</th><th className="num">Agora</th><th>Situação</th></tr></thead>
          <tbody>
            {resto.map((a) => {
              const un = POR_CHAVE.get(a.metrica)?.unidade ?? 'contagem';
              return (
                <tr key={a.metrica}>
                  <td>{a.rotulo}</td>
                  <td className="num">{a.valorAtual !== undefined ? formatar(a.valorAtual, un) : '—'}</td>
                  <td className={a.severidade}>
                    {a.severidade === 'sem_base' ? 'sem base — ignorado' : a.severidade}
                    <br /><span className="legenda">{a.explicacao}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
