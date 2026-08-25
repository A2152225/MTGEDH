# Split handoff — Chat H (Campaign 5: executor handlers, then client)

Scope for this chat, in order:
`oracleIRExecutorMoveZoneStepHandlers.ts` → `oracleIRExecutorBattlefieldStepHandlers.ts` →
`oracleIRExecutorZoneOps.ts` → `oracleIRExecutorPlayerStepHandlers.ts` → MainLoop / conditional /
SpecialTarget / Token → `server/src/state/planeswalker/templates/resolve.ts` (+ `registry.ts` only if
required) → `client/src/utils/activatedAbilityParser.ts` → `loopShortcuts.ts` → `client/src/App.tsx`
game-dispatch only.

Per the plan, Oracle IR keeps flat `oracleIRExecutor*` prefixes — no `*-handlers/` folder or internal
index barrel until a parent is already a thin barrel.

## Baseline notes (important for anyone reading test output)

- `npm run typecheck --workspace=rules-engine` compiles server sources too. Errors in
  `server/src/socket/*` and `server/src/state/modules/*` come from Chats A/D/F/G mid-extract. The gate
  used here is "no new `rules-engine/src` errors".
- `npx vitest run` in `rules-engine`: **10 pre-existing failures in `test/oracleIRExecutor.test.ts`**
  (Wizard's Spellbook branches, Isochron Scepter, Narset, plural battlefield tutors,
  `target_opponent`/`each_opponent` with an invalid controller). Verified pre-existing against the
  pristine parent. Everything else green (472 of 473 files).
- Concurrent chats intermittently leave `server/src/socket/resolution.ts` or
  `oracleIRParserPostprocess*.ts` syntactically broken, which makes vitest report a *transform* error
  and hundreds of files "failed". That is external noise — re-run once the other chat lands.

## Result for `oracleIRExecutorMoveZoneStepHandlers.ts`

**696022 B → 128443 B (~125 KB), a 82% reduction.** 29 sibling modules, every one under 40 KB.
The file no longer appears near the top of `node tools/ts-logic-file-sizes.mjs`. It is still over the
ceiling, so it is not done — see "Remaining work" below.

## The shape of this file, and the technique that worked

`applyMoveZoneStep` was ~580 KB of a single function: a **flat chain of ~966 depth-1 statements**,
almost all of the form

```ts
const parsedFoo = parseMoveZoneFoo(step.what as any);   // ~366 of these, up front
...
if (parsedFoo) { /* 100-600 B */ return finalizeAppliedResult(result); }
```

No single block was big enough to matter (largest was 24 KB), so extraction had to move **contiguous
runs** of blocks. Two moves made that safe without touching a single line of guard logic:

1. **The parse prologue returns an object; the parent destructures it.** All 266 `const parsedX = ...`
   declarations moved into two modules that `return { parsedX, ... }`. The parent does
   `const { parsedX, ... } = zoneQueries;`, so every downstream reference to a bare `parsedX` still
   resolves to the same name with the same inferred type. No renames anywhere.
2. **Guard chains take one args bundle and re-bind the names by destructuring.** Each extracted chain
   is `export function tryApplyMoveZoneGuardsFromX(args: MoveZoneGuardArgs)`, whose first lines are
   `const { step, ctx, nextState, log, ... } = args;` plus
   `const { parsedA, parsedB } = args.zoneQueries;`. The guard bodies are then **byte-identical** to
   what was in the parent. The parent calls them as
   `const r = tryApplyMoveZoneGuardsFromX(bundle); if (r) return r;`.

### Why `if (r) return r` is behavior-preserving here

`applyMoveZoneStep` is declared `: MoveZoneStepHandlerResult` (non-optional), and both members of that
union are objects, so **every** top-level `return` in the function yields a truthy value. A guard that
falls through returns `undefined` from the helper and the parent continues, exactly as before.

### The one real hazard, and how it surfaced

A guard that **rebinds an outer local** (`nextState = result.state`) and then falls through would
break. TypeScript catches this for free: in the helper those locals are destructured `const`, so any
assignment is a compile error. That is exactly how the one bad extract was caught —
`GuardsTargetCountFromGraveyard.ts` had three `nextState = result.state` inside per-opponent loops.
Each of those three guards assigns inside a `for` loop and then **returns unconditionally**, so the
caller can never observe the intermediate state; the fix was to destructure everything else and add
`let nextState = args.nextState;` with a comment saying why. Verify that "always returns" property by
hand before applying this fix anywhere else.

Mutations that are *not* a hazard: `log.push(...)` (same array object is passed in by reference) and
in-place mutation of `state` / `nextState` properties (same object).

## Modules created (all under 40 KB)

Selector parsing (the prologue):

- `oracleIRExecutorMoveZoneWhatParsersZoneQueries.ts` — zone / target / count selectors.
- `oracleIRExecutorMoveZoneWhatParsersReferenceQueries.ts` — contextual references, revealed/chosen/
  milled cards, per-player zones.
- Each exports `MoveZoneWhat*Queries = ReturnType<typeof parse...>`.

Shared plumbing:

- `oracleIRExecutorMoveZoneGuardArgs.ts` — `MoveZoneGuardArgs`, `MoveZoneFinalizeAppliedResult`,
  `buildMoveZoneBattlefieldEntryOverrides` (moved out of the parent so the overrides object has a
  nameable inferred type).
