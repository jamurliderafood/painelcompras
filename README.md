# Radar Flow

Duas telas:

- **Carteira** — um cartão por cliente com três números (faturamento, CMV
  contra a meta, resultado) e os insumos que mudaram de preço. Nada além
  disso: se não muda a decisão de para quem ligar hoje, não entra.
- **Cliente** — o detalhe inteiro, a um clique.

Lê o Flow de cada cliente todo dia e responde três perguntas, nesta ordem:

1. **O dado presta?**
2. **Está na régua?**
3. **Piorou?**

A ordem é o projeto inteiro. A comparação com o passado vem por último porque é
a parte mais frágil — e foi ela que, na primeira leitura do dado real do Soffri
Grill, quase produziu um alerta falso.

---

## Por que nesta ordem

Rodando contra o Soffri em 26/08/2026, o dado tinha três defeitos que nenhuma
análise financeira teria percebido sozinha:

- **4 dias sem lançamento de receita** no mês. A "queda de faturamento de 38%"
  era, em boa parte, lançamento atrasado. Por dia efetivamente lançado, a queda
  é de 20%.
- **A subcategoria "Entrada de Produtos" caiu de R$ 13.807 para R$ 997** porque
  o cliente parou de lançar compra em bloco e passou a detalhar. Toda
  subcategoria de proteína e hortifruti "subiu" — o dinheiro só mudou de gaveta.
  Um ranking de ofensores ingênuo diria *"proteína bovina, +4,5 pontos"*.
- **R$ 10.220 em lançamentos recorrentes ainda não feitos** — salários, FGTS,
  férias. Enquanto não forem lançados, mão de obra e encargos "melhoram" e o
  resultado do mês fica superestimado.

E o achado mais forte não dependeu de comparação nenhuma: **CMV em 46,1% contra
meta de 30% — R$ 7.453 no período.**

Com 2,5 meses de histórico, é isso que entrega valor: régua e qualidade de
lançamento. A comparação com o passado ganha peso conforme o histórico cresce.

## Como cada pergunta é respondida

**1 · O dado presta** (`src/analise/qualidade.ts`)

| checagem | o que pega |
|---|---|
| cobertura | dias sem lançamento de receita, descontando os dias em que a casa não abre e o próprio dia analisado |
| reclassificação | subcategoria que some enquanto outras crescem e o total do grupo mal se move |
| ausência | lançamento recorrente do período anterior que não aparece neste |
| cadastro | insumo sem preço |
| data fora de faixa | lançamento perdido anos atrás, que faz o histórico parecer maior do que é |

O resultado é uma **confiança** — alta, média ou baixa — que abre o relatório.
Quem lê precisa saber a ressalva antes do número, não depois.

**2 · Está na régua** (`src/analise/metas.ts`)

Indicador contra a meta do cliente, com o desvio convertido em reais. Só o CMV
tem valor padrão (30%, o padrão do próprio Flow); para os outros eu não
inventei número — régua chutada por mim viraria alerta com cara de autoridade.
Sem meta cadastrada, o indicador é registrado e não é julgado.

**3 · Piorou** (`src/analise/periodo.ts`, `varredura.ts`, `dimensoes.ts`)

A cascata definida pela Lidera, sobre o acumulado do mês: mesmo intervalo do ano
passado → mesmo intervalo do mês passado → **ignorado e marcado como "sem
base"**, nunca como estável.

Toda variação de indicador percentual é aberta em duas causas que somam
exatamente a variação:

| efeito | o que é | o que fazer |
|---|---|---|
| custo | gastou mais (ou menos) em reais | negociar, trocar fornecedor, cortar |
| faturamento | o denominador mudou; o gasto nem se mexeu | é problema de venda |

No Soffri: CMV +8,9 pontos, dos quais **+22,7 vieram do faturamento** e −13,9 do
custo. Sem essa separação, o painel mandaria negociar com fornecedor um problema
de venda.

Depois vem o ranking de quem — por subcategoria, ordenado pelo efeito de custo,
que é a parte acionável. **Quando há reclassificação no grupo, o ranking é
suprimido** e o painel diz por quê, em vez de apontar o culpado errado.

## O que não dá para fazer, e por quê

A API do Flow expõe cinco endpoints: `/v1/resumo`, `/v1/lancamentos`,
`/v1/produtos` (GET e POST nos dois últimos). Ela **não** expõe fichas técnicas,
contagem de estoque nem o histórico de CMV por inventário — dados que existem
dentro do Flow.

Sem eles:

- não há **CMV real** (estoque inicial + compras − estoque final), só CMV por
  compras, que é compra e não consumo: num mês em que se compra para o mês
  seguinte, ele estoura sem nada ter piorado;
- não dá para separar *"o fornecedor aumentou o preço"* de *"compramos mais"*.

A API é da Lidera. Acrescentar `GET /v1/fichas` e `GET /v1/estoque` destrava as
duas coisas, e o motor de decomposição em preço/mix/quebra já foi escrito uma
vez — está no histórico do projeto.

## Estado

51 testes passando, `tsc --noEmit` limpo, `next build` verde, painel conferido
no navegador contra o dado real do Soffri Grill.

```bash
npm install
npm test
FONTE=arquivo PASTA_FLOW=~/Downloads npm run demo 2026-08-26
npm run dev
```

Precisa de Node 20 ou mais novo. Para publicar na Vercel não precisa de Node
local.

## Ligar um cliente

