# Split handoff - chat AL (state/utils.ts)

Parent now: **90993 B / 88.9 KB**. Still over 40960. File is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AL.md.
Sole writer for server/src/state/utils.ts and new utils-handlers/** under
server/src/state/ (that is server/src/state/utils-handlers/, not
socket/util-handlers/).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create utils-handlers/index.ts on extract #1. Never create utils/ beside
utils.ts. Parent is LF; keep new leaves LF. Do not Read the whole parent.
Do not touch server/src/socket/util.ts.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/utils.ts --min-bytes 2000

Order:
1. calculateVariablePT (~650-1132, 18.7 KB) plus exclusive parse helpers.
2. calculateAllPTBonuses (~1201-1414, 8.9 KB) then
   calculateAllPTBonusesWithSources / calculateEquipmentBonusWithSources.
3. applyLifeGain + triggerLifeGainEffects (~258-610, ~15.9 KB) with
   PAY_X_LIFE_CARDS if exclusive.
4. Remaining until parent < 40960.

Public exports stay on utils.ts (re-export from leaf).
Leaf must not import utils.ts or the index. Byte-copy --dry first.
Typecheck server. P/T bonus / life-gain vitest. No ts-morph.
```
