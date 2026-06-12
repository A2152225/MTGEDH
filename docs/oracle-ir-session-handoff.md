# Oracle IR Session Handoff

Last updated: 2026-06-12 (after batch 265)

## What was completed this session

### Oracle IR batch 265 (executor combat mass PT + source where-X)

- **Probe:** `executor:coverage` with `EXECUTOR_COVERAGE_ONLY_GAPS=1` — fixed connive import crash; 13 `modify_pt` executor gaps identified.
- **Executor:** `other attacking creatures you control` selector; `each other creature you control with base power and toughness 1/1` qualifier.
- **Where-X:** `counters on this permanent` (and typed variant) reads source permanent, not first mass-pump target.
- **Parser:** bare scaled fragments for other-attacking-you-control, attacking-you-control X, base-1/1 team X.
- **Tests:** `oracleIRTriggerPtBareParse.test.ts` (+2), `oracle-ir-trigger-combat-evasion-fallback.test.ts` (+1), routing wiring.
- Migration suite baseline: **644 tests** (643 + 1 new fallback test).

### Carried over (uncommitted from prior session)

- Batch 264 bare trigger PT fragments
- Goad/Baeloth parallel track (`goad-static-death.unit.test.ts`, `goad-baeloth.integration.test.ts`)

**Nothing committed** — all changes local.

## Key files touched (uncommitted)

| Area | Paths |
|------|-------|
| IR executor | `oracleIRExecutorCreatureStepUtils.ts`, `oracleIRExecutorPlayerStepHandlers.ts`, `oracleIRExecutorModifyPtWhereBoardStateCounts.ts` |
| IR parser | `oracleIRParserPostprocess.ts` |
| Tests | `oracleIRTriggerPtBareParse.test.ts`, `oracle-ir-trigger-combat-evasion-fallback.test.ts`, `oracle-ir-trigger-legacy-routing.test.ts` |
| Docs | `oracle-ir-gap-backlog.md`, `oracle-ir-server-migration-plan.md`, this file |

## Validation commands

```powershell
cd D:\Git\MTGEDH\rules-engine
npx vitest run test/oracleIRTriggerPtBareParse.test.ts

cd D:\Git\MTGEDH\server
npx vitest run tests/oracle-ir-trigger-combat-evasion-fallback.test.ts tests/oracle-ir-trigger-legacy-routing.test.ts
npm run test:oracle-ir-migration
```

Expected: migration suite **644** passing.

---

## Copy-paste prompt for next session

```
Continue Oracle IR server migration — batch 266.

Context:
- Batch 265 (executor combat mass PT + source where-X) is done locally, uncommitted. See docs/oracle-ir-gap-backlog.md and docs/oracle-ir-session-handoff.md.
- Batches 264–265 and goad/Baeloth remain uncommitted.
- tools/oracle-ir-gap-audit.json reports 0 parser gaps — probe executor/fallback/runtime gaps.

Workflow:
1. Probe gaps (npm run executor:coverage with EXECUTOR_COVERAGE_ONLY_GAPS=1).
2. Fix parser/executor/server fallback as needed — no card-name bespoke handlers.
3. Add focused tests + update docs.
4. Run npm run test:oracle-ir-migration in server/.
5. Do not commit unless I ask.

Start by running validation commands in docs/oracle-ir-session-handoff.md, then implement highest-impact gap cluster for batch 266 (see migration-plan batch 266 notes).
```

## Optional follow-ups

- Goad UI: show static goad source on client
- Replay coverage for Baeloth death trigger + skipToPhase goad block
- Phase 4 items in `docs/oracle-ir-server-migration-plan.md`
