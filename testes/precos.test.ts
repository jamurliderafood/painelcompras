import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historicoDoInsumo, mudancasDePreco, resumirPrecos } from '../src/analise/precos';
import type { Insumo, RetratoPreco } from '../src/flow/tipos';

const ins = (id: string, preco?: number, unidade = 'kg'): Insumo => ({
  id, nome: id, categoria: 'CMV', subcategoria: 'Hortifruti', preco, unidade,
  fornecedor: 'Mercado',
});

const retrato = (data: string, ...insumos: Insumo[]): RetratoPreco => ({ data, insumos });

test('um retrato só não produz mudança — não há com o que comparar', () => {
  assert.deepEqual(mudancasDePreco([retrato('2026-08-26', ins('tomate', 7.5))]), []);
});

test('a mudança é um evento datado, não um número de fim de mês', () => {
  // Nota entrou entre 20 e 21 de agosto; é esse o dia que importa, e não
  // "agosto contra julho".
  const r = mudancasDePreco([
    retrato('2026-08-19', ins('tomate', 7.5)),
    retrato('2026-08-20', ins('tomate', 7.5)),
    retrato('2026-08-21', ins('tomate', 9.2)),
    retrato('2026-08-22', ins('tomate', 9.2)),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].detectadaEm, '2026-08-21');
  assert.equal(r[0].de, 7.5);
  assert.equal(r[0].para, 9.2);
  assert.ok(Math.abs(r[0].variacao - 0.2267) < 0.001);
});

test('conta há quantos dias o preço anterior estava valendo', () => {
  // Um item parado dois meses que sobe 20% é notícia diferente de um que
  // oscila toda semana.
  const r = mudancasDePreco([
    retrato('2026-06-01', ins('queijo', 40)),
    retrato('2026-07-01', ins('queijo', 40)),
    retrato('2026-08-01', ins('queijo', 48)),
  ]);
  assert.equal(r[0].vigenteDesde, '2026-06-01');
  assert.equal(r[0].diasNoPrecoAnterior, 61);
});

test('cadastro novo não é aumento, e insumo que some não é queda', () => {
  const r = mudancasDePreco([
    retrato('2026-08-01', ins('tomate', 7)),
    retrato('2026-08-02', ins('tomate', 7), ins('cebola', 5)),
    retrato('2026-08-03', ins('cebola', 5)),
  ]);
  assert.deepEqual(r, []);
});

test('mudança de embalagem é separada, porque a porcentagem não vale', () => {
  // R$ 45 o pacote de 6 não é comparável com R$ 9 a unidade.
  const r = resumirPrecos([
    retrato('2026-08-01', ins('coca', 45.8, 'cx')),
    retrato('2026-08-02', ins('coca', 9.2, 'un')),
  ], '2026-08-02');
  assert.equal(r.suspeitas.length, 1);
  assert.equal(r.suspeitas[0].unidadeMudou, true);
  assert.equal(r.altas.length, 0, 'não pode entrar como queda nem como alta');
});

test('embalagem que muda sem o preço mudar ainda é mudança de custo', () => {
  // R$ 45 o pacote de 6 virando R$ 45 a unidade é 500% de alta por unidade,
  // com o mesmo número na tela. Passa por cima do piso de variação.
  const r = resumirPrecos([
    retrato('2026-08-01', ins('coca', 45.8, 'cx')),
    retrato('2026-08-02', ins('coca', 45.8, 'un')),
  ], '2026-08-02');
  assert.equal(r.suspeitas.length, 1);
  assert.equal(r.suspeitas[0].variacao, 0);
});

test('variação minúscula não vira linha no painel', () => {
  const r = resumirPrecos([
    retrato('2026-08-01', ins('sal', 4.00)),
    retrato('2026-08-02', ins('sal', 4.02)),
  ], '2026-08-02');
  assert.deepEqual([...r.altas, ...r.quedas], []);
  assert.equal(r.retratos, 2);
});

test('o histórico do insumo guarda só os degraus, não um ponto por dia', () => {
  const h = historicoDoInsumo([
    retrato('2026-08-01', ins('tomate', 7)),
    retrato('2026-08-02', ins('tomate', 7)),
    retrato('2026-08-03', ins('tomate', 9)),
    retrato('2026-08-04', ins('tomate', 9)),
  ], 'tomate');
  assert.deepEqual(h, [{ data: '2026-08-01', preco: 7 }, { data: '2026-08-03', preco: 9 }]);
});

test('preço saindo de zero não inventa percentual', () => {
  const r = mudancasDePreco([
    retrato('2026-08-01', ins('novo', 0)),
    retrato('2026-08-02', ins('novo', 12)),
  ]);
  assert.deepEqual(r, []);
});
