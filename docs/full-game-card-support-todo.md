# Full-Game Card Support Todo

Last updated: 2026-05-13

Owner: Copilot + project maintainers

Goal: make MTGEDH able to play real games of Magic from start to finish with all, or nearly all, black-border paper cards usable by players or AI, with effects resolving as expected, state tracked correctly, replay remaining deterministic, and the test/build baseline staying green.

This is the working completion checklist. Existing queue files such as [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md) are candidate generators and lead lists. This file is the implementation todo that turns those leads into engine work.

## Current Baseline

- [x] Latest known broad validation was green after the graveyard provenance work: `npm test`, `npm run build`, and `npm run typecheck --workspace=server` passed.
- [x] Recent server work covered pay-to-return death recursion, graveyard provenance ETBs, replay restoration of graveyard entry metadata, Prized Amalgam-style delayed returns, Archfiend's Vessel-style self-exile/token creation, Rocket-Powered Goblin Glider-style graveyard-cast ETB targeting, and Tibalt's Trickery supplemental milling resolution.
- [ ] Re-run broad validation after every implementation slice that changes server, client, shared, rules-engine, replay, or AI behavior.

Validation commands must be run from the repository root:

```bash
npm run typecheck --workspace=server
npm run typecheck --workspace=client
npm run typecheck --workspace=shared
npm run typecheck --workspace=rules-engine
npm test
npm run build
```

Use focused tests before broad validation, but do not treat focused tests as a substitute for the root baseline.

## Done Criteria For Any Todo Item

An item is not done just because the parser recognizes a line of Oracle text. For real-game support, close an item only when the relevant scope is covered across these surfaces:

- [ ] Current Oracle text verified through Scryfall for card-specific behavior.
- [ ] Rules-engine parser and executor behavior is correct or intentionally not involved.
- [ ] Server live runtime resolves the effect through the same path real players use.
- [ ] Required player choices use `ResolutionQueueManager`; no new custom `pending*` state or bespoke socket-only prompt state.
- [ ] AI can either make a legal decision or safely decline/skip without corrupting state.
- [ ] UI exposes the playable action, prompt, target list, or log entry clearly enough for a real game.
- [ ] Replay persists enough evidence to reconstruct the result without re-prompting or re-firing live triggers.
- [ ] Focused regression tests cover accept, decline, no-valid-targets, and replay where applicable.
- [ ] Root validation is green after the change.

## Priority Map

- P0: Baseline integrity, crashes, illegal state, replay corruption, game-stopping bugs.
- P1: Generic systems that unlock many cards: permission windows, replacement effects, target/choice framework, costs, triggers, continuous effects.
- P2: High-population Oracle families and top Commander cards that use already-supported infrastructure with missing variants.
- P3: Rare, low-play, silver/acorn/joke-adjacent, or unusually card-specific behavior unless it exposes a reusable system gap.

## Immediate Working Queue

Start here before moving into broad engine systems.

### 1. Close The Current Graveyard Context Family

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 309-315.

- [x] 309. Oskar, Rubbish Reclaimer
  - Verify discard event provenance: the discarded nonland card must be castable from graveyard only because it was discarded.
  - Verify prompt timing: the permission should appear at the correct time and expire after the window closes.
  - Verify legal cast flow from graveyard uses the same cost, additional-cost, target, and stack paths as ordinary casting.
  - Verify decline behavior and replay.
  - Add AI decision behavior for whether to cast the discarded card.

- [x] 310. Rocket-Powered Goblin Glider
  - Server runtime support was added for `When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control.`
  - Remaining guard: keep focused regression coverage and verify UI/AI targeting if broader equipment prompts are revised.

- [x] 311. Prized Amalgam
  - Server runtime support was added for graveyard-resident triggers when a creature enters from or is cast from graveyard.
  - Remaining guard: preserve delayed tapped return and replay behavior when generic delayed-trigger code changes.

