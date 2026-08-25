# Split handoff — chat D (game-actions.ts)

Sole writer for: `server/src/socket/game-actions.ts` and `server/src/socket/game-actions-handlers/**`.

Campaign 0 and the green test baseline were already done before this chat; not redone here.
`docs/mtg-logic-module-map.md` is intentionally **not** edited from this chat (another writer owns it) —
the rows this chat would have added are listed under "Module map rows owed" below.

## Known pre-existing typecheck failures (not from this chat)

`npm run typecheck --workspace=server` was already red on entry, same baseline chat A recorded:

- `src/socket/game-actions.ts(…,62)` TS2345 `ManaPool` not assignable to `Record<string, number>`
  (call to `addUnselectedFloatingPoolRemainder`; line number drifts as this file shrinks)
- `src/state/modules/oracleIrServerZoneSync.ts(4483,57)` TS2304 `unwrapYouDoResumeSteps` not found

Treat those two as the baseline. Any third error is new.

## Conventions established here

- Extracted clusters live in `server/src/socket/game-actions-handlers/`, named re-exported from
  `game-actions-handlers/index.ts` (named exports only, no `export *`).
- **Never** create `server/src/socket/game-actions/` — the folder is `game-actions-handlers/`.
- `game-actions.ts` stays the public compatibility barrel: everything moved is re-exported from it with
  `export { … } from "./game-actions-handlers/…"`, so `from "./game-actions.js"` keeps working for
  `util.ts`, `resolution.ts`, `ai.ts`, `interaction.ts`, and the tests.
- Where the parent still calls a moved symbol, it *also* imports it. `export … from` does not create a
  local binding, so the parallel `import { … }` is required and does not collide.
- Leaves must not import `game-actions.ts` nor `game-actions-handlers/index.ts`. No deps-injection seam
  has been needed yet — plain leaf imports have been acyclic so far. Introduce
  `gameActionsHandlerDeps.ts` only if a real cycle appears.
- `game-actions.ts` is **CRLF**; new files in `game-actions-handlers/` are **LF** (matches the other
  extract families in this repo, and `core.autocrlf=true`).

### Extraction method (use this, it is what clusters 3–12 actually did)

Never retype a body. Cluster 1 was written by hand and then reconciled with a verify-and-cut script;
from cluster 3 on, a move script copies the parent's bytes directly, which is both faster and safer.
Per cluster:

1. Grep a TOC (`^(export )?(async )?function \w+|^(export )?(const|type|interface) \w+`) — never Read the
   whole parent. The Grep tool caps at 100 matches per call, so paginate with `offset`.
2. `node tools/_tmp-range-bytes.mjs` to size candidate ranges; split anything that would land over 40 KB.
3. `node tools/_tmp-cluster-deps.mjs` to get the import list, what the cluster reaches for outside itself,
   and what the parent must import back.
4. Read only the **boundary** lines (a few around each range start/end) to confirm doc comments and blank
   lines land on the right side of the cut. Getting this wrong is what produces doubled blank lines or an
   orphaned comment.
5. Write the move-script config and run it **dry first**, then `--apply`.
6. Wire the parent: `import { … }` for what it still calls, `export { … } from` for what was public, and a
   commented block in `game-actions-handlers/index.ts`.
7. Verify: grep the new import lines with `-B` context in both files; grep the splice seams; **grep the new
   module for `import(` / `require(` with a relative specifier** (cluster 8 lost an hour to this);
   typecheck; run targeted vitest.

Why byte-exact copying matters beyond tidiness: `calculateCostReduction` contains two literal `U+FFFD`
characters and several bodies have trailing whitespace, both of which a retyped copy silently normalises.

### Reading a red typecheck or test run while other chats are mid-extract

Several chats are splitting adjacent files at the same time, so `resolution.ts`, `undo.ts`, `combat.ts` and
`rules-engine/**` were each transiently red with dozens of TS2304 "cannot find name" errors — the signature
of a half-applied extract. Filter to your own files (`… 2>&1 | Select-String -Pattern 'game-actions'`)
rather than reading the whole list, and only treat an error as yours if it names a file you own.

Tests drift the same way, and it is easy to misread a neighbour's half-applied extract as your regression.
Concrete cases seen this session, all of which passed again later or were provably independent:

- `oracleIRParserPostprocess.ts` mid-edit → syntax error, then `namedPtAndKeyword is not defined`.
- `resolution.ts` mid-edit → `getResolutionHandlerDeps(...).tryHandleModeSelectionCastResume is not a
  function`, which failed `overload-mode-selection` twenty minutes after that same file passed here.
  A `resolution.ts.partial1` scratch file next to it is the tell.

