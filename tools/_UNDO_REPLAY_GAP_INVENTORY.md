# MTGEDH Undo/Replay Event Recording Gap Inventory

**Scope:** READ-ONLY audit of `D:\\Git\\MTGEDH` (server/src). No commits, no refactors, no fixes applied.
**Method:** Extracted 274 `case` labels from `server/src/state/modules/applyEvent.ts` (~16.8k lines). Collected event type strings from `appendEvent` / `appendGameEvent` / `appendMutationEvent` across `server/src` (220 distinct types). Diffed emitters vs handlers; scanned stubs/best-effort/TODO; sampled high-churn mutation sites in resolution/game-actions/interaction/combat/counters_tokens for missing nearby persistence.

**Date:** 2026-08-22

---

## Summary (counts)

| Metric | Count |
|---|---|
| `applyEvent` string cases (incl. nested effect kinds) | 274 |
| Distinct emitted event types (`appendEvent`+`appendGameEvent`+`appendMutationEvent`) | 220 |
| Emitted types with **no** `applyEvent` case (real) | **1** remaining (intentional meta `judgeGranted` only) â€” was 7; pregame turn trio + loop shortcut consent pair closed 2026-08-22 |
| `applyEvent` cases with **no** matching emitter (many are nested/phase aliases/legacy) | 63 |
| Of those 63: nested effect kinds inside `resolveSpell`/`executeEffect` | ~19 |
| Of those 63: phase-name aliases inside `nextStep` | 12 |
| Of those 63: dungeon/zone nested under other events | ~12 |
| Likely orphan/legacy apply handlers (no live emitter found) | ~20 |
| Stub / incomplete / best-effort-notable handlers reviewed | ~16 clusters |
| Sampled mutation sites w/o nearby append (resolution) | 68 / 157 |
| Sampled mutation sites w/o nearby append (game-actions) | 24 / 31 |
| Sampled mutation sites w/o nearby append (interaction) | 39 / 78 |
| `temporaryPTMods.push` live sites with no dedicated event | 6 |
| Direct `counters.loyalty =` mutation sites (bypass `updateCounters`) | ~15+ gameplay paths |

**Priority category coverage status (short):**
- Attach/equip/aura: mostly evented on primary paths; SBA/bestow auto-unattach and some attach helpers still silent
- Counters: `updateCounters` auto-persists; many loyalty/station/direct counter writes bypass it
- Temp P/T / until EOT: **major gap** outside OracleIR patch path
- Draw/discard/mill: mixed; helpers sometimes mute events
- Modal/type/color/X/option: mostly evented; `optionChoice` payload/step cleanup incomplete
- Tap/untap/mana: primary interaction paths evented; resolution mana taps often silent
- Tokens: via `executeEffect` createToken payloads (not raw `createToken` type)
- Stack/optional: generally evented; ability activation is best-effort rebuild
- Combat declare: evented; marked damage largely unpersisted as discrete events
- Zone moves: helper-driven; commander CZ choice fixed; thin `moveCommanderToCZ` remains
- Commander zone replacement: live choice event fixed; replay GY path still defaults CZ when prompting impossible

---

## Stubs & incomplete replay handlers (detailed)

### 1) `activateBattlefieldAbility` Ã¯Â¿Â½ best-effort / partial restore Ã¯Â¿Â½ **Critical**
- **Status (2026-08-22):** Critical gap #3 CLOSED (split contract). Live generic path now persists `stackItemId`; applyEvent is cost/tap/stack + rich payload only (counterUpdates/specialAnimation/hideaway/queued step/known abilityTypes); `usesStack:false` no longer invents stack from cost evidence; counter apply uses `skipEventPersistence`/`skipCounterModifications` to avoid double-apply. Residual: legacy events without `usesStack`/`stackItemId`; non-stack one-shots that still omit rich payload / follow-up events; floating-mana `paymentManaDelta` still missing on some generic interaction emits.
- **Where:** `applyEvent.ts:8855`
- **Comment:** "Best-effort replay hookÃ¯Â¿Â½ We only use it for replay-stable evidence tracking."
- **Live:** pays costs, may push stack ability, resolve effects, mutate BF/zones/mana.
- **Replay:** clears queued steps; reapplies persisted cost side-effects (discard/exile/sacrifice/bounce/tap); rebuilds stack item for known abilityTypes (equip/fortify/fight/counters/level_up/outlast/monstrosity/adapt/reconfigureÃ¯Â¿Â½); does **not** fully re-execute arbitrary ability effects. Heavy `// best-effort only` catch-ignore blocks.
- **Drift risk:** non-stack one-shots / unmodeled abilityTypes / missing payload fields ? undo leaves ability "paid" without effect or double-applies costs inconsistently.

