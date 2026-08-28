import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cmvRealAnterior, cmvRealDoUltimo, contagemServe, idadeEmDias,
} from '../src/analise/cmvReal';
import type { CmvRegistro } from '../src/flow/tipos';

const reg = (
  data: string, ei: number, compras: number, ef: number, vendas: number,
): CmvRegistro => ({ id: data, data, ei, compras, ef, vendas });

test('CMV real é consumo sobre vendas, não compra sobre faturamento', () => {
  // A contagem do Restaurante JK em 17/08/2026, número por número.
  const c = cmvRealDoUltimo([reg('2026-08-17', 5777, 2908, 5224, 9816)])!;
  assert.equal(c.consumo, 5777 + 2908 - 5224);
  assert.ok(Math.abs(c.valor - 0.3527) < 0.001);
  assert.equal(c.data, '2026-08-17');
});

test('vale a ÚLTIMA contagem lançada, não a soma nem a média', () => {
  // Cada contagem já fecha o próprio período; somar não melhora, e a mais
  // recente é a que descreve como a casa está agora.
  const c = cmvRealDoUltimo([
    reg('2026-06-08', 6043, 2729, 6623, 6563),
    reg('2026-08-17', 5777, 2908, 5224, 9816),
    reg('2026-07-06', 6039, 6773, 5950, 7771),
  ])!;
  assert.equal(c.data, '2026-08-17');
});

test('inventário de abertura não é medição de CMV', () => {
  // Casa da Nonna, King e Montello têm exatamente isto: só o estoque final
  // preenchido. Dividir por vendas zero daria Infinity, e Infinity atravessa
  // um painel inteiro sem ninguém ver de onde veio.
  const abertura = reg('2026-07-18', 0, 0, 6810, 0);
  assert.equal(contagemServe(abertura), false);
  assert.equal(cmvRealDoUltimo([abertura]), undefined);
});

test('a abertura não rouba o lugar de uma contagem boa mais antiga', () => {
  const c = cmvRealDoUltimo([
    reg('2026-07-01', 5000, 3000, 4000, 10000),
    reg('2026-08-18', 0, 0, 6810, 0),
  ])!;
  assert.equal(c.data, '2026-07-01');
});

test('cliente sem contagem nenhuma não tem CMV real', () => {
  assert.equal(cmvRealDoUltimo([]), undefined);
  assert.equal(cmvRealDoUltimo(undefined), undefined);
});

test('contagem posterior ao dia analisado não conta', () => {
  // Rodar o radar para uma data passada não pode enxergar o futuro.
  const c = cmvRealDoUltimo([
    reg('2026-07-06', 6039, 6773, 5950, 7771),
    reg('2026-08-17', 5777, 2908, 5224, 9816),
  ], '2026-08-01')!;
  assert.equal(c.data, '2026-07-06');
});

test('a comparação é contagem contra contagem', () => {
  const regs = [
    reg('2026-07-06', 6039, 6773, 5950, 7771),
    reg('2026-08-10', 5396, 4321, 5777, 6625),
    reg('2026-08-17', 5777, 2908, 5224, 9816),
  ];
  assert.equal(cmvRealDoUltimo(regs)!.data, '2026-08-17');
  assert.equal(cmvRealAnterior(regs)!.data, '2026-08-10');
});

test('uma contagem só não tem anterior', () => {
  assert.equal(cmvRealAnterior([reg('2026-08-17', 5777, 2908, 5224, 9816)]), undefined);
});

test('conta a idade da contagem — contagem velha descreve outra casa', () => {
  const c = cmvRealDoUltimo([reg('2026-07-18', 5000, 3000, 4000, 10000)])!;
  assert.equal(idadeEmDias(c, '2026-08-27'), 40);
});
