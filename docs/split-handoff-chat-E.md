# Split handoff — Chat E (`applyEvent.ts`)

Status: **DONE**. Parent is under the 40KB ceiling.

## Outcome

- `server/src/state/modules/applyEvent.ts`: **759,632 → 14,519 bytes** (~14.2 KB)
- Parent keeps `applyEvent`, `replay` / `replayAsync`, and re-exports `reset` / `skip` / `unskip` / `remove`
- Event-kind cases live under `server/src/state/modules/apply-event-handlers/`
- Family dispatch: `if (applyXEvents(ctx, e)) return;` then an empty `switch` default
- `apply-event-handlers/index.ts` is named re-exports only (3.8 KB)

## Verification (this chat)

- Structure verifier: 238 distinct `e.type` labels, no leaf→parent cycles, all leaves under 40KB
- `npm run typecheck --workspace=server`: no new errors in `applyEvent.ts` / `apply-event-handlers/**`
- `npx vitest run replay applyEvent undo`: **169 files, 770 tests passed**

Pre-existing errors left for other owners (not introduced here):

- `server/src/socket/game-actions.ts(5520)` ManaPool assignability
- `server/src/state/modules/oracleIrServerZoneSync.ts(4489)` `unwrapYouDoResumeSteps`

## Scope exception

`server/tests/replay-coverage.meta.test.ts` now scans `applyEvent.ts` **and** `apply-event-handlers/*.ts` for `e.type` case bodies. Without that, the prompt-cleanup guard failed as soon as `commanderZoneChoice` moved.

## Notable extract details

- `reset` / `skip` / `unskip` / `remove` moved to `applyEventLifecycleResetHandlers.ts` so leaves can call them without importing the parent
- `require('./soulbond.js')` inside the tap/control case was remapped to `../soulbond.js`
- `activateBattlefieldAbility` (~57 KB) was split:
  - cost replay → `applyEventActivateBattlefieldAbilityCostReplay.ts` (returns `true` for the original Humble Defector case-`break`)
  - stack rebuild → `applyEventActivateBattlefieldAbilityStackReplay.ts`
  - thin wrapper + leftover `cascadeResolve` → `applyEventActivateBattlefieldAbilityEvents.ts`
- `cascadeResolve` was present in the parent at the end of this session (not in the original 226-group inventory); it is handled with the battlefield wrapper

## Do not do

- Do not edit `docs/mtg-logic-module-map.md` from this chat (user instruction)
- Do not import `applyEvent.ts` from a leaf
- Do not grow any handler already near 36–40 KB (`applyEventActivateGraveyardAbilityEvents.ts` is 38.7 KB)

## Temporary tools

Session extract/verify scripts under `tools/_tmp-applyevent-*` were deleted after the parent hit the ceiling.
