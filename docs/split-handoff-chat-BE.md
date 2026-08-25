# Split handoff - chat BE (oracleIRExecutorModifyPtStepHandlers.ts)

Parent now: **56015 B / 54.7 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BE.md.
Sole writer for rules-engine/src/oracleIRExecutorModifyPtStepHandlers.ts and new
oracleIRExecutorModifyPtStepHandlers-handlers/** OR family siblings
oracleIRExecutorModifyPt*.ts. Prefer a handlers folder on extract #1.
Never create oracleIRExecutorModifyPtStepHandlers/ beside the .ts.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent LF; leaves LF. Do not Read the whole parent.
Do not change appliedSteps / conditional wrapper recording.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorModifyPtStepHandlers.ts --min-bytes 2000

Order:
1. resolveReferenceScalerScale (~256-677, 19.9 KB) plus exclusive helpers.
2. applyModifyPtStep (~678-1215, 18.6 KB) — keep a thin dispatcher in the parent
   if leftover still needs to call it.
3. applySetBasePtStep (~1258-1340, 2.8 KB) if still needed for the ceiling.

Public exports stay on the parent. Leaf must not import the parent or the index.
Byte-copy --dry first. Typecheck rules-engine. Modify-P/T vitest. No ts-morph.
```
