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

## De onde vem o dado

O radar lê o **banco do Flow**, não a API de integração.

Uma consulta em `organizacoes` devolve os 36 restaurantes de uma vez. Não há
token por cliente, não há cadastro manual, e um restaurante criado hoje entra
na rodada de amanhã sozinho. O acesso é o role `radar_leitura`, com `grant
select` só nessa tabela — não a `service_role` do Flow, que dá escrita em tudo.

Isso substituiu a leitura pela API, que tinha dois defeitos. O primeiro era não
escalar. O segundo é maior: **a API não expõe `qtd` no lançamento de compra.**
Sem quantidade não existe preço unitário, só gasto — e está escrito neste
README, na versão anterior, que separar *"o fornecedor aumentou"* de
*"compramos mais"* era impossível. Com o banco, deixou de ser: 1.804 dos 6.631
lançamentos da carteira têm quantidade, e 2.533 têm o insumo identificado.

O que ainda não dá:

- **CMV real** (estoque inicial + compras − estoque final) para a carteira.
  `cmvRegistros` existe no banco, mas são 44 contagens no total e 22 delas são
  de um cliente só — o Restaurante JK. Serve para ele, não para os outros.
- **Preço unitário em unidade `un`.** Ver a seção sobre preço pago.
- **Preço unitário no Restaurante JK**, que é o cliente com mais dado da
  carteira (458 compras, 6 meses de faturamento) e tem `qtd` e `insumoId`
  zerados nos 458. Ele entra por faturamento e CMV por compras.

O custo da troca: passamos a depender do formato interno do Flow em vez do
contrato da API. A mitigação é `conferirEstrutura` — o radar confere os campos
e reclama, em vez de produzir número errado em silêncio. Se o Flow renomear
`valor` ou `cat`, o cliente aparece como *parcial* com a frase do que mudou.

## Estado

**110 testes passando, `tsc --noEmit` limpo, `next build` verde**, e o painel
conferido no navegador contra o dump real das 36 organizações.

O mapeamento foi conferido contra o número que a versão anterior já produzia:
para o Soffri Grill, até 2026-08-25, CMV de **46,1%** e desvio de
**R$ 7.453,88** contra a meta — os mesmos da análise pela API.

```bash
npm install
npm test
DUMP_FLOW="$HOME/Downloads/Supabase Snippet Untitled query.csv" npm run demo 2026-08-27
npm run dev
```

Precisa de Node 20 ou mais novo. Para publicar na Vercel não precisa de Node
local.

## A carteira

Não se liga cliente: a carteira **é** a tabela `organizacoes` do Flow, menos o
que não é cliente.

```
FLOW_DATABASE_URL=postgresql://radar_leitura:SENHA@aws-0-<regiao>.pooler.supabase.com:6543/postgres
```

Fica de fora só isto:

- `_demo` — os seis restaurantes de demonstração do próprio Flow;
- `_arquivado` — cliente que saiu.

Cuidado com dois enganos aqui. `status` vale `'ativo'` para as 36 organizações,
inclusive as arquivadas — não serve de filtro. E `_arquivado: false` é comum,
então o teste é a chave ser verdadeira, não existir.

**Cliente sem lançamento nenhum entra na carteira.** Onze dos vinte e oito
clientes reais nunca lançaram nada. É tentador escondê-los para o painel ficar
limpo, mas cliente que parou de usar o Flow é exatamente a ligação que precisa
ser feita — some da tela e some da cabeça.

A meta de CMV é a que o cliente definiu no próprio Flow (`cmvAlvo`): dos 28
clientes reais, 27 estão no padrão de 30% e um em 38%. (Os outros alvos que
aparecem no banco — 28%, 31%, 33%, 35%, 36% — são dos restaurantes de
demonstração.) O radar não inventa meta.

Para investigar sem credencial e sem rede, exporte o dump no SQL Editor do Flow
(`select id, nome, atualizado_em, dados::text from organizacoes` → Download CSV)
e aponte `DUMP_FLOW` para o arquivo.

## CMV real, não CMV por compras

O número grande do cartão dizia só **CMV**, e era CMV **por compras**: a soma
dos lançamentos do grupo CMV dividida pelo faturamento. Isso mede o que a casa
comprou, não o que consumiu — num mês em que se compra para o mês seguinte,
estoura sem nada ter piorado.

