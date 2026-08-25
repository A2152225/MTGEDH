# Split handoff â€” chat A (resolution.ts)

Sole writer for: `server/src/socket/resolution.ts`, `server/src/socket/resolution-handlers/**`,
`server/src/socket/resolutionHandlerDeps.ts`, `server/src/socket/resolutionRegisterPreCompleteValidation*.ts`.

Campaign 0 and the green test baseline were already done before this chat; not redone here.

## Known pre-existing typecheck failures (not from this chat)

`npm run typecheck --workspace=server` was already red on entry, in files owned by other chats:

- `src/socket/game-actions.ts(11773,62)` TS2345 `ManaPool` not assignable to `Record<string, number>`
- `src/state/modules/oracleIrServerZoneSync.ts(4483,57)` TS2304 `unwrapYouDoResumeSteps` not found

Treat those two as the baseline. Any third error is new.

## Conventions established here

- New handler modules live in `server/src/socket/resolution-handlers/`, named re-exported from
  `resolution-handlers/index.ts` (named exports only, no `export *`), injected through
  `resolutionHandlerDeps.ts`, called from the cores via `getResolutionHandlerDeps()`.
- Leaves must not import `resolution.ts` or `resolution-handlers/index.ts`.
- `resolutionRegisterPreCompleteValidationForExtractedSteps.ts` is at ~37.5 KB and is closed to new
  step types. New pre-complete validation goes in
  `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts`, invoked from
  `registerResolutionHandlers` right after `validateExtractedStepTypesBeforeComplete`.
- Switch case bodies used `break` to leave `handleStepResponse` (nothing runs after the switch), so a
  case-level `break` becomes `return` inside an extracted function. `break`/`continue` inside loops
  stay as-is. Check this on every extract.

## Progress

### Cluster 1 â€” EXPLORE_DECISION / BATCH_EXPLORE_DECISION (done)

- New: `resolution-handlers/exploreDecisionResponseHandlers.ts`
  (`handleExploreDecisionResponse`, `handleBatchExploreDecisionResponse`).
- New: `resolution-handlers/index.ts` (folder created on this extract).
- New: `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts`
  (`validateStepResponseClusterStepsBeforeComplete`) â€” holds the EXPLORE and BATCH_EXPLORE
  pre-complete validation moved out of `registerResolutionHandlers`.
- `resolution.ts`: 1062431 B â†’ 1051643 B.
- Verified: server typecheck (baseline 2 errors only); `npx vitest run` green on
  `explore-decision.validate-before-complete`, `batch-explore-decision.validate-before-complete`,
  `oracle-ir-explore`, `explore-branching-evolution`, `hakbal.begin-combat-explore` (6 tests).

### Cluster 2 â€” FIGHT_TARGET / TAP_UNTAP_TARGET (done)

- New: `resolution-handlers/fightTargetResponseHandlers.ts` (`handleFightTargetResponse`, 6.6 KB).
  The private `getFightAbilityDescription` helper moved with it (it had no other caller).
- New: `resolution-handlers/tapUntapTargetResponseHandlers.ts` (`handleTapUntapTargetResponse`, 26.3 KB).
  Covers target filtering, the battlefield-ability tap/untap selection path, the plain tap/untap
  effect path, and the tap-another-permanent activation-cost resume. It is `async` because the
  activation-cost path lazily imports `payAbilityManaCostFromPool`; that dynamic import now points at
  `../util.js`.
- Pre-complete validation for both step types moved from `registerResolutionHandlers` into
  `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts` (now 16.7 KB). That validator
  now takes `game` and `pid` as well.
- `resolution.ts`: 1051643 B â†’ 1008158 B.
- Verified: `npx vitest run` green (171 tests) on `fight-target.validate-before-complete`,
  `tap-untap-target.validate-before-complete`, `tap-other-as-cost.battlefield-activation.resolution-queue`,
  `hybrid-mana.resume-activation-cost`, `activation-cost.mana-prevalidation.no-partial`,
  `exert-activation-cost`, `trigger-tap-untap-ir`, `battlefield-queued-steps.replay`,
  `thousand-moons-smithy.transform`, `ai-resolution-step`.

### Cluster 3 â€” COUNTER_MOVEMENT / COUNTER_TARGET / COUNTER_DISTRIBUTION / STATION_CREATURE_SELECTION (done)

- New: `resolution-handlers/counterManipulationResponseHandlers.ts` (11.9 KB) with
  `handleCounterMovementResponse`, `handleCounterTargetResponse`, `handleCounterDistributionResponse`.
- New: `resolution-handlers/stationCreatureSelectionResponseHandlers.ts` (7.1 KB) with
  `handleStationCreatureSelectionResponse`. Kept separate from the counter module because Station is
  its own mechanic and pulls in `tryApplyStationChargeCountersViaOracleIR` plus a `GameContext` shim.
- Pre-complete validation for COUNTER_MOVEMENT, COUNTER_TARGET and STATION_CREATURE_SELECTION moved
  into `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts` (now 24.8 KB).
  COUNTER_DISTRIBUTION had no pre-complete block; its validation lives inside the handler, unchanged.
- `resolution.ts`: 1008158 B â†’ 982236 B.
- Verified: `npx vitest run` green (39 tests) on the three `*.validate-before-complete` suites plus
  `oracle-ir-counter-distribution`, `oracle-ir-court-garenbrig-counter-distribution.socket`,
  `oracle-ir-station-multi-threshold`, `oracle-ir-station-charge-counters`,
  `spacecraft.station-threshold`, `station-threshold-keyword-line.battlefield-activation`,
  `station-activated.applyEvent`, `counter-events.replay`, `gwafa-bribery-counter`,
  `oracle-ir-kavaron-threshold` (+ socket).

### Cluster 4 â€” LIFE_PAYMENT (done)

- New: `resolution-handlers/lifePaymentResponseHandlers.ts` (3.7 KB) with `handleLifePaymentResponse`.
  Pays the chosen life total, then resumes the captured cast continuation via
  `resolutionSyntheticCastSocketUtils`.
- Pre-complete validation for LIFE_PAYMENT was left in `registerResolutionHandlers`: it sits between
  other type-guarded blocks and moving it would only shuffle code without shrinking the parent
  meaningfully. Revisit if that region gets extracted wholesale.
- Verified: `npx vitest run` green (150 tests) on `life-payment.validate-before-complete`,
  `prompt-response-ai-replay-sweep.replay`, `ai-resolution-step`.

### Cluster 5 â€” MANA_COLOR_SELECTION (done)

- New: `resolution-handlers/manaColorSelectionResponseHandlers.ts` (19.7 KB) with
  `handleManaColorSelectionResponse`. Covers the distribution and single-color paths, storage-counter
  removal, Treasure provenance, deferred activation-cost evidence (pay-life, tap/sacrifice, counter
  removal, self-exert), the `activateManaAbility` replay event, and the Forbidden Orchard follow-up
  step. Async: it keeps the original dynamic imports of `util.js`, `mana-abilities.js` and
  `counters_tokens.js` so import timing is unchanged.
- Pre-complete validation moved into
  `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts` (now 30.1 KB) as its **own**
  export, `validateManaColorSelectionBeforeComplete`. It is deliberately not folded into
  `validateStepResponseClusterStepsBeforeComplete`: that aggregate runs much later in
  `registerResolutionHandlers`, and merging would reorder validation relative to the blocks in
  between. `resolution.ts` calls it at the exact line the inline block used to occupy.
- `resolution.ts`: 978081 B â†’ 951547 B.
- Verified: `npx vitest run` green (70 tests) on `activate-mana-ability.replay`,
  `added-mana-with-this-ability.intervening-if`, `choose-mana-colors-choice` (+ replay),
  `gemstone-array-mana-production`, `gemstone-array-remove-counter-cost`, `gemstone-array-battery-cap`,
  `forbidden-orchard-target.validate-before-complete`, `forbidden-orchard.replay`,
  `nykthos.devotion-color-choice`, `gwenna-mana-color-selection`,
  `pay-life-sacrifice-self-mana-color-selection`, `treasure-mana-activation-provenance`,
  `vibranium-mana-restriction`, `mana-color-selection-step-utils`, `oracle-ir-add-mana` (+ distribution),
  `mana-battery-counter`, `dual-land-mana-choice`, `throne-chosen-color-mana`.

### Cluster 6 â€” resolution mana-payment appliers (done)

Groundwork, not a step handler: MANA_PAYMENT_CHOICE could not be extracted while its appliers were
private functions inside `resolution.ts`.

- New: `resolution-handlers/resolutionManaPaymentApplication.ts` (32.5 KB) with
  `extractResolutionPaymentItems`, `validateWardManaPaymentSelection`, `applyWardManaPaymentSelection`,
  `applySelectedManaPaymentForResolutionCost` (plus the private `getFloatingPaymentPoolKey`).
  Companion to the existing `resolutionPaymentManaUtils.ts` (13 KB), which stays as-is: merging would
  have pushed it past 40 KB.
- Dual-copy cleanup: `resolution.ts` had its own `ResolutionPaymentItem`, `MANA_POOL_KEY_BY_SYMBOL`
  and `FLOATING_MANA_PAYMENT_PREFIX` duplicating `resolutionPaymentManaUtils.ts`. The local copies are
  gone; the file already imported the shared type as `ExtractedResolutionPaymentItem`.
- `creatureHasHaste` now comes straight from
  `game-actions-handlers/gameActionsPermanentKeywordGrants.js` instead of the `game-actions.ts`
  re-export, so the leaf does not pull in that monolith.
- `resolution.ts`: 951547 B â†’ 920319 B.
- Verified: `npx vitest run` green (50 tests) on `resolution-payment-mana` persist + replay,
  `mana-payment-choice.selection`, `ward-payment`, `attack-trigger-mana-payment.resolution-queue`,
  `hybrid-mana.resume-activation-cost`, `activation-cost.mana-prevalidation.no-partial`,
  `activation-cost.autotap-simple-mana`, `generic-mana-auto-payment`,
  `phyrexian-mana-payment-choice-as-cost.battlefield-activation`, `bulk-tap-permanents-for-mana`.

### Cluster 7 â€” MANA_PAYMENT_CHOICE ward / sacrifice-unless-pay / activation (done)

MANA_PAYMENT_CHOICE was ~1400 lines, so it is being taken in branches rather than as one file.

