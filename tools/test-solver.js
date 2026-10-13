// Confere a DP exata contra força bruta em boards aleatórias pequenas e roda
// um caso real pra medir tempo.   node tools/test-solver.js
const { solve } = require('../solver.js')
const data = require('../data.js')

let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

function bruteForce(board, required, valueOf, t) {
  const nodes = board.nodes
  const n = nodes.length
  const start = nodes.findIndex((x) => x.type === 'Start')
  const idx = new Map(nodes.map((x, i) => [x.row + ',' + x.col, i]))
  const req = required.map((id) => nodes.findIndex((x) => x.id === id))
  let best = Infinity
  for (let mask = 0; mask < 1 << n; mask++) {
    if (!((mask >> start) & 1) || req.some((r) => !((mask >> r) & 1))) continue
    let seen = 1 << start
    const st = [start]
    while (st.length) {
      const v = st.pop()
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = idx.get(nodes[v].row + dr + ',' + (nodes[v].col + dc))
        if (u !== undefined && (mask >> u) & 1 && !((seen >> u) & 1)) {
          seen |= 1 << u
          st.push(u)
        }
      }
    }
    if (seen !== mask) continue
    let c = 0
    for (let i = 0; i < n; i++) if ((mask >> i) & 1 && i !== start) c += nodes[i].cost - t * valueOf(nodes[i])
    if (c < best) best = c
  }
  return best
}

let fails = 0
for (let trial = 0; trial < 300; trial++) {
  const nodes = []
  let id = 1
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if ((r === 1 && c === 1) || rnd() < 0.8)
        nodes.push({ id: id++, row: r, col: c, type: r === 1 && c === 1 ? 'Start' : 'Stat', cost: r === 1 && c === 1 ? 0 : 1 + Math.floor(rnd() * 4), atk: !(r === 1 && c === 1) && rnd() < 0.3 ? 1 : 0 })
  const board = { nodes }
  const valueOf = (x) => x.atk
  const lambda = trial % 2 ? 0.5 : 0
  const pool = nodes.filter((x) => x.type !== 'Start')
  const required = pool.filter(() => rnd() < 0.3).map((x) => x.id)
  const res = solve(board, required, { valueOf, lambda })
  const t = lambda || 0.5 / (nodes.reduce((a, x) => a + x.atk, 0) + 1)
  const bf = bruteForce(board, required, valueOf, t)
  const got = res.ok ? res.points - t * res.attack : Infinity
  if (Math.abs(got - bf) > 1e-9) {
    fails++
    console.log('FAIL', trial, got, bf)
  }
}
console.log(fails ? fails + ' falhas' : 'ok: 300 boards aleatórias batem com a força bruta')

const atk = (n) => (n.stats.some((s) => /Attack/.test(s)) ? 1 : 0)
for (const board of data.boards) {
  const pool = board.nodes.filter((n) => n.type === 'SkillLevel' || n.grade === 'Unique')
  const required = pool.slice(0, 13).map((n) => n.id)
  const t0 = Date.now()
  const res = solve(board, required, { valueOf: atk })
  const t1 = Date.now()
  const h = solve(board, required, { valueOf: atk, forceHeuristic: true })
  console.log(board.name, required.length, 'obrigatórios → exato', res.points, 'pts / ataque', res.attack, t1 - t0 + 'ms', '| heurística', h.points, 'pts / ataque', h.attack, Date.now() - t1 + 'ms')
  // caso grande: todos os nodes de skill + únicos + ataque (só heurística)
  const big = board.nodes.filter((n) => n.type === 'SkillLevel' || n.grade === 'Unique' || atk(n)).map((n) => n.id)
  const t2 = Date.now()
  const hb = solve(board, big, { valueOf: atk })
  console.log('   ', big.length, 'obrigatórios → heurística', hb.points, 'pts de', board.totalCost, Date.now() - t2 + 'ms')
}
process.exit(fails ? 1 : 0)