Quando o cliente conta estoque, dá para saber o consumo de verdade:

```
consumo = estoque inicial + compras − estoque final
CMV     = consumo / vendas
```

**Vale a última contagem lançada.** Cada contagem já fecha o próprio período,
então somar várias não melhora nada, e a mais recente é a que descreve como a
casa está agora.

O tamanho do engano, medido no Restaurante JK (22 contagens, o único cliente com
massa):

| mês | por compras | real |
|---|---|---|
| junho | 45,9% | 45,4% |
| julho | 44,7% | 46,8% |
| **agosto** | **58,5%** | **45,0%** |

Nos meses em que a compra acompanha o consumo os dois coincidem. Em agosto o JK
comprou muito mais do que gastou.

E a troca reordena a carteira inteira:

| cliente | por compras | real (contagem) |
|---|---|---|
| Soffri Grill | 44,2% | **51,5%** — o pior da carteira |
| Matsu Sushi | 34,3% | **44,4%** |
| DuZeca Pizzaria | — | **37,7%** |
| Restaurante JK | 58,5% | **35,3%** |
| Rota do Sabor | 34,7% | **31,0%** |

O JK deixa de ser o pior caso e o Soffri passa a ser. Nos dois sentidos o painel
estava errando, e nos dois o erro passava de dez pontos.

**A armadilha: nem todo registro é uma contagem.** Casa da Nonna, King
Restaurante e Montello têm um registro com o estoque final preenchido e todo o
resto zerado — é o inventário de abertura, o retrato de quanto havia no dia em
que começaram a contar. Dividir por vendas zero daria `Infinity`, que atravessa
um painel inteiro sem ninguém ver de onde veio. `contagemServe()` exige vendas.

O rótulo do cartão agora diz de onde o número saiu — *"CMV real · contagem de
24/08"* ou *"CMV por compras"* — e avisa quando a contagem tem mais de 45 dias,
porque contagem velha descreve uma casa que talvez não exista mais.

Consequência no rodapé: a contagem carrega as próprias `vendas`, então um
cliente pode ter CMV medido sem lançar receita nenhuma. É a **DuZeca Pizzaria**,
com CMV real de 37,7% e zero lançamento de receita. Ela fica na carteira, com
traço no lugar do faturamento e a nota *"receita não lançada"* — mandá-la para o
rodapé esconderia justamente o número que ela tem.

## Contra o que comparar — a cascata

A regra, nesta ordem:

1. o mesmo período do **ano passado**;
2. se não houver dado lá, o mesmo período do **mês passado**;
3. se o mês passado não estiver **completo**, não se compara com nada.

O terceiro degrau é uma **recusa**, não uma ressalva. O dado é ignorado — não
zerado, não "estável" — e o painel diz "sem base", que é a verdade.

**Nada com data no futuro entra na análise.** Existe de verdade na carteira: o
Restaurante JK tem lançamentos em novembro de 2026, a Tenda Aldeia em setembro,
e outro cliente em 30/08. É mês ou ano digitado errado. Saem da soma, da série,
do preço e da decomposição, e reaparecem só no diagnóstico como aviso de
cadastro. A análise é sempre do mês vigente.

### O que "completo" quer dizer

Cobertura de **95%** dos dias esperados do período — descontados os dias em que
a casa não abre e o próprio dia analisado. Não é número novo: é a mesma régua
que o radar já usava para dizer que a confiança do dado é alta, e um período
que não serve para ser analisado não serve para ser base.

O veto vive em `OpcoesBase.periodoUtilizavel` e vale em **todo degrau da
cascata**, inclusive no ano passado. Fica ali, e não no `temBase` de quem chama,
porque a varredura escolhe uma base por indicador — a regra tem de valer para
todas igualmente, e deixá-la no chamador significaria repeti-la em cada um e
esquecê-la em algum.

Rodando contra o dump de 27/08/2026, sobram **três** bases em vinte e oito
clientes:

