# Full-Game Card Support Todo

Last updated: 2026-05-22

Owner: Copilot + project maintainers

Goal: make MTGEDH able to play real games of Magic from start to finish with all, or nearly all, black-border paper cards usable by players or AI, with effects resolving as expected, state tracked correctly, replay remaining deterministic, and the test/build baseline staying green.

This is the working completion checklist. Existing queue files such as [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md) are candidate generators and lead lists. This file is the implementation todo that turns those leads into engine work.

## Current Baseline

- [x] Latest known broad validation was green after durable usage-limit counter consumption, per-turn reset, source-remains enforcement, duration alias/explicit-expiry activation fixes, replay-safe usage recording for exile/graveyard durable permissions, generic condition-bound active filtering, Lukka-style condition-bound playable-from-exile durable permission integration, live Runestone Caverns durable playable-from-exile mirroring, direct planeswalker this-turn exile-play/cast durable mirroring, one-shot cast-from-exile prompt decline cleanup, durable one-shot production for direct planeswalker cast-or-decline prompts, durable one-shot production for stack-created copied-card cast-from-exile prompts, durable one-shot production for resolution-owned free-cast follow-up prompts, AI/shared explicit exile request-cast consumption of durable free-cast metadata, AI/shared normalized payable-cost consumption for durable flexible-mana spell/commander permissions, AI shared-flow top-library durable free/flexible permission guardrails, AI response-window durable ignore-timing exile/library guardrails, AI/shared response-window durable ignore-timing command-zone commander guardrails, durable unearth/embalm graveyard activation mirrors, and shared static battlefield graveyard permission synthesis: `git diff --check`, `npm test` (179 files / 6266 tests), `npm run build`, focused durable permission tests, and workspace typechecks passed.
- [x] Latest known broad validation was green after leave-battlefield helper convergence for blink, shared sacrifice, state-based action lethal/legend cleanup, Elixir-style self-shuffle, unknown-game upkeep sacrifice fallback, apply-event sacrifice/bounce, and legacy replay sacrifice/bounce paths: focused server Vitest coverage passed (4 files / 120 tests), then `npm install`, `npm run typecheck --workspace=server`, `npm test` (179 files / 6266 tests), `npm run build`, and `git diff --check` passed.
- [x] Recent server work covered pay-to-return death recursion, graveyard provenance ETBs, replay restoration of graveyard entry metadata, Prized Amalgam-style delayed returns, Archfiend's Vessel-style self-exile/token creation, Rocket-Powered Goblin Glider-style graveyard-cast ETB targeting, Tibalt's Trickery supplemental milling resolution, and Echo upkeep payment prompts with first-upkeep timing tracked across live resolution and replay.
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

- [x] Add a generic leave-battlefield replacement effect model for `If it would leave the battlefield, exile it instead of putting it anywhere else.`
- [x] Apply it to destroy, sacrifice, exile, bounce, tuck, blink, cleanup, control-change cleanup, and any other battlefield-exit helper.
  - Progress: stack-resolution targeted bounce, mass bounce, Chaos Warp-style tuck, trigger-driven destroy, linked-exile commander-choice, Dispatch metalcraft-exile, the effect-resolution `MoveToExile` / EXILE_TARGET spell branch, `FlickerPermanent` immediate/delayed blink, shared sacrifice helper paths, state-based action lethal/legend cleanup, Elixir-style self-shuffle, unknown-game upkeep sacrifice fallback, generic `removePermanent` application/replay, sacrifice-cost event application, bounce-land event application/replay, socket resolution sacrifice/destroy/exile/return paths, AI sacrifice/return payment paths, and the matching legacy replay bounce/sacrifice paths now route through shared battlefield-exit helpers. Linked exile and blink return side effects now run only if a deferred commander exile actually stays in exile. The remaining direct battlefield removals found by search are shared movement helper internals, commander command-zone handling, player departure cleanup, or legacy `.bak` files, not ordinary card exits.
- [x] Ensure it does not double-exile or mis-handle tokens.
  - Verified delayed linked-exile/blink side effects only fire after actual exile, and added coverage that non-replacement tokens attempting to move to a library cease instead of entering that library.
- [x] Persist replacement outcome in replay events.
  - Legacy replay now inherits the generic `removePermanent` replacement path, with focused replay coverage proving replacement permanents deterministically land in exile.
- [x] Add regression tests for each major exit path.
  - Guardrails cover direct hand/library/graveyard/exile helper moves, mass bounce, tuck, destroy, sacrifice, state-based lethal/legend cleanup, Elixir-style self-shuffle, unknown-game upkeep sacrifice fallback, generic remove events, replayed remove events, linked exile, and immediate/delayed blink commander choices.
- [x] Ensure AI and UI do not offer impossible destination-dependent choices after replacement is active.
  - Return-to-hand and sacrifice prompts now carry replacement hints so the UI can label choices that will be exiled instead, and AI return-choice heuristics prefer ordinary hand returns before replacement-exile permanents when both are legal. Guardrail: `server/tests/leave-battlefield-replacement.integration.test.ts`.

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
- [x] Escape cards and global escape grants: Underworld Breach.
  - Verified escape creature casts now preserve explicit cast-time entry counters through battlefield resolution in both live play and replay, covering Woe Strider-style `escapes with two +1/+1 counters on it` handling.
- [x] Static self-cast cards: Gravecrawler, Squee, the Immortal, The Indomitable.
- [x] Static/granted creature or permanent graveyard casting: Six, Chainer, Exploration Broodship, Lurrus, Rivaz, Kess.
  - Verified Kess request-cast/live resolution now preserves the Oracle-text exile replacement, so spells cast through its graveyard permission are exiled on resolution in live play and replay.
  - Verified Lurrus continues to gate the shared graveyard candidate surface to mana value two or less, so legal permanents enter request-cast while larger permanents stay rejected.
  - Verified Rivaz request-cast/live resolution now preserves the Oracle-text death replacement, so Dragon creatures cast through its graveyard permission are exiled when they die instead of returning to the graveyard.
  - Verified Six now resolves through the actual granted `retrace` path on request-cast: shared graveyard candidates classify `During your turn, nonland permanent cards in your graveyard have retrace` as a keyword grant, and the request-cast flow delegates keyword graveyard casts back into the existing discard/exile/sacrifice cost queue.
  - Verified Chainer now creates a temporary qualifier-based graveyard cast permission for `You may cast a creature spell from your graveyard this turn`, the shared candidate surface sees it immediately, and the follow-up `if you didn't cast it from your hand, it gains haste` trigger grants haste to the entering permanent.
  - Verified Exploration Broodship now preserves its source-text additional cost on request-cast: `Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs` now threads a land-sacrifice additional-cost payload through shared candidates into the standard additional-cost prompt flow.
  - Verified the shared request-cast test cleanup for this slice now clears `GameManager` state as well as queue/db/socket maps, preventing stale graveyard-permission state from leaking across fixed-id cases.
- [x] Special additional-cost or alternate-cost cards: Quilled Greatwurm.
  - Verified Bulk Up now reuses the generic flashback activation/replay path for its reminder-bearing `Flashback {4}{R}{R}` line, and non-permanent spell resolution now applies the updated `Double target creature's power until end of turn` template in both live play and replay.
  - Verified Torrential Gearhulk now carries its ETB-targeted graveyard free-cast metadata through live resolution, reconstructs the replayed cast onto the stack, and still exiles the cast instant on the follow-up replayed resolution step.
  - Verified Nature's Rhythm now routes printed `Harmonize {X}{G}{G}{G}{G}` through the normal graveyard request-cast path: X selection, payment-step creature-choice reduction, live cast completion, and exile on resolution all work in focused request-cast coverage.
  - Verified Resurgent Belief now treats `Suspend 2—{1}{W}` as a paid alternate action from hand rather than a failed zero-mana cast: the live hand-cast path spends the suspend cost, exiles the card with time counters instead of putting it on the stack, and replay reconstructs the suspended card state from a persisted `suspendCard` event.
  - Verified Quilled Greatwurm now parses its printed graveyard self-permission as a distributed `remove_counters` additional cost, queues a counter-removal payment prompt, validates/removes six counters from among controlled creatures, persists the paid cost for replay, and resumes into normal mana payment and stack casting.
- [x] Non-graveyard false positives in this range: Primevals' Glorious Rebirth is a legendary-sorcery cast restriction plus mass return, not a graveyard cast permission item. Verify queue classification before implementing.
  - Verified current Scryfall text as a `Legendary Sorcery` with a legendary-sorcery cast restriction plus `Return all legendary permanent cards from your graveyard to the battlefield`; this is not a graveyard cast permission. Tightened the queue generator's graveyard cast/play permission regexes so `you may cast` / `you may play` cannot drift across later sentences containing `from your graveyard`.

Required system work:

