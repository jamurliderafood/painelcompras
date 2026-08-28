import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comprasComQuantidade, decomporCompras, resumirPrecoPago, ressalvaDeCobertura, seriesDePreco,
} from '../src/analise/precoPago';
import type { Insumo, Lancamento } from '../src/flow/tipos';

let seq = 0;
/** Uma compra como o banco do Flow guarda: com quantidade e insumo ligado. */
const compra = (
  data: string, insumoId: string, valor: number, qtd: number, uni = 'kg',
): Lancamento => ({
  id: `c${seq++}`, data, grupo: 'CMV', sub: 'Hortifruti', valor, insumoId, qtd, uni,
});

const ins = (id: string, nome = id): Insumo => ({
  id, nome, categoria: 'Hortifruti', unidade: 'kg', preco: 1,
});

test('sem quantidade não há preço unitário — é o caso que a API do Flow dava', () => {
  const semQtd: Lancamento = {
    id: 'x', data: '2026-08-01', grupo: 'CMV', valor: 400, insumoId: 'tomate',
  };
  assert.equal(comprasComQuantidade([semQtd]).length, 0);
});

test('quantidade zero não vira divisão — seria preço infinito', () => {
  const zero = { ...compra('2026-08-01', 'tomate', 400, 1), qtd: 0 };
  assert.equal(comprasComQuantidade([zero]).length, 0);
});

test('uma compra só não é série: não há variação a medir', () => {
  const s = seriesDePreco([compra('2026-08-01', 'tomate', 40, 5)], [ins('tomate')]);
  assert.deepEqual(s, []);
});

test('duas compras no mesmo dia são uma nota partida, não dois preços', () => {
  const s = seriesDePreco(
    [compra('2026-08-01', 'tomate', 40, 5), compra('2026-08-01', 'tomate', 24, 3)],
    [ins('tomate')],
  );
  assert.deepEqual(s, []);
});

test('em quilo o preço pago é confiável — um quilo é sempre um quilo', () => {
  const s = seriesDePreco([
    compra('2026-07-29', 'limao', 59.90, 10, 'kg'),
    compra('2026-08-17', 'limao', 109.00, 10, 'kg'),
  ], [ins('limao', 'Limão')]);

  assert.equal(s.length, 1);
  assert.equal(s[0].confiavel, true);
  assert.equal(s[0].de, 5.99);
  assert.equal(s[0].para, 10.90);
  assert.ok(Math.abs(s[0].variacao - 0.8197) < 0.001);
  // O que se fala ao telefone: a alta custou isto no volume da última compra.
  assert.ok(Math.abs(s[0].custoDaAlta - 49.10) < 0.01);
});

test('em "un" o preço NÃO é confiável — o rótulo não diz o tamanho da embalagem', () => {
  // Real, do Soffri: R$ 1,59 a garrafa contra R$ 13,00 o fardo. As duas
  // lançadas como 'un'. Sem esta trava o painel anuncia água mineral +718%.
  const s = seriesDePreco([
    compra('2026-08-03', 'agua', 1.59, 1, 'un'),
    compra('2026-08-24', 'agua', 13.00, 1, 'un'),
  ], [ins('agua', 'Água Mineral s/ Gás')]);

  assert.equal(s.length, 1);
  assert.equal(s[0].confiavel, false);
  // Calculado e guardado, não escondido — só não vira alerta.
  assert.ok(s[0].variacao > 7);
});

test('unidade que muda entre compras derruba a confiança', () => {
  const s = seriesDePreco([
    compra('2026-07-20', 'panceta', 234.70, 10, 'kg'),
    compra('2026-08-26', 'panceta', 281.64, 1, 'cx'),
  ], [ins('panceta', 'Panceta')]);

  assert.equal(s[0].unidadeMudou, true);
  assert.equal(s[0].confiavel, false);
});

test('o resumo mostra só o confiável e diz quanto deixou de fora', () => {
  const r = resumirPrecoPago([
    compra('2026-07-29', 'limao', 599, 100, 'kg'),
    compra('2026-08-17', 'limao', 1090, 100, 'kg'),
    compra('2026-08-03', 'agua', 159, 100, 'un'),
    compra('2026-08-24', 'agua', 1300, 100, 'un'),
  ], [ins('limao', 'Limão'), ins('agua', 'Água')]);

  assert.equal(r.altas.length, 1);
  assert.equal(r.altas[0].nome, 'Limão');
  assert.equal(r.ignoradasPorUnidade, 1);
});

test('conta as compras que não entram por falta de quantidade', () => {
  const r = resumirPrecoPago([
    compra('2026-08-01', 'tomate', 40, 5),
    { id: 'z', data: '2026-08-02', grupo: 'CMV', valor: 300 },
  ], [ins('tomate')]);

  assert.equal(r.comprasTotal, 2);
  assert.equal(r.comprasSemQuantidade, 1);
});

