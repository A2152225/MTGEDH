# Split handoff - chat AC (oracleIRExecutorMoveZoneStepHandlers.ts)

Parent now: **73376 B / 71.7 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AC.md.
CONTINUE rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.ts and existing
oracleIRExecutorMoveZone*.ts siblings. Keep peeling until parent is under 40960 bytes.
Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent.
Do NOT move whole applyMoveZoneStep (~140-1920, 64.9 KB).
Do NOT create a *-handlers/ folder; parent is not a thin barrel yet.
Do not rename existing GuardsFromGraveyard (that sibling already exists).

Already extracted: WhatParsers*, GuardArgs, StepTypes/Resolvers/ResultBuilders,
LinkedExileProjection, PermanentSelectors, EarlyGuardSteps, LibraryPlacementChoice,
and tryApplyMoveZoneGuardsFrom* siblings (DiceBracketIt, TopCardLibraryOwnerId,
CommandZonePermanent, OneOfThemSplit, FromGraveyardSelectors, …).

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/oracleIRExecutorMoveZoneStepHandlers.ts
    prologue=140-770 earlyOut=774-1052 remainingGuards=1053-1920

Order:
1. Remaining inline guard-arg builds + leftover selector runs (~1053-1920, 29.6 KB)
   as the next tryApplyMoveZoneGuardsFrom<FirstSelector> leaf (or two if dry
   extract plus header exceeds 40KB). Fall through with undefined.
2. All-selector unsupported early-out (~774-1052, 11.1 KB) — cannot be named
   GuardsFromGraveyard. Own leaf that returns the skip result or undefined.
3. Prologue (~140-770, 24.1 KB) only as far as needed: finalizeAppliedResult
   still closes over mutable nextState / effectiveBattlefieldAdd*. Keep that
   in the parent dispatcher if extracting it would require a behavior change.

Public API unchanged: parent still exports applyMoveZoneStep / MoveZoneStepHandlerResult.
Leaf must not import the parent. Byte-copy --dry first.
Typecheck rules-engine. Move-zone vitest. No ts-morph.
```
