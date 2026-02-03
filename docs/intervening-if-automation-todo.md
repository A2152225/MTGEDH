# Intervening-If Automation Todo (135)

One todo per `(best-effort)` marker in `server/src/state/modules/triggers/intervening-if.ts`.

Legend: [ ] not started, [~] in progress, [x] done, [!] blocked

## Items

### Item 1
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L1905
- Comment: // "if any of those creatures have power or toughness equal to the chosen number"
- Nearby check: `if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: Deterministic when refs include `thoseCreatureIds` + chosen number; returns `null` conservatively if any candidate has unknown P/T and no match is found.

### Item 2
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2244
- Comment: // Spellweaver Helix-style: "if it has the same name as one of the cards exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: Use `state.linkedExiles` (exiledCardName / exiledCard.name) as authoritative; only fall back to zone scans when needed.

### Item 3
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L2377
- Comment: // Graveyard-order templates (best-effort). Assumes graveyard arrays append new cards (top is end).
- Nearby check: `if (/^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+and\s+it'?s\s+your\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 4
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L3742
- Comment: // "if it's at least one of the chosen colors" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+at\s+least\s+one\s+of\s+the\s+chosen\s+colors$/i.test(clause)) {`
- Plan: TBD

### Item 5
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4173
- Comment: // "if it entered from your graveyard or you cast it from your graveyard" (best-effort)
- Nearby check: `if (/^if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 6
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4187
- Comment: // "if it was cast from your graveyard" / "if this spell was cast from your graveyard" (best-effort)
- Nearby check: `if (/^if\s+(?:it|this\s+spell)\s+was\s+cast\s+from\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 7
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4313
- Comment: // "if this creature wasn't kicked" / "if this creature was not kicked" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+was\s+not\s+kicked$/i.test(clause) || /^if\s+this\s+creature\s+wasn'?t\s+kicked$/i.test(clause)) {`
- Plan: TBD

### Item 8
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4328
- Comment: // "if it was bargained" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+bargained$/i.test(clause)) {`
- Plan: TBD

### Item 9
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L4335
- Comment: // "if it was cast" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+cast$/i.test(clause)) {`
- Plan: TBD

### Item 10
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L5015
- Comment: // "if all nonland permanents you control are white" (best-effort)
- Nearby check: `if (/^if\s+all\s+nonland\s+permanents\s+you\s+control\s+are\s+white$/i.test(clause)) {`
- Plan: TBD

### Item 11
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6324
- Comment: // "if you have four token counters" (best-effort)
- Nearby check: `if (/^if\s+you\s+have\s+four\s+token\s+counters$/i.test(clause)) {`
- Plan: TBD

### Item 12
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6331
- Comment: // "if you haven't added mana with this ability this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+haven'?t\s+added\s+mana\s+with\s+this\s+ability\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 13
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6350
- Comment: // "if you planeswalked to Unyaro this turn" (best-effort)
- Nearby check: `if (/^if\s+you\s+planeswalked\s+to\s+unyaro\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 14
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6364
- Comment: // "if two or more players have lost the game" (best-effort)
- Nearby check: `if (/^if\s+two\s+or\s+more\s+players\s+have\s+lost\s+the\s+game$/i.test(clause)) {`
- Plan: TBD

### Item 15
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6386
- Comment: // "if your opponents control no permanents with bounty counters on them" (best-effort)
- Nearby check: `if (/^if\s+your\s+opponents\s+control\s+no\s+permanents\s+with\s+bounty\s+counters\s+on\s+them$/i.test(clause)) {`
- Plan: TBD

### Item 16
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6412
- Comment: // "if there are no nonbasic land cards in your library" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+no\s+nonbasic\s+land\s+cards\s+in\s+your\s+library$/i.test(clause)) {`
- Plan: TBD

### Item 17
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6431
- Comment: // "if there are five colors among permanents you control" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+five\s+colors\s+among\s+permanents\s+you\s+control$/i.test(clause)) {`
- Plan: TBD

### Item 18
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6454
- Comment: // "if there are five or more mana values among cards in your graveyard" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+five\s+or\s+more\s+mana\s+values\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 19
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6472
- Comment: // "if Rasputin started the turn untapped" (best-effort)
- Nearby check: `if (/^if\s+rasputin\s+started\s+the\s+turn\s+untapped$/i.test(clause)) {`
- Plan: TBD

### Item 20
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L6483
- Comment: // "if there are one or more oil counters on Glistening Extractor" (best-effort)
- Nearby check: `if (/^if\s+there\s+are\s+one\s+or\s+more\s+oil\s+counters\s+on\s+glistening\s+extractor$/i.test(clause)) {`
- Plan: TBD

### Item 21
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7021
- Comment: // "if that creature was a Horror" (best-effort)
- Nearby check: `if (/^if\s+that\s+creature\s+was\s+a\s+horror$/i.test(clause)) {`
- Plan: TBD

### Item 22
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7191
- Comment: // "if this creature is monstrous" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+monstrous$/i.test(clause)) {`
- Plan: TBD

### Item 23
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7205
- Comment: // "if this creature regenerated this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+regenerated\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 24
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7216
- Comment: // "if this creature is suspected" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+suspected$/i.test(clause)) {`
- Plan: TBD

### Item 25
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7230
- Comment: // "if it's not suspected" (best-effort)
- Nearby check: `if (/^if\s+it'?s\s+not\s+suspected$/i.test(clause)) {`
- Plan: TBD

### Item 26
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7241
- Comment: // "if a creature or planeswalker an opponent controlled was dealt excess damage this turn" (best-effort)
- Nearby check: `if (/^if\s+a\s+creature\s+or\s+planeswalker\s+an\s+opponent\s+controlled\s+was\s+dealt\s+excess\s+damage\s+this\s+turn$/i.test(clause)) {`
- Plan: TBD

### Item 27
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7284
- Comment: // Counters-based artifacts (best-effort)
- Nearby check: `if (/^if\s+this\s+artifact\s+has\s+loyalty\s+counters\s+on\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 28
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7342
- Comment: // "if this card is exiled with an <counter> counter on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+this\s+card\s+is\s+exiled\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);`
- Plan: TBD

### Item 29
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7357
- Comment: // "if three or more cards have been exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+three\s+or\s+more\s+cards\s+have\s+been\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: TBD

### Item 30
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7376
- Comment: // "if there are N or more cards exiled with <Name>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+cards\s+exiled\s+with\s+(.+)$/i);`
- Plan: TBD

### Item 31
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7432
- Comment: // "if <Name> dealt damage to another creature this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+dealt\s+damage\s+to\s+another\s+creature\s+this\s+turn$/i);`
- Plan: Now uses positive-only replay-stable evidence from `state.creaturesDamagedByThisCreatureThisTurn` (creature->creature combat damage). Still best-effort overall (non-combat damage not tracked here), so we do not return deterministic `false` from the tracker.

### Item 32
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7466
- Comment: // "if this creature didn't enter the battlefield this turn"
- Nearby check: `if (/^if\s+this\s+creature\s+didn'?t\s+enter\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {`
- Plan: Deterministic via replay-stable per-turn ETB id tracker `state.creaturesEnteredBattlefieldThisTurnIdsByController` (and/or `enteredThisTurn` flags). Returns `null` only if controller/id are missing.

### Item 33
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7477
- Comment: // "if this creature didn't attack or come under your control this turn" (best-effort)
- Nearby check: `if (/^if\s+this\s+creature\s+didn'?t\s+attack\s+or\s+come\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: Improved with safe positive evidence: treat `enteredThisTurn === true` as "came under your control this turn" (so condition is `false`). Still best-effort because control-change-without-ETB isn’t replay-tracked here.

### Item 34
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7512
- Comment: // "if a creature died under an opponent's control this turn"
- Nearby check: `if (/^if\s+a\s+creature\s+died\s+under\s+an\s+opponent's\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: Deterministic via replay-stable per-turn tracker `state.creaturesDiedThisTurnByController` (returns `null` only if the tracker is unavailable).

### Item 35
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7533
- Comment: // "if a/an/another <Subtype> died under your control this turn"
- Nearby check: `const m = clause.match(/^if\s+(?:another\s+)?an?\s+([a-z\-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);`
- Plan: Deterministic via replay-stable per-turn tracker `state.creaturesDiedThisTurnByControllerSubtype` (returns `null` only if the tracker is unavailable).

### Item 36
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7545
- Comment: // "if <Name> entered this turn" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+entered\s+this\s+turn$/i);`
- Plan: Improved: prefers `sourcePermanent` when its name matches (avoids multi-copy ambiguity) and falls back to per-type ETB id trackers (`*EnteredBattlefieldThisTurnIdsByController`) when present. Still best-effort for lands / cases with missing tracking.

### Item 37
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7563
- Comment: // "if <Name> has counters on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+has\s+counters\s+on\s+it$/i);`
- Plan: Improved: prefers `sourcePermanent` when its name matches; otherwise requires a unique battlefield match. Still `null` if counter map is absent.

### Item 38
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7586
- Comment: // "if he/she/it was cast" and "if this <thing> was cast" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(?:he|she|it|this\s+(?:spell|creature|card))\s+was\s+cast$/i);`
- Plan: Improved: treats `castSourceZone` as positive evidence (set when resolving a stack item into a permanent). Still best-effort overall (absence is not authoritative).

### Item 39
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7600
- Comment: // "if <Name> is a creature" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+is\s+a\s+creature$/i);`
- Plan: Improved: prefers `sourcePermanent` when its name matches; otherwise requires a unique battlefield match. Uses `type_line` or `card.types` when available.

### Item 40
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7618
- Comment: // "if <Name> is in exile with an <counter> counter on it" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+(.+?)\s+is\s+in\s+exile\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);`
- Plan: Improved: supports an optional refs-provided explicit exile id (e.g. `refs.exiledCardId`) as a disambiguation hint; otherwise searches exile zones by name and returns `true` if ANY matching exiled object has the counter, `false` if all deterministically have 0, `null` only when counter data is missing.

### Item 41
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7646
- Comment: // "if it had a counter on it" (best-effort)
- Nearby check: `if (/^if\s+it\s+had\s+a\s+counter\s+on\s+it$/i.test(clause)) {`
- Plan: TBD

### Item 42
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7672
- Comment: // "if it didn't die" (best-effort)
- Nearby check: `if (/^if\s+it\s+didn'?t\s+die$/i.test(clause)) {`
- Plan: TBD

### Item 43
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7682
- Comment: // "if it wasn't sacrificed" (best-effort)
- Nearby check: `if (/^if\s+it\s+wasn'?t\s+sacrificed$/i.test(clause)) {`
- Plan: Requires explicit refs (e.g., `refs.wasSacrificed`) from the trigger-producing code; do not attempt to infer from zones/state.

### Item 44
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7691
- Comment: // "if equipped creature didn't deal combat damage to a creature this turn"
- Nearby check: `if (/^if\s+equipped\s+creature\s+didn'?t\s+deal\s+combat\s+damage\s+to\s+a\s+creature\s+this\s+turn$/i.test(clause)) {`
- Plan: Uses replay-stable per-turn tracker `state.creaturesDamagedByThisCreatureThisTurn[creatureId]` and returns `null` only when tracking is unavailable.

### Item 45
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7708
- Comment: // "if it has the same name as one of the cards exiled with this artifact" (best-effort)
- Nearby check: `if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {`
- Plan: Same as Item 2.

### Item 46
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7740
- Comment: // "if Ring Out is in your library"
- Nearby check: `if (/^if\s+ring\s+out\s+is\s+in\s+your\s+library$/i.test(clause)) {`
- Plan: Deterministic when zones/library are present; returns `null` only if zones shape is unavailable.

### Item 47
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7760
- Comment: // "if a counter was put on <Name> this turn"
- Nearby check: `const m = clause.match(/^if\s+a\s+counter\s+was\s+put\s+on\s+(.+?)\s+this\s+turn$/i);`
- Plan: Deterministic using `state.putCounterOnPermanentThisTurnByPermanentId` (initialized/reset each turn); returns `null` only if the permanent match is ambiguous.

### Item 48
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7802
- Comment: // "if an Aura you controlled was attached to it"
- Nearby check: `if (/^if\s+an\s+aura\s+you\s+controlled\s+was\s+attached\s+to\s+it$/i.test(clause)) {`
- Plan: Uses replay-stable battlefield attachment pointers (prefers `it.attachments[]`, falls back to `Aura.attachedTo`), returns `null` only when attachment/controller info is missing.

### Item 49
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7832
- Comment: // "if it targets a creature you control with the chosen name"
- Nearby check: `if (/^if\s+it\s+targets\s+a\s+creature\s+you\s+control\s+with\s+the\s+chosen\s+name$/i.test(clause)) {`
- Plan: Uses `triggeringStackItemId` + stack `targets` (supports string or object targets), ignores player targets, returns `null` only when targets/permanents can’t be resolved.

### Item 50
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7867
- Comment: // "if it targets one or more other permanents you control"
- Nearby check: `if (/^if\s+it\s+targets\s+one\s+or\s+more\s+other\s+permanents\s+you\s+control$/i.test(clause)) {`
- Plan: Uses `triggeringStackItemId` + stack `targets` (supports string or object targets), ignores player targets, returns `null` only when targets/permanents can’t be resolved.

### Item 51
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7946
- Comment: // "if it was attacking or blocking alone"
- Nearby check: `if (/^if\s+it\s+was\s+attacking\s+or\s+blocking\s+alone$/i.test(clause)) {`
- Plan: Deterministic via per-combat declared snapshots: `attackersDeclaredThisCombatByPlayer` + `blockersDeclaredThisCombatByPlayer` (live + replay), unioned per controller.

### Item 52
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7969
- Comment: // "if it shares a creature type with <Name>"
- Nearby check: `const m = clause.match(/^if\s+it\s+shares\s+a\s+creature\s+type\s+with\s+(.+)$/i);`
- Plan: Deterministic via battlefield scan + exact normalized name match; returns `null` only when type_line is missing for a matched permanent.

### Item 53
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8011
- Comment: // "if any of those creatures have power or toughness equal to the chosen number"
- Nearby check: `if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: Deterministic when refs include `thoseCreatureIds` + chosen number; returns `null` conservatively if any candidate has unknown P/T and no match is found.

### Item 54
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7982
- Comment: // "if it enlisted a creature this combat" (best-effort)
- Nearby check: `if (/^if\s+it\s+enlisted\s+a\s+creature\s+this\s+combat$/i.test(clause)) {`
- Plan: Backed by persisted `enlist` events; `applyEvent('enlist')` writes `enlistedThisCombat` on the attacker. Reset at each combat start.

### Item 55
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L7992
- Comment: // "if an Assassin crewed it this turn" (best-effort)
- Nearby check: `if (/^if\s+an\s+assassin\s+crewed\s+it\s+this\s+turn$/i.test(clause)) {`
- Plan: Backed by persisted `crewVehicle` events; `applyEvent('crewVehicle')` records `crewedByCreatureTypesThisTurn`/`crewedBySubtypesThisTurn` (positive-only). Cleared at turn transition.

### Item 56
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8004
- Comment: // "if it was crewed by exactly two creatures" (best-effort)
- Nearby check: `if (/^if\s+it\s+was\s+crewed\s+by\s+exactly\s+two\s+creatures$/i.test(clause)) {`
- Plan: Backed by persisted `crewVehicle` events; `applyEvent('crewVehicle')` writes `crewedByCreatureCountThisTurn`. Cleared at turn transition.

### Item 57
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8407
- Comment: // "if it wasn't blocking"
- Nearby check: `if (/^if\s+it\s+wasn't\s+blocking$/i.test(clause) || /^if\s+it\s+was\s+not\s+blocking$/i.test(clause)) {`
- Plan: Deterministic via per-permanent combat state (`blocking` / `isBlocking`).

### Item 58
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8413
- Comment: // "if it isn't being declared as an attacker"
- Nearby check: `if (/^if\s+it\s+isn't\s+being\s+declared\s+as\s+an\s+attacker$/i.test(clause)) {`
- Plan: Deterministic when `attackersDeclaredThisCombatByPlayer` snapshot exists; otherwise falls back to explicit per-permanent attacking flags and returns `null` if no evidence.

### Item 59
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8435
- Comment: // "if it was enchanted or equipped"
- Nearby check: `if (/^if\s+it\s+was\s+enchanted\s+or\s+equipped$/i.test(clause)) {`
- Plan: Conservative/deterministic via attachment id lists + battlefield type_line lookups; returns `null` when attachment data is missing/ambiguous.

### Item 60
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8447
- Comment: // "if it was enchanted"
- Nearby check: `if (/^if\s+it\s+was\s+enchanted$/i.test(clause)) {`
- Plan: Conservative/deterministic aura attachment counting via attachment ids + battlefield scan; returns `null` if attachment lists/battlefield data are missing.

### Item 61
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8456
- Comment: // "if it was equipped"
- Nearby check: `if (/^if\s+it\s+was\s+equipped$/i.test(clause)) {`
- Plan: Conservative/deterministic via attachment id lists (`attachedEquipment` / `attachments`) + battlefield type_line; returns `null` when missing.

### Item 62
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8540
- Comment: // "if a/an/another <type> entered the battlefield under your control this turn"
- Nearby check: `const m = clause.match(`
- Plan: Deterministic via per-turn ETB counters (`*EnteredBattlefieldThisTurnByController`) and id-tracking for most "another" cases; returns `null` conservatively when tracking is unavailable/ambiguous.

### Item 63
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8555
- Comment: // "if N or more artifacts/creatures entered the battlefield under your control this turn"
- Nearby check: `const m = clause.match(`
- Plan: Deterministic via per-turn ETB counters; returns `null` if per-turn tracking is missing (avoids false negatives).

### Item 64
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8583
- Comment: // "if no creatures entered the battlefield under your control this turn"
- Nearby check: `if (/^if\s+no\s+creatures\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: Deterministic via per-turn creature ETB counter; returns `null` if tracking is missing.

### Item 65
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8611
- Comment: // "if creatures you control have total toughness N or greater"
- Nearby check: `const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+toughness\s+([a-z0-9]+)\s+or\s+greater$/i);`
- Plan: Deterministic from current battlefield + computed toughness; returns `null` conservatively if any creature has non-numeric toughness and the total is below the threshold.

### Item 66
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8891
- Comment: // "if evidence was collected" (best-effort)
- Nearby check: `if (/^if\s+evidence\s+was\s+collected$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: `applyEvent('castSpell')` copies evidence flags onto the triggering stack item; also tracked per-player via `evidenceCollectedThisTurn*`.

### Item 67
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8918
- Comment: // "if its prowl cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+prowl\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: check `alternateCostId === 'prowl'` (or boolean aliases) on the triggering stack item.

### Item 68
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8940
- Comment: // "if its surge cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+surge\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: check `alternateCostId === 'surge'` (or boolean aliases) on the triggering stack item.

### Item 69
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8962
- Comment: // "if its madness cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+madness\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: check `alternateCostId === 'madness'` (or boolean aliases) on the triggering stack item.

### Item 70
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L8984
- Comment: // "if its spectacle cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+spectacle\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: check `alternateCostId === 'spectacle'` (or boolean aliases) on the triggering stack item.

### Item 71
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9030
- Comment: // Inga and Esika-style: "if three or more mana from creatures was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+three\s+or\s+more\s+mana\s+from\s+creatures\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: uses `manaFromCreaturesSpent` or falls back to `convokeTappedCreatures.length`.

### Item 72
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9058
- Comment: // "if its additional cost was paid" (best-effort)
- Nearby check: `if (/^if\s+its\s+additional\s+cost\s+was\s+paid$/i.test(clause)) {`
- Plan: Positive-only deterministic: returns `true` only when `additionalCostWasPaid` / `additionalCostPaid` is explicitly tracked on the triggering stack item.

### Item 73
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9072
- Comment: // "if at least three mana of the same color was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+at\s+least\s+three\s+mana\s+of\s+the\s+same\s+color\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: Deterministic when cast metadata exists: checks `manaSpentBreakdown` / `manaSpentByColor` on the triggering stack item.

### Item 74
- Status: [!]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9093
- Comment: // "if {S} of any of that spell's colors was spent to cast it" (best-effort)
- Nearby check: `if (/^if\s+\{s\}\s+of\s+any\s+of\s+that\s+spell'?s\s+colors\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {`
- Plan: Blocked: requires persisting snow-vs-nonsnow spend (e.g. `snowManaSpentByColor` or `snowManaColorsSpent`) during cast and replay.

### Item 75
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L9648
- Comment: // Generic "a face-down creature entered ..."
- Nearby check: `if (/^if\s+a\s+face-down\s+creature\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {`
- Plan: Deterministic via `state.faceDownCreaturesEnteredBattlefieldThisTurnByController` (incremented on face-down ETB, reset each turn); falls back to conservative battlefield evidence.

### Item 76
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10468
- Comment: // "this creature/enchantment is on the battlefield"
- Nearby check: `if (/^if\s+this\s+creature\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {`
- Plan: Deterministic using `sourcePermanent` presence; returns `null` conservatively when the engine cannot provide the source permanent.

### Item 77
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10514
- Comment: // "if you both own and control <X> and a creature named <Y>" (best-effort)
- Nearby check: `const m = clause.match(/^if\s+you\s+both\s+own\s+and\s+control\s+(this\s+creature|[a-z0-9][a-z0-9'â€™\- ]+)\s+and\s+a\s+creature\s+named\s+(.+)$/i);`
- Plan: TBD

### Item 78
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10815
- Comment: // "if its power was different from its base power"
- Nearby check: `if (/^if\s+its\s+power\s+was\s+different\s+from\s+its\s+base\s+power$/i.test(clause)) {`
- Plan: Deterministic from current power vs base power; returns `null` only when power/base can’t be computed.

### Item 79
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10826
- Comment: // "if its toughness was less than 1"
- Nearby check: `if (/^if\s+its\s+toughness\s+was\s+less\s+than\s+1$/i.test(clause)) {`
- Plan: Deterministic from current computed toughness; returns `null` only when toughness can’t be computed.

### Item 80
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10836
- Comment: // "if it's on the battlefield and you control 9 or fewer creatures named \"Name Sticker\" Goblin"
- Nearby check: `if (/^if\s+it'?s\s+on\s+the\s+battlefield\s+and\s+you\s+control\s+9\s+or\s+fewer\s+creatures\s+named\s+"name\s+sticker"\s+goblin$/i.test(clause)) {`
- Plan: Deterministic via battlefield scan under your control; returns `null` only when source/battlefield is unavailable.

### Item 81
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10851
- Comment: // "if its mana value is equal to 1 plus the number of soul counters on this enchantment"
- Nearby check: `if (/^if\s+its\s+mana\s+value\s+is\s+equal\s+to\s+1\s+plus\s+the\s+number\s+of\s+soul\s+counters\s+on\s+this\s+enchantment$/i.test(clause)) {`
- Plan: Deterministic using soul counter count on source + mana value of triggering stack item; returns `null` when stack/refs are missing.

### Item 82
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L10873
- Comment: // --- Remaining hard / card-specific / replacement-effect templates (best-effort) ---
- Nearby check: `if (/^if\s+you\s+would\s+draw\s+a\s+card$/i.test(clause)) {`
- Plan: TBD

### Item 83
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11052
- Comment: // "if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature" (best-effort)
- Nearby check: `if (/^if\s+at\s+least\s+one\s+other\s+wall\s+creature\s+is\s+blocking\s+that\s+creature\s+and\s+no\s+non-wall\s+creatures\s+are\s+blocking\s+that\s+creature$/i.test(clause)) {`
- Plan: TBD

### Item 84
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11098
- Comment: // "if it doesn't share a keyword or ability word with a permanent you control or a card in your graveyard" (best-effort)
- Nearby check: `if (/^if\s+it\s+doesn'?t\s+share\s+a\s+keyword\s+or\s+ability\s+word\s+with\s+a\s+permanent\s+you\s+control\s+or\s+a\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {`
- Plan: TBD

### Item 85
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11104
- Comment: // "if it shares a mana value with one or more uncrossed digits in the chosen number" (best-effort)
- Nearby check: `if (/^if\s+it\s+shares\s+a\s+mana\s+value\s+with\s+one\s+or\s+more\s+uncrossed\s+digits\s+in\s+the\s+chosen\s+number$/i.test(clause)) {`
- Plan: TBD

### Item 86
- Status: [ ]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11132
- Comment: // "if its power is greater than this creature's power or its toughness is greater than this creature's toughness" (best-effort)
- Nearby check: `if (/^if\s+its\s+power\s+is\s+greater\s+than\s+this\s+creature'?s\s+power\s+or\s+its\s+toughness\s+is\s+greater\s+than\s+this\s+creature'?s\s+toughness$/i.test(clause)) {`
- Plan: TBD

### Item 87
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11146
- Comment: // "if more lands entered the battlefield under your control this turn than an opponent had enter during their last turn" (best-effort)
- Nearby check: `if (/^if\s+more\s+lands\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+than\s+an\s+opponent\s+had\s+enter\s+during\s+their\s+last\s+turn$/i.test(clause)) {`
- Plan: Deterministic with existing trackers: `landsEnteredBattlefieldThisTurn` (ETB increments) plus `landsEnteredBattlefieldLastTurnByPlayerCounts` snapshot in `nextTurn`.

### Item 88
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L5187
- Comment: // "if you control the artifact with the greatest mana value or tied for the greatest mana value" (Padeem)
- Nearby check: `if (/^if\s+you\s+control\s+the\s+artifact\s+with\s+the\s+greatest\s+mana\s+value\s+or\s+tied\s+for\s+the\s+greatest\s+mana\s+value$/i.test(clause)) {`
- Plan: Deterministic using battlefield artifact scan + `getManaValue()`; returns `null` conservatively when unknown mana values could hide a larger opponent artifact.

### Item 89
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11655
- Comment: // "if you had another creature enter the battlefield under your control last turn"
- Nearby check: `if (/^if\s+you\s+had\s+another\s+creature\s+enter\s+the\s+battlefield\s+under\s+your\s+control\s+last\s+turn$/i.test(clause)) {`
- Plan: Deterministic using `state.creaturesEnteredBattlefieldLastTurnByController` (snapshotted in `nextTurn`); treats `n==1` as ambiguous for creature sources unless refs include `sourceEnteredBattlefieldLastTurn`.

### Item 90
- Status: [x]
- Source: server/src/state/modules/triggers/intervening-if.ts#L11715
- Comment: // "if the number of attacking creatures is greater than the number of quest counters on ED-E"
- Nearby check: `if (/^if\s+the\s+number\s+of\s+attacking\s+creatures\s+is\s+greater\s+than\s+the\s+number\s+of\s+quest\s+counters\s+on\s+ed-e$/i.test(clause)) {`
- Plan: Deterministic using quest counters on ED-E + `state.attackersDeclaredThisCombatByPlayer[controllerId]` (replay-stable snapshot from `declareAttackers` event).

