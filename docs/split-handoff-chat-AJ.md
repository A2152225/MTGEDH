# Split handoff - chat AJ (mana-abilities.ts)

Parent now: **103195 B / 100.8 KB**. Still over 40960. File is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AJ.md.
Sole writer for server/src/state/modules/mana-abilities.ts and new
mana-abilities-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create mana-abilities-handlers/index.ts on extract #1. Never create
mana-abilities/ beside mana-abilities.ts. Parent is LF; keep new leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/mana-abilities.ts --min-bytes 2000

Order:
1. getManaAbilitiesForPermanent (~998-1755, 32.2 KB) plus exclusive helpers.
   After LF+header stay under 40KB; split if a dry extract would exceed.
2. getCreatureCountManaAmount (~1993-2582, 24.9 KB).
3. KNOWN_MANA_MODIFIERS (~685-932, 7.1 KB) with getExtraManaProduction if they
   form one cluster.
4. Remaining exports until parent < 40960.

Public exports stay on mana-abilities.ts (re-export from leaf).
Leaf must not import mana-abilities.ts or the index. Byte-copy --dry first.
Typecheck server. Mana-ability / devotion / creature-count mana vitest. No ts-morph.
```
