import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historicoDoInsumo, mudancasDePreco, resumirPrecos, ultimosPrecosAtualizados } from '../src/analise/precos';
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

// --- a régua de exibição, definida pelo Jamur ---------------------------

const sobe = (id: string, de: number, para: number) => [
  retrato('2026-09-01', ins(id, de)),
  retrato('2026-09-02', ins(id, para)),
];

test('alta de 5% ou mais aparece sempre, sem limite de quantidade', () => {
  // Seis insumos subindo mais de 5%: os seis aparecem. Cortar em cinco
  // esconderia uma alta relevante para caber na tela.
  const insumos = ['a', 'b', 'c', 'd', 'e', 'f'];
  const r = resumirPrecos([
    retrato('2026-09-01', ...insumos.map((i) => ins(i, 10))),
    retrato('2026-09-02', ...insumos.map((i) => ins(i, 11))), // +10%
  ], '2026-09-02');

  assert.equal(r.altas.length, 6);
});

test('alta abaixo de 5% mostra só as cinco maiores', () => {
  const insumos = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const r = resumirPrecos([
    retrato('2026-09-01', ...insumos.map((i) => ins(i, 100))),
    // +2% em todos: nenhum passa dos 5%.
    retrato('2026-09-02', ...insumos.map((i) => ins(i, 102))),
  ], '2026-09-02');

  assert.equal(r.altas.length, 5);
  assert.ok(r.altas.every((m) => m.variacao < 0.05));
});

test('as duas faixas convivem: as grandes inteiras, as pequenas cortadas', () => {
  const r = resumirPrecos([
    retrato('2026-09-01',
      ins('grande1', 10), ins('grande2', 10),
      ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((i) => ins(i, 100))),
    retrato('2026-09-02',
      ins('grande1', 15), ins('grande2', 14),
      ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((i) => ins(i, 102))),
  ], '2026-09-02');

  // 2 acima de 5% + 5 abaixo = 7
  assert.equal(r.altas.length, 7);
  assert.equal(r.altas.filter((m) => m.variacao >= 0.05).length, 2);
});

test('havendo alta, as quedas viram um número e não uma lista', () => {
  const r = resumirPrecos([
    retrato('2026-09-01', ins('subiu', 10), ins('caiu1', 10), ins('caiu2', 10)),
    retrato('2026-09-02', ins('subiu', 12), ins('caiu1', 8), ins('caiu2', 7)),
  ], '2026-09-02');

  assert.equal(r.altas.length, 1);
  assert.deepEqual(r.quedas, []);
  assert.equal(r.quedasOcultas, 2);
});

test('sem nenhuma alta, as quedas aparecem', () => {
  const r = resumirPrecos([
    retrato('2026-09-01', ins('caiu1', 10), ins('caiu2', 10)),
    retrato('2026-09-02', ins('caiu1', 8), ins('caiu2', 7)),
  ], '2026-09-02');

  assert.equal(r.altas.length, 0);
  assert.equal(r.quedas.length, 2);
  assert.equal(r.quedasOcultas, 0);
  // A maior queda primeiro.
  assert.equal(r.quedas[0].insumoId, 'caiu2');
});

// --- últimos preços atualizados ----------------------------------------

test('o preço atualizado sai da compra, porque o cadastro não tem data', () => {
  // Os números do King em 01/09/2026: R$ 717,89 por 20,57 kg de acém.
  const u = ultimosPrecosAtualizados([
    { id: 'l1', data: '2026-09-01', grupo: 'CMV', valor: 717.89, qtd: 20.57,
      uni: 'kg', insumoId: 'acem', fornecedor: 'MAURICIO ACOUGUE' },
  ], [ins('acem')].map((i) => ({ ...i, nome: 'ACEM' })));

  assert.equal(u.length, 1);
  assert.ok(Math.abs(u[0].preco - 34.8999) < 0.001);
  assert.equal(u[0].nome, 'ACEM');
  assert.equal(u[0].unidade, 'kg');
  assert.equal(u[0].fornecedor, 'MAURICIO ACOUGUE');
});

test('comprar o mesmo insumo três vezes não ocupa três linhas', () => {
  const compra = (data: string, valor: number) => ({
    id: data, data, grupo: 'CMV', valor, qtd: 10, uni: 'kg', insumoId: 'acem',
  });
  const u = ultimosPrecosAtualizados(
    [compra('2026-09-01', 300), compra('2026-09-03', 350), compra('2026-09-02', 320)],
    [{ ...ins('acem'), nome: 'ACEM' }],
  );

  assert.equal(u.length, 1);
  // A compra mais recente é a que vale.
  assert.equal(u[0].data, '2026-09-03');
  assert.equal(u[0].preco, 35);
});

test('compra sem quantidade não vira preço atualizado', () => {
  const u = ultimosPrecosAtualizados(
    [{ id: 'x', data: '2026-09-01', grupo: 'CMV', valor: 300, insumoId: 'acem' }],
    [{ ...ins('acem'), nome: 'ACEM' }],
  );
  assert.deepEqual(u, []);
});
