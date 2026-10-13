;(function () {
  const { solve } = window.DaevanionSolver
  const $ = (id) => document.getElementById(id)
  const STORE = 'daevanion-rota-v2'
  const fmt = (x) => (Math.round(x * 100) / 100).toLocaleString('pt-BR')

  // ---- classes e papéis -----------------------------------------------------
  const CLASSES = [
    { slug: 'gladiator', name: 'Gladiador', roles: ['dps', 'tank'] },
    { slug: 'templar', name: 'Templário', roles: ['dps', 'tank'] },
    { slug: 'ranger', name: 'Arqueiro', roles: ['dps'] },
    { slug: 'assassin', name: 'Assassino', roles: ['dps'] },
    { slug: 'elementalist', name: 'Espiritualista', roles: ['dps'] },
    { slug: 'sorcerer', name: 'Mago', roles: ['dps'] },
    { slug: 'cleric', name: 'Clérigo', roles: ['dps'] },
    { slug: 'chanter', name: 'Encantador', roles: ['dps'] },
  ]
  // Peso padrão por stat (chave em inglês, estável) em cada papel. Stat que não
  // aparece vale 0 — no DPS, tudo que é defensivo; no Tank, tudo que é ofensivo.
  // Nodes de habilidade começam em 0 nos dois.
  //
  // Escala do DPS: 1,0 = um node comum de Ataque Adicional +3. Os % (nodes
  // únicos) são convertidos por dano real estimado no endgame (KR), segundo
  // https://gameplay.tips/guides/aion-2-how-stats-work-damage-formula-guide.html:
  //   Ataque Adicional  ~0,1% de dano a cada 10  → +3    ≈ 0,03%  → 1
  //   Amplif. de Dano   ~0,35% por 1%            → +1,5% ≈ 0,53%  → 17
  //   Golpes Múltiplos  ~0,33% por 1%            → +1,5% ≈ 0,50%  → 16
  //   Dano Crítico      ~0,4–0,6% por 1%         → +1,5% ≈ 0,75%  → 25
  // Sem número publicado (estimativa nossa): Velocidade de Combate ~0,7% por 1%
  // (→ 35) e Redução de Recarga ~0,5% por 1% (→ 25). Acerto Crítico, Precisão e
  // Acerto de Alteração de Estado ficam em 1 por falta de conversão conhecida.
  // No Tank, os únicos defensivos espelham esses valores (suposição).
  const ROLES = {
    dps: {
      name: 'DPS',
      weights: {
        'Attack Bonus': 1, 'PvP Attack': 1, 'Critical Hit': 1, 'PvP Critical Hit': 1, 'PvP Accuracy': 1, 'Status Effect Chance': 1,
        'Damage Boost': 17, 'PvP Damage Boost': 17, 'Multi-hit Chance': 16, 'Critical Damage Boost': 25,
        'Cooldown Reduction': 25, 'Combat Speed': 35,
      },
    },
    tank: {
      name: 'Tank',
      weights: {
        HP: 1, 'Defense Bonus': 1, 'PvP Defense': 1, 'Critical Hit Resist': 1, 'PvP Critical Hit Resist': 1, 'PvP Evasion': 1, 'Status Effect Resist': 1,
        'Damage Tolerance': 17, 'PvP Damage Tolerance': 17, 'Multi-hit Resist': 16, 'Critical Damage Tolerance': 25,
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

  // ---- dados por classe (carregados sob demanda) ---------------------------
  // tipo de node = mesmo efeito (ex.: "Ataque Adicional +3") ou mesma habilidade
  const PREP = {}
  function prepare(data) {
    return data.boards.map((b) => {
      const types = new Map()
      for (const n of b.nodes) {
        if (n.type === 'Start') continue
        const key = n.effects.join(' · ')
        n.typeKey = key
        if (!types.has(key)) types.set(key, { key, skill: n.type === 'SkillLevel', grade: n.grade, cost: n.cost, stats: n.stats, nodes: [] })
        types.get(key).nodes.push(n)
      }
      const list = [...types.values()].sort((a, b2) => a.skill - b2.skill || b2.cost - a.cost || a.key.localeCompare(b2.key, 'pt'))
      const rows = b.nodes.map((n) => n.row)
      const cols = b.nodes.map((n) => n.col)
      return {
        ...b, types: list, typeByKey: types, byId: new Map(b.nodes.map((n) => [n.id, n])),
        r0: Math.min(...rows), r1: Math.max(...rows), c0: Math.min(...cols), c1: Math.max(...cols),
      }
    })
  }
  function loadClass(slug) {
    if (PREP[slug]) return Promise.resolve(PREP[slug])
    return new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'data/' + slug + '.js'
      s.onload = () => resolve((PREP[slug] = prepare(window.DAEVANION_DATA[slug])))
      s.onerror = () => reject(new Error('Não foi possível carregar os dados da classe.'))
      document.head.appendChild(s)
    })
  }

  // ---- estado ---------------------------------------------------------------
  // state.classes[slug] = { role, boards: { [boardId]: { weights, reqTypes, reqNodes, blocked } } }
  let state = { cls: null, lambda: 0, classes: {} }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (saved && saved.classes) state = { cls: saved.cls || null, lambda: +saved.lambda || 0, classes: saved.classes }
  } catch (e) {}

  let boards = []
  let active = null
  let mode = 'req'
  let results = {}
  const emptyBoard = () => ({ weights: {}, reqTypes: [], reqNodes: [], blocked: [] })
  const cc = () => (state.classes[state.cls] = state.classes[state.cls] || { role: null, boards: {} })
  const cfg = (b) => (cc().boards[b.id] = cc().boards[b.id] || emptyBoard())
  const classInfo = () => CLASSES.find((c) => c.slug === state.cls)
  const ready = () => !!(state.cls && cc().role && boards.length)

  const roleWeight = (t) => {
    const w = ROLES[cc().role]?.weights || {}
    return t.stats.reduce((s, st) => s + (w[st] || 0), 0)
  }
  const weightOf = (b, key) => {
    const w = cfg(b).weights[key]
    return w === undefined ? roleWeight(b.typeByKey.get(key)) : w
  }
  const requiredIds = (b) => {
    const ids = new Set(cfg(b).reqNodes)
    for (const key of cfg(b).reqTypes) (b.typeByKey.get(key)?.nodes || []).forEach((n) => ids.add(n.id))
    cfg(b).blocked.forEach((id) => ids.delete(id))
    return ids
  }
  const compute = (b) => {
    results[b.id] = solve(b, requiredIds(b), {
      lambda: state.lambda,
      blockedIds: new Set(cfg(b).blocked),
      valueOf: (n) => (n.typeKey ? weightOf(b, n.typeKey) : 0),
    })
  }
  const recomputeAll = () => boards.forEach(compute)

  // ---- link compartilhável: #s=<base64url do estado compacto> ---------------
  // { v, c: classe, r: papel, l: critério, b: { boardId: { w: {idxTipo: peso}, t: [idxTipo], n: [ids], x: [ids] } } }
  let lastHash = ''
  function encodeState() {
    const b = {}
    for (const bd of boards) {
      const c = cfg(bd)
      const o = {}
      const w = {}
      bd.types.forEach((t, i) => {
        if (c.weights[t.key] !== undefined && c.weights[t.key] !== roleWeight(t)) w[i] = c.weights[t.key]
      })
      if (Object.keys(w).length) o.w = w
      const t = c.reqTypes.map((k) => bd.types.findIndex((x) => x.key === k)).filter((i) => i >= 0)
      if (t.length) o.t = t
      if (c.reqNodes.length) o.n = c.reqNodes
      if (c.blocked.length) o.x = c.blocked
      if (Object.keys(o).length) b[bd.id] = o
    }
    const json = JSON.stringify({ v: 1, c: state.cls, r: cc().role, l: state.lambda, b })
    return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  function decodeHash() {
    const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash)
    if (!m) return null
    try {
      const o = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))
      const cls = CLASSES.find((c) => c.slug === o.c)
      return cls && cls.roles.includes(o.r) ? o : null
    } catch (e) {
      return null
    }
  }
  /** Aplica um estado vindo do link (substitui a configuração da classe dele). */
  async function applyShared(o) {
    const prepared = await loadClass(o.c)
    state.cls = o.c
    state.lambda = Math.min(1, Math.max(0, +o.l || 0))
    const c = (state.classes[o.c] = { role: o.r, boards: {} })
    for (const bd of prepared) {
      const src = (o.b || {})[bd.id]
      if (!src) continue
      const dst = (c.boards[bd.id] = emptyBoard())
      for (const [i, w] of Object.entries(src.w || {})) if (bd.types[i] && isFinite(+w) && +w >= 0) dst.weights[bd.types[i].key] = +w
      dst.reqTypes = (src.t || []).filter((i) => bd.types[i]).map((i) => bd.types[i].key)
      dst.reqNodes = (src.n || []).filter((id) => bd.byId.has(id))
      dst.blocked = (src.x || []).filter((id) => bd.byId.has(id))
    }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)) } catch (e) {}
    if (!ready()) return
    lastHash = '#s=' + encodeState()
    try { history.replaceState(null, '', lastHash) } catch (e) {}
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
    $('role-pick').hidden = !info
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
    $('need').hidden = ready()
    $('need').textContent = !state.cls ? 'Escolha sua classe para começar.' : 'Agora escolha o papel: ele define os pesos padrão de cada tipo de node.'
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

  function abbr(n) {
    if (n.type === 'Start') return ''
    if (n.type === 'SkillLevel') return 'HAB'
    return (ABBR[n.stats[0]] || n.name.slice(0, 3).toUpperCase()) + (n.stats.length > 1 ? '+' : '')
  }
  function describe(b, n) {
    if (n.type === 'Start') return `<b>${n.name}</b> — ponto de partida, sem custo.`
    const req = requiredIds(b).has(n.id)
    const byType = cfg(b).reqTypes.includes(n.typeKey)
    const flags = [cfg(b).blocked.includes(n.id) ? 'bloqueado' : '', req ? (byType ? 'obrigatório pelo tipo' : 'obrigatório') : '',
      results[b.id]?.ok && results[b.id].ids.has(n.id) ? 'no caminho' : ''].filter(Boolean).join(', ')
    return `<b>${n.effects.join(' · ')}</b> — ${n.cost} ${n.cost > 1 ? 'pontos' : 'ponto'}, peso ${fmt(weightOf(b, n.typeKey))}` +
      ` · linha ${n.row - b.r0 + 1}, coluna ${n.col - b.c0 + 1}${flags ? ' · ' + flags : ''}`
  }

  function renderGrid() {
    const b = active, r = results[b.id], req = requiredIds(b), blocked = new Set(cfg(b).blocked)
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
          (blocked.has(n.id) ? ' blocked' : req.has(n.id) ? ' req' : r?.ok && r.ids.has(n.id) && n.type !== 'Start' ? ' path' : '')
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
      $('res-nodes').textContent = $('res-weight').textContent = '–'
      $('gains').innerHTML = ''
    } else {
      $('res-points').textContent = r.points
      $('res-of').textContent = `de ${b.totalCost} pontos`
      badge.className = 'badge' + (r.exact ? '' : ' approx')
      badge.textContent = r.exact ? 'Caminho ótimo' : 'Aproximado (mais de 13 obrigatórios)'
      $('res-nodes').textContent = r.ids.size - 1
      $('res-weight').textContent = fmt(r.attack)
      // soma os efeitos dos nodes escolhidos: "Nome +X" / "Nome +X%"
      const sum = new Map()
      for (const id of r.ids) for (const e of b.byId.get(id).effects) {
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
    const total = boards.reduce((s, x) => s + (results[x.id]?.ok ? results[x.id].points : 0), 0)
    $('res-total').textContent = total + ' pts'
    b.types.forEach((t, i) => {
      const el = $('got-' + b.id + '-' + i)
      if (el) el.textContent = (r.ok ? t.nodes.filter((n) => r.ids.has(n.id)).length : 0) + '/' + t.nodes.length
    })
  }

  function renderTypes() {
    const b = active
    $('types-title').textContent = `Tipos de node · ${b.name} · ${ROLES[cc().role].name}`
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
        `<td class="c"><input type="checkbox" id="rq-${b.id}-${i}" aria-label="Obrigatório: ${t.key}"></td>` +
        `<td><label for="rq-${b.id}-${i}">${t.nodes[0].icon ? `<img class="ic" src="${t.nodes[0].icon}" alt="" style="border-color:${color}">` : `<span class="sw${t.skill ? ' skill' : ''}" style="border-color:${color}"></span>`}${t.key}<small>${t.nodes.length}× · ${t.cost} pt</small></label></td>` +
        `<td class="r"><input class="num" type="number" step="0.1" min="0" id="w-${b.id}-${i}" aria-label="Peso: ${t.key}"></td>` +
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

  // ---- JSON legível ---------------------------------------------------------
  const nodeRef = (b, id) => { const n = b.byId.get(id); return `L${n.row - b.r0 + 1}C${n.col - b.c0 + 1}` }
  function toJson() {
    const out = { classe: classInfo().name, papel: ROLES[cc().role].name, toleranciaPontosPorPeso: state.lambda, arvores: {} }
    for (const b of boards) {
      out.arvores[b.name] = {
        tipos: Object.fromEntries(b.types.map((t) => [t.key, { peso: weightOf(b, t.key), obrigatorio: cfg(b).reqTypes.includes(t.key) }])),
        nodesObrigatorios: cfg(b).reqNodes.map((id) => nodeRef(b, id)),
        nodesBloqueados: cfg(b).blocked.map((id) => nodeRef(b, id)),
      }
    }
    return JSON.stringify(out, null, 2)
  }
  /** Aplica o JSON na classe atual (classe e papel do JSON são só informativos). */
  function fromJson(text) {
    const src = JSON.parse(text)
    const next = {}
    for (const b of boards) {
      const a = src.arvores?.[b.name]
      const c = (next[b.id] = emptyBoard())
      if (!a) continue
      for (const [key, v] of Object.entries(a.tipos || {})) {
        if (!b.typeByKey.has(key)) throw new Error(`Tipo desconhecido em ${b.name}: "${key}"`)
        if (isFinite(+v.peso) && +v.peso >= 0) c.weights[key] = +v.peso
        if (v.obrigatorio) c.reqTypes.push(key)
      }
      const toId = (ref) => {
        const m = /^L(\d+)C(\d+)$/i.exec(ref)
        const n = m && b.nodes.find((x) => x.row - b.r0 + 1 === +m[1] && x.col - b.c0 + 1 === +m[2] && x.type !== 'Start')
        if (!n) throw new Error(`Node inválido em ${b.name}: "${ref}"`)
        return n.id
      }
      c.reqNodes = (a.nodesObrigatorios || []).map(toId)
      c.blocked = (a.nodesBloqueados || []).map(toId)
    }
    cc().boards = next
    state.lambda = Math.min(1, Math.max(0, +src.toleranciaPontosPorPeso || 0))
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
    renderTabs(); renderGrid(); renderResult()
    $('json').value = toJson()
  }
  function renderAll() {
    renderChooser()
    if (!ready()) return
    renderTabs(); renderGrid(); renderTypes(); renderResult(); renderLambda()
    $('json').value = toJson()
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
    if (cc().role) recomputeAll()
    save()
    renderAll()
  }
  function pickClass(slug) {
    state.cls = slug
    const info = classInfo()
    if (info.roles.length === 1 && !cc().role) cc().role = info.roles[0]
    open()
  }
  function pickRole(r) {
    cc().role = r
    recomputeAll()
    save()
    renderAll()
  }

  $('mode-req').onclick = () => setMode('req')
  $('mode-block').onclick = () => setMode('block')
  function setMode(m) {
    mode = m
    $('mode-req').setAttribute('aria-pressed', m === 'req')
    $('mode-block').setAttribute('aria-pressed', m === 'block')
  }
  $('clear').onclick = () => {
    Object.assign(cfg(active), { reqTypes: [], reqNodes: [], blocked: [] })
    compute(active); save(); renderAll()
  }
  $('reset-weights').onclick = () => {
    boards.forEach((b) => (cfg(b).weights = {}))
    recomputeAll(); save(); renderAll()
  }
  $('goto-types').onclick = () => $('tipos').scrollIntoView({ behavior: 'smooth', block: 'start' })
  $('lambda').oninput = () => {
    state.lambda = +$('lambda').value
    renderLambda()
    clearTimeout($('lambda')._t)
    $('lambda')._t = setTimeout(() => { recomputeAll(); save(); renderAll() }, 200)
  }
  const copy = (text, input, say) => {
    const fallback = () => { input.hidden = false; input.value = text; input.select(); say('Selecionado. Use Ctrl+C para copiar.') }
    navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(() => say('Copiado.'), fallback) : fallback()
  }
  $('share').onclick = () => {
    save()
    copy(location.origin + location.pathname + lastHash, $('share-url'), (t) => ($('share-msg').textContent = t === 'Copiado.' ? 'Link copiado. Quem abrir vê esta mesma configuração.' : t))
  }
  const msg = (t) => ($('json-msg').textContent = t)
  $('json-apply').onclick = () => {
    try { fromJson($('json').value); recomputeAll(); save(); renderAll(); msg('Aplicado.') }
    catch (e) { msg('Não foi possível aplicar: ' + e.message) }
  }
  $('json-copy').onclick = () => copy($('json').value, $('json'), msg)
  $('json-reset').onclick = () => { cc().boards = {}; recomputeAll(); save(); renderAll(); msg('Padrão restaurado.') }

  // ---- início: o link (#s=...) tem prioridade sobre o que ficou salvo -------
  async function boot() {
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
