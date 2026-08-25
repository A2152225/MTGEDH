# Split wave 3 — keep peeling the same parents

I–P each did **one** cluster because the old skill said "one cluster per session". That is why
`turn.ts` is still **232.7 KB** (238328 B): Chat O moved two tiny `nextStep` wrappers
(`runTurnStepDraw` / `runTurnStepUntap`). The bulk never moved.

Current leftover on that parent (`node tools/ts-cluster-toc.mjs server/src/state/modules/turn.ts --min-bytes 3000`):

| Lines | Size | Symbol |
| --- | --- | --- |
| 1673-2708 | **54.4 KB** | `dealCombatDamage` (cannot move whole) |
| 2897-3932 | **45.6 KB** | `nextTurn` (cannot move whole) |
| 4159-4949 | **40.0 KB** | `nextStep` (dispatcher + remaining combat/end bodies) |
| 930-1241 | 14.5 KB | `checkPendingInteractions` |
| 3933-4158 | 9.8 KB | `clearManaPool` |

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**. Coordinator owns
`docs/mtg-logic-module-map.md` — extract chats report the owed row.

## Rule change for this wave

Keep extracting **the same parent until it is under 40 KB**. A 4-leaf cap is not enough: 4 × ~20 KB
only moves ~80 KB, so a 233 KB `turn.ts` would still be ~150 KB and a 560 KB `intervening-if.ts`
would still be ~480 KB. Finish the file. Still one writer per parent. Byte-copy with
`node tools/extract-ts-cluster.mjs --dry` first.

A function over 40 KB is not "done" — split it by phase until **its remaining body** is also under
40 KB. Never `export` a 54 KB `dealCombatDamage` into one leaf.

Abort and hand off only if extracts become unsafe (failed `--dry`, typecheck/tests fail twice on the
same peel, mixed CRLF). Then paste leftover TOC. Do not stop on a leaf count.

## Same eight parents (continue I–P)

| Chat | Parent now | First cluster this wave |
| --- | --- | --- |
| I2 | `resolution.ts` 173.4 KB | `handleExtortPaymentResponse` then `handleMutateTargetSelectionResponse`; cores stay |
| J2 | `game-actions.ts` 477.4 KB | `shuffleHand` / `reorderHand` / `updatePermanentPos` / `setTurnDirection`; then `foretellCard`+`castForetold` |
| K2 | leftover 392 KB + `triggers/combat.ts` 98.7 KB | leftover `detectBlockTriggers` dual-copy **or** split `combat.ts` (still OVER) |
| L2 | battlefield 499.8 KB | `applyCantAttackStep` (16.6 KB) + `applyCantActivateAbilitiesStep`; do not move `applyGrantTemporaryAbilityStep` (47.5 KB) whole |
| M2 | ZoneOps 366.5 KB | `parseMoveZoneTypedCardFromAmongThem` family (~12.7 KB) then library movers |
| N2 | zoneSync 209.2 KB | sacrifice/discard/proliferate **only if** resume-free; else mana/counter `queue*` (1670-1953) |
| O2 | `turn.ts` **232.7 KB** | `checkPendingInteractions` then split `dealCombatDamage` (trigger-queue tail first) |
| P2 | `intervening-if.ts` 562.7 KB | hoist clause-family runs out of `evaluateInterveningIfClauseInternal` (510.5 KB). Do not move the whole function. |

Paste prompts: `docs/split-handoff-chat-I2.md` … `P2.md`.