### 2) `station_activated` emitted, **no apply case** Ã¯Â¿Â½ **CLOSED** (prior)
- **Live:** `resolution.ts:11933Ã¯Â¿Â½11993` Ã¯Â¿Â½ IR or direct `counters[counterType] +=`; may set `stationed=true` + `grantedTypes` Creature; then `appendGameEvent(..., 'station_activated', {countersAdded, stationed, ...})`.
- **Replay:** event ignored by `applyEvent` ? charge counters / stationed creature status drift on undo/reload.
- **Note:** IR path may also persist counter diffs via OracleIR helpers, but fallback direct write + `stationed` flag rely on this event.

### 3) Temporary P/T / continuous until EOT Ã¯Â¿Â½ **Critical**
Live mutates `temporaryPTMods` / `temporaryAbilities` / `grantedAbilities` with **no** dedicated event (unless OracleIR `battlefieldPermanentPatch` happens to cover):
| Site | File:line | What live does |
|---|---|---|
| Begin-combat X buff | `resolution.ts:22323-22324` | push `{power,toughness,until:'end_of_turn'}` + grantedAbilities string |
| Legacy target buff | `oracleIrSpellLegacyTargetBuffUtils.ts:112-132` | **also** direct `counters['+1/+1'] +=` (bypasses `updateCounters`) + temp PT + temp abilities |
| Double power until EOT | `stackResolveSpellLegacySpecUtils.ts:156-163` | temp PT only |
| Join Forces +X/+0 | `joinForcesResolutionQueue.ts:185-190` | temp PT from contributions |
| OracleIR zone sync | `oracleIrServerZoneSync.ts:6997+` | may pair with patches (better) |
| Dash/Blitz haste | `keywordCastDelayedEffects.ts:27` | `temporaryAbilities` haste; often no patch |

`temporaryPtMods.ts` has **0** `appendEvent` refs (read helper only).

### 4) Loyalty direct writes (bypass `updateCounters`) Ã¯Â¿Â½ **High**
| Site | Notes |
|---|---|
| `interaction.ts:9630-9634` | Apply loyalty cost before stack; event `activatePlaneswalkerAbility` follows (~9670) Ã¯Â¿Â½ apply handler re-applies loyaltyCost (**OK if event always fired**) |
| `resolution.ts:22633-22637` | Same pattern after target selection + `activatePlaneswalkerAbility` |
| `game-actions.ts:4458-4465` | Spell-cast trigger adds loyalty **with no `updateCounters` / no event** |
| `triggerPlaneswalkerLoyaltyUtils.ts:31` | Direct assign |
| `planeswalker/templates/resolve.ts` many | Direct `counters.loyalty +=` without persistence |

### 5) `optionChoice` incomplete vs live Ã¯Â¿Â½ **High**
- **Live payload** (`resolution.ts:36248`): `playerId, permanentId, cardName, chosenOptions` Ã¯Â¿Â½ **no `resolvedStepId`**.
- **Apply** (`applyEvent.ts:16104`): sets `chosenOption(s)` on permanent; **does not** `clearReplayQueuedSteps`.
- Compare to well-formed `myriadChoice` (clears step + replays token creates). Prompt can linger / reappear after undo.

### 6) `moveCommanderToCZ` thin handler Ã¯Â¿Â½ **Medium** (legacy path)
- `applyEvent.ts:2560-2566`: only calls `moveCommanderToCZ(...)` Ã¯Â¿Â½ the **old incomplete pattern**.
- **Fixed successor:** `commanderZoneChoice` (`2569+`) mirrors live resolution cleanup (remove BF/stack/zone ghosts, reinsert CZ card). Comment at 2596-2598 documents prior bug.

### 7) Marker-only / intentional no-ops Ã¯Â¿Â½ **Low**
- `loopShortcutBatchStart/End` (`2126`): markers only; mutations via per-action events or `loopShortcutBatchApply`.
- `skipOpeningHandActions` (`12747`): marker, bumpSeq only.

