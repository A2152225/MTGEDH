# Split handoff - chat AE (game-state-effects.ts)

Parent now: **139523 B / 136.3 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AE.md.
Sole writer for server/src/state/modules/game-state-effects.ts and new
game-state-effects-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create game-state-effects-handlers/index.ts on extract #1. Never create
game-state-effects/ beside game-state-effects.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

No single elephant function — many small exports. Extract contiguous domain
families, not a junk-drawer helpers.ts.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/game-state-effects.ts --min-bytes 1800
  node tools/ts-cluster-range-bytes.mjs server/src/state/modules/game-state-effects.ts
    win=499-1032 lands=1164-1595 top=1614-2336 mill=2750-3471

Order:
1. Win / lose / cant-lose cluster (~499-1032, 16.9 KB) including WIN_CONDITIONS.
2. Additional land-play / draw (~1164-1595, 20.4 KB).
3. Top-of-library / canCastFromTop / recalculatePlayerEffects (~1614-2336, 27.0 KB).
4. Mill + damage replacements (~2750-3471, 25.4 KB) including
   applyCombatDamageReplacement / applyBeneficialReplacements.
5. Remaining gaps (imports-adjacent helpers, calculateModifiedDamage,
   applyReplacementsCustomOrder, trailing exports) until parent < 40960.

Public exports stay on game-state-effects.ts (re-export from leaf).
Leaf must not import game-state-effects.ts or the index. Byte-copy --dry first.
Typecheck server. Win-condition / mill-replacement / land-play vitest. No ts-morph.
```
