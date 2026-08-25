# Split handoff - chat AA (oracleIRExecutorConditionalStepSupport.ts)

Parent now: **136967 B / 133.8 KB**. Still over 40960. File is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AA.md.
Sole writer for rules-engine/src/oracleIRExecutorConditionalStepSupport.ts and new
oracleIRExecutorConditionalStep*.ts siblings (no folder until the parent is a thin barrel).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent is LF; keep new leaves LF. Do not Read the whole parent.
Do NOT create new BatchNNN / Bulk filenames. Do not edit
oracleIRExecutorConditionalStepSupportExtended.ts (Chat AB).

Do NOT move whole evaluateConditionalWrapperCondition (~956-3305, 94.7 KB).
Parent keeps the exported dispatcher (unless-kind + if/as_long_as normalize,
then tryEvaluate… fall-throughs).

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorConditionalStepSupport.ts --min-bytes 2500
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/oracleIRExecutorConditionalStepSupport.ts
    a=989-1506 b=1507-2106 c=2107-2700 d=2701-3305

Order (confirm lines with toc; name each leaf after the first clause it tests):
1. Clause family a (~989-1506, 21.9 KB): unless pay, you-do/otherwise, enters-this-way,
   graveyard-count, lands, first-combat.
2. Family b (~1507-2106, 24.6 KB): suspected, attacking, hand-size, legendary, kicked.
3. Family c (~2107-2700, 22.3 KB) then d (~2701-3305, 25.0 KB).
4. resolveUnlessPayInnerCondition (~116-280, 5.6 KB) if still needed for ceiling.

Leaves take the same params bag as the evaluator and return boolean | null
(null = fall through). Recursion / extended-clause call stays a callback or
import of evaluateExtendedConditionalClause — do not import the public parent.
Byte-copy --dry first. Typecheck rules-engine. Intervening-if / conditional vitest.
No ts-morph.
```
