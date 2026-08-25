# Split handoff - chat BM (triggers/turn-phases.ts)

Parent now: **46486 B / 45.4 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BM.md.
Sole writer for server/src/state/modules/triggers/turn-phases.ts and new
triggers/turn-phases-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create turn-phases-handlers/index.ts on extract #1. Never create turn-phases/
beside turn-phases.ts. Parent CRLF; leaves LF. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/turn-phases.ts --min-bytes 2000

Order:
1. detectEndStepTriggers (~112-277, 5.6 KB) plus exclusive helpers.
2. detectPrecombatMainTriggers / getPrecombatMainTriggers then postcombat.
3. detectDrawStepTriggers / getDrawStepTriggers then untap-step effects
   until parent < 40960.

Public exports stay on turn-phases.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Turn-phase / additional-draw vitest. No ts-morph.
```
