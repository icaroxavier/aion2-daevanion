# Rota Daevanion

Calculadora de caminho para a Daevanion Board do Aion 2, para as 8 classes.

Você escolhe a classe e o papel (DPS; Tank para Gladiador e Templário). O papel
define os pesos padrão: no DPS, tudo que é defensivo começa em 0.

Você marca o que é obrigatório (um node específico ou um tipo inteiro) e dá um
peso para cada tipo de node de cada árvore. A página calcula o conjunto de nodes
que liga tudo ao início gastando o mínimo de pontos, preferindo passar pelos
nodes de maior peso.

## Como funciona

O problema é uma árvore de Steiner com peso nos nodes: achar o conjunto conexo
(vizinhança em cruz) que contém o início e todos os obrigatórios minimizando
`custo − t · peso`.

- Até 13 obrigatórios por árvore: solução **exata** (DP de Dreyfus–Wagner).
- Acima disso: heurística (caminho mais curto com reinícios + busca local),
  marcada na tela como aproximada.
- Com o critério em 0, menos pontos sempre vence e o peso só desempata.

## Link compartilhável

O endereço da página carrega a configuração inteira (`#s=...`): classe, papel,
critério, pesos alterados, obrigatórios e bloqueios. Abrir o link importa tudo.

## Arquivos

- `index.html` + `app.js` — a página (sem build, sem dependências).
- `solver.js` — o algoritmo, puro; roda no navegador e no Node.
- `data/<classe>.js` — as 5 boards de cada classe, carregadas sob demanda.
- `icons/` — ícones das habilidades.
- `tools/fetch-data.js` — baixa boards e ícones de todas as classes.
- `tools/test-solver.js` — confere o solver exato contra força bruta.

## Dados

Nodes, posições e efeitos vêm do planner do GameWith, que usa as páginas
oficiais de personagem do AION2 (versão global, 06/10/2026). O custo por node é
estimado pela raridade (1/2/3/4). Ícones e nomes pertencem à NCSOFT; este é um
projeto de fã, sem vínculo com a NCSOFT ou o GameWith.
