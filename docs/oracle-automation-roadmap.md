# Oracle Automation Roadmap

Last updated: 2026-02-16
Owner: Copilot + project maintainers
Scope: rules-engine Oracle text intent parsing/execution reliability and coverage

## Objective

Increase deterministic Oracle-text automation so the engine executes more card intent correctly with minimal skips, while refusing unsafe/ambiguous actions.

## Application-Level Alignment

This roadmap supports the broader MTGEDH goal:
- Multiplayer Commander gameplay with strong rules fidelity.
- Real-time reliability for up to 8 players.
- Less manual bookkeeping via safe automation.

## Milestone Model (3 Layers)

### Layer 1 — Reliability Foundation (short-term)
Goal: Make current automation paths robust against malformed context and multiplayer ambiguity.

Milestones:
- M1.1 Canonical context normalization across trigger/adapter/executor.
- M1.2 Deterministic selector binding precedence and sanitization.
- M1.3 Invalid-context safety (never over-resolve targets).
- M1.4 Regression guardrails for precedence/sanitization matrices.

Exit criteria:
- Shared normalization path used by major trigger/stack execution flows.
- Ambiguous target selectors skip safely rather than mis-target.
- Focused test suites + typecheck consistently green.

### Layer 2 — Coverage Expansion (mid-term)
Goal: Increase the percentage of Oracle templates that execute end-to-end without manual intervention.

Milestones:
- M2.1 Expand deterministic selector support (player/object/group patterns).
- M2.2 Broaden trigger/event hint derivation from runtime payloads.
- M2.3 Add parser coverage for frequent real-card phrasing variants.
- M2.4 Add integration tests for event->stack->resolution chains.

Exit criteria:
- More common Commander card templates execute automatically.
- New parser/executor additions ship with regression tests.
- No increase in false-positive executions.

### Layer 3 — Interaction Fidelity (long-term)
Goal: Improve correctness for complex interactions while preserving deterministic behavior.

Milestones:
- M3.1 Deepen intervening-if and condition-gated resolution handling.
- M3.2 Improve APNAP-sensitive and multiplayer edge sequencing.
- M3.3 Strengthen stack metadata continuity from source event to final resolution.
- M3.4 Add confidence reporting/telemetry for skipped vs applied effect paths.

Exit criteria:
- Complex multiplayer interactions are handled with predictable outcomes.
- Skip reasons are explicit and traceable.
- Fidelity improvements do not regress baseline reliability.

## Current Status Snapshot

Status key: `done`, `in-progress`, `not-started`, `blocked`

| ID | Milestone | Status | Notes |
|---|---|---|---|
| M1.1 | Canonical normalization pipeline | done | Shared trigger/stack context builders integrated. |
| M1.2 | Deterministic selector precedence | done | Explicit > inferred singleton > base fallback enforced in tests. |
| M1.3 | Invalid-context safety | done | Controller/opponent sanitization and malformed-ID hardening added. |
| M1.4 | Reliability regression guardrails | done | Matrix tests + focused adapter/trigger/executor regressions in place. |
| M2.1 | Deterministic selector expansion | done | Selector-context hardening completed for singleton/relational multiplayer cases across parser/executor/adapter. |
| M2.2 | Runtime hint derivation breadth | done | Trigger/event hint normalization unified across cast/activate/resolve paths, including legacy target shaping. |
| M2.3 | Oracle phrasing coverage | done | Added deterministic support for `its controller` selector phrasing (including possessive library forms) across parser/executor paths with regressions. |
| M2.4 | End-to-end chain integration tests | done | Added cast/activate and legacy stack event->stack->resolution regressions for target and relational contexts. |
| M3.1 | Intervening-if fidelity expansion | done | Opponent-control condition classes broadened with threshold handling across creatures/artifacts/enchantments/lands/planeswalkers/permanents, with direct tests. |
| M3.2 | APNAP/multiplayer edge sequencing | done | APNAP ordering now covers turn-order wrap-around and active-missing fallback behaviors, validated by regression matrix tests. |
| M3.3 | Stack metadata continuity | done | Canonical metadata shaping now covers primary and legacy stack resolution paths. |
| M3.4 | Skip/apply confidence telemetry | done | Trigger flow now exposes counters and emits structured telemetry summary logs for executions/applied/skipped paths. |