- New: `resolution-handlers/manaPaymentChoicePrefixHandlers.ts` (7.3 KB) with
  `tryHandleManaPaymentChoiceWardAndSacrificePrefix` â€” the `wardPayment` and
  `sacrificeUnlessPayChoice` shapes.
- New: `resolution-handlers/manaPaymentChoiceActivationHandlers.ts` (27.8 KB) with
  `tryHandleManaPaymentChoiceActivation` â€” the `activationPaymentChoice` branch and all four
  `activationPaymentContext` continuations (battlefield_counter_target, battlefield_targeted,
  mana_ability, battlefield_group_draw).
- Both return `Promise<boolean>`: `true` reproduces the original `break`, `false` falls through to the
  branches still living in `resolution.ts`. Note the ward shape only handles `paymentType === 'mana'`
  and a non-mana ward falls through â€” the boolean preserves that exactly.
- `resolution.ts`: 920319 B â†’ 884360 B.
- Verified: `npx vitest run` green (199 tests) on `mana-payment-choice.selection`,
  `ability-activated-copy`, `blackblade-reforged.equip-legendary`,
  `activation-cost.mana-prevalidation.no-partial`, `activation-cost.autotap-simple-mana`,
  `hybrid-mana.resume-activation-cost`, `gemstone-array-remove-counter-cost`,
  `nykthos.devotion-color-choice`, `gwenna-mana-color-selection`,
  `phyrexian-mana-payment-choice-as-cost.battlefield-activation`, `ward-payment`,
  `sacrifice-unless-pay-choice.validation`, `ai-resolution-step`; plus (45 tests) `ward-payment.replay`,
  `ward-spell-cast-pending`, `oracle-ir-unless-pay` (+ socket), `resolution-payment-mana` persist/replay.
### Cluster 8 â€” MANA_PAYMENT_CHOICE Phyrexian tail (done)

- New: `resolution-handlers/manaPaymentChoicePhyrexianHandlers.ts` (14.3 KB) with
  `handleManaPaymentChoicePhyrexianActivation` â€” the `phyrexianManaChoice` branch (life-vs-mana
  choice, treasure-spend provenance, sacrifice-as-cost TARGET_SELECTION follow-up, stack push /
  mana-ability short circuit) plus the `UNSUPPORTED_STEP` fallback that closes the case. This is the
  terminal branch, so it returns `void` rather than a boolean.
- Paired validation: the inline phyrexian pre-complete block moved out of `resolution.ts` into
  `validatePhyrexianManaPaymentBeforeComplete` in
  `resolutionRegisterPreCompleteValidationForStepResponseClusters.ts` (30.1 KB â†’ 34.1 KB). It is
  `async` (the mana-pool check dynamic-imports `util.js`), so the call site awaits it. The sibling
  `...ForExtractedSteps.ts` stays untouched at 37.5 KB.
- `resolution.ts`: 884360 B â†’ 866576 B.
- Verified: `npx vitest run` green (180 tests) on
  `phyrexian-mana-payment-choice-as-cost.battlefield-activation`, `mana-payment-choice.selection`,
  `ward-payment`, `sacrifice-unless-pay-choice.validation`, `ability-activated-copy`,
  `ai-resolution-step`.

Still in `resolution.ts` for MANA_PAYMENT_CHOICE: only the `spellPaymentRequired` branch (cast
payment, graveyard cast payment, mutate deferral, re-queue-on-failure). **Blocked on groundwork**: it
calls four helpers private to `resolution.ts` â€” `restoreLibrarySearchStep`,
`buildSpellPaymentPresentationFields`, `emitNextPendingResolutionStep`, and
`resumePlayerSpellCastAfterPayment` â€” each with many other call sites in the parent. Extract those to
a shared `resolutionSpellPaymentResumeUtils.ts` first (own cluster), then the branch moves cleanly.
Do not pass them in as callbacks; that seam would have to be unwound later.

### Cluster 9 â€” MODE_SELECTION (done, whole case)

The case was ~1020 lines and came out in two passes.

- New: `resolution-handlers/modeSelectionCastResumeHandlers.ts` (9.4 KB) with
  `tryHandleModeSelectionCastResume` â€” steps carrying `castSpellFromHandArgs`
  (modal / spree / tiered mode picks incl. entwine detection, Abundant Harvest's `abundantChoice`,
  the overload-vs-normal prompt, and the unknown-purpose fallback). Returns `Promise<boolean>`.
- New: `resolution-handlers/modeSelectionGenericChoiceHandlers.ts` (25.8 KB) with
  `handleModeSelectionGenericChoice` â€” the legacy `modalSpellResolve` bridge plus the generic mode
  pick that stamps `selectedMode` onto the matching TARGET_SELECTION step and recomputes its valid
  targets from the mode's oracle text. Terminal, so it returns `void`.
- New: `resolution-handlers/modeSelectionTargetOptionBuilders.ts` (13.6 KB) with
  `buildModeChoiceOptionsFromTargetRefs`, `buildModeSpellSpecFromTargetRequirements`, and
  `applyModeRestrictionsToSpec` â€” the three closures the recomputation used. Split off because
  handler + builders together measured 42.3 KB, over the ceiling. The two closures that captured
  `game`/`pid` now take them as leading parameters; nothing else changed.
- Preserved verbatim: the constraint parser in the generic handler uses double-escaped regex
  literals (`/\\bcolorless\\b/`, `/\\bnonsnow\\b/`, â€¦), which match a literal backslash and so never
  fire. That is a pre-existing bug at HEAD, not something the split introduced â€” copying it as-is
  keeps the diff behavior-preserving. Worth a separate fix, with tests, outside a split session.
- `resolution.ts`: 866576 B â†’ 815109 B. MODE_SELECTION is now 12 lines.
- Verified: `npx vitest run` green (41 tests) on `abundant-harvest.mode-selection.resumption`,
  `overload-mode-selection`, `spree.request-cast`, `mode-selection.validate-before-complete`,
  `modal-choice.validate-before-complete`, `oracle-ir-modal-spell-resolve`,
  `oracle-ir-modal-spell-primary-default`, `oracle-ir-mode-selection`, `ai-mode-selection`,
  `ai-modal-choice`, `modal-command-targeting`, `mode-selection-p-budget`,
  `oracle-ir-trigger-modal-mode`.
- No pre-complete validation moved: MODE_SELECTION's lives in
  `resolutionRegisterPreCompleteValidationForExtractedSteps.ts` already.

Note on the shared tree: other chats are mid-extract in `game-actions.ts`, `interaction.ts`, and
`util.ts`, so the workspace typecheck and some mana/cast tests flicker red for reasons unrelated to
this chat. `exert-activation-cost > Arena of Glory` failed once here; it was verified to fail
identically with this chat's `resolution.ts`/`resolutionHandlerDeps.ts` stashed, and went green again
after the other chat landed its fix. When a test fails, stash only this chat's files and re-run
before blaming the extract.

### Cluster 10 - ADDITIONAL_COST_PAYMENT (done, whole case)

- New: `resolution-handlers/resolutionCounterRemovalPaymentSelection.ts` (6.6 KB) with
  `validateCounterRemovalPaymentSelection` + `NormalizedCounterRemovalPayment` (and the private
  `normalizeCounterRemovalPaymentSelections`). Groundwork: those were file-private in `resolution.ts`
  but used by both the case body and the pre-complete validation at the top of `handleStepResponse`,
  so they had to move first. `resolution.ts` now imports them from the leaf; the
  `counter-removal-costs.js` import it only needed for them is gone.
- New: `resolution-handlers/additionalCostPaymentResponseHandlers.ts` (28.2 KB) with
  `handleAdditionalCostPaymentResponse` - the whole ~650-line case: discard (with Madness exile +
  deferred prompt bookkeeping), sacrifice (deferred to cast commit), remove counters, reveal, behold,
  teamwork tap, the Bargain/Teamwork decline paths, and the `requestCastSpellForSocket` restart at
  each exit. Terminal, so every `break` became `return`.
- This leaf statically imports `requestCastSpellForSocket` from `../game-actions.js`. That direction
  already exists from flat siblings (`resolutionGraveyardSelectionApplyHandlers.ts`,
  `resolutionOptionChoiceEarlySpecialsConfirmCastPaymentHandlers.ts`), and `game-actions.ts` imports
  `resolution.js`, not the leaf, so no new cycle shape.
- Verified: `npx vitest run` green (41 tests) on `additional-cost-mode-oracle-text`,
  `additional-cost-paid.intervening-if`, `additional-cost-payment.validate-before-complete`,
  `bargain.intervening-if`, `positive-only-bargain-additional-cost.intervening-if`,
  `cast-spell-from-hand.additional-cost-madness`,
  `cast-spell-from-hand.additional-cost-prompt-persistence`, `madness.discard-replay`,
  `request-cast.additional-cost-madness`, `request-cast.additional-cost-pay-life`,
  `request-cast.additional-cost-prompt-persistence`, `request-cast.additional-cost-sacrifice`,
  `teamwork-choose-mode.socket`.
- No pre-complete validation moved: ADDITIONAL_COST_PAYMENT already validates through
  `resolutionRegisterPreCompleteValidationForExtractedSteps.ts`, which calls the shared
  counter-removal validator - now via the new leaf.

### Cluster 11 - SQUAD_COST_PAYMENT (done, whole case)

- New: `resolution-handlers/squadCostPaymentResponseHandlers.ts` (7.6 KB) with
  `handleSquadCostPaymentResponse` - stamps `squadTimesPaid` / `additionalCostPaid` on the card and
  the pending cast, appends the continuation event, then either restarts `requestCastSpell` (pending
  effect id or `skipPriorityCheck`) or resumes `castSpellFromHand` with an additional-cost-paid
  payment marker. Terminal; `break` became `return`.
- Verified: `npx vitest run` green on `squad-cost-payment.validate-before-complete`,
  `squad-token-self-etb`, `additional-cost-payment.validate-before-complete`.

`resolution.ts`: 815109 B -> 772360 B after clusters 10 and 11. Workspace typecheck is clean apart
from the two pre-existing external errors (`game-actions.ts` ManaPool index signature,
`oracleIrServerZoneSync.ts` `unwrapYouDoResumeSteps`) owned by other chats.

Next in the queue: `handleTargetSelectionResponse` branches, then the remaining
`handleOptionChoiceResponse` tail after ConfirmCastPayment.

