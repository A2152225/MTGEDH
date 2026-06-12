# Oracle IR Session Handoff

Last updated: 2026-06-12 (after batch 272)

## What was completed this session

### Oracle IR batch 272 (general executor gaps 11 → 9)

- **Audit:** `someOracleSteps` walks nested/conditional steps; per-seat each-player sacrifice fixtures; sacrificed-permanent snapshot normalization; copy-it/that-creature/attached/each-other-opponent/delayed-token/die-roll enrichments.
- **Executor:** each-player sacrifice one-per-seat deterministic picks; deduped sacrificed snapshots for where-X and lose_life; audit-seeded `lastCreatedTokenIds`.
- **Tests:** `oracleIRGapBatch237.test.ts` (6).
- Cleared: Shadow lose_life MV, Tip the Scales team where-X, Velukan die-roll, bulk each-player sacrifice templates.
- General-gap clusters: **11 → 9**. Migration suite: **648/648**.

### Oracle IR batch 271 (general executor gaps 17 → 10)

- **Audit enrichment:** elf distribute targets (`bf-elf-*`), `that land` skip_next_untap, each-player sacrifice choices, modify_pt where-X fixtures (devotion/oil/mutated/tapped opponent), sacrificed-permanent amount context, extended create_token copy sources.
- **Parser:** removed platform-only shim for each-player sacrifice; bare + residual sacrifice parsers; generic `create a token that's a copy of …` before static-metadata swallow.
- **Executor:** elf distribute fallback when bound IDs are non-elves; `lastSacrificedPermanents` from ctx in where-X; copy reference strips trailing `instead`; tapped-opponent greatest-power where-X ordering fix.
- **Tests:** `oracleIRGapBatch236.test.ts` (10).
- Parse→execute gaps: **172 → 163** (162 cards). General-gap clusters: **17 → 10**. Selector/condition audits: **0**.
- Migration suite: **648/648**.

### Oracle IR batch 270 (11 selector + 3 condition gaps → 0)

- **Linked-exile bulk move_zone:** early handler before generic unsupported fallback — Admonition Angel cluster, Duplicity, Birthing Ritual among-those-cards, Gitrog land drop, Spirit-Sister chosen gy return, Tinybones stash exile, Mechtitan except-self.
- **Last condition clauses:** Katara waterbend/additional cost; Oblivious Bookworm manifest/turn-face-up; Doom Foretold `that player can't`.
- **Tests:** `oracleIRGapBatch235.test.ts` (11).
- Selector gap audit: **11 → 0**. Condition gap audit: **3 → 0**.
- Migration suite baseline: **648 tests** (unchanged count).

### Carried over (uncommitted)

- Batches 264–272
- Goad/Baeloth parallel track

**Nothing committed** — all changes local.

## Key files touched (uncommitted)

| Area | Paths |
|------|-------|
| IR executor | `oracleIRExecutorBattlefieldStepHandlers.ts`, `oracleIRExecutorModifyPtWhereSpecializedExtrema.ts`, `oracleIRExecutorModifyPtWhereContext.ts`, `oracleIRExecutorTokenStepHandlers.ts` |
| IR parser | `oracleIRParserPostprocess.ts` |
| Audit | `executor-coverage-audit.ts` |
| Tests | `oracleIRGapBatch237.test.ts`, `oracleIRGapBatch236.test.ts`, `oracleIRGapBatch235.test.ts` |
| Docs | `oracle-ir-gap-backlog.md`, this file |

## Validation commands

```powershell
cd D:\Git\MTGEDH\rules-engine
npx vitest run test/oracleIRGapBatch237.test.ts test/oracleIRGapBatch236.test.ts test/oracleIRGapBatch235.test.ts

cd D:\Git\MTGEDH\server
npm run test:oracle-ir-migration
$env:EXECUTOR_COVERAGE_ONLY_GAPS='1'; npm run executor:coverage
npx tsx scripts/executor-general-gap-analysis.ts
npx tsx scripts/executor-selector-gap-analysis.ts
npx tsx scripts/executor-condition-gap-analysis.ts
```

Expected: migration **648**; selector gaps **0**; condition gaps **0**; general-gap clusters **~9**.

---

## Copy-paste prompt for next session

```
Continue Oracle IR server migration — batch 273.

Context:
- Batch 272 cut general executor gaps 11→9 (nested-step audit enrichment, each-player sacrifice per-seat picks, sacrificed snapshot dedupe). See docs/oracle-ir-gap-backlog.md and docs/oracle-ir-session-handoff.md.
- Batches 264–272 and goad/Baeloth remain uncommitted.
- Remaining general gaps (9): create_token copy chains (Ochre Jelly, Arna, Faerie, Stangg, Shredder, Dreadfeast), Social Snub copy_spell+sacrifice, X-count sacrifices, die-result modify_pt.

Workflow:
1. npm run executor:coverage in server/ with EXECUTOR_COVERAGE_ONLY_GAPS=1 — pick next top cluster.
2. Fix parser/executor/server fallback as needed — no card-name bespoke handlers.
3. Add focused tests + update docs. Target 10+ items per batch when possible.
4. Run npm run test:oracle-ir-migration in server/.
5. Do not commit unless I ask.

Start by running validation commands in docs/oracle-ir-session-handoff.md, then target the next executor:coverage gap cluster.
```

## Optional follow-ups

- Goad UI: show static goad source on client
- Replay coverage for Baeloth death trigger + skipToPhase goad block
- Phase 4 items in `docs/oracle-ir-server-migration-plan.md`
