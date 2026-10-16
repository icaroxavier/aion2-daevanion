// Baixa os detalhes de cada habilidade que tem node nas boards, das páginas de
// skill do MetaBot (https://metabot.gg/en/aion-2/skills/<skill>), que dizem ler
// os tooltips do cliente: tipo, efeito, cooldown, coeficiente de Ataque, dano
// base por nível e o texto do tooltip no nível 1 e no máximo.
// Grava data/skill-details.js.
//
//   node tools/fetch-skill-details.js
const fs = require('fs')
const path = require('path')

const CLASSES = ['gladiator', 'templar', 'ranger', 'assassin', 'elementalist', 'sorcerer', 'cleric', 'chanter']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slugOf = (name) =>
  name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/(td|th)>/g, ' | ')
    .replace(/<\/tr>/g, ' ##\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
}
const num = (s) => +String(s).replace(/,/g, '')

function parse(name, html) {
  const t = text(html)
  const out = { name }
  out.type = /Passive skill/.test(t) ? 'Passive' : /Active skill/.test(t) ? 'Active' : null
  const eff = /Effect type ([A-Za-z ]+?) (?:Usable|[A-Z][a-z]+ [a-z]|$)/.exec(t)
  out.effect = eff ? eff[1].trim() : null
  const dmgType = /Damage type ([A-Za-z]+)/.exec(t)
  out.damageType = dmgType ? dmgType[1] : null
  // tooltip no máximo: "What X does ... drag the slider to see any level. <texto> Level 40 / 40"
  const max = new RegExp('drag the slider to see any level\\. (.+?) (?:Cooldown \\d|MP \\d|Level \\d+ / \\d+)', 's').exec(t)
  out.tooltipMax = max ? max[1].trim() : null
  const lvMax = /Level (\d+) \/ (\d+)/.exec(t)
  out.maxLevel = lvMax ? +lvMax[2] : null
  // tooltip no nível 1: frase do resumo depois de "can be raised to skill level N."
  const lv1 = /can be raised to skill level \d+\.(?: Its cooldown at skill level 1 is [\d.]+s\.)? (.+?) (?:Read More|MetaBot Desktop)/s.exec(t)
  out.tooltip1 = lv1 ? lv1[1].trim() : null
  // tabela por nível: Level | Damage | Required Level | Cooldown | MP | Points
  const rows = [...t.matchAll(/^ ?(\d+) \| ([^|]*?)\|([^#]*)##/gm)]
  const levels = []
  for (const r of rows) {
    const cells = [r[2], ...r[3].split('|')].map((x) => x.trim())
    const lv = +r[1]
    const dm = /^([\d,]+) \(\+([\d.]+)% Attack\)/.exec(cells[0])
    const cd = cells.find((c) => /^[\d.]+s$/.test(c))
    levels[lv] = { base: dm ? num(dm[1]) : null, coef: dm ? +dm[2] : null, cd: cd ? parseFloat(cd) : null }
  }
  out.levels = levels.filter(Boolean).length ? levels : null
  return out
}

;(async () => {
  const all = {}
  const cache = new Map()
  for (const slug of CLASSES) {
    const data = require(path.join(__dirname, '..', 'data', slug + '.js'))
    const names = [...new Set(data.boards.flatMap((b) => b.nodes.filter((n) => n.skill).map((n) => n.skill)))]
    all[slug] = {}
    for (const name of names) {
      // a mesma skill (ex.: Defiance) existe em várias classes com a mesma página
      const mbClass = slug === 'elementalist' ? 'spiritmaster' : slug
      const urls = [`https://metabot.gg/en/aion-2/skills/${slugOf(name)}-${mbClass}`, `https://metabot.gg/en/aion-2/skills/${slugOf(name)}`]
      let got = null
      for (const url of urls) {
        if (cache.has(url)) {
          got = cache.get(url)
          break
        }
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        await sleep(250)
        if (!res.ok) continue
        const html = await res.text()
        got = parse(name, html)
        cache.set(url, got)
        break
      }
      all[slug][name] = got
      if (!got) console.log('  sem página:', slug, name)
    }
    const ok = Object.values(all[slug]).filter(Boolean)
    console.log(slug.padEnd(13), ok.length + '/' + names.length, 'skills | com tabela de dano:', ok.filter((x) => x.levels && x.levels[1] && x.levels[1].base != null).length)
  }
  // só o que o modelo usa: tipo, efeito, nível máximo, tooltips das passivas e,
  // nas ativas, cooldown/coeficiente do nível 1 e o dano-base por nível
  for (const c of Object.values(all)) {
    for (const [name, d] of Object.entries(c)) {
      if (!d) continue
      const lv = d.levels || []
      c[name] = {
        type: d.type, effect: d.effect, maxLevel: d.maxLevel, tooltip1: d.tooltip1,
        ...(d.type === 'Passive' ? { tooltipMax: d.tooltipMax } : {}),
        ...(lv[1] ? { cd: lv[1].cd, coef: lv[1].coef, base: lv.slice(1).map((x) => (x ? x.base : null)) } : {}),
      }
    }
  }
  const out =
    '// Gerado por tools/fetch-skill-details.js — não editar à mão.\n' +
    '// Fonte: páginas de skill do MetaBot (tooltips do cliente do jogo).\n' +
    ';(function (root, data) {\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = data\n" +
    '  else root.DAEVANION_SKILL_DETAILS = data\n' +
    "})(typeof self !== 'undefined' ? self : this, " +
    JSON.stringify(all) +
    ')\n'
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'skill-details.js'), out)
})()