| cliente | julho | serve? |
|---|---|---|
| Restaurante JK | 22/22 dias | sim |
| Aukai Buffet | 26/26 | sim |
| Soffri Grill | 22/22 | sim |
| King Restaurante | 4/26 — 23 dias faltando | não |
| Matsu Sushi | 7/26 | não |
| Rota do Sabor | 10/22 — 13 dias faltando | não |
| Montello | 11/12 (92%) | não, por três pontos |

O Montello é o caso de fronteira: um dia faltando num mês de doze dias
esperados. A régua não abre exceção para denominador pequeno — um dia em doze é
8% do faturamento ausente, mais distorção do que um dia em vinte e seis.

### Duas travas que a cascata precisa por baixo

**1. Quando o cliente começou.** Um mês que o cliente começou a lançar no dia 13
nunca chega a ser avaliado como completo, mas a checagem de começo existe
separada porque é mais barata e porque diz outra coisa: `primeiroMesCheio`
(tolerância de 5 dias, porque o dia 1 pode cair em dia de casa fechada).

O começo não é `datas[0]`, e a conta é feita **de trás para frente**:
`inicioConfiavel` anda do lançamento mais recente para o passado e para no
primeiro vão maior que 60 dias. Duas tentativas anteriores erraram:

- *percentil*: num histórico contínuo cai sempre uns 10% adiante, e um julho
  lançado do dia 1 ao 31 virava "começou dia 6";
- *primeiro vão pequeno, de frente para trás*: basta um **par** de lançamentos
  perdidos próximos entre si. O King tem 2020-07-30 e 2020-08-05, a seis dias um
  do outro e a seis anos do resto — a trava virava 2020, e o radar comparava
  agosto de 2026 com agosto de **2025**, um ano em que o cliente não existia no
  Flow, tratando o zero como base.

E a varredura não pode enxergar além do dia analisado: sem teto, os lançamentos
de novembro do JK viravam o ponto de partida e apagavam os seis meses de
histórico do cliente com mais dado da carteira.

Correção de leitura, porque eu errei ao afirmar o contrário: o King **não**
lança desde abril. Ele tem dois lançamentos soltos em 01/04, depois 98 dias sem
nada, e o uso de verdade começa em 08/07.

**2. A cobertura não pode passar de 100%.** Contar todo dia com receita contra
os dias esperados dava 27 de 26 no Aukai e 23 de 22 no Soffri — o cliente lançou
no próprio dia analisado, que não está no denominador. Passava despercebido
enquanto a cobertura só rebaixava confiança; vira falha grave quando ela decide
se um período serve de base. O dia analisado sai dos dois lados da fração.

## A carteira não mostra quem não tem número

Dezenove dos vinte e oito clientes não lançaram receita no período. Misturados
na lista, o peso de "confiança baixa" os promovia em bloco: o **Sabor Mineiro,
38,4% de CMV contra meta de 30%, caía para a décima posição**, atrás de três
clientes sem dado nenhum.

Eles não somem — viram uma faixa no rodapé, com os nomes clicáveis: *"19
clientes sem receita lançada no período — é a conversa de voltar a usar o Flow,
não a de resultado."* Cliente que parou de lançar continua sendo uma ligação a
fazer; só não é a mesma conversa de quem está com o CMV estourado.

A carteira ficou com **nove cartões** e abre com o Restaurante JK: CMV de 58,5%
contra meta de 30%, resultado de −R$ 13.482 no mês.

## Preço de insumo — por evento, não por mês

Nota fiscal entra quando o cliente compra: semanal, quinzenal, quando der. Não
existe cadência, e amarrar isso a uma janela mensal esconde o que interessa —
**o dia em que o preço mudou**. Por isso esta parte do radar não tem janela.

Há duas fontes possíveis e só uma serve:

- ✗ **o valor do lançamento de CMV, sozinho.** É gasto, não preço. No Soffri, o
  tomate vai de R$ 40,99 a R$ 28,52 a R$ 49,62 em dez dias — isso é quantos
  quilos compraram naquele dia.
- ✓ **o campo `preco` do cadastro.** Unitário, e é ele que se atualiza quando
  entra nota nova.

(Desde a leitura pelo banco existe uma terceira, melhor que as duas: o preço
**pago** por compra, `valor / qtd`. Ver a seção seguinte. Esta aqui continua
valendo — é o preço de *tabela*, e quando as duas discordam, o cadastro está
desatualizado, o que também é um achado.)

