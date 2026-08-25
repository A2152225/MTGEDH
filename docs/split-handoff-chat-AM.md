# Split handoff - chat AM (replacementEffectSpec.ts)

Parent now: **89853 B / 87.7 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AM.md.
Sole writer for server/src/state/modules/replacementEffectSpec.ts and new
replacementEffectSpec-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create replacementEffectSpec-handlers/index.ts on extract #1. Never create
replacementEffectSpec/ beside replacementEffectSpec.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Many small template tables. Extract contiguous domain families, not helpers.ts.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/replacementEffectSpec.ts --min-bytes 2000

Order:
1. Oracle template const clusters by kind: life-gain, counters, library-search,
   damage (each 2.7–4.0 KB plus their collect/overlay functions).
2. overlaySpecsMatchDamage (~4.1 KB) with the damage family if they fit under 40KB.
3. evaluateReplacementEffectSpec (~2116-2376, 8.7 KB) last if still needed for ceiling.
4. Remaining collect/detect exports until parent < 40960.

Public exports stay on replacementEffectSpec.ts (re-export from leaf).
Leaf must not import replacementEffectSpec.ts or the index. Byte-copy --dry first.
Typecheck server. Replacement-effect / mill-replacement vitest. No ts-morph.
```