## handleTargetSelectionResponse branches

### Cluster 12 - sacrificeAbilityAsCost (done)

- New: `resolution-handlers/targetSelectionSacrificeAbilityCostHandlers.ts` (24.5 KB) with
  `handleSacrificeAbilityAsCostTargetSelection` - the largest branch in the function (~570 lines):
  validate the remaining cost text / mana / life, snapshot power+toughness of the chosen permanents
  (after a continuous-effects refresh, so lords count), sacrifice them, then prompt for the
  ability's effect targets, resolve it as a mana ability without the stack (CR 605), or push it on
  the stack. Always returned, so the call site is `await handler(...); return;`.
- The one cosmetic difference: the unused `const exertedPermanentIdForCost =` binding on the
  stack path is now a bare call. Nothing read it.
- Verified: `npx vitest run` green (20 tests) on `altar-of-dementia.activation`,
  `ashnods-altar.mana-ability.no-stack`, `discard-and-sacrifice-as-cost.battlefield-activation`,
  `sacrifice-as-cost.pay-life.battlefield-activation`, `sacrifice-self-as-cost.battlefield-activation`,
  `after-sacrifice-followup-target-selection`, `pay-life-sacrifice-self-mana-color-selection`,
  `commander-sphere.generic-sacrifice-draw`, `sacrifice-another-permanent-for-benefit`,
  `sacrifice-permanent`.

### Cluster 13 - removeCountersAbilityAsCost + returnToHandAbilityAsCost (done)

- New: `resolution-handlers/targetSelectionActivationCostPaymentHandlers.ts` (17.5 KB) with
  `handleRemoveCountersAbilityAsCostTargetSelection` and
  `handleReturnToHandAbilityAsCostTargetSelection`. Kept together because they are the same shape -
  pick the permanent that pays a non-mana activation cost, validate, pay mana/life, apply the cost,
  stack the ability - and together they still land well under the ceiling.
- Verified: `npx vitest run` green (18 tests) on `remove-counters-as-cost.battlefield-activation`,
  `remove-counters-other-permanent-as-cost`, `return-to-hand-as-cost.battlefield-activation`,
  `gemstone-array-remove-counter-cost`, `pay-life-as-cost.battlefield-activation`,
  `tap-other-as-cost.battlefield-activation`, `activation-cost.mana-prevalidation.no-partial`.

### Cluster 14 - battlefieldAbilityTargetSelection (done)

- New: `resolution-handlers/targetSelectionBattlefieldAbilityHandlers.ts` (12.3 KB) with
  `handleBattlefieldAbilityTargetSelection` - the continuation after interactive costs are paid:
  equip / fortify / reconfigure detour to a MANA_PAYMENT_CHOICE prompt when the targeting cost still
  has mana, otherwise the ability goes on the stack with its attach params, self-exert is finalized,
  and tap triggers fire for cost-tapped permanents.
- `validTargets` / `minTargets` / `maxTargets` were closure reads from the top of
  `handleTargetSelectionResponse`; the leaf recomputes them from the step exactly as the parent did.
- Verified: `npx vitest run` green (66 tests) on `blackblade-reforged.equip-legendary`,
  `fortify.generic-ability-routing`, `reconfigure.generic-ability-routing`,
  `attach-equipment-to-permanent`, `activate-battlefield-ability.replay`,
  `activate-battlefield-ability.scoped-detector-routing`, `ability-activated-copy`, `equipment`.

### Cluster 15 - pending-cast payment prompt groundwork + Blight N (done)

Two pieces, one dependency chain.

- New: `resolution-handlers/resolutionPendingCastPaymentPrompt.ts` (9.9 KB) with
  `ensurePendingCastCostMetadata`, `buildPendingCastPaymentStepCostFields`,
  `buildSpellPaymentPresentationFields`, `buildPendingCastPaymentManaCost`, and
  `emitPendingCastPaymentIfNeeded`. The first four were file-private helpers with 7+ call sites in
  `resolution.ts`; the fifth was a closure inside `handleTargetSelectionResponse` that captured
  `game`/`gameId`, so it now takes them as leading parameters and the two parent call sites pass
  them. This unblocks any branch extract that needs to release a queued payment prompt (the Blight
  cast_additional_cost stage here, and the option-choice tail later).
- New: `resolution-handlers/targetSelectionBlightKeywordHandlers.ts` (12.4 KB) with
  `handleBlightKeywordTargetSelection` plus the exported `BLIGHT_TARGET_SELECTION_STAGES` list the
  parent branch condition still reads, so the guard in `resolution.ts` stays a one-liner and the
  stage list has a single owner.
- Verified: `npx vitest run` green (33 tests) on `blight-x-as-cost.battlefield-activation`,
  `targeting.templates.blight`, `ward-payment`, `ward-payment.replay`, `ward-spell-cast-pending`,
  `cast-spell-from-hand.additional-cost-prompt-persistence`,
  `request-cast.additional-cost-prompt-persistence`; plus a payment-prompt regression sweep (51
  tests) on `cost-reduction-cast`, `commander-free-cast`, `mutate.cast-prompt`,
  `mana-payment-choice.selection`, `cast-spell-payment.replay-no-reprompt`,
  `ai.shared-spell-payment`, `phyrexian-mana-payment-choice-as-cost`,
  `graveyard-alternate-cast-cost-reduction`.

`resolution.ts`: 772360 B -> 698372 B after clusters 12-15.

### Cluster 16 - Ward payment prompts (done)

- New: `resolution-handlers/targetSelectionWardPromptHandlers.ts` (18.2 KB) with
  `maybeQueueWardPaymentPromptsForTargetSelection` - the post-pass that runs on every answered
  TARGET_SELECTION step: for each opposing target with a ward cost it queues Ward-Blight N as a
  TARGET_SELECTION, mana ward as MANA_PAYMENT_CHOICE, and the pay-life / discard / sacrifice
  templates as OPTION_CHOICE, countering the stack item when the cost is unpayable or unrecognized.
- This branch could fall through (no ward on any target, or prompts queued while a spell cast is in
  flight), so the leaf returns a boolean and the parent does `if (handled) return;` instead of an
  unconditional return.
- `getWardCost` and `resolveWardCasterForTargetSelection` had no other caller in `resolution.ts`,
  so those two imports came off the parent.
- Verified: `npx vitest run` green (30 tests) on `ward-payment`, `ward-payment.replay`,
  `ward-spell-cast-pending`, `blight-x-as-cost.battlefield-activation`, `targeting.templates.blight`,
  `flickering-ward-hateful-eidolon`, `oracle-ir-cowardice-targeted-trigger`; plus a target-selection
  sweep (39 tests) on `etb-target-selection`, `etb-graveyard-target-selection`,
  `per-opponent-target-selection`, `target-selection.stale-target.validate-before-complete`,
  `mutate-target-selection.validate-before-complete`, `grouped-cast-targeting`,
  `modal-command-targeting`, `counterspell-stack-targeting`, `shroud-lightning-greaves-targeting`,
  `after-sacrifice-followup-target-selection`.

### Cluster 17 - sacrifice follow-ups (done)

- New: `resolution-handlers/targetSelectionSacrificeFollowupHandlers.ts` (9.8 KB) with
  `handleSacrificeWhenYouDoTargetSelection` and
  `handleSacrificeAnotherPermanentForBenefitTargetSelection`. The file-private
  `targetDescriptionFromType` moved with them because this cluster was its only caller.
- Verified: `npx vitest run` green (20 tests) on `after-sacrifice-followup-target-selection`,
  `sacrifice-another-permanent-for-benefit` (+ `.replay`, `.trigger.socket`), `sacrifice-selection.replay`,
  `sacrifice-permanent`, `commander-sphere.generic-sacrifice-draw`, `edict-sacrifice.resolution-queue`,
  `sacrifice-trigger`, `upkeep-sacrifice.validate-before-complete`.

### Cluster 18 - cast-from-graveyard continuations (done)

- New: `resolution-handlers/targetSelectionGraveyardCastHandlers.ts` (9.8 KB) with
  `handleGraveyardCastSacrificeAsCostTargetSelection` and `handleGraveyardSpellCastTargetSelection`.
- The sacrifice-cost branch wrapped its whole body in a try/catch whose catch did **not** return, so
  it fell through to the branches below on error. The leaf returns a boolean to preserve that: every
  in-try `return` became `return true`, the post-catch path returns false, and the parent guards with
  `if (graveyardSacrificeHandled) return;`.
- Verified: `npx vitest run` green (133 tests) on `cast-from-graveyard.graveyard-replay`,
  `cast-from-graveyard.intervening-if`, `disturb.graveyard-replay`,
  `oracle-ir-broodship-graveyard-cast.socket`, `scavenge-encore.graveyard-replay`,
  `think-twice-hand-flashback`.

### Cluster 19 - scavenge + become-a-copy (done)

- New: `resolution-handlers/targetSelectionScavengeAndCopyHandlers.ts` (6.6 KB) with
  `handleScavengeTargetSelection` and `handleBecomeCopyOfCreatureTargetSelection`. Kept together as
  the "apply the chosen creature target immediately" pair; either alone would be a one-function file.
- The copy branch read `minTargets` from the top of `handleTargetSelectionResponse`; the leaf
  recomputes it as `step.minTargets || 0`, which is what the parent binding was.
- Verified: `npx vitest run` green (10 tests) on `permanent-become-copy.replay`,
  `scavenge-encore.graveyard-replay`.

### Cluster 20 - the `step.action` immediate-action chain (done)

Ten `if (action === '...')` branches, ~20 KB, all of which returned. Split by domain into two
dispatchers so the parent keeps two lines instead of ten branches.

- New: `resolution-handlers/targetSelectionImmediateBattlefieldActions.ts` (16.0 KB) with
  `tryHandleTargetSelectionImmediateBattlefieldAction`: soulbond_pair, sacrifice_selected_permanents,
  pw_lukka_exile_upgrade, destroy_artifact_enchantment, tap_or_untap_target (queues the follow-up
  OPTION_CHOICE), begin_combat_target_buff, destroy_target_creature_or_planeswalker.
- New: `resolution-handlers/targetSelectionGraveyardCardActions.ts` (7.2 KB) with
  `tryHandleTargetSelectionGraveyardCardAction`: move_graveyard_card_to_hand,
  move_graveyard_card_to_battlefield, exile_graveyard_card.
