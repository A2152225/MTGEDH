# Oracle IR Session Handoff

Last updated: 2026-06-12 (after batch 279 — G1 Merfolk integration)

## What was completed this session

### Batch 279 — G1 Merfolk commander live-play fixes (server integration)

Regression triage from a live G1 Merfolk game. Focus: tribal/chosen-type correctness, tap triggers, library UI, and deck-import data quality. **No new card-name handlers** — generic IR + shared type helpers + resolution wiring.

| Issue | Fix | Key files |
|-------|-----|-----------|
| **Roaming Throne chosen type** | Throne counts as chosen subtype (Merfolk, etc.) for tribal pumps, tap triggers, mana counting, IR `permanentHasSubtype` | `shared/src/creatureTypes.ts`, `server/src/state/creatureTypeNow.ts`, `server/src/state/modules/triggers/tap-untap.ts`, `rules-engine/src/oracleIRExecutorCreatureStepUtils.ts`, `mana-abilities.ts` |
| **Tap triggers (Kumena → Surge Spanner / Deeproot)** | `queueTapTriggersForTappedPermanents` wired after tap-other costs and `tapPermanent` | `server/src/state/modules/tap-trigger-queue.ts`, `server/src/socket/resolution.ts`, `server/src/socket/interaction.ts` |
| **Thassa's Oracle ETB** | Parser merges look + put-one-on-top + random bottom → `look_select_top` (`library_top`, devotion `whereX`); executor + `LIBRARY_SEARCH` queue (`destination: top`, `minSelections: 0`); win still via `tryResolveThassasOracleWin` | `oracleIRParserPostprocess.ts`, `oracleIR.ts`, `oracleIRExecutorPlayerStepHandlers.ts`, `oracleIrServerZoneSync.ts` |
| **Kynaios land ETB** | Post-resolution permanent prompts after Kynaios land gift (creature-type choice, etc.) | `server/src/state/resolution/handlers/kynaiosChoice.ts` |
| **Growing Rites lookup** | Skip `art_series` in card index; `schemaVersion` 2 | `server/src/services/localCardLookup.ts` |
| **Cryptoplasm bounce** | Revert copy to original card identity when bounced to hand | `server/src/state/modules/permanent-copy.ts`, `zones.ts` |
| **Eldrazi Monument upkeep** | Dedupe generic sacrifice-or-self detection when `KNOWN_UPKEEP_CARDS` already matched | `server/src/state/modules/upkeep-triggers.ts` |
| **White Lotus Tile mana** | Creature-type-in-common counting uses `extractCreatureTypes` + `chosenCreatureType` | `server/src/state/modules/mana-abilities.ts` |

### Carried over from prior sessions (still uncommitted)

- Batches 264–278 (trigger `modify_pt` / combat evasion / distribute counters / `ir_gap` closure)
- Goad/Baeloth parallel track (`docs/GOAD_IMPLEMENTATION.md`)
- Client counter-distribution modal (batch 232)

**Nothing committed** unless explicitly requested.

## Key files touched (batch 279)

| Area | Paths |
|------|-------|
| Chosen creature type | `shared/src/creatureTypes.ts`, `server/src/state/creatureTypeNow.ts` |
| Tap triggers | `server/src/state/modules/tap-trigger-queue.ts`, `triggers/tap-untap.ts`, `triggered-abilities.ts` |
| Thassa library IR | `rules-engine/src/oracleIRParserPostprocess.ts`, `oracleIR.ts`, `oracleIRExecutorPlayerStepHandlers.ts`, `oracleIRExecutorPlayerUtils.ts`, `oracleIRParser.ts` |
| Server queue | `server/src/state/modules/oracleIrServerZoneSync.ts` |
| Kynaios | `server/src/state/resolution/handlers/kynaiosChoice.ts` |
| Card lookup | `server/src/services/localCardLookup.ts` |
| Copy revert | `server/src/state/modules/permanent-copy.ts`, `zones.ts` |
| Tests | `server/tests/roaming-throne-chosen-type.unit.test.ts`, `server/tests/g1-card-fixes.unit.test.ts`, `rules-engine/test/oracleIRParser.test.ts` (Thassa parse) |

## Validation commands

```powershell
# Batch 279 — G1 fixes
cd D:\Git\MTGEDH\server
npx vitest run tests/roaming-throne-chosen-type.unit.test.ts tests/g1-card-fixes.unit.test.ts tests/roaming-throne-trigger-doubling.integration.test.ts

cd D:\Git\MTGEDH\rules-engine
npx vitest run test/oracleIRParser.test.ts -t "Thassa"
npx vitest run test/gameAutomation.test.ts -t "Thassa"

# Migration gate (should still be green)
cd D:\Git\MTGEDH\server
npm run test:oracle-ir-migration

# Trigger coverage baseline (batch 278)
$env:EXECUTOR_COVERAGE_ONLY_GAPS='1'; npm run executor:coverage
```

Expected: G1 unit tests **12+** green; Thassa parser single-step `look_select_top`; migration suite **649/649**; trigger `ir_gap` **0**, parse→execute **0**.

## Open / not verified in live play

| Item | Notes |
|------|-------|
| Eldrazi Monument indestructible after monument leaves | Upkeep deduped; static refresh may need retest |
| Kumena +1/+1 on Roaming Throne via IR | Should work via `permanentHasSubtype`; no dedicated socket test yet |
| Thassa library UI E2E | Parser/executor/queue wired; no socket integration test yet |
| Auto-pass / floating mana | Prior fixes; retest in live game |
| Restart required | Server rebuild for card-lookup v2; hard-refresh client; re-import deck for Growing Rites |

## Next session priorities

1. **Thassa socket integration test** — ETB → `LIBRARY_SEARCH` prompt → top/bottom reorder → devotion win.
2. **Roaming Throne + Kumena socket test** — tribal pump includes throne after type choice.
3. **Resume trigger-gap / full_card audit** — batch 278 cleared `ir_gap`; next cluster from `EXECUTOR_COVERAGE_SCOPE=full_card` or detector gaps (`_tmp-trigger-gap-clusters.ts`).
4. **Live G1 retest** — Deeproot on throne tap, White Lotus mana, Kynaios land type choice, Cryptoplasm bounce identity.
5. **Do not commit** unless asked.

---

## Copy-paste prompt for next session

```
Continue Oracle IR server migration — post batch 279 (G1 Merfolk integration).

Context:
- Batch 279 fixed Roaming Throne chosen-type tribal matching, tap-trigger queue wiring, Thassa's Oracle library reorder (look_select_top + LIBRARY_SEARCH), Kynaios land ETB prompts, Growing Rites lookup, Cryptoplasm bounce revert, Eldrazi Monument upkeep dedupe, White Lotus Tile mana counting.
- Batch 278 cleared trigger ir_gap (0). Migration suite: 649/649. Batches 264–279 uncommitted.
- Read docs/oracle-ir-session-handoff.md and docs/oracle-ir-server-migration-plan.md § Current status.

Suggested next work (pick one):
A) Thassa's Oracle socket integration test (library search UI + win tail)
B) Roaming Throne + Kumena/Deeproot socket tribal test
C) Resume executor/trigger gap audit (full_card scope or detector clusters)

Workflow:
1. Read handoff + migration plan current status.
2. Fix parser/executor/server — no card-name bespoke handlers (.cursor/rules/oracle-ir-no-bespoke-handlers.mdc).
3. Add focused tests; update docs.
4. npm run test:oracle-ir-migration
5. Do not commit unless asked.
```