// --- decomposição preço × volume -------------------------------------------

const antes = { inicio: '2026-07-01', fim: '2026-07-31' };
const agora = { inicio: '2026-08-01', fim: '2026-08-31' };

test('a decomposição fecha com a diferença de gasto, sem resíduo', () => {
  const { efeitos: e } = decomporCompras([
    compra('2026-07-10', 'alcatra', 1000, 20, 'kg'),   // R$ 50,00/kg
    compra('2026-08-10', 'alcatra', 1800, 30, 'kg'),   // R$ 60,00/kg
  ], [ins('alcatra', 'Alcatra')], antes, agora);

  assert.equal(e.length, 1);
  assert.equal(e[0].variacaoGasto, 800);
  assert.equal(e[0].efeitoPreco, 300);   // (60 − 50) × 30
  assert.equal(e[0].efeitoVolume, 500);  // (30 − 20) × 50
  assert.equal(e[0].efeitoPreco + e[0].efeitoVolume, e[0].variacaoGasto);
});

test('gasto que subiu só por preço aponta o fornecedor; só por volume, não', () => {
  const { efeitos: soPreco } = decomporCompras([
    compra('2026-07-10', 'x', 1000, 20, 'kg'),
    compra('2026-08-10', 'x', 1600, 20, 'kg'),
  ], [ins('x')], antes, agora);
  assert.equal(soPreco[0].efeitoVolume, 0);
  assert.equal(soPreco[0].efeitoPreco, 600);

  const { efeitos: soVolume } = decomporCompras([
    compra('2026-07-10', 'y', 1000, 20, 'kg'),
    compra('2026-08-10', 'y', 1500, 30, 'kg'),
  ], [ins('y')], antes, agora);
  assert.equal(soVolume[0].efeitoPreco, 0);
  assert.equal(soVolume[0].efeitoVolume, 500);
});

test('insumo comprado só num dos períodos fica de fora', () => {
  // Chamar o gasto inteiro de "efeito volume" é verdade formal e mentira
  // prática: não havia preço anterior com que comparar.
  const { efeitos: e } = decomporCompras([
    compra('2026-08-10', 'novo', 900, 10, 'kg'),
  ], [ins('novo')], antes, agora);
  assert.deepEqual(e, []);
});

test('a decomposição em "un" é calculada mas marcada como não confiável', () => {
  const { efeitos: e } = decomporCompras([
    compra('2026-07-10', 'refri', 500, 100, 'un'),
    compra('2026-08-10', 'refri', 900, 100, 'un'),
  ], [ins('refri')], antes, agora);
  assert.equal(e[0].confiavel, false);
});

test('base que começou no meio do mês não pode falar de volume', () => {
  // O King passou a lançar compra em 08/07. Sem esta ressalva, a decomposição
  // diz que ele comprou mais em agosto — quando ele só lançou mais dias.
  const r = ressalvaDeCobertura([
    compra('2026-07-08', 'a', 100, 1), compra('2026-07-20', 'a', 100, 1),
    compra('2026-08-01', 'a', 100, 1), compra('2026-08-15', 'a', 100, 1),
  ], antes, agora);
  assert.ok(r?.includes('2026-07-08'));
  assert.ok(r?.includes('lançou mais dias'));
});

test('cliente que já comprava antes não é acusado de estreia no meio do mês', () => {
  // O King lança desde 01/04. A primeira nota de julho ser do dia 8 é ritmo de
  // compra, não onboarding — e tratar como onboarding tiraria do painel uma
  // decomposição legítima.
  const r = ressalvaDeCobertura([
    compra('2026-04-05', 'a', 100, 1), compra('2026-06-20', 'a', 100, 1),
    compra('2026-07-08', 'a', 100, 1), compra('2026-07-20', 'a', 100, 1),
    compra('2026-08-01', 'a', 100, 1), compra('2026-08-15', 'a', 100, 1),
  ], antes, agora);
  assert.equal(r, undefined);
});

test('base cheia não gera ressalva', () => {
  const r = ressalvaDeCobertura([
    compra('2026-07-01', 'a', 100, 1), compra('2026-07-20', 'a', 100, 1),
    compra('2026-08-01', 'a', 100, 1), compra('2026-08-15', 'a', 100, 1),
  ], antes, agora);
  assert.equal(r, undefined);
});

test('a ressalva viaja junto da decomposição, para não dar para esquecer', () => {
  const r = decomporCompras([
    compra('2026-07-19', 'a', 1000, 20, 'kg'),
    compra('2026-08-10', 'a', 1800, 30, 'kg'),
  ], [ins('a')], antes, agora);
  assert.ok(r.ressalva);
  assert.equal(r.efeitos.length, 1);
});