- [x] Represent graveyard casting permissions as first-class state with source, affected player, allowed card filters, cost mode, duration, usage limit, and replacement behavior.
  - Added `state.graveyardCastingPermissions` entries with deterministic ids, source metadata, affected player, graveyard card filters, cost mode, duration, usage limit, and replacement metadata. Temporary text-derived permissions now populate this first-class shape alongside the legacy compatibility markers, and focused `canRespond` coverage verifies cast candidates can be produced from first-class state alone.
- [x] Support self-permission printed on the card and battlefield-granted permissions from other sources.
  - Shared graveyard cast candidates now synthesize deterministic permission ids, source names, and cost modes for both printed self-permissions and battlefield-granted/static permissions. Broadcast `graveyardAbilityHints` and the graveyard modal surface that metadata so cards like Squee, Kess, Lurrus, and The Indomitable present the correct source-backed graveyard cast action.
- [x] Support alternate costs, additional costs, and `without paying its mana cost` without bypassing the normal casting pipeline.
  - Shared graveyard candidates now promote `without paying its mana cost` permissions into the live request-cast flow by stamping `castWithoutPayingManaCost` / `forcedAlternateCostId: 'free'` before payment steps are built. Existing source-granted discard/sacrifice/remove-counter additional costs stay on that same queue-backed path, so free-cast permissions still require and persist their non-mana payments.
- [x] Wire permissions into `canRespond`, playable highlights, graveyard modal actions, cast validation, and AI candidate generation.
  - `canRespond` / shared castability now emits permission metadata for first-class, printed, and static granted graveyard permissions; request-cast copies that metadata onto live casts; broadcast graveyard hints reuse the shared candidate surface; and the graveyard modal shows the active permission source and free-cast mode while suppressing duplicate generic cast rows when a printed keyword already explains the action.
- [x] Persist cast source zone, permission id, alternate cost id, and exile-after-cast replacement for replay.
  - Stored `castSpell` events now explicitly serialize graveyard permission id/source/cost-mode, `castWithoutPayingManaCost`, alternate cost id, and exile / leave-battlefield replacement metadata instead of relying on embedded card copies. Replay restoration in `applyEvent.ts` mirrors those fields back onto stack items, and direct `activateGraveyardAbility` graveyard-cast replays now carry the same provenance metadata for printed self-cast permissions.
- [x] Add tests for accept, decline, no mana, additional costs, invalid timing, permission expiration, and replay.
  - Focused coverage now includes no-mana free graveyard permissions, free graveyard permissions that still require additional costs, explicit invalid-timing and permission-expiration rejections on the live request-cast path, explicit decline coverage for optional Torrential Gearhulk graveyard casts, stored cast-event replay metadata, and replay restoration for both `castSpell` and `activateGraveyardAbility` graveyard-cast flows.

### 4. Complete Play-From-Graveyard Permission Windows

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 355-379.

- [x] Lands from graveyard: Ramunap Excavator, Conduit of Worlds, Crucible of Worlds, Ancient Greenwarden, Icetill Explorer, Perennial Behemoth, Szarel, Glacierwood Siege.
  - Glacierwood Siege's Sultai/Temur ETB choice is now replay-safe and shared-surface-aware: the chosen mode persists on the permanent, `collectStaticEffectSources()` scopes the Oracle text to the chosen bullet line, and focused live coverage now proves only Sultai grants graveyard land plays. Guardrail: `server/tests/play-land.graveyard-permission.integration.test.ts`.
  - The remaining land-only replay shapes now have focused live coverage on the shared `playLand` surface: Ramunap Excavator, Conduit of Worlds, Ancient Greenwarden, Perennial Behemoth, and Szarel all grant the expected graveyard land replay despite extra keyword or activated-ability text, while Icetill Explorer proves a single permanent can both raise the land cap and authorize the graveyard land replay for the legal second land play. Guardrail: `server/tests/play-land.graveyard-permission.integration.test.ts`.
- [x] Restricted lands from graveyard: Titania, Nature's Force for Forests; Hazezon for Deserts; The Eighth Doctor for historic lands.
  - The shared graveyard land qualifier path now has live guardrails for subtype and historic restrictions: Titania/Forests, Hazezon/Deserts, and The Eighth Doctor/historic lands all route through the same `playLand` surface, which now rejects the non-matching land before allowing the matching replay target. Guardrail: `server/tests/play-land.graveyard-permission.integration.test.ts`.
- [x] Mixed play/cast permissions: Muldrotha, Wrenn and Realmbreaker emblem, Gaea's Will, Serra Paragon, Zask, Magus of the Will, Kethis, and Horde of Notions.
  - Serra Paragon now has focused live land and spell coverage on the shared graveyard surfaces: cheap permanent spells are allowed while nonpermanents and mana-value-four permanents are rejected, and both `playLand` and `requestCastSpell` preserve the granted `When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life.` rider through resolution and death handling. Guardrails: `server/tests/play-land.graveyard-permission.integration.test.ts`, `server/tests/request-cast.graveyard-permission.integration.test.ts`.
  - Zask confirms the generic mixed qualifier path is handling subtype-limited graveyard spells without a card branch: the live `playLand` surface replays lands from the graveyard while the live `requestCastSpell` surface allows Insect spells and rejects other graveyard spells from the same setup. Guardrails: `server/tests/play-land.graveyard-permission.integration.test.ts`, `server/tests/request-cast.graveyard-permission.integration.test.ts`.
  - Magus of the Will now works through the live activated-ability seam: the self-exile activation cost is paid correctly, the resolved ability grants the temporary `play lands and cast spells from your graveyard` window, and graveyard-cast spells from that window carry the turn-long exile-on-resolution replacement through `requestCastSpell` and spell resolution. Guardrail: `server/tests/request-cast.graveyard-permission.integration.test.ts`.
  - Kethis now works through the live activated-ability seam on both spell and land paths: the activation cost can exile legendary graveyard cards, the resolved quoted grant `each legendary card in your graveyard gains "You may play this card from your graveyard."` materializes into specific temporary permissions for the remaining legendary cards, and the shared first-class matcher no longer leaks those exact-card permissions onto unrelated graveyard cards. Guardrails: `server/tests/request-cast.graveyard-permission.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`.
  - Horde of Notions now rides a generic targeted activated-ability seam instead of a card branch: when an activated ability resolves with `You may play target ... from your graveyard without paying its mana cost`, `stack.ts` queues a one-shot graveyard play/cast prompt for the selected target, `resolution.ts` routes spell targets through the existing free-cast request flow and land targets through the live `playLand` handler, and focused coverage proves both an Elemental creature spell and an Elemental land can be played from the graveyard through that same path. Guardrails: `server/tests/request-cast.graveyard-permission.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`.
- [x] Discard/impulse overlap: Lidless Gaze.
  - Lidless Gaze now stays on the shared Oracle IR impulse-exile path instead of a card branch: the live `impulse_exile_top` helper no longer bails out on multi-player selectors like `each player's library`, the shared playable-from-exile surfaces can see and cast the opponent-owned exiled spell, and the exiled spell snapshot now preserves Lidless's `mana of any type can be spent to cast those spells` rider so both shared candidate generation and live spell payment accept off-color mana. Guardrail: `server/tests/request-cast.graveyard-permission.integration.test.ts`.
  - Embrace the Unknown now has a focused live retrace guardrail: activating retrace from the graveyard resolves through the existing graveyard-keyword cast path, the generic Oracle IR impulse helper exiles the top two cards with the normal `playable from exile until end of next turn` window, and the shared exile candidate surface exposes the exiled spell with its printed mana cost rather than as a free cast. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Zenith Festival now has a focused live harmonize guardrail: resolving it from the graveyard with `X = 2` pushes the chosen X value through the harmonize request-cast path into the generic Oracle IR impulse helper, exiles exactly two cards, and surfaces the exiled spell as a normal paid `playable_from_exile` candidate instead of a free cast. Guardrail: `server/tests/request-cast.graveyard-permission.integration.test.ts`.
  - Mishra's Research Desk now has focused live unearth-plus-activation coverage: the shared activated-effect resolver handles `Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card`, queues the exile choice without prematurely granting permission to both exiled cards, and the resolution step only surfaces the selected card as a shared `playable_from_exile` candidate with the correct next-turn window. Guardrail: `server/tests/request-cast.graveyard-permission.integration.test.ts`.
  - Oscorp Industries now rides the shared graveyard land path instead of a card branch: discard resolution stamps exact-card `discardedOnTurn` / `discardedByPlayerId` provenance, the printed self-permission matcher recognizes `You may play this card from your graveyard if you discarded it this turn`, and live `playLand` stamps graveyard entry provenance before ETB trigger discovery so `When this land enters from a graveyard, you lose 2 life` resolves correctly. Guardrail: `server/tests/play-land.graveyard-permission.integration.test.ts`.
