# Split handoff — chat G (`util.ts`, `turn.ts`, `combat.ts`, `undo.ts`, `oracleIrServerZoneSync.ts`)

Sole writer this session for five parents, worked strictly in the order given:

1. `server/src/socket/util.ts`
2. `server/src/state/modules/turn.ts`
3. `server/src/socket/combat.ts`
4. `server/src/socket/undo.ts` — **finished, now under the ceiling**
5. `server/src/state/modules/oracleIrServerZoneSync.ts`

No other file was edited. `resolution.ts`, `game-actions.ts`, `triggered-abilities.ts`,
`applyEvent.ts`, and `docs/mtg-logic-module-map.md` were left alone as instructed.

## Result

Sizes are working-tree bytes. `util.ts`, `turn.ts`, `combat.ts`, and
`oracleIrServerZoneSync.ts` are CRLF in the worktree; `undo.ts` is LF (that is how
it was checked out — I did not change it).

| Parent | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `socket/util.ts` | 293,088 | 269,500 | −23,588 |
| `state/modules/turn.ts` | 289,538 | 274,579 | −14,959 |
| `socket/combat.ts` | 192,010 | 165,481 | −26,529 |
| `socket/undo.ts` | 69,203 | **40,697** | −28,506 |
| `state/modules/oracleIrServerZoneSync.ts` | 286,933 | 261,789 | −25,144 |

`undo.ts` is the only one that reached the 40,960 B ceiling. The other four are
still far over and need more sessions.

New modules, all well under the ceiling, each with a `*-handlers/` internal barrel
created on extract #1 for that parent:

| File | Bytes | Cluster |
| --- | ---: | --- |
| `socket/util-handlers/manaPoolStateOperations.ts` | 13,565 | pool / persistent-pool accessors, mana retention effect detection, phase-end drain, clears, combined totals, payment validation |
| `socket/util-handlers/manaProvenanceLowerBounds.ts` | 12,878 | replay-safe lower-bound provenance for Treasure mana, creature-spell-haste mana, per-permanent-source mana, plus the derive helpers |
| `socket/util-handlers/manaColorConstants.ts` | 1,315 | `MANA_COLOR_NAMES` / `MANA_COLORS` / `MANA_COLOR_KEYS` / `getManaColorName` |
| `socket/util-handlers/index.ts` | 1,692 | internal TOC |
| `state/modules/turn-handlers/pendingDelayedTriggerDequeues.ts` | 16,266 | drains `state.pending*` delayed schedules into trigger descriptors at step boundaries (next-end-step zone changes, upkeep graveyard returns, upkeep draws, end-of-combat zone changes) |
| `state/modules/turn-handlers/index.ts` | 631 | internal TOC |
| `socket/combat-handlers/combatLegalityGates.ts` | 27,917 | "is it a creature right now" + attack/block legality predicates (devotion/vehicle/station/bestow, effective-ability lookup, temporary combat restriction texts, controlled-creature gate) |
| `socket/combat-handlers/index.ts` | 649 | internal TOC |
| `socket/undo-handlers/undoBoundaryPlanning.ts` | 20,194 | semantic action counting, phase/step token normalization + ordering, boundary keys and snapshots, boundary history (persisted metadata or replay probe), smart undo counts |
| `socket/undo-handlers/undoTurnPhaseTargets.ts` | 12,120 | earlier turn/phase/step jump targets for the undo picker, display round math, historical turn-player inference, labels, dedupe, count resolver |
| `socket/undo-handlers/index.ts` | 1,396 | internal TOC |
| `state/modules/oracleIrServerZoneSync-handlers/oracleIrServerPostExecutionStateSync.ts` | 27,282 | post-execution mirroring of an IR result onto server state: graveyard→exile provenance, copy-token provenance, prepared state, linked exiles, reanimation riders, at-next-end-step token sacrifice/exile, impulse-exile pending draws, temporary abilities, temporary P/T mods |
| `state/modules/oracleIrServerZoneSync-handlers/index.ts` | 1,149 | internal TOC |

## Wiring

Every parent stays the public/compatibility path. No leaf imports its parent or the
barrel that re-exports it.

