/**
 * `npm run demo` — a análise impressa no terminal.
 *
 *   FONTE=arquivo PASTA_FLOW=~/Downloads npm run demo 2026-08-26
 */

import { analisarCliente } from './rodar';
import { listarClientes, fonteDe } from './clientes';
import { formatar } from '../analise/varredura';
import { POR_CHAVE } from '../analise/catalogo';
import { quantoCustaODesvio } from '../analise/metas';

const dia = process.argv[2] ?? '2026-08-26';
const reais = (v: number) => formatar(v, 'reais');

for (const cliente of await listarClientes()) {
  const r = await analisarCliente(cliente, fonteDe(cliente), dia);
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
  if (!r.metas.length) console.log('   • nenhuma meta cadastrada para este cliente');
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

  const melhorou = r.achados.filter((a) => a.severidade === 'melhorou');
  if (melhorou.length) {
    console.log(`\n   Melhorou: ${melhorou.map((a) => POR_CHAVE.get(a.metrica)?.rotulo ?? a.metrica).join(', ')}`);
  }
}