- [x] Cast-from-graveyard spells that also grant impulse play: Ignite the Future.
  - The generic Oracle IR impulse-exile helper now preserves `castWithoutPayingManaCost` on the exiled card snapshots when the source spell both says `If this spell was cast from a graveyard, you may play cards this way without paying their mana costs` and actually resolved from the graveyard. The shared exile candidate surface consumes that metadata so the exiled spell appears as a zero-cost `playable_from_exile` candidate, and the normal exile `requestCastSpell` flow now promotes that card-level free-cast flag early enough for the queued payment step to use `{0}` instead of the printed mana cost. Guardrail: `server/tests/request-cast.graveyard-permission.integration.test.ts`.

Required system work:

- [x] Separate `play land` permissions from `cast spell` permissions while allowing cards that grant both.
  - Temporary text-derived mixed windows like `Until end of turn, you may play lands and cast spells from your graveyard` now split into separate first-class `play` and `cast` permission entries instead of collapsing into the `play` half. The rules-engine `grant_graveyard_permission` effect-program bridge now emits the same first-class entries alongside its legacy markers, so Gaea's Will / emblem-style mixed permissions stay visible to shared legality and metadata surfaces.
  - Follow-up `modify_graveyard_permissions` steps now thread the exact ids of the permissions created by the immediately preceding grant through both the effect-program runner and the direct Oracle IR executor, so free-cast and exile-replacement modifiers update first-class `graveyardCastingPermissions` instead of only the legacy graveyard card tags. Focused guardrail: `rules-engine/test/graveyardPermissionExecutor.test.ts`.
- [x] Respect land-play limits, additional land-play effects, turn permissions, and timing restrictions.
  - Shared land candidate generation now reuses the normal land timing window: only the active player, during their main phase, with an empty stack, can surface playable lands from hand/library/exile/graveyard. Because the live `playLand` graveyard path, AI enumeration, and stack fallback all consume `getPlayableLandCandidates`, this closes the off-turn graveyard land loophole at the owning abstraction instead of only at the socket handler. Focused guardrails: `server/tests/play-land.graveyard-permission.integration.test.ts` and `server/tests/can-respond.test.ts`.
- [x] Track once-per-turn and per-card-type limits for Muldrotha-style cards.
  - Shared graveyard permission usage now treats `playedLandFromGraveyardThisTurn` as consuming the `land` permanent-type slot for first-class `one_per_permanent_type` land permissions, so Muldrotha-style limits work for both static text and first-class permission entries. Focused `canRespond` coverage now exercises both paths.
- [x] Persist land played from graveyard source metadata and replay it deterministically.
  - Shared graveyard land candidates now preserve permission id/source metadata for both static text permissions and first-class temporary permissions. The live `playLand` handler persists that provenance on stored `playLand` events, and replay reapplies it to the reconstructed permanent/card while still recording `fromZone=graveyard` turn tracking.
- [x] Ensure AI can evaluate land-from-graveyard choices without using illegal extra land plays.
  - AI land decisions already route through `getPlayableLandCandidates()` plus the normal `playLand` request path; focused `ai.shared-land-surface` coverage now verifies both halves explicitly: the AI declines an illegal second graveyard land when no extra land play remains, and it still takes a legal second graveyard land when `Exploration` raises the shared land cap.

### 5. Complete Flashback And Granted Flashback

Source: [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md), items 380-400.

Current implementation status:

- Completed and validated in the current flashback slice: Bulk Up, Artful Dodge, Increasing Vengeance, Increasing Devotion, Moment's Peace, Angelfire Ignition, Forbidden Alchemy, Memory Deluge, Croaking Counterpart, Siphon Insight, Nibelheim Aflame, Rite of Harmony, Divine Reckoning, Prisoner's Dilemma, Electric Revelation, Eviscerator's Insight, Rite of Oblivion, and Summons of Saruman. Bulk Up is noted above with the other graveyard-cast spell handling work; the completed simple flashback cards are tracked below with their guardrails.
- Newly closed in this pass: Angelfire Ignition now rides a generic resolved-spell helper for target +1/+1 counters plus pronoun-based temporary keyword grants; Forbidden Alchemy and Memory Deluge now queue replay-safe top-of-library `LIBRARY_SEARCH` prompts, with Memory Deluge deriving X from the recorded graveyard-cast mana cost; Croaking Counterpart now extends the targeted creature-copy token path to support `target non-Frog creature` plus the `1/1 green Frog` copy modification in live play and replay; Siphon Insight now reuses a replay-safe target-opponent `LIBRARY_SEARCH` prompt that exiles the chosen card face down into that opponent's exile while preserving the caster's live/replay permission to cast it with mana as though it were mana of any type; Nibelheim Aflame now resolves its chosen-creature power sweep in live play and replay and applies the printed flashback-only `discard your hand and draw four cards` rider; Rite of Harmony now creates a temporary end-of-turn creature-or-enchantment ETB draw window that survives replay and expires at cleanup; Divine Reckoning now queues replay-safe per-player creature survivor choices before destroying every other creature; Prisoner's Dilemma now queues replay-safe hidden opponent choices, reveals them only after the batch is complete, and applies the printed 4/8/12-damage branches; Electric Revelation, Eviscerator's Insight, and Rite of Oblivion now preserve their printed discard/sacrifice additional costs through the resumed flashback cast flow; Summons of Saruman now derives X from the cards exiled to pay its flashback cost, amasses Orcs X, mills X, and offers the eligible milled instant/sorcery for a free cast.
- The named flashback card buckets from this subsection are now closed. Remaining Section 5 work is system hardening below.

- [x] Granted flashback: Lier, Disciple of the Drowned; Will of the Jeskai.
  - Focused live coverage now proves both named cards on the shared graveyard-cast path: Lier grants flashback at mana cost from the graveyard, Will's current `Choose one.` modal templating resolves the selected flashback-grant bullet correctly, and commander-present casts can expand Will to `choose both` without losing the chosen mode text on the stack. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
