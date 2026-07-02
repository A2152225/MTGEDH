# Marvel / June 2026 Mechanics — Session Handoff

**Last updated:** 2026-06-30  
**Related:** [oracle-ir-session-handoff.md](./oracle-ir-session-handoff.md) · [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md) · CR 722 (Preparation), 702.193 (Power-up), 702.194 (Teamwork)

**Status:** Core runtime + Layer 3 socket coverage **complete**. Primary project track is now **Track E6 Layer 3** (non-Marvel patterns) — see track-e handoff for next-session prompt.

---

## Status summary

| Mechanic | Parser / IR | Server runtime | Tests |
|----------|-------------|----------------|-------|
| **Teamwork** (702.194) | `teamwork` in `ORACLE_KEYWORDS`; `choose_mode.teamworkChooseBoth`; conditional `teamworkWasPaid` | Cast queue (`ADDITIONAL_COST_PAYMENT` costType `teamwork`); stack metadata; legacy modal + Effect Program `maxModes=2` when paid; spell-primary stack re-push when IR queues choice | `marvel-mechanics.test.ts` (14/14); `oracleIRTeamworkChooseMode.test.ts` (2/2); `teamwork-choose-mode.socket.integration.test.ts` (3/3) |
| **Power-up** (702.193) | `power-up` keyword + static reduction parse; `directActivatedKeywords` includes `power-up` | ETB discount (118.7), once-per index, static reductions; `interaction.ts` + `resolution.ts` parity; odd/even destroy via `OPTION_CHOICE` resume | `marvel-mechanics.test.ts` (14/14); `oracleIRMavelOddEvenDestroy.test.ts` (2/2); `power-up-activated.socket.integration.test.ts` (2/2); `thanos-odd-even-destroy.socket.integration.test.ts` (1/1) |
| **Preparation** (722) | `becomes prepared` → `grant_static_ability`; `enters prepared` static | `prepared.ts` core; face-0 cast routing; IR → `setPermanentPrepared` sync; trigger-primary bridge in `stackExecuteTriggerEffectUtils.ts` | `prepared.integration.test.ts` (11/11); `prepared.trigger-primary.integration.test.ts` (4/4); `prepared.oracle-snapshot.integration.test.ts` (4/4) |

**Card data:** **50** `layout:"prepare"` cards in refreshed `oracle-cards.json`. Run `npm run card-lookup:refresh` after promoting dated oracle dumps.

---

## Completed (Layer 3 socket arc — batches 438–441)

### Teamwork (batch 438)
- `stackResolveInstantSorceryLegacyResolutionUtils.ts` — re-push stack when IR queues pending resolution under spell-primary EP
- `teamwork-choose-mode.socket.integration.test.ts` — legacy + spell-primary describe (3/3)

### Power-up (batches 440–441)
- `marvelMechanicsHelpers.ts` — shared activation pricing for `interaction.ts` + `resolution.ts`
- `power-up-activated.socket.integration.test.ts` — discounted activate → stack IR draw + once-per rejection
- Thanos odd/even: `oracleIrServerZoneSync.ts` + `resolution.ts` `OPTION_CHOICE` resume; `thanos-odd-even-destroy.socket.integration.test.ts`

### Preparation (batch 439)
- `stackExecuteTriggerEffectUtils.ts` — `maybeApplyPreparedStateChange` when IR owns `becomes prepared` but returns `handled: false`
- `prepared.trigger-primary.integration.test.ts` (4/4)

### Waterbender (batch 442 — related Layer 3, not Marvel keyword)
- `waterbender-activated.socket.integration.test.ts` — waterbend target → unblockable grant on stack resolve

---

## Validation

```powershell
cd server
npx vitest run tests/marvel-mechanics.test.ts tests/prepared.integration.test.ts tests/prepared.oracle-snapshot.integration.test.ts tests/prepared.trigger-primary.integration.test.ts tests/teamwork-choose-mode.socket.integration.test.ts tests/power-up-activated.socket.integration.test.ts tests/thanos-odd-even-destroy.socket.integration.test.ts tests/deck-import.local-index.test.ts

cd ../rules-engine
npx vitest run test/oracleIRMavelOddEvenDestroy.test.ts test/oracleIRTeamworkChooseMode.test.ts test/oracleIRWaterbenderAscension.test.ts
```

Migration suite (includes Marvel + Layer 3 sockets): `cd server ; npm run test:oracle-ir-migration` → **764/764**.

---

## Optional follow-ups (not blocking)

1. **Prepared trigger full socket** — ETB “becomes prepared” end-to-end under production `ORACLE_IR_TRIGGER_PRIMARY=1` beyond integration test (Track E6 batch E).
2. **Power-up waterbend cost UI** — tap-to-pay generic mana for Waterbend lines on non-Marvel cards (generic keyword, not card-specific).

---

## Copy-paste starting prompt (next session)

**For Layer 3 work, use the prompt in [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md)** (Track E6 primary). Marvel core is done.

```
Continue Oracle IR Track E6 — Layer 3 server integration (primary).

Read docs/oracle-ir-track-e-remaining-work.md (copy-paste prompt at "Track E6 Layer 3").
Marvel mechanics core is done — docs/marvel-mechanics-handoff.md for reference only.

Migration bar: 764/764. Pick next Layer 3 batch (Green Sun X≥5 destination socket suggested).
Do not commit unless I ask.
```
