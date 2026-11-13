# Rota Daevanion

Calculadora de caminho para a Daevanion Board do Aion 2, para as 8 classes.

Você escolhe a classe e o papel: DPS em todas (defensivos começam em 0), Tank no
Gladiador e no Templário (vida efetiva estimada) e Healer no Clérigo e no
Encantador (cura estimada).

Você marca o que é obrigatório (um node específico ou um tipo inteiro) e dá um
peso para cada tipo de node de cada árvore. A página calcula o conjunto de nodes
que liga tudo ao início gastando o mínimo de pontos, preferindo passar pelos
nodes de maior peso.

## Como funciona

O problema é uma árvore de Steiner com peso nos nodes: achar o conjunto conexo
(vizinhança em cruz) que contém o início e todos os obrigatórios minimizando
`custo − t · peso`.

- Até 12 obrigatórios por árvore: solução **exata** (DP de Dreyfus–Wagner).
- Acima disso: heurística (caminho mais curto com reinícios + busca local),
  marcada na tela como aproximada.
- Com o critério em 0, menos pontos sempre vence e o peso só desempata.

## Salvar e compartilhar

O endereço da página carrega a configuração da classe aberta (`#s=...`) e
"Salvar em arquivo" grava um JSON com todas as classes. O navegador só guarda o
último endereço usado, para reabrir de onde parou. Pesos editados ficam
guardados por papel (DPS, Tank, Healer). O arquivo tem `schema`; `migrate()` em `app.js` leva versões antigas
até a atual, e `adopt()` descarta o que não existe mais nos dados do jogo.
Links antigos (v1) continuam abrindo.

## Arquivos

- `index.html` + `app.js` — a página (sem build, sem dependências).
- `solver.js` — o algoritmo, puro; roda no navegador e no Node.
- `data/<classe>.js` — as 6 boards de cada classe, carregadas sob demanda.
- `icons/` — ícones das habilidades.
- `tools/fetch-data.js` — baixa boards e ícones de todas as classes.
- `tools/fetch-official.js` — baixa da API oficial as boards que o GameWith não
  tem (Ariel). `fetch-data.js` mantém essas boards ao rodar de novo.
- `tools/test-solver.js` — confere o solver exato contra força bruta.

## Dados

Nodes, posições e efeitos vêm do planner do GameWith, que usa as páginas
oficiais de personagem do AION2 (versão global, 06/10/2026). A Ariel, que o
GameWith ainda não tem, vem direto da API oficial (06/11/2026); mesmo layout
nas 8 classes. Os pesos dos stats em JvA e contra Chefe são estimativas
(comentário em `ROLES`, `app.js`). O custo por node é
estimado pela raridade (1/2/3/4). Ícones e nomes pertencem à NCSOFT; este é um
projeto de fã, sem vínculo com a NCSOFT ou o GameWith.

## Importar personagem

`api/char.js` é um proxy (função serverless da Vercel) para a API do site
oficial do AION2 — a mesma da página Character Info, sem login. Busca por nome,
região e servidor (somente servidores globais) e traz a classe, os nodes já
abertos (entram com custo zero) e as habilidades do personagem. A API não é
documentada e pode falhar a qualquer momento; a página só avisa e segue.

## Montagem automática

"Melhor build com X pontos" divide X entre Nezekan, Zikel, Vaizel e Triniel:
liga os obrigatórios e gasta o resto nos nodes de maior peso por ponto
(heurística gulosa por caminho + busca local trocando folhas). Também dá para
usar um orçamento só para a árvore aberta.

## Pesos dos atributos

Os pesos padrão (`ROLES` e `CLASS_WEIGHTS` em `app.js`) seguem o guia do
kanonxo (cap. 11, fórmula de dano do AionLab; cap. 12, Gladiador de 180k CP no
Global) e o modelo de pontuação da aion2tool, calibrados para o endgame do
Global. Escala: 1 = node de Ataque Adicional +3 (≈ 0,049% de dano). Exemplos no
DPS: Velocidade de Combate 24, Amplificação de Dano 16, Recarga 11, Dano Crítico
9–10 (teto de 50% de crítico), Golpes Múltiplos 8. No Tank, Tolerância a Dano
vale 25, e Resist. a Acerto Crítico, Tol. a Dano Crítico e Resist. a Golpes
Múltiplos valem 0 em PvE (chefes não usam esses stats).

Na Azphel (JvJ) valem pesos próprios (`PVP_ATTACK`/`PVP_DEFENSE` em `app.js`):
num duelo vence quem mata primeiro, então +1% de vida efetiva vale tanto quanto
+1% de dano. Amplificação e Tolerância em JvJ 18, Acerto Crítico e Resistência
em JvJ 5, Resist. a Alteração de Estado 5, Defesa em JvJ quase nada (o guia diz
que em JvJ a Defesa só tira 1% do valor). O DPS pesa a defesa em 70% (85% quem
luta colado; 100% Gladiador e Templário).

"Desempate" (0 a 10 por tipo) só decide entre opções de mesmo peso, como qual
node de peso 0 usar de passagem, e recebe a sobra de pontos. O solver compara
primeiro o peso real e só depois o desempate (`opts.tieOf` em `solver.js`),
então o desempate nunca custa peso.

## Pesos das habilidades

`skill-model.js` estima o peso de +1 nível de cada habilidade, por classe e papel:

- Ativas com dano (ou cura, no Healer): dano-base ganho por nível × usos por
  segundo (cooldown, ~1 s por conjuração), dividido pelo que +3 de Ataque rende
  na mesma rotação. Dados de `data/skill-details.js` (`tools/fetch-skill-details.js`,
  páginas de skill do MetaBot).
- Passivas: quanto cada efeito sobe por nível (tooltip no nível 1 e no máximo),
  convertido pelo valor do atributo no papel.
- No DPS, onde há dados de medidor (aion2tool), vale a participação de cada
  skill no dano: +1 nível = +1,35% do dano dela (+2% nas ativas, pelos bônus dos
  níveis 8/12/16/20). As ativas com participação conhecida já entram marcadas.
- O resto cai na amostra de uso (`data/skill-stats.js`, `tools/fetch-skill-stats.js`).

`node tools/dev-server.js` sobe a página com a função `/api/char` localmente.

## Habilidades e fontes de pontos

Ativas: o jogador marca as que importam; no DPS, as ativas-chave da classe já
vêm marcadas. Passivas entram marcadas. O peso de cada uma vem de
`skill-model.js` (ver acima). A montagem automática pode dividir um total de pontos entre as 4 árvores
(Ariel e Azphel usam pontos próprios). A seção "Fontes de pontos" soma nível, missões
regionais, masmorras seladas e lojas (contagens do guia do MetaBot).
