import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisarCliente, metricasDaJanela, type ClienteConfig } from '../src/coleta/rodar';
import { janelaDoMes } from '../src/analise/janela';
import { FonteMemoria, insumo, mes } from './apoio';

const DIA = '2026-08-26';
const soffri: ClienteConfig = { id: 'x', nome: 'Restaurante Teste', metas: { cmv: 0.30 } };

/** Um cliente com dois meses de uso e os defeitos que o dado real tem. */
function dadosComDefeitos() {
  return [
    ...mes({ mes: 7, ate: 31, receitaPorDia: 3400, despesas: { 'Mão-de-Obra': 14000 },
      subsCmv: { 'Entrada de Produtos': 13807, 'Hortifruti': 1516, 'Proteínas - Bovinas': 5706 } }),
    ...mes({ mes: 8, ate: 25, receitaPorDia: 2720, pularDias: [8, 9, 10, 11, 15, 16, 23],
      despesas: { 'Mão-de-Obra': 4200 },
      subsCmv: { 'Entrada de Produtos': 997, 'Hortifruti': 3285, 'Proteínas - Bovinas': 7787,
        'Proteínas - Aves': 1079, 'Mercearia': 631 } }),
  ];
}

test('a janela é o acumulado do mês', () => {
  assert.deepEqual(janelaDoMes(DIA), { inicio: '2026-08-01', fim: '2026-08-26' });
});

test('o diagnóstico vem antes de tudo e rebaixa a confiança', async () => {
  const r = await analisarCliente(soffri, new FonteMemoria(dadosComDefeitos()), DIA);
  assert.equal(r.diagnostico.confianca, 'baixa');
  assert.ok(r.diagnostico.lacunas.length >= 7);
  // A ressalva abre o resumo — quem lê precisa saber antes de ler o número.
  assert.match(r.resumo, /^Restaurante Teste — confiança BAIXA/);
});

test('CMV acima da meta aparece mesmo sem período anterior para comparar', async () => {
  // Um mês só de histórico: a comparação não existe, e a régua é tudo que há.
  const soMes = mes({ mes: 8, ate: 25, receitaPorDia: 2000, subsCmv: { 'Carnes': 25000 } });
  const r = await analisarCliente(soffri, new FonteMemoria(soMes), DIA);

  assert.ok(r.achados.every((a) => a.severidade === 'sem_base'));
  const cmv = r.metas.find((x) => x.metrica === 'cmv')!;
  assert.equal(cmv.situacao, 'muito_acima');
  assert.match(r.resumo, /só a régua vale nesta rodada/);
});

test('quando o dinheiro muda de gaveta, o ranking de ofensores é suprimido', async () => {
  const r = await analisarCliente(soffri, new FonteMemoria(dadosComDefeitos()), DIA);
  const cmv = r.explicacoes.find((e) => e.indicador === 'CMV por compras');

  assert.ok(cmv, 'o CMV tem de ganhar explicação');
  // Sem a supressão, o painel diria "Proteínas - Bovinas, maior ofensor" para
  // um dinheiro que só trocou de subcategoria.
  assert.deepEqual(Object.keys(cmv!.ofensores), []);
  assert.match(cmv!.narrativa, /mudou o jeito de classificar/);
});

test('sem reclassificação, o ranking de ofensores continua saindo', async () => {
  const limpo = [
    ...mes({ mes: 7, ate: 31, receitaPorDia: 3000, subsCmv: { 'Hortifruti': 2000, 'Carnes': 6000 } }),
    ...mes({ mes: 8, ate: 25, receitaPorDia: 3000, subsCmv: { 'Hortifruti': 2100, 'Carnes': 9000 } }),
  ];
  const r = await analisarCliente(soffri, new FonteMemoria(limpo), DIA);
  const cmv = r.explicacoes.find((e) => e.indicador === 'CMV por compras')!;
  assert.equal(cmv.ofensores.subcategoria[0].nome, 'Carnes');
});

test('faturamento por dia lançado é uma métrica própria, ao lado do bruto', async () => {
  const m = metricasDaJanela(dadosComDefeitos(), janelaDoMes(DIA));
  assert.ok(m.faturamento! > 0);
  assert.ok(m.faturamento_dia! > 0);
  assert.ok(m.faturamento_dia! < m.faturamento!);
  assert.equal(m.dias_lancados, 18);
});

test('cada grupo do Flow vira métrica, sem heurística de classificação', async () => {
  const m = metricasDaJanela(dadosComDefeitos(), janelaDoMes(DIA));
  assert.ok(m.cmv !== undefined, 'CMV');
  assert.ok(m.mao_de_obra !== undefined, 'Mão-de-Obra');
  assert.equal(m.cmv_reais! > 0, true);
});

test('insumo sem preço entra no diagnóstico, não no meio dos números', async () => {
  const r = await analisarCliente(
    soffri,
    new FonteMemoria(dadosComDefeitos(), [insumo('a'), insumo('b', 5)]),
    DIA,
  );
  assert.equal(r.diagnostico.insumosSemPreco, 1);
  assert.equal(r.diagnostico.insumosTotal, 2);
});
