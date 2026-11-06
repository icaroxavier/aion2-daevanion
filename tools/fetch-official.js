// Baixa da API oficial do AION2 as boards que o planner do GameWith ainda não
// tem (hoje: Ariel) e insere em data/<classe>.js, na ordem do id.
//
//   node tools/fetch-official.js            (todas as classes)
//   node tools/fetch-official.js gladiator  (só uma)
//
// A API só entrega a board pela ficha de um personagem (a mesma da página
// Character Info, sem login): procuramos qualquer personagem global de cada
// classe e lemos a board inteira, aberta ou não. Os nodes têm o mesmo id,
// linha, coluna e raridade do GameWith (conferido na Azphel). O custo segue a
// raridade, como nas outras boards: Common 1, Rare 2, Legend 3, Unique 4.
const fs = require('fs')
const path = require('path')

const BOARDS = ['Ariel']
const CLASSES = ['gladiator', 'templar', 'ranger', 'assassin', 'elementalist', 'sorcerer', 'cleric', 'chanter']
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const SITE = 'https://aion2.plaync.com'
const SEARCH = 'https://api-search.plaync.com/aion2global/search/v2/character'
const REGION = 'la'
const KEYWORDS = ['Ice', 'Dark', 'Luz', 'Neo', 'Sol', 'Ka', 'Mo', 'Lu', 'Ra', 'Zen', 'Ash', 'Kai']
const COST = { Common: 1, Rare: 2, Legend: 3, Unique: 4 }
const ROOT = path.join(__dirname, '..')

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(res.status + ' ' + url)
  return res.json()
}

/** Um personagem qualquer de cada classe pedida: { slug: { characterId, serverId } } */
async function findCharacters(slugs) {
  const pc = await get(`${SITE}/en-us/api/gameinfo/pcdata?lang=en-US&region=${REGION}`)
  const classOf = Object.fromEntries(pc.pcDataList.map((p) => [p.id, String(p.className).toLowerCase()]))
  const found = {}
  for (const keyword of KEYWORDS) {
    if (slugs.every((s) => found[s])) break
    const params = new URLSearchParams({ keyword, page: '1', size: '50', region: REGION, localeInfo: 'en-US' })
    for (const c of (await get(`${SEARCH}?${params}`)).list || []) {
      const slug = classOf[c.pcId]
      if (slugs.includes(slug) && !found[slug]) found[slug] = { characterId: decodeURIComponent(c.characterId), serverId: c.serverId }
    }
  }
  const missing = slugs.filter((s) => !found[s])
  if (missing.length) throw new Error('nenhum personagem encontrado para: ' + missing.join(', '))
  return found
}

async function board(ch, name) {
  const q = (lang) => `region=${REGION}&lang=${lang}&characterId=${encodeURIComponent(ch.characterId)}&serverId=${ch.serverId}`
  const info = await get(`${SITE}/api/character/info?${q('en-US')}`)
  const meta = (info.daevanion?.boardList || []).find((b) => b.name === name)
  if (!meta) throw new Error('board não encontrada: ' + name)
  const [en, pt, ptInfo] = await Promise.all([
    get(`${SITE}/api/character/daevanion/detail?${q('en-US')}&boardId=${meta.id}`),
    get(`${SITE}/api/character/daevanion/detail?${q('pt-BR')}&boardId=${meta.id}`),
    get(`${SITE}/api/character/info?${q('pt-BR')}`),
  ])
  const ptById = new Map(pt.nodeList.map((n) => [n.nodeId, n]))
  const nodes = en.nodeList
    .filter((n) => n.type === 'Stat' || n.type === 'Start')
    .sort((a, b) => a.nodeId - b.nodeId)
    .map((n) => {
      const p = ptById.get(n.nodeId) || n
      const start = n.type === 'Start'
      return {
        id: n.nodeId,
        row: n.row,
        col: n.col,
        type: n.type,
        grade: n.grade,
        cost: start ? 0 : COST[n.grade],
        name: start ? p.name.replace(/ - .*$/, ' - Início') : p.name,
        stats: start ? [] : n.effectList.map((e) => e.desc.replace(/\s*\+[\d.]+%?$/, '')),
        effects: start ? [] : p.effectList.map((e) => e.desc).filter(Boolean),
      }
    })
  const other = en.nodeList.filter((n) => n.type !== 'None' && n.type !== 'Stat' && n.type !== 'Start')
  if (other.length) throw new Error(`${name}: tipo de node não suportado (${other[0].type})`)
  if (nodes.some((n) => n.type === 'Stat' && !n.cost)) throw new Error(`${name}: raridade sem custo conhecido`)
  const ptName = (ptInfo.daevanion?.boardList || []).find((b) => b.id === meta.id)?.name || name
  return { id: meta.id, name: ptName, totalCost: nodes.reduce((s, n) => s + n.cost, 0), nodes }
}

function rewrite(slug, extra) {
  const file = path.join(ROOT, 'data', slug + '.js')
  delete require.cache[require.resolve(file)]
  const data = require(file)
  const names = new Set(extra.map((b) => b.name))
  data.boards = [...data.boards.filter((b) => !names.has(b.name)), ...extra].sort((a, b) => a.id - b.id)
  const src = fs.readFileSync(file, 'utf8')
  const head = src.slice(0, src.indexOf("})(typeof self !== 'undefined' ? self : this, ") + "})(typeof self !== 'undefined' ? self : this, ".length)
  fs.writeFileSync(file, head + JSON.stringify(data) + ')\n')
  console.log(slug.padEnd(13), data.boards.map((b) => `${b.id}:${b.name}:${b.nodes.length}:${b.totalCost}`).join(' '))
}

;(async () => {
  const only = process.argv.slice(2)
  const slugs = only.length ? only : CLASSES
  const chars = await findCharacters(slugs)
  for (const slug of slugs) rewrite(slug, await Promise.all(BOARDS.map((name) => board(chars[slug], name))))
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
