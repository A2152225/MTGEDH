# Split handoff - chat AZ (oracleIRExecutorCreatureStepUtils.ts)

Parent now: **59835 B / 58.4 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AZ.md.
Sole writer for rules-engine/src/oracleIRExecutorCreatureStepUtils.ts and new
siblings with the oracleIRExecutorCreature* prefix (same directory is OK) OR
oracleIRExecutorCreatureStepUtils-handlers/**. Prefer handlers folder on extract #1.
Never create oracleIRExecutorCreatureStepUtils/ beside the .ts.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent LF; leaves LF. Do not Read the whole parent.

Do not change appliedSteps / conditional wrapper recording.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorCreatureStepUtils.ts --min-bytes 2000

Order:
1. resolveCreatureTargetIds (~706-1112, 15.5 KB) plus exclusive helpers.
2. resolveSingleCreatureTargetId (~326-646, 12.7 KB).
3. resolveCreatureExtrema / mentor / goad / temporary P/T until parent < 40960.

Public exports stay on the parent (re-export from leaf).
Leaf must not import the parent or the index. Byte-copy --dry first.
Typecheck rules-engine. Creature-target / goad / P/T vitest. No ts-morph.
```
