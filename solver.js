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
  const EXACT_LIMIT = 12
  const MIN_WEIGHT = 1e-6
  // Desempate (opts.tieOf, 0 a 10): entra no valor vezes TIE_STEP, e a montagem
  // automática compara primeiro o peso real e só depois o desempate. Valores
  // abaixo de TIE_ONLY são só desempate, não peso.
  const TIE_STEP = 1e-6
  const TIE_ONLY = 1e-3
  const REST_CHUNK = 10 // pontos por bloco de atributos comuns na ordem sugerida

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
    const built = []

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
      // construir é barato; a busca local (cara) só roda nas 3 melhores construções
      const pruned = prune(g, w, terms, tree)
      built.push({ tree: pruned, cost: setCost(w, pruned) })
    }
    built.sort((a, b) => a.cost - b.cost)
    for (const b of built.slice(0, 3)) {
      const improved = localSearch(g, w, terms, b.tree)
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
    const spentOf = (trees) => trees.reduce((a, t, k) => a + [...t].reduce((x, v) => x + ctxs[k].cost[v], 0), 0)
    const sumOf = (trees, arr) => trees.reduce((a, t, k) => a + [...t].reduce((x, v) => x + arr[k][v], 0), 0)
    const realOf = (trees) => sumOf(trees, ctxs.map((c) => c.real))
    const tieOf = (trees) => sumOf(trees, ctxs.map((c) => c.tie))
    // valores com e sem desempate (value = real + tie)
    const WITH_TIE = ctxs.map((c) => c.value)
    const REAL = ctxs.map((c) => c.real)
    const wsFor = (vals) =>
      ctxs.map((c, k) => {
        const total = vals[k].reduce((x, y) => x + y, 0)
        const eps = 0.5 / (total + 1)
        return c.cost.map((x, i) => Math.max(MIN_WEIGHT, x - eps * vals[k][i]))
      })

    /**
     * Uma rodada completa (compra + busca local + limpeza) usando `vals` como
     * valor dos nodes.
     */
    function run(alpha, vals, start) {
      const ws = wsFor(vals)
      const valueOf = (trees) => sumOf(trees, vals)

      /** Compra caminhos, do melhor ganho^alpha/custo para baixo, até não caber mais nada. */
      function fill(trees) {
        let spent = spentOf(trees)
        const cached = ctxs.map(() => null) // melhor compra de cada board (refeita quando a board muda ou não cabe mais)
        const bestPick = (k) => {
          const { g, cost } = ctxs[k]
          const value = vals[k]
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
          if (k < 0) return
          const p = cached[k]
          for (let v = p.node; v >= 0 && !trees[k].has(v); v = p.prev[v]) trees[k].add(v)
          spent += p.cost
          cached[k] = null
        }
      }

      /** Folhas removíveis: fora da parte obrigatória, com no máximo 1 vizinho na árvore. */
      function leaves(trees) {
        const out = []
        trees.forEach((tree, k) => {
          const { g, cost, picked } = ctxs[k]
          const value = vals[k]
          tree.forEach((v) => {
            // nodes só de desempate não ocupam as vagas de troca
            if (picked.has(v) || cost[v] === 0 || (value[v] > 0 && value[v] < TIE_ONLY)) return
            let deg = 0
            for (const u of g.adj[v]) if (tree.has(u)) deg++
            if (deg <= 1) out.push({ k, v, ratio: value[v] / cost[v] })
          })
        })
        return out.sort((x, y) => x.ratio - y.ratio)
      }
      /** Tira a folha e, em cascata, as pontas que ficaram sem valor. */
      function cut(trees, k, v) {
        const { g, picked } = ctxs[k]
        const value = vals[k]
        const tree = trees[k]
        const stack = [v]
        while (stack.length) {
          const x = stack.pop()
          if (!tree.has(x) || picked.has(x)) continue
          let deg = 0
          let nb = -1
          for (const u of g.adj[x]) if (tree.has(u)) (deg++, (nb = u))
          if (deg > 1) continue
          if (x !== v && value[x] > 0) continue
          tree.delete(x)
          if (nb >= 0) stack.push(nb)
        }
      }

      const trees = start.map((t) => new Set(t))
      fill(trees)
      // busca local: troca a folha de pior peso/ponto por outra compra, se melhorar
      let cur = valueOf(trees)
      let best = trees
      for (let iter = 0; iter < 60; iter++) {
        let improved = false
        for (const leaf of leaves(best).slice(0, 8)) {
          const trial = best.map((t) => new Set(t))
          cut(trial, leaf.k, leaf.v)
          fill(trial)
          const val = valueOf(trial)
          if (val > cur + 1e-9) {
            best = trial
            cur = val
            improved = true
            break
          }
        }
        if (!improved) break
      }
      // pontos liberados pelos nodes que sobraram voltam para a compra
      for (let i = 0; i < 5 && dropRedundant(best, vals); i++) fill(best)
      return best
    }

    /**
     * Tira nodes sem valor que ficaram sobrando: com as compras, dois caminhos
     * podem fechar um ciclo e um node de passagem deixa de ser necessário (a
     * busca local só corta pontas, então ele nunca sairia). Obrigatórios ficam.
     * @returns se tirou algum
     */
    function dropRedundant(trees, vals) {
      let any = false
      trees.forEach((tree, k) => {
        const { g, cost, terms } = ctxs[k]
        const value = vals[k]
        const connected = () => {
          const seen = new Set([g.start])
          const stack = [g.start]
          while (stack.length) for (const u of g.adj[stack.pop()]) if (tree.has(u) && !seen.has(u)) (seen.add(u), stack.push(u))
          return seen.size === tree.size
        }
        for (let changed = true; changed; ) {
          changed = false
          for (const v of [...tree]) {
            if (v === g.start || cost[v] === 0 || value[v] > 0 || terms.has(v)) continue
            tree.delete(v)
            if (connected()) changed = any = true
            else tree.add(v)
          }
        }
      })
      return any
    }

    // Duas rodadas por alpha: (1) com desempate desde o começo, que escolhe as
    // passagens preferidas; (2) só com o peso real e, no fim, a sobra de pontos
    // comprada com desempate. Vence o maior peso real; empate, o maior
    // desempate; empate, o mais barato. Assim o desempate nunca custa peso: a
    // rodada (2) garante o mesmo peso de quem não usa desempate.
    const hasTie = ctxs.some((c) => c.tie.some((x) => x > 0))
    const start = ctxs.map((c) => c.picked)
    let best = start
    let bestReal = -1
    let bestTie = -1
    let bestCost = Infinity
    const consider = (trees) => {
      const r = realOf(trees)
      const t = tieOf(trees)
      const s = spentOf(trees)
      const better = r > bestReal + 1e-7 || (Math.abs(r - bestReal) <= 1e-7 && (t > bestTie + 1e-12 || (Math.abs(t - bestTie) <= 1e-12 && s < bestCost)))
      if (better) [best, bestReal, bestTie, bestCost] = [trees, r, t, s]
    }
    for (const alpha of [0.75, 1, 1.5, 2]) {
      const plain = run(alpha, REAL, start)
      consider(plain)
      if (hasTie) {
        consider(run(alpha, WITH_TIE, start))
        // a sobra de pontos vai para o desempate
        consider(run(alpha, WITH_TIE, plain))
      }
    }
    return best
  }

  /** Resolve só a parte obrigatória de uma board; devolve o contexto pro resto. */
  // A parte obrigatória é o passo caro (DP exata) e se repete muito entre um
  // cálculo e outro: guarda os últimos resultados pela entrada completa.
  const BASE_CACHE = new Map()
  const BASE_CACHE_MAX = 300
  function base(board, requiredIds, opts) {
    const o = opts || {}
    const valueOf = o.valueOf !== Object.prototype.valueOf && typeof o.valueOf === 'function' ? o.valueOf : () => 0
    const key = [
      board.id ?? '', [...new Set(requiredIds)].sort().join(','), [...(o.blockedIds || [])].sort().join(','),
      [...(o.freeIds || [])].sort().join(','), o.lambda || 0, o.forceHeuristic ? 1 : 0,
      board.nodes.map((n) => valueOf(n) || 0).join(','),
      typeof o.tieOf === 'function' ? board.nodes.map((n) => o.tieOf(n) || 0).join(',') : '',
    ].join('|')
    if (BASE_CACHE.has(key)) {
      const hit = BASE_CACHE.get(key)
      BASE_CACHE.delete(key)
      BASE_CACHE.set(key, hit) // LRU: volta para o fim
      return hit.ok ? { ...hit, picked: new Set(hit.picked) } : hit
    }
    const out = baseUncached(board, requiredIds, o)
    BASE_CACHE.set(key, out)
    if (BASE_CACHE.size > BASE_CACHE_MAX) BASE_CACHE.delete(BASE_CACHE.keys().next().value)
    return out.ok ? { ...out, picked: new Set(out.picked) } : out
  }

  function baseUncached(board, requiredIds, opts) {
    const o = opts || {}
    const valueOf = o.valueOf !== Object.prototype.valueOf && typeof o.valueOf === 'function' ? o.valueOf : () => 0
    const g = buildGraph(board, o.blockedIds)
    if (g.start < 0) return { ok: false, reason: 'no-start' }

    const tieOf = typeof o.tieOf === 'function' ? o.tieOf : () => 0
    // value = peso real + desempate (TIE_STEP × 0..10); real e tie ficam separados para comparar em dois níveis
    const real = g.nodes.map((n) => Math.max(0, valueOf(n) || 0))
    const tie = g.nodes.map((n) => TIE_STEP * Math.min(10, Math.max(0, +tieOf(n) || 0)))
    const value = real.map((x, i) => x + tie[i])
    let t = o.lambda || 0
    if (!(t > 0)) {
      // modo estrito: o bônus total de ataque nunca chega a 1 ponto
      const total = value.reduce((a, b) => a + b, 0)
      t = 0.5 / (total + 1)
    }
    // nodes já abertos pelo personagem não custam pontos nem contam peso
    const free = o.freeIds || new Set()
    const cost = g.nodes.map((n, i) => (i === g.start || free.has(n.id) ? 0 : n.cost))
    for (let i = 0; i < value.length; i++) if (cost[i] === 0) value[i] = real[i] = tie[i] = 0
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
    return { ok: true, g, cost, value, real, tie, picked, exact, requiredPoints, terms: new Set(terms) }
  }

  function finish(ctx, picked, extra) {
    const { g, cost, real } = ctx
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
      attack += real[v]
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

  /**
   * "Pelo menos N destes nodes": escolhe quais N, um de cada vez, sempre o
   * candidato mais barato de alcançar a partir da árvore atual (já contando os
   * obrigatórios e o que foi escolhido antes). Candidatos que já estão na árvore
   * (obrigatórios ou já abertos) contam de graça.
   *
   * @param items      [{ board, requiredIds, opts }] — as boards onde os candidatos estão
   * @param candidates [[ids]] — candidatos de cada item
   * @returns          [[ids escolhidos]] por item
   */
  function pickNearest(items, candidates, n) {
    const ctxs = items.map((it) => base(it.board, it.requiredIds, it.opts))
    const trees = ctxs.map((c) => (c.ok ? new Set(c.picked) : null))
    const chosen = items.map(() => [])
    let need = n
    // Candidatos que já estão no caminho contam, mas viram escolhidos (obrigatórios):
    // se fossem só passagem, outro "garantir" depois poderia mudar o caminho e
    // tirá-los, e o mínimo pedido não seria cumprido.
    ctxs.forEach((c, k) => {
      if (!c.ok) return
      for (const id of candidates[k]) {
        if (need <= 0) break
        const i = c.g.indexOfId.get(id)
        if (i === undefined || !(trees[k].has(i) || c.cost[i] === 0)) continue
        need--
        if (c.cost[i] > 0) chosen[k].push(id)
      }
    })
    while (need > 0) {
      let best = null
      ctxs.forEach((c, k) => {
        if (!c.ok) return
        const cand = candidates[k].map((id) => c.g.indexOfId.get(id)).filter((i) => i !== undefined && !trees[k].has(i) && c.cost[i] > 0)
        if (!cand.length) return
        const total = c.value.reduce((a, b) => a + b, 0)
        const eps = 0.5 / (total + 1)
        const w = c.cost.map((x, i) => Math.max(MIN_WEIGHT, x - eps * c.value[i]))
        const nn = c.g.nodes.length
        const dist = new Float64Array(nn).fill(Infinity)
        const prev = new Int32Array(nn).fill(-1)
        trees[k].forEach((v) => (dist[v] = 0))
        relax(nn, c.g.adj, w, dist, (u, v) => (prev[u] = v))
        for (const i of cand) if (isFinite(dist[i]) && (!best || dist[i] < best.d)) best = { k, i, d: dist[i], prev }
      })
      if (!best) break
      for (let v = best.i; v >= 0 && !trees[best.k].has(v); v = best.prev[v]) trees[best.k].add(v)
      chosen[best.k].push(ctxs[best.k].g.nodes[best.i].id)
      need--
    }
    return chosen
  }

  /**
   * Ordem sugerida para abrir um caminho já calculado, em BLOCOS: cada bloco é
   * o trecho que liga o que já está aberto ao próximo node especial (único,
   * lendário, habilidade ou obrigatório). Entre os especiais que faltam, vai
   * primeiro o de maior "peso do trecho ÷ pontos do trecho"; empate, o mais
   * barato. Os nodes que sobram (atributos comuns da montagem automática) vão
   * num último bloco.
   *
   * @param board   board com `nodes`
   * @param ids     ids do caminho (results[b].ids), com o início
   * @param o       { ownedIds: Set, valueOf(n), isSpecial(n) }
   * @returns       [{ ids: [id], target: id | null, cost, value }]
   */
  function orderBlocks(board, ids, o) {
    const owned = o.ownedIds || new Set()
    const g = buildGraph({ nodes: board.nodes.filter((n) => ids.has(n.id) || n.type === 'Start') })
    const n = g.nodes.length
    const open = new Uint8Array(n)
    g.nodes.forEach((x, i) => (open[i] = x.type === 'Start' || owned.has(x.id) ? 1 : 0))
    const value = g.nodes.map((x) => Math.max(0, +o.valueOf(x) || 0))
    const total = value.reduce((a, b) => a + b, 0)
    const eps = 0.5 / (total + 1)
    let left = g.nodes.map((x, i) => i).filter((i) => !open[i] && o.isSpecial(g.nodes[i]))
    const blocks = []
    while (left.length) {
      // caminho mais barato de qualquer node aberto até cada especial (desempata pelo peso)
      const w = g.nodes.map((x, i) => (open[i] ? 0 : Math.max(MIN_WEIGHT, x.cost - eps * value[i])))
      const dist = new Float64Array(n).fill(Infinity)
      const prev = new Int32Array(n).fill(-1)
      for (let i = 0; i < n; i++) if (open[i]) dist[i] = 0
      relax(n, g.adj, w, dist, (u, v) => (prev[u] = v))
      let best = null
      for (const t of left) {
        if (!isFinite(dist[t])) continue
        const path = []
        for (let v = t; v >= 0 && !open[v]; v = prev[v]) path.push(v)
        const cost = path.reduce((s, v) => s + g.nodes[v].cost, 0)
        const val = path.reduce((s, v) => s + value[v], 0)
        const score = val / Math.max(1, cost)
        if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && cost < best.cost)) best = { t, path, cost, val, score }
      }
      if (!best) break
      best.path.forEach((v) => (open[v] = 1))
      blocks.push({ ids: best.path.reverse().map((v) => g.nodes[v].id), target: g.nodes[best.t].id, cost: best.cost, value: best.val })
      left = left.filter((i) => !open[i])
    }
    // o que sobra vira um bloco por grupo de nodes vizinhos entre si (cada grupo
    // encosta no que já está aberto), do maior peso por ponto para o menor
    const seen = new Uint8Array(n)
    const groups = []
    for (let s = 0; s < n; s++) {
      if (open[s] || seen[s] || !g.adj[s].some((u) => open[u])) continue
      const list = [s]
      seen[s] = 1
      for (let k = 0; k < list.length; k++) for (const u of g.adj[list[k]]) if (!open[u] && !seen[u]) (seen[u] = 1), list.push(u)
      const cost = list.reduce((a, v) => a + g.nodes[v].cost, 0)
      const val = list.reduce((a, v) => a + value[v], 0)
      groups.push({ ids: list.map((v) => g.nodes[v].id), target: null, cost, value: val })
    }
    groups.sort((a, b) => b.value / b.cost - a.value / a.cost || a.cost - b.cost)
    // junta grupos pequenos seguidos em blocos de ~REST_CHUNK pontos
    for (const gr of groups) {
      const last = blocks[blocks.length - 1]
      if (last && last.target === null && last.cost < REST_CHUNK) {
        last.ids.push(...gr.ids)
        last.cost += gr.cost
        last.value += gr.value
      } else blocks.push(gr)
    }
    return blocks
  }

  return { solve, solveMany, pickNearest, orderBlocks, buildGraph, EXACT_LIMIT }
})
