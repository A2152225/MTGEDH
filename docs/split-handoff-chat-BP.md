# Split handoff - chat BP (upkeep-triggers.ts)

Parent now: **44502 B / 43.5 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BP.md.
Sole writer for server/src/state/modules/upkeep-triggers.ts and new
upkeep-triggers-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create upkeep-triggers-handlers/index.ts on extract #1. Never create
upkeep-triggers/ beside upkeep-triggers.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/upkeep-triggers.ts --min-bytes 2000

Order:
1. detectUpkeepTriggers (~207-711, 18.9 KB) plus exclusive helpers it closes over.
   Keep a thin dispatcher in the parent if leftover still needs to call it.
2. getUpkeepTriggersForPlayer then autoProcessCumulativeUpkeepMana
   until parent < 40960.

Public exports stay on upkeep-triggers.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Upkeep-trigger vitest. No ts-morph.
```
