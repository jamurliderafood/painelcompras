import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarReclassificacao, diagnosticar, diasDeFechamento, porDiaLancado } from '../src/analise/qualidade';
import { insumo, lanc, mes } from './apoio';

const JULHO = { inicio: '2026-07-01', fim: '2026-07-25' };
const AGOSTO = { inicio: '2026-08-01', fim: '2026-08-25' };

test('dia da semana em que a casa nunca abre não conta como falta', () => {
  // Fecha às segundas nos dois meses. Sem esta regra, todo restaurante que
  // fecha um dia por semana apareceria como quem não lança.
  const dados = [...mes({ mes: 7, ate: 31, receitaPorDia: 3000, fechaEm: 1 }),
                 ...mes({ mes: 8, ate: 25, receitaPorDia: 3000, fechaEm: 1 })];
  assert.deepEqual(diasDeFechamento(dados), [1]);

  const d = diagnosticar(dados, [], AGOSTO);
  assert.equal(d.lacunas.length, 0);
  assert.equal(d.confianca, 'alta');
  assert.match(d.avisos.join(' '), /não abrir segunda/);
});

test('dias sem lançamento de receita viram lacuna e derrubam a confiança', () => {
  // O caso do Soffri: um bloco de dias seguidos sem lançar.
  const dados = [...mes({ mes: 7, ate: 31, receitaPorDia: 3000 }),
                 ...mes({ mes: 8, ate: 25, receitaPorDia: 3000, pularDias: [8, 9, 10, 11, 15, 16, 23] })];
  const d = diagnosticar(dados, [], AGOSTO);

  assert.equal(d.lacunas.length, 7);
  assert.equal(d.diasComReceita, 18);
  assert.ok(d.cobertura < 0.8, `cobertura ${d.cobertura}`);
  assert.equal(d.confianca, 'baixa');
  assert.match(d.avisos[0], /subestimados/);
});

test('faturamento por dia lançado é a comparação justa quando falta dia', () => {
  // 46.282 em 17 dias contra 74.559 em 22 não são 38% de queda, são 20%.
  const bruto = 46282.43 / 74558.81 - 1;
  const porDia = porDiaLancado(46282.43, 17)! / porDiaLancado(74558.81, 22)! - 1;
  assert.ok(bruto < -0.35, `bruto ${bruto}`);
  assert.ok(porDia > -0.25 && porDia < -0.15, `por dia ${porDia}`);
});

test('dinheiro que muda de gaveta é detectado como reclassificação', () => {
  // O caso real: "Entrada de Produtos" some, as subcategorias detalhadas
  // crescem, e o total do grupo mal se mexe.
  const dados = [
    ...mes({ mes: 7, ate: 31, receitaPorDia: 3000, subsCmv: {
      'Entrada de Produtos': 13807, 'Hortifruti': 1516, 'Proteínas - Bovinas': 5706 } }),
    ...mes({ mes: 8, ate: 25, receitaPorDia: 3000, subsCmv: {
      'Entrada de Produtos': 997, 'Hortifruti': 3285, 'Proteínas - Bovinas': 7787,
      'Proteínas - Aves': 1079, 'Mercearia': 631 } }),
  ];

  const r = detectarReclassificacao(dados, JULHO, AGOSTO);
  assert.equal(r.length, 1);
  assert.equal(r[0].grupo, 'CMV');
  assert.deepEqual(r[0].sumiram.map((x) => x.sub), ['Entrada de Produtos']);
  assert.ok(r[0].cresceram.length >= 2);
  assert.match(r[0].explicacao, /mudou o jeito de classificar/);
});

test('queda real de uma subcategoria não é confundida com reclassificação', () => {
  // A mesma subcategoria some, mas o grupo inteiro cai junto: aí ela realmente
  // parou de acontecer, e acusar reclassificação esconderia uma economia real.
  const dados = [
    ...mes({ mes: 7, ate: 31, receitaPorDia: 3000, subsCmv: { 'Bebidas': 10000, 'Carnes': 5000 } }),
    ...mes({ mes: 8, ate: 25, receitaPorDia: 3000, subsCmv: { 'Bebidas': 500, 'Carnes': 5000 } }),
  ];
  assert.deepEqual(detectarReclassificacao(dados, JULHO, AGOSTO), []);
});

test('cadastro de insumo furado aparece no diagnóstico', () => {
  const dados = mes({ mes: 8, ate: 25, receitaPorDia: 3000 });
  const insumos = [...Array(63)].map((_, i) => insumo(`sem preço ${i}`))
    .concat([...Array(228)].map((_, i) => insumo(`com preço ${i}`, 10)));

  const d = diagnosticar(dados, insumos, AGOSTO);
  assert.equal(d.insumosSemPreco, 63);
  assert.equal(d.insumosTotal, 291);
  assert.match(d.avisos.join(' '), /63 de 291 insumos estão sem preço/);
});

test('lançamento com data muito fora do resto é apontado', () => {
  // O Soffri tinha um lançamento de 2022 no meio de dados de 2026.
  const dados = [...mes({ mes: 7, ate: 31, receitaPorDia: 3000 }),
                 ...mes({ mes: 8, ate: 25, receitaPorDia: 3000 }),
                 ...mes({ ano: 2022, mes: 8, ate: 1, receitaPorDia: 100 })];
  const d = diagnosticar(dados, [], AGOSTO);
  assert.ok(d.lancamentosForaDeFaixa.length > 0);
  assert.match(d.avisos.join(' '), /erro de digitação/);
});

test('histórico com um lançamento perdido lá atrás não quebra a detecção de fechamento', () => {
  // Regressão do dado real: um lançamento de 2022 no meio de dados de 2026
  // esticava o intervalo para quatro anos, quase nenhum dia tinha receita, e a
  // função concluía que a casa fecha os sete dias da semana. A cobertura saía
  // 0% e o diagnóstico virava lixo.
  const dados = [...mes({ mes: 7, ate: 31, receitaPorDia: 3000 }),
                 ...mes({ mes: 8, ate: 25, receitaPorDia: 3000 }),
                 ...mes({ ano: 2022, mes: 8, ate: 1, receitaPorDia: 100 })];

  assert.deepEqual(diasDeFechamento(dados, '2026-08-25'), []);
  const d = diagnosticar(dados, [], AGOSTO);
  assert.ok(d.diasEsperados > 20, `esperados ${d.diasEsperados}`);
  assert.ok(d.cobertura > 0.9, `cobertura ${d.cobertura}`);
});

test('subcategoria que sumiu sem nada crescer no lugar vira ausência, não reclassificação', () => {
  // A folha do Soffri: some inteira no meio do mês porque ainda não foi
  // lançada, e faz a mão de obra parecer que melhorou.
  const dados = [
    ...mes({ mes: 7, ate: 31, receitaPorDia: 3000, despesas: { 'Mão-de-Obra': 0 } }),
    ...mes({ mes: 8, ate: 25, receitaPorDia: 3000 }),
  ];
  dados.push(lanc('2026-07-20', 'Mão-de-Obra', 5770, 'Salários'));
  dados.push(lanc('2026-07-05', 'Mão-de-Obra', 4312, 'Pró-labore'));
  dados.push(lanc('2026-08-05', 'Mão-de-Obra', 2905, 'Pró-labore'));

  const d = diagnosticar(dados, [], AGOSTO, JULHO);
  assert.equal(d.reclassificacoes.length, 0);
  assert.deepEqual(d.ausencias.map((a) => a.sub), ['Salários']);
  assert.match(d.avisos.join(' '), /parecem melhores do que estão/);
});
