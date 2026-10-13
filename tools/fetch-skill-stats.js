// Monta a estatística de uso de habilidades por classe a partir da API do site
// oficial (a mesma da página Character Info): amostra personagens nível 45 de
// cada classe e agrega, por skill, nível médio e % com a skill na barra.
// Vira o peso padrão dos nodes de habilidade. Grava data/skill-stats.js.
//
//   node tools/fetch-skill-stats.js [amostra por classe = 16] [região = nae]
const fs = require('fs')
const path = require('path')

const SAMPLE = +process.argv[2] || 16
const REGION = process.argv[3] || 'nae'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
// className do pcdata oficial → nosso slug
const SLUG = { gladiator: 'gladiator', templar: 'templar', ranger: 'ranger', assassin: 'assassin', elementalist: 'elementalist', spiritmaster: 'elementalist', sorcerer: 'sorcerer', cleric: 'cleric', chanter: 'chanter' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(res.status + ' ' + url)
  return res.json()
}

;(async () => {
  const pc = await get(`https://aion2.plaync.com/en-us/api/gameinfo/pcdata?lang=en-US&region=${REGION}`)
  const list = pc.pcDataList || pc.list || pc
  const byClass = {}
  for (const p of list) {
    const slug = SLUG[String(p.className || '').toLowerCase()]
    if (slug) (byClass[slug] = byClass[slug] || []).push(p.id)
  }

  const all = {}
  for (const [slug, pcIds] of Object.entries(byClass)) {
    // personagens nível 45 da classe (a busca exige palavra-chave; variamos as vogais)
    const chars = new Map()
    for (const kw of ['a', 'e', 'i', 'o']) {
      if (chars.size >= SAMPLE) break
      const r = await get(`https://api-search.plaync.com/aion2global/search/v2/character?keyword=${kw}&pcId=${pcIds.join(',')}&sort=level&page=1&size=40&region=${REGION}&localeInfo=en-US`)
      for (const c of r.list || []) if (c.level >= 45 && chars.size < SAMPLE) chars.set(c.characterId, c)
      await sleep(200)
    }
    const agg = {}
    let n = 0
    for (const c of chars.values()) {
      try {
        const eq = await get(`https://aion2.plaync.com/api/character/equipment?region=${REGION}&lang=en-US&characterId=${c.characterId}&serverId=${c.serverId}`)
        n++
        for (const s of eq.skill?.skillList || []) {
          if (!s.acquired) continue
          const a = (agg[s.name] = agg[s.name] || { cat: s.category, learned: 0, equipped: 0, levels: 0, max: 0 })
          a.learned++
          a.equipped += s.equip ? 1 : 0
          a.levels += s.skillLevel
          a.max = Math.max(a.max, s.skillLevel)
        }
      } catch (e) {}
      await sleep(200)
    }
    // só números agregados: nenhum nome ou id de personagem é guardado
    all[slug] = { sample: n, skills: {} }
    for (const [name, a] of Object.entries(agg)) {
      all[slug].skills[name] = {
        cat: a.cat,
        learned: +(a.learned / n).toFixed(2),
        equipped: +(a.equipped / n).toFixed(2),
        avg: +(a.levels / a.learned).toFixed(1),
        max: a.max,
      }
    }
    console.log(slug.padEnd(13), 'amostra', n, '| skills', Object.keys(agg).length)
  }
  const out =
    '// Gerado por tools/fetch-skill-stats.js — não editar à mão.\n' +
    `// Fonte: API do site oficial do AION2 (${REGION}), amostra de personagens nível 45 em ${new Date().toISOString().slice(0, 10)}.\n` +
    ';(function (root, data) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = data\n" +
    '  else root.DAEVANION_SKILL_STATS = data\n' +
    "})(typeof self !== 'undefined' ? self : this, " +
    JSON.stringify(all) +
    ')\n'
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'skill-stats.js'), out)
})().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