O problema do preço de cadastro: o Flow guarda só o valor de agora, sem histórico. Então
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

## Preço pago — o que o banco destravou

`valor / qtd` no lançamento de compra é o preço unitário daquele dia, com a
nota e o fornecedor do lado. Não depende de retrato nenhum, e funciona desde a
primeira rodada.

**A trava obrigatória: só vale em unidade de peso ou volume.** Medido nas 225
séries de preço da carteira:

| unidade | séries | variação acima de 100% | mediana |
|---|---|---|---|
| kg, g, L, ml | 75 | **nenhuma** | 4% |
| `un` ou em branco | 87 | 3, e todas falsas | 0% |

Um quilo é sempre um quilo. Uma "unidade" é o que o fornecedor quiser — e o
rótulo não muda quando a embalagem muda:

```
Água Mineral s/ Gás   R$  1,59 → R$ 13,00   +718%    a garrafa contra o fardo
Arroz                 R$  5,18 → R$ 28,90   +458%    a unidade contra o saco de 5 kg
```

As duas lançadas como `un`. Por isso o alerta de preço só sai em peso e volume;
em `un` o radar calcula, marca `confiavel: false` e conta quantas deixou de
fora, em vez de escondê-las.

O que sobra é preço de verdade:

```
Limão      R$  5,99 → R$ 10,90 /kg   +82%   Soffri, 29/07 → 17/08
Alcatra    R$ 56,90 → R$ 82,90 /kg   +46%   Soffri, 19/08 → 21/08
Chuchu     R$  3,35 → R$  4,35 /kg   +30%   King,   08/07 → 25/08
```

### Preço ou volume

Com quantidade, a diferença de gasto se abre em duas:

```
Δgasto = (p₁ − p₀)·q₁  +  (q₁ − q₀)·p₀
           efeito preço     efeito volume
```

A soma fecha com a diferença de gasto, sem resíduo. É a resposta que se leva
para a ligação: *"você gastou R$ 1.200 a mais com carne"* não diz o que fazer;
*"R$ 900 é preço"* manda negociar com o fornecedor, e *"R$ 1.100 é volume"*
manda olhar ficha técnica, porção e desperdício.

**E aqui mora a armadilha maior deste módulo.** Rodando julho contra agosto no
dado real, quase tudo dá "volume" — mas o King começou a lançar compra em
08/07, a Rota do Sabor em 13/07 e o Matsu em 13/07. Para os três, "comprou
mais" quer dizer "lançou mais dias". É matemática correta em cima de janela
mentirosa, e é exatamente o erro que a ordem das três perguntas existe para
evitar.

Por isso `decomporCompras` devolve `{ efeitos, ressalva }` e não uma lista: a
ressalva viaja junto, e o painel não tem como mostrar o número sem ela. No dump
de 27/08 ela bloqueia King, Rota do Sabor e Matsu, e libera Soffri, Aukai e Bar
do Cris.

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
sql/04-carteira-...sql    tabela `relatorio` e a métrica cmv_real

src/flow/tipos.ts         o que o Flow guarda, conferido contra o dump real
src/flow/organizacao.ts   o JSON do Flow → o que o radar entende, e a conferência
src/flow/carteira.ts      a carteira: Postgres do Flow, ou o dump em CSV
src/flow/api.ts           só a interface FonteFlow (era o cliente HTTP)

src/analise/janela.ts     recorte e soma
src/analise/qualidade.ts  o dado presta?
src/analise/metas.ts      está na régua?
src/analise/periodo.ts    a cascata ano passado → mês passado → ignora
src/analise/varredura.ts  o motor genérico "o que piorou"
src/analise/dimensoes.ts  efeito custo x efeito faturamento, e quem causou
src/analise/precos.ts     mudança de preço de insumo, por evento
src/analise/cmvReal.ts    CMV por consumo, da última contagem de estoque
src/analise/precoPago.ts  preço pago por compra, e preço × volume
src/analise/compras.ts    gasto por produto no período
src/analise/catalogo.ts   os 19 indicadores vigiados

