// Gera data.js a partir do JSON extraído do planner do GameWith
// (https://gamewith.ai/aion2/en/daevanion-planner/gladiator), que por sua vez
// usa as páginas oficiais de personagem do AION2.
//
//   node tools/build-data.js <gladiator.json>
const fs = require('fs')
const path = require('path')

const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
// ícones das habilidades (gerado por tools/fetch-icons.js); opcional
const iconsPath = path.join(__dirname, '..', 'icons.json')
const icons = fs.existsSync(iconsPath) ? JSON.parse(fs.readFileSync(iconsPath, 'utf8')) : {}
const slim = {
  class: src.class,
  className: src.className.pt,
  boards: src.boards.map((b) => ({
    id: b.id,
    name: b.name.pt,
    totalCost: b.totalCost,
    nodes: b.nodes.map((n) => ({
      id: n.id,
      row: n.row,
      col: n.col,
      type: n.type,
      grade: n.grade,
      cost: n.cost,
      name: n.name.pt,
      // `stats` (EN) é a chave estável usada nos pesos; `effects` (PT) é o texto exibido
      stats: n.type === 'Stat' ? n.effects.en.map((e) => e.replace(/\s*\+[\d.]+%?$/, '')) : [],
      effects: n.effects.pt.filter(Boolean),
      ...(n.type === 'SkillLevel' && icons[n.effects.en[0].replace(/ \+1$/, '')] ? { icon: icons[n.effects.en[0].replace(/ \+1$/, '')] } : {}),
    })),
  })),
}
const out =
  '// Gerado por tools/build-data.js — não editar à mão.\n' +
  ';(function (root, data) {\n' +
  "  if (typeof module === 'object' && module.exports) module.exports = data\n" +
  '  else root.DAEVANION_DATA = data\n' +
  "})(typeof self !== 'undefined' ? self : this, " +
  JSON.stringify(slim) +
  ')\n'
fs.writeFileSync(path.join(__dirname, '..', 'data.js'), out)
console.log('data.js', out.length, 'bytes,', slim.boards.map((b) => b.name + ':' + b.nodes.length).join(' '))
