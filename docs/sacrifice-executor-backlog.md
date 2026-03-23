# Sacrifice Executor Backlog

Baseline snapshot: `tools/sacrifice-executor-coverage.json` generated `2026-03-23T09:13:24.522Z`

This file is the working progress tracker for corpus-driven sacrifice coverage.
Counts below are grouped from the refreshed corpus audit and updated manually as implementation lands.

Current corpus snapshot:
- `deterministic/context-bound supported cards`: `716`
- `semantically understood but choice-required cards`: `366`
- `primary remaining timing-aware delayed-cleanup bucket`: `0` clauses after audit/runtime alignment
- `unsupported sacrifice-effect cards`: `8`

## Completed

- `done`: Self-referential sacrifice selectors
Count from baseline: `it` 83, `this creature` 75, `this enchantment` 34, `this artifact` 15, `this aura` 14, `this land` 4
Notes: Deterministic self-sacrifice now works when the source permanent is known. `unless ...` variants still persist skips instead of forcing unsafe execution.

- `done`: Single-type `another ...` sacrifice selectors
Count from baseline: `another creature` 27, `another artifact` 4, `another permanent` 4
Notes: Source permanent is excluded; execution only happens when the remaining legal pool is deterministic.

- `done`: Mixed-type union sacrifice selectors
Count from baseline: `another creature or artifact` 8, `another creature or an artifact` 6, `an artifact or creature` represented in supported-card corpus samples
Notes: Union pools are handled conservatively as a single legal-choice set.

- `done`: Single-word subtype/token sacrifice selectors
Count from baseline: `a food` 6, `a vampire` 4, `a token` 3, `a homunculus` sample-backed
Notes: Deterministic support now exists for article-led subtype/token wording when the matching permanent pool is unambiguous.

- `done`: Contextual sacrifice references
Count from refreshed audit: `that creature` 6, `that permanent` 3
Notes: Deterministic support now exists when antecedent object ids are already bound in execution context (`targetPermanentId`, `targetCreatureId`, or chosen object ids).

- `done`: Pre-sacrifice last-known-information snapshots
Count from rules coverage: applies to sacrifice follow-ups that care about the sacrificed permanent's pre-zone-change characteristics
Notes: Sacrifice execution now snapshots battlefield state before removal so downstream `where X is the sacrificed creature's power|toughness|mana value` and `gain/lose life equal to ...` follow-ups can use real last known information instead of printed graveyard card-face values.

- `done`: Explicit player-choice sacrifice selectors are now semantically classified
Count from refreshed audit: `a creature of their choice` 52, `a land of their choice` 15, `two creatures of their choice` 6, `a creature or planeswalker of their choice` 5, `a permanent of their choice` 5
Notes: These are no longer tracked as generic unsupported selectors. The executor now records them as `player_choice_required` gaps so future prompt work has a clean backlog without unsafe guessing.

- `done`: Bounded quantity sacrifice selectors are now semantically classified
Count from refreshed audit: `any number of creatures` 3
Notes: These also now land as `player_choice_required` instead of `unsupported_object_selector`.

- `done`: Residual prevention-cost self-sacrifice variants are now semantically classified
Count from refreshed audit: `it unless you pay {1}` 5, `this creature unless you discard a card` 4, `this creature unless you pay {g}{g}` 4, `it unless it escaped` 3, `it unless you discard a card at random` 3, `it unless you discard a land card` 3, `this creature unless you pay {u}` 3, `this enchantment unless you pay {w}{w}` 3
Notes: These remain intentionally unforced, but they now persist as player-choice/payment gaps instead of generic unsupported sacrifice selectors.

- `done`: Broader selector-shape parity pass
Count from refreshed audit/tooling pass: supported-card baseline moved from `481` to `496`, choice-required baseline moved from `346` to `357`
Notes: The executor and audit parser now both recognize word-number quantity selectors (for example `two creatures`), additional contextual aliases (`the token`, `the creature`, `those creatures`), subtype-token phrasing (`a Blood token`, `two Food tokens` style shapes), missing self-alias coverage like `this Equipment`, subtype-wide `all <Subtype> you control`, and more semantic-but-choice-bound quantity phrases (`X ...`, `one of them`, `that many ...`, `up to ...`) as explicit `player_choice_required` instead of generic unsupported selectors.

- `done`: Sacrifice-leading conjunction splitting
Count from refreshed audit/tooling pass: supported-card baseline moved from `504` to `542` while `choice-required` stayed `357`
Notes: Conservative parser splitting now handles imperative clauses like `Sacrifice this artifact and draw three cards`, `Sacrifice this enchantment and counter that spell`, and `Sacrifice Scavenger Hunt, then open an Attraction`. The sacrifice half executes deterministically, while unresolved follow-up text remains an explicit skipped step / automation gap instead of blocking the whole clause.