- The branches are mutually exclusive on the same `action` string, so running the battlefield
  dispatcher before the graveyard one preserves the original chain's behavior.
- The parent's `const action = (step as any).action` binding had no reader outside this chain and is
  gone; each dispatcher reads `step.action` itself.
- Verified: `npx vitest run` green (25 tests) on `aura-shards-always-no`, `aura-shards-stack-replay`,
  `soulbond-pairing`, `tap-untap-choice-persistence`, `tap-untap-choice.replay`,
  `tap-untap-target.validate-before-complete`, `soldier-program-choice`, `soldier-program.replay`,
  `legion-warboss.begin-combat`, `god-pharaohs-gift.begin-combat`, `ouroboroid-begin-combat`.

`resolution.ts`: 698372 B -> 641313 B after clusters 16-20. Largest sibling in
`resolution-handlers/` is `resolutionManaPaymentApplication.ts` at 33.3 KB; everything added in this
session is at or under 18.2 KB.

### Cluster 21 - auto-unignore + spell-cast payment request (done)

The tail of `handleTargetSelectionResponse` that runs once a spell's targets are locked in.

- New: `resolution-handlers/targetSelectionSpellCastPaymentHandlers.ts` (9.3 KB) with
  `applyAutoUnignoreForTargetedPermanents` (a permanent targeted by an opponent leaves that player's
  auto-pass ignore list) and `handleSpellCastPaymentTargetSelection` (validate against the pending
  cast's legal targets, accumulate targets across multiple queued target steps, add Strive cost per
  extra target, queue the MANA_PAYMENT_CHOICE per CR 601.2h).
- The payment branch always returned, so its call site is `handler(...); return;`. The auto-unignore
  pass never returned and stays a plain statement above it.
- Verified: `npx vitest run` green on `strive-cost`, `auto-pass-ignore*`, `cast-spell-target*`.

### Cluster 22 - planeswalker loyalty + SOLDIER program counters (done)

Two "chosen permanents feed an activation" branches near the end of the function.

- New: `resolution-handlers/targetSelectionPlaneswalkerAndSoldierHandlers.ts` (7.1 KB) with
  `handleSoldierProgramCounterTargetSelection` (a +1/+1 counter on each chosen Soldier, one persisted
  `counterTargetChosen` event each) and `handlePlaneswalkerAbilityTargetSelection` (pay the loyalty
  cost, push the loyalty ability with its targets and copy-retarget metadata).
- Both branches always returned, so each call site is `await handler(...); return;`.
- Verified: `npx vitest run` green on `soldier-program-choice`, `soldier-program.replay`,
  `planeswalker*`.

### Cluster 23 - tap-creatures cost + attach Equipment (done)

Two non-stack branches plus the nested closure only one of them used.

- New: `resolution-handlers/targetSelectionTapCostAndAttachHandlers.ts` (9.0 KB) with
  `handleTapCreaturesCostTargetSelection` (Summon the School style "Tap N untapped X you control:",
  which validates everything before tapping so a failure never taps without returning the card) and
  `handleAttachEquipmentSelectEquipmentTargetSelection`, whose body was the closure
  `attachEquipmentToPermanentById` (moved along, since nothing else read it).
- Both branches always returned, so each call site is `await handler(...); return;`.
- Verified: `npx vitest run` green on `attach-equipment-to-permanent.integration`,
  `blackblade-reforged.equip-legendary`.

**Known-red, not ours:** `tests/summon-the-school.graveyard-recursion.integration.test.ts` expects
four queued `OPTION_CHOICE` may-prompts after the tap cost and gets zero. This is a
`state/modules/tap-trigger-queue.ts` change from another chat - optional tap triggers now go straight
onto the stack and resolve-time deferral owns the single may prompt, so
`queueTapTriggersForTappedPermanents` no longer queues pre-stack prompts. Confirmed by temporarily
re-inlining the original block in `resolution.ts` and rerunning: identical failure, so the extraction
is not the cause. That test belongs to whoever owns `tap-trigger-queue.ts`.

`resolution.ts`: 641313 B -> 620779 B after clusters 21-23. Pre-existing typecheck errors outside
this chat's files (`src/socket/game-actions.ts` ManaPool, `oracleIrServerZoneSync.ts`
`unwrapYouDoResumeSteps`) are still there and are not from these clusters.

### Cluster 24 - Crew + Enlist (done)

- New: `resolution-handlers/targetSelectionCrewAndEnlistHandlers.ts` (9.3 KB) with
  `tryHandleCrewAbilityTargetSelection` (validate every crewer, sum effective power against the crew
  cost, apply and persist `crewVehicle`) and `handleEnlistChoiceTargetSelection`.
- Crew was guarded by the `isCrewTargetStep` expression, which came along; the dispatcher returns
  true when the step was a crew step and the parent must stop. Enlist stays a plain `if`.
- The stray "CREW (Vehicle activated ability)" comment block sits ~100 lines above where the crew
  branch used to be (it precedes `const stepAny`), so it stayed put rather than moving with the code.
- Verified: `npx vitest run` green (6 tests) on
  `crew-levelup-outlast.generic-ability-routing.integration`, `enlist-choice.integration`.

### Cluster 25 - dungeon room branches (done)

- New: `resolution-handlers/targetSelectionDungeonRoomHandlers.ts` (7.2 KB) with
  `handleDungeonRoomSacrificePayment` (a room whose cost is a sacrifice; one persisted
  `sacrificePermanent` event per permanent) and `handleDungeonTargetCreatureEffect` (Forge,
  Storeroom, Fungi Cavern, Twisted Caverns, Arena, including the room-specific chat lines).
- The dungeon helpers at the top of `resolution.ts` (`applyDungeonRoomEffectsWithDoubler` and
  friends) stayed put: `handleOptionChoiceResponse` still calls them from three places, so they are
  a later shared-leaf extract, not part of this cluster.
- Verified: `npx vitest run` green (41 tests) on `venture-initiative.integration`,
  `venture-initiative.replay`.

### Cluster 26 - exert reward + copy retargeting (done)

- New: `resolution-handlers/targetSelectionExertAndCopyRetargetHandlers.ts` (7.2 KB) with
  `handleExertTargetChoiceTargetSelection`, `handleRetargetAbilityCopyTargetSelection` (including the
  equip / reconfigure params that carry their own target creature) and
  `handleRetargetSpellCopyTargetSelection`.
- Verified: `npx vitest run` green (66 tests) on `exert-choice.integration`, `exert-choice.replay`,
  `exert-activation-cost.integration`, `spell-copy-retarget.replay.integration`,
  `ability-activated-copy.integration`, `oracle-ir-bracers-copy-ability.integration`.

### Cluster 27 - triggered-ability and damage-received targets (done)

- New: `resolution-handlers/targetSelectionTriggeredAbilityTargetHandlers.ts` (8.4 KB) with
  `handleTargetedTriggeredAbilityTargetSelection` (write targets onto the stack item, persist
  `assignTriggeredAbilityTargets`, then either the inline "+1/+1 counters, then draw" shortcut or
  `executeTriggerEffect`) and `handleDamageReceivedTriggerTargetSelection` (resolve the damage
  trigger and cascade the damage-received triggers it causes).
- Verified: `npx vitest run` green (29 tests) on `damage-received-watcher-emission.unit`,
  `damage-received.intervening-if`, `oracle-ir-agrus-targeted-trigger.socket.integration`,
  `oracle-ir-cowardice-targeted-trigger.integration`, `oracle-ir-crystallization-targeted-trigger`,
  `oracle-ir-targeted-trigger-opponent-filter.integration`.

### Cluster 28 - non-stack immediate choices (done)

- New: `resolution-handlers/targetSelectionNonStackChoiceHandlers.ts` (9.7 KB) with
  `handleDivineReckoningChoiceTargetSelection` (record each player's survivor, destroy the rest once
  the batch completes), `handleSacrificeSelectionTargetSelection` (Grave Pact / Dictate of Erebos)
  and `handleOpponentSelectionTargetSelection` (Secret Rendezvous; parks the choice on state).
- Verified: `npx vitest run` green on `sacrifice-selection.replay`,
  `cast-from-graveyard.graveyard-replay.integration` (108 tests across the batch).

### Cluster 29 - the cancellation pass (done)

- New: `resolution-handlers/targetSelectionCancellationHandlers.ts` (7.7 KB) with
  `handleCancelledTargetSelectionResponse`: the whole `if (response.cancelled)` block that ran before
  target validation - ward declines, the three Blight N stages (ward, spell additional cost, ability
  activation cost), the three activated-ability cost cancellations, and up-to-N triggered abilities
  where cancelling means "zero targets, resolve anyway".
- The block ended in a bare `return`, so every path is terminal and the call site is
  `handler(...); return;`.
- Verified: `npx vitest run` green (14 tests) on `ward-payment.integration`, `ward-payment.replay`,
  `ward-spell-cast-pending.integration`,
  `blight-x-as-cost.battlefield-activation.resolution-queue.integration`.

`resolution.ts`: 620779 B -> 582875 B after clusters 24-29. `resolutionHandlerDeps.ts` is 19.6 KB and
`resolution-handlers/index.ts` 8.4 KB, both still well inside the agent-ingest budget.

**Second known-red, not ours:** `tests/replay-coverage.meta.test.ts` >
"keeps prompt-response replay handlers tied to queue cleanup" now reports `commanderZoneChoice`
missing queue cleanup in applyEvent. Another chat is mid-split of `applyEvent.ts` into the untracked
`state/modules/apply-event-handlers/` folder, and the `commanderZoneChoice` cleanup moved into
`applyEventCommanderCounterDamageEvents.ts` where the meta test's scan does not look. Nothing in this
chat's files mentions `commanderZoneChoice`.

### Cluster 30 - Oracle IR prompts answered through TARGET_SELECTION (done)

