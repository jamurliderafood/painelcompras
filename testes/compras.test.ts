import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarProduto, variacoesDeCompra } from '../src/analise/compras';
import { lanc } from './apoio';

const JULHO = { inicio: '2026-07-01', fim: '2026-07-26' };
const AGOSTO = { inicio: '2026-08-01', fim: '2026-08-26' };

test('o peso colado no nome não cria produto novo', () => {
  // Do dado real: "Ancho / Contra Filé 33,605 Kg" e "…21,940 kg" são o mesmo
  // item, e sem normalizar viram dois produtos que somem e um que nasce.
  assert.equal(normalizarProduto('Ancho / Contra Filé 33,605 Kg'), 'ancho / contra file');
  assert.equal(normalizarProduto('Ancho / Contra Filé 21,940 kg'), 'ancho / contra file');
  assert.equal(normalizarProduto('Maminha 27,215 kg'), normalizarProduto('maminha'));
  assert.equal(normalizarProduto('TOMATE'), normalizarProduto('Tomate'));
});

test('grafias diferentes do mesmo produto somam num só', () => {
  const dados = [
    lanc('2026-07-10', 'CMV', 1000, 'Proteínas'), lanc('2026-08-10', 'CMV', 600, 'Proteínas'),
    lanc('2026-07-15', 'CMV', 500, 'Proteínas'),
  ];
  dados[0].descricao = 'Maminha 27,215 kg';
  dados[1].descricao = 'maminha';
  dados[2].descricao = 'MAMINHA 10 kg';

  const r = variacoesDeCompra(dados, JULHO, AGOSTO);
  assert.equal(r.quedas.length, 1);
  assert.equal(r.quedas[0].antes, 1500);
  assert.equal(r.quedas[0].agora, 600);
  assert.equal(r.quedas[0].grafias, 3);
});

test('alta de compra sai ordenada por reais, não por porcentagem', () => {
  // 500% de aumento num item de R$ 40 não muda a vida de ninguém; R$ 2.500 a
  // mais numa carne, muda.
  const dados = [
    com('2026-07-10', 200, 'Tomate'), com('2026-08-10', 1200, 'Tomate'),
    com('2026-07-10', 40, 'Canela'), com('2026-08-10', 150, 'Canela'),
  ];
  const r = variacoesDeCompra(dados, JULHO, AGOSTO);
  assert.equal(r.altas[0].produto, 'Tomate');
  assert.equal(r.altas.length, 1, 'a canela fica de fora pelo piso em reais');
});

test('mudança de jeito de lançar é detectada e desqualifica o ranking', () => {
  // Julho lançava em bloco; agosto detalha. Sem esta checagem o painel diria
  // "Coxa +R$ 2.569, produto novo" para dinheiro que já era gasto.
  const dados = [
    com('2026-07-10', 8000, 'Mercado'),
    com('2026-08-10', 2500, 'Coxa'), com('2026-08-11', 2200, 'Contra File'),
    com('2026-08-12', 1500, 'Paleta'), com('2026-08-13', 1800, 'Tomate'),
  ];
  const r = variacoesDeCompra(dados, JULHO, AGOSTO);
  assert.equal(r.suspeitaDeRenomeacao, true);
  assert.match(r.explicacaoDaSuspeita!, /jeito de escrever ou de agrupar/);
});

test('compra que só variou de valor não levanta suspeita', () => {
  const dados = [
    com('2026-07-10', 3000, 'Tomate'), com('2026-08-10', 3600, 'Tomate'),
    com('2026-07-10', 2000, 'Cebola'), com('2026-08-10', 1700, 'Cebola'),
  ];
  const r = variacoesDeCompra(dados, JULHO, AGOSTO);
  assert.equal(r.suspeitaDeRenomeacao, false);
  assert.equal(r.altas[0].produto, 'Tomate');
  assert.equal(r.quedas[0].produto, 'Cebola');
});

test('lançamento sem descrição não vira produto fantasma', () => {
  const dados = [com('2026-07-10', 5000, ''), com('2026-08-10', 9000, '')];
  const r = variacoesDeCompra(dados, JULHO, AGOSTO);
  assert.deepEqual([...r.altas, ...r.quedas], []);
});

function com(data: string, valor: number, descricao: string) {
  const l = lanc(data, 'CMV', valor, 'Compras');
  l.descricao = descricao;
  return l;
}
