# Split handoff - chat K (detectAttackTriggers dual-copy)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md (dual-copy section) and docs/split-handoff-chat-K.md.
Sole writer for leftover server/src/state/modules/triggered-abilities.ts AND
server/src/state/modules/triggers/combat.ts (plus a new triggers/ sibling if needed).
Do not edit docs/mtg-logic-module-map.md - report the owed row.
Do not touch intervening-if.ts (chat P). Do not re-reconcile death / ETB / ETB-untap.

This is a MERGE, not a naive slice. extract-cluster is only for moving leftover unique into a NEW
leaf after you have chosen the live body - do not dump leftover into combat.ts (already 127.6 KB OVER).

1. Grep both export function detectAttackTriggers and all importers.
2. Inventory both spans:
     node tools/ts-cluster-toc.mjs server/src/state/modules/triggered-abilities.ts --min-bytes 4000
     node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/combat.ts --min-bytes 2000
     node tools/ts-cluster-range-bytes.mjs server/src/state/modules/triggered-abilities.ts leftover=3737-5666
3. Diff leftover vs folder. Leftover is the evolved copy for leftover-typed TriggeredAbility.
   Do not stack both regex engines.
4. Create triggers/attack-detection.ts with ONE live implementation (split the detector if the leaf
   would exceed 40KB: keyword lines vs generic whenever-attacks).
5. combat.ts re-exports that live function (combat.ts must shrink, not grow).
6. Leftover becomes export { detectAttackTriggers } from "./triggers/zone-changes.js" (match death/ETB:
   leftover -> zone-changes.js -> leaf).
7. Confirm exactly one export function detectAttackTriggers in the repo.

Leftover and new triggers/ files are LF. Typecheck server. Targeted vitest: attack-keyword,
attack-emitter-parity, attack-trigger mana payment, goad, exalted/battle-cry/mentor.
Named re-export on triggers/index.ts. No third implementation. No ts-morph reprint.
```

## Required method

Merge leftover unique into a **new** `triggers/attack-detection.ts`. `combat.ts` re-exports.
Leftover re-exports through `zone-changes.js`. One `export function detectAttackTriggers`.
