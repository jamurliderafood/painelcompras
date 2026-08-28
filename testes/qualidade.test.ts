import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarReclassificacao, diagnosticar, diasDeFechamento, porDiaLancado, inicioConfiavel, janelaEstaCompleta, coberturaDaJanela } from '../src/analise/qualidade';
import { janelaDoMes } from '../src/analise/janela';
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
  // 24 dias esperados (1 a 24 — o dia 25 é o analisado e sai da conta), menos
  // as 7 lacunas. O dia analisado sai dos DOIS lados da fração: contá-lo só no
  // numerador é o que dava cobertura acima de 100% no dado real.
  assert.equal(d.diasEsperados, 24);
  assert.equal(d.diasComReceita, 17);
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
  assert.match(d.avisos.join(' '), /63 de 291 insumos comprados estão sem preço/);
});

test('insumo preparado sem preço não é falha de cadastro', () => {
  // O custo de um preparado sai da ficha (`comps`), não de compra. Na carteira
  // real, os 3.716 insumos `pronto` têm preço e os 126 sem preço são todos
  // preparados: cobrar preço deles seriam 126 alarmes falsos e nenhum
  // verdadeiro.
  const dados = mes({ mes: 8, ate: 25, receitaPorDia: 3000 });
  const insumos = [
    ...[...Array(20)].map((_, i) => ({ ...insumo(`preparado ${i}`), tipo: 'preparado' as const })),
    ...[...Array(80)].map((_, i) => insumo(`comprado ${i}`, 10)),
  ];

  const d = diagnosticar(dados, insumos, AGOSTO);
  assert.equal(d.insumosSemPreco, 0);
  assert.equal(d.insumosTotal, 80);
  assert.equal(d.avisos.some((a) => a.includes('sem preço')), false);
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

test('lançamento perdido lá atrás não define desde quando temos dado', () => {
  // O King tem um lançamento de 2017 e o Aukai tem de 2022. Usar `datas[0]`
  // acredita neles e desarma a trava de base parcial justamente nos clientes
  // que mais precisam dela.
  const datas = ['2017-08-26', '2026-07-13', '2026-07-14', '2026-07-20',
                 '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
                 '2026-08-05', '2026-08-06'].sort();
  assert.equal(inicioConfiavel(datas), '2026-07-13');
});

test('sem lançamento nenhum não há começo confiável', () => {
  assert.equal(inicioConfiavel([]), undefined);
});

test('um PAR de lançamentos perdidos próximos não engana o começo', () => {
  // O King tem 2020-07-30 e 2020-08-05 — seis dias entre si, e seis anos de
  // distância do resto. Procurando de frente para trás, a conta parava neles,
  // e o radar passava a comparar agosto de 2026 com agosto de 2025, um ano em
  // que o cliente não existia no Flow.
  const datas = [
    '2017-08-26', '2018-08-26', '2020-07-30', '2020-08-05', '2022-07-29',
    '2026-04-01', '2026-04-02', '2026-04-03',
  ];
  assert.equal(inicioConfiavel(datas), '2026-04-01');
});

test('histórico contínuo começa no primeiro dia, não 10% adiante', () => {
  const datas = Array.from({ length: 31 }, (_, i) =>
    `2026-07-${String(i + 1).padStart(2, '0')}`);
  assert.equal(inicioConfiavel(datas), '2026-07-01');
});

test('lançamento com data no futuro não vira o começo do histórico', () => {
  // O Restaurante JK tem dois lançamentos em novembro de 2026. Varrendo de trás
  // para frente sem teto, eles viravam o ponto de partida e apagavam os seis
  // meses de histórico do cliente com mais dado da carteira.
  // Uso contínuo de março a agosto (nenhum vão passa de 60 dias), mais os dois
  // lançamentos soltos de novembro.
  const datas = [
    '2026-03-01', '2026-04-15', '2026-06-01', '2026-07-15', '2026-08-26',
    '2026-11-14', '2026-11-21',
  ];
  assert.equal(inicioConfiavel(datas, 60, '2026-08-27'), '2026-03-01');
  // Sem o teto, o resultado é o próprio erro que isto corrige.
  assert.equal(inicioConfiavel(datas, 60), '2026-11-14');
});

test('mês com buraco no meio não serve de base, mesmo tendo começado cheio', () => {
  // É o caso que `dadosDesde` não pega: o cliente já usava o Flow, começou o
  // mês lançando, e parou duas semanas no meio. O total fica subestimado e
  // tudo que se comparar com ele parece ter crescido.
  const furado = mes({ mes: 7, ate: 31, receitaPorDia: 3000, pularDias: [10, 11, 12, 13, 14, 15, 16, 17] });
  assert.equal(janelaEstaCompleta(furado, janelaDoMes('2026-07-31')), false);
});

test('mês cheio serve de base', () => {
  const cheio = mes({ mes: 7, ate: 31, receitaPorDia: 3000 });
  assert.equal(janelaEstaCompleta(cheio, janelaDoMes('2026-07-31')), true);
});

test('um dia solto faltando não desqualifica o mês', () => {
  // A régua é 95%, a mesma que o radar já usava para dizer que a confiança do
  // dado é alta. Exigir 100% recusaria quase toda base real.
  const quase = mes({ mes: 7, ate: 31, receitaPorDia: 3000, pularDias: [12] });
  assert.equal(janelaEstaCompleta(quase, janelaDoMes('2026-07-31')), true);
});

test('período sem nenhum dia esperado não é base', () => {
  // Cobertura devolve 1 por convenção quando não há dia a cobrir, e "100% de
  // nada" não pode virar base.
  assert.equal(janelaEstaCompleta([], janelaDoMes('2026-07-31')), false);
});

test('cobertura nunca passa de 100%', () => {
  // Lançar no próprio dia analisado, ou num dia marcado como de fechamento,
  // dava 27 de 26 no Aukai e 23 de 22 no Soffri. Inofensivo enquanto a
  // cobertura só rebaixava confiança; grave quando ela decide se o período
  // serve de base.
  const dados = mes({ mes: 7, ate: 31, receitaPorDia: 3000 });
  const c = coberturaDaJanela(dados, janelaDoMes('2026-07-31'));
  assert.ok(c.cobertura <= 1, `cobertura foi ${c.cobertura}`);
  assert.equal(c.diasComReceita, c.diasEsperados.length - c.lacunas.length);
});
