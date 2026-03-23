# Sacrifice Executor Backlog

Baseline snapshot: `tools/sacrifice-executor-coverage.json` generated `2026-03-23T02:32:49.666Z`

This file is the working progress tracker for corpus-driven sacrifice coverage.
Counts below are grouped from the corpus object-phrase backlog and updated manually as implementation lands.

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

## Ordered Remaining Work

- `1. delayed cleanup sacrifice follow-ups`
Baseline counts: `it at the beginning of the next end step` 46, `them at the beginning of the next end step` 38, `it at end of combat.)` 22, `it at end of combat` 8, `it at the beginning of the next end step.)` 8, `it at the beginning of your next end step` 7, `that creature at the beginning of the next end step` 6, `them at the beginning of the next end step.)` 6, `this creature at the beginning of the next end step` 6, `that token at the beginning of the next end step` 4, `that token at end of combat` 3, `those tokens` 3
Status: `pending`
Why high priority: This is the biggest remaining batch after the self/another work and it affects many temporary-permanent templates.

- `2. explicit player-choice sacrifice selectors`
Baseline counts: `a creature of their choice` 59, `a land of their choice` 15, `a creature or planeswalker of their choice` 6, `a permanent of their choice` 6, `two creatures of their choice` 6, `a nontoken creature of their choice` 5, `an attacking creature of their choice` 3, `an enchantment of their choice` 3, `a permanent of their choice unless they pay {1}` 3
Status: `pending`
Why high priority: These are semantically understood sacrifice effects, but full support wants a player-choice prompt path rather than executor guessing.

- `3. contextual sacrifice references`
Baseline counts: `that creature` 6, `that permanent` 3
Status: `pending`
Why high priority: These are common follow-up references that should become deterministic once we bind the antecedent object set.

- `4. bounded quantity sacrifice selectors`
Baseline counts: `any number of creatures` 3
Status: `pending`
Why high priority: This likely needs a prompt/selection path, but the phrase family is compact and corpus-visible.

- `5. residual prevention-cost self-sacrifice variants`
Baseline counts: `it unless you pay {1}` 5, `this creature unless you discard a card` 4, `this creature unless you pay {g}{g}` 4, `it unless it escaped` 3, `it unless you discard a card at random` 3, `it unless you discard a land card` 3, `this creature unless you pay {u}` 3, `this enchantment unless you pay {w}{w}` 3
Status: `pending`
Why high priority: These are now tracked accurately as persisted skips; supporting them fully likely belongs with choice/cost-payment handling rather than plain sacrifice execution.

## Current Focus

- `active`: Move down the ordered list while preferring broadly reusable semantics over card-specific hacks.
- `active`: Validate after each backlog slice with `npm.cmd run typecheck --workspace=rules-engine` and focused Vitest.