- `done`: Legendary shorthand self-reference normalization and vehicle contextual support
Count from refreshed audit/tooling pass: supported-card baseline moved from `542` to `545` while `choice-required` stayed `357`
Notes: Oracle-text normalization now treats shorthand self-references like `Endrek Sahr` from `Endrek Sahr, Master Breeder` as `this permanent`, and delayed/contextual sacrifice binding now understands `that Vehicle` / `this Vehicle`. This closed remaining deterministic misses like `Endrek Sahr`, `Egon`, and `Goblin Crash Pilot` without broadening condition-gated clauses unsafely.

- `done`: Attachment-aware sacrifice selectors and `one or more ...` choice classification
Count from refreshed audit/tooling pass: supported-card baseline moved from `545` to `547`, choice-required moved from `357` to `358`
Notes: The executor and audit parser now understand both attachment directions: source-attached selectors like `enchanted creature`, and source-anchored attachment selectors like `an Equipment attached to this permanent` / `... attached to Outfitted Jouster`. Deterministic singleton attachments now execute, multi-attachment pools now persist `player_choice_required`, and `one or more Treasures`-style wording is explicitly classified as choice-bound instead of generic unsupported text.

- `done`: Delayed cleanup audit/runtime parity
Count from refreshed audit/tooling pass: supported-card baseline moved from `547` to `709`, delayed-cleanup sample bucket moved from `25` to `0`
Notes: The corpus audit now classifies supported timing-qualified cleanup wording the same way the parser/executor already handles it. Clauses like `sacrifice it at end of combat`, `sacrifice them at the beginning of the next end step`, and contextual cleanup variants now contribute to deterministic support or `player_choice_required` based on the underlying selector instead of lingering in a generic delayed-follow-up bucket.

- `done`: Token provenance + leave-the-battlefield cleanup support
Count from refreshed audit/tooling pass: supported-card baseline moved from `709` to `716`, choice-required moved from `358` to `360`
Notes: Tokens now retain their creating source id, so `sacrifice each token created with it` resolves against the original source-linked tokens instead of all lookalikes. Delayed battlefield cleanup also now supports `when that token leaves the battlefield` watchers and `at the beginning of the next cleanup step`, closing narrow but important sacrifice timing/reference gaps without unsafe guessing.

- `done`: Condition-gated sacrifice cleanup and immediate counter-threshold support
Count from refreshed audit/tooling pass: supported-card baseline moved from `716` to `718`, unsupported clause samples moved from `21` to `19`
Notes: The parser/executor now understands narrow, explicit battlefield conditions on sacrifice clauses: `if it has mana value N or less/greater` and `if it has N or more/less <counter> counters on it`. These now work both for immediate sacrifice and delayed cleanup re-resolution, while false conditions remain non-gap no-ops and unsupported evaluations still persist automation gaps.

- `done`: Next-upkeep cleanup timing and zero-counter sacrifice conditions
Count from refreshed audit/tooling pass: supported-card baseline moved from `718` to `720`, unsupported clause samples moved from `19` to `17`
Notes: The delayed battlefield scheduler now understands `at the beginning of your/the next upkeep` cleanup wording, and the condition parser/executor/audit now recognize zero-counter checks like `if there are no echo counters on it`. That closes residual deterministic gaps such as `those tokens at the beginning of your next upkeep` and `this enchantment if there are no echo counters on it` without widening unsafe choice resolution.

- `done`: Lose-control delayed sacrifice watchers
Count from refreshed audit/tooling pass: supported-card baseline moved from `720` to `722`, unsupported clause samples moved from `17` to `15`
Notes: Delayed battlefield cleanup now supports `Sacrifice it when you lose control of this creature` and `Sacrifice the creature when you lose control of this creature` end-to-end. The parser schedules `when_control_lost` cleanup, the adapter watches battlefield control diffs without retro-firing newly created triggers, and the audit now classifies these phrases as deterministic support.

- `done`: Sacrifice corpus audit hygiene for replacement-cost and opponent-choice wording
Count from refreshed audit/tooling pass: deterministic supported baseline moved from `722` to `721`, choice-required moved from `360` to `362`, unsupported clause samples moved from `15` to `6`
Notes: This was classification cleanup rather than an executor regression. The audit now treats `any opponent may sacrifice a creature of their choice` as explicit `player_choice_required`, treats land-entry replacement wording like `If this land would enter, sacrifice a Forest instead` as non-executor sacrifice text instead of unsupported effect execution, and normalizes quoted self-reference noise like `sacrifice it."`.

