# Full-Game Card Support Todo

Last updated: 2026-05-17

Owner: Copilot + project maintainers

Goal: make MTGEDH able to play real games of Magic from start to finish with all, or nearly all, black-border paper cards usable by players or AI, with effects resolving as expected, state tracked correctly, replay remaining deterministic, and the test/build baseline staying green.

This is the working completion checklist. Existing queue files such as [oracle-automation-next-200-offset-200.md](./oracle-automation-next-200-offset-200.md) are candidate generators and lead lists. This file is the implementation todo that turns those leads into engine work.

## Current Baseline

- [x] Latest known broad validation was green after the graveyard provenance work: `npm test`, `npm run build`, and `npm run typecheck --workspace=server` passed.
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
  - Guardrail progress: combat-damage prevention now has focused coverage for both a global spell rider (Moment's Peace) and a temporary attacker-specific rider (Oketra's Avenger), with combat damage application consulting those effects before marked damage and destruction handling. Guardrails: `server/tests/cast-from-graveyard.graveyard-replay.integration.test.ts`, `server/tests/exert-choice.integration.test.ts`.

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
  - Guardrail progress: exert-trigger targeting now covers opponent-filtered battlefield targets like Glorybringer's `target non-Dragon creature an opponent controls` and replay-safe graveyard target binding for Devoted Crop-Mate before the reflexive trigger resolves. Guardrail: `server/tests/exert-choice.integration.test.ts`.

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