- New: `resolution-handlers/targetSelectionOracleIrPromptHandlers.ts` (9.1 KB) with
  `handleOracleIrAnyPlayerMayPaymentSelection` (an "any player may <pay>" prompt where cancelling is a
  real answer) and `handleOracleIrLibraryChaosTargetSelection` (one target per controller in turn;
  each answer either queues the next controller's prompt or runs the exchange and queues cast offers).
- Both branches always returned, so each call site is `handler(...); return;`.

### Cluster 31 - land-entry replacement OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceLandEntryReplacementHandlers.ts` (9.6 KB) with
  `handleShockLandChoice`, `handleRevealLandChoice`, `handleLandWouldEnterSacrificeChoice` and
  `handleMoxDiamondChoice`.
- New shared leaf: `resolution-handlers/resolutionOptionChoiceSelectionIds.ts` (1.2 KB) with
  `extractOptionChoiceSelectionId` / `extractOptionChoiceSelectionIds`, so extracted OPTION_CHOICE
  handlers stop re-declaring the `extractId` closure. The parent still declares its own copies for the
  branches that have not moved yet.

### Cluster 32 - the ward payment OPTION_CHOICE branch (done)

- New: `resolution-handlers/optionChoiceWardPaymentHandlers.ts` (14.2 KB) with
  `handleWardPaymentOptionChoice`: the whole pay/decline prompt a player gets when they target a
  permanent with ward. Declining, cancelling, or being unable to pay counters the spell or ability;
  paying either consumes mana / life on the spot or queues the follow-up DISCARD_SELECTION or
  sacrifice TARGET_SELECTION carrying the ward metadata. The nested `parseCountToken` closure came
  along; it only served this branch.
- Verified: `npx vitest run` green on `ward-payment.integration`, `ward-payment.replay`,
  `ward-spell-cast-pending.integration`, `flickering-ward-hateful-eidolon.unit`.

### Cluster 33 - pay-or-else OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoicePayOrElseHandlers.ts` (12.4 KB) with
  `handleSacrificeUnlessPayChoice` (pay the upkeep cost or sacrifice the permanent),
  `handleForceOfWillExileChoice` (exile a blue card from hand, optionally pay 1 life, then resume the
  cast through `resumePlayerCastSpellFromHand` for its alternate cost) and
  `handleOpponentMayPayChoice` (deciding player pays or takes the decline effect, applied and
  persisted as `opponentMayPayResolve`).
- Note: the MANA_PAYMENT-side `sacrificeUnlessPayChoice` path already lives in
  `manaPaymentChoicePrefixHandlers.ts`; this is the separate OPTION_CHOICE prompt, unchanged.
- `resolution.ts` shed `payManaCostWithAvailableSources`, `resumePlayerCastSpellFromHand` and
  `cardIsBlueForPitchCost` imports, which no longer had callers there.
- Verified: `npx vitest run` green (26 tests) on `alternate-cost.force-of-will.resolution`,
  `alternate-cost.force-pitch-colors.unit`, `force-of-will-exile-choice.replay`,
  `opponent-may-pay-choice.validate-before-complete.integration`,
  `opponent-may-pay.authorization.integration`, `opponent-may-pay.replay`,
  `sacrifice-unless-pay-choice.validation.integration`.

`resolution.ts`: 582875 B -> 541007 B (528.3 KB) after clusters 30-33.

### Cluster 34 - "play / cast that card from another zone" OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceCastFromGraveyardPrompts.ts` (6.8 KB) with
  `handlePlayFromGraveyardPromptChoice` (lands go through `handlePlayLandRequest`, everything else
  through `requestCastSpellForSocket`) and `handleCastFromGraveyardPromptChoice`. The private
  `appendCastFromGraveyardPromptResolveEvent` helper came along; these were its only callers.
- New: `resolution-handlers/optionChoiceCastFromExilePrompts.ts` (23.6 KB) with
  `handleDanceWithCalamityCastPrompt` (cast, detect whether the cast actually progressed, then retry /
  defer / advance the sequence) and `handleCastFromExilePromptChoice` (cast, or apply the decline
  destination - graveyard, cease to exist, bottom of library, hand, stay exiled - plus the
  damage-each-opponent rider, the queued next prompt, and the suspended-cleanup resume). The private
  `appendCastFromExilePromptResolveEvent` helper came along.
- `handleCastFromExilePromptChoice` takes a sixth `helpers` argument (`CastFromExilePromptHelpers`)
  carrying `sanitizeStepForClient`, because the retry path re-prompts the player and that sanitizer
  still lives in the parent. Deps types it explicitly rather than as a `ResolutionStepHandler`.
  Extracting `sanitizeStepForClient` itself is its own cluster: it still pulls
  `getFilteredValidTargetsForStep`, `hydrateSpellPaymentPresentationFieldsForClient` and
  `getPanglacialCastableCards` out of the parent.
- Verified: `npx vitest run` green (118 tests) on `cast-from-exile.decline-effect.integration`,
  `cast-from-exile.free-cast-targeted.integration`, `cast-from-graveyard.graveyard-replay.integration`,
  `cast-from-graveyard.intervening-if`, `dance-with-calamity.integration`,
  `dance-with-calamity.replay`, `madness.discard-replay.integration`.

`resolution.ts`: 541007 B -> 514274 B (502.2 KB).

### Cluster 35 - reflexive "when you do" OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceReflexiveExileWhenYouDoHandlers.ts` (17.9 KB) with
  `handleReflexiveBoundGraveyardSelfExileWhenYouDo` (exile the one bound card from whichever graveyard
  still holds it, then push the reflexive trigger) and
  `handleReflexiveExileToOwnersGraveyardWhenYouDo` (ask stage queues the multi-select; select stage
  moves the chosen opponent-owned exile cards into owners' graveyards and pushes the trigger).
- New: `resolution-handlers/optionChoiceReflexiveWhenYouDoQueueHandlers.ts` (13.6 KB) with
  `handleReflexiveGraveyardExileWhenYouDo` (queues a GRAVEYARD_SELECTION),
  `handleReflexiveDiscardWhenYouDo` (queues a DISCARD_SELECTION with the after-discard draw riders)
  and `handleSacrificeWhenYouDoAskChoice` (queues a TARGET_SELECTION over matching permanents). These
  three only ask and queue; the cost is paid by the follow-up step, which still lives elsewhere.
- Each branch's unmatched-stage fallthrough was a bare `return`, so the extracted functions simply
  fall off the end of the `stage === 'ask'` block.
- Verified: `npx vitest run` green (33 tests) on
  `reflexive-bound-graveyard-exile-followup.integration`, `reflexive-convert.replay`,
  `reflexive-discard-followup.integration`, `reflexive-graveyard-exile-followup.integration`,
  `reflexive-if-you-do-on-cast.unit`, `after-sacrifice-followup-target-selection.integration`,
  `on-cast-spell-trigger.unit`.

`resolution.ts`: 514274 B -> 486504 B (475.1 KB).

### Cluster 36 - dungeon room and venture OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceDungeonRoomPrompts.ts` (13.0 KB) with
  `handleDungeonRoomPenaltyChoice` (discard / sacrifice, or take the life loss when declined or when
  no follow-up step can be built), `handleDungeonRoomFreeCastFromHandChoice` and
  `handleDungeonRoomThroneChoice` (Throne of the Dead Three: battlefield entry with three +1/+1
  counters and hexproof, then shuffle). The Throne branch keeps its dynamic imports.
- New: `resolution-handlers/optionChoiceVentureDungeonHandlers.ts` (12.4 KB) with
  `handleVentureIntoDungeonChoice`, `handleVentureChooseDungeonChoice` and
  `handleVentureChooseRoomChoice`, plus the parent-local `applyDungeonRoomEffectsWithDoubler` and its
  two private helpers `queueDungeonRoomPromptSteps` / `appendDungeonRoomExecuteEffectEvents`; these
  three branches were their only callers.
- `resolution.ts` shed the `dungeons.js` import block, most of the `dungeon-effects.js` one (only
  `applyDungeonTargetPlayerEffect` still has callers there), `playerHasDungeonRoomAbilityDoubler`,
  `putCardOntoBattlefield` and the `CreateResolutionStepConfig` type.
- Verified: `npx vitest run` green (41 tests) on `venture-initiative.integration`,
  `venture-initiative.replay`.

`resolution.ts`: 486504 B -> 464372 B (453.5 KB) after cluster 36.

### Cluster 37 - spell / ability copy OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceSpellCopyPrompts.ts` (10.1 KB) with
  `handleResolvedSpellCopyChoice` (accept the copy, put the snapshot back on the stack through
  applyEvent when available, then queue the retarget prompt if the copy has targets),
  `handleRetargetSpellCopyChoice` and `handleRetargetAbilityCopyChoice` (keep-or-retarget; on
  retarget each queues the TARGET_SELECTION that rewrites the copy's targets).
- The TARGET_SELECTION side of these prompts already lives in
  `targetSelectionExertAndCopyRetargetHandlers.ts` from cluster 26.
- Verified: `npx vitest run` green (23 tests) on `resolved-spell-copy.replay`,
  `spell-copy-retarget.replay.integration`, `oracle-ir-copy-spell-stack.integration`,
  `ability-activated-copy.integration`, `oracle-ir-bracers-copy-ability.integration`,
  `oracle-ir-rings-copy-ability.integration`.

`resolution.ts`: 464372 B -> 456232 B (445.5 KB).

### Cluster 38 - looked-at cards and pile-split OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceLookedAtCardsAndPileHandlers.ts` (18.6 KB) with
  `handleChooseLookedAtCardsDestinationChoice` (chosen card to one zone, the rest to another,
  optionally randomizing the leftovers), `handlePayManaToLookAndChooseCardChoice` (spend X from the
  pool, then queue the destination prompt over the top X) and `handleChoosePileFromSplitChoice`
  (take one of two piles: move both piles to their destinations, or sacrifice the chosen pile). The
  pile branch keeps its dynamic import of `movePermanentToGraveyard`.
- Verified: `npx vitest run` green (43 tests) on
  `choose-looked-at-cards-destination.integration`, `choose-looked-at-cards-destination.replay`,
  `choose-pile-from-split-choice.integration`, `oracle-ir-choose-pile.integration`,
  `oracle-ir-choose-pile-e2e.integration`, `pay-mana-to-look-and-choose-card.integration`,
  `pay-mana-to-look-and-choose-card.replay`, `ai-option-choice`,
  `ai-option-choice-coverage.meta`.

`resolution.ts` is now 439040 B (428.8 KB).

### Cluster 39 - own-card / own-permanent OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoicePermanentAndHandCardPrompts.ts` (14.4 KB) with
  `handleMoveChosenHandCardToLibraryChoice` (put the chosen hand card on the top or bottom of the
  library), `handleSacrificeAnotherPermanentForBenefitAskChoice` (the `ask` stage: decline, report
  no other permanent, or queue the sacrifice TARGET_SELECTION) and
  `handleAttachEquipmentToPermanentChoice` (decline, report no Equipment, or queue the
  select-Equipment TARGET_SELECTION). The TARGET_SELECTION halves already live in
  `targetSelectionSacrificeFollowupHandlers.ts` and `targetSelectionTapCostAndAttachHandlers.ts`.
- Verified: `npx vitest run` green (19 tests) on
  `attach-equipment-to-permanent.integration`, `attach-equipment-to-permanent.replay`,
  `move-hand-card-to-library-choice.integration`, `move-hand-card-to-library-choice.replay`,
  `sacrifice-another-permanent-for-benefit.integration`,
  `sacrifice-another-permanent-for-benefit.replay`,
  `sacrifice-another-permanent-for-benefit.trigger.socket.integration`,
  `resolve-pending-effect-prompt.replay`.
- Typecheck: only the two pre-existing external errors (`game-actions.ts` ManaPool,
  `oracleIrServerZoneSync.ts` `unwrapYouDoResumeSteps`), both owned by other chats.

`resolution.ts` is now 426771 B (416.8 KB).

### Cluster 40 - "how do you pay it" OPTION_CHOICE prompts (done)

- New: `resolution-handlers/optionChoiceCostPlanPrompts.ts` (10.2 KB) with
  `handleSpellAdditionalCostBlightOrPayChoice` (cast additional cost "Blight N or pay {X}": paying
  tags the pending cast and asks for mana, blighting queues the Blight TARGET_SELECTION or aborts the
  cast when the player controls no creatures) and `handleChooseDiscardPlanChoice` (preferred-type
  discard when available, otherwise the generic fallback discard, or an empty-hand notice).
- The blight branch's inline payment closure is now the shared `emitPendingCastPaymentIfNeeded`
  from `resolutionPendingCastPaymentPrompt.ts` - same logic, only the debug(2) wording differs
  ("Additional-cost flow complete" vs "choice complete"); nothing asserts that string.
- Verified: `npx vitest run` green (64 tests) on `choose-discard-plan-choice.integration`,
  `choose-discard-plan-choice.replay`, `cast-spell-continuation.replay`,
  `request-cast.additional-cost-prompt-persistence.integration`, `ai-option-choice`,
  `blight-x-as-cost.battlefield-activation.resolution-queue.integration`,
  `targeting.templates.blight`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 416013 B (406.3 KB).

### Cluster 41 - "choose a player, they get the real prompt" (done)

- New: `resolution-handlers/optionChoiceChoosePlayerPrompts.ts` (7.8 KB) with
  `handleChoosePlayerForTwoPileSplitChoice` (queue the TWO_PILE_SPLIT for the chosen opponent,
  forwarding every `choosePileFromSplit*` rider) and `handleChoosePlayerForLookedAtCardsChoice`
  (queue the destination OPTION_CHOICE over the looked-at cards for the chosen player). The prompts
  they queue are handled by `optionChoiceLookedAtCardsAndPileHandlers.ts` from cluster 38.
- Verified: `npx vitest run` green (12 tests) on `choose-player-for-looked-at-cards.integration`,
  `choose-player-for-looked-at-cards.replay`, `choose-player-for-two-pile-split.replay`,
  `choose-pile-from-split-choice.integration`, `choose-looked-at-cards-destination.integration`,
  `oracle-ir-choose-pile-e2e.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 410167 B (400.6 KB).

### Cluster 42 - optional discard-then-draw and the mana-color picker (done)

- New: `resolution-handlers/optionChoiceDiscardAndManaColorPrompts.ts` (9.4 KB) with
  `handleOptionalDiscardThenDrawChoice` (decline, empty hand, or queue the DISCARD_SELECTION with
  the after-discard draw riders) and `handleChooseManaColorsChoice` (one color per prompt,
  re-queueing itself until every selection is made, then adding unrestricted or restricted mana).
  The mana branch keeps its dynamic `../util.js` imports.
- Verified: `npx vitest run` green (52 tests) on `choose-mana-colors-choice.integration`,
  `choose-mana-colors-choice.replay`, `optional-discard-then-draw.trigger.socket.integration`,
  `optional-discard-then-draw-choice.integration`, `exert-choice.integration`,
  `exert-choice.replay`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 402454 B (393 KB).

### Cluster 43 - exile play-permission and rebound prompts (done)

- New: `resolution-handlers/optionChoiceExilePlayPermissionPrompts.ts` (9 KB) with
  `handleGrantPlayableFromExileChoice` (pick which exiled card may be played, clear the tags on the
  others, write both the transient `playableFromExile` map and the durable permission) and
  `handleReboundCastChoice` (cast the exiled card for free onto the stack, or decline and send it
  to the graveyard through the replacement pipeline). The rebound branch keeps its own inline
  selection parsing because it defaults to `'decline'` rather than null.
- Dropped one unused `const reboundCard = stepData.reboundCard` binding; the branch only ever used
  `exiledCard`. The `stepData.reboundCard` guard on the call site is unchanged.
- Verified: `npx vitest run` green (37 tests) on
  `grant-playable-from-exile-choice.integration`, `grant-playable-from-exile-choice.replay`,
  `rebound-may-ability.integration`, `durable-permissions`,
  `playable-from-exile.library-search-replay.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 395551 B (386.3 KB).

### Cluster 44 - tail of handleOptionChoiceResponse (done)

- New: `resolution-handlers/optionChoiceEtbAndCounterPlacementPrompts.ts` (11.4 KB) with
  `handleEtbPermanentOptionChoice` (store the chosen ability/abilities on the battlefield permanent
  and persist an `optionChoice` event) and `handleCounterPlacementTriggerChoice` (record each
  player's accept/decline, then once no such step remains in the queue apply the +1/+1 counters and
  the "if a player does" rider - goad or can't-attack-you).
- New: `resolution-handlers/optionChoiceBoardActionPrompts.ts` (6.5 KB) with
  `handleTapOrUntapDecision` and `handleMoxDiamondStackChoice`, the two `step.action` keyed
  branches that closed the function.
- Control flow note: the counter-placement block never returned - it fell through to the two
  `step.action` checks. Its handler is therefore **synchronous** (the original body had no awaits)
  and its call site is a bare `handler(...);`, so the fallthrough does not gain a microtask
  boundary. Everything else is `await handler(...); return;`.
- Verified: `npx vitest run` green (19 tests) on `counter-events.replay`,
  `each-player-counter-placement.trigger.socket.integration`, `greymond-keywords`,
  `mox-diamond-choice.replay`, `option-choice.replay`, `tap-untap-choice.replay`,
  `tap-untap-choice-persistence.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`handleOptionChoiceResponse` is now a pure dispatch chain (~295 lines, all delegations).
`resolution.ts` is now 381403 B (372.5 KB).

### Cluster 45 - MANA_PAYMENT_CHOICE spell-cast payment (done)

- New: `resolution-handlers/manaPaymentSpellCastResponseHandlers.ts` (16.1 KB) with
  `handleSpellPaymentChoiceResponse`, the whole `stepData.spellPaymentRequired === true` body:
  the cancel path (drop the pending cast/targets, restore a suspended library search, un-flag a
  Miracle draw), the graveyard-cast payment path, the mutate detour that queues
  MUTATE_TARGET_SELECTION before finishing, and the completion path with its three did-not-complete
  outcomes (deferred to a follow-up prompt, re-queue the payment step, or report cast failure).
- `restoreLibrarySearchStep`, `resumePlayerSpellCastAfterPayment` and
  `emitNextPendingResolutionStep` are still parent-local, so they are passed in a `helpers`
  object (same pattern as `CastFromExilePromptHelpers`) rather than imported.
- Verified: `npx vitest run` green (154 tests) on `mana-payment-choice.selection.integration`,
  `cast-spell-payment.replay-no-reprompt`, `cast-spell-continuation.replay`,
  `mutate.cast-prompt.integration`, `mutate-target-selection.validate-before-complete.integration`,
  `cast-from-graveyard.graveyard-replay.integration`, `think-twice-hand-flashback.integration`,
  `adventure-cast-loop.integration`, `panglacial-wurm.library-search.integration`,
  `commander-free-cast.unit`, `cost-reduction-cast.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 366183 B (357.6 KB).

### Cluster 46 - pre-game hand steps (done)

- New: `resolution-handlers/preGameHandStepResponseHandlers.ts` (8.9 KB) with
  `handleOpeningHandActionsResponse` (put the chosen "begins the game on the battlefield" cards
  onto the battlefield, or persist a skip) and `handleHandToBottomResponse` (London mulligan
  bottoming: validate, move to the bottom in random order, finalize `mulliganState`, cancel
  duplicate prompts, then check for opening-hand actions).
- Control flow note: HAND_TO_BOTTOM had one path that `return`ed from `handleStepResponse`
  rather than breaking the switch (a selected card missing from hand). The handler now reports
  `'return' | 'break'` (exported as `StepResponseExit`) and the call site honours it.
- Verified: `npx vitest run` green (159 tests) on `mulligan-completion.replay`,
  `opening-hand-actions.replay`, `opening-hand-actions.validate-before-complete.integration`,
  `more-steps.validate-before-complete.integration`, `prompt-response-ai-replay-sweep.replay`,
  `ai-resolution-step.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`handleStepResponse` is now ~700 lines and its remaining cases are all delegations or small.
`resolution.ts` is now 358750 B (350.3 KB).

### Cluster 47 - AI keyword-ability auto-answers (done)

- New: `resolution-handlers/aiKeywordChoiceStepResponses.ts` (11.3 KB) with
  `buildAiKeywordChoiceStepResponse`, covering the contiguous run of AI cases in
  `handleAIResolutionStep`: FABRICATE_CHOICE, TRIBUTE_CHOICE, EXPLOIT_CHOICE, BACKUP_CHOICE,
  MENTOR_TARGET, ENLIST_CHOICE, EXTORT_PAYMENT, MODULAR_CHOICE, SOULSHIFT_TARGET, HAUNT_TARGET.
  Every one only reads fields off the step, so the module is a pure leaf - no `io`, `game` or
  queue access - and heuristics plus debug strings are unchanged.
- The ten case bodies collapsed into one dispatcher, so the parent now has a single fallthrough
  group of `case` labels assigning `response = buildAiKeywordChoiceStepResponse(step);`.
- Wiring exception: because it takes no `io`/`game` there is no cycle risk, so `resolution.ts`
  imports it directly (same as it already does for `resolutionManaPaymentApplication.js`) instead
  of routing through `resolutionHandlerDeps`. It is still named-re-exported from the barrel.
- Verified: `npx vitest run` green (181 tests) on `ai-resolution-step.integration`,
  `enlist-choice.integration`, `exploit-choice.integration`,
  `exploit-keyword.socket.replay.integration`, `extort-keyword.socket.replay.integration`,
  `extort-payment.integration`, `haunt-target.integration`, `keyword-etb-choice.integration`,
  `keyword-prompt-resolve.replay`, `mentor.attack-trigger.integration`,
  `mentor-target.integration`, `modular-choice.integration`, `soulshift-target.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 348811 B (340.6 KB).

## Cluster 48 - AI zone card-selection prompts (handleAIResolutionStep)

New file: `server/src/socket/resolution-handlers/aiZoneSelectionStepResponses.ts` (9.8 KB).
Entry: `buildAiZoneSelectionStepResponse(game, step)`.

- Moved the contiguous AI auto-answer run for prompts that pick/order cards in a zone:
  LIBRARY_SEARCH, GRAVEYARD_SELECTION, SCRY, SURVEIL, BOTTOM_ORDER, LIM_DULS_VAULT,
  DANCE_WITH_CALAMITY, DANCE_WITH_CALAMITY_CAST, DISCARD_SELECTION.
- Reads `game` (live hand for discard) but no `io`/queue, so `resolution.ts` imports it directly
  and the barrel named-re-exports it. Delegates to `chooseAILibrarySearchResponse`,
  `chooseAIGraveyardSelectionIds`, `chooseAIScrySelection` and `normalizeResolutionCardId` exactly
  as the parent did.
- Parent call site is one fallthrough `case` group assigning
  `response = buildAiZoneSelectionStepResponse(game, step);`.
- Verified: `npx vitest run` green (178 tests) on `ai-resolution-step.integration`,
  `ai.top-library.integration`, `ai-option-choice`, `prompt-response-ai-replay-sweep.replay`.
- Typecheck: unchanged - only the two pre-existing external errors
  (`game-actions.ts` ManaPool, `oracleIrServerZoneSync.ts` unwrapYouDoResumeSteps).

`resolution.ts` is now 341019 B (333.0 KB).

## Cluster 49 - AI one-shot choice prompts (handleAIResolutionStep)

New file: `server/src/socket/resolution-handlers/aiSimpleChoiceStepResponses.ts` (13.8 KB).
Entry: `buildAiSimpleChoiceStepResponse(game, step)`.

- Moved the contiguous AI auto-answer run for choice prompts that need at most the game state plus
  a `chooseAI*` helper: COLOR_CHOICE, CREATURE_TYPE_CHOICE, CARD_NAME_CHOICE,
  OPTION_CHOICE/MODAL_CHOICE, PLAYER_CHOICE, CASCADE, PONDER_EFFECT, TWO_PILE_SPLIT,
  DEVOUR_SELECTION, PROLIFERATE, LIFE_REDISTRIBUTION, FATESEAL, CLASH, VOTE, KYNAIOS_CHOICE,
  UPKEEP_SACRIFICE, RIOT_CHOICE, UNLEASH_CHOICE.
- Same wiring shape as cluster 48: direct import in `resolution.ts`, named re-export from the
  barrel, one fallthrough `case` group in the parent.
- Verified: `npx vitest run` green (182 tests) on `ai-resolution-step.integration`,
  `ai-option-choice`, `prompt-response-ai-replay-sweep.replay`,
  `ai.shared-battlefield-ability.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 329399 B (321.7 KB).

## Cluster 50 - AI cost / explore / mode decision prompts (handleAIResolutionStep)

New file: `server/src/socket/resolution-handlers/aiCostAndExploreStepResponses.ts` (7.6 KB).
Entry: `buildAiCostAndExploreStepResponse(game, step)`.

- Moved the contiguous AI auto-answer run for STATION_CREATURE_SELECTION, LIFE_PAYMENT,
  ADDITIONAL_COST_PAYMENT, SQUAD_COST_PAYMENT, EXPLORE_DECISION, BATCH_EXPLORE_DECISION,
  MODE_SELECTION, OPENING_HAND_ACTIONS, TEMPTING_OFFER and ACTIVATED_ABILITY.
- Only non-mechanical change: the early `break` inside STATION_CREATURE_SELECTION for an empty
  creature list is now an early `return` of the identical cancelled response.
- Same wiring shape as clusters 48/49: direct import in `resolution.ts` (no `io`/queue), named
  re-export from the barrel, one fallthrough `case` group in the parent.
- Verified: `npx vitest run` green - `ai-resolution-step.integration` (136), plus
  `ai-mode-selection`, `batch-explore-decision.validate-before-complete`,
  `explore-decision.validate-before-complete`, `life-payment.validate-before-complete`,
  `mode-selection.validate-before-complete`, `opening-hand-actions.replay`,
  `opening-hand-actions.validate-before-complete`, `squad-cost-payment.validate-before-complete`,
  `station-creature-selection.validate-before-complete`, `tempting-offer.replay`,
  `tempting-offer.validate-before-complete` (19).
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 323947 B (316.4 KB).

## Cluster 51 - AI battlefield target prompts (handleAIResolutionStep)

New file: `server/src/socket/resolution-handlers/aiTargetSelectionStepResponses.ts` (13.2 KB).
Entry: `buildAiTargetSelectionStepResponse(game, gameId, step, helpers)`.

- Moved the contiguous AI auto-answer run for FIGHT_TARGET, TAP_UNTAP_TARGET, TARGET_SELECTION,
  MUTATE_TARGET_SELECTION, COUNTER_MOVEMENT and COUNTER_TARGET.
- `getFilteredValidTargetsForStep` is still a private function of `resolution.ts`, so it is passed
  in through an `AiTargetSelectionStepHelpers` object instead of being imported (same shape as the
  helpers bag used by `handleSpellPaymentChoiceResponse`).
- The MUTATE branch still stamps `pendingSpellCasts[effectId]` before returning, preserving the
  documented race fix.
- Early `break`s for "no legal target" became early `return`s of the identical cancelled responses.
- Verified: `npx vitest run` green (142 tests) on `ai-resolution-step.integration`,
  `fight-target.validate-before-complete`, `tap-untap-target.validate-before-complete`,
  `counter-movement.validate-before-complete`, `counter-target.validate-before-complete`,
  `mutate-target-selection.validate-before-complete`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 312828 B (305.5 KB).

## Cluster 52 - AI X / mana-color / hand / draft prompts (handleAIResolutionStep)

New file: `server/src/socket/resolution-handlers/aiHandAndDraftStepResponses.ts` (7.0 KB).
Entry: `buildAiHandAndDraftStepResponse(game, step)`.

- Moved the opening AI auto-answer run of the switch: X_VALUE_SELECTION, MANA_COLOR_SELECTION,
  HAND_TO_BOTTOM, RETURN_CONTROLLED_PERMANENT_CHOICE, HIDEAWAY_CHOICE, REPEATED_ZONE_DRAFT,
  JOIN_FORCES.
- Four branches used to `break` without assigning a response (nothing to bottom, not enough cards,
  no permanent / hideaway card / draft card). They now `return null`, and because the parent call
  site is `response = buildAiHandAndDraftStepResponse(...)` with `response` initialised to null,
  the observable result is identical.
- Same wiring shape as clusters 48-51: direct import in `resolution.ts`, named re-export from the
  barrel, one fallthrough `case` group in the parent.
- Verified: `npx vitest run` green (150 tests) on `ai-resolution-step.integration`,
  `hideaway-choice.replay`, `join-forces.replay`, `join-forces.validate-before-complete`,
  `repeated-zone-draft.replay`, `return-controlled-permanent-choice.integration`,
  `x-value-selection.validate-before-complete`, `gwenna-mana-color-selection.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 308033 B.

## Cluster 53 - pre-complete validation for hand / zone card prompts

New file: `server/src/socket/resolutionRegisterPreCompleteValidationForZoneSelectionSteps.ts`
(17.9 KB). Third validation sibling, created because
`...ForExtractedSteps.ts` (37.5 KB) and `...ForStepResponseClusters.ts` (34.1 KB) are both close to
the 40KB ceiling.

Entries:
- `validateHandSelectionStepsBeforeComplete` (sync) - DISCARD_SELECTION + HAND_TO_BOTTOM.
- `validateGraveyardSelectionBeforeComplete` (async - collect evidence does a dynamic
  `import('../state/utils.js')`) - GRAVEYARD_SELECTION.
- `validateLibrarySearchBeforeComplete` (sync) - LIBRARY_SEARCH, including the maxTypes /
  requireDifferentNames / maxTotalManaValue / split-destination checks.

- Moved out of the `submitResolutionResponse` socket handler in `resolution.ts`; every `return`
  after a `socket.emit('error', ...)` became `return false`, and the call sites `return` on false.
- The graveyard validator is called from inside the original
  `if (step.type === GRAVEYARD_SELECTION && !cancelled)` guard rather than unconditionally, so the
  new `await` only happens for graveyard steps - no extra microtask for any other step type.
- Dropped five imports from `resolution.ts` that no longer had a user: `normalizeResolutionCardId`,
  `buildResolutionHandIdSet`, `getSelectedGraveyardCardsForStep`, `cardHasCreatureType`, `parsePT`.
- Verified: `npx vitest run` green (23 + 13 tests) on `cultivate.library-search-replay`,
  `library-search-resolve.replay`, `library-search-trigger.integration`,
  `mulligan-completion.replay`, `spell-library-search.regression.integration`,
  `graveyard-tutor.library-search-replay`, `panglacial-wurm.library-search.integration`,
  `kodama-reach-oracle-ir-library-search.integration`, `cleanup-discard.replay.integration`,
  `discard-effect.replay.integration`, `oracle-ir-discard.integration`,
  `windfall-discard-replay.integration`, `madness.discard-replay.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 291670 B.

## Cluster 54 - pre-complete validation for single-answer choice prompts

New file: `server/src/socket/resolutionRegisterPreCompleteValidationForChoicePromptSteps.ts`
(17.7 KB). Fourth validation sibling.
Entry: `validateChoicePromptStepsBeforeComplete(args)` (sync).

- Moved the contiguous validation run for X_VALUE_SELECTION (including the Blight X
  activation-cost guard), KYNAIOS_CHOICE, RETURN_CONTROLLED_PERMANENT_CHOICE, HIDEAWAY_CHOICE,
  REPEATED_ZONE_DRAFT, DEVOUR_SELECTION, UPKEEP_SACRIFICE and PLAYER_CHOICE out of the
  `submitResolutionResponse` socket handler.
- All eight branches were synchronous, so the call site stays synchronous - no new microtask
  boundary anywhere in the validation chain.
- Each `socket.emit('error', ...)` + `return` became `return false`; the single call site returns
  on false. Order relative to `validateStepResponseClusterStepsBeforeComplete` is unchanged.
- Verified: `npx vitest run` green (142 + 13 tests) on `ai-resolution-step.integration`,
  `x-value-selection.validate-before-complete`, `return-controlled-permanent-choice.integration`,
  `hideaway-choice.replay`, `repeated-zone-draft.replay`,
  `devour-selection.validate-before-complete`, `kynaios-choice.replay`,
  `kynaios-choice.validate-before-complete`, `kynaiosChoice`, `player-choice.replay`,
  `player-choice.validate-before-complete`, `upkeep-sacrifice.validate-before-complete`,
  `oracle-ir-player-choice.integration`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 275001 B.

## Cluster 55 - pre-complete validation for mode / trigger-order / opening-hand steps

New file: `server/src/socket/resolutionRegisterPreCompleteValidationForModeAndTriggerSteps.ts`
(11.1 KB). Fifth validation sibling.
Entry: `validateModeTriggerAndOpeningHandStepsBeforeComplete(args)` (sync).

- Moved MODE_SELECTION (normal range, entwine, {P} budget via `isValidPBudgetSelection`,
  duplicate and membership checks), TRIGGER_ORDER and OPENING_HAND_ACTIONS validation out of the
  `submitResolutionResponse` socket handler.
- The new call sits exactly where the MODE_SELECTION block used to be, i.e. after
  `validateExtractedStepTypesBeforeComplete` and before
  `validateStepResponseClusterStepsBeforeComplete`, so validation order is unchanged.
- Verified: `npx vitest run` green (17 + 2 tests) on `mode-selection.validate-before-complete`,
  `mode-selection-p-budget.unit`, `overload-mode-selection.integration`,
  `abundant-harvest.mode-selection.resumption.integration`,
  `opening-hand-actions.validate-before-complete`, `opening-hand-actions.replay`,
  `teamwork-choose-mode.socket.integration`, `trigger-order.replay`,
  `trigger-order.validate-before-complete`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 265382 B.

## Cluster 56 - pre-complete validation for OPTION_CHOICE steps

New file: `server/src/socket/resolutionRegisterPreCompleteValidationForOptionChoiceSteps.ts`
(18.1 KB). Sixth validation sibling.

Entries:
- `validateOptionChoiceSelectionShapeBeforeComplete` (sync) - format, duplicates, min/max, the
  land-would-enter sacrifice special case, membership in the step's options.
- `validateOptionChoicePayCostPromptsBeforeComplete` (async) - dredge replacement, optional
  payment prompts, reflexive mana / fixed payments, opponent-may-pay, sacrifice-unless-pay, ward
  payments (mana / life / discard / sacrifice) and the combat attack tax. Keeps the two local
  helpers `validateManaCostPayable` and `validateGenericAmountPayable` verbatim, including the
  dynamic `import('./util.js')`.
- The async validator is called from inside the original
  `if (step.type === OPTION_CHOICE && !cancelled)` guard, so no other step type gains an await.
- Verified: `npx vitest run` green (66 tests) on `option-choice.replay`,
  `option-choice.validate-before-complete`, `ward-payment.integration`, `ward-payment.replay`,
  `ward-spell-cast-pending.integration`, `dredge-draw-replacement.replay`,
  `attack-cost-payment.resolution-queue.integration`, `optional-payment-prompts.integration`,
  `optional-payment-prompt-resolve.replay`, `may-ability-option-choice.integration`,
  `ai-option-choice`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 248959 B.

## Cluster 57 - pre-complete validation for non-mana cost prompts

New file: `server/src/socket/resolutionRegisterPreCompleteValidationForCostPaymentSteps.ts`
(12 KB). Seventh validation sibling.
Entry: `validateCostPaymentStepsBeforeComplete(args)` (sync).

- Moved LIFE_PAYMENT, ADDITIONAL_COST_PAYMENT (discard / sacrifice / remove_counters / reveal /
  behold / teamwork, including the teamwork total-power check via `getEffectivePower`) and
  SQUAD_COST_PAYMENT validation out of the `submitResolutionResponse` socket handler.
- The call sits where the LIFE_PAYMENT block was, i.e. after the LIBRARY_SEARCH validator and
  before the phyrexian MANA_PAYMENT_CHOICE block, so ordering is unchanged.
- Verified: `npx vitest run` green (10 + 18 tests) on
  `life-payment.validate-before-complete`, `squad-cost-payment.validate-before-complete`,
  `additional-cost-payment.validate-before-complete`, `additional-cost-mode-oracle-text.unit`,
  `discard-typed-as-cost.battlefield-activation.resolution-queue`,
  `discard-and-sacrifice-as-cost.battlefield-activation.resolution-queue`,
  `remove-counters-as-cost.battlefield-activation`,
  `remove-counters-other-permanent-as-cost.battlefield-activation.resolution-queue`,
  `request-cast.additional-cost-sacrifice`, `request-cast.additional-cost-pay-life`,
  `request-cast.additional-cost-prompt-persistence`,
  `cast-spell-from-hand.additional-cost-madness`, `teamwork-choose-mode.socket`.
- Typecheck: unchanged - only the two pre-existing external errors.

`resolution.ts` is now 238535 B.

## Cluster 58 - MANA_PAYMENT_CHOICE / tap-cost / EXTORT / EXPLOIT pre-complete validation

- New: `server/src/socket/resolutionRegisterPreCompleteValidationForManaAndSacrificeSteps.ts` (10.3 KB)
  - `validateManaPaymentChoiceStepBeforeComplete` (async; delegates to the existing phyrexian validator,
    then activation-payment mana apply prevalidation and the pending-cast guard)
  - `validateTapCostExtortAndExploitStepsBeforeComplete` (sync; tap-creatures-as-cost TARGET_SELECTION,
    EXTORT_PAYMENT mana apply, EXPLOIT_CHOICE sacrifice legality)
- `resolution.ts` 238.5 KB -> 225.7 KB. The async validator is called only inside
  `if (step.type === ResolutionStepType.MANA_PAYMENT_CHOICE)` so no other step type gains a microtask.
- Typecheck: only the two known pre-existing errors from other chats
  (`game-actions.ts` ManaPool index signature, `oracleIrServerZoneSync.ts` unwrapYouDoResumeSteps).
- Vitest green: exploit-choice, exploit-keyword.socket.replay, extort-keyword.socket.replay, extort-payment,
  mana-payment-choice.selection, phyrexian-mana-payment-choice-as-cost.battlefield-activation,
  summon-the-school.loop-replay, ward-payment.
- `summon-the-school.graveyard-recursion.integration.test.ts` fails, but it fails identically with
  `resolution.ts` stashed back to HEAD - pre-existing breakage from concurrent work, not this cluster.

## Cluster 59 - TARGET_SELECTION / MUTATE_TARGET_SELECTION pre-complete validation

- New: `server/src/socket/resolution-handlers/resolutionTargetSelectionDistinctTargetUtils.ts` (3.6 KB)
  - `stepIndicatesDifferentTarget`, `getPreviouslyChosenTargetsForSource`, `getFilteredValidTargetsForStep`
    lifted verbatim out of `resolution.ts` (they were private, which is why
    `aiTargetSelectionStepResponses.ts` had to take the filter as an injected helper). Injection left
    as-is - behaviour-preserving split only. Re-exported from `resolution-handlers/index.ts`.
- New: `server/src/socket/resolutionRegisterPreCompleteValidationForTargetSelectionSteps.ts` (8.9 KB)
  - `validateTargetSelectionStepsBeforeComplete` (sync): selection shape, min/max bounds, duplicate
    targets, valid-target membership, shared-card-type rule, battlefield/graveyard existence checks for
    the action-driven prompts, equipment-attach legality, distinct-target enforcement, plus the
    MUTATE_TARGET_SELECTION effectId / target / pending-cast checks.
  - Takes `gameId` and `stepId` in its args (needed for the completed-step scan and the debugWarn text).
- `resolution.ts` 225.7 KB -> 217.8 KB.
- Typecheck: only the two known pre-existing errors from other chats.
- Vitest green: resolution.distinct-targets, target-selection.stale-target.validate-before-complete,
  mutate-target-selection.validate-before-complete, ai-target-selection, ai-choice-target-selection,
  per-opponent-target-selection, etb-target-selection, attach-equipment-to-permanent (33 tests).

## Cluster 60 - activation-cost step pre-complete validation

- New: `server/src/socket/resolutionRegisterPreCompleteValidationForActivationCostSteps.ts` (10.2 KB)
  - `validateActivationCostStepsBeforeComplete` (async; the mana check dynamically imports
    `./util.js` exactly as the inline closure did, so timing is unchanged).
  - Covers TAP_UNTAP_TARGET tapOtherAbilityAsCost, DISCARD_SELECTION discard/exileFromHand as cost,
    GRAVEYARD_SELECTION graveyardExile as cost, and the TARGET_SELECTION variants
    removeCounters / sacrifice / returnToHand / keywordBlight ability_activation_cost.
  - The whole cluster was one `if (!cancelled) { ... }` block; the guard became an early
    `if (cancelled) return true;` and each inner `return` became `return false`.
- `resolution.ts` 215.0 KB -> 206.2 KB.
- Typecheck: only the two known pre-existing errors from other chats.
- Vitest green (24 tests): tap-other-as-cost, discard-and-sacrifice-as-cost, discard-typed-as-cost,
  exile-graveyard-as-cost, exile-hand-as-cost, remove-counters-as-cost,
  remove-counters-other-permanent-as-cost, return-to-hand-as-cost, sacrifice-as-cost.pay-life,
  sacrifice-self-as-cost, blight-x-as-cost, activated-ability.validate-before-complete,
  gemstone-array-remove-counter-cost.
