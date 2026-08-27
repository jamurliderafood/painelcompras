import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anoAnterior, mesAnterior, alinharDiaSemana, escolherBase, diaDaSemana,
} from '../src/analise/periodo';

const sempre = () => true;
const nunca = () => false;

test('a base preferida é o mesmo dia do ano passado', () => {
  const b = escolherBase('2026-08-26', sempre);
  assert.equal(b.data, '2025-08-26');
  assert.equal(b.origem, 'ano_anterior');
});

test('sem o ano passado, cai para o mesmo dia do mês passado', () => {
  const b = escolherBase('2026-08-26', (d) => d === '2026-07-26');
  assert.equal(b.data, '2026-07-26');
  assert.equal(b.origem, 'mes_anterior');
});

test('sem nenhuma das duas, o dado é ignorado — não vira estável', () => {
  const b = escolherBase('2026-08-26', nunca);
  assert.equal(b.origem, 'nenhuma');
  assert.equal(b.data, '');
});

test('a base nunca é anterior ao início dos dados do cliente', () => {
  // Cliente entrou na carteira em maio/2026: agosto de 2025 existe na fonte,
  // mas é lixo (ninguém lançava ainda) e não pode virar base.
  const b = escolherBase('2026-08-26', sempre, { dadosDesde: '2026-05-01' });
  assert.equal(b.origem, 'mes_anterior');
  assert.equal(b.data, '2026-07-26');
});

test('31 de março cai no último dia de fevereiro, não em 3 de março', () => {
  assert.equal(mesAnterior('2026-03-31'), '2026-02-28');
  assert.equal(mesAnterior('2024-03-31'), '2024-02-29');
});

test('29 de fevereiro no ano passado vira 28', () => {
  assert.equal(anoAnterior('2024-02-29'), '2023-02-28');
});

test('janeiro volta para dezembro do ano anterior', () => {
  assert.equal(mesAnterior('2026-01-15'), '2025-12-15');
});

test('alinhar por dia da semana anda para o dia mais próximo, não para o mais fácil', () => {
  // 26/08/2026 é quarta; 26/08/2025 foi terça. O alinhamento tem de pular
  // para 27/08/2025, que é quarta, e não sete dias para trás.
  const alvo = anoAnterior('2026-08-26');
  const alinhado = alinharDiaSemana(alvo, '2026-08-26');
  assert.equal(diaDaSemana(alinhado), diaDaSemana('2026-08-26'));
  assert.equal(Math.abs(Date.parse(alinhado) - Date.parse(alvo)) / 86_400_000 <= 3, true);
});

test('com alinhamento desligado, o desencontro de dia da semana vira aviso', () => {
  const b = escolherBase('2026-08-26', sempre);
  assert.equal(b.data, '2025-08-26');
  assert.match(b.aviso ?? '', /dia da semana/);
});

test('com alinhamento ligado, a base cai no mesmo dia da semana e o aviso some', () => {
  const b = escolherBase('2026-08-26', sempre, { alinharDiaSemana: true });
  assert.equal(b.origem, 'ano_anterior');
  assert.equal(diaDaSemana(b.data), diaDaSemana('2026-08-26'));
  assert.equal(b.aviso, undefined);
});