- [x] 312. Confession Dial
  - Server live support now preserves the full activated ability text, restricts the target to the intended legendary creature card in your graveyard, and grants temporary escape until end of turn with the correct mana-plus-exile cost.
  - Focused coverage verifies the target restriction, cleanup expiry, and the live escape exile-payment cast flow.
  - Verify playable highlight, cast modal action, AI candidate generation, and replay.

- [x] 313. Skyclave Shade
  - Verify landfall grants a temporary cast-from-graveyard permission only on its controller's turn.
  - Verify the permission expires cleanly and does not survive replay, turn changes, or ownership/control edge cases incorrectly.
  - Verify UI playable state and AI cast decision.

- [x] 314. Archfiend's Vessel
  - Server runtime support was added for graveyard-provenance ETB, self-exile, and Demon token creation.
  - Remaining guard: preserve self-exile and token creation behavior when generic ETB execution is refactored.

- [x] 315. Desdemona, Freedom's Edge
  - Verify escape permission path from graveyard.
  - Verify costs, permission duration, cast source metadata, playable highlight, AI decision, and replay.

### 2. Implement Leave-Battlefield Exile Replacement Riders

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 316-319.

- [x] 316. Whip of Erebos
  - Verified live activated reanimation from graveyard, haste grant, next-end-step exile scheduling, and early leave-battlefield exile replacement.
- [x] 317. Moira and Teshar
  - Verified live historic-spell trigger creation, nonland permanent graveyard target filtering, battlefield return, haste grant, next-end-step exile scheduling, and early leave-battlefield exile replacement.
- [x] 318. Kheru Lich Lord
  - Verified upkeep trigger text preservation past the first period, optional {2}{B} payment prompt, deterministic single-creature random graveyard return, flying/trample/haste grant, next-end-step exile scheduling, and early leave-battlefield exile replacement.
- [x] 319. Personal Decoy
  - Verified life-total-based planeswalker entry loyalty, static leave-battlefield exile replacement stamping, live declare-attackers rejection for `You can't be attacked`, and nearby server plus rules-engine combat validation coverage.

Required system work:

- [ ] Add a generic leave-battlefield replacement effect model for `If it would leave the battlefield, exile it instead of putting it anywhere else.`
- [ ] Apply it to destroy, sacrifice, exile, bounce, tuck, blink, cleanup, control-change cleanup, and any other battlefield-exit helper.
- [ ] Ensure it does not double-exile or mis-handle tokens.
- [ ] Persist replacement outcome in replay events.
- [ ] Add regression tests for each major exit path.
- [ ] Ensure AI and UI do not offer impossible destination-dependent choices after replacement is active.

### 3. Complete Cast-From-Graveyard Permission Windows

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 320-354.

- [x] Dread Return
  - Verified flashback's `Sacrifice three creatures` cost queues through `ResolutionQueueManager`, persists replayable sacrifice resolution, and resumes graveyard target selection before casting.
- [x] Sevinne's Reclamation
  - Verified the original flashback cast resolves first, then queues a post-resolution `copy this spell` choice, materializes the copied spell from a replay-safe snapshot, and recomputes legal graveyard retargets after the original target has already returned.
- [x] Past in Flames
  - Verified ordinary spell resolution now applies temporary graveyard keyword grants, so the flashback cast grants `flashback until end of turn` to other instant and sorcery cards in your graveyard in both live play and replay.
- [x] Momentary Blink
  - Verified the generic `FlickerPermanent` spell-resolution path already works through flashback in both live play and replay; the targeted creature leaves and returns as a new untapped permanent under its owner's control.
- [x] Cackling Counterpart
  - Verified ordinary spell resolution now creates a token copy of the targeted creature you control in both live play and replay, including flashback casts.
- [x] Think Twice
  - Verified a simple flashback draw spell now resolves through the generic draw path and is exiled after resolution in both live play and replay.
- [x] Strike It Rich
  - Verified the generic token-creation path plus flashback cleanup produces a Treasure token and exiles the spell in both live play and replay.
- [x] Deep Analysis
  - Verified targeted draw spells with a flashback cost line now classify correctly, pay life, draw cards for the selected player, and exile themselves on resolution in both live play and replay.
