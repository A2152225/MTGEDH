# Split handoff - chat K3 (triggers/combat.ts only)

Leftover `triggered-abilities.ts` is **done** (36693 B / 35.8 KB). Do not peel it further unless a dual-copy merge requires a leftover re-export tweak.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md (dual-copy) and docs/split-handoff-chat-K3.md.
SOLE parent: server/src/state/modules/triggers/combat.ts (now 93260 B / 91.1 KB, CRLF).
Keep peeling until combat.ts is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Do not touch leftover triggered-abilities.ts except to add a re-export if a dual-copy merge needs it.
Do not touch intervening-if.ts. Do not re-reconcile detectAttackTriggers / detectDeathTriggers / detectETBTriggers.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/combat.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/state/modules/triggers/combat.ts START END

Grep export function NAME in both combat.ts and triggers/*.ts BEFORE every peel.
If a leaf already has the live body, delete the combat copy and re-export - do not create a third implementation.

Order:
1. Extract isEnchantedByAuraYouControl (~954) to triggers/enchanted-by-aura.ts FIRST.
   attack-triggers-for-creatures.ts currently imports it from combat.ts. After the helper
   leaf exists, point that import at the leaf. Then combat.ts must not import
   attack-triggers-for-creatures.ts until the helper is gone from combat (cycle).
2. Dual-copy merge: leftover live getAttackTriggersForCreatures is
   triggers/attack-triggers-for-creatures.ts. combat.ts still has a second body (~1446-1658,
   8.7 KB). Delete combat's body and re-export from the leaf. Same for
   detectAttachmentAttackTriggers if attachment-attack-detection.ts is already live.
3. Unique combat clusters (TOC): detectTriggerDoublers (12.1 KB), applyTriggerDoublers (9.4 KB),
   pushTriggerDoublerCopies (5.0 KB) -> triggers/trigger-doublers.ts (split if the leaf would
   exceed 40KB). Then planAttackWatcherQueue, detectBeginningOfCombatTriggers /
   getBeginningOfCombatTriggers, checkDamageReceivedTrigger, getBlockedTriggersForCreatures.
4. Keep peeling remaining combat.ts functions until the parent is under 40960.

Leaves must not import leftover triggered-abilities.ts or triggers/index.ts.
New triggers/ files are LF; parent is CRLF. Byte-copy --dry first.
Typecheck server. Attack / block / combat-damage / goad vitest.
Exactly one export function per detector name. No ts-morph reprint.
```