- `oracleIRExecutorMoveZoneStepTypes.ts`, `...ReferenceResolvers.ts`, `...ContextualCardResolvers.ts`,
  `...StepResultBuilders.ts`, `...LinkedExileProjection.ts`, `...PermanentSelectors.ts`,
  `...EarlyGuardSteps.ts`, `...LibraryPlacementChoice.ts` (earlier clusters).

Guard chains, each `oracleIRExecutorMoveZoneGuards<FirstSelector>.ts`, named after the first selector
they test: `CommandZonePermanent`, `UpToCountTotalMvFromYourGraveyard`, `AnyNumberCreaturesTotalPower`,
`NonlandCardFromIt`, `UpToFromSingleGraveyard`, `ThatCardReference`,
`CompoundExileItAndEachPlayerReturnGyCreatures`, `TypedCardsRevealedThisWay`, `TheRestToGraveyard`,
`BothCards`, `ExileGySplitTwoPiles`, `SingleTargetFromTargetPlayerExile`, `TargetCountFromGraveyard`,
`ThisPermanentAndTheExiledCard`, `AnotherFromGraveyard`, `ThatPile`, `AnyNumberFromYourHandFaceDown`,
`FromGraveyard`.

Public API unchanged: the parent still exports `applyMoveZoneStep` and re-exports
`MoveZoneStepHandlerResult`; `oracleIRExecutorMainLoop.ts` is the only importer.

## Remaining work on this file (~125 KB)

Three extractable runs are left in `applyMoveZoneStep`. All three need locals that are **not** yet in
`MoveZoneGuardArgs`, which is the only reason they were not done:

| Run | Size | Extra locals needed beyond the bundle |
| --- | --- | --- |
| head of the chain, starts `if (parsedOneOfThemSplit)` | ~40 KB | `parsedOneOfThemSplit`, `parsedOnePileSplit`, `contextualBoundCardZone`, `sourceCardZone`, `whatText`, `contextualBoundCardIds`, `topCardLibraryOwnerId`, `bottomCardLibraryOwnerId` |
| second `if (parsedOneOfThemSplit)` chain | ~29 KB | same first four |
| `finalizeAppliedResult` prologue | ~19 KB | closes over the mutable `nextState` / `effectiveBattlefieldAdd*`, so it cannot move as-is |

Add those to `MoveZoneGuardArgs` (note `contextualBoundCardIds` is a `let` in the parent — check
nothing writes it) and the first two runs extract with the same script. The third needs the
accumulator rethought and should probably be left alone.

## Traps for the next chat

- **Never pass a hard-coded function-start line to an analysis script.** Doing so is what produced the
  one bad extract: the parent shrank, `applyMoveZoneStep` moved from line 216 to 188, and the stale
  start line hid the `let nextState` / `const log` declarations, so every block that wrote them looked
  extractable. The tooling now derives the start from the `export function` line.
- After each extraction the line numbers move; re-run the run-finder before every cut.
- A run reported by the finder can extend **past the end of the guard chain** into the function tail.
  One cut swallowed the final `return { applied: false, ... }` and the `} finally { setActiveMoveZoneStep(undefined); }`.
  Check the last lines of the proposed range against the parent's tail.
- The `try {` in `applyMoveZoneStep` is not indented relative to its body, so the closing
  `} finally {` sits at 2-space indent and looks like a depth-1 statement to naive scanners.

## Tooling left in place for the next chat

Seven scratch scripts under `tools/`, kept because they encode the safety gates described above and
the next cut needs all of them. Delete them when Campaign 5 is finished.

- `_tmp-chatH-guard-runs.mjs <file> [minKB]` — finds contiguous extractable runs. Derives the function
  start itself. Reports each run's byte size, escaping declarations, and suspicious returns.
- `_tmp-chatH-plan-guard-args.mjs <from> <to>` — splits a range's outer reads into `zoneQueries`,
  `referenceQueries`, and plain locals, i.e. tells you what must be in `MoveZoneGuardArgs`.
- `_tmp-chatH-escapes.mjs <file> <from> <to>` — declarations inside a range still read after it, so you
  can pick a range that avoids them.
- `_tmp-chatH-extract-guard-chain.mjs <from> <to> <partCount>` — does the cut: writes the sibling
  modules, rewrites the parent, drops now-unused imports. Aborts unless every part starts with a guard,
  nothing declared inside escapes or crosses a part boundary, and every dropped import symbol owns its
  own line. When it aborts on "import symbol X has 0 dedicated lines", expand that single-line
  `import { a, b }` into a multi-line list in the parent and re-run.
- `_tmp-chatH-split-points.mjs`, `_tmp-chatH-list-blocks.mjs`, `_tmp-chatH-range-bytes.mjs` — sizing and
  table-of-contents helpers.

The extract script leaves two cosmetic things to fix by hand: a part whose first line has no `parsed*`
identifier gets named `...GuardsChain.ts` (rename it after its real first selector), and the generated
`guardArgs<Suffix>` / `guardResult<Suffix>N` locals can be long enough to be worth shortening.

## Not started

`oracleIRExecutorBattlefieldStepHandlers.ts` (558 KB) is next in the plan order, then
`oracleIRExecutorZoneOps.ts`, then `oracleIRExecutorPlayerStepHandlers.ts`. A quick look suggests
`ZoneOps` is mostly independent exported parsers and would split far more cheaply than either handler
file — but the plan order puts Battlefield first.
