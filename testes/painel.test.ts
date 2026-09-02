import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completarParaTeste } from '../src/coleta/painel';

/**
 * A foto gravada no banco é um contrato entre versões: a rodada de hoje grava,
 * o painel de amanhã lê — já com código novo. Campo acrescentado hoje não
 * existe na foto de ontem.
 */
test('foto antiga, sem os campos novos, não derruba o painel', () => {
  // Exatamente a forma que quebrou em 02/09/2026: o payload gravado antes de
  // `ultimosAtualizados` existir. Ler `undefined[0]` derrubava a página.
  const antiga = {
    clienteId: 'x', nome: 'Antigo', data: '2026-09-02',
    diagnostico: { confianca: 'baixa', cobertura: 1, avisos: [] },
    precos: { retratos: 2, altas: [], quedas: [], suspeitas: [] },
  } as any;

  const r = completarParaTeste(antiga);

  assert.deepEqual(r.precos.ultimosAtualizados, []);
  assert.equal(r.precos.quedasOcultas, 0);
  assert.equal(r.diagnostico.periodoRecemComecado, false);
  assert.deepEqual(r.metricas, {});
  assert.deepEqual(r.decomposicao.efeitos, []);
  assert.equal(r.precoPago.comprasTotal, 0);
  assert.equal(r.gastos.suspeitaDeRenomeacao, false);
});

test('foto nova passa intacta', () => {
  const nova = {
    clienteId: 'x', nome: 'Novo', data: '2026-09-02',
    diagnostico: { confianca: 'alta', cobertura: 1, avisos: [], periodoRecemComecado: true },
    metricas: { faturamento: 100 },
    precos: {
      retratos: 2, altas: [], quedas: [], suspeitas: [], quedasOcultas: 3,
      ultimosAtualizados: [{ insumoId: 'a', nome: 'ACEM', unidade: 'kg', preco: 34.9,
        data: '2026-09-01', quantidade: 20.57, valorDaCompra: 717.89 }],
    },
    precoPago: { altas: [], quedas: [], ignoradasPorUnidade: 0, comprasSemQuantidade: 1, comprasTotal: 9 },
    decomposicao: { efeitos: [] },
    gastos: { altas: [], quedas: [], suspeitaDeRenomeacao: true },
  } as any;

  const r = completarParaTeste(nova);

  assert.equal(r.precos.quedasOcultas, 3);
  assert.equal(r.precos.ultimosAtualizados[0].nome, 'ACEM');
  assert.equal(r.diagnostico.periodoRecemComecado, true);
  assert.equal(r.metricas.faturamento, 100);
  assert.equal(r.precoPago.comprasTotal, 9);
  assert.equal(r.gastos.suspeitaDeRenomeacao, true);
});