- [x] Simple flashback remaining: none.
  - Focused live/replay flashback coverage now also includes Faithful Mending's printed `gain 2 life, draw two, discard two` flow, including the queued discard step after resolution and flashback exile replacement. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Increasing Devotion now applies `If this spell was cast from a graveyard, create N of those tokens instead` replacement counts in the shared Oracle IR token path, so flashback creates ten Humans instead of the base five. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Increasing Vengeance now resolves the generic `Copy target instant or sorcery spell you control` pattern from the stack and uses the existing graveyard-cast provenance to copy the target spell twice when cast with flashback. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Artful Dodge now rides the printed flashback path and the generic resolved-spell evasion handler for `Target creature can't be blocked this turn`, with live/replay guardrails proving the target receives an end-of-turn unblockable marker and the flashback spell is exiled. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Moment's Peace now rides printed flashback through the generic graveyard activation path, the Oracle IR fallback registers a global combat-damage prevention effect, and server combat damage honors that effect before player/permanent damage, damage trackers, commander damage, and lifelink are applied. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Angelfire Ignition now has live/replay flashback guardrails for two `+1/+1` counters plus vigilance, trample, lifelink, indestructible, and haste until end of turn. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Forbidden Alchemy now has live/replay flashback guardrails for the top-four choose-one `LIBRARY_SEARCH` prompt, graveyard remainder handling, and flashback exile replacement. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Memory Deluge now has live/replay flashback guardrails for `X = mana spent to cast this spell`, the top-seven choose-two `LIBRARY_SEARCH` prompt from flashback, and bottom-of-library remainder handling. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Siphon Insight now has live/replay flashback guardrails for targeting an opponent, queueing the target-opponent top-two choose-one `LIBRARY_SEARCH` prompt, exiling the chosen card face down into that opponent's exile, and casting it later with mana as though it were mana of any type. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Nibelheim Aflame now has live/replay flashback guardrails for the chosen-creature `deals damage equal to its power to each other creature` sweep and the graveyard-only `discard your hand and draw four cards` rider. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Rite of Harmony now has live/replay flashback guardrails for creating the printed temporary `Whenever a creature or enchantment you control enters this turn, draw a card` window, drawing from both the live and replayed ETB path, and expiring that window during cleanup. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Divine Reckoning now has live/replay flashback guardrails for queueing one survivor choice per player with creatures, persisting each choice, and destroying all non-chosen creatures only after the batch is complete. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Prisoner's Dilemma now has live/replay flashback guardrails for queueing hidden silence/snitch choices for each opponent, keeping interim choices out of chat, revealing the full batch only after all opponents choose, and replaying the final damage calculation deterministically. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
  - Croaking Counterpart now has live/replay flashback guardrails for `target non-Frog creature` targeting and the `1/1 green Frog` token-copy override, while the neighboring Cackling Counterpart regression stays green on the same copy-token seam. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
- [x] Flashback with ordinary additional costs: Rite of Oblivion, Eviscerator's Insight, Electric Revelation.
  - Electric Revelation now queues and persists the discard-as-additional-cost path before flashback casting, then draws two cards and exiles itself on resolution in live play and replay.
  - Eviscerator's Insight now parses `sacrifice an artifact or creature` from the ordinary additional-cost line, queues the sacrifice-cost prompt before flashback casting, draws two cards, and replays the sacrifice plus cast deterministically.
  - Rite of Oblivion now parses `sacrifice a nonland permanent`, filters nonland sacrifice and spell targets correctly, exiles target nonland permanent, and replays the sacrifice plus flashback cast deterministically. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.
- [x] Flashback with X/unusual costs: Summons of Saruman.
  - Summons of Saruman now queues an X-sized exile-from-graveyard flashback cost, carries that X onto the stack and replay event, creates or grows an Orc Army, mills X, filters milled instant/sorcery cards by mana value X or less, and reuses the graveyard free-cast prompt. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.

Required system work:

- [x] Make flashback a specialization of the generic graveyard permission system. Printed and granted flashback now use the shared graveyard keyword candidate path with jump-start, retrace, escape, and harmonize, while preserving flashback's exile-after-resolution behavior. Guardrail: `server/tests/can-respond.test.ts`.
- [x] Enforce exile-after-resolution or exile-if-would-leave-stack replacement. Resolved, countered, and all-targets-missing fizzled flashback spells now exile instead of going to graveyard across live stack resolution, replayed `resolveSpell`/`resolveTopOfStack`, and ward-style stack counters. Guardrail: `server/tests/stack.counter.test.ts`.
- [x] Support granted flashback cost derivation from mana value or source text. Granted flashback now derives generic costs from card mana value wording and can read explicit `flashback cost is {N}` source-text sentences for static and temporary grants. Guardrail: `server/tests/can-respond.test.ts`.
- [x] Preserve additional costs and target selection through resumed cast flow. Discard, sacrifice artifact-or-creature, sacrifice nonland permanent, post-cost spell target selection, and X-based graveyard exile costs are now covered for flashback.
- [x] Add replay coverage for cast, countered spell, copied spell, fizzled spell, and declined prompt cases. Cast/copy/declined-prompt replay guardrails live in `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`; countered and fizzled leave-stack replay guardrails live in `server/tests/stack.counter.test.ts`.

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

- [x] Define a durable permission shape for server state.
  - Include source id, source zone, granted-to player, affected card ids or filters, allowed source zones, allowed destination/action, duration, usage limit, cost mode, timing override, and replacement behavior.
  - Include whether the permission is self-granted, static battlefield-granted, emblem-granted, delayed, or one-shot.
  - Include enough data to replay and debug why an action was legal.
  - Initial shape now lives on `GameState.durablePermissions`, with focused adapters for static battlefield land-play permissions and first-class graveyard play/cast permissions. These mirrors preserve source, allowed action/source zone, filters, duration, usage limit, cost mode, replacement behavior, and debug metadata. Guardrail: `server/tests/durable-permissions.test.ts`.

- [x] Integrate permissions with legal action generation.
  - `canRespond` should see cast/play permissions.
  - Client playable highlights should show legal graveyard/exile/library actions.
  - Socket cast/play handlers should validate against the permission object.
  - AI should generate candidate actions from the same permission object.
  - Initial land-play bridge is in place: durable graveyard land permissions feed shared playable-land candidates, client playable-card highlights, the live `playLand` socket handler, and AI land-play discovery. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/playable-cards.broadcast.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`, `server/tests/ai.shared-land-surface.integration.test.ts`.
  - Durable first-class graveyard play/cast permissions now feed the existing shared graveyard permission reader, so durable-only permissions are visible to legal land and spell candidate generation while legacy permissions still win on duplicate ids. Guardrails: `server/tests/can-respond.test.ts`, `server/tests/durable-permissions.test.ts`.
  - Durable exact-card playable-from-exile permissions now feed the shared exile reader, spell candidate generation, land candidate generation, and live `requestCastSpell` / `playLand` exile permission checks. Central Oracle IR impulse exile, library-search exile grants, and live Runestone Caverns dungeon exile grants now mirror their legacy `playableFromExile` markers into durable records, cleanup removes durable entries when the card leaves exile, and durable exile timing/free-cast/flexible-mana grants now propagate through shared candidates, live request-cast timing/payment setup, and AI shared request-cast flows that pass an explicit exile source zone, including response-window `ignoreTiming` sorcery casts. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/playable-from-exile.lifecycle.test.ts`, `server/tests/playable-from-exile.timing.integration.test.ts`, `server/tests/ai.shared-spell-surface.integration.test.ts`, `server/tests/ai.response-window.integration.test.ts`.
  - Direct planeswalker templates for `Exile the top ... You may play them this turn` and red-gated `you may cast it this turn` now mirror their legacy exile markers into durable exact-card records with explicit this-turn expiry, so the shared exile readers can consume those grants without relying only on `playableFromExile`. Guardrail: `server/tests/durable-permissions.test.ts`.
  - Lukka-style `Creature cards exiled this way gain "You may cast this card from exile as long as you control a Lukka planeswalker"` permissions now mirror their legacy exile markers into durable playable-from-exile records with a reusable controlled-permanent condition. Shared candidate generation and live exile cast/play validation also enforce the same legacy card-level condition so marker-only entries do not bypass the condition. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`.
  - Durable top-library play/cast permissions now feed the existing `canPlayLandsFromTop` / `canCastFromTop` readers, so shared land/spell candidates and live top-library `playLand` / `requestCastSpell` validation can consume durable-only library permissions. Durable library `without_paying_mana_cost` grants now flow through shared spell candidates and live top-library cast payment setup as `{0}` free-cast prompts, durable library flexible-mana metadata now lets shared/live/AI top-library casts satisfy colored costs with any mana type, and durable library timing overrides now enforce `duringYourTurnOnly` / `sorcerySpeedOnly` windows while still treating `ignoreTiming` as response-speed authorization for AI response-window casts. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/top-library.cast-timing.integration.test.ts`, `server/tests/ai.shared-spell-surface.integration.test.ts`, `server/tests/ai.response-window.integration.test.ts`.
  - Durable command-zone permission metadata now augments existing command-zone commander candidates without broadening who can cast from command zone: durable records can grant flash/ignore-timing access, tax-aware `without_paying_mana_cost` handling, and flexible mana spending to commanders already in the command zone. The same slice fixed command-zone payment prompts/completion so shared static command-zone adjustments are not double-applied after target selection or no-target payment setup, and AI now uses shared normalized payable costs for flexible-mana commander casts. Durable command-zone `ignoreTiming` commanders are visible to `canRespond` and AI response-window action generation/execution, while non-flash commanders remain excluded from response-mode AI candidates. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/commander.shared-surface.integration.test.ts`, `server/tests/ai.shared-spell-surface.integration.test.ts`, `server/tests/ai.response-window.integration.test.ts`.
  - Temporary graveyard keyword grants for activated graveyard abilities now mirror unearth/embalm windows into durable `activate` permissions, and granted unearth/embalm lookup consumes those durable records before falling back to static battlefield text. This keeps `canActivateAnyAbility`, `canAct`, and live graveyard activation validation aligned with the durable permission surface for the first unusual-zone activation family. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`, `server/tests/disturb.graveyard-replay.integration.test.ts`, `server/tests/embalm-eternalize.graveyard-replay.integration.test.ts`.
  - Static battlefield graveyard play/cast text now synthesizes `GraveyardCastingPermission` objects inside the shared reader itself, so Serra Paragon-, Muldrotha-, Conduit-, and Rivaz-style permissions feed the same matcher and metadata path as first-class and durable entries across `canRespond`, graveyard playable highlights, live `requestCastSpell` / `playLand` validation, and AI/shared candidate generation while still carrying Serra-style replacement riders and source-granted additional costs. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/request-cast.graveyard-permission.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`.

- [x] Support common permission families.
  - Cast from graveyard.
  - Play lands from graveyard.
  - Play/cast cards exiled this way.
  - Cast from library/top of library.
  - Cast from command zone and commander variants.
  - Cast without paying mana cost.
  - Spend mana as though it were mana of any color/type.
  - Activate abilities from unusual zones if product scope includes them.
  - Initial durable mirrors now cover play lands from graveyard, first-class cast/play-from-graveyard permissions, exact-card playable-from-exile grants produced by the central impulse/library-search paths, Runestone Caverns dungeon room, and direct planeswalker top-library exile templates, durable-only top-library play/cast permissions, metadata augmentation for existing commander command-zone casts, and unearth/embalm activation windows granted to graveyard cards; the shared graveyard, exile, top-library, and command-zone commander readers can consume durable-only entries, including free-cast cost modes for exile/library/command metadata, flexible-mana metadata for exile/library/command casts, restrictive top-library timing overrides, response-speed timing grants for durable exile/library/command casts, and durable `activate` records for the first graveyard activated-ability family, while AI now has shared-flow guardrails for exile/library/command free or flexible-mana casts and durable exile/library/command response-window ignore-timing casts. Legacy permission entries still win on duplicate ids. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/effect-program.graveyard-permission.integration.test.ts`, `server/tests/playable-from-exile.lifecycle.test.ts`, `server/tests/playable-from-exile.timing.integration.test.ts`, `server/tests/top-library.cast-timing.integration.test.ts`, `server/tests/commander.shared-surface.integration.test.ts`, `server/tests/ai.shared-spell-surface.integration.test.ts`, `server/tests/ai.response-window.integration.test.ts`, `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`, `server/tests/disturb.graveyard-replay.integration.test.ts`, `server/tests/embalm-eternalize.graveyard-replay.integration.test.ts`.
  - Static battlefield graveyard permissions no longer sit outside that family list: mixed land/spell text, once-per-turn windows, per-permanent-type usage, graveyard free-cast text, and Serra-style leave-battlefield replacement riders now enter the same shared permission object model before the candidate, validation, and AI layers inspect them. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/request-cast.graveyard-permission.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`.