Before blaming your extract, check whether the failing frame is in a file you own and whether the test's
import graph even reaches it.

## Progress

### Cluster 1 — spell cost reduction / cost adjustment (done)

- New: `game-actions-handlers/gameActionsCastCostReduction.ts` (31.9 KB) —
  `calculateCostReduction`, `calculateStaticSourceGenericTax`, `calculateConvokeOptions`,
  `extractCreatureTypes`, `getSharedStaticCostAdjustments`, `createEmptyCostReduction`,
  `detectBanneretTypeReduction`, and the cost metadata types (`StaticCostTaxMetadata`,
  `CostReductionMetadata`, `SpellCastSourceZone`, `PaymentStepCostAdjustment`,
  `PendingCastCostMetadata`).
- New: `game-actions-handlers/gameActionsCastCostFormatting.ts` (9.4 KB) —
  `applyCostAdjustment`, `applyCostReduction`, `countXManaSymbols`, `expandManaCostWithChosenX`,
  `formatManaCostWithCostAdjustment`, `formatManaCostWithReduction`,
  `formatSpellAlternateCostWithReduction`, `buildPaymentCostAdjustmentPayload`,
  `buildPaymentStepCostAdjustment`, `buildPendingCastCostMetadata`,
  `buildAlternateCastSpellManaCost`, `GRAVEYARD_ALTERNATE_CAST_ABILITY_IDS`,
  `isGraveyardAlternateCastAbilityId`.
- New: `game-actions-handlers/index.ts` (folder created on this extract).
- Parent also dropped imports that went dead with the cluster: `PaymentCostAdjustment`, `hasDelirium`,
  `NormalizedManaPaymentModel`, `getActiveConvokeGrantSources`, `getDynamicBattlefieldCostReduction`,
  `applySpellSelfTotalManaValueCostReduction`.
- Split into two modules because the whole family measured ~40.1 KB — one module would have started
  over the ceiling. Formatting imports Reduction; never the reverse.
- `game-actions.ts`: 834786 B → 795564 B.
- Verified: server typecheck at the 2-error baseline; `npx vitest run` green (34 tests) on
  `cost-adjustments`, `alternate-cost-spell-reduction`, `graveyard-alternate-cast-cost-reduction`,
  `metalwork-colossus-cost-reduction`, `alternate-costs-warp`, `morophon.request-cast`.

### Cluster 2 — permanent keyword / haste grants (done)

- New: `gameActionsPermanentKeywordGrants.ts` (16.2 KB) — `permanentHasSummoningSickness`,
  `creatureHasHaste`, `permanentHasKeyword`.
- Note a pre-existing divergence, deliberately **not** merged: `keyword-handlers.ts` exports a 2-arg
  `permanentHasKeyword`; this family is the 4-arg game-actions variant. Behaviour preserved as-is.
- Verified: typecheck at baseline; targeted vitest green.

### Cluster 3 — cast-spell payment sources (done)

- New: `gameActionsCastSpellPaymentSources.ts` (19.0 KB) — floating-pool keys, payment permanent
  resolution/validation, activation-cost inference for mana abilities, produced-mana totals,
  any-type mana spending, payment checkpoints, `CAST_SPELL_PAYMENT_MANA_KEYS`.
- Verified: typecheck at baseline; targeted vitest green.

### Cluster 4 — spell target selection (done)

- New: `gameActionsSpellTargetSelection.ts` (21.4 KB) — `buildSpellTargetListFromRequirements`,
  `buildGroupedSpellTargetMetadata`, `buildSpellTargetSelectionClauses`, `mapSpellTargetRefToDisplay`,
  `shouldPreferParsedTargetReqs`, `resolveTargetCount`.
- `CompletingSpellCastMarker` and the cast-lock helpers were deliberately left in the parent; they are a
  separate family that happens to sit between the two target ranges.
- Verified: typecheck at baseline; targeted vitest green.

### Cluster 5 — spell copies, heroic and cast-time triggers (done)

- New: `gameActionsSpellCopyHeroicTriggers.ts` (26.8 KB) — immediate + delayed spell copies, copy
  retargeting and its fallback, heroic triggers, targeted-permanent triggers, the spell-cast untap
  trigger, `parseCastSpellPower`, `persistQueuedSpellCastStepContinuation`.