Um cliente entra na carteira com uma variável de ambiente, e só com isso — não
existe endpoint no Flow que liste as organizações, então quem define a carteira
é a lista de tokens.

```
FLOW_TOKEN_SOFFRI_GRILL=flow_xxxxxxxx
FLOW_NOME_SOFFRI_GRILL=Soffri Grill          # opcional
FLOW_METAS_SOFFRI_GRILL={"cmv":0.32}         # opcional, senão vale 30%
```

O token sai do Flow: admin → o restaurante → **API de integração** → *Gerar
novo token*. Cadastre a meta junto: com histórico curto, a régua é o que
entrega valor.

Quando passar de uma dúzia de clientes, isso migra para as tabelas `cliente` e
`cliente_config` — o código já lê de lá quando `SUPABASE_URL` existe.

Para investigar sem gastar chamada, salve as respostas em arquivo e rode com
`FONTE=arquivo PASTA_FLOW=<pasta>`. É assim que os testes olham dado real.

## Preço de insumo — por evento, não por mês

Nota fiscal entra quando o cliente compra: semanal, quinzenal, quando der. Não
existe cadência, e amarrar isso a uma janela mensal esconde o que interessa —
**o dia em que o preço mudou**. Por isso esta parte do radar não tem janela.

Há duas fontes possíveis e só uma serve:

- ✗ **o valor do lançamento de CMV.** É gasto, não preço. No Soffri, o tomate
  vai de R$ 40,99 a R$ 28,52 a R$ 49,62 em dez dias — isso é quantos quilos
  compraram naquele dia. Sem quantidade na nota, comparar lançamento com
  lançamento produz alarme falso constante.
- ✓ **o campo `preco` do cadastro** (`GET /v1/produtos`). Unitário, e é ele que
  se atualiza quando entra nota nova.

O problema do segundo: a API devolve só o valor de agora, sem histórico. Então
o radar **guarda um retrato do cadastro a cada rodada** (tabela
`retrato_preco`) e compara retrato com retrato. Cada mudança vira um evento
datado:

```
Contra Filé   R$ 44,73 → R$ 63,90   +42,9%   26/08, após 7 dias no preço anterior
```

Consequência honesta: **isso só produz resultado a partir da segunda coleta.**
Antes disso o painel diz exatamente isso, em vez de mostrar uma lista vazia com
cara de "está tudo estável".

Dois detalhes que o modelo cobre: um insumo que ficou dois meses no mesmo preço
e subiu 20% é notícia diferente de um que oscila toda semana — daí o "após N
dias no preço anterior". E se a **embalagem** mudar junto, a porcentagem não
vale (R$ 45 o pacote de 6 não é comparável com R$ 9 a unidade): a linha vai
para uma seção separada, sem percentual.

Para conferir sem esperar dois dias de coleta, salve retratos datados na pasta
(`flow-produtos-2026-08-19.json`) e rode com `FONTE=arquivo`.

## Gasto por produto

Coisa diferente de preço: aqui é **quanto se gastou** com cada produto no
período, para entender a composição do CMV. O nome vive no campo `descricao` do
lançamento de CMV — "Tomate", "Coxão Mole", "Rúcula". Não há cadastro ligando
lançamento a produto, então agrupar por esse texto é o que existe, e texto
digitado à mão traz dois problemas, os dois vistos no Soffri:

- **o mesmo item escrito de jeitos diferentes.** "Ancho / Contra Filé 33,605 Kg"
  em julho, "contra file" em agosto. O peso e o acento saem do nome na
  normalização, e as grafias somam num produto só;
- **mudança de granularidade.** Julho lançava "Mercado" (R$ 8.075 num nome só);
  agosto detalha item a item. Aí não existe comparação possível — o painel diz
  isso e **não mostra ranking**, em vez de anunciar "Coxa, produto novo,
  +R$ 2.569" para dinheiro que já era gasto.

Sem quantidade na nota, "ficou mais caro" e "compramos mais" aparecem os dois
como gasto maior — por isso esta seção não deve ser lida como preço. Para preço,
a seção anterior.

## Organização

```
sql/01-esquema.sql        banco: métricas, achados, confiança, diagnóstico
sql/02-carga.sql          catálogo, espelhando os grupos do Flow

src/flow/tipos.ts         o que a API devolve, conferido contra resposta real
src/flow/api.ts           cliente HTTP + fonte por arquivo

src/analise/janela.ts     recorte e soma
src/analise/qualidade.ts  o dado presta?
src/analise/metas.ts      está na régua?
src/analise/periodo.ts    a cascata ano passado → mês passado → ignora
src/analise/varredura.ts  o motor genérico "o que piorou"
src/analise/dimensoes.ts  efeito custo x efeito faturamento, e quem causou
src/analise/precos.ts     mudança de preço de insumo, por evento
src/analise/compras.ts    gasto por produto no período
src/analise/catalogo.ts   os 19 indicadores vigiados

src/coleta/rodar.ts       a rodada de um cliente, nos três passos
src/app/                  o painel, na mesma ordem
src/app/api/cron/         a rotina diária
```

## Pendências fora do código

- **Regras de acesso do Supabase do Flow.** A tela de admin lê `flow_api_keys`
  direto do navegador; o que impede um cliente de ler o token de outro é a
  política de RLS dessa tabela. Vale conferir.
- **Revogar tokens que circularam** por print ou conversa, e gerar novos.
