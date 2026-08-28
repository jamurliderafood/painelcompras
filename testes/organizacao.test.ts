import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirEstrutura, insumoDe, lancamentoDe, organizacaoDe } from '../src/flow/organizacao';
import { lerCsv } from '../src/flow/carteira';

test('o CSV do Supabase traz o JSON num campo só, com aspas duplicadas', () => {
  const csv = 'id,nome,dados\n1,Bar do Cris,"{""fat"": {""lancado"": 0}, ""x"": ""a,b""}"\n';
  const linhas = lerCsv(csv);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].nome, 'Bar do Cris');
  // O JSON tem vírgula dentro: quebrar por split(',') partiria o campo ao meio.
  assert.deepEqual(JSON.parse(linhas[0].dados), { fat: { lancado: 0 }, x: 'a,b' });
});

test('insumos e fichas vêm como objeto indexado por id, não como lista', () => {
  // Nas 36 organizações do dump de 27/08/2026 é assim em 36 de 36. Tratar como
  // lista devolveria zero insumo para a carteira inteira.
  const org = organizacaoDe({
    id: 'o1', nome: 'Teste',
    dados: JSON.stringify({
      insumos: { a1: { id: 'a1', nome: 'Tomate', cat: 'Hortifruti', uni: 'kg', preco: 7.5 } },
      fichas: { f1: { id: 'f1', nome: 'Prato', cat: 'X', comps: [], precoVenda: 30 } },
      lancamentos: [{ id: 'l1', data: '2026-08-01', grupo: 'CMV', valor: 100 }],
    }),
  });
  assert.equal(org.dados.insumos.length, 1);
  assert.equal(org.dados.fichas?.length, 1);
  assert.equal(org.dados.lancamentos.length, 1);
});

test('os nomes internos não são os da API: cat→categoria, uni→unidade', () => {
  const i = insumoDe({ id: 'a', nome: 'Tomate', cat: 'Hortifruti', uni: 'kg', preco: 7.5 });
  assert.equal(i.categoria, 'Hortifruti');
  assert.equal(i.unidade, 'kg');
  assert.equal(i.preco, 7.5);
});

test('o lançamento traz quantidade, insumo e nota — o que a API não dava', () => {
  const l = lancamentoDe({
    id: 'l1', data: '2026-08-17', grupo: 'CMV', sub: 'Hortifruti', valor: 109,
    qtd: 10, uni: 'kg', insumoId: 'limao', nfe: '12345', fornecedor: 'Ceasa',
  });
  assert.equal(l.qtd, 10);
  assert.equal(l.insumoId, 'limao');
  assert.equal(l.nfe, '12345');
});

test('quantidade zero ou negativa não passa — dividir por ela é preço infinito', () => {
  assert.equal(lancamentoDe({ id: 'a', data: '2026-08-01', grupo: 'CMV', valor: 10, qtd: 0 }).qtd, undefined);
  assert.equal(lancamentoDe({ id: 'b', data: '2026-08-01', grupo: 'CMV', valor: 10, qtd: -3 }).qtd, undefined);
});

test('a data é cortada em AAAA-MM-DD — data torta some de toda janela', () => {
  assert.equal(lancamentoDe({ id: 'a', data: '2026-08-01T13:00:00Z', grupo: 'CMV', valor: 1 }).data, '2026-08-01');
});

test('cmvAlvo do Flow vem em porcentagem e vira fração', () => {
  const org = organizacaoDe({ id: 'o', nome: 'X', dados: JSON.stringify({ cmvAlvo: 38 }) });
  assert.equal(org.dados.cmvAlvo, 0.38);
});

test('demo e arquivado são marcados; _arquivado:false não exclui ninguém', () => {
  const demo = organizacaoDe({ id: 'a', nome: 'Demo', dados: JSON.stringify({ _demo: true }) });
  const viva = organizacaoDe({ id: 'b', nome: 'Viva', dados: JSON.stringify({ _arquivado: false }) });
  assert.equal(demo.demo, true);
  assert.equal(viva.arquivado, false);
});

test('campo renomeado pelo Flow vira aviso, não número errado em silêncio', () => {
  const avisos = conferirEstrutura({
    lancamentos: [{ id: 'l', data: '2026-08-01', grupo: 'CMV', montante: 100 }],
  });
  assert.ok(avisos.some((a) => a.includes('"valor"')));
});

test('insumo com os nomes da API (categoria/unidade) é denunciado', () => {
  const avisos = conferirEstrutura({
    insumos: [{ id: 'a', nome: 'Tomate', categoria: 'Hortifruti', unidade: 'kg' }],
  });
  assert.ok(avisos.some((a) => a.includes('"cat"')));
  assert.ok(avisos.some((a) => a.includes('"uni"')));
});

test('JSON quebrado não derruba a carteira — o cliente entra com o erro', () => {
  const org = organizacaoDe({ id: 'o', nome: 'Quebrado', dados: '{isso não é json' });
  assert.equal(org.dados.lancamentos.length, 0);
  assert.equal(org.dados.endpointsErro.length, 1);
  assert.ok(org.avisosDeEstrutura[0].includes('Quebrado'));
});

test('estrutura estranha vira erro de leitura, e o painel marca parcial', () => {
  const org = organizacaoDe({
    id: 'o', nome: 'X',
    dados: JSON.stringify({ lancamentos: [{ id: 'l', data: '01/08/2026', grupo: 'CMV', valor: 1 }] }),
  });
  assert.ok(org.dados.endpointsErro.some((e) => e.includes('AAAA-MM-DD')));
});

test('cliente sem lançamento nenhum não é erro de leitura — é cliente parado', () => {
  // Onze dos vinte e oito clientes reais estão assim. Se `endpointsOk` viesse
  // vazio, `rodar.ts` marcaria os onze como situação 'erro'.
  const org = organizacaoDe({ id: 'o', nome: 'Parado', dados: JSON.stringify({ cmvAlvo: 30 }) });
  assert.ok(org.dados.endpointsOk.includes('organizacoes'));
  assert.equal(org.dados.endpointsErro.length, 0);
});