## Working Backlog (Next Up)

1. Audit non-player target/object selector paths for normalization parity.
2. Add integration tests covering full runtime event emission -> resolution with relational selectors.
3. Expand parser templates for high-frequency Oracle phrasings that still skip.
4. Audit all stack producers for canonical metadata builder adoption.

## Update Protocol

When a milestone changes state:
1. Update `Last updated` date.
2. Change milestone status in **Current Status Snapshot**.
3. Add one line in **Milestone Change Log** with evidence (tests or typecheck command).

## Milestone Change Log

- 2026-02-16: Initialized roadmap with 3-layer model and baseline status mapped to current implementation progress.
- 2026-02-16: Hardened direct-context selector normalization for player + battlefield controller filters (including invalid/whitespace controller handling) and added regressions; validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Normalized move-zone controller usage in `applyOracleIRStepsToGameState` (including each-opponent zone traversals and your-zone transfers) and added whitespace-controller regressions; validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Hardened each-opponent move-zone execution to require a valid controller in current state (prevents malformed-controller over-resolution to all players) and added regression coverage; validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Hardened resolution event-data fallback to avoid fabricating `lifeTotal=0` when controller lookup fails (prevents false life-threshold condition matches), with regression coverage in `triggerParsing.test.ts`; validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Hardened resolution turn-state derivation to require a valid controller before computing `isYourTurn`/`isOpponentsTurn` (prevents false turn-condition matches under malformed controller context) while preserving explicit base fallback flags; added regressions in `triggerParsing.test.ts` and validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Tightened trigger target inference so generic `targetId`/`targetIds` cannot pollute `targetPlayerId`/`targetOpponentId` bindings (object/permanent IDs no longer misclassified as player targets), with regressions in `triggerParsing.test.ts`; validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Tightened `affectedPlayerIds` fallback to player-scoped target fields only (excluding generic `targetIds` noise), and preserved multiplayer targeted stack resolution by explicitly threading selected target bindings into spell/ability stack metadata in `RulesEngineAdapter`; added regressions in `triggerParsing.test.ts` and validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Hardened multi-target semantics by enforcing singleton-only scalar inference for `targetPlayerId`/`targetOpponentId` across trigger normalization and hint adaptation (multi-opponent sets remain relational), plus adapter fallback updates to pass selected target sets while only scalar-binding singleton selections; added multiplayer ambiguity regressions in `RulesEngineAdapter.test.ts` and validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Unified singleton+relational target shaping in stack-resolution compatibility paths by converting raw legacy `targets` into `affectedPlayerIds`/`affectedOpponentIds` before normalization in `resolveStack`; added legacy stack regressions for singleton-target bind + multi-target ambiguity in `RulesEngineAdapter.test.ts`, validated with focused rules-engine suite (`oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Completed broad confidence pass after normalization/targeting hardening by running full rules-engine suite (`vitest run`, 97 files / 2894 tests passing) plus `npm run typecheck --workspace=rules-engine`; no regressions detected beyond focused coverage.
- 2026-02-16: Completed cross-workspace integration check via root `npm run build` (server TypeScript build + client Vite production build succeeded), confirming recent rules-engine hardening does not break monorepo build pipeline.
- 2026-02-16: Hardened draw-trigger event shaping in `checkDrawTriggers` to avoid premature opponent sanitization against the drawing player and to thread explicit drawing-target fields; added regression coverage in `triggersHandler.test.ts` and validated with focused suite (`triggersHandler.test.ts`, `triggerParsing.test.ts`, `RulesEngineAdapter.test.ts`, `oracleIRExecutor.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Added pronoun-target support for follow-up templates (`that player`, `that opponent`, plus `he or she`/`they`) in Oracle IR parsing and deterministic selector mapping, with executor regressions and draw-trigger integration validation (`triggersHandler.test.ts`, `triggerParsing.test.ts`, `RulesEngineAdapter.test.ts`, `oracleIRExecutor.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Expanded pronoun-target deterministic coverage across additional verbs (`draw`, `discard`, `mill`, `lose_life`) with executor regressions to ensure `that player/that opponent` bindings consistently resolve via selector context; validated with focused suite (`oracleIRExecutor.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`, `RulesEngineAdapter.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Expanded adapter integration coverage for pronoun-target templates by adding full cast/activate -> stack -> resolve regressions for `That player loses 1 life.` in multiplayer, confirming stack metadata/hint propagation resolves pronoun targets correctly; validated with focused suite (`RulesEngineAdapter.test.ts`, `oracleIRExecutor.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Added singleton-safety ambiguity regressions for pronoun templates in adapter stack flows (multi-target `That player ...` spell/ability cases do not auto-bind a first target), validating no first-target collapse under plural target sets; focused suite (`RulesEngineAdapter.test.ts`, `oracleIRExecutor.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`) + `npm run typecheck --workspace=rules-engine` remains green.
- 2026-02-16: Final consolidation checkpoint after pronoun-template and ambiguity hardening: full rules-engine suite rerun clean (`vitest run`, 97 files / 2904 tests) with `npm run typecheck --workspace=rules-engine` also clean.
- 2026-02-16: Extended pronoun-target support to raw damage target resolution (`deals ... to that player/that opponent/he or she/they`) and added deterministic executor regressions, validated with focused suite (`oracleIRExecutor.test.ts`, `triggerParsing.test.ts`, `triggersHandler.test.ts`, `RulesEngineAdapter.test.ts`) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Added trigger confidence telemetry fields (`oracleStepsSkipped`, `oracleExecutions`) to `TriggerResult` and regression coverage for applied vs skipped deterministic execution paths in `triggersHandler.test.ts`; focused suite + typecheck green.
- 2026-02-16: Implemented full APNAP ranking with multiplayer turn-order input in `putTriggersOnStack` (beyond active/non-active split), wired turn-order forwarding from `processTriggers`, and added APNAP ordering regression in `triggerParsing.test.ts`; focused suite + typecheck green.
- 2026-02-16: Post-milestone broad verification rerun clean (`vitest run`, 97 files / 2908 tests) with `npm run typecheck --workspace=rules-engine` clean.
- 2026-02-16: Expanded opponent-control intervening-if evaluation in `evaluateOpponentControlCondition` to support count thresholds and additional permanent classes (`X or more creatures/artifacts/enchantments/permanents` plus enchantment/permanent presence), with direct condition regressions added in `triggerParsing.test.ts`; validated by focused suite (`triggerParsing.test.ts`, `triggersHandler.test.ts`, `oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, 367 tests passing) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Further expanded opponent-control condition classes to include `land` and `planeswalker` (including `X or more ...` thresholds) in `evaluateOpponentControlCondition`; added regressions in `triggerParsing.test.ts` and validated with focused suite (`triggerParsing.test.ts`, `triggersHandler.test.ts`, `oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, 368 tests passing) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Expanded deterministic selector phrasing coverage for `its controller` across parser/executor paths (including possessive library forms like `its controller's` and raw damage-target text), with parser + executor regressions (`oracleIRParser.test.ts`, `oracleIRExecutor.test.ts`); validated via focused suite (`triggerParsing.test.ts`, `triggersHandler.test.ts`, `oracleIRParser.test.ts`, `oracleIRExecutor.test.ts`, `RulesEngineAdapter.test.ts`, 587 tests passing) + `npm run typecheck --workspace=rules-engine`.
- 2026-02-16: Expanded APNAP sequencing regression matrix with turn-order wrap-around and active-player-missing fallback cases in `triggerParsing.test.ts`, and surfaced trigger telemetry summaries in logs (`[triggers] Oracle auto-execution: executions=..., applied=..., skipped=...`) with regression in `triggersHandler.test.ts`; validated via focused suite + typecheck, then full-suite confidence pass clean (`vitest run`, 97 files / 2914 tests) with `npm run typecheck --workspace=rules-engine` clean.