`util.ts` re-exports the mana symbols so `./util.js` is unchanged for every caller:

```ts
export {
  MANA_COLOR_NAMES, MANA_COLORS, MANA_COLOR_KEYS, getManaColorName,
  getOrInitManaPool, getOrInitPersistentManaPool, detectManaRetentionEffects,
  addPersistentMana, processManaDrain, clearManaPool, clearPersistentManaPool,
  clearAllManaPools, getTotalManaPool, calculateTotalAvailableMana, validateManaPayment,
  /* ...provenance lower-bound helpers... */
} from "./util-handlers/index.js";
```

`undo.ts` keeps the two symbols tests and the client flow import by name:

```ts
export { countSemanticActions, listUndoTurnPhaseTargets } from "./undo-handlers/index.js";
export type { UndoTurnPhaseTarget } from "./undo-handlers/index.js";
```

`turn.ts`, `combat.ts`, and `oracleIrServerZoneSync.ts` clusters were module-private,
so those parents just import their leaves — nothing new is re-exported.

Sibling → sibling edges that matter:

- `manaProvenanceLowerBounds.ts` imports `getOrInitManaPool` from
  `manaPoolStateOperations.ts`, which is why the pool cluster was extracted first.
- `undoTurnPhaseTargets.ts` imports from `undoBoundaryPlanning.ts` (boundary keys,
  history, token normalization, `buildUndoBoundaryPreview`), same reason.

Imports removed from parents because the cluster took the only caller:
`copyAsEntersCopiableChoicesFromSource`, `clearPreparedPermanent`,
`setPermanentPrepared`, `getNextEndStepFireTurnNumber`, `registerLinkedExile`
(all from `oracleIrServerZoneSync.ts`), and `createContext` / `replay as replayOnContext`
(from `undo.ts`).

## Verification

- Re-read every new and changed import line plus neighbors in both files after each
  cluster. No CRLF junk, no merged lines, no partial replacements. All new files
  normalized to CRLF to match the repo; verified byte-level with a lone-LF scan.
- `npx tsc -p server/tsconfig.json --noEmit` after every cluster. Zero errors in any
  file I touched.
- Targeted vitest per cluster, all green. For the last two parents: 55 undo tests
  (`undo-semantic-counts`, `undo.authorization`, `undo.broadcast-suppression`,
  `undo.replay`, `ai.undo-pregame-recovery`, `stale-optional-trigger-replay.undo`,
  `commander-cz-candidates-undo-ghost`) and 203 zonesync-relevant tests across
  temporary P/T mods, temporary effects replay, linked exile, morophon/helm copy,
  playable-from-exile lifecycle, exiled-with-source, blitz, prepared (primary +
  socket + cast), IR trigger/spell primary defaults, myrel token replay, cryptoplasm,
  trigger-copy-permanent, station charge counters, compound resume, and the replay
  divergence guardrail.

### Failures that are not mine

Three failures were observed and each traced to another chat's in-flight work:

1. `game-actions.ts` — `TS2345: Argument of type 'ManaPool' is not assignable to
   parameter of type 'Record<string, number>'`. Pre-existing at HEAD, another chat's
   file. Its reported line number drifted several times during the session as that
   chat edited around it.
2. `oracleIrServerZoneSync.ts(4489)` — `TS2304: Cannot find name
   'unwrapYouDoResumeSteps'`. **Pre-existing at HEAD**, committed that way; the
   symbol is exported from `oracleIrServerPromptResumeUtils.ts` but never imported
   into `oracleIrServerZoneSync.ts`. I deliberately did not fix it — a one-line
   import is not a split diff, and the broken line is nowhere near my cluster. The
   line moved 4483 → 4489 purely because my import block is six lines longer.
   Whoever owns the prompt-resume work should add the import.
