# Split handoff - chat O2 (turn.ts, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-O2.md.
CONTINUE server/src/state/modules/turn.ts (now 238328 B / 232.7 KB). This is the priority parent.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC only if you must abort. Do not edit the module map.
nextStep() stays the dispatcher. Do not Read the whole parent.
Already extracted: cleanup, upkeep, draw, untap wrappers - do not re-move.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/turn.ts --min-bytes 3000
  node tools/ts-cluster-deps.mjs server/src/state/modules/turn.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/state/modules/turn.ts pending=930-1241 damage=1673-2708 nextTurn=2897-3932 nextStep=4159-4949

Do NOT move whole: dealCombatDamage (54.4 KB), nextTurn (45.6 KB). Split those by phase.

Order:
1. checkPendingInteractions (~930-1241, 14.5 KB) -> turn-handlers/turnPendingInteractions.ts
2. clearManaPool (~3933-4158, 9.8 KB) if OUT->IN is small; else processPendingFlickerReturnsAtBeginningOfEndStep (~740-856)
3. Split dealCombatDamage: first extract the post-apply trigger-queue tail (per-attacker / defender /
   batched queues after the damage loops; search for "Replay has persisted combat damage trigger").
   New file turn-handlers/dealCombatDamageTriggerQueues.ts. Parent keeps the damage loops until they
   themselves fit under 40KB, then peel attacker-to-player vs blocker loops as the next leaf.
4. Peel nextStep combat DAMAGE / FIRST_STRIKE_DAMAGE body as runTurnStepCombatDamage - nextStep only
   dispatches. Then keep peeling remaining nextStep / nextTurn phase bodies until the parent is under 40KB.

Leaf must not import turn.ts or the index. Parent likely CRLF; leaves LF. --allow-nested for nextStep
bodies. Byte-copy --dry first. Typecheck server. Combat-damage / infect-wither / first-strike / lifelink
vitest. No ts-morph / _refactor_scratch.
```