- [x] Army of the Damned
  - Verified the existing flashback path plus token creation already produces thirteen tapped 2/2 black Zombie tokens and exiles the spell on resolution in both live play and replay.
- [x] Otherworldly Gaze
  - Verified flashback resolution now snapshots the top library cards onto queued `SURVEIL` prompts, so live play and replay both restore `Surveil 3` with the real card payload and exile the spell on resolution.
- [x] Faithless Looting
  - Verified the existing draw-then-discard spell path already works through flashback in both live play and replay: the spell resolves into a queue-backed discard prompt after drawing two cards, and the flashback cast exiles itself on resolution.
- [x] Laughing Mad
  - Verified flashback activation now reuses the generic additional-cost discard detector for live graveyard casts, so the spell queues its discard cost before casting, then draws two cards and exiles itself on resolution; replay already restored the pre-cost prompt correctly.
- [x] Seize the Day
  - Verified ordinary spell resolution now recognizes the combined `Untap target creature` plus `additional combat phase followed by an additional main phase` rider, so flashback casts untap the target, add one extra combat, and exile themselves in both live play and replay.
- [x] Electroduplicate
  - Verified ordinary spell resolution now extends the targeted creature-copy spell path to the haste-plus-end-step-sacrifice rider, so flashback casts create the token copy, grant haste, schedule the delayed sacrifice, and exile themselves in both live play and replay.
- [x] Flashback self-permission cards: Galvanic Iteration.
- [ ] Escape cards and global escape grants: Underworld Breach, Uro.
- [ ] Static self-cast cards: Gravecrawler, Squee, the Immortal, The Indomitable.
- [ ] Static/granted creature or permanent graveyard casting: Six, Chainer, Exploration Broodship, Lurrus, Rivaz, Kess.
- [ ] Special additional-cost or alternate-cost cards: Nature's Rhythm, Quilled Greatwurm, Bulk Up, Resurgent Belief, Torrential Gearhulk.
- [ ] Non-graveyard false positives in this range: Primevals' Glorious Rebirth is a legendary-sorcery cast restriction plus mass return, not a graveyard cast permission item. Verify queue classification before implementing.

Required system work:

- [ ] Represent graveyard casting permissions as first-class state with source, affected player, allowed card filters, cost mode, duration, usage limit, and replacement behavior.
- [ ] Support self-permission printed on the card and battlefield-granted permissions from other sources.
- [ ] Support alternate costs, additional costs, and `without paying its mana cost` without bypassing the normal casting pipeline.
- [ ] Wire permissions into `canRespond`, playable highlights, graveyard modal actions, cast validation, and AI candidate generation.
- [ ] Persist cast source zone, permission id, alternate cost id, and exile-after-cast replacement for replay.
- [ ] Add tests for accept, decline, no mana, additional costs, invalid timing, permission expiration, and replay.

### 4. Complete Play-From-Graveyard Permission Windows

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 355-379.

- [ ] Lands from graveyard: Ramunap Excavator, Conduit of Worlds, Crucible of Worlds, Ancient Greenwarden, Icetill Explorer, Perennial Behemoth, Szarel, Glacierwood Siege.
- [ ] Restricted lands from graveyard: Titania, Nature's Force for Forests; Hazezon for Deserts; The Eighth Doctor for historic lands.
- [ ] Mixed play/cast permissions: Muldrotha, Wrenn and Realmbreaker emblem, Serra Paragon, Zask, Kethis, Horde of Notions, Gaea's Will, Magus of the Will.
- [ ] Discard/impulse overlap: Oscorp Industries, Embrace the Unknown, Zenith Festival, Lidless Gaze, Mishra's Research Desk.
- [ ] Cast-from-graveyard spells that also grant impulse play: Ignite the Future.

Required system work:

- [ ] Separate `play land` permissions from `cast spell` permissions while allowing cards that grant both.
- [ ] Respect land-play limits, additional land-play effects, turn permissions, and timing restrictions.
- [ ] Track once-per-turn and per-card-type limits for Muldrotha-style cards.
- [ ] Persist land played from graveyard source metadata and replay it deterministically.
- [ ] Ensure AI can evaluate land-from-graveyard choices without using illegal extra land plays.