### 8) Fallthrough groups that **are** implemented (not stubs)
These looked empty in a naive parser but fall through into real bodies:
- `setLife` ? `adjustLife`
- `tapPermanent` ? `untapPermanent`
- `permanent_tapped` ? `permanent_untapped`
- `declareAttackers` ? `declareControlledAttackers`
- `declareBlockers` ? `declareControlledBlockers`
- `kynaiosChoiceInitiated/Response` ? `Complete`
- `joinForcesInitiated/Contribution` ? `Complete`
- `temptingOfferInitiated/Response` ? `Complete`

### 9) Likely orphan apply handlers (no emitter found) Ã¯Â¿Â½ **LowÃ¯Â¿Â½Medium**
Including: `dealDamage`, `pushStack`, `castCommander`, `createToken` (raw; live uses `executeEffect`), `activateAbility`, `additionalCostConfirm`, `targetSelectionConfirm`, `librarySearchSelect`, `selectFromLibrary`, `handIntoLibrary`, `sacrificeSelected`, `updateCountersBulk`, `removePermanent`, `removePlayer`, `spectatorGrant/Revoke`, `skipPlayer/unskipPlayer`.
These don't cause live?replay drift unless old DB logs still contain them; `createToken` vs `executeEffect` naming is a footgun for readers.

---

## appendEvent without applyEvent

**Real gaps (exclude false-positive debug strings):**

| Event type | Emitter | Rank | Why it matters |
|---|---|---|---|
| `station_activated` | `resolution.ts:11981` | **CLOSED** (prior in series) | applyEvent applies counters + `stationed` / `grantedTypes` |
| `proposeLoopShortcut` | `loopShortcut.ts:99` | **CLOSED 2026-08-22** | applyEvent restores `pendingLoopShortcut` when `opponentIds` non-empty; clears when empty (live auto-approve) |
| `resolveLoopShortcutConsent` | `loopShortcut.ts:198` | **CLOSED 2026-08-22** | applyEvent clears `pendingLoopShortcut` (live lasting mutation; consent payload is socket-only) |
| `claimTurn` | `game-actions.ts:15150` | **CLOSED 2026-08-22** | applyEvent mirrors live: `turnPlayer` + `startingPlayerId`/`startingPlayer` if missing |
| `randomizeStartingPlayer` | `game-actions.ts:15228` | **CLOSED 2026-08-22** | applyEvent sets `turnPlayer` + `startingPlayerId`/`startingPlayer` from `selectedPlayerId` |
| `autoAssignTurn` | `game-actions.ts:15333` | **CLOSED 2026-08-22** | applyEvent sets `turnPlayer` only (mirrors live nextTurn solo path) |
| `judgeGranted` | `judge.ts:215` | Low / **intentional non-replayed meta** | Runtime-only `game._judgeRuntime.judgeId` + socket `role`; not on `GameContext`/state. Keep emitting for clients; undo does not restore judge role (acceptable meta). |

False positives from string scrape: `[commander-socket]…`, `[phaseSkip] Failed to draw card:`.

**Dynamic type (covered by apply):** `permanent_tapped` / `permanent_untapped` via ternary (`resolution.ts:11227`).

---

## Likely live mutations without events (sampled hotspots)

### Attach / equip / aura / unattach
- **Covered:** `equipPermanent` (resolution + triggerEquipmentUtils), `attachEnchantmentPermanent`, `fortifyPermanent`, `reconfigurePermanent` / `reconfigureUnattachPermanent`, `attachEquipmentToPermanentChoiceResolve`.
- **Gaps:**
  - SBA bestow/reconfigure auto-unattach + basePower/Toughness restore (`counters_tokens.ts:2228-2265`) Ã¯Â¿Â½ **no event** (**High** if SBA runs during live between events).
  - Pre-sacrifice attachment pointer cleanup (`interaction.ts:6004-6023`) before `sacrificePermanent` Ã¯Â¿Â½ pointers not in sacrifice payload; replay may leave stale `attachedTo` until SBA (**Medium**).
  - Planeswalker template / some attach helpers assign `attachedTo` without always emitting.

### Counters
- `updateCounters` auto-`appendEvent` unless `isReplaying` / `skipEventPersistence`.
- **Bypass hotspots:** loyalty direct writes (above); station fallback direct counter write; legacy buff `counters['+1/+1'] +=` in `oracleIrSpellLegacyTargetBuffUtils.ts:112-113`; `stackResolveAbilityMidHandlersUtils.ts:107` uses `skipEventPersistence: true` (expects parent event to cover Ã¯Â¿Â½ verify parent always exists).

