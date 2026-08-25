# Split handoff - chat K2 (leftover + triggers/combat.ts, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md (dual-copy) and docs/split-handoff-chat-K2.md.
CONTINUE leftover triggered-abilities.ts (now 401365 B / 392 KB) AND triggers/combat.ts (101091 B / 98.7 KB).
Keep peeling until BOTH are under 40960. Do not stop at a leaf count. Do not edit the module map. Do not touch intervening-if.ts.
Do not re-reconcile detectAttackTriggers (already in attack-detection*.ts).

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggered-abilities.ts --min-bytes 4000
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/combat.ts --min-bytes 2000

combat.ts is still OVER. Next: split combat.ts by detector family (block / beginning-of-combat /
combat-damage / attack-for-creatures) into new triggers/ siblings and re-export. Do not grow combat.ts.

Leftover still has detectBlockTriggers and many other detectors. Dual-copy grep EACH symbol before
moving. If a folder copy exists, merge leftover unique into the folder (or a new sibling) and leftover
re-exports. Do not create a third implementation.

Preferred leftover first symbol if still dual-copy: detectBlockTriggers. If already unique in leftover,
extract it to triggers/block-detection.ts (or merge into combat if that is the live copy) then leftover
re-export.

Typecheck server. Attack/block/combat-damage vitest. Exactly one export function per detector name.
No ts-morph reprint.
```
