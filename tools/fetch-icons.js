// Baixa os ícones das habilidades usadas nas boards a partir do payload da
// página de classe do GameWith (https://gamewith.ai/aion2/en/classes/gladiator)
// e grava icons/<ICON>.webp + icons.json (nome EN da skill → arquivo).
//
//   node tools/fetch-icons.js <class_payload.txt> <gladiator.json>
const fs = require('fs')
const path = require('path')

const payload = fs.readFileSync(process.argv[2], 'utf8')
const boards = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).boards
const need = new Set()
for (const b of boards) for (const n of b.nodes) if (n.type === 'SkillLevel') need.add(n.effects.en[0].replace(/ \+1$/, ''))

// pares { "src": "<url do ícone>" }], "<nome da skill>"
const pairs = new Map()
const re = /"src":"(https:\/\/assets\.gamewith\.ai\/[^"]+\/icons\/([A-Za-z0-9_]+\.webp))"\}\],"([^"]+)"/g
let m
while ((m = re.exec(payload))) if (!pairs.has(m[3])) pairs.set(m[3], { url: m[1], file: m[2] })

const dir = path.join(__dirname, '..', 'icons')
fs.mkdirSync(dir, { recursive: true })
;(async () => {
  const map = {}
  for (const name of need) {
    const p = pairs.get(name)
    if (!p) {
      console.log('sem ícone:', name)
      continue
    }
    const res = await fetch(p.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) {
      console.log('falhou', res.status, name)
      continue
    }
    fs.writeFileSync(path.join(dir, p.file), Buffer.from(await res.arrayBuffer()))
    map[name] = 'icons/' + p.file
  }
  fs.writeFileSync(path.join(__dirname, '..', 'icons.json'), JSON.stringify(map, null, 2))
  console.log(Object.keys(map).length + '/' + need.size, 'ícones')
})()
