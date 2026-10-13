/*
 * Solver da Daevanion Board (Aion 2).
 *
 * Problema: dado o node inicial e um conjunto de nodes obrigatórios, achar o
 * conjunto CONEXO de nodes (vizinhança em cruz: cima/baixo/esquerda/direita)
 * que contém todos eles e minimiza
 *
 *     soma( custo_em_pontos(n) − t · valor_de_ataque(n) )
 *
 * Isso é uma árvore de Steiner com peso nos nodes. Como a board é pequena
 * (≤ 153 nodes), resolvemos de forma EXATA com a DP de Dreyfus–Wagner sobre
 * subconjuntos dos obrigatórios (até EXACT_LIMIT). Acima disso cai numa
 * heurística (caminho mais curto com reinícios aleatórios) e o resultado vem
 * marcado como aproximado.
 *
 * `t` controla o critério:
 *   - lambda = 0  → modo estrito: menos pontos SEMPRE ganha; ataque só desempata.
 *   - lambda > 0  → cada 1.0 de valor de ataque "vale" lambda pontos, então o
 *                   caminho aceita ficar mais caro pra passar por ataque.
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.DaevanionSolver = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  const EXACT_LIMIT = 13
  const MIN_WEIGHT = 1e-6

  /** Grafo da board: índice por node + lista de vizinhos em cruz. */
  function buildGraph(board, blockedIds) {
    const blocked = blockedIds || new Set()
    const nodes = board.nodes.filter((n) => !blocked.has(n.id))
    const byCell = new Map()
    nodes.forEach((n, i) => byCell.set(n.row + ',' + n.col, i))
    const adj = nodes.map((n) => {
      const out = []
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = byCell.get(n.row + dr + ',' + (n.col + dc))
        if (j !== undefined) out.push(j)
      }
      return out
    })
    const start = nodes.findIndex((n) => n.type === 'Start')
    const indexOfId = new Map(nodes.map((n, i) => [n.id, i]))
    return { nodes, adj, start, indexOfId }
  }

  /** Dijkstra O(n²) com peso nos nodes; `dist` já vem com as fontes preenchidas. */
  function relax(n, adj, w, dist, onImprove) {
    const done = new Uint8Array(n)
    for (;;) {
      let v = -1
      let best = Infinity
      for (let i = 0; i < n; i++) {
        if (!done[i] && dist[i] < best) {
          best = dist[i]
          v = i
        }
      }
      if (v < 0) return
      done[v] = 1
      const nb = adj[v]
      for (let x = 0; x < nb.length; x++) {
        const u = nb[x]
        const c = best + w[u]
        if (c < dist[u] - 1e-12) {
          dist[u] = c
          onImprove(u, v)
        }
      }
    }
  }

  function solveExact(g, w, terms) {
    const n = g.nodes.length
    const k = terms.length
    const full = (1 << k) - 1
    const dp = new Float64Array((full + 1) * n).fill(Infinity)
    // kind: 0 = folha (o próprio obrigatório), 1 = veio do vizinho `arg`,
    //       2 = junção de duas subárvores em v (arg = submáscara)
    const kind = new Uint8Array((full + 1) * n)
    const arg = new Int32Array((full + 1) * n)
    for (let i = 0; i < k; i++) dp[(1 << i) * n + terms[i]] = w[terms[i]]

    for (let S = 1; S <= full; S++) {
      const base = S * n
      if (S & (S - 1)) {
        for (let A = (S - 1) & S; A > 0; A = (A - 1) & S) {
          const B = S ^ A
          if (A < B) continue
          const a = A * n
          const b = B * n
          for (let v = 0; v < n; v++) {
            const c = dp[a + v] + dp[b + v] - w[v]
            if (c < dp[base + v] - 1e-12) {
              dp[base + v] = c
              kind[base + v] = 2
              arg[base + v] = A
            }
          }
        }
      }
      const dist = dp.subarray(base, base + n)
      relax(n, g.adj, w, dist, (u, v) => {
        kind[base + u] = 1
        arg[base + u] = v
      })
    }

    if (!isFinite(dp[full * n + g.start])) return null
    const picked = new Set()
    const stack = [[full, g.start]]
    while (stack.length) {
      const [S, v] = stack.pop()
      picked.add(v)
      const i = S * n + v
      if (kind[i] === 1) stack.push([S, arg[i]])
      else if (kind[i] === 2) {
        stack.push([arg[i], v])
        stack.push([S ^ arg[i], v])
      }
    }
    return picked
  }

  /** Heurística: liga os obrigatórios um a um pelo caminho mais barato até a árvore. */
  function solveHeuristic(g, w, terms, restarts) {
    const n = g.nodes.length
    let best = null
    let bestCost = Infinity
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

    for (let r = 0; r < restarts; r++) {
      const tree = new Set([g.start])
      const pending = new Set(terms)
      pending.delete(g.start)
      // r = 0 é o guloso puro (sempre o mais próximo); os demais sorteiam a ordem
      while (pending.size) {
        const dist = new Float64Array(n).fill(Infinity)
        const prev = new Int32Array(n).fill(-1)
        tree.forEach((v) => (dist[v] = 0))
        relax(n, g.adj, w, dist, (u, v) => (prev[u] = v))
        let target = -1
        if (r === 0) {
          pending.forEach((t) => {
            if (target < 0 || dist[t] < dist[target]) target = t
          })
        } else {
          const list = [...pending]
          target = list[Math.floor(rnd() * list.length)]
        }
        if (!isFinite(dist[target])) return null
        for (let v = target; v >= 0 && !tree.has(v); v = prev[v]) {
          tree.add(v)
          pending.delete(v)
        }
      }
      const improved = localSearch(g, w, terms, tree)
      const cost = setCost(w, improved)
      if (cost < bestCost - 1e-12) {
        bestCost = cost
        best = improved
      }
    }
    return best
  }

  function setCost(w, set) {
    let c = 0
    set.forEach((v) => (c += w[v]))
    return c
  }

  /** Nodes de `set` alcançáveis a partir do início sem passar por `skip`. */
  function reachable(g, set, skip) {
    const seen = new Set([g.start])
    const stack = [g.start]
    while (stack.length) {
      const v = stack.pop()
      for (const u of g.adj[v]) {
        if (u !== skip && set.has(u) && !seen.has(u)) {
          seen.add(u)
          stack.push(u)
        }
      }
    }
    return seen
  }

  /** Tira, do mais caro pro mais barato, todo node dispensável (que não desconecta obrigatório). */
  function prune(g, w, terms, set) {
    let cur = reachable(g, set, -1)
    const isTerm = new Set(terms)
    for (let changed = true; changed; ) {
      changed = false
      const cand = [...cur].filter((v) => v !== g.start && !isTerm.has(v)).sort((a, b) => w[b] - w[a])
      for (const v of cand) {
        if (!cur.has(v)) continue
        const rest = reachable(g, cur, v)
        if (terms.every((t) => rest.has(t))) {
          cur = rest
          changed = true
        }
      }
    }
    return cur
  }

  /** Busca local: tenta incluir um node vizinho e podar; aceita se o total cair. */
  function localSearch(g, w, terms, tree) {
    let cur = prune(g, w, terms, tree)
    let cost = setCost(w, cur)
    for (let improvedAny = true; improvedAny; ) {
      improvedAny = false
      const frontier = new Set()
      cur.forEach((v) => g.adj[v].forEach((u) => !cur.has(u) && frontier.add(u)))
      for (const u of frontier) {
        const trial = prune(g, w, terms, new Set(cur).add(u))
        const c = setCost(w, trial)
        if (c < cost - 1e-12) {
          cur = trial
          cost = c
          improvedAny = true
          break
        }
      }
    }
    return cur
  }

  /**
   * Montagem automática. A partir da árvore base de cada board, repete: acha o
   * caminho mais barato até cada node de fora, calcula ganho (soma dos pesos
   * novos no caminho) e custo, e compra — entre todas as boards — o de melhor
   * ganho^alpha / custo que ainda cabe no orçamento compartilhado. Roda com
   * alguns alphas (mais guloso por eficiência ↔ mais disposto a ir longe por
   * um node valioso) e fica com o maior peso total.
   * É heurística: o ótimo desse problema (árvore de maior prêmio com
   * orçamento) é NP-difícil.
   *
   * @param ctxs  [{ g, cost, value, picked }] — uma entrada por board
   * @returns     um Set de índices por board, na mesma ordem
   */
  function expandMany(ctxs, budget) {
    const ws = ctxs.map((c) => {
      const total = c.value.reduce((a, b) => a + b, 0)
      const eps = 0.5 / (total + 1)
      return c.cost.map((x, i) => Math.max(MIN_WEIGHT, x - eps * c.value[i]))
    })
    let best = ctxs.map((c) => c.picked)
    let bestVal = -1
    let bestCost = Infinity
    for (const alpha of [0.75, 1, 1.5, 2]) {
      const trees = ctxs.map((c) => new Set(c.picked))
      let spent = 0
      trees.forEach((tree, k) => tree.forEach((v) => (spent += ctxs[k].cost[v])))
      const cached = ctxs.map(() => null) // melhor compra de cada board (refeita quando a board muda ou não cabe mais)
      const bestPick = (k) => {
        const { g, cost, value } = ctxs[k]
        const tree = trees[k]
        const n = g.nodes.length
        const dist = new Float64Array(n).fill(Infinity)
        const prev = new Int32Array(n).fill(-1)
        tree.forEach((v) => (dist[v] = 0))
        relax(n, g.adj, ws[k], dist, (u, v) => (prev[u] = v))
        const out = { node: -1, score: 0, cost: 0, prev }
        for (let u = 0; u < n; u++) {
          if (tree.has(u) || !isFinite(dist[u])) continue
          let gain = 0
          let c = 0
          for (let v = u; v >= 0 && !tree.has(v); v = prev[v]) {
            gain += value[v]
            c += cost[v]
          }
          if (gain <= 0 || spent + c > budget) continue
          const score = Math.pow(gain, alpha) / Math.max(c, 0.5)
          if (score > out.score) {
            out.score = score
            out.node = u
            out.cost = c
          }
        }
        return out
      }
      for (;;) {
        let k = -1
        for (let j = 0; j < ctxs.length; j++) {
          if (!cached[j] || (cached[j].node >= 0 && spent + cached[j].cost > budget)) cached[j] = bestPick(j)
          if (cached[j].node >= 0 && (k < 0 || cached[j].score > cached[k].score)) k = j
        }
        if (k < 0) break
        const p = cached[k]
        for (let v = p.node; v >= 0 && !trees[k].has(v); v = p.prev[v]) trees[k].add(v)
        spent += p.cost
        cached[k] = null
      }
      let val = 0
      trees.forEach((tree, k) => tree.forEach((v) => (val += ctxs[k].value[v])))
      if (val > bestVal + 1e-9 || (Math.abs(val - bestVal) <= 1e-9 && spent < bestCost)) {
        best = trees
        bestVal = val
        bestCost = spent
      }
    }
    return best
  }

  /** Resolve só a parte obrigatória de uma board; devolve o contexto pro resto. */
  function base(board, requiredIds, opts) {
    const o = opts || {}
    const valueOf = o.valueOf || (() => 0)
    const g = buildGraph(board, o.blockedIds)
    if (g.start < 0) return { ok: false, reason: 'no-start' }

    const value = g.nodes.map((n) => Math.max(0, valueOf(n) || 0))
    let t = o.lambda || 0
    if (!(t > 0)) {
      // modo estrito: o bônus total de ataque nunca chega a 1 ponto
      const total = value.reduce((a, b) => a + b, 0)
      t = 0.5 / (total + 1)
    }
    // nodes já abertos pelo personagem não custam pontos nem contam peso
    const free = o.freeIds || new Set()
    const cost = g.nodes.map((n, i) => (i === g.start || free.has(n.id) ? 0 : n.cost))
    for (let i = 0; i < value.length; i++) if (cost[i] === 0) value[i] = 0
    const w = g.nodes.map((n, i) => (i === g.start ? 0 : cost[i] === 0 ? MIN_WEIGHT : Math.max(MIN_WEIGHT, cost[i] - t * value[i])))

    const terms = []
    for (const id of new Set(requiredIds)) {
      const i = g.indexOfId.get(id)
      if (i === undefined) return { ok: false, reason: 'required-blocked', id }
      if (i !== g.start) terms.push(i)
    }

    const exact = terms.length <= EXACT_LIMIT && !o.forceHeuristic
    let picked
    if (terms.length === 0) picked = new Set([g.start])
    else picked = exact ? solveExact(g, w, terms) : solveHeuristic(g, w, terms, 24)
    if (!picked) return { ok: false, reason: 'unreachable' }
    const requiredPoints = [...picked].reduce((a, v) => a + cost[v], 0)
    return { ok: true, g, cost, value, picked, exact, requiredPoints }
  }

  function finish(ctx, picked, extra) {
    const { g, cost, value } = ctx
    // ordem de desbloqueio: busca em largura a partir do início, dentro da árvore
    const order = []
    const seen = new Set([g.start])
    const queue = [g.start]
    while (queue.length) {
      const v = queue.shift()
      order.push(g.nodes[v].id)
      for (const u of g.adj[v]) {
        if (picked.has(u) && !seen.has(u)) {
          seen.add(u)
          queue.push(u)
        }
      }
    }
    let points = 0
    let attack = 0
    picked.forEach((v) => {
      points += cost[v]
      attack += value[v]
    })
    return { ok: true, exact: ctx.exact, auto: false, overBudget: false, requiredPoints: ctx.requiredPoints, ids: new Set(order), order, points, attack, ...extra }
  }

  /**
   * @param board       { nodes: [{ id, row, col, type, cost, ... }] }
   * @param requiredIds ids dos nodes obrigatórios
   * @param opts.valueOf(node) → peso do node (≥ 0)
   * @param opts.lambda quantos pontos vale 1.0 de peso (0 = só desempate)
   * @param opts.blockedIds nodes proibidos
   * @param opts.freeIds nodes já abertos (custo 0)
   * @param opts.budget  pontos para gastar: liga a montagem automática
   */
  function solve(board, requiredIds, opts) {
    const ctx = base(board, requiredIds, opts)
    if (!ctx.ok) return ctx
    const budget = (opts && opts.budget) || 0
    if (!(budget > 0)) return finish(ctx, ctx.picked)
    if (ctx.requiredPoints > budget) return finish(ctx, ctx.picked, { auto: true, overBudget: true })
    return finish(ctx, expandMany([ctx], budget)[0], { auto: true })
  }

  /**
   * Várias boards dividindo o mesmo orçamento de pontos.
   * @param items [{ board, requiredIds, opts }]
   * @returns     um resultado por item, na mesma ordem
   */
  function solveMany(items, budget) {
    const ctxs = items.map((it) => base(it.board, it.requiredIds, it.opts))
    const good = ctxs.filter((c) => c.ok)
    const required = good.reduce((a, c) => a + c.requiredPoints, 0)
    const over = required > budget
    const trees = over ? good.map((c) => c.picked) : expandMany(good, budget)
    let k = 0
    return ctxs.map((c) => (c.ok ? finish(c, trees[k++], { auto: true, overBudget: over, poolRequired: required }) : c))
  }

  return { solve, solveMany, buildGraph, EXACT_LIMIT }
})
