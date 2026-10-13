// Proxy (função serverless da Vercel) para a API do site oficial do AION2 —
// a mesma que a página "Character Info" usa. Ela recusa chamadas vindas de
// outro site pelo navegador (CORS), então passamos por aqui.
//
// A API não é documentada: pode mudar ou sair do ar a qualquer momento. Toda
// falha volta como { error } e a página só avisa o usuário.
//
//   /api/char?op=servers&region=la
//   /api/char?op=search&region=la&keyword=nome[&serverId=1401]
//   /api/char?op=import&region=la&serverId=1401&characterId=...
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
const REGIONS = ['naw', 'nae', 'eu', 'la', 'as']
const SITE = 'https://aion2.plaync.com'
const SEARCH = 'https://api-search.plaync.com/aion2global/search/v2/character'

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw Object.assign(new Error('A API oficial respondeu ' + res.status), { status: 502 })
  return res.json()
}
const bad = (msg) => Object.assign(new Error(msg), { status: 400 })

// pcId → classe (ex.: 5 → "gladiator"); muda raramente, fica em memória
const classCache = {}
async function classOf(region) {
  if (!classCache[region]) {
    const d = await get(`${SITE}/en-us/api/gameinfo/pcdata?lang=en-US&region=${region}`)
    classCache[region] = Object.fromEntries((d.pcDataList || []).map((p) => [p.id, String(p.className).toLowerCase()]))
  }
  return classCache[region]
}

module.exports = async (req, res) => {
  const q = req.query || {}
  try {
    const region = String(q.region || '')
    if (!REGIONS.includes(region)) throw bad('Região inválida')

    if (q.op === 'servers') {
      const d = await get(`${SITE}/en-us/api/gameinfo/servers?lang=en-US&region=${region}`)
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
      return res.status(200).json({ servers: (d.serverList || []).map((s) => ({ id: s.serverId, name: s.serverName })) })
    }

    if (q.op === 'search') {
      const keyword = String(q.keyword || '').trim()
      if (keyword.length < 2 || keyword.length > 30) throw bad('Digite de 2 a 30 caracteres')
      const params = new URLSearchParams({ keyword, page: '1', size: '20', region, localeInfo: 'en-US' })
      if (/^\d+$/.test(String(q.serverId || ''))) params.set('serverId', q.serverId)
      const [d, classes] = await Promise.all([get(`${SEARCH}?${params}`), classOf(region)])
      return res.status(200).json({
        results: (d.list || []).map((c) => ({
          id: decodeURIComponent(c.characterId),
          name: String(c.name).replace(/<[^>]+>/g, ''),
          level: c.level,
          serverId: c.serverId,
          server: c.serverName,
          cls: classes[c.pcId] || null,
        })),
      })
    }

    if (q.op === 'import') {
      const characterId = String(q.characterId || '')
      const serverId = String(q.serverId || '')
      if (!characterId || characterId.length > 200 || !/^\d+$/.test(serverId)) throw bad('Personagem inválido')
      const base = `region=${region}&lang=en-US&characterId=${encodeURIComponent(characterId)}&serverId=${serverId}`
      const [info, eq, classes] = await Promise.all([
        get(`${SITE}/api/character/info?${base}`),
        get(`${SITE}/api/character/equipment?${base}`),
        classOf(region),
      ])
      const boardIds = (info.daevanion?.boardList || []).map((b) => b.id)
      const details = await Promise.all(
        boardIds.map((id) => get(`${SITE}/api/character/daevanion/detail?${base}&boardId=${id}`).catch(() => null))
      )
      const boards = {}
      boardIds.forEach((id, i) => {
        if (details[i]) boards[id] = (details[i].nodeList || []).filter((n) => n.open && n.type !== 'None').map((n) => n.nodeId)
      })
      const p = info.profile || {}
      return res.status(200).json({
        profile: { name: p.characterName, cls: classes[p.pcId] || null, level: p.characterLevel, server: p.serverName, combatPower: p.combatPower },
        skills: (eq.skill?.skillList || [])
          .filter((s) => s.acquired)
          .map((s) => ({ name: s.name, cat: s.category, equip: !!s.equip, level: s.skillLevel })),
        boards,
      })
    }

    throw bad('Operação inválida')
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Falha ao consultar a API oficial' })
  }
}