### 5. Complete Flashback And Granted Flashback

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 380-400.

- [ ] Granted flashback: Lier, Disciple of the Drowned; Will of the Jeskai.
- [ ] Simple flashback: Increasing Vengeance, Increasing Devotion, Prisoner's Dilemma, Divine Reckoning, Faithful Mending, Siphon Insight, Rite of Harmony, Artful Dodge, Nibelheim Aflame, Angelfire Ignition, Forbidden Alchemy, Croaking Counterpart, Memory Deluge, Moment's Peace.
- [ ] Flashback with additional costs or unusual costs: Rite of Oblivion, Eviscerator's Insight, Electric Revelation, Summons of Saruman.

Required system work:

- [ ] Make flashback a specialization of the generic graveyard permission system.
- [ ] Enforce exile-after-resolution or exile-if-would-leave-stack replacement.
- [ ] Support granted flashback cost derivation from mana value or source text.
- [ ] Preserve additional costs and target selection through resumed cast flow.
- [ ] Add replay coverage for cast, countered spell, copied spell, fizzled spell, and declined prompt cases.

## Broader Engine Todo

The following workstreams are needed for the larger goal of nearly all cards working in real games.

### A. Baseline And Regression Discipline

- [ ] Keep root validation green after every slice.
- [ ] Keep generated queue docs as leads, not proof of current gaps.
- [ ] For card-specific implementation, verify current Oracle text through Scryfall first.
- [ ] Prefer generic family fixes over card-specific branches.
- [ ] When adding replay events, add `applyEvent.ts` support and replay coverage in the same change.
- [ ] When adding prompts, use the Resolution Queue and preserve prompt snapshots for replay.
- [ ] Track false positives and stale queue rows directly in the relevant docs or audit output.

### B. Generic Permission System

Cards frequently grant permission to cast, play, activate, or spend resources from unusual zones or under unusual timing. These should converge into one permission model.

- [ ] Define a durable permission shape for server state.
  - Include source id, source zone, granted-to player, affected card ids or filters, allowed source zones, allowed destination/action, duration, usage limit, cost mode, timing override, and replacement behavior.
  - Include whether the permission is self-granted, static battlefield-granted, emblem-granted, delayed, or one-shot.
  - Include enough data to replay and debug why an action was legal.

- [ ] Integrate permissions with legal action generation.
  - `canRespond` should see cast/play permissions.
  - Client playable highlights should show legal graveyard/exile/library actions.
  - Socket cast/play handlers should validate against the permission object.
  - AI should generate candidate actions from the same permission object.

- [ ] Support common permission families.
  - Cast from graveyard.
  - Play lands from graveyard.
  - Play/cast cards exiled this way.
  - Cast from library/top of library.
  - Cast from command zone and commander variants.
  - Cast without paying mana cost.
  - Spend mana as though it were mana of any color/type.
  - Activate abilities from unusual zones if product scope includes them.

- [ ] Support permission expiration.
  - Until end of turn.
  - Until end of next turn.
  - This turn.
  - Once during each of your turns.
  - As long as a source remains on battlefield.
  - While a condition remains true.
  - One-shot prompt windows.

- [ ] Add focused tests for each permission family and duration.

### C. Replacement And Prevention Effects

Replacement and prevention are essential for real games because they alter events before those events happen.

- [ ] Create a generic replacement-effect registry/evaluator.
  - Event inputs should include event type, object ids, source/destination zones, controller/owner, damage amount/source, cause, and pending metadata.
  - Effects should be ordered and replayable.
  - The evaluator should produce an explicit applied/not-applied result for logs and replay.

- [ ] Cover zone-change replacements.
  - Leave battlefield and exile instead.
  - Die and exile instead.
  - Graveyard replacement such as cards going to exile instead.
  - Commander replacement to command zone.
  - Token disappearance when leaving battlefield.
  - Enter tapped, enter with counters, enter as copy, enter transformed/face down.