- `done`: Named-self conjunction audit/parser parity refresh
Count from refreshed validation pass: deterministic supported baseline moved from `721` to `709`, choice-required stayed `362`, unsupported clause samples moved from `6` to `19`
Notes: This was another accounting correction, not an executor capability regression. Unconditional named-self conjunctions like `Sacrifice Tellah and it deals 3 damage to each opponent` still split safely and now have direct parser regression coverage. The cards that moved back into `unsupported` are mainly leading condition-wrapped multi-action clauses such as `If you don't, sacrifice this creature and draw a card`, which the parser still conservatively leaves as a single unknown step because the wrapper condition is not modeled end-to-end yet.

- `done`: Leading conditional sacrifice-wrapper IR preservation
Count from refreshed validation pass: corpus counts unchanged at `709` deterministic / `362` choice-required / `19` unsupported
Notes: Leading black-border shapes like `If you don't, sacrifice this artifact and draw three cards` and `If ... was spent, sacrifice Tellah and it deals ...` now preserve a structured `conditional` wrapper in Oracle IR instead of collapsing into a single opaque unknown step. Executor handling remains conservative: supported generic controller-state predicates can run the wrapped steps, false conditions no-op without recording a gap, and unsupported wrapper conditions persist a precise conditional automation gap instead of losing the shape. The first practical execution slice is also live now: mana-spent wrappers can evaluate against source cast metadata, and `that much damage` in that wrapper now binds back to the source's actual mana spent.

- `done`: Sacrifice audit parity for mana-spent conditional wrappers
Count from refreshed audit/tooling pass: deterministic supported baseline moved from `709` to `710`, unsupported clause samples moved from `19` to `18`
Notes: The corpus audit now matches the executor's first supported leading-conditional subfamily. Clauses like `If eight or more mana was spent to cast that spell, sacrifice Tellah and it deals that much damage to each opponent.` no longer linger in `unsupported`; they are counted as deterministic support while other wrapper families remain conservative until their conditions are truly evaluable.

- `done`: Exact-count graveyard antecedents for `If you can't` sacrifice fallbacks
Count from refreshed validation + audit pass: deterministic supported baseline moved from `710` to `711`, unsupported clause samples moved from `18` to `17`
Notes: The move-zone executor now understands exact-count `N cards from your graveyard` selectors well enough to distinguish three states safely: deterministic success, impossible action, and player-choice-required over-selection. That lets `If you can't, sacrifice Egon and draw a card.` resolve correctly only when the antecedent exile is truly impossible, while still refusing to guess when the graveyard contains extra legal cards. The sacrifice audit now also threads immediate prior-clause context for this narrow family so Egon-class fallbacks no longer stay stranded in `unsupported`.

- `done`: Practical conditional-wrapper residue (`Bucket List`, `Gargantuan Gorilla`, `Captain Rex Nebula`, `Cocoon`)
Count from refreshed validation + audit pass: deterministic supported baseline moved from `711` to `716`, choice-required moved from `362` to `366`, unsupported clause samples moved from `17` to `8`
Notes: This closed the remaining practical black-border wrapper tail. Parser support now preserves comma-delimited conditional bodies and `then`-split wrapper bodies, `draw one more card` now parses deterministically, `remove a <counter> from this <permanent>` antecedents can resolve/impossible out safely for `If you can't` fallbacks, die-roll equality against the source permanent's mana value is evaluable for `Captain Rex Nebula`, and the audit now normalizes self-references inside wrapper conditions plus threads relevant antecedents across intermediate clauses.

## Ordered Remaining Work

- `1. silver-border / acorn / joke-text residuals`
Representative counts from refreshed audit: `this creature after it enters` 1, `this creature when your head stops touching the table` 1, `it (the card, not your head` 1, `this enchantment and said player discards their complement of cards in hand (hereafter known as "hand"` 1, `this artifact and put all cards exiled with it into their owners' hands` 1
Status: `pending`
Why lower priority: The practical black-border backlog is now closed. The remaining unsupported residue is silver-border/acorn/joke text and can stay intentionally deferred unless the project later chooses to automate casual-variant cards.

## Current Focus

- `active`: Keep choice-bound sacrifice wording in the explicit `player_choice_required` bucket rather than letting it drift back into generic unsupported skips.
- `active`: Treat the remaining unsupported sacrifice residue as intentional silver/acorn/joke-card deferrals unless product scope changes.
- `active`: Validate after each backlog slice with `npm.cmd run typecheck --workspace=rules-engine` and focused Vitest.