3. `npm run test:oracle-ir-migration` aborts on
   `tests/thanos-odd-even-destroy.socket.integration.test.ts` with
   `ReferenceError: namedPtAndKeyword is not defined` thrown from
   `rules-engine/src/oracleIRParserPostprocessResidualEntryAndPermissionGuards.ts:90`.
   That file is a brand-new untracked extract from another chat splitting
   `oracleIRParserPostprocess.ts`, and the variable did not travel with the block.
   Nothing in rules-engine was touched here. The migration gate cannot go green
   until that chat finishes; I substituted the 203-test zonesync sweep above.

Earlier in the session two mana/interaction tests failed once and passed on re-run
while another chat was mid-write on `interaction.ts`. Expect this kind of flake
whenever several writers are active; re-run before investigating.

## What is left, per parent

### `socket/util.ts` (269,500 B)

The mana domain still owns most of the file. Next clusters, cheapest first:

1. `calculateManaProduction` and its helpers. I skipped it because it reaches back
   into a lot of `util.ts` state; it will need a small deps seam or a second pass
   after the restricted-mana cluster moves.
2. The "restricted mana" cluster (restrictions, `canSpendRestrictedMana`, filters).
   It depends on `getOrInitManaPool`, which now lives in
   `manaPoolStateOperations.ts`, so the cycle risk that blocked me is gone.
3. `payManaCostWithAvailableSources` and the auto-tap search — large, and imported
   by `oracleIrServerZoneSync.ts`, so the parent must keep re-exporting it.

### `state/modules/turn.ts` (274,579 B)

The remaining bulk is `nextStep()` and the per-step bodies it calls. The dequeue
helpers I moved were the easy self-contained piece. Recommended: peel one step's
body at a time (untap, upkeep, draw, cleanup) into
`turn-handlers/turnStep<Name>.ts`, keeping `nextStep()` as the dispatcher.

### `socket/combat.ts` (165,481 B)

`combatLegalityGates.ts` took the pure predicate layer. Next: combat damage
assignment / ordering, then the `socket.on("declareAttackers")` and
`declareBlockers` bodies (move each to
`export function handleDeclareAttackers(io, socket, payload)` in a leaf and leave a
one-line `socket.on` in the parent).

### `socket/undo.ts` (40,697 B) — done

Under the ceiling with ~260 B of headroom, so treat it as full: any further addition
needs a new `undo-handlers/` sibling, not a line in the parent. The obvious next
cluster if it grows is `performUndo` + `emitUndoCountsUpdate` +
`resumePregameAIFlowAfterUndo` → `undoPerformAndRestore.ts` (~10 KB), which would
leave the parent as approval bookkeeping plus `registerUndoHandlers`.

### `state/modules/oracleIrServerZoneSync.ts` (261,789 B)

Still the largest problem in `state/modules`. Structure of what remains:

| Range (current lines) | What |
| --- | --- |
| ~6170–6696 | `applyOracleIRStepsOnServer` — the orchestrator, calls everything |
| ~4260–4820 | `queueOptionalStepChoicePromptsFromOracleIRResult` + unless-pay queuing |
| ~4820–6170 | the `resume*FromResolution` / `maybeApplyOracleIrChoiceStepFromResolution` family and any-player-may payment selection |
| ~700–4260 | the ~40 `queue*ChoicePromptsFromOracleIRResult` builders |

The `queue*ChoicePromptsFromOracleIRResult` builders are the best target: they are
uniform, mostly independent, and group naturally (sacrifice/discard/proliferate,
library search + look-choose + choose-pile, vote/join-forces, tap-untap/tap-matching,
mana/counter distribution, move-zone). Each group is 10–30 KB. Take them in batches
of one group per session and the file drops fast without touching the orchestrator.

## Notes for whoever picks this up

- Three comment lines carried into `undo-handlers/undoBoundaryPlanning.ts` contain
  pre-existing mojibake (`â€”` where an em dash was intended). I copied them
  byte-for-byte rather than "fixing" them, since a split diff should not change
  bytes. Clean them in a separate cosmetic pass if you want.
- `docs/mtg-logic-module-map.md` was not edited, per instructions. All thirteen new
  modules above still need rows there.
- `server/src/socket/undo.ts` is LF in the worktree while its siblings are CRLF.
  Git normalizes to LF in the index either way, so this is cosmetic, but do not
  "fix" it in a behavior diff.
