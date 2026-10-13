# Rota Daevanion

Calculadora de caminho para a Daevanion Board do **Gladiador** no Aion 2.

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

## Arquivos

- `index.html` — a página (sem build, sem dependências).
- `solver.js` — o algoritmo, puro; roda no navegador e no Node.
- `data.js` — as 5 boards (gerado por `tools/build-data.js`).
- `icons/` — ícones das habilidades (baixados por `tools/fetch-icons.js`).
- `tools/test-solver.js` — confere o solver exato contra força bruta: `node tools/test-solver.js`.

## Dados

Nodes, posições e efeitos vêm do planner do GameWith, que usa as páginas
oficiais de personagem do AION2 (versão global, 06/10/2026). O custo por node é
estimado pela raridade (1/2/3/4). Ícones e nomes pertencem à NCSOFT; este é um
projeto de fã, sem vínculo com a NCSOFT ou o GameWith.
