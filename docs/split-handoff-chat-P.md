# Split handoff - chat P (intervening-if.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-P.md.
Sole writer for server/src/state/modules/triggers/intervening-if.ts and new siblings under triggers/.
Never add triggeredAbilitiesXxx.ts prefixes. Do not edit docs/mtg-logic-module-map.md - report the owed row.
Do not Read the whole parent (574.8 KB). Do not touch leftover triggered-abilities.ts or triggers/combat.ts (chat K).
Do not move evaluateInterveningIfClauseInternal (the elephant). Do not rename APIs or change unknown-clause fallback.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/intervening-if.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/state/modules/triggers/intervening-if.ts 51 360
  node tools/ts-cluster-range-bytes.mjs server/src/state/modules/triggers/intervening-if.ts counts=51-360

First cluster: private this-turn / count helpers near the top (~51-360): parseCountToken,
countControlledPermanents, countBasicLands, this-turn spell/life/land/ETB/died counters.
New file: triggers/intervening-if-this-turn-counts.ts. Stop before 40KB.
Parent imports what it needs. Header: origin intervening-if.ts, cluster, public entries.

Byte-copy --dry first, then write. IN->OUT from cluster-deps must stay callable from the evaluator
still in the parent (export the helpers the parent uses).

Verify: import neighbors. npm run typecheck --workspace=server. Targeted vitest for
isInterveningIfSatisfied / evaluateInterveningIfClause. Named re-export on triggers/index.ts only for
symbols that should be public. No ts-morph / _refactor_scratch.
```

## Parent

**588631 B (~574.8 KB)**. Public wrappers stay: extractInterveningIfClause*, evaluateInterveningIfClause*,
isInterveningIfSatisfied. Do not move evaluateInterveningIfClauseInternal this session.