src/coleta/rodar.ts       a análise de um cliente, nos três passos
src/coleta/rodada.ts      analisar e gravar — o cron e o botão passam por aqui
src/coleta/painel.ts      de onde o painel tira os números (foto ou ao vivo)
src/app/                  o painel, na mesma ordem
src/app/api/cron/         a rotina diária
```

## Os dois bancos

São dois, e confundi-los é o caminho mais curto para um bug caro.

- **O banco do Flow** — onde estão os dados dos restaurantes. O radar só lê.
- **O banco do radar** — onde ele guarda uma foto por dia, que é o que permite
  responder "e comparado com a semana passada?".

### O painel abre pela foto, não pelo Flow

Lendo o Flow a cada carregamento de página são 5,5 MB por abertura, e isso não
sobrevive ao crescimento da carteira. A rodada da madrugada já apura tudo: o
painel mostra o que ela apurou, **diz de que horas é**, e a página do cliente
tem um **"atualizar agora"** que relê o Flow só daquele cliente.

A leitura ao vivo continua sendo o caminho normal em dois casos — sem banco
configurado (o desenvolvimento, contra o dump em disco) e antes da primeira
rodada do dia. Cair para o Flow é melhor que mostrar tela vazia, mas o painel
diz qual dos dois está mostrando: *"rodou e está assim"* e *"ainda não rodou
hoje"* são coisas diferentes.

Desenhar uma página **não grava nada**. Quem grava é a rodada, disparada pelo
cron ou pelo botão — e as duas passam pelo mesmo `rodarCliente`, porque duas
sequências de gravação diferentes é como se produz banco com metade dos dados
atualizados.

### Dois defeitos que só apareceriam em produção

**1. Nada populava a tabela `cliente`, e cinco tabelas têm chave estrangeira
para ela.** Quando a carteira deixou de ser uma lista de tokens e passou a ser
a tabela `organizacoes` do Flow, ninguém mais preenchia essa lista — e o `id`
virou o UUID da organização, que nunca esteve lá. Na primeira rodada com o banco
ligado, as vinte e oito gravações falhariam, uma a uma. Hoje isso não aparece
porque, sem `SUPABASE_URL`, o radar pula a gravação inteira.

Agora `sincronizarClientes` cadastra a carteira no começo de cada rodada — e não
numa migração de uma vez só, porque restaurante novo aparece no Flow sem avisar
ninguém, que é justamente o que a troca de arquitetura comprou.

**2. O que seria gravado não era o que a tela mostra.** A gravação recalculava
as métricas a partir do dado cru, incluindo os lançamentos com data no futuro
que a análise descarta — e guardava só CMV por compras. O CMV real, o preço pago
e a decomposição não iam para o histórico. Um radar que existe para acumular
série diária estaria jogando fora exatamente o número que passou a mostrar.

Agora o relatório carrega as métricas que a análise calculou (`r.metricas`), e é
delas que a gravação parte.

### Onde cada coisa fica

`snapshot_metrica` e `achado` guardam a **série**: respondem "como o CMV do
Soffri andou nos últimos 90 dias". `relatorio` guarda o **relatório pronto**, em
JSON, e é dele que o painel abre. Sim, é o mesmo dado em dois formatos —
reconstruir o relatório a partir das tabelas normalizadas exigiria refazer em
SQL a análise que já foi feita em TypeScript, e boa parte dele (preço pago,
decomposição, diagnóstico) não cabe naquele formato.

## Pendências fora do código

- **Rodar `sql/04-carteira-automatica.sql`** no banco do radar. Cria a tabela
  `relatorio` e cadastra a métrica `cmv_real`. Sem isso a gravação falha.
- **`FLOW_DATABASE_URL` na Vercel** — a connection string do Transaction pooler
  com o usuário `radar_leitura`.
- **`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` na Vercel** — o banco do radar.
  Enquanto não existirem, o painel funciona lendo o Flow ao vivo e não guarda
  histórico nenhum.
- **Regras de acesso do Supabase do Flow.** A tela de admin lê `flow_api_keys`
  direto do navegador; o que impede um cliente de ler o token de outro é a
  política de RLS dessa tabela. Vale conferir.
- **Revogar tokens que circularam** por print ou conversa, e gerar novos.
