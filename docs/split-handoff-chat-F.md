# Split handoff — chat F (`socket/interaction.ts`)

Scope owned this session: `server/src/socket/interaction.ts` and
`server/src/socket/interaction-handlers/**`. `server/src/socket/ai.ts` was in
scope only after interaction was exhausted — it was **not reached** and is
untouched, so `ai-handlers/` does not exist yet.

## Result

`interaction.ts`: **636,613 B → 558,052 B** (−78,561 B, −12.3%; 14,743 → 12,771
lines). Still far over the 40,960 B ceiling — see "What is left" below.

Six new modules under `server/src/socket/interaction-handlers/`, all well under
the ceiling, plus the internal barrel created on extract #1:

| File | Bytes | Cluster |
| --- | --- | --- |
| `interactionGraveyardCastCostAndTimingRules.ts` | 21,310 | flashback/jump-start/retrace/escape/disturb cost parsing, resource validation, sorcery-speed + activation-timing guards, live-graveyard bookkeeping |
| `interactionGraveyardSpellCastTargeting.ts` | 21,080 | graveyard-cast stack card (incl. disturb back face), aura enchant restrictions, valid-target enumeration, `TARGET_SELECTION` queuing |
| `interactionTutorSearchCriteriaParsing.ts` | 19,107 | `detectTutorEffect`, `parseSearchCriteria`, `getUpgradedCreatureTypes`, creature-type regex tables, `TutorInfo` |
| `interactionManaAbilityActivationShape.ts` | 16,966 | `resolveManaAbilityActivationShape` + ability scoring, explicit "add N mana" parsing, chosen-color override, any-color bonus mana queuing |
| `interactionCyclingActivationDefinitions.ts` | 4,773 | cycling / typecycling keyword lines → activation definitions |
| `interactionActivationEventPersistence.ts` | 3,677 | `activateBattlefieldAbility` / `activateGraveyardAbility` replay-event persistence, mana-pool snapshot/delta |
| `index.ts` | 2,481 | internal TOC, named re-exports only |

## Wiring

`interaction.ts` stays the public/compatibility barrel. It imports each leaf and
re-exports the three symbols other modules and tests import by name:

```ts
export { detectTutorEffect, parseSearchCriteria };
export type { TutorInfo };
export { resolveManaAbilityActivationShape };
```

So `applyEvent.ts`, `game-actions.ts`, `resolution.ts`, and every
`from '../src/socket/interaction.js'` test import is unchanged. No leaf imports
`interaction.ts` or `interaction-handlers/index.ts`.
`interactionGraveyardSpellCastTargeting.ts` imports
`interactionActivationEventPersistence.ts` directly (sibling → sibling), which is
why the persistence helpers were extracted first.

`registerInteractionHandlers` and `continueCastFromGraveyardAbility` /
`finalizeGraveyardSpellCast` / `queueCounterTargetStepForBattlefieldAbility` /
`getActivatedAbilityScopeText` / `buildActivatedAbilityOracleTextForStack` /
`parseTapUntapAbilityText` are still defined in the parent.

## Verification

- Re-read every new/changed import line plus neighbors in both files after each
  cluster: no CRLF junk, no merged lines. All new files normalized to CRLF to
  match the repo.
- `npx tsc -p server/tsconfig.json --noEmit` after every cluster. Zero errors in
  `interaction*`. Two errors remain that are **pre-existing at HEAD** and belong
  to other chats' files: `game-actions.ts` `ManaPool` → `Record<string, number>`,
  and `oracleIrServerZoneSync.ts` `Cannot find name 'unwrapYouDoResumeSteps'`.
- Targeted vitest per cluster, all green: tutor/search (17), mana ability (23),
  graveyard cast (131), graveyard + battlefield activation (163), cycling +
  activation (28), wider interaction sweep (86).
- One `exert-activation-cost` failure appeared mid-session and did **not**
  reproduce. Isolated it by swapping in HEAD's `interaction.ts` and back: both
  passed on re-run. It was a race with another chat writing `resolution.ts`
  during the vitest run, not this extract. Worth knowing if you see flaky
  failures while several writers are active.

## What is left in `interaction.ts` (next chat, in priority order)

The remaining bulk is **not** top-level helpers — it is
`registerInteractionHandlers` (starts line 1793, runs to EOF) and one enormous
`socket.on` body inside it:

| Range (current lines) | Bytes | What |
| --- | --- | --- |
| ~4126–12381 | ~363 KB | **one single `socket.on` handler** (battlefield ability activation). This is the whole problem. |
| ~2092–3001 | ~37 KB | `socket.on` handler |
| ~3036–3665 | ~29 KB | `socket.on` handler |
| ~1191–1790 | ~28 KB | `finalizeGraveyardSpellCast` + `continueCastFromGraveyardAbility` + encore token helpers |
| ~147–1190 | ~40 KB | remaining top-level helpers (hideaway, station thresholds, special-land table, tap/untap parsing, counter targets, activated-ability text extraction) |

Recommended next clusters, cheapest first:

1. `finalizeGraveyardSpellCast` + `continueCastFromGraveyardAbility` +
   `getNextEndStepFireTurnNumber` / `getEncoreTargetPlayerIds` /
   `createEncoreToken` → `interactionGraveyardCastExecution.ts`. Both are already
   exported and imported by `resolution.ts` and three
   `resolution*GraveyardSelection*` / `resolutionDiscardActivationResumeHandlers`
   modules, so the parent must keep re-exporting them. They already call the
   cost/targeting leaves extracted this session, so the dependency direction is
   right. Split apply vs. resume if it would exceed 40 KB.
2. The `SPECIAL_LAND_ABILITIES` table + hideaway evaluation
   (`evaluateHideawayActivationCondition`, `WORD_TO_NUMBER`,
   `getLifePaymentForActivationCost`) → `interactionSpecialLandAndHideaway.ts`.
3. `parseTapUntapAbilityText` / `parseActivationCost` /
   `payBattlefieldAbilityManaCostOrQueue` / `buildCounterTargetValidTargets` /
   `queueCounterTargetStepForBattlefieldAbility` →
   `interactionBattlefieldAbilityCostPayment.ts`.
4. Only then attack the 363 KB `socket.on`. The pattern that works: move the
   body to `export async function handleActivateBattlefieldAbility(io, socket,
   payload)` in a leaf, leaving
   `socket.on("activateBattlefieldAbility", (payload) => handleActivateBattlefieldAbility(io, socket, payload))`
   in the parent. That only works once the helpers it closes over live in leaves
   — which is what steps 1–3 buy you. Expect several sessions; split by phase
   (validation → cost payment → queue → resolve) rather than by line count.

## Notes for whoever picks this up

- `registerInteractionHandlers` is spied on by
  `tests/ai.shared-battlefield-ability.integration.test.ts` via
  `import * as interactionModule`, so it must stay a real function declaration
  in `interaction.ts`, not a live re-export binding.
- `server/src/socket/resolution.ts.partial1` is stray and not mine; someone
  should confirm it is scratch and delete it.
- I did not touch `docs/mtg-logic-module-map.md` per instructions. The six new
  modules above still need rows there.