- [ ] Cover damage replacements and prevention.
  - Prevent next N damage.
  - Prevent all damage from a source.
  - Damage can't be prevented.
  - Damage redirection where applicable.
  - Damage doubling/halving/instead effects.
  - Infect, wither, lifelink, deathtouch, trample interactions.

- [ ] Cover draw, life, token, counter, and search replacements.
  - Draw replacement and dredge-style behavior.
  - Life gain/loss replacement or prevention.
  - Token creation modification.
  - Counter placement modification.
  - Search prevention and replacement.

- [ ] Add replay tests for each replacement category.

### D. Cost And Payment Coverage

The normal cast and activate pipeline must handle all common Magic costs without special-case shortcuts.

- [ ] Normalize all costs through one payment model.
  - Mana, hybrid, Phyrexian, snow, colorless, X, variable, and commander tax.
  - Alternate costs, additional costs, cost increases, cost reductions, and cost replacement.
  - `Without paying its mana cost` with additional costs still payable.

- [ ] Support non-mana costs.
  - Sacrifice permanents.
  - Discard cards.
  - Exile cards from hand, graveyard, battlefield, or library.
  - Tap/untap permanents.
  - Remove counters.
  - Pay life.
  - Return permanents to hand.
  - Reveal cards.
  - Choose modes or values during payment.

- [ ] Support ability costs and alternative activation restrictions.
  - Once per turn.
  - Activate only as a sorcery.
  - Activate only from a zone.
  - Activate only if a condition is true.
  - Costs that depend on game state.

- [ ] Add payment replay events that preserve enough evidence to reconstruct choices and resource spending.
- [ ] Add AI cost-payment heuristics for sacrifice, discard, exile, counters, and life.

### E. Targeting, Choices, And Resolution Queue

- [ ] Generalize target selection for all target shapes.
  - Any number of targets.
  - Up to N targets.
  - Multiple target groups with different filters.
  - Different targets / another target / same target constraints.
  - Total power or mana value limits.
  - Zone targets from graveyard, exile, library, stack, command zone, and battlefield.
  - Player targets and opponent-only/team restrictions.

- [ ] Generalize non-target choices.
  - Modes, repeated modes, modal DFC-style choices, spree/escalate/entwine/kicker-style choices.
  - Colors, card names, creature types, land types, numbers, piles, votes, directions, opponents.
  - Hidden-information choices with private data boundaries.

- [ ] Finish generic ETB target selection for stack items.
  - There is still a known server gap where some ETB triggers log that a target is required but not yet implemented.
  - Build a generic prompt generator for triggered ability stack items with target metadata.
  - Cover battlefield, graveyard, exile, player, and mixed target prompts.

- [ ] Ensure every prompt has AI response support.
- [ ] Ensure every prompt response is replayed through `applyEvent.ts` or equivalent replay support.

### F. Trigger Infrastructure

- [ ] Expand trigger detection and execution by event family.
  - Enters, leaves, dies, is put into graveyard, is exiled.
  - Cast, copy, counter, resolve, become target.
  - Attack, block, deal combat damage, deal noncombat damage.
  - Draw, discard, mill, search, shuffle.
  - Gain life, lose life, pay life.
  - Create token, sacrifice, tap, untap.
  - Counters placed/removed.
  - Beginning/end step and cleanup triggers.

- [ ] Preserve trigger context.
  - The triggering object.
  - The affected object or player.
  - The entering/leaving zone and destination.
  - The source cast zone.
  - Damage source and damage amount.
  - Controller and owner at trigger time.
  - Snapshots needed for intervening-if checks.

- [ ] Complete trigger ordering.
  - APNAP ordering for multiplayer.
  - Optional trigger prompts.
  - Trigger target selection.
  - Delayed trigger creation and expiration.
  - Reflexive `When you do` triggers.
  - Intervening-if at trigger time and resolution time.

- [ ] Make replay restore trigger stack state without rediscovering live triggers.

### G. Continuous Effects And Layers

This is one of the largest remaining pillars for near-all-card correctness.