### Temp P/T / continuous / until EOT
See stub Ã¯Â¿Â½3 Ã¯Â¿Â½ highest density of silent BF mutations.

### Draw / discard / mill / library
- Opening/mulligan/phase-skip draw generally evented (`drawCards`).
- Trigger/resolution `game.drawCards(...)` sites often **lack nearby append** (e.g. `game-actions.ts:5136`, several `resolution.ts` draws) Ã¯Â¿Â½ **High** if draw helper itself does not persist (needs confirm: zones helpers).
- Mill: `mill` events exist; `millCardsFromLibrary` in loop shortcut / soak paths may skip or batch.

### Modal / type / color / X / option
- `colorChoice`, `basicLandTypeChoice`, `creatureTypeSelected`, `cardNameChoice`, `setPermanentSelectedMode`, `playerChoice`, `playerSelection` Ã¯Â¿Â½ generally evented with step ids.
- `optionChoice` Ã¯Â¿Â½ incomplete (Ã¯Â¿Â½5).
- X values often baked into later effect events; if effect itself is silent (temp PT), X is lost.

### Tap / untap / mana pool
- Interaction `tapPermanent` / `untapPermanent` / `activateManaAbility` Ã¯Â¿Â½ evented with mana payloads.
- Resolution auto-tap + manaPool writes (`resolution.ts:~1893-2275`, `~12226`) Ã¯Â¿Â½ often **no nearby append** (**High** for ability/spell-driven mana).

### Token create / copy
- Persisted as `executeEffect` with `effectType:'createToken'` from `createToken` helper (gated `isReplaying`).
- Copy-token / myriad paths use dedicated events when instrumented; uninstrumented createToken call sites with `skipEventPersistence: true` rely on parent.

### Stack push / resolve / optional may/pay
- `pushTriggeredAbility` heavily used (~60); death pushes gated by `isReplaying` (good).
- `mayAbilityResolve`, `optionalPaymentPromptResolve`, `opponentMayPayResolve` present.
- Risk: live `state.stack.push` without `pushTriggeredAbility` / `pushStack` event (combat/game-actions samples) Ã¯Â¿Â½ **High** if not followed by serialize append.

### Combat
- Declare attackers/blockers evented (incl. controlled variants).
- Marked damage / infect damage often applied without discrete damage events (combat-damage-processing uses `updateCounters` for wither/infect counters Ã¯Â¿Â½ good; marked damage fields less so) Ã¯Â¿Â½ **Medium**.

### Zone moves / commander
- Zone helpers + `commanderZoneChoice` fixed path.
- Replay commander default-to-CZ inside `movePermanentToGraveyard` when `isReplaying` (`counters_tokens.ts:1695-1720`) can briefly diverge until `commanderZoneChoice` applies; if choice event missing ? **Critical** wrong zone.

---

## Already-known fixed patterns Ã¯Â¿Â½ similar remains?

### `commanderZoneChoice` (FIXED)
Full mirror of live CZ move + zone/BF/stack cleanup (`applyEvent.ts:2595-2652`). Comment explicitly calls out prior `moveCommanderToCZ`-only bug.
**Similar remains:** thin `moveCommanderToCZ` event/handler still exists; any live path still emitting only that type can regress. Replay-time default CZ placement in GY helper still assumes later choice event.

### `isReplaying` death triggers (FIXED)
`pushDeathTriggerOntoStack` returns early when `isReplaying` (`counters_tokens.ts:490-495`) to avoid duplicate Deathmantle/etc. orphans.
**Similar remains / watchlist:**
- Other stack pushes not gated (combat `stack.push`, copy paths) can still duplicate if live also appends `pushTriggeredAbility`.
- ETB/LTB side effects inside zone movers Ã¯Â¿Â½ partially gated; verify each new trigger family.
- Mirrormind Crown prompt skipped on replay (`createToken` ~1063) Ã¯Â¿Â½ OK if replacement choice event exists; else silent miss.
- Legend rule choice skipped when `isReplaying` (`counters_tokens.ts:2366`) Ã¯Â¿Â½ needs persisted choice event (confirm coverage).

---

## Recommended fix order (top 10)

