# Split handoff - chat AB (oracleIRExecutorConditionalStepSupportExtended.ts)

Parent now: **178492 B / 174.3 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AB.md.
Sole writer for rules-engine/src/oracleIRExecutorConditionalStepSupportExtended.ts
and new oracleIRExecutorConditionalStepExtended*.ts siblings (no folder until the
parent is a thin barrel). Keep peeling until parent is under 40960 bytes.
Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent.
Do NOT create new BatchNNN / Bulk filenames. Existing Batch368-380 siblings stay;
do not append if near 40KB. Do not edit ConditionalStepSupport.ts (Chat AA).

Do NOT move whole evaluateExtendedConditionalClause (~1195-4110, 123.0 KB).
Parent keeps the exported dispatcher: thisWay + would + existing evaluateBatch* calls,
then tryEvaluate… fall-throughs.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorConditionalStepSupportExtended.ts --min-bytes 2500
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/oracleIRExecutorConditionalStepSupportExtended.ts
    thisWay=918-1175 a=1195-1800 b=1801-2500 c=2501-3300 d=3301-4110

Order:
1. evaluateThisWayClause (~918-1175, 13.2 KB) if still in parent.
2. Split leftover evaluateExtendedConditionalClause body AFTER existing batch
   dispatches. Confirm lines: a ~20.2 KB, b ~31.4 KB, c ~35.6 KB, d ~35.9 KB.
   c and d are near ceiling AFTER LF+header — split further if a dry extract
   would exceed 40960. Name leaves after the first clause they test
   (WarriorDamage, ManaAbility, Spectacle, Prowl, Gift, …).
3. Shared type helpers (getControlledTypeEnteredThisTurnCount, …) just-in-time.

Leaves return boolean | null (null = fall through). Do not import the parent.
Byte-copy --dry first. Typecheck rules-engine. Conditional / intervening-if vitest.
No ts-morph.
```
