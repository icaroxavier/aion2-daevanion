/*
 * Peso estimado de +1 nível em cada habilidade, por classe e papel.
 *
 * Escala: a mesma dos atributos — 1,0 = um node comum de Ataque Adicional +3
 * (no DPS), ou o equivalente da métrica do papel (vida efetiva no Tank, cura
 * no Healer).
 *
 * Ativas que causam dano (ou curam, no Healer):
 *   Cada skill da rotação gasta ~1 s de conjuração. As com cooldown são usadas
 *   sempre que voltam (1/cd por segundo); as sem cooldown (golpes básicos)
 *   dividem o tempo que sobra. Com isso:
 *     ganho de +1 nível  = Δdano-base(nível típico → +1) × usos/s
 *     ganho de +3 Ataque = 3 × Σ (coeficiente de Ataque × usos/s)
 *     peso = primeiro ÷ segundo
 *   Rotação = skills que ≥ 50% dos jogadores nível 45 da classe põem na barra.
 *   Ignora autoataque, procs e janelas de buff; é estimativa.
 *
 * Passivas: lê o tooltip no nível 1 e no nível máximo, calcula quanto cada
 * efeito sobe por nível e converte para a escala com o valor de cada atributo
 * no papel (STAT_UNIT). Efeito sem conversão conhecida (ex.: Perfect Chance)
 * fica fora; se nada for reconhecido, cai na estimativa pela amostra.
 *
 * Ativas que não causam dano: no Tank, buffs/defesas valem 10 e controles 4;
 * no DPS/Healer, valem pela amostra (quanto os jogadores investem nelas).
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.DaevanionSkillModel = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  const GCD = 1 // segundos por conjuração
  const HP_REF = 30000 // PV de referência para converter "% de PV" (premissa)

  // valor de 1 unidade de cada efeito de passiva, por papel (na escala acima)
  const STAT_UNIT = {
    dps: {
      // Ataque total de referência ~3.000: +1% ≈ +30 de Ataque
      'Attack%': 10,
      Attack: 1 / 3, 'Critical Hit': 1 / 5, 'Damage Boost%': 17 / 1.5, 'PvE Damage Boost%': 17 / 1.5,
      'Critical Damage Boost%': 25 / 1.5, 'Combat Speed%': 35 / 1.5, 'Cooldown%': 25 / 1.5, 'Double Chance%': 16 / 1.5,
      'Multi-Hit Chance%': 16 / 1.5,
      // só de frente / só pelas costas: metade do tempo, grosso modo
      'Front Attack Damage Boost%': 17 / 3, 'Back Attack Damage Boost%': 17 / 3,
    },
    tank: {
      HP: 11 / 100, 'Max HP%': (11 / 100) * (HP_REF / 100), 'Defense%': 10, Defense: 10 / 30, 'Damage Tolerance%': 17 / 1.5,
      'PvE Damage Tolerance%': 17 / 1.5, 'Critical Hit Resist': 2 / 5, 'Block%': 6, 'Evasion%': 4,
      Block: 0.05, Evasion: 0.05, 'Incoming Heal%': 5 / 1.5, 'Status Effect Resist%': 2, Endurance: 0, 'Endurance%': 3,
      Attack: 0.3 / 3, 'Damage Boost%': 5 / 1.5, 'PvE Damage Boost%': 5 / 1.5, 'Combat Speed%': 10.5 / 1.5, 'Cooldown%': 15 / 1.5,
    },
    healer: {
      Attack: 1 / 3, 'Heal Boost%': 17 / 1.5, 'Healing%': 17 / 1.5, 'Critical Hit': 1 / 5, 'Combat Speed%': 35 / 1.5,
      'Cooldown%': 25 / 1.5, 'Max HP%': 0.03 * (HP_REF / 100), HP: 0.03, 'Defense%': 2, 'Damage Tolerance%': 8 / 1.5,
    },
  }

  // Por classe, quando foge do papel: mesma calibração dos pesos por classe de
  // app.js (guia do kanonxo + aion2tool, Global), aqui por 1 unidade do efeito.
  const CLASS_STAT_UNIT = {
    gladiator: {
      dps: {
        // Aumento de Ataque: no Global, +2,9% (Might) = +1,87% de dano → 1% ≈ 0,65% ÷ 0,049%
        'Attack%': 13,
        Attack: 1 / 3, 'Critical Hit': 3 / 5, 'Damage Boost%': 16 / 1.5, 'PvE Damage Boost%': 16 / 1.5,
        'Critical Damage Boost%': 9 / 1.5, 'Combat Speed%': 24 / 1.5, 'Cooldown%': 11 / 1.5,
        // Chance Dupla: o stat ofensivo de maior valor (guia: 0,6–0,8% por 1%)
        'Double Chance%': 14,
        'Multi-Hit Chance%': 8 / 1.5,
        // Frente/Costas: ~0,6% por 1% com 75% de acerto da posição; só um lado → metade
        'Front Attack Damage Boost%': 6, 'Back Attack Damage Boost%': 6,
      },
    },
  }

  // "Increases the caster's PvE Damage Boost by 5.5%, ... and Accuracy by 100"
  function effects(tooltip) {
    const out = {}
    if (!tooltip) return out
    const re = /(?:caster's |additional |the )?((?:Max |PvE |PvP )?[A-Z][A-Za-z-]*(?: [A-Z][A-Za-z-]*)*) by (?:an additional )?([\d.,]+)(%?)/g
    let m
    while ((m = re.exec(tooltip))) {
      if (/^ of /.test(tooltip.slice(m.index + m[0].length))) continue // "X% of Attack": outra base, fora
      const key = m[1].replace(/^(?:Increases|Grants|Raises|Boosts) (?:the )?/, '').replace(/^(?:caster's )/, '') + (m[3] ? '%' : '')
      out[key] = (out[key] || 0) + +m[2].replace(/,/g, '')
    }
    return out
  }

  const usedShare = (stat) => (!stat ? 0 : stat.cat === 'Passive' ? stat.learned : stat.equipped)

  /**
   * @param details  DAEVANION_SKILL_DETAILS[classe]
   * @param sample   DAEVANION_SKILL_STATS[classe] ({ skills: { nome: { cat, equipped, learned, avg } } })
   * @param role     'dps' | 'tank' | 'healer'
   * @param cls      classe (ex.: "gladiator"), para a calibração por classe
   * @returns        { [nome]: { weight, how } }
   */
  function weights(details, sample, role, cls) {
    const skills = (sample && sample.skills) || {}
    const lvlOf = (name) => Math.max(1, Math.min(39, Math.round((skills[name] || {}).avg || 10)))
    const isHeal = (d) => /Heal/i.test(d.effect || '') || /^Restores/.test(d.tooltip1 || '')
    const scaling = (d) => role === 'healer' ? isHeal(d) : !isHeal(d)

    // rotação: ativas com dano/cura escalando com Ataque e que a maioria usa
    const rot = []
    for (const [name, d] of Object.entries(details || {})) {
      if (!d || d.type !== 'Active' || d.coef == null || !d.base) continue
      if (!scaling(d)) continue
      if (usedShare(skills[name]) < 0.5) continue
      rot.push({ name, d, cd: d.cd })
    }
    const busy = rot.filter((r) => r.cd).reduce((a, r) => a + GCD / Math.max(r.cd, GCD), 0)
    const fillers = rot.filter((r) => !r.cd)
    const freeTime = Math.max(0.15, 1 - busy) // sempre sobra um pouco para golpes básicos
    for (const r of rot) r.uses = r.cd ? 1 / Math.max(r.cd, GCD) : freeTime / GCD / fillers.length
    const perAttack = rot.reduce((a, r) => a + (r.d.coef / 100) * r.uses, 0)
    const attackNode = 3 * perAttack

    const sampleWeight = (name) => {
      const s = skills[name]
      if (!s) return 2
      const top = Math.max(...Object.values(skills).map((x) => x.avg || 0), 1)
      return 10 * usedShare(s) * Math.pow((s.avg || 0) / top, 2)
    }
    const out = {}
    for (const [name, d] of Object.entries(details || {})) {
      if (!d) {
        out[name] = { weight: round1(sampleWeight(name)), how: 'amostra' }
        continue
      }
      const inRot = rot.find((r) => r.name === name)
      if (inRot && attackNode > 0) {
        const L = lvlOf(name)
        const b = d.base // b[0] = nível 1
        const gain = b[L] != null && b[L - 1] != null ? (b[L] - b[L - 1]) * inRot.uses : 0
        out[name] = { weight: cap(gain / attackNode), how: role === 'healer' ? 'cura/s' : 'dano/s' }
        continue
      }
      if (d.type === 'Passive') {
        const a = effects(d.tooltip1)
        const b = effects(d.tooltipMax)
        const steps = Math.max(1, (d.maxLevel || 40) - 1)
        const unit = (CLASS_STAT_UNIT[cls] || {})[role] || STAT_UNIT[role] || {}
        // efeito temporário ("for 20s" ao bloquear, ao acertar...): conta metade do tempo ativo
        const uptime = /for [d.]+s/.test(d.tooltipMax || '') ? 0.5 : 1
        let w = 0
        let known = false
        const anyRole = Object.keys(b).some((k) => Object.values(STAT_UNIT).some((u) => k in u))
        for (const k of Object.keys(b)) {
          if (!(k in unit)) continue
          const per = a[k] != null ? (b[k] - a[k]) / steps : b[k] / (steps + 1)
          if (per > 0) {
            w += per * unit[k] * uptime
            known = true
          }
        }
        out[name] = known ? { weight: cap(w), how: 'efeito' } : anyRole ? { weight: 0, how: 'efeito de outro papel' } : { weight: round1(role === 'tank' ? 0.5 * sampleWeight(name) : sampleWeight(name)), how: 'amostra' }
        continue
      }
      // ativa fora da rotação ou sem dano escalável
      if (role === 'tank') {
        const e = d.effect || ''
        out[name] = { weight: /Buff|Shield|Protect/i.test(e) ? 10 : /Debuff/i.test(e) ? 4 : 3, how: 'tipo' }
      } else out[name] = { weight: round1(sampleWeight(name) * (role === 'healer' ? 0.3 : 1)), how: 'amostra' }
    }
    // DPS com participação no dano conhecida: substitui as estimativas acima
    const share = role === 'dps' && DPS_SHARE[cls]
    if (share) {
      for (const name of Object.keys(out)) {
        const cat = (details && details[name] && details[name].type) || (skills[name] || {}).cat
        const kind = cat === 'Passive' ? 'passive' : cat === 'Active' ? 'active' : null
        if (!kind) continue
        const table = share[kind]
        const listed = Object.values(table)
        const rest = (100 - listed.reduce((a, b) => a + b, 0)) / Math.max(1, SHARE_SLOTS[kind] - listed.length)
        const pct = (table[name] != null ? table[name] : rest) / 100
        const perLevel = kind === 'active' ? LEVEL_PCT + ACTIVE_BONUS_PCT : LEVEL_PCT
        const w = cap((perLevel * pct) / SKILL_FACTOR / UNIT_PCT)
        // passiva defensiva continua 0; passiva que sobe stat fica com o maior dos dois
        if (out[name].how === 'efeito de outro papel') continue
        if (out[name].how === 'efeito' && out[name].weight > w) continue
        out[name] = { weight: w, how: 'participação no dano' }
      }
    }
    return out
  }

  // Participação de cada habilidade no dano (logs de medidor, aion2tool:
  // ACTIVE/PASSIVE_SKILL_DPS_WEIGHTS). As que não aparecem dividem o resto entre
  // as 12 ativas / 10 passivas usadas. Modelo da aion2tool para nível de skill:
  //   +1 nível = +1,35% do dano da skill; ativas ganham ainda +5/+10/+15/+10% nos
  //   níveis 8/12/16/20 (40% em 20 níveis → +2% por nível, em média)
  //   o bônus de skills entra como um fator (1 + S) no dano, S ≈ 80% no endgame
  // e 1,0 de peso = 0,049% de dano (node de Ataque Adicional +3 no Global).
  const DPS_SHARE = {
    gladiator: {
      active: { 'Overhead Slam': 50, 'Rending Blow': 30, 'Ruinous Blow': 10 },
      passive: { 'Attack Preparation': 20, 'Impact Hit': 20, 'Identify Weakness': 15, 'Experienced Counterstrike': 15 },
    },
  }
  const SHARE_SLOTS = { active: 12, passive: 10 }
  const LEVEL_PCT = 1.35
  const ACTIVE_BONUS_PCT = 2
  const SKILL_FACTOR = 1.8
  const UNIT_PCT = 0.049
  const round1 = (x) => Math.round(x * 10) / 10
  // nenhuma habilidade vale mais que o melhor node dourado (35)
  const cap = (x) => round1(Math.min(35, x))

  /** Ativas-chave da classe no DPS (as que têm participação no dano conhecida). */
  const keyActives = (cls) => Object.keys((DPS_SHARE[cls] || {}).active || {})

  return { weights, effects, keyActives }
})
