import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGO } from '../src/analise/catalogo';

/** O catálogo existe em dois lugares — banco e código — e divergir entre eles
 *  é o tipo de erro que ninguém percebe até o painel mostrar métrica que o
 *  motor não vigia. Este teste é o que impede. */
test('o catálogo do código e o do SQL têm as mesmas métricas', () => {
  const sql = readFileSync(new URL('../sql/02-carga.sql', import.meta.url), 'utf8');
  const noSql = new Set([...sql.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]));
  const noCodigo = new Set(CATALOGO.map((d) => d.chave));

  const faltandoNoCodigo = [...noSql].filter((c) => !noCodigo.has(c));
  const faltandoNoSql = [...noCodigo].filter((c) => !noSql.has(c));

  assert.deepEqual(faltandoNoCodigo, [], 'métricas no SQL que o motor não vigia');
  assert.deepEqual(faltandoNoSql, [], 'métricas no motor que o banco não conhece');
});

test('toda métrica declara o que é piorar', () => {
  for (const d of CATALOGO) {
    assert.ok(['maior_melhor', 'menor_melhor'].includes(d.direcao), d.chave);
    assert.ok(d.limiarCritico > d.limiarAtencao, `${d.chave}: crítico tem de ser maior que atenção`);
  }
});