- [ ] Build or finish a comprehensive layer evaluator.
  - Copy effects.
  - Control-changing effects.
  - Text-changing effects if in scope.
  - Type, subtype, and supertype changes.
  - Color changes.
  - Ability adding/removing.
  - Power/toughness setting.
  - Power/toughness modification.
  - Counters.
  - Switching power/toughness.

- [ ] Track timestamps and dependency ordering.
- [ ] Handle characteristic-defining abilities.
- [ ] Handle `as long as`, `during`, `while`, and conditionally active continuous effects.
- [ ] Recalculate derived characteristics consistently for combat, targeting, state-based actions, AI evaluation, and UI display.
- [ ] Add tests for common layer conflicts.

### H. Zone Movement, Objects, Attachments, And Copies

- [ ] Consolidate zone movement helpers.
  - Battlefield to graveyard/exile/hand/library/command.
  - Graveyard to battlefield/hand/library/exile/stack.
  - Exile to stack/battlefield/hand/graveyard.
  - Library to hand/battlefield/graveyard/exile/stack.
  - Command zone movement.

- [ ] Preserve and clear object metadata correctly.
  - New object identity after zone changes.
  - Owner/controller.
  - Face-down/face-up data.
  - Entered-from-zone provenance.
  - Cast-source provenance.
  - Damage provenance.
  - Counters that should or should not persist.
  - Attachments that should fall off, remain, or reattach.

- [ ] Finish copy support.
  - Copy permanent.
  - Copy spell.
  - Copy card in another zone.
  - Token copy with exceptions.
  - Copy values versus current modified values.
  - Linked copied object metadata for replay.

- [ ] Finish attachment support.
  - Aura legality.
  - Equipment attach/detach.
  - Fortification if in scope.
  - Reattach riders after zone movement.
  - Attachment cleanup after illegal attachments.

### I. Core Game Rules For Start-To-Finish Play

- [ ] Mulligans.
- [ ] Priority and pass loops.
- [ ] Turn structure and phase/step transitions.
- [ ] State-based actions.
- [ ] Combat declaration and legality.
- [ ] Blocking requirements/restrictions.
- [ ] Combat damage assignment, including trample, first strike, double strike, deathtouch, menace, flying, reach, protection, indestructible, lifelink, toxic, infect, wither.
- [ ] Commander damage.
- [ ] Commander tax by commander id.
- [ ] Losing, winning, drawing the game, and simultaneous outcomes.
- [ ] Multiplayer concessions and eliminated players.
- [ ] Tokens, emblems, counters, poison, energy, experience, monarch, initiative, day/night, dungeons, attractions/stickers if in product scope.
- [ ] Cleanup step discard, damage removal, until-end-of-turn expiration, and simultaneous cleanup triggers.

### J. AI Real-Game Behavior

- [ ] Make AI consume the same legal-action surfaces as players.
- [ ] AI should not bypass costs, timing, targeting, permission windows, replacement effects, or Resolution Queue prompts.
- [ ] Add AI heuristics for:
  - Casting from non-hand zones.
  - Additional costs.
  - Sacrifice/discard/exile choices.
  - Optional triggers.
  - Target selection.
  - Combat attacks and blocks.
  - Stack interaction and priority passing.
  - Graveyard, exile, and library permissions.
  - Replacement choices, including commander command-zone replacement.
- [ ] Add AI legality tests that fail when AI produces an illegal action.
- [ ] Add full-game AI simulations that detect hangs, repeated illegal choices, empty prompt loops, and corrupt replay.

### K. Client And Player Experience

- [ ] Expose all legal actions consistently.
  - Hand casting.
  - Graveyard casting/play.
  - Exile casting/play.
  - Activated abilities from battlefield and other supported zones.
  - Special actions.
  - Commander zone actions.

- [ ] Improve prompt clarity without embedding rules essays in the UI.
  - Show valid targets.
  - Show cost payment requirements.
  - Show optional accept/decline decisions.
  - Show mode and value choices.
  - Show private choices only to the relevant player.

- [ ] Keep UI state synchronized with server state.
- [ ] Ensure no prompt can be submitted twice or after it expires.
- [ ] Ensure reconnect/replay state restores pending prompts correctly.
- [ ] Keep game logs readable enough to debug real games.