- [x] Support permission expiration.
  - Until end of turn.
  - Until end of next turn.
  - This turn.
  - Once during each of your turns.
  - As long as a source remains on battlefield.
  - While a condition remains true.
  - One-shot prompt windows.
  - Generic durable permission activation now filters records whose explicit usage counters are exhausted (`once`, `once_per_turn`, `one_shot`, and `maxUses`), and durable land/exile/library/command builders preserve `usageLimit` metadata for shared readers. Replay-safe counter writers now capture matched durable permissions before source-zone mutation and increment `used` / `usedThisTurn` only after successful persisted top-library casts, top-library land plays, command-zone commander casts, exile casts, exile land plays, graveyard casts, and graveyard land plays; `nextTurn` resets durable `usedThisTurn` counters so `once_per_turn` permissions become reusable without clearing lifetime `used`. Durable usage recording also carries captured usage metadata across static land-permission refreshes so one-shot refreshed records keep their counters. Durable `while_source_remains` records with battlefield source ids now deactivate when the recorded source permanent is no longer on the battlefield, explicit `expiresAtTurn` now applies even to static/source-bound records, duration aliases such as `until_end_of_turn`, `eot`, and `turn` normalize through the generic active filter and graveyard cleanup, and durable records can now carry reusable condition predicates such as `player_controls_permanent_type` / `player_controls_permanent_named`, including `nameIncludes` matching for "while a condition remains true" windows. The Lukka exile template is now a real producer of a condition-bound durable exile permission. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`.
  - Generic cast-from-exile prompt decline now consumes prompt-only exile permissions even when the declined card remains in exile, and replay preserves the card in exile instead of splicing it away while still clearing legacy/durable playable-from-exile markers. Direct planeswalker cast-or-decline prompts, stack-produced copied-card cast prompts, and resolution-owned free-cast follow-up prompts now also stamp their temporary exile authorization as durable `one_shot` permissions with explicit same-turn expiry. Guardrails: `server/tests/cast-from-exile.decline-effect.integration.test.ts`, `server/tests/durable-permissions.test.ts`, `server/tests/paradigm.integration.test.ts`, `server/tests/resolve-pending-effect-prompt.integration.test.ts`.
  - Shared static battlefield graveyard permission synthesis now derives `once_per_turn`, turn-only timing, and `one_per_permanent_type` usage metadata directly from source text before the shared matcher sees the permission, so Muldrotha/Serra-style static permissions obey the same expiration and reuse checks as first-class and durable entries instead of bypassing them through a bespoke text scan. Guardrails: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/request-cast.graveyard-permission.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`.

- [x] Add focused tests for each permission family and duration.
  - Focused permission guardrails now cover graveyard play/cast, exile play/cast, top-library play/cast, command-zone commander permissions, and unusual-zone graveyard activation windows, with duration and usage coverage for `this_turn`, `end_of_turn`, `until_end_of_next_turn`, `static`, `once_per_turn`, `one_per_permanent_type`, `one_shot`, `while_source_remains`, and condition-bound windows. Representative suites: `server/tests/durable-permissions.test.ts`, `server/tests/can-respond.test.ts`, `server/tests/request-cast.graveyard-permission.integration.test.ts`, `server/tests/play-land.graveyard-permission.integration.test.ts`, `server/tests/playable-from-exile.lifecycle.test.ts`, `server/tests/playable-from-exile.timing.integration.test.ts`, `server/tests/top-library.cast-timing.integration.test.ts`, `server/tests/commander.shared-surface.integration.test.ts`, `server/tests/ai.shared-spell-surface.integration.test.ts`, `server/tests/ai.response-window.integration.test.ts`, `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`, `server/tests/disturb.graveyard-replay.integration.test.ts`, and `server/tests/embalm-eternalize.graveyard-replay.integration.test.ts`.

### C. Replacement And Prevention Effects

Replacement and prevention are essential for real games because they alter events before those events happen.

- [x] Create a generic replacement-effect registry/evaluator.
  - Event inputs should include event type, object ids, source/destination zones, controller/owner, damage amount/source, cause, and pending metadata.
  - Effects should be ordered and replayable.
  - The evaluator should produce an explicit applied/not-applied result for logs and replay.
  - Initial evaluator contract lives in `server/src/state/modules/replacement-effects.ts`, with ordered evaluators returning explicit applied/not-applied metadata for battlefield zone-change replacements. The existing leave-battlefield helper now routes through this evaluator. Guardrail: `server/tests/leave-battlefield-replacement.integration.test.ts`.

- [ ] Cover zone-change replacements.
  - Leave battlefield and exile instead.
  - Die and exile instead.
  - Graveyard replacement such as cards going to exile instead.
  - Commander replacement to command zone.
  - Token disappearance when leaving battlefield.
  - Enter tapped, enter with counters, enter as copy, enter transformed/face down.
  - Progress: leave-battlefield/exile-instead and finality-counter graveyard replacement now share the generic evaluator result contract, while their live helper paths remain unchanged. Ordinary token battlefield exits now also produce explicit `token-ceases-to-exist` evaluator metadata, with hand, graveyard, and library helper guardrails proving non-replacement tokens do not enter those zones. Stack-to-graveyard cleanup for flashback/jump-start/escape/disturb/harmonize and explicit `exileAfterResolution` markers now uses the same evaluator contract before exiling instead. Commander zone-change replacement is represented as a `choiceRequired` evaluator result, preserving the Resolution Queue prompt flow instead of treating the command-zone move as already applied. Battlefield-entry replacements now also have generic evaluator metadata for enter-tapped, entry counters, copy, transformed, and face-down entries, and spell resolution stamps that metadata onto the entering permanent while the existing stack owner path still performs the mutation. Guardrails: `server/tests/replacement-effects.test.ts`, `server/tests/leave-battlefield-replacement.integration.test.ts`, `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`, `server/tests/commander-zone-choice.validate-before-complete.integration.test.ts`, `server/tests/linked-exile.commander-zone-choice.integration.test.ts`, `server/tests/skullbriar.zone-counters.test.ts`.

- [ ] Cover damage replacements and prevention.
  - Prevent next N damage.
  - Prevent all damage from a source.
  - Damage can't be prevented.
  - Damage redirection where applicable.
  - Damage doubling/halving/instead effects.
  - Infect, wither, lifelink, deathtouch, trample interactions.
  - Guardrail progress: combat-damage prevention now has focused coverage for both a global spell rider (Moment's Peace) and a temporary attacker-specific rider (Oketra's Avenger), with combat damage application consulting those effects before marked damage and destruction handling. Shield-counter prevention now also enters the generic replacement evaluator as a damage event result, while the existing live helper still owns consuming the counter. Damage events now represent `damage can't be prevented`, finite prevention shields, and explicit amount modifiers through the generic evaluator, and combat permanent/planeswalker shield paths pass source/state context so prevention-disallowed effects can stop shield replacement. Guardrails: `server/tests/replacement-effects.test.ts`, `server/tests/special-counters.common-effects.test.ts`, `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`, `server/tests/exert-choice.integration.test.ts`.

- [ ] Cover draw, life, token, counter, and search replacements.
  - Draw replacement and dredge-style behavior.
  - Life gain/loss replacement or prevention.
  - Token creation modification.
  - Counter placement modification.
  - Search prevention and replacement.
  - Progress: life-gain prevention and reversal now evaluate through generic `life-gain` replacement events before `applyLifeGain` preserves the existing live mutation behavior. Library-search prevention, top-card limits, payment requirements, control replacement, and search triggers now evaluate through generic `library-search` events, with both socket search restriction helpers consuming the shared evaluator instead of maintaining duplicate card tables. Token creation multipliers now evaluate through generic `token-creation` events before `createToken` applies them, and counter-placement modifiers now emit generic `counter-placement` metadata around the existing replacement-ordering helper. Draw replacement events now cover Dredge choice metadata, Notion Thief-style opponent replacement, and Alms Collector-style batch shared draws; deterministic Notion Thief and Alms Collector branches route through the live `drawCards` helper and replay inherits the same path. Guardrails: `server/tests/replacement-effects.test.ts`, `server/tests/custom-cards.test.ts`, `server/tests/whip-of-erebos.integration.test.ts`, token-doubler/Mirrormind suites, and the library-search replay/regression suites.

