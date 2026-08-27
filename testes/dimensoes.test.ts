import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompor, explicarIndicador } from '../src/analise/dimensoes';

const perto = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `${a} deveria ser ~${b}`);

const mapa = (o: Record<string, number>) => new Map(Object.entries(o));

test('a soma dos ofensores é exatamente a variação do indicador', () => {
  const antes = mapa({ 'Fornecedor A': 1_000, 'Fornecedor B': 500 });
  const agora = mapa({ 'Fornecedor A': 1_400, 'Fornecedor C': 300 });
  const [fAntes, fAgora] = [10_000, 9_000];

  const soma = decompor(antes, agora, fAntes, fAgora)
    .reduce((s, o) => s + o.contribuicaoPontos, 0);
  perto(soma, 1_700 / fAgora - 1_500 / fAntes);
});

test('fornecedor que apareceu do nada entra com o peso inteiro', () => {
  const o = decompor(mapa({ A: 100 }), mapa({ A: 100, B: 400 }), 1_000, 1_000);
  const novo = o.find((x) => x.nome === 'B')!;
  assert.equal(novo.situacao, 'novo');
  perto(novo.contribuicaoPontos, 0.4);
});

test('efeito custo e efeito faturamento somam a variação inteira', () => {
  const e = explicarIndicador('CMV', 3_000, 10_000, 3_400, 9_000, {})!;
  perto(e.efeitoCusto + e.efeitoFaturamento, e.variacao);
});

test('quando só a venda cai, o texto manda olhar a venda e não o fornecedor', () => {
  // Gastou exatamente o mesmo em reais; o faturamento é que caiu 25%.
  const e = explicarIndicador('CMV', 3_000, 10_000, 3_000, 7_500, {})!;
  perto(e.efeitoCusto, 0);
  perto(e.efeitoFaturamento, e.variacao);
  assert.ok(e.variacao > 0, 'o CMV percentual tem de subir mesmo sem gastar mais');
  assert.match(e.narrativa, /problema é de venda/i);
});

test('quando só o gasto sobe, o efeito faturamento é zero', () => {
  const e = explicarIndicador('CMV', 3_000, 10_000, 3_600, 10_000, {})!;
  perto(e.efeitoFaturamento, 0);
  perto(e.efeitoCusto, e.variacao);
});

test('sem faturamento não existe indicador percentual, e a resposta é nula', () => {
  assert.equal(explicarIndicador('CMV', 3_000, 10_000, 3_000, 0, {}), null);
  assert.equal(decompor(new Map(), new Map(), 0, 100).length, 0);
});

test('o ranking é por quem gastou mais, não por quem o denominador empurrou', () => {
  // Regressão. Com a venda em queda, TODO item ganha pontos de CMV sem ter se
  // mexido. A primeira versão ordenava por esse peso total e anunciava como
  // "maior ofensor" uma categoria que gastou MENOS em reais — certo na
  // álgebra, inútil na reunião.
  const antes = mapa({ Mercadorias: 16_000, Aluguel: 6_500 });
  const agora = mapa({ Mercadorias: 15_800, Aluguel: 6_500 });
  const o = decompor(antes, agora, 70_000, 53_000);

  const mercadorias = o.find((x) => x.nome === 'Mercadorias')!;
  assert.ok(mercadorias.contribuicaoPontos > 0, 'o peso total sobe, porque a venda caiu');
  assert.ok(mercadorias.contribuicaoCusto < 0, 'mas gastou menos em reais');

  const aluguel = o.find((x) => x.nome === 'Aluguel')!;
  perto(aluguel.contribuicaoCusto, 0);
  // E os dois pedaços somam o peso total, item a item.
  for (const x of o) perto(x.contribuicaoCusto + x.contribuicaoFaturamento, x.contribuicaoPontos);
});