### L. Replay, Persistence, And Debuggability

- [ ] Every state-changing live path should append replay evidence.
- [ ] Replay should reconstruct state without live prompts, live trigger discovery, random rerolls, or hidden-zone leaks.
- [ ] Persist enough metadata for:
  - Zone movement.
  - Cast source and permission id.
  - Costs paid.
  - Targets and choices.
  - Replacement effects applied.
  - Trigger context and delayed triggers.
  - Continuous effect source and expiration.
  - AI decisions when relevant.

- [ ] Add replay coverage for every new event type.
- [ ] Keep debug logs actionable with source card, event id, player id, and skip reason.
- [ ] Add tooling to diff live state versus replay state after scenario tests.

### M. Oracle Automation Pipeline

- [ ] Regenerate queues when the corpus or priority model changes.
- [ ] Avoid timestamp-only diffs in generated queue files.
- [ ] Classify each queue item as:
  - Already covered.
  - Parser gap.
  - Executor gap.
  - Server live-runtime gap.
  - UI gap.
  - AI gap.
  - Replay gap.
  - Stale or false-positive queue lead.

- [ ] Build family-level audits for common seams.
  - Move-zone effects.
  - Graveyard permissions.
  - Exile impulse permissions.
  - Token creation.
  - Damage and prevention.
  - Draw/discard/mill.
  - Counters.
  - Search/tutor.
  - Copy effects.
  - Continuous effects/layers.
  - Replacement effects.

- [ ] Prefer representative regression cards for each mechanic family over one-off tests for every card.
- [ ] Keep docs updated when queue rows are closed or reclassified.

### N. Test Strategy

- [ ] Parser unit tests for Oracle text shape.
- [ ] Executor tests for deterministic rules-engine behavior.
- [ ] Server integration tests for real socket/state flows.
- [ ] Resolution Queue tests for prompts and responses.
- [ ] Replay tests for each event type and mechanic family.
- [ ] Client tests for playable state and prompt rendering where practical.
- [ ] AI legality tests.
- [ ] Full-game smoke simulations.
- [ ] Randomized or seeded scenario simulations.
- [ ] Regression packs for high-play Commander cards.

## Suggested Next 20 Work Items

Use this list to start implementation after the document is created.

1. Verify Oskar, Rubbish Reclaimer Oracle text and current live support.
2. Add/adjust tests for Oskar discard-to-graveyard cast permission.
3. Verify Confession Dial and Desdemona escape support through live server paths.
4. Verify Skyclave Shade landfall permission and turn restriction.
5. Extract a generic graveyard permission state shape if current ad hoc flows are not sufficient.
6. Wire graveyard permissions into AI legal action generation.
7. Add replay coverage for newly verified graveyard permission flows.
8. Design the leave-battlefield replacement effect interface.
9. Implement Whip of Erebos-style exile replacement for one battlefield-exit path.
10. Expand the replacement to all battlefield-exit helpers.
11. Add replay evidence for replacement-applied events.
12. Add tests for destroy, sacrifice, bounce, blink, and exile interactions with leave-battlefield replacement.
13. Implement flashback as a first-class permission specialization if not already complete.
14. Add additional-cost flashback tests.
15. Add granted-flashback tests for Lier and Will of the Jeskai.
16. Implement land-from-graveyard play permissions for Crucible/Ramunap-style cards.
17. Add Muldrotha-style per-card-type once-per-turn limits.
18. Build the generic triggered-ability target prompt generator for ETB stack items.
19. Add AI prompt-response coverage for the new target prompt generator.
20. Run full validation and update this todo with completed items and any newly discovered blockers.

## Maintenance Protocol

When completing an item:

1. Mark the checkbox complete only after live runtime, replay, and tests are covered.
2. Add a short note if the item was closed by a generic system rather than direct card support.
3. Link or name the focused tests that prove it.
4. Re-run the root validation suite before marking a broad family complete.
5. If a generated queue item is stale, mark it as stale in this document or the relevant queue audit rather than implementing dead work.