- [x] Add replay tests for each replacement category.
  - Progress: focused replay guardrails now cover draw replacement through recorded `drawCards` events, Dredge draw replacement choices through queued prompt response replay, token creation replacement through recorded `createToken` events, damage-prevention metadata through Moment's Peace replay assertions, and battlefield-entry replacement metadata through `resolveTopOfStack` replay assertions, alongside the existing leave-battlefield and library-search replay suites.

### D. Cost And Payment Coverage

The normal cast and activate pipeline must handle all common Magic costs without special-case shortcuts.

- [ ] Normalize all costs through one payment model.
  - Mana, hybrid, Phyrexian, snow, colorless, X, variable, and commander tax.
  - Alternate costs, additional costs, cost increases, cost reductions, and cost replacement.
  - `Without paying its mana cost` with additional costs still payable.
  - Progress: server mana parsing now exposes one canonical `ParsedManaCost` shape with both state (`hybrid`) and socket (`hybrids`) aliases, socket parsing delegates to the state parser, and pending cast metadata carries a normalized mana payment model with original/effective costs, hybrid/Phyrexian choices, free-cast zeroing, and additional-cost preservation. Guardrails: `server/tests/cost-adjustments.test.ts`, `server/tests/static-cost-adjustment.request-cast.integration.test.ts`, `server/tests/commander.shared-surface.integration.test.ts`, `server/tests/hybrid-mana.resume-activation-cost.integration.test.ts`, `server/tests/phyrexian-mana-payment-choice-as-cost.battlefield-activation.integration.test.ts`.

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

- [x] Generalize target selection for all target shapes.
  - Any number of targets.
  - Up to N targets.
  - Multiple target groups with different filters.
  - Different targets / another target / same target constraints.
  - Total power or mana value limits.
  - Zone targets from graveyard, exile, library, stack, command zone, and battlefield.
  - Player targets and opponent-only/team restrictions.
  - Guardrail progress: exert-trigger targeting now covers opponent-filtered battlefield targets like Glorybringer's `target non-Dragon creature an opponent controls` and replay-safe graveyard target binding for Devoted Crop-Mate before the reflexive trigger resolves. Guardrail: `server/tests/exert-choice.integration.test.ts`.

- [x] Generalize non-target choices.
  - Modes, repeated modes, modal DFC-style choices, spree/escalate/entwine/kicker-style choices.
  - Colors, card names, creature types, land types, numbers, piles, votes, directions, opponents.
  - Hidden-information choices with private data boundaries.

- [x] Finish generic ETB target selection for stack items.
  - Generic prompt generation now covers triggered-ability stack items with target metadata.
  - Current guardrails cover battlefield, graveyard, exile, player, and mixed target prompts.

- [x] Ensure every prompt has AI response support.
  - Guardrail progress: explicit AI completion now covers local `suspend_cast` and `morph_turn_face_up` seams. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes reflexive any-amount mana payment prompts and chooses a legal beneficial `pay_N` amount instead of relying on generic option scoring. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes fixed reflexive mana/life payment prompts and chooses `pay` for legal beneficial follow-ups. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now accepts beneficial `sacrifice-when-you-do` ask prompts only when the shared sacrifice matcher finds a legal permanent, so generic sacrifice reflexive discovery does not strand automated players on optional choices or invalid follow-up prompts. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes `sacrifice another permanent` benefit prompts, accepts them only when another controlled permanent is available, and declines when the source is the only legal permanent. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes optional discard-then-draw prompts, accepts them only when the player has a card to discard and enough library for the expected draw after its chosen discard, and declines impossible rummage prompts before they queue invalid discard selections. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes opponent-may-pay prompts, pays legal costs to deny opposing draw/treasure-style value, and declines unaffordable prompts instead of completing invalid `pay` responses. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes reveal-land ETB prompts, reveals an offered matching land to keep the permanent untapped, and declines when the offered card no longer matches the required land type. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Mox Diamond replacement prompts, discards an offered land from hand when legal, and declines when no offered land is available. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Miracle prompts, casts first-drawn miracle cards only when the miracle cost is payable, and declines unaffordable prompts. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes grant-playable-from-exile prompts, ranks only currently offered exiled cards, and ignores tempting stale/non-offered card IDs that the live handler would reject. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes looked-at-card destination prompts, chooses high-value cards for its own beneficial hand choices, and gives opponents the lowest-value offered card when an opponent controls the destination. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes pay-mana-to-look prompts, choosing a useful positive amount capped by available mana and library size instead of falling through to tied numeric options and selecting 0. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes choose-mana-colors prompts and chooses a useful color from the offered set using the normal mana-color balancing heuristic instead of relying on first-option generic scoring. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes move-hand-card-to-library prompts and puts back the lowest-value offered hand card instead of relying on first-option generic scoring. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes attach-equipment-to-permanent prompts, accepts only when controlled Equipment is available, and otherwise prefers declining instead of relying on generic option scoring. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes choose-discard-plan prompts, choosing the preferred typed discard branch only when the hand contains that type and otherwise taking the fallback discard branch. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes choose-player-for-two-pile-split prompts and chooses an offered opponent deterministically instead of relying on generic option scoring. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Force of Will-style exile-card prompts, choosing an offered blue card from hand and avoiding non-blue options. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes resolved-spell copy prompts and copied-spell/ability retarget prompts, declining malformed copy prompts and choosing `retarget` when legal alternate targets are available instead of keeping stale copied targets. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Ratchet-style `convert ... When you do` reflexive prompts and chooses `convert` when the source can transform into a beneficial follow-up. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes generic optional-payment prompts, validates mana/life/energy costs before choosing pay, and declines illegal costs instead of retrying invalid `pay_mana` responses. Guardrail: `server/tests/ai-resolution-step.integration.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Dredge draw replacement prompts, choosing a valid offered graveyard Dredge card when the library can support the mill and otherwise taking the normal draw branch. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Forbidden Orchard target-opponent prompts and gives the Spirit token to the least developed offered opponent instead of relying on generic option ordering. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes choose-pile-from-split prompts, choosing the higher-value pile for its own hand movement and the lower-value pile when sacrificing its own permanents. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes choose-player-for-looked-at-cards prompts and chooses the least developed offered opponent instead of relying on generic option ordering. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Blight-or-pay spell additional-cost prompts, paying mana when the combined spell-plus-tax cost is affordable and choosing Blight only when mana is unavailable but a controlled creature can pay the cost. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes Venture dungeon and room prompts, preferring stable value dungeons and immediate resource/card rooms over self-punishing paths. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes administrative import-wipe and judge-confirm prompts, accepting known admin confirms so AI seats do not strand table votes. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail progress: AI option-choice handling now recognizes exert, MDFC face, spell-bottom reveal-until-nonland, cast-revealed-from-library, Dance with Calamity, and generic cast/play-from-exile-or-graveyard prompts. Guardrail: `server/tests/ai-option-choice.test.ts`.
  - Guardrail complete: option-choice response flags are now statically compared against explicit AI routing with documented exemptions for metadata-only subflags, prompt-producer branches, and legacy mana-payment compatibility. Guardrail: `server/tests/ai-option-choice-coverage.meta.test.ts`.
- [x] Ensure every prompt response is replayed through `applyEvent.ts` or equivalent replay support.
  - Guardrail progress: suspend and morph prompt outcomes now append replay evidence and rehydrate through replay. Guardrail: `server/tests/suspend-morph-prompt.replay.test.ts`.
  - Guardrail progress: reflexive any-amount mana payment prompts now persist `reflexiveManaPaymentResolve`, replay the recorded resource spend, and are registered in replay coverage metadata. Guardrails: `server/tests/ability-activated-copy.applyEvent.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: grant-playable-from-exile choices now persist `grantPlayableFromExileChoiceResolve`, replay selected-card permissions and queued-prompt cleanup, and are registered in replay coverage metadata. Guardrails: `server/tests/grant-playable-from-exile-choice.integration.test.ts`, `server/tests/grant-playable-from-exile-choice.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: looked-at-card destination choices now persist `chooseLookedAtCardsDestinationResolve`, replay chosen/other card movement with queued-prompt cleanup, and are registered in replay coverage metadata. Guardrails: `server/tests/choose-looked-at-cards-destination.integration.test.ts`, `server/tests/choose-looked-at-cards-destination.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: choose-player-for-looked-at-cards choices now persist `choosePlayerForLookedAtCardsChoiceResolve`, replay the chosen player's follow-up destination prompt, clear the original chooser prompt, and are registered in replay coverage metadata. Guardrails: `server/tests/choose-player-for-looked-at-cards.integration.test.ts`, `server/tests/choose-player-for-looked-at-cards.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: pay-mana-to-look choices now persist `payManaToLookAndChooseCardChoiceResolve`, replay the mana payment plus queued looked-at-card destination prompt, clear the original payment prompt, and are registered in replay coverage metadata. Guardrails: `server/tests/pay-mana-to-look-and-choose-card.integration.test.ts`, `server/tests/pay-mana-to-look-and-choose-card.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: choose-mana-colors choices now persist `chooseManaColorsChoiceResolve`, replay intermediate follow-up prompts and final unrestricted/restricted mana additions, clear resolved color prompts, and are registered in replay coverage metadata. Guardrails: `server/tests/choose-mana-colors-choice.integration.test.ts`, `server/tests/choose-mana-colors-choice.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: move-hand-card-to-library choices now persist `moveChosenHandCardToLibraryChoiceResolve`, replay selected hand-card movement to the top or bottom of library, clear resolved prompts, and are registered in replay coverage metadata. Guardrails: `server/tests/move-hand-card-to-library-choice.integration.test.ts`, `server/tests/move-hand-card-to-library-choice.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: attach-equipment-to-permanent choices now persist `attachEquipmentToPermanentChoiceResolve`, replay prompt cleanup for attach/decline/no-equipment responses while leaving final attachment to `equipPermanent`, and are registered in replay coverage metadata. Guardrails: `server/tests/attach-equipment-to-permanent.integration.test.ts`, `server/tests/attach-equipment-to-permanent.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: choose-discard-plan choices now persist `chooseDiscardPlanChoiceResolve`, replay queued discard-selection follow-up prompts, clear resolved plan prompts, and are registered in replay coverage metadata. Guardrails: `server/tests/choose-discard-plan-choice.integration.test.ts`, `server/tests/choose-discard-plan-choice.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: choose-player-for-two-pile-split choices now persist `choosePlayerForTwoPileSplitChoiceResolve`, replay queued two-pile split follow-up prompts, clear resolved chooser prompts, and are registered in replay coverage metadata. Guardrails: `server/tests/choose-pile-from-split-choice.integration.test.ts`, `server/tests/choose-player-for-two-pile-split.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: sacrifice-another-permanent benefit prompts now persist `sacrificeAnotherPermanentForBenefitChoiceResolve` for ask-step cleanup/follow-up restoration and `sacrificeAnotherPermanentForBenefitResolve` for the selected sacrifice, life gain, and draw; both are registered in replay coverage metadata. Guardrails: `server/tests/sacrifice-another-permanent-for-benefit.integration.test.ts`, `server/tests/sacrifice-another-permanent-for-benefit.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: Force of Will-style exile-card prompts now persist `forceOfWillExileChoiceResolve` to clear the resolved alternate-cost prompt, while the existing `castSpellContinuation` replay event remains responsible for life payment, exile movement, and spell alternate-cost flags. Guardrails: `server/tests/alternate-cost.force-of-will.resolution.test.ts`, `server/tests/force-of-will-exile-choice.replay.test.ts`, `server/tests/cast-spell-continuation.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: Miracle prompts now persist `miraclePromptResolve`, replay prompt cleanup, and clear first-drawn flags on declined miracle casts while accepted casts remain owned by the normal cast flow. Guardrails: `server/tests/miracle-prompt.integration.test.ts`, `server/tests/miracle-prompt.replay.test.ts`, `server/tests/cast-spell-continuation.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.
  - Guardrail progress: split-pile and Venture option responses now persist resolved step ids where possible and clear replayed queued prompts; replay coverage metadata now classifies every guarded prompt-like event as cleanup-required or explicitly exempt prompt-producer/gameplay events. Guardrails: `server/tests/choose-pile-from-split-choice.integration.test.ts`, `server/tests/venture-initiative.replay.test.ts`, `server/tests/replay-coverage.meta.test.ts`.

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
  - Guardrail progress: generic discard-selection resolution now detects discard-trigger families with per-card vs per-event batching, typed discard filters, and triggering-player context for "that player" effects. Guardrail: `server/tests/discard-trigger.integration.test.ts`.
  - Guardrail progress: shared card-draw trigger detection now runs on the common `game.drawCards` path, persisting stack entries for supported non-target draw triggers while preserving Smothering Tithe's special payment flow. Guardrail: `server/tests/draw-trigger.integration.test.ts`.
  - Guardrail progress: shared mill, life-loss, pay-life, sacrifice, counter-placement, counter-removal, source damage-to-player, exiled-from-battlefield, put-into-graveyard, left-graveyard, library-search, library-shuffle, token-created, and becomes-untapped trigger families now queue replay-persisted `triggered_ability` stack items with affected-player/permanent/token/payment/search/counter/zone/untap context. Counter-removal coverage includes generic counter updates plus fading/vanishing direct helper paths. Lifegain triggers now use the normal stack path for supported non-target triggers. Representative guardrails: `server/tests/mill-trigger.integration.test.ts`, `server/tests/life-loss-trigger.integration.test.ts`, `server/tests/pay-life-trigger.integration.test.ts`, `server/tests/lifegain-trigger.integration.test.ts`, `server/tests/sacrifice-trigger.integration.test.ts`, `server/tests/counter-trigger.integration.test.ts`, `server/tests/counter-removed-trigger.integration.test.ts`, `server/tests/noncombat-damage-trigger-persistence.integration.test.ts`, `server/tests/exiled-from-battlefield-trigger.integration.test.ts`, `server/tests/put-into-graveyard-trigger.integration.test.ts`, `server/tests/left-graveyard-trigger.integration.test.ts`, `server/tests/library-search-trigger.integration.test.ts`, `server/tests/library-shuffle-trigger.integration.test.ts`, `server/tests/token-created-trigger.integration.test.ts`, and `server/tests/untap-trigger.integration.test.ts`.
  - Guardrail progress: per-attacker and defender-side combat-damage triggers now persist `pushTriggeredAbility` events with damaged-player, defending-player, attacking-player, damage-amount, and effect-data context, and replay skips live rediscovery when those persisted trigger events follow the combat-damage `nextStep`. Guardrail: `server/tests/combat-trigger-persistence.integration.test.ts`.

