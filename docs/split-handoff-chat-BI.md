# Split handoff - chat BI (oracleIRExecutorDamageStepHandlers.ts)

Parent now: **52428 B / 51.2 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BI.md.
Sole writer for rules-engine/src/oracleIRExecutorDamageStepHandlers.ts and new
oracleIRExecutorDamageStepHandlers-handlers/** OR family siblings
oracleIRExecutorDamage*.ts. Prefer a handlers folder on extract #1.
Never create oracleIRExecutorDamageStepHandlers/ beside the .ts.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent LF; leaves LF. Do not Read the whole parent.
Do not change appliedSteps / conditional wrapper recording.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorDamageStepHandlers.ts --min-bytes 2000

Order:
1. applyPreventDamageStep (~886-1383, 18.4 KB) plus exclusive helpers.
2. applyDealDamageStep (~623-885, 9.4 KB) plus resolveDamageAmount family
   (~221-385) if exclusive.
3. Remaining applyDamageToMatchingBattlefield until parent < 40960.

Public exports stay on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. Damage-step vitest. No ts-morph.
```