1. **Add `applyEvent` case for `station_activated`** (apply counters + `stationed` + `grantedTypes`; clear related step). Prefer routing counter write through `updateCounters`.
2. **Persist temporary P/T / temporary abilities** Ã¯Â¿Â½ either generalize `battlefieldPermanentPatch` for all temp-mod writers, or add `temporaryPTModApplied` / patch at each push site (resolution buffs, legacy target buff, join forces, double-power).
3. **Stop bypassing `updateCounters` for loyalty / +1/+1** (spell-cast loyalty trigger; legacy buff counters; planeswalker template resolves).
4. **Harden `activateBattlefieldAbility` replay** Ã¯Â¿Â½ require abilityType + effect payload for non-stack activations; fail closed or emit follow-up mutation events instead of best-effort-only.
5. **Fix `optionChoice`** Ã¯Â¿Â½ include `resolvedStepId` (+ step type flags); clear queue on apply (mirror `myriadChoice`).
6. **Instrument resolution mana tap / pool mutations** with `tapPermanent`/`activateManaAbility`/`addManaToPool` payloads.
7. **Audit `game.drawCards` / mill call sites** without append; either persist inside zones helper or append at each live call.
8. **Event SBA attachment unattach / restore** (or make unattach idempotent from sacrifice/equip events so replay converges).
9. **Add apply handlers for pregame turn events** (`claimTurn`, `randomizeStartingPlayer`, `autoAssignTurn`) so reload restores starting player. Ã¢â‚¬â€ **CLOSED 2026-08-22** (`applyEvent` + `tests/pregame-turn-events.replay.test.ts`). `judgeGranted` left as intentional non-replayed meta.
10. **Loop shortcut consent events** (`proposeLoopShortcut`, `resolveLoopShortcutConsent`) â€” **CLOSED 2026-08-22**: applyEvent mirrors live `pendingLoopShortcut` set/clear. Tests: `server/tests/loop-shortcut-consent.replay.test.ts`.

---

## Inventory notes / non-goals

- Nested effect kinds (`AddCountersPermanent`, phase names, dungeon zone cases) appearing "unused" are usually applied under `resolveSpell` / `executeEffect` / `nextStep` Ã¯Â¿Â½ not missing emitters.
- Prefer `appendGameEvent` wrapper (`socket/util.ts`) when grepping; raw `appendEvent` scrape undercounts.
- Temp audit scripts used under `tools/_audit_*` should be deleted after this report (cleanup requested).


---

## Closed in this pass (2026-08-22) Ã¢â‚¬â€ pregame turn events (#9)

**Live payloads / mutations**
- `claimTurn` `{ by }` Ã¢â‚¬â€ `turnPlayer = by`; set `startingPlayerId`/`startingPlayer` only if missing (`game-actions.ts` claimMyTurn).
- `randomizeStartingPlayer` `{ selectedPlayerId, by }` Ã¢â‚¬â€ sets `turnPlayer` + `startingPlayerId`/`startingPlayer` to selected.
- `autoAssignTurn` `{ playerId }` Ã¢â‚¬â€ sets `turnPlayer` only (solo nextTurn auto-assign).

**Fix:** `applyEvent` cases after `setTurnDirection` mirror the above. Live already mutates before `appendGameEvent` (which also calls `applyEvent`); apply is idempotent assignment.

**Tests:** `server/tests/pregame-turn-events.replay.test.ts` (4 cases).


**Loop shortcut consent (recommended #10) â€” CLOSED 2026-08-22**

**Live payloads / mutations**
- `proposeLoopShortcut` `{ proposalId, proposerId, name, summary, requestedIterations, opponentIds }` â€” sets `state.pendingLoopShortcut` (status `pending`) when opponents exist; when `opponentIds` empty, live auto-approves and clears pending in the same handler (no resolve event).
- `resolveLoopShortcutConsent` `{ proposalId, proposerId, requestedIterations, effectiveIterations, interrupted, responses }` â€” live marks approved then **clears** `pendingLoopShortcut` (consent outcome delivered via socket only).

**Fix:** `applyEvent` cases after `loopShortcutBatchApply` mirror the above.

**Tests:** `server/tests/loop-shortcut-consent.replay.test.ts` (4 cases).

**Planned remaining-gaps series complete.** `judgeGranted` remains intentional non-replayed meta (`_judgeRuntime` / socket role) â€” keep emitting; no applyEvent.

