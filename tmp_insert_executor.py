f = r'd:\Git\MTGEDH\rules-engine\src\oracleIRExecutor.ts'
with open(f, 'r', encoding='utf-8') as fh:
    lines = fh.readlines()

print(f'Total lines before: {len(lines)}')

# ── Block C3: Difference between those players' life totals (insert at 0-idx 4131) ──
c3 = [
  "  // \u2500\u2500 Difference between those players\u2019 life totals \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n",
  "  {\n",
  "    const m = raw.match(/^x is the difference between those players['\u2019] life totals?$/i);\n",
  "    if (m) {\n",
  "      const ids: readonly string[] = Array.isArray(ctx?.selectorContext?.eachOfThoseOpponents)\n",
  "        ? (ctx?.selectorContext?.eachOfThoseOpponents || []).map(id => String(id || '').trim()).filter(Boolean)\n",
  "        : [];\n",
  "      if (ids.length < 2) return null;\n",
  "\n",
  "      const lifes: number[] = [];\n",
  "      for (const pid of ids.slice(0, 2)) {\n",
  "        const player = (state.players || []).find((p: any) => String((p as any)?.id || '').trim() === pid) as any;\n",
  "        if (!player) return null;\n",
  "        const life = Number(player?.life ?? player?.lifeTotal ?? 0);\n",
  "        if (!Number.isFinite(life)) return null;\n",
  "        lifes.push(life);\n",
  "      }\n",
  "      if (lifes.length < 2) return null;\n",
  "      return Math.abs(lifes[0] - lifes[1]);\n",
  "    }\n",
  "  }\n",
  "\n",
]

# ── Block C2: Named-source exile count (insert at 0-idx 3874) ──
c2 = [
  "  // \u2500\u2500 Cards exiled by a named permanent \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n",
  "  {\n",
  "    const m = raw.match(/^x is the number of cards? exiled with (?!this\\b)([a-z][a-z0-9 ,.'\\u2019-]*)$/i);\n",
  "    if (m) {\n",
  "      const wantedName = normalizeOracleText(String(m[1] || ''));\n",
  "      if (!wantedName) return null;\n",
  "      const namedPermanent = (battlefield as any[]).find((p: any) => {\n",
  "        const name = normalizeOracleText(String((p as any)?.name || (p as any)?.card?.name || ''));\n",
  "        return Boolean(name && name === wantedName);\n",
  "      });\n",
  "      const namedId = String((namedPermanent as any)?.id || '').trim();\n",
  "      if (!namedId) return null;\n",
  "\n",
  "      let count = 0;\n",
  "      for (const player of state.players as any[]) {\n",
  "        const exile = Array.isArray(player?.exile) ? player.exile : [];\n",
  "        for (const card of exile) {\n",
  "          if (String((card as any)?.exiledBy || '').trim() === namedId) count++;\n",
  "        }\n",
  "      }\n",
  "      return count;\n",
  "    }\n",
  "  }\n",
  "\n",
]

# ── Block C4: Generic mana in spell's mana cost (insert at 0-idx 3206) ──
c4 = [
  "  // \u2500\u2500 Generic (colorless numeric) mana in that spell\u2019s mana cost \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n",
  "  {\n",
  "    const m = raw.match(/^x is the amount of generic mana in (?:that|this) spell['\\u2019]?s mana cost$/i);\n",
  "    if (m) {\n",
  "      const sourceId = String(ctx?.sourceId || '').trim();\n",
  "      if (!sourceId) return null;\n",
  "      const ref = findObjectById(sourceId);\n",
  "      if (!ref) return null;\n",
  "      const manaCostStr = String(\n",
  "        (ref as any)?.manaCost ||\n",
  "        (ref as any)?.mana_cost ||\n",
  "        (ref as any)?.card?.manaCost ||\n",
  "        (ref as any)?.card?.mana_cost ||\n",
  "        ''\n",
  "      );\n",
  "      if (!manaCostStr) return 0;\n",
  "      let generic = 0;\n",
  "      for (const mt of manaCostStr.matchAll(/\\{(\\d+)\\}/g)) {\n",
  "        generic += Number(mt[1]);\n",
  "      }\n",
  "      return generic;\n",
  "    }\n",
  "  }\n",
  "\n",
]

# ── Block C1: All-players spells cast this turn (insert at 0-idx 2493) ──
c1 = [
  "  // \u2500\u2500 All-players spells cast this turn (no \u201cyou\u201d/\u201copponents\u201d qualifier) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n",
  "  {\n",
  "    const m = raw.match(/^x is the number of spells? cast this turn$/i);\n",
  "    if (m) {\n",
  "      const stateAny: any = state as any;\n",
  "\n",
  "      const fromRecordSumAll = (value: any): number | null => {\n",
  "        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;\n",
  "        return Object.values(value as Record<string, unknown>).reduce<number>((sum, amount) => {\n",
  "          const n = Number(amount);\n",
  "          return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);\n",
  "        }, 0);\n",
  "      };\n",
  "\n",
  "      const candidates: Array<number | null> = [\n",
  "        fromRecordSumAll(stateAny.spellsCastThisTurn),\n",
  "        fromRecordSumAll(stateAny.spellsCast),\n",
  "        fromRecordSumAll(stateAny.turnStats?.spellsCast),\n",
  "      ];\n",
  "\n",
  "      for (const candidate of candidates) {\n",
  "        if (candidate !== null) return candidate;\n",
  "      }\n",
  "\n",
  "      return null;\n",
  "    }\n",
  "  }\n",
  "\n",
]

# Apply insertions bottom to top to preserve indices
# Change 3: insert at 0-idx 4131
lines = lines[:4131] + c3 + lines[4131:]
# Change 2: insert at 0-idx 3874
lines = lines[:3874] + c2 + lines[3874:]
# Change 4: insert at 0-idx 3206
lines = lines[:3206] + c4 + lines[3206:]
# Change 1: insert at 0-idx 2493
lines = lines[:2493] + c1 + lines[2493:]

with open(f, 'w', encoding='utf-8', newline='') as fh:
    fh.writelines(lines)

print(f'Done. New total: {len(lines)} lines')
