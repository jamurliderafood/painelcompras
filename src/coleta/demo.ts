/**
 * `npm run demo` — a análise impressa no terminal.
 *
 *   DUMP_FLOW=~/Downloads/flow-organizacoes.csv npm run demo 2026-08-27
 */

import { analisarCliente } from './rodar';
import { abrirCarteira, listarClientes, fonteDe } from './clientes';
import { formatar } from '../analise/varredura';
import { POR_CHAVE } from '../analise/catalogo';
import { quantoCustaODesvio } from '../analise/metas';

const dia = process.argv[2] ?? '2026-08-26';
const reais = (v: number) => formatar(v, 'reais');

const carteira = abrirCarteira();

for (const cliente of await listarClientes(carteira)) {
  const r = await analisarCliente(cliente, fonteDe(carteira), dia);
  const linha = '='.repeat(74);

  console.log(`\n${linha}\n${r.nome} — ${r.janela.inicio} a ${r.janela.fim}` +
    (r.janelaBase ? `   (base: ${r.janelaBase.inicio} a ${r.janelaBase.fim})` : '   (sem base)'));
  console.log(linha);

  const d = r.diagnostico;
  const selo = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' }[d.confianca];
  console.log(`\n1. O DADO PRESTA?   confiança ${selo}`);
  console.log(`   cobertura: ${d.diasComReceita} de ${d.diasEsperados} dias esperados ` +
    `(${(d.cobertura * 100).toFixed(0)}%)`);
  for (const aviso of d.avisos) console.log(`   • ${aviso}`);
  if (!d.avisos.length) console.log('   • nada a apontar');

  console.log('\n2. ESTÁ NA RÉGUA?');
  if (!r.metas.length) {
    // A meta quase sempre existe — vem do `cmvAlvo` do Flow. O que costuma
    // faltar é FATURAMENTO: sem receita lançada não há CMV em porcentagem para
    // comparar, e `avaliarMeta` devolve null. Dizer "nenhuma meta cadastrada"
    // mandaria o consultor cadastrar uma meta que já está lá.
    console.log(
      cliente.metas && Object.keys(cliente.metas).length
        ? '   • sem faturamento lançado no período — não há indicador em % para pôr contra a meta'
        : '   • nenhuma meta cadastrada para este cliente',
    );
  }
  for (const m of r.metas) {
    const custo = quantoCustaODesvio(m.distancia, r.achados.find((a) => a.metrica === 'faturamento')?.valorAtual ?? 0);
    console.log(`   ${m.situacao === 'dentro' ? '[ok]' : m.situacao === 'muito_acima' ? '[!!]' : '[! ]'} ` +
      `${m.rotulo}: ${m.explicacao}${custo ? ` Custa ${reais(custo)} no período.` : ''}`);
  }

  console.log('\n3. PIOROU?');
  const piorou = r.achados.filter((a) => ['critico', 'atencao'].includes(a.severidade));
  const semBase = r.achados.filter((a) => a.severidade === 'sem_base');
  if (semBase.length === r.achados.length) {
    console.log('   • não há período anterior para comparar');
  } else if (!piorou.length) {
    console.log('   • nada piorou além do normal');
  }
  for (const a of piorou) {
    console.log(`   ${a.severidade === 'critico' ? '[!!]' : '[! ]'} ${a.rotulo}: ${a.explicacao}`);
  }

  for (const e of r.explicacoes) {
    console.log(`\n   ${e.indicador} — de onde veio:`);
    const p = (v: number) => `${(v * 100).toFixed(2).replace('.', ',')} pontos`;
    console.log(`     efeito custo       : ${p(e.efeitoCusto)}`);
    console.log(`     efeito faturamento : ${p(e.efeitoFaturamento)}`);
    console.log(`     total              : ${p(e.variacao)}`);
    for (const [dim, lista] of Object.entries(e.ofensores)) {
      const top = lista.slice(0, 4).filter((o) => Math.abs(o.contribuicaoCusto) > 0.0005);
      if (!top.length) continue;
      console.log(`     por ${dim} (efeito do gasto):`);
      for (const o of top) {
        console.log(`      • ${o.nome}: ${reais(o.antes)} → ${reais(o.agora)} = ` +
          `${reais(o.variacaoReais)} (${p(o.contribuicaoCusto)})`);
      }
    }
    if (!Object.keys(e.ofensores).length) {
      console.log('     (ranking de ofensores suprimido — ver o aviso de reclassificação acima)');
    }
  }

  console.log('\n4. PREÇO DE INSUMO   (por evento, sem janela de mês)');
  if (r.precos.retratos < 2) {
    console.log(`   • só um retrato de preços (${r.precos.ultimoRetrato}) — a comparação começa na próxima coleta`);
  } else if (!r.precos.altas.length && !r.precos.quedas.length) {
    console.log(`   • nenhum preço mudou entre ${r.precos.primeiroRetrato} e ${r.precos.ultimoRetrato}`);
  } else {
    for (const m of [...r.precos.altas, ...r.precos.quedas].slice(0, 10)) {
      const pc = `${m.variacao > 0 ? '+' : '−'}${Math.abs(m.variacao * 100).toFixed(1)}%`;
      console.log(`   ${m.variacao > 0 ? '[!!]' : '[ok]'} ${m.nome}: ${reais(m.de)} → ${reais(m.para)} (${pc}) ` +
        `em ${m.detectadaEm}${m.fornecedor ? ` · ${m.fornecedor}` : ''}` +
        `${m.diasNoPrecoAnterior ? ` · ficou ${m.diasNoPrecoAnterior}d no preço anterior` : ''}`);
    }
    for (const m of r.precos.suspeitas) {
      console.log(`   [??] ${m.nome}: embalagem mudou (${reais(m.de)} → ${reais(m.para)}) — a % não vale`);
    }
  }

  console.log('\n5. PREÇO PAGO POR COMPRA   (valor ÷ quantidade da nota)');
  if (!r.precoPago.comprasTotal) {
    console.log('   • nenhuma compra lançada no período');
  } else if (r.precoPago.comprasSemQuantidade === r.precoPago.comprasTotal) {
    console.log(
      `   • as ${r.precoPago.comprasTotal} compras do período estão sem quantidade — ` +
      'sem `qtd` na nota não há preço unitário, só gasto',
    );
  } else {
    const cobertura = 100 * (1 - r.precoPago.comprasSemQuantidade / r.precoPago.comprasTotal);
    console.log(
      `   • ${r.precoPago.comprasTotal - r.precoPago.comprasSemQuantidade} de ` +
      `${r.precoPago.comprasTotal} compras têm quantidade (${cobertura.toFixed(0)}%)` +
      (r.precoPago.ignoradasPorUnidade
        ? ` · ${r.precoPago.ignoradasPorUnidade} série(s) fora por unidade ser "un"`
        : ''),
    );
    for (const m of [...r.precoPago.altas, ...r.precoPago.quedas]) {
      const pc = `${m.variacao > 0 ? '+' : '−'}${Math.abs(m.variacao * 100).toFixed(0)}%`;
      console.log(
        `   ${m.variacao > 0 ? '[!!]' : '[ok]'} ${m.nome}: ${reais(m.de)} → ${reais(m.para)} /${m.unidade} ` +
        `(${pc}) · ${m.primeiraEm} → ${m.ultimaEm} · ${m.compras.length} compras` +
        (m.fornecedores.length ? ` · ${m.fornecedores.join(', ')}` : ''),
      );
    }
    if (!r.precoPago.altas.length && !r.precoPago.quedas.length) {
      console.log('   • nenhum insumo com variação relevante em unidade de peso ou volume');
    }
  }

  console.log('\n6. O GASTO MUDOU POR PREÇO OU POR VOLUME?');
  if (r.decomposicao.ressalva) {
    console.log(`   [??] ${r.decomposicao.ressalva}`);
  } else if (!r.decomposicao.efeitos.length) {
    console.log('   • sem período anterior comparável');
  } else {
    for (const e of r.decomposicao.efeitos.filter((x) => x.confiavel).slice(0, 6)) {
      const culpa = Math.abs(e.efeitoPreco) > Math.abs(e.efeitoVolume) ? 'PREÇO' : 'VOLUME';
      console.log(
        `   [${culpa === 'PREÇO' ? '!!' : '  '}] ${e.nome}: ${reais(e.variacaoGasto)} = ` +
        `preço ${reais(e.efeitoPreco)} + volume ${reais(e.efeitoVolume)} → ${culpa}`,
      );
      console.log(
        `        ${reais(e.precoAntes)}→${reais(e.precoAgora)}/${e.unidade} · ` +
        `${e.qtdAntes.toFixed(1)}→${e.qtdAgora.toFixed(1)}${e.unidade}`,
      );
    }
  }

  const melhorou = r.achados.filter((a) => a.severidade === 'melhorou');
  if (melhorou.length) {
    console.log(`\n   Melhorou: ${melhorou.map((a) => POR_CHAVE.get(a.metrica)?.rotulo ?? a.metrica).join(', ')}`);
  }
}
