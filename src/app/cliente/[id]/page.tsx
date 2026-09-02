/**
 * Um cliente por inteiro, na ordem em que se deve ler:
 * o dado presta → está na régua → piorou.
 */

import { hoje } from '../../../coleta/clientes';
import { carregarCliente } from '../../../coleta/painel';
import { atualizarCliente } from '../../acoes';
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
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });

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

  const { relatorio: r, erro, fonte, apuradoEm } = await carregarCliente(id, data);
  if (!r) return <p>{erro ?? 'Cliente não encontrado.'}</p>;
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
      <p className="legenda">
        {/* De que horas é o número, e como pedir um mais novo. Sem isso, quem
            abre o painel às 15h não tem como saber se está olhando o
            movimento de hoje ou a foto das 5h. */}
        {fonte === 'banco' && apuradoEm
          ? <>Apurado às {hora(apuradoEm)}.</>
          : <>Lido do Flow agora.</>}{' '}
        <form action={atualizarCliente} style={{ display: 'inline' }}>
          <input type="hidden" name="cliente" value={r.clienteId} />
          <input type="hidden" name="data" value={data} />
          <button type="submit" className="botao-atualizar">atualizar agora</button>
        </form>
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
          {' '}
          <strong>Os valores são por unidade de medida</strong> — o quilo, o litro, a
          unidade — e não o preço da embalagem. O Flow guarda R$ 7,77 o óleo de 900 ml;
          aqui aparece R$ 8,63 o litro. Sem isso, comprar um pacote maior parece
          aumento de preço.
          {' '}
          Alta de <strong>5% ou mais</strong> aparece sempre; abaixo disso, as cinco
          maiores. Quedas só entram quando não há nenhuma alta — notícia boa não
          empurra notícia ruim para baixo da dobra.
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
                  <td className="num">{reais(m.de)}<span className="legenda">/{m.unidade}</span></td>
                  <td className="num">{reais(m.para)}<span className="legenda">/{m.unidade}</span></td>
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

        {r.precos.quedasOcultas > 0 && (
          <p className="legenda">
            E {r.precos.quedasOcultas} insumo{r.precos.quedasOcultas === 1 ? '' : 's'}{' '}
            {r.precos.quedasOcultas === 1 ? 'ficou' : 'ficaram'} mais barato
            {r.precos.quedasOcultas === 1 ? '' : 's'} no período — não listados aqui
            para não disputar espaço com as altas.
          </p>
        )}

        {r.precos.ultimosAtualizados.length > 0 && (
          <>
            <h3>Últimos preços atualizados</h3>
            <p className="legenda">
              O cadastro do Flow não guarda quando o preço foi posto; quem guarda é a
              compra. Estes são os preços que entraram por último, com a nota que os
              trouxe — a lista existe para você ter o que olhar mesmo num dia em que
              nada variou.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Insumo</th><th>Fornecedor</th>
                  <th className="num">Preço</th><th className="num">Compra</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {r.precos.ultimosAtualizados.map((p) => (
                  <tr key={p.insumoId + p.data}>
                    <td>{p.nome}</td>
                    <td>{p.fornecedor ?? '—'}</td>
                    <td className="num">
                      {reais(p.preco)}<span className="legenda">/{p.unidade || '?'}</span>
                    </td>
                    <td className="num">
                      {reais(p.valorDaCompra)}
                      <br />
                      <span className="legenda">
                        {p.quantidade.toLocaleString('pt-BR')} {p.unidade}
                      </span>
                    </td>
                    <td>{br(p.data)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <h2>Preço pago por compra</h2>
      <div className="cartao">
        <p className="legenda">
          O preço da própria nota: <code>valor ÷ quantidade</code>. Diferente da seção
          acima, que compara o cadastro entre retratos — este vale desde a primeira
          rodada. <strong>Só sai em unidade de peso ou volume:</strong> um quilo é
          sempre um quilo, mas &quot;un&quot; tanto é a garrafa quanto o fardo.
        </p>

        {!r.precoPago.comprasTotal ? (
          <p className="legenda">Nenhuma compra lançada no período.</p>
        ) : (
          <>
            <p className="legenda">
              {r.precoPago.comprasTotal - r.precoPago.comprasSemQuantidade} de{' '}
              {r.precoPago.comprasTotal} compras têm quantidade lançada
              {r.precoPago.ignoradasPorUnidade > 0 && (
                <> · {r.precoPago.ignoradasPorUnidade} série(s) fora da conta por
                a unidade ser &quot;un&quot;</>
              )}
              .
            </p>

            {r.precoPago.altas.length === 0 && r.precoPago.quedas.length === 0 ? (
              <p className="legenda">
                Nenhum insumo com variação relevante em unidade de peso ou volume.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th className="num">De</th>
                    <th className="num">Para</th>
                    <th className="num">Variação</th>
                    <th>Período</th>
                    <th>Fornecedor</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.precoPago.altas, ...r.precoPago.quedas].map((m) => (
                    <tr key={m.insumoId}>
                      <td>
                        {m.nome}
                        <br />
                        <span className="legenda">{m.compras.length} compras</span>
                      </td>
                      <td className="num">{reais(m.de)}/{m.unidade}</td>
                      <td className="num">{reais(m.para)}/{m.unidade}</td>
                      <td className={`num ${m.variacao > 0 ? 'critico' : 'melhorou'}`}>
                        {m.variacao > 0 ? '+' : '−'}
                        {Math.abs(m.variacao * 100).toFixed(0)}%
                        <br />
                        <span className="legenda">{reais(Math.abs(m.custoDaAlta))} na última compra</span>
                      </td>
                      <td className="legenda">{m.primeiraEm} → {m.ultimaEm}</td>
                      <td className="legenda">{m.fornecedores.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <h2>O gasto mudou por preço ou por volume?</h2>
      <div className="cartao">
        <p className="legenda">
          <code>Δgasto = (p₁ − p₀)·q₁ + (q₁ − q₀)·p₀</code>. Se a diferença é preço, a
          conversa é com o fornecedor; se é volume, é com a ficha técnica, a porção e o
          desperdício.
        </p>

        {r.decomposicao.ressalva ? (
          // A ressalva substitui a tabela, não acompanha: com base incompleta o
          // número está certo e a leitura está errada, e ninguém lê a nota de
          // rodapé de uma tabela que já respondeu a pergunta.
          <p className="aviso">{r.decomposicao.ressalva}</p>
        ) : r.decomposicao.efeitos.filter((e) => e.confiavel).length === 0 ? (
          <p className="legenda">
            Nada com quantidade lançada nos dois períodos e unidade de peso ou volume.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Insumo</th>
                <th className="num">Δ gasto</th>
                <th className="num">Efeito preço</th>
                <th className="num">Efeito volume</th>
                <th>É</th>
              </tr>
            </thead>
            <tbody>
              {r.decomposicao.efeitos.filter((e) => e.confiavel).map((e) => {
                const preco = Math.abs(e.efeitoPreco) > Math.abs(e.efeitoVolume);
                return (
                  <tr key={e.insumoId}>
                    <td>
                      {e.nome}
                      <br />
                      <span className="legenda">
                        {reais(e.precoAntes)}→{reais(e.precoAgora)}/{e.unidade} ·{' '}
                        {e.qtdAntes.toFixed(1)}→{e.qtdAgora.toFixed(1)}{e.unidade}
                      </span>
                    </td>
                    <td className={`num ${e.variacaoGasto > 0 ? 'critico' : 'melhorou'}`}>
                      {reais(e.variacaoGasto)}
                    </td>
                    <td className="num">{reais(e.efeitoPreco)}</td>
                    <td className="num">{reais(e.efeitoVolume)}</td>
                    <td className={preco ? 'critico' : ''}>{preco ? 'PREÇO' : 'VOLUME'}</td>
                  </tr>
                );
              })}
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