- [ ] Preserve trigger context.
  - The triggering object.
  - The affected object or player.
  - The entering/leaving zone and destination.
  - The source cast zone.
  - Damage source and damage amount.
  - Controller and owner at trigger time.
  - Snapshots needed for intervening-if checks.
  - Progress: tap-trigger stack items now persist tapped-permanent snapshots in `effectData`, becomes-untapped triggers persist untapped-permanent snapshots for Mesmeric Orb-style effects, exiled-from-battlefield triggers persist the exiled permanent plus source/destination zones, put-into-graveyard triggers persist the card, graveyard owner, controller, and source/destination zones, left-graveyard triggers persist the card and graveyard owner context, and the broader `pushTriggeredAbility` replay path preserves context fields such as `targetPlayer`, `triggeringPlayer`, `triggeringPermanentId`, `defendingPlayer`, and arbitrary `effectData`. Guardrails: `server/tests/drowner-of-secrets.activation.integration.test.ts`, `server/tests/untap-trigger.integration.test.ts`, `server/tests/exiled-from-battlefield-trigger.integration.test.ts`, `server/tests/put-into-graveyard-trigger.integration.test.ts`, `server/tests/left-graveyard-trigger.integration.test.ts`.
  - Progress: `pushTriggeredAbility` replay now restores combat damage-specific context fields (`damagedPlayerId`, `attackingPlayerId`, `damageAmount`, and damage-source metadata), and the public game surface keeps `game.state` synchronized with internal effect-program state replacement so deferred optional triggers resume against the live stack. Guardrails: `server/tests/combat-trigger-persistence.integration.test.ts`, `server/tests/combat-damage-to-you.regression.integration.test.ts`.
  - Progress: exiled-from-battlefield triggers now cover the shared leave-battlefield replacement exile helper for non-commander permanents and commander replacement choices that actually stay in exile, in addition to direct battlefield-to-exile movement. Guardrail: `server/tests/exiled-from-battlefield-trigger.integration.test.ts`.
  - Progress: spell-cast trigger stack entries now persist the triggering spell's cast source zone for hand, graveyard, and opponent spell-cast trigger paths, and replay restores that context through `pushTriggeredAbility`. Guardrail: `server/tests/spell-cast-trigger-persistence.integration.test.ts`.
  - Progress: token-created triggers now persist source permanent snapshots plus created token snapshots, including controller/owner at trigger time, and replay restores both through `pushTriggeredAbility`. Guardrail: `server/tests/token-created-trigger.integration.test.ts`.
  - Progress: shared zone-change trigger queues now persist source permanent snapshots for exiled-from-battlefield, put-into-graveyard, and left-graveyard triggers, preserving source controller/owner context alongside the moved-object context. Guardrails: `server/tests/exiled-from-battlefield-trigger.integration.test.ts`, `server/tests/put-into-graveyard-trigger.integration.test.ts`, `server/tests/left-graveyard-trigger.integration.test.ts`.
  - Progress: life-total trigger queues now persist source permanent snapshots for lifegain, life-loss, and pay-life triggers, preserving source controller/owner context alongside affected-player and amount/payment context. Guardrails: `server/tests/lifegain-trigger.integration.test.ts`, `server/tests/life-loss-trigger.integration.test.ts`, `server/tests/pay-life-trigger.integration.test.ts`.

