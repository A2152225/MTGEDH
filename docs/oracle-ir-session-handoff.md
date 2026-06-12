# Oracle IR Session Handoff

Last updated: 2026-06-12 (after batch 278)

## What was completed this session

### Oracle IR batch 278 (trigger ir_gap 20 → 0)

- **Parser:** trailing keyword reminders (`persist`, `undying`, `rebound`, `afterlife N`, `storm`) wired as structured `grant_static_ability` steps and pruned from unknown fragments.
- **Parser:** subtype mass buff `… other than this creature get +1/+1 and gain flying until end of turn`.
- **Audit:** `-1/-1` counter seeds on each controlled creature fixture for mass remove_counter (Heartmender).
- **Tests:** `oracleIRGapBatch243.test.ts` (4).
- Parse→execute gaps **0**; assisted execution **100%** (15001/15001). Migration suite: **648/648**.

### Carried over (uncommitted)

- Batches 264–278
- Goad/Baeloth parallel track

**Nothing committed** — all changes local.

## Key files touched (uncommitted)

| Area | Paths |
|------|-------|
| IR parser | `oracleIRParserPostprocess.ts` |
| Audit | `trigger-coverage-audit.ts` |
| Audit | `executor-coverage-audit.ts` |
| Tests | `oracleIRGapBatch243.test.ts` |
| Docs | `oracle-ir-gap-backlog.md`, this file |

## Validation commands

```powershell
cd D:\Git\MTGEDH\rules-engine
npx vitest run test/oracleIRGapBatch243.test.ts test/oracleIRGapBatch242.test.ts

cd D:\Git\MTGEDH\server
npm run test:oracle-ir-migration
$env:EXECUTOR_COVERAGE_ONLY_GAPS='1'; npm run executor:coverage
npx tsx scripts/executor-general-gap-analysis.ts
```

Expected: migration **648**; general-gap **0**; parse→execute **0**; `ir_gap` **0**.

---

## Copy-paste prompt for next session

```
Continue Oracle IR server migration — batch 279.

Context:
- Batch 278 cleared all trigger ir_gap items (keyword reminders + Triceraton compound buff). See docs/oracle-ir-gap-backlog.md and docs/oracle-ir-session-handoff.md.
- Batches 264–278 and goad/Baeloth remain uncommitted.
- Trigger trigger_effects scope: parse→execute 0, ir_gap 0. Next: full_card scope or trigger detector gaps.

Workflow:
1. EXECUTOR_COVERAGE_SCOPE=full_card npm run executor:coverage — or npx tsx scripts/_tmp-trigger-gap-clusters.ts for detector gaps.
2. Fix parser/executor/server/audit as needed — no card-name bespoke handlers.
3. Add focused tests + update docs.
4. Validate migration 648 + general-gap 0.
5. Do not commit unless asked.
```
