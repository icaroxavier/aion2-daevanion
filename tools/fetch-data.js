// Baixa as boards de todas as classes do planner do GameWith
// (https://gamewith.ai/aion2/en/daevanion-planner/<classe>) e os ícones das
// habilidades da página de classe, e grava data/<classe>.js + icons/*.webp.
//
//   node tools/fetch-data.js            (todas)
//   node tools/fetch-data.js gladiator  (só uma)
const fs = require('fs')
const path = require('path')

const CLASSES = ['gladiator', 'templar', 'ranger', 'assassin', 'elementalist', 'sorcerer', 'cleric', 'chanter']
const BASE = 'https://gamewith.ai/aion2/en'
const ROOT = path.join(__dirname, '..')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(res.status + ' ' + url)
  return res
}

/** Junta os chunks self.__next_f.push([1,"..."]) do HTML do Next. */
function flightPayload(html) {
  let out = ''
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let m
  while ((m = re.exec(html))) out += JSON.parse(m[1])
  return out
}

/** Extrai o objeto JSON que começa em `marker` (casando chaves). */
function jsonAt(text, marker) {
  const start = text.indexOf(marker)
  if (start < 0) throw new Error('marcador não encontrado: ' + marker)
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1))
  }
  throw new Error('JSON sem fim')
}

const skillName = (n) => n.effects.en[0].replace(/ \+1$/, '')

async function build(slug) {
  const src = jsonAt(flightPayload(await (await get(`${BASE}/daevanion-planner/${slug}`)).text()), '{"region":"global"')

  // ícones: pares { "src": "<url>" }], "<nome da skill>" na página da classe
  const classPayload = flightPayload(await (await get(`${BASE}/classes/${slug}`)).text())
  const iconOf = new Map()
  const re = /"src":"(https:\/\/assets\.gamewith\.ai\/[^"]+\/icons\/([A-Za-z0-9_]+\.webp))"\}\],"([^"]+)"/g
  let m
  while ((m = re.exec(classPayload))) if (!iconOf.has(m[3])) iconOf.set(m[3], { url: m[1], file: m[2] })

  fs.mkdirSync(path.join(ROOT, 'icons'), { recursive: true })
  const missing = new Set()
  const done = new Set()
  for (const b of src.boards) {
    for (const n of b.nodes) {
      if (n.type !== 'SkillLevel') continue
      const ic = iconOf.get(skillName(n))
      if (!ic) {
        missing.add(skillName(n))
        continue
      }
      if (done.has(ic.file)) continue
      done.add(ic.file)
      const dest = path.join(ROOT, 'icons', ic.file)
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, Buffer.from(await (await get(ic.url)).arrayBuffer()))
    }
  }

  const data = {
    class: slug,
    className: src.className.pt,
    boards: src.boards.map((b) => ({
      id: b.id,
      name: b.name.pt,
      totalCost: b.totalCost,
      nodes: b.nodes.map((n) => {
        const ic = n.type === 'SkillLevel' && iconOf.get(skillName(n))
        return {
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
          ...(n.type === 'SkillLevel' ? { skill: skillName(n) } : {}),
          ...(ic ? { icon: 'icons/' + ic.file } : {}),
        }
      }),
    })),
  }
  const out =
    '// Gerado por tools/fetch-data.js — não editar à mão.\n' +
    ';(function (root, data) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = data\n" +
    '  else (root.DAEVANION_DATA = root.DAEVANION_DATA || {})[data.class] = data\n' +
    "})(typeof self !== 'undefined' ? self : this, " +
    JSON.stringify(data) +
    ')\n'
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'data', slug + '.js'), out)
  console.log(slug.padEnd(13), data.className.padEnd(14), data.boards.map((b) => b.name + ':' + b.nodes.length).join(' '), '| ícones', done.size, missing.size ? '| SEM ÍCONE: ' + [...missing].join(', ') : '')
  return data
}

;(async () => {
  const only = process.argv.slice(2)
  const stats = new Set()
  for (const slug of only.length ? only : CLASSES) {
    const d = await build(slug)
    for (const b of d.boards) for (const n of b.nodes) n.stats.forEach((s) => stats.add(s))
  }
  console.log('stats:', [...stats].sort().join(' | '))
})()
