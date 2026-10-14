;(function () {
  const { solve, solveMany } = window.DaevanionSolver
  const $ = (id) => document.getElementById(id)
  const fmt = (x) => (Math.round(x * 100) / 100).toLocaleString('pt-BR')
  const round1 = (x) => Math.round(x * 10) / 10
  const int = (x, max) => Math.min(max === undefined ? 1e6 : max, Math.max(0, Math.floor(+x || 0)))

  // ---- classes e papéis -----------------------------------------------------
  // por ora só DPS (Tank e Healer ficam para depois)
  const CLASSES = [
    { slug: 'gladiator', name: 'Gladiador', roles: ['dps'] },
    { slug: 'templar', name: 'Templário', roles: ['dps'] },
    { slug: 'ranger', name: 'Arqueiro', roles: ['dps'] },
    { slug: 'assassin', name: 'Assassino', roles: ['dps'] },
    { slug: 'elementalist', name: 'Espiritualista', roles: ['dps'] },
    { slug: 'sorcerer', name: 'Mago', roles: ['dps'] },
    { slug: 'cleric', name: 'Clérigo', roles: ['dps'] },
    { slug: 'chanter', name: 'Encantador', roles: ['dps'] },
  ]
  // Peso padrão por stat (chave em inglês, estável) em cada papel. Stat que não
  // aparece vale 0 — no DPS, tudo que é defensivo.
  //
  // Escala: 1,0 = um node comum de Ataque Adicional +3. Os % (nodes únicos) são
  // convertidos por dano real estimado no endgame (KR), segundo
  // https://gameplay.tips/guides/aion-2-how-stats-work-damage-formula-guide.html:
  //   Ataque Adicional  ~0,1% de dano a cada 10  → +3    ≈ 0,03%  → 1
  //   Amplif. de Dano   ~0,35% por 1%            → +1,5% ≈ 0,53%  → 17
  //   Golpes Múltiplos  ~0,33% por 1%            → +1,5% ≈ 0,50%  → 16
  //   Dano Crítico      ~0,4–0,6% por 1%         → +1,5% ≈ 0,75%  → 25
  // Sem número publicado (estimativa nossa): Velocidade de Combate ~0,7% por 1%
  // (→ 35) e Redução de Recarga ~0,5% por 1% (→ 25). Acerto Crítico, Precisão e
  // Acerto de Alteração de Estado ficam em 1 por falta de conversão conhecida.
  const ROLES = {
    dps: {
      name: 'DPS',
      weights: {
        'Attack Bonus': 1, 'PvP Attack': 1, 'Critical Hit': 1, 'PvP Critical Hit': 1, 'PvP Accuracy': 1, 'Status Effect Chance': 1,
        'Damage Boost': 17, 'PvP Damage Boost': 17, 'Multi-hit Chance': 16, 'Critical Damage Boost': 25,
        'Cooldown Reduction': 25, 'Combat Speed': 35,
      },
    },
  }
  const ABBR = {
    'Attack Bonus': 'ATQ', 'Critical Hit': 'CRI', 'Critical Hit Resist': 'RCR', 'Defense Bonus': 'DEF', HP: 'PV', MP: 'PM',
    'Combat Speed': 'VEL', 'Cooldown Reduction': 'REC', 'Damage Boost': 'DAN', 'Damage Tolerance': 'TOL',
    'Critical Damage Boost': 'DCR', 'Critical Damage Tolerance': 'TCR', 'Multi-hit Chance': 'MUL', 'Multi-hit Resist': 'RMU',
    'PvP Attack': 'ATQ', 'PvP Defense': 'DEF', 'PvP Critical Hit': 'CRI', 'PvP Critical Hit Resist': 'RCR', 'PvP Accuracy': 'PRE',
    'PvP Evasion': 'EVA', 'PvP Damage Boost': 'DAN', 'PvP Damage Tolerance': 'TOL', 'Status Effect Chance': 'EST', 'Status Effect Resist': 'RES',
  }
  // Azphel (JvJ) usa outra moeda: fica fora do total compartilhado de pontos
  const isPvpBoard = (b) => b.name === 'Azphel'

  // ---- dados por classe (carregados sob demanda) ---------------------------
  // Tipo de node = mesmo efeito (ex.: "Ataque Adicional +3") ou mesma habilidade.
  // `key` é a identidade ESTÁVEL usada em tudo que é salvo (independe de
  // tradução); `label` é só o texto exibido.
  const PREP = {}
  function prepare(data) {
    return data.boards.map((b) => {
      const types = new Map()
      for (const n of b.nodes) {
        if (n.type === 'Start') continue
        const key = n.type === 'SkillLevel' ? 'skill:' + n.skill : 'stat:' + n.stats.join('+') + '@' + n.cost
        n.typeKey = key
        if (!types.has(key)) {
          types.set(key, { key, label: n.effects.join(' · '), skill: n.type === 'SkillLevel', grade: n.grade, cost: n.cost, stats: n.stats, nodes: [] })
        }
        types.get(key).nodes.push(n)
      }
      // a ordem (por label) é a mesma desde a 1ª versão: links antigos guardam o índice
      const list = [...types.values()].sort((a, b2) => a.skill - b2.skill || b2.cost - a.cost || a.label.localeCompare(b2.label, 'pt'))
      const rows = b.nodes.map((n) => n.row)
      const cols = b.nodes.map((n) => n.col)
      return {
        ...b, types: list, typeByKey: types, byLabel: new Map(list.map((t) => [t.label, t])), byId: new Map(b.nodes.map((n) => [n.id, n])),
        r0: Math.min(...rows), r1: Math.max(...rows), c0: Math.min(...cols), c1: Math.max(...cols),
      }
    })
  }
  function loadClass(slug) {
    if (PREP[slug]) return Promise.resolve(PREP[slug])
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'data/' + slug + '.js'
      s.onload = () => {
        PREP[slug] = prepare(window.DAEVANION_DATA[slug])
        adopt(slug)
        resolve(PREP[slug])
      }
      s.onerror = () => reject(new Error('Não foi possível carregar os dados da classe.'))
      document.head.appendChild(s)
    })
  }

  // ---- estado salvo (versionado) --------------------------------------------
  // Formato atual (SCHEMA 3) do arquivo exportado.
  //   { schema, cls, lambda,
  //     classes: { [slug]: {
  //       role, pool, skills: { [nomeEN]: bool }, skillsDone, sources: {...}, char: {...},
  //       boards: { [boardId]: { weights: { [typeKey]: n }, reqTypes: [typeKey], reqNodes: [id], blocked: [id], owned: [id], budget } } } } }
  //
  // Regras para mudar sem quebrar quem já tem dados:
  //   1. Campo novo: só ler com valor padrão (normalize) — não precisa subir SCHEMA.
  //   2. Mudou o significado ou o formato de um campo: suba SCHEMA e acrescente
  //      um passo em MIGRATIONS (de N para N+1). Nunca edite um passo antigo.
  //   3. Campos desconhecidos são preservados; o que não bate com os dados
  //      atuais do jogo (tipo ou node que sumiu) é descartado em adopt().
  const SCHEMA = 3
  const MIGRATIONS = {
    // 2 → 3: papel Tank saiu; tipos passaram a ter chave estável (a troca das
    // chaves antigas, que eram o texto em português, acontece em adopt()).
    2: (s) => {
      for (const c of Object.values(s.classes || {})) if (c && c.role === 'tank') c.role = 'dps'
      return s
    },
  }
  const emptyBoard = () => ({ weights: {}, reqTypes: [], reqNodes: [], blocked: [], owned: [], budget: 0 })
  const emptySources = () => ({ level: 0, quests: 0, dungeons: 0, festival: 0, nightmare: 0, other: 0 })
  const ids = (a) => (Array.isArray(a) ? a.filter((x) => Number.isInteger(x)) : [])

  /** Leva dados de qualquer versão conhecida até a atual. null = irreconhecível. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.classes !== 'object' || !raw.classes) return null
    let s = JSON.parse(JSON.stringify(raw))
    let v = Number.isInteger(s.schema) ? s.schema : 2
    if (v > SCHEMA) return { future: v }
    while (v < SCHEMA) {
      if (MIGRATIONS[v]) s = MIGRATIONS[v](s)
      v++
    }
    s.schema = SCHEMA
    return normalize(s)
  }
  /** Garante tipos e padrões de todos os campos conhecidos, sem apagar os desconhecidos. */
  function normalize(s) {
    s.cls = CLASSES.some((c) => c.slug === s.cls) ? s.cls : null
    s.lambda = Math.min(1, Math.max(0, +s.lambda || 0))
    for (const [slug, c] of Object.entries(s.classes)) {
      if (!c || typeof c !== 'object' || !CLASSES.some((x) => x.slug === slug)) {
        delete s.classes[slug]
        continue
      }
      c.role = ROLES[c.role] ? c.role : null
      c.pool = int(c.pool)
      c.skills = c.skills && typeof c.skills === 'object' ? c.skills : {}
      c.skillsDone = !!c.skillsDone
      c.sources = { ...emptySources(), ...(c.sources && typeof c.sources === 'object' ? c.sources : {}) }
      c.boards = c.boards && typeof c.boards === 'object' ? c.boards : {}
      for (const [id, b] of Object.entries(c.boards)) {
        if (!b || typeof b !== 'object') {
          delete c.boards[id]
          continue
        }
        b.weights = b.weights && typeof b.weights === 'object' ? b.weights : {}
        b.reqTypes = Array.isArray(b.reqTypes) ? b.reqTypes.filter((k) => typeof k === 'string') : []
        b.reqNodes = ids(b.reqNodes)
        b.blocked = ids(b.blocked)
        b.owned = ids(b.owned)
        b.budget = int(b.budget)
      }
    }
    return s
  }
  /**
   * Casa o que foi salvo com os dados atuais da classe: traduz chaves de tipo
   * antigas (o texto em português) para a chave estável e descarta o que não
   * existe mais. Roda toda vez que uma classe carrega — é idempotente.
   */
  function adopt(slug) {
    const c = state.classes[slug]
    if (!c || !PREP[slug]) return
    for (const b of PREP[slug]) {
      const cfgB = c.boards[b.id]
      if (!cfgB) continue
      const keyOf = (k) => (b.typeByKey.has(k) ? k : b.byLabel.has(k) ? b.byLabel.get(k).key : null)
      const weights = {}
      for (const [k, w] of Object.entries(cfgB.weights)) {
        const key = keyOf(k)
        if (key && isFinite(+w) && +w >= 0) weights[key] = +w
      }
      cfgB.weights = weights
      cfgB.reqTypes = [...new Set(cfgB.reqTypes.map(keyOf).filter(Boolean))]
      const real = (id) => b.byId.has(id) && b.byId.get(id).type !== 'Start'
      cfgB.reqNodes = cfgB.reqNodes.filter(real)
      cfgB.blocked = cfgB.blocked.filter(real)
      cfgB.owned = cfgB.owned.filter(real)
    }
  }

  // Nada é guardado no navegador: o estado vive no endereço da página (#s=...)
  // e no arquivo exportado.
  let state = { schema: SCHEMA, cls: null, lambda: 0, classes: {} }
  const storageNote = ''

  let boards = []
  let active = null
  let mode = 'req'
  let results = {}
  const cc = () => {
    if (!state.classes[state.cls]) state.classes[state.cls] = normalize({ classes: { [state.cls]: {} } }).classes[state.cls]
    return state.classes[state.cls]
  }
  const cfg = (b) => (cc().boards[b.id] = cc().boards[b.id] || emptyBoard())
  const classInfo = () => CLASSES.find((c) => c.slug === state.cls)
  const ready = () => !!(state.cls && cc().role && boards.length)

  // ---- habilidades ------------------------------------------------------------
  // Ativas: quem decide é o jogador (cada um monta a rotação de um jeito). Uma
  // ativa marcada vale SKILL_BASE; desmarcada vale 0.
  // Passivas: entram marcadas, com peso estimado pela amostra de personagens
  // nível 45 da classe (data/skill-stats.js): % que aprendeu × (nível médio
  // relativo ao da skill mais upada)². É investimento observado, não dano medido.
  // SKILL_BASE é chute nosso: +1 nível numa skill principal ≈ 10 nodes de ataque.
  const SKILL_BASE = 10
  const stats = () => (window.DAEVANION_SKILL_STATS || {})[state.cls] || { skills: {} }
  const skillStat = (name) => stats().skills[name]
  const isPassive = (name) => (skillStat(name) || {}).cat === 'Passive'
  const skillPicked = (name) => {
    const v = cc().skills[name]
    return v === undefined ? isPassive(name) : !!v
  }
  function passiveEstimate(name) {
    const st = stats()
    const s = st.skills[name]
    if (!s) return SKILL_BASE / 2
    const top = (st._top = st._top || Math.max(...Object.values(st.skills).map((x) => x.avg)))
    return round1(SKILL_BASE * s.learned * Math.pow(s.avg / top, 2))
  }
  const skillWeight = (name) => (!skillPicked(name) ? 0 : isPassive(name) ? passiveEstimate(name) : SKILL_BASE)
  /** Habilidades que têm node em alguma árvore da classe (uma entrada por skill). */
  function classSkills() {
    const seen = new Map()
    for (const b of boards) for (const t of b.types) if (t.skill && !seen.has(t.nodes[0].skill)) {
      seen.set(t.nodes[0].skill, { name: t.nodes[0].skill, label: t.label.replace(/ \+1$/, ''), icon: t.nodes[0].icon })
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  const anyActivePicked = () => classSkills().some((s) => !isPassive(s.name) && skillPicked(s.name))
  // montagem automática só roda depois que o jogador disse quais ativas importam
  const skillsSettled = () => cc().skillsDone || anyActivePicked()

  // ---- pesos, obrigatórios, cálculo -----------------------------------------
  const roleWeight = (t) => {
    if (t.skill) return skillWeight(t.nodes[0].skill)
    const w = ROLES[cc().role]?.weights || {}
    return t.stats.reduce((s, st) => s + (w[st] || 0), 0)
  }
  const weightOf = (b, key) => {
    const w = cfg(b).weights[key]
    return w === undefined ? roleWeight(b.typeByKey.get(key)) : w
  }
  const requiredIds = (b) => {
    const set = new Set(cfg(b).reqNodes)
    for (const key of cfg(b).reqTypes) (b.typeByKey.get(key)?.nodes || []).forEach((n) => set.add(n.id))
    cfg(b).blocked.forEach((id) => set.delete(id))
    return set
  }
  const solveOpts = (b) => ({
    lambda: state.lambda,
    blockedIds: new Set(cfg(b).blocked),
    freeIds: new Set(cfg(b).owned),
    valueOf: (n) => (n.typeKey ? weightOf(b, n.typeKey) : 0),
  })
  const poolActive = () => cc().pool > 0 && skillsSettled()
  function recomputeAll() {
    const auto = skillsSettled()
    const shared = poolActive() ? boards.filter((b) => !isPvpBoard(b)) : []
    if (shared.length) {
      const rs = solveMany(shared.map((b) => ({ board: b, requiredIds: requiredIds(b), opts: solveOpts(b) })), cc().pool)
      shared.forEach((b, i) => (results[b.id] = { ...rs[i], pooled: true }))
    }
    for (const b of boards) {
      if (shared.includes(b)) continue
      results[b.id] = solve(b, requiredIds(b), { ...solveOpts(b), budget: auto ? cfg(b).budget : 0 })
    }
  }
  // com o total compartilhado ligado, mexer numa árvore muda as outras
  const compute = (b) => (poolActive() && !isPvpBoard(b) ? recomputeAll() : (results[b.id] = solve(b, requiredIds(b), { ...solveOpts(b), budget: skillsSettled() ? cfg(b).budget : 0 })))

  // ---- link compartilhável: #s=<base64url do estado compacto> ---------------
  // v2: { v, c: classe, l: critério, p: total compartilhado, d: skillsDone,
  //       k: [skills marcadas], u: [skills desmarcadas] (só as que fogem do padrão),
  //       b: { boardId: { w: {idNode: peso}, t: [idNode], n, x, o: [ids], g: orçamento } } }
  //     tipos são identificados pelo id do primeiro node do tipo.
  // v1 (links antigos): tipos por índice na lista ordenada — ainda é lido.
  let lastHash = ''
  const LAST_URL = 'daevanion-rota-last-url'
  const repId = (t) => t.nodes[0].id
  function encodeState() {
    const b = {}
    for (const bd of boards) {
      const c = cfg(bd)
      const o = {}
      const w = {}
      for (const t of bd.types) if (c.weights[t.key] !== undefined && c.weights[t.key] !== roleWeight(t)) w[repId(t)] = c.weights[t.key]
      if (Object.keys(w).length) o.w = w
      const t = c.reqTypes.map((k) => bd.typeByKey.get(k)).filter(Boolean).map(repId)
      if (t.length) o.t = t
      if (c.reqNodes.length) o.n = c.reqNodes
      if (c.blocked.length) o.x = c.blocked
      if (c.owned.length) o.o = c.owned
      if (c.budget > 0) o.g = c.budget
      if (Object.keys(o).length) b[bd.id] = o
    }
    const out = { v: 2, c: state.cls, l: state.lambda, b }
    if (cc().pool > 0) out.p = cc().pool
    if (cc().skillsDone) out.d = 1
    const k = []
    const u = []
    for (const [name, on] of Object.entries(cc().skills)) if (!!on !== isPassive(name)) (on ? k : u).push(name)
    if (k.length) out.k = k
    if (u.length) out.u = u
    // fontes de pontos: [nível, missões, masmorras, festival, pesadelo, outros]
    const src = ['level', 'quests', 'dungeons', 'festival', 'nightmare', 'other'].map((f) => int(cc().sources[f]))
    if (src.some(Boolean)) out.s = src
    // personagem importado: [nome, nível, servidor, ativas na barra]
    const ch = cc().char
    if (ch) out.h = [ch.name, ch.level, ch.server, (ch.skills || []).filter((x) => x.cat !== 'Passive' && x.equip).map((x) => x.name)]
    return btoa(unescape(encodeURIComponent(JSON.stringify(out)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  function decodeHash() {
    const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash)
    if (!m) return null
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))))
      return CLASSES.some((c) => c.slug === o.c) ? o : null
    } catch (e) {
      return null
    }
  }
  /** Aplica um estado vindo do link (substitui a configuração da classe dele). */
  async function applyShared(o) {
    const prepared = await loadClass(o.c)
    state.cls = o.c
    state.lambda = Math.min(1, Math.max(0, +o.l || 0))
    const keep = state.classes[o.c] || {}
    const c = (state.classes[o.c] = normalize({ classes: { [o.c]: { role: 'dps', char: keep.char, sources: keep.sources } } }).classes[o.c])
    c.pool = int(o.p)
    c.skillsDone = !!o.d
    for (const name of o.k || []) c.skills[name] = true
    for (const name of o.u || []) c.skills[name] = false
    if (Array.isArray(o.h)) {
      c.char = { name: String(o.h[0] || ''), level: int(o.h[1], 99), server: String(o.h[2] || ''), skills: (Array.isArray(o.h[3]) ? o.h[3] : []).map((name) => ({ name: String(name), cat: 'Active', equip: true })) }
    } else if (o.v >= 2) delete c.char
    if (Array.isArray(o.s)) ['level', 'quests', 'dungeons', 'festival', 'nightmare', 'other'].forEach((f, i) => (c.sources[f] = int(o.s[i])))
    for (const bd of prepared) {
      const src = (o.b || {})[bd.id]
      if (!src) continue
      const dst = (c.boards[bd.id] = emptyBoard())
      const typeOf = (ref) => (o.v >= 2 ? bd.typeByKey.get(bd.byId.get(+ref)?.typeKey) : bd.types[ref])
      for (const [ref, w] of Object.entries(src.w || {})) if (typeOf(ref) && isFinite(+w) && +w >= 0) dst.weights[typeOf(ref).key] = +w
      dst.reqTypes = (src.t || []).map(typeOf).filter(Boolean).map((t) => t.key)
      dst.reqNodes = ids(src.n)
      dst.blocked = ids(src.x)
      dst.owned = ids(src.o)
      dst.budget = int(src.g)
    }
    adopt(o.c)
  }
  function save() {
    if (!ready()) return
    lastHash = '#s=' + encodeState()
    try { history.replaceState(null, '', lastHash) } catch (e) {}
    // única coisa guardada no navegador: o último endereço, para reabrir de onde parou
    try { localStorage.setItem(LAST_URL, lastHash) } catch (e) {}
  }

  // ---- arquivo: salvar no disco / abrir -------------------------------------
  const fileMsg = (t, err) => { $('file-msg').textContent = t; $('file-msg').className = 'hint' + (err ? ' err' : '') }
  function exportFile() {
    const body = JSON.stringify({ app: 'rota-daevanion', exportedAt: new Date().toISOString(), ...state }, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    a.download = `rota-daevanion-${state.cls || 'planner'}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    fileMsg('Arquivo salvo na pasta de downloads. Ele guarda todas as classes que você configurou.')
  }
  async function importFile(file) {
    try {
      const raw = JSON.parse(await file.text())
      if (raw.app !== 'rota-daevanion') throw new Error('este arquivo não é do Rota Daevanion')
      const next = migrate(raw)
      if (!next) throw new Error('o conteúdo não foi reconhecido')
      if (next.future) throw new Error('o arquivo é de uma versão mais nova da página; recarregue e tente de novo')
      delete next.app
      delete next.exportedAt
      state = next
      for (const slug of Object.keys(PREP)) adopt(slug)
      await open()
      fileMsg('Arquivo aberto.')
    } catch (e) {
      fileMsg('Não foi possível abrir: ' + e.message + '.', true)
    }
  }

  // ---- render ---------------------------------------------------------------
  function renderChooser() {
    const box = $('classes')
    box.innerHTML = ''
    for (const c of CLASSES) {
      const t = document.createElement('button')
      t.type = 'button'; t.className = 'tab'
      t.setAttribute('aria-pressed', c.slug === state.cls)
      t.textContent = c.name
      t.onclick = () => pickClass(c.slug)
      box.appendChild(t)
    }
    const info = classInfo()
    $('role-pick').hidden = !info || info.roles.length < 2
    const rbox = $('roles')
    rbox.innerHTML = ''
    for (const r of info ? info.roles : []) {
      const t = document.createElement('button')
      t.type = 'button'; t.className = 'tab'
      t.setAttribute('aria-pressed', cc().role === r)
      t.textContent = ROLES[r].name
      t.onclick = () => pickRole(r)
      rbox.appendChild(t)
    }
    $('need').hidden = ready() && !storageNote
    $('need').textContent = storageNote || (!state.cls ? 'Escolha sua classe para começar.' : 'Agora escolha o papel: ele define os pesos padrão de cada tipo de node.')
    $('app').hidden = !ready()
  }

  function renderTabs() {
    $('tabs').innerHTML = ''
    for (const b of boards) {
      const t = document.createElement('button')
      t.type = 'button'; t.className = 'tab'; t.role = 'tab'; t.id = 'tab-' + b.id
      t.setAttribute('aria-selected', b === active)
      const r = results[b.id]
      t.innerHTML = `<span>${b.name}</span><small>${r && r.ok ? r.points : '–'}/${b.totalCost}</small>`
      t.onclick = () => { active = b; renderAll() }
      $('tabs').appendChild(t)
    }
  }

  function renderSkills() {
    const list = classSkills()
    for (const [boxId, passive] of [['skills-active', false], ['skills-passive', true]]) {
      const box = $(boxId)
      box.innerHTML = ''
      for (const s of list.filter((x) => isPassive(x.name) === passive)) {
        const st = skillStat(s.name)
        const id = 'sk-' + s.name.replace(/[^a-z0-9]+/gi, '-')
        const label = document.createElement('label')
        label.className = 'skillpick'
        const hint = passive
          ? `peso estimado ${fmt(passiveEstimate(s.name))}`
          : st ? `na barra de ${Math.round(st.equipped * 100)}% · nível médio ${fmt(st.avg)}` : ''
        label.innerHTML = `<input type="checkbox" id="${id}">${s.icon ? `<img src="${s.icon}" alt="">` : ''}<span><b></b><small>${hint}</small></span>`
        label.querySelector('b').textContent = s.label
        const cb = label.querySelector('input')
        cb.checked = skillPicked(s.name)
        cb.onchange = () => {
          cc().skills[s.name] = cb.checked
          cc().skillsDone = true
          recomputeAll(); save(); renderAll()
        }
        box.appendChild(label)
      }
    }
    const waiting = autoWanted() && !skillsSettled()
    $('skills-note').hidden = !waiting
    $('skills-block').classList.toggle('attention', waiting)
    $('skills-from-char').hidden = !cc().char
  }
  const autoWanted = () => cc().pool > 0 || boards.some((b) => cfg(b).budget > 0)

  function abbr(n) {
    if (n.type === 'Start') return ''
    if (n.type === 'SkillLevel') return 'HAB'
    return (ABBR[n.stats[0]] || n.name.slice(0, 3).toUpperCase()) + (n.stats.length > 1 ? '+' : '')
  }
  function describe(b, n) {
    if (n.type === 'Start') return `<b>${n.name}</b> — ponto de partida, sem custo.`
    const req = requiredIds(b).has(n.id)
    const byType = cfg(b).reqTypes.includes(n.typeKey)
    const flags = [cfg(b).blocked.includes(n.id) ? 'bloqueado' : '', cfg(b).owned.includes(n.id) ? 'já aberto no personagem' : '', req ? (byType ? 'obrigatório pelo tipo' : 'obrigatório') : '',
      results[b.id]?.ok && results[b.id].ids.has(n.id) ? 'no caminho' : ''].filter(Boolean).join(', ')
    return `<b>${n.effects.join(' · ')}</b> — ${n.cost} ${n.cost > 1 ? 'pontos' : 'ponto'}, peso ${fmt(weightOf(b, n.typeKey))}` +
      ` · linha ${n.row - b.r0 + 1}, coluna ${n.col - b.c0 + 1}${flags ? ' · ' + flags : ''}`
  }

  function renderGrid() {
    const b = active, r = results[b.id], req = requiredIds(b), blocked = new Set(cfg(b).blocked), owned = new Set(cfg(b).owned)
    const focused = document.activeElement?.dataset?.node
    const g = $('grid')
    g.innerHTML = ''
    g.style.gridTemplateColumns = `repeat(${b.c1 - b.c0 + 1}, minmax(0, 1fr))`
    const at = new Map(b.nodes.map((n) => [n.row + ',' + n.col, n]))
    for (let row = b.r0; row <= b.r1; row++) {
      for (let col = b.c0; col <= b.c1; col++) {
        const n = at.get(row + ',' + col)
        if (!n) { const d = document.createElement('div'); d.className = 'gap'; g.appendChild(d); continue }
        const c = document.createElement('button')
        c.type = 'button'
        c.dataset.node = n.id
        c.className = 'cell g-' + n.grade + (n.type === 'SkillLevel' ? ' skill' : '') + (n.type === 'Start' ? ' start' : '') +
          (n.typeKey && weightOf(b, n.typeKey) > 0 ? ' weighted' : '') +
          (blocked.has(n.id) ? ' blocked' : owned.has(n.id) ? ' owned' : req.has(n.id) ? ' req' : r?.ok && r.ids.has(n.id) && n.type !== 'Start' ? ' path' : '')
        if (n.icon) {
          const img = document.createElement('img')
          img.src = n.icon
          img.alt = n.effects.join(' · ')
          img.onerror = () => { c.textContent = abbr(n) }
          c.appendChild(img)
        } else c.textContent = abbr(n)
        c.title = n.type === 'Start' ? n.name : `${n.effects.join(' · ')} · ${n.cost} pt`
        c.setAttribute('aria-pressed', req.has(n.id))
        const show = () => ($('info').innerHTML = describe(b, n))
        c.onmouseenter = show; c.onfocus = show
        if (n.type !== 'Start') c.onclick = () => toggleNode(n.id, mode)
        c.oncontextmenu = (e) => { e.preventDefault(); if (n.type !== 'Start') toggleNode(n.id, 'block') }
        g.appendChild(c)
      }
    }
    if (focused) g.querySelector(`[data-node="${focused}"]`)?.focus()
  }

  function renderResult() {
    const b = active, r = results[b.id]
    $('res-title').textContent = 'Resultado · ' + b.name
    const badge = $('res-badge')
    if (!r.ok) {
      $('res-points').textContent = '–'
      badge.className = 'badge err'
      badge.textContent = 'Sem caminho: um bloqueio isola um node obrigatório'
      $('res-nodes').textContent = $('res-weight').textContent = $('res-owned').textContent = '–'
      $('gains').innerHTML = ''
    } else {
      const ownedSet = new Set(cfg(b).owned)
      const fresh = [...r.ids].filter((id) => !ownedSet.has(id) && b.byId.get(id).type !== 'Start')
      $('res-points').textContent = r.points
      $('res-of').textContent = ownedSet.size ? 'pontos a gastar' : `de ${b.totalCost} pontos`
      if (autoWanted() && !skillsSettled()) {
        badge.className = 'badge approx'
        badge.textContent = 'Montagem automática esperando: escolha suas habilidades'
      } else if (r.overBudget) {
        badge.className = 'badge err'
        badge.textContent = r.pooled
          ? `Os obrigatórios das árvores já custam ${r.poolRequired}: aumente o total de pontos`
          : `Os obrigatórios já custam ${r.requiredPoints}: aumente os pontos da montagem`
      } else if (r.auto) {
        badge.className = 'badge approx'
        badge.textContent = r.pooled ? `Montagem automática (estimativa): ${r.points} pontos nesta árvore` : `Montagem automática (estimativa): ${r.points} de ${cfg(b).budget} pontos`
      } else {
        badge.className = 'badge' + (r.exact ? '' : ' approx')
        badge.textContent = r.exact ? 'Caminho ótimo' : 'Aproximado (mais de 13 obrigatórios)'
      }
      $('res-nodes').textContent = fresh.length
      $('res-owned').textContent = ownedSet.size
      $('res-weight').textContent = fmt(r.attack)
      // soma os efeitos dos nodes novos: "Nome +X" / "Nome +X%"
      const sum = new Map()
      for (const id of fresh) for (const e of b.byId.get(id).effects) {
        const m = e.match(/^(.*) \+([\d.]+)(%?)$/)
        if (!m) continue
        const cur = sum.get(m[1]) || { v: 0, pct: m[3] }
        cur.v += +m[2]
        sum.set(m[1], cur)
      }
      $('gains').innerHTML = sum.size
        ? [...sum].map(([k, x]) => `<li><span>${k}</span><span>+${fmt(x.v)}${x.pct}</span></li>`).join('')
        : '<li><span class="hint">Nada ainda. Marque um node ou um tipo como obrigatório.</span></li>'
    }
    const shared = boards.filter((x) => !isPvpBoard(x))
    const sum = (list) => list.reduce((s, x) => s + (results[x.id]?.ok ? results[x.id].points : 0), 0)
    $('res-total').textContent = `${sum(shared)} pts` + (boards.length > shared.length ? ` + ${sum(boards.filter(isPvpBoard))} de Azphel` : '')
    b.types.forEach((t, i) => {
      const el = $('got-' + b.id + '-' + i)
      if (el) el.textContent = (r.ok ? t.nodes.filter((n) => r.ids.has(n.id)).length : 0) + '/' + t.nodes.length
    })
  }

  function renderTypes() {
    const b = active
    $('types-title').textContent = `Tipos de node · ${b.name}`
    const body = $('types')
    body.innerHTML = ''
    let lastSkill = null
    b.types.forEach((t, i) => {
      if (t.skill !== lastSkill) {
        lastSkill = t.skill
        const g = document.createElement('tr'); g.className = 'grp'
        g.innerHTML = `<td colspan="4">${t.skill ? 'Habilidades' : 'Atributos'}</td>`
        body.appendChild(g)
      }
      const tr = document.createElement('tr')
      const color = { Rare: 'var(--rare)', Legend: 'var(--legend)', Unique: 'var(--unique)' }[t.grade] || 'var(--common)'
      tr.innerHTML =
        `<td class="c"><input type="checkbox" id="rq-${b.id}-${i}" aria-label="Obrigatório: ${t.label}"></td>` +
        `<td><label for="rq-${b.id}-${i}">${t.nodes[0].icon ? `<img class="ic" src="${t.nodes[0].icon}" alt="" style="border-color:${color}">` : `<span class="sw${t.skill ? ' skill' : ''}" style="border-color:${color}"></span>`}${t.label}<small>${t.nodes.length}× · ${t.cost} pt</small></label></td>` +
        `<td class="r"><input class="num" type="number" step="0.1" min="0" id="w-${b.id}-${i}" aria-label="Peso: ${t.label}"></td>` +
        `<td class="r" id="got-${b.id}-${i}"></td>`
      body.appendChild(tr)
      const cb = $(`rq-${b.id}-${i}`), w = $(`w-${b.id}-${i}`)
      cb.checked = cfg(b).reqTypes.includes(t.key)
      w.value = weightOf(b, t.key)
      cb.onchange = () => {
        const set = new Set(cfg(b).reqTypes)
        cb.checked ? set.add(t.key) : set.delete(t.key)
        cfg(b).reqTypes = [...set]
        changed(b)
      }
      w.oninput = () => {
        const v = parseFloat(w.value)
        cfg(b).weights[t.key] = isFinite(v) && v >= 0 ? v : 0
        clearTimeout(w._t)
        w._t = setTimeout(() => changed(b), 250)
      }
    })
  }

  function renderLambda() {
    $('lambda').value = state.lambda
    $('lambda-label').textContent = state.lambda > 0
      ? `Aceito gastar até ${fmt(state.lambda)} ponto a mais por 1,0 de peso`
      : 'Menos pontos primeiro; peso só desempata'
  }

  function renderAuto() {
    const pvp = isPvpBoard(active)
    $('pool').value = cc().pool || ''
    $('budget').value = cfg(active).budget || ''
    const pooled = cc().pool > 0 && !pvp
    $('budget').disabled = pooled
    const left = active.nodes.filter((n) => !cfg(active).owned.includes(n.id)).reduce((s, n) => s + n.cost, 0)
    $('budget-max').textContent = pooled
      ? 'Com o total das 4 árvores ligado, a divisão entre elas é automática.'
      : `Completar o que falta desta árvore custa ${left} pontos.`
    $('pool-row').hidden = pvp
    $('pool-note').textContent = pvp ? 'Azphel usa pontos próprios (JvJ), fora do total das outras quatro árvores.' : ''
  }

  // ---- fontes de pontos -----------------------------------------------------
  // Números do guia do MetaBot (lidos dos arquivos do jogo), por facção:
  // https://metabot.gg/en/aion-2/guides/daevanion-guide
  const LEVEL_POINTS = (lv) => (lv >= 12 ? Math.min(136, 4 * (Math.min(45, lv) - 11)) : 0)
  const SOURCES = [
    { key: 'quests', max: 58, each: 1 },
    { key: 'dungeons', max: 61, each: 2 },
    { key: 'festival', max: 50, each: 1 },
    { key: 'nightmare', max: 50, each: 1 },
    { key: 'other', max: 999, each: 1 },
  ]
  function sourcesTotals() {
    const s = cc().sources
    const earned = LEVEL_POINTS(s.level) + SOURCES.reduce((a, x) => a + int(s[x.key], x.max) * x.each, 0)
    const spent = boards.filter((b) => !isPvpBoard(b)).reduce((a, b) => a + cfg(b).owned.reduce((x, id) => x + b.byId.get(id).cost, 0), 0)
    return { earned, spent, free: Math.max(0, earned - spent) }
  }
  function renderSources() {
    const s = cc().sources
    $('src-level').value = s.level || ''
    for (const x of SOURCES) $('src-' + x.key).value = s[x.key] || ''
    const t = sourcesTotals()
    $('src-level-pts').textContent = LEVEL_POINTS(s.level) + ' pts'
    for (const x of SOURCES) $('src-' + x.key + '-pts').textContent = int(s[x.key], x.max) * x.each + ' pts'
    $('src-earned').textContent = t.earned
    $('src-spent').textContent = t.spent
    $('src-free').textContent = t.free
    $('src-use').textContent = `Usar ${t.free} pontos na montagem automática`
    $('src-use').disabled = !t.free
  }

  // ---- ações ----------------------------------------------------------------
  function toggleNode(id, how) {
    const c = cfg(active)
    const flip = (arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])
    if (how === 'block') { c.blocked = flip(c.blocked); c.reqNodes = c.reqNodes.filter((x) => x !== id) }
    else { c.reqNodes = flip(c.reqNodes); c.blocked = c.blocked.filter((x) => x !== id) }
    changed(active)
    $('info').innerHTML = describe(active, active.byId.get(id))
  }
  function changed(b) {
    compute(b)
    save()
    renderTabs(); renderGrid(); renderResult(); renderAuto()
  }
  function renderAll() {
    renderChooser()
    if (!ready()) return
    renderTabs(); renderSkills(); renderGrid(); renderTypes(); renderResult(); renderLambda(); renderAuto(); renderSources(); renderChar()
  }
  /** Carrega a classe atual (se houver) e redesenha tudo. */
  async function open() {
    boards = []
    results = {}
    renderChooser()
    if (!state.cls) return
    try {
      boards = await loadClass(state.cls)
    } catch (e) {
      $('need').hidden = false
      $('need').textContent = e.message
      return
    }
    active = boards[0]
    if (!cc().role) cc().role = classInfo().roles[0]
    recomputeAll()
    save()
    renderAll()
  }
  function pickClass(slug) {
    state.cls = slug
    open()
  }
  function pickRole(r) {
    cc().role = r
    recomputeAll(); save(); renderAll()
  }
  const refresh = () => { recomputeAll(); save(); renderAll() }

  $('mode-req').onclick = () => setMode('req')
  $('mode-block').onclick = () => setMode('block')
  function setMode(m) {
    mode = m
    $('mode-req').setAttribute('aria-pressed', m === 'req')
    $('mode-block').setAttribute('aria-pressed', m === 'block')
  }
  $('clear').onclick = () => {
    Object.assign(cfg(active), { reqTypes: [], reqNodes: [], blocked: [] })
    refresh()
  }
  $('reset-weights').onclick = () => {
    boards.forEach((b) => (cfg(b).weights = {}))
    refresh()
  }
  $('goto-types').onclick = () => $('tipos').scrollIntoView({ behavior: 'smooth', block: 'start' })
  const debounced = (el, fn) => { clearTimeout(el._t); el._t = setTimeout(fn, 250) }
  $('lambda').oninput = () => {
    state.lambda = +$('lambda').value
    renderLambda()
    debounced($('lambda'), refresh)
  }
  $('pool').oninput = () => { cc().pool = int($('pool').value); debounced($('pool'), refresh) }
  $('budget').oninput = () => { cfg(active).budget = int($('budget').value); debounced($('budget'), refresh) }
  $('auto-off').onclick = () => { cc().pool = 0; boards.forEach((b) => (cfg(b).budget = 0)); refresh() }
  $('skills-none').onclick = () => { cc().skillsDone = true; refresh() }
  $('skills-from-char').onclick = () => {
    for (const s of cc().char?.skills || []) if (s.cat !== 'Passive') cc().skills[s.name] = !!s.equip
    for (const s of classSkills()) if (!isPassive(s.name) && cc().skills[s.name] === undefined) cc().skills[s.name] = false
    cc().skillsDone = true
    refresh()
  }
  $('src-level').oninput = () => { cc().sources.level = int($('src-level').value, 45); debounced($('src-level'), () => { save(); renderSources() }) }
  for (const x of SOURCES) {
    $('src-' + x.key).max = x.max
    $('src-' + x.key).oninput = () => { cc().sources[x.key] = int($('src-' + x.key).value, x.max); debounced($('src-' + x.key), () => { save(); renderSources() }) }
  }
  $('src-use').onclick = () => { cc().pool = sourcesTotals().free; refresh(); $('pool').scrollIntoView({ behavior: 'smooth', block: 'center' }) }

  const copy = (text, input, say) => {
    const fallback = () => { input.hidden = false; input.value = text; input.select(); say('Selecionado. Use Ctrl+C para copiar.') }
    navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(() => say('Link copiado. Quem abrir vê esta mesma configuração.'), fallback) : fallback()
  }
  $('share').onclick = () => { save(); copy(location.origin + location.pathname + lastHash, $('share-url'), (t) => ($('share-msg').textContent = t)) }
  $('file-save').onclick = exportFile
  $('file-open').onclick = () => $('file-input').click()
  $('file-input').onchange = () => { const f = $('file-input').files[0]; $('file-input').value = ''; if (f) importFile(f) }

  // ---- personagem (API do site oficial, via /api/char) ----------------------
  const REGIONS = { la: 'América do Sul', naw: 'América do Norte – Oeste', nae: 'América do Norte – Leste', eu: 'Europa', as: 'Ásia' }
  const charMsg = (t, err) => { $('char-msg').textContent = t; $('char-msg').className = 'hint' + (err ? ' err' : '') }
  async function api(params) {
    let res
    try {
      res = await fetch('/api/char?' + new URLSearchParams(params))
    } catch (e) {
      throw new Error('sem conexão com o servidor')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) throw new Error((data && data.error) || 'a consulta falhou (' + res.status + ')')
    return data
  }
  async function loadServers() {
    const sel = $('char-server')
    sel.innerHTML = '<option value="">Todos os servidores</option>'
    try {
      const d = await api({ op: 'servers', region: $('char-region').value })
      for (const s of d.servers) sel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${s.name}</option>`)
    } catch (e) {} // sem a lista, a busca ainda funciona em todos os servidores
  }
  async function searchChar() {
    const keyword = $('char-name').value.trim()
    $('char-results').innerHTML = ''
    if (keyword.length < 2) return charMsg('Digite pelo menos 2 letras do nome.', true)
    charMsg('Buscando…')
    try {
      const d = await api({ op: 'search', region: $('char-region').value, serverId: $('char-server').value, keyword })
      if (!d.results.length) return charMsg('Nenhum personagem encontrado. Confira o nome, a região e o servidor.', true)
      charMsg('Escolha o personagem:')
      for (const c of d.results) {
        const cls = CLASSES.find((x) => x.slug === c.cls)
        const bt = document.createElement('button')
        bt.type = 'button'; bt.className = 'tab'
        bt.innerHTML = `<span></span><small>${cls ? cls.name : 'classe ?'} · nv ${c.level} · ${c.server}</small>`
        bt.firstChild.textContent = c.name
        bt.onclick = () => importChar(c)
        $('char-results').appendChild(bt)
      }
    } catch (e) {
      charMsg('Não foi possível buscar agora: ' + e.message + '. A API do site oficial pode estar fora do ar; dá para seguir sem importar.', true)
    }
  }
  async function importChar(c) {
    charMsg('Importando ' + c.name + '…')
    try {
      const d = await api({ op: 'import', region: $('char-region').value, serverId: c.serverId, characterId: c.id })
      const slug = d.profile.cls
      if (!CLASSES.some((x) => x.slug === slug)) throw new Error('classe do personagem não reconhecida')
      const prepared = await loadClass(slug)
      state.cls = slug
      const k = cc()
      k.char = { name: d.profile.name, level: d.profile.level, server: d.profile.server, skills: d.skills }
      k.sources.level = int(d.profile.level, 45)
      let opened = 0
      for (const bd of prepared) {
        const got = ids(d.boards[bd.id]).filter((id) => bd.byId.has(id) && bd.byId.get(id).type !== 'Start')
        ;(k.boards[bd.id] = k.boards[bd.id] || emptyBoard()).owned = got
        opened += got.length
      }
      $('char-results').innerHTML = ''
      await open()
      charMsg(`Importado: ${opened} nodes já abertos entram com custo zero. O nível e os pontos já gastos foram para "Fontes de pontos".`)
    } catch (e) {
      charMsg('Não foi possível importar: ' + e.message + '. Dá para seguir marcando à mão.', true)
    }
  }
  function renderChar() {
    const ch = state.cls ? cc().char : null
    $('char-current').hidden = !ch
    if (ch) $('char-who').textContent = `${ch.name} · nível ${ch.level} · ${ch.server}`
  }
  $('char-region').innerHTML = Object.entries(REGIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
  $('char-region').onchange = loadServers
  $('char-form').onsubmit = (e) => { e.preventDefault(); searchChar() }
  $('char-clear').onclick = () => {
    delete cc().char
    for (const b of boards) cfg(b).owned = []
    refresh()
    charMsg('Personagem removido.')
  }

  // ---- início: o link (#s=...) tem prioridade sobre o que ficou salvo -------
  async function boot() {
    loadServers()
    // abriu sem link: retoma o último endereço usado neste navegador
    if (!decodeHash()) {
      try {
        const last = localStorage.getItem(LAST_URL)
        if (last && /^#s=[A-Za-z0-9_-]+$/.test(last)) history.replaceState(null, '', last)
      } catch (e) {}
    }
    const shared = decodeHash()
    if (shared) {
      try { await applyShared(shared) } catch (e) {}
    }
    open()
  }
  window.addEventListener('hashchange', () => {
    if (location.hash !== lastHash && decodeHash()) boot()
  })
  boot()
})()