- Verified: typecheck at baseline; targeted vitest green.

### Clusters 6a/6b — spell-cast triggers, split detect vs process (done)

The whole spell-cast trigger family measured ~42.7 KB, so it went out as two modules; processing imports
detection, never the reverse.

- New: `gameActionsSpellCastTriggerDetection.ts` (12.5 KB) — `getSpellCastTriggersForCard`,
  the once-per-turn usage-key bookkeeping, `recordSpellCastThisTurn`, `createSpellCastTriggerToken`,
  `resolveSpellCastOptionalPaymentChoice`, and `normalizeSpellCastSourceZone` (pulled forward from the
  parent's line ~302 so both new modules could share it).
- New: `gameActionsSpellCastTriggerProcessing.ts` (33.3 KB) — `processSpellCastTriggersForCast`,
  `processOpponentSpellCastTriggersForCast`: APNAP ordering, intervening-if gating, Oracle IR vs legacy
  routing, resolution-step queueing.
- Verified: typecheck at baseline; `npx vitest run` green (81 tests / 11 files) on
  `spell-cast-trigger-detection`, `spell-cast-trigger-persistence`, `spell-cast-board-context`,
  `gwenna-spell-cast-trigger`, `barracks-spell-cast`, `door-of-destinies-spell-cast`,
  `eldrazi-cast-trigger-resolution`, `luminate-per-opponent-cast`,
  `on-cast-commander-storm-depth-mindbender-vortex`,
  `opponent-cast-blue-or-black-spell-this-turn.intervening-if`, `spell-cast-copy.replay`.

### Cluster 7 — pregame readiness + permanent-entry prompts (done)

Two independent families, moved in one pass because they are adjacent and both cut cleanly (neither
references anything left behind in the parent).

- New: `gameActionsMulliganReadinessChecks.ts` (6.5 KB) — free-mulligan house rule,
  `calculateEffectiveMulliganCount`, `shouldMulliganBeFree`, `checkAllPlayersKeptHands`,
  `checkAllPlayersHaveDecks`.
- New: `gameActionsPermanentEntryPrompts.ts` (18.6 KB) — `runPostResolutionPermanentPromptChecks` and
  the passes it drives (creature type, color, player selection, enchantment ETB triggers), plus the
  self-referential battlefield tutor search.
- Verified: typecheck at baseline; `npx vitest run` green (42 tests / 13 files) on the mulligan,
  creature-type, color-choice, player-selection, as-enters and ETB-persistence suites.

### Cluster 8 — cast lock, cast face/miracle, modal mode costs (done)

Three independent families in one pass; all three cut cleanly.

- New: `gameActionsSpellCastLock.ts` (9.3 KB) — the "player is completing a cast" marker, payment-resume
  lock, timing and duplicate-stack checks, pending-cast-step lookup/restore, `processOracleIRInteractions`.
- New: `gameActionsCastFaceAndMiracleSelection.ts` (10.2 KB) — `resolveEffectiveSpellBaseManaCost`,
  miracle check + prompt, suspend cast info, card-face/adventure resolution, and
  `WUBRG_ALTERNATE_MANA_COST` (moved out of the parent's import block, where it sat as a lone const).
- New: `gameActionsModalCastModeCosts.ts` (6.9 KB) — modal mode scoping, entwine, escalate,
  additional-cost modes, overload rewriting, `appendManaCost` / `repeatManaCost`.
- **One wiring fix was required**, and this is the trap to watch for: `restoreSuspendedLibrarySearchStep`
  contains `await import('./resolution.js')`. Dynamic-import specifiers are string literals, so neither
  the dependency analyser nor a naive move rebases them — only `tsc` caught it (TS2307). It became
  `'../resolution.js'`. **Grep every extract for `import(` and `require(` with a relative specifier.**
- Verified: typecheck at baseline; `npx vitest run` green (23 tests / 10 files) on the miracle, suspend,
  adventure, overload and modal suites.

### Cluster 9 — playing a land (done)

- New: `gameActionsPlayerZoneCards.ts` (1.9 KB) — deliberately a **shared leaf**, not part of the land
  module: `getPlayerLibraryCards`, `getTopLibraryCard`, `getPlayerCommandZoneCards`,
  `getPlayerSpellSourceCards`. The land cluster and the parent both need the library accessors, and more
  clusters will. Extracting them here avoided a leaf→parent import.
- New: `gameActionsPlayLandRequest.ts` (26.5 KB) — `getRequestedLandPlayCandidate`,
  `validateTopOfLibraryLandAccess`, `handlePlayLandRequest`, `finalizePlayedLand` and the land ETB shape
  (tapped / shock / bounce / scry / conditional) plus the prompts that follow.
- Verified: typecheck at baseline; `npx vitest run` green (70 tests / 16 files) on the play-land,
  bounce-land, shock-land, conditional-land, landfall and turn-lands suites.

### Cluster 10 — the last of the top-level helper band (done)

- New: `gameActionsRequestedSpellCastCandidate.ts` (6.8 KB) — resolving a cast request to a shared
  castable-spell candidate, graveyard cast permission, free-cast/graveyard metadata stamping.
- New: `gameActionsAdditionalCastCosts.ts` (5.0 KB) — harmonize, `getEffectiveAdditionalCost`, squad,
  reveal additional cost.
- New: `gameActionsCommandZoneAndAlternateCastCosts.ts` (12.8 KB) — command zone commander candidates and
  their tax-adjusted cost, pending-cast payment fields, keyword alternate-cost payment extras (WUBRG,
  mutate, warp, sneak, web-slinging, free commander casts), library cast access.
- Verified: typecheck at baseline; `npx vitest run` green (24 tests / 11 files) on the warp, sneak,
  commander-free-cast, squad, mutate, flashback and morophon suites.

**After cluster 10 every top-level declaration in the parent has been extracted.** What remains is the
import block plus two functions — see "Remaining shape".

### Clusters 11–12 — socket handlers lifted out of `registerGameActions` (done)

This is the pattern that unlocks the rest of the file, so it is worth reading before continuing.

`registerGameActions` has only two closure-scoped declarations: `ensureInGameRoom` (closes over `socket`)
and `checkAndEmitDamageTriggers` (a pure one-line forward to `emitPendingDamageTriggers`). Everything
else a handler body touches is module scope. So a handler body can move out **unchanged** if the guard is
passed in as a parameter:

`socket.on("nextTurn", async (payload) => { …body… });`
becomes, in the parent,
`socket.on("nextTurn", (payload?: { gameId?: unknown }) => handleNextTurnRequest(io, socket, ensureInGameRoom, payload));`
and in the leaf `export async function handleNextTurnRequest(io, socket, ensureInGameRoom, payload)`.

Returning the promise (rather than `void`-ing it) keeps the original async-arrow semantics. The only
textual change to a moved body is losing exactly two spaces of indentation, which the move script asserts
is lossless. Comments above each registration are copied byte-for-byte from the parent, never retyped.

- New: `gameActionsSocketRoomGuard.ts` (0.4 KB) — the `EnsureInGameRoom` type, shared by every extracted
  handler module. This is the deps seam the rule anticipated; a full `gameActionsHandlerDeps.ts` was still
  not needed.
- New: `gameActionsTurnFlowSocketHandlers.ts` (29.6 KB) — `claimMyTurn`, `randomizeStartingPlayer`,
  `nextTurn`, `nextStep`, `skipToPhase`. 834 parent lines became 29.
  `checkAndEmitDamageTriggers` is imported here as
  `import { emitPendingDamageTriggers as checkAndEmitDamageTriggers } from "../damage-triggers.js"` —
  the alias is deliberate, so the moved call sites stay byte-identical.
- New: `gameActionsPregameSocketHandlers.ts` (17.3 KB) — `restartGame`, `restartGameClear`, `keepHand`,
  `unkeepHand`, `mulligan`. 518 parent lines became 24.
- Verified: typecheck at baseline. Turn flow green (77 of 80; see the baseline note below) on
  claim-my-turn, next-step, skip-to-phase ×3, skipToPhase, turn.steps, turn.lands, ai.turn,
  priority.main-phase-auto-advance. Pre-game green (24 tests / 6 files) on the mulligan, restart and
  opening-hand suites.

### A third baseline failure found while testing cluster 11

`tests/phase-skip-continuation.test.ts` fails two cases at HEAD:
`stops at DRAW when skipping UPKEEP toward MAIN2` and
`does not double-draw when completing skip after draw step action at DRAW stop`, both
`expected 'ready_to_complete' to be 'stopped'`.

Not from this chat: the test's whole import graph is `gameState` / `resolution/index` / `phaseSkipUtils` /
`skipUntapStepUtils`, none of which reference `game-actions`, and `phaseSkipUtils.ts` is clean against
HEAD. It looks like an in-flight fix that another chat reverted. Add it to the baseline before judging a
run red.

## Parent size across this chat

| After | Bytes | |
| --- | --- | --- |
| entry | 834786 | |
| cluster 1 | 795564 | cost reduction / formatting |
| cluster 6 | 674315 | spell-cast triggers |
| cluster 8 | 627622 | pregame readiness + permanent entry, then cast lock / face / modal |
| cluster 9 | 601176 | play land |
| cluster 10 | 580298 | last helper band |
| cluster 11 | 551533 | turn-flow socket handlers |
| cluster 12 | 535094 | pre-game socket handlers |

**834786 B → 535094 B (−36%).** All 21 extracted modules are under the 40 KB ceiling (largest:
`gameActionsSpellCastTriggerProcessing.ts` at 33.3 KB); `game-actions-handlers/index.ts` is 8.0 KB, inside
the ~10 KB budget for an ingestable TOC.

## Module map rows owed

To be added to `docs/mtg-logic-module-map.md` by whoever owns that file:

| Module | Owns |
| --- | --- |
| `server/src/socket/game-actions-handlers/gameActionsCastCostReduction.ts` | Battlefield/static spell cost reduction, generic cost taxes, convoke availability, cast cost metadata types |
| `server/src/socket/game-actions-handlers/gameActionsCastCostFormatting.ts` | Mana cost adjustment arithmetic, adjusted-cost rendering, payment-step cost adjustment + pending-cast cost metadata payloads |
| `server/src/socket/game-actions-handlers/gameActionsPermanentKeywordGrants.ts` | Keyword/haste grant resolution across oracle text, attachments and battlefield-wide effects; summoning sickness |
| `server/src/socket/game-actions-handlers/gameActionsCastSpellPaymentSources.ts` | Cast-spell payment source resolution: permanent refs, mana-ability activation costs, produced mana, payment checkpoints |
| `server/src/socket/game-actions-handlers/gameActionsSpellTargetSelection.ts` | Spell target lists, grouped target metadata, per-clause target selection prompts |
| `server/src/socket/game-actions-handlers/gameActionsSpellCopyHeroicTriggers.ts` | Spell copies (immediate + delayed), copy retargeting, heroic / targeted / untap cast triggers |
| `server/src/socket/game-actions-handlers/gameActionsSpellCastTriggerDetection.ts` | Which spell-cast triggers a cast produces, once-per-turn bookkeeping, cast-trigger tokens and optional-payment choices |
| `server/src/socket/game-actions-handlers/gameActionsSpellCastTriggerProcessing.ts` | Running spell-cast triggers: APNAP order, intervening-if, Oracle IR vs legacy routing, resolution-step queueing |
| `server/src/socket/game-actions-handlers/gameActionsMulliganReadinessChecks.ts` | Pregame readiness: free-mulligan house rule, mulligan counts, all-players-ready checks |
| `server/src/socket/game-actions-handlers/gameActionsPermanentEntryPrompts.ts` | Prompts raised as a permanent enters: creature type, color, player choice, enchantment ETB triggers, self ETB tutor search |
| `server/src/socket/game-actions-handlers/gameActionsSpellCastLock.ts` | In-flight cast guard: completing-cast marker, payment-resume lock, cast timing checks, pending cast step lookup/restore, Oracle IR interaction pass |
| `server/src/socket/game-actions-handlers/gameActionsCastFaceAndMiracleSelection.ts` | Effective base mana cost under forced alternate costs, miracle check + prompt, suspend cast info, card face / adventure resolution |
| `server/src/socket/game-actions-handlers/gameActionsModalCastModeCosts.ts` | Cost and oracle text for chosen modes: modal, entwine, escalate, additional-cost modes, overload |
| `server/src/socket/game-actions-handlers/gameActionsPlayerZoneCards.ts` | Shared leaf: reading a player's cards out of library / command zone / spell source zone |
| `server/src/socket/game-actions-handlers/gameActionsPlayLandRequest.ts` | Playing a land: request handling, top-of-library permission, battlefield entry and land ETB shape (tapped/shock/bounce/scry/conditional) |
| `server/src/socket/game-actions-handlers/gameActionsRequestedSpellCastCandidate.ts` | Resolving a cast request to a shared castable-spell candidate, graveyard cast permission, free-cast and graveyard metadata stamping |
| `server/src/socket/game-actions-handlers/gameActionsAdditionalCastCosts.ts` | Additional costs on top of mana cost: harmonize, effective additional cost, squad, reveal |
| `server/src/socket/game-actions-handlers/gameActionsCommandZoneAndAlternateCastCosts.ts` | Command zone commander candidates and tax-adjusted cost, pending cast payment fields, keyword alternate-cost payment extras, library cast access |
| `server/src/socket/game-actions-handlers/gameActionsSocketRoomGuard.ts` | Shared leaf: `EnsureInGameRoom` type for socket handlers extracted out of `registerGameActions` |
| `server/src/socket/game-actions-handlers/gameActionsTurnFlowSocketHandlers.ts` | Turn-flow socket handlers: claimMyTurn, randomizeStartingPlayer, nextTurn, nextStep, skipToPhase |
| `server/src/socket/game-actions-handlers/gameActionsPregameSocketHandlers.ts` | Pre-game socket handlers: restartGame, restartGameClear, keepHand, unkeepHand, mulligan |

## Remaining shape of game-actions.ts (535 KB, ~11.4k lines)

The easy work is finished. What is left is three things, and they are not the same kind of problem:

| Region | Size | Kind |
| --- | --- | --- |
| import block + re-export barrel + `getLeaveBattlefieldReplacementHint` | ~14 KB | fine as-is |
| `requestCastSpellForSocket` | ~113 KB, one function | needs real decomposition |
| `registerGameActions` | ~400 KB | mostly mechanical, but see below |

### 1. Keep going with socket handlers (mechanical, ~90 KB available)

Use the cluster 11/12 recipe verbatim. Remaining contiguous groups, in rough size order — re-grep
`^  socket\.on\(` for current line numbers before each batch:

- `adjustLife`, `setLife`, `mill`, `setHouseRules` (~18 KB, contiguous, deps already checked clean)
- `equipAbility` (~17 KB on its own)
- `requestGraveyardTargets`, `requestOpponentSelection`, `requestSacrificeSelection`,
  `changePermanentControl` (~19 KB)
- `foretellCard`, `castForetold`, `phaseOutPermanents` (~9 KB)
- `concede`, `setTriggerShortcut` (~14 KB)
- `shuffleHand` plus the three multi-line `socket.on(` registrations after it (~14 KB)
- `passPriority` (~13 KB), `resolveAllTriggers` (~6 KB), `completeCastSpell` (~20 KB)

Per batch: define the region and each handler's `comments` / `body` / close line, run the move script dry,
apply, wire the parent import + `index.ts` re-export, then **grep the new module for `import(` /
`require(` with relative specifiers**, typecheck, run targeted vitest.

### 2. The two mega-functions (not a line move — do not try one)

`requestCastSpellForSocket` (~113 KB) and `handleCastSpellFromHand` (~230 KB, a `const` arrow declared
inside `registerGameActions` and registered at `socket.on("castSpellFromHand", handleCastSpellFromHand)`)
are each a single function body. Moving either whole would create a module far over the ceiling, which the
rule forbids, so they need decomposing into phases (candidate resolution → cost assembly → payment →
target selection → commit) with explicit parameters instead of shared local state.

That is a genuine refactor with real behaviour risk, and it should be its own chat with its own test plan
— not appended to a splitting session. Until it happens, `game-actions.ts` cannot reach 40 KB. Extracting
every remaining socket handler gets it to roughly **150 KB**, which is the realistic target for the
mechanical campaign.

## Tooling used (throwaway, deleted at end of session)

Two scripts under `tools/`, recreate them rather than hand-editing large ranges:

- `_tmp-cluster-deps.mjs <file> <a-b,c-d>` — prints the imported bindings a line range uses, the
  parent-level declarations it reaches for from outside the range, and which of its own declarations are
  still referenced elsewhere (i.e. what the parent must import back). **It only sees top-level
  declarations**, so closure-scoped helpers like `ensureInGameRoom` and `checkAndEmitDamageTriggers` do
  not show up — check for those by hand. It also does not see dynamic-import specifiers.
- `_tmp-move-cluster.mjs` — takes a list of targets (path, line ranges, names to export, header) computed
  against **one** snapshot of the parent, writes the new modules LF, adds `export ` only to the named
  declarations, and splices the ranges out of the parent leaving all other bytes and CRLF untouched.
- `_tmp-extract-socket-handlers.mjs` — the cluster 11/12 variant: dedents handler bodies by exactly two
  spaces (asserting the dedent is lossless), copies the comments above each registration byte-for-byte,
  and replaces the whole region with compact registrations.

`node tools/_tmp-range-bytes.mjs <file> name=a-b …` sizes candidate ranges before committing to a split.
