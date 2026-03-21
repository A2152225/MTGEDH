# Merfolk Iteration Audit Summary

## Scope

This note records the outcome of the Merfolk iteration fixture audit and the concrete fixes needed to make the fixture cards behave correctly in real server and rules-engine flows.

Fixture cards audited:

- Merrow Reejerey
- Anointed Procession
- Deeproot Waters
- Exalted Sunborn
- Summon the School
- Nykthos, Shrine to Nyx
- Stonybrook Banneret
- Judge of Currents
- Drowner of Secrets
- Helm of the Host

## Bugs Found And Fixed

### 1. Summon the School spell body missing in cast-driven resolution

Problem:

- Real cast flow resolved the cast triggers correctly.
- The spell itself could resolve without usable oracle text on the stack object.
- Result: Deeproot Waters tokens appeared, but Summon the School's own token creation could be skipped.

Fix:

- In `rules-engine/src/RulesEngineAdapter.ts`, spell stack metadata now falls back to the source card's `oracle_text`, `type_line`, and resolved card name when the action payload does not provide them.

Effect:

- Real hand-cast Summon the School now resolves through Oracle IR correctly.
- Stacked token doublers now apply to both Deeproot Waters and Summon the School token creation during the same cast.

### 2. Banneret cost reduction only trusted narrow server-side cases

Problem:

- Queue-facing mana payment prompts could show unreduced costs.
- Banneret handling was too dependent on narrow name-specific logic instead of the actual oracle text pattern.

Fix:

- Server cost reduction now derives Banneret subtype reductions from the permanent's oracle text.
- Queue-visible mana costs now use reduced display costs.

Effect:

- Stonybrook Banneret works correctly.
- Other Bannerets that share the same oracle pattern also work without one-off logic.

### 3. Drowner of Secrets activation stopped short after interactive tap-cost handling

Problem:

- After selecting a Merfolk to tap for the activation cost, the flow could fail to continue cleanly into target selection and stack assembly.

Fix:

- The server resolution continuation path now resumes the activated ability flow after interactive cost payment and carries the activation data forward into stack creation.

Effect:

- Drowner of Secrets now reaches the target-player selection step and completes its activation flow correctly.

### 4. Judge of Currents failed on noncombat taps

Problem:

- Combat had explicit tap-trigger handling.
- Noncombat taps performed in `server/src/socket/resolution.ts` only flipped tapped state and persisted tap events.
- `appendEvent('permanent_tapped')` and `applyEvent` did not enqueue `becomes tapped` triggers.

Fix:

- Added generic noncombat tap-trigger dispatch in `server/src/socket/resolution.ts` using `getTapTriggers(...)`.
- Wired it into:
  - normal tap/untap resolution steps
  - interactive battlefield-ability tap-cost continuations
  - graveyard tap-creatures costs such as Summon the School

Effect:

- Judge of Currents now triggers correctly from activation-cost taps and graveyard-cost taps, not just combat taps.

### 5. Legacy Tribal vs current Kindred type handling

Problem:

- Current Oracle-facing data uses `Kindred`.
- Some rules-critical counting and evaluation paths still treated `tribal` as the operative type or ignored it during card-type counting.

Fix:

- Canonicalized legacy `tribal` to `kindred` in rules-critical type extraction and graveyard card-type counting paths.

Effect:

- Kindred cards now count correctly for delirium-style checks and `where X is the number of card types among cards in your graveyard` effects.

## Validation Performed

Focused server regressions:

- `server/tests/rules-bridge.choice-required.integration.test.ts`
- `server/tests/drowner-of-secrets.activation.integration.test.ts`
- `server/tests/summon-the-school.graveyard-recursion.integration.test.ts`
- `server/tests/nykthos.devotion-color-choice.integration.test.ts`
- `server/tests/stonybrook-banneret.request-cast.integration.test.ts`
- `server/tests/helm-of-the-host.begin-combat.test.ts`
- `server/tests/rules-bridge.phase-triggers.integration.test.ts`

Focused rules-engine regressions:

- `rules-engine/test/triggersHandler.test.ts`
- `rules-engine/test/triggerParsing.test.ts`
- `rules-engine/test/oracleIRExecutor.test.ts`
- `rules-engine/test/tokenCreation.test.ts`

Repo-level verification:

- `npm run build`
- `npm test`

Final repo-level result at the end of the audit:

- Full build passed.
- Full workspace test command passed.
- Rules-engine suite passed with 3826 tests.

## Final Audit Conclusion

No further implementation gaps were found for the Merfolk iteration fixture after the fixes above.

The remaining cards in the fixture now fall into one of these states:

- fixed and directly regression-tested in a real server flow
- fixed and regression-tested in the rules engine
- exercised through shared cast, trigger, and token-doubling integration coverage

At audit close, the fixture no longer had an identified card that still required new implementation work to function correctly.