- [ ] Complete trigger ordering.
  - APNAP ordering for multiplayer.
    - Progress: zone-change trigger queues added in `server/src/state/modules/triggers/zone-change.ts` now push simultaneous exiled-from-battlefield, put-into-graveyard, and left-graveyard triggers in APNAP order while preserving stable order within a controller. Guardrail: `server/tests/put-into-graveyard-trigger.integration.test.ts`.
    - Progress: shared `orderTriggersByAPNAP` now covers the common persisted trigger queues for lifegain, life-loss, pay-life, sacrifice, counter placement/removal, library search/shuffle, token-created, discard, draw, mill, and becomes-untapped families. Guardrail: `server/tests/life-loss-trigger.integration.test.ts`.
    - Progress: combat-damage trigger stack entries collected during the damage step now run through the same APNAP ordering pass before stack push and replay persistence, covering simultaneous defender-side triggers across multiple damaged players. Guardrail: `server/tests/combat-trigger-persistence.integration.test.ts`.
    - Progress: declare-blockers stack entries now preserve blocker-trigger controller IDs and order mixed defender-side `blocks` plus attacker-side `becomes blocked` triggers by APNAP before stack push and replay persistence. Guardrail: `server/tests/afflict.block-trigger.integration.test.ts`.
  - Optional trigger prompts.
  - Trigger target selection.
    - Progress: common persisted trigger queues now attach generic target-selection metadata for supported battlefield/player target effects instead of dropping target-bearing effects. These stack items reuse the existing triggered-ability `TARGET_SELECTION` prompt path. Guardrail: `server/tests/life-loss-trigger.integration.test.ts`.
  - Delayed trigger creation and expiration.
    - Progress: activated effects such as Mishra's Bauble now schedule `Draw a card at the beginning of the next turn's upkeep` as a replay-persisted delayed upkeep trigger instead of drawing immediately, then expire the pending entry when the upkeep trigger is queued. Guardrail: `server/tests/delayed-upkeep-draw.integration.test.ts`.
  - Reflexive `When you do` triggers.
    - Progress: variable mana reflexive prompts now support `you may pay any amount of {R}. When you do...` patterns such as Leyline Tyrant through Resolution Queue option-choice prompts, persisted `reflexiveManaPaymentResolve` decisions, and separate replay-safe follow-up `pushTriggeredAbility` stack entries. Existing sacrifice-when-you-do prompts now carry generic follow-up descriptions and inferred target metadata instead of only fixed damage/lifegain payloads. Guardrails: `server/tests/death-trigger.graveyard-return.integration.test.ts`, `server/tests/ability-activated-copy.applyEvent.test.ts`, and `server/tests/after-sacrifice-followup-target-selection.integration.test.ts`.
    - Progress: fixed mana/life reflexive prompts now support `you may pay {B} and 2 life. When you do...`-style patterns through explicit Resolution Queue option-choice prompts, persisted `reflexiveFixedPaymentResolve` resource spending, AI payment selection, and separate replay-safe follow-up `pushTriggeredAbility` stack entries. Guardrails: `server/tests/death-trigger.graveyard-return.integration.test.ts`, `server/tests/ability-activated-copy.applyEvent.test.ts`, `server/tests/ai-resolution-step.integration.test.ts`, and `server/tests/replay-coverage.meta.test.ts`.
    - Progress: generic triggered-ability text such as `You may sacrifice a creature. When you do, destroy target creature or planeswalker.` now queues the same Resolution Queue ask/select/follow-up flow automatically, with replay prompt evidence preserved by the existing top-of-stack prompt and sacrifice follow-up events. Guardrails: `server/tests/after-sacrifice-followup-target-selection.integration.test.ts`, `server/tests/ai-resolution-step.integration.test.ts`.
    - Progress: generic triggered stack text such as `You may sacrifice another permanent. If you do, you gain 3 life and draw a card.` now queues the existing ask/select sacrifice-benefit flow instead of requiring a hand-seeded prompt or planeswalker template path. Guardrail: `server/tests/sacrifice-another-permanent-for-benefit.integration.test.ts`.
    - Progress: single-card discard reflexives now support `You may discard a card. When you do...` through an ask prompt, the shared `DISCARD_SELECTION` card picker, persisted `reflexiveDiscardResolve` follow-up evidence, AI choice handling, and replay-safe `pushTriggeredAbility` restoration. Guardrails: `server/tests/reflexive-discard-followup.integration.test.ts`, `server/tests/ai-resolution-step.integration.test.ts`, and `server/tests/replay-coverage.meta.test.ts`.
    - Progress: optional discard-then-draw text now preserves the `If a land card was discarded this way, draw an additional card` rider from generic triggered stack resolution into the shared `DISCARD_SELECTION` prompt, so the follow-up draw count is decided from the discarded card instead of drawing unconditionally. Guardrail: `server/tests/optional-discard-then-draw-choice.integration.test.ts`.
    - Progress: typed graveyard-exile reflexives now support `You may exile a creature card from your graveyard. When you do...` and fixed-count `exile N cards from your graveyard` prompts through an ask prompt, shared `GRAVEYARD_SELECTION`, persisted `reflexiveGraveyardExileResolve` follow-up evidence, AI choice handling, and replay-safe `pushTriggeredAbility` restoration. Guardrails: `server/tests/reflexive-graveyard-exile-followup.integration.test.ts`, `server/tests/ai-resolution-step.integration.test.ts`, and `server/tests/replay-coverage.meta.test.ts`.
    - Progress: bound self-exile death reflexives now support `When this creature dies, you may exile it. When/If you do...` plus prelude-first `Then you may exile this card. When you do...` cases such as each-player-mills-before-exile. The dying card is bound in its owner's graveyard, prelude mill events are persisted for replay, the exact card is exiled through an option-choice prompt, and the follow-up trigger is restored through the existing `reflexiveGraveyardExileResolve` plus `pushTriggeredAbility` replay path. Guardrails: `server/tests/reflexive-bound-graveyard-exile-followup.integration.test.ts`, `server/tests/ai-resolution-step.integration.test.ts`.
    - Progress: mandatory self-exile token reflexives such as `exile it. If you do, create a 5/5 black Demon creature token with flying` now persist the battlefield-to-exile move plus deterministic token creation replay evidence. Guardrail: `server/tests/graveyard-provenance-etb.integration.test.ts`.
    - Progress: Ratchet-style lifegain reflexives now preserve the full `You may convert... When you do...` trigger text, queue a Resolution Queue convert choice, persist the conversion decision, and push the graveyard artifact return as a replay-safe targeted follow-up with dynamic life-gained mana-value filtering and tapped battlefield return metadata. Guardrails: `server/tests/lifegain-trigger.integration.test.ts`, `server/tests/reflexive-convert.replay.test.ts`.
    - Progress: conditional battlefield self-exile reflexives now support Regenerations Restored-style counter-removal text, resolving the prelude first, checking `this enchantment has no time counters on it`, exiling the exact source permanent, and pushing the `When you do` extra-turn follow-up through replay-safe `exilePermanent` plus `pushTriggeredAbility` events. Guardrail: `server/tests/counter-removed-trigger.integration.test.ts`.
  - Intervening-if at trigger time and resolution time.
    - Progress: resolution-time intervening-if reconstruction now covers common generic trigger families such as life-loss, pay-life, sacrifice, counters, library shuffle, token-created, draw, discard, mill, untap, and zone-change triggers. Guardrail: `server/tests/life-loss-trigger.integration.test.ts`.

- [ ] Make replay restore trigger stack state without rediscovering live triggers.
  - Progress: zone-change trigger helpers now skip live rediscovery for exiled-from-battlefield, graveyard-entry, and left-graveyard trigger queueing during replay; `pushTriggeredAbility` replay remains the source of restored stack state. Guardrails: `server/tests/exiled-from-battlefield-trigger.integration.test.ts`, `server/tests/put-into-graveyard-trigger.integration.test.ts`, `server/tests/left-graveyard-trigger.integration.test.ts`.
  - Progress: common live trigger discovery paths now also skip during replay for lifegain, life-loss, pay-life, sacrifice, counter placement/removal, library search/shuffle, draw, discard, mill, token-created, and becomes-untapped families. Guardrail: `server/tests/life-loss-trigger.integration.test.ts`.

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
  - Guardrail progress: spell-copy lineage now preserves `copiedFromStackItemId` through graveyard-cast copy effects, so flashback Increasing Vengeance recreates both copied spells deterministically in live play and replay. Guardrail: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`.

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
  - Guardrail progress: declare-blockers now rejects temporary `can't be blocked` and `can't be blocked by creatures with power 2 or less this turn` riders created by exert resolution, covering Clockwork Droid and Rhonas's Stalwart without needing card-specific combat branches. Guardrail: `server/tests/exert-choice.integration.test.ts`.
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
