# Split handoff - chat Y (combat.ts)

Parent now: **106949 B / 104.4 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-Y.md.
Sole writer for server/src/socket/combat.ts and combat-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/combat/. Parent CRLF; leaves LF.
registerCombatHandlers stays a real function.
Do NOT move whole registerCombatHandlers (~799-2503, 72.7 KB).

Already extracted (do not re-move): combatLegalityGates, combatDeclareBlockersRequest,
combatDeclareAttackersSupport (chat / defender-id / attack-trigger payment /
processAttackTriggersAfterDeclaration).

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/combat.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/combat.ts
    execute=435-798 attackers=882-1423 ctrlAtk=1720-2224 ctrlBlk=2225-2455

Order:
1. executeDeclareAttackers (~435-798, 15.2 KB) if still in parent.
2. Nested declareAttackers socket.on (~882-1423, 23.6 KB) as handleDeclareAttackers
   with --allow-nested. Same tryHandle / extract pattern as interaction.
3. declareControlledAttackers (~1720-2224, 25.5 KB) then declareControlledBlockers
   (~2225-2455, 8.3 KB). Preview / skip / applyCombatControl / clear if needed
   to finish under 40960.
4. Nested helpers still closed over by those sockets (processTapTriggersForAttackers
   4.4 KB, findForcedAttackViolation, enqueueSupportedEnlistChoiceSteps) just-in-time.

Leaf must not import combat.ts or the index. Byte-copy --dry first.
Typecheck server. Combat declare-attackers / blockers vitest. No ts-morph.
```
