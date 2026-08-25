# Split handoff - chat AK (oracleIRExecutorTokenStepHandlers.ts)

Parent now: **99498 B / 97.2 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AK.md.
Sole writer for rules-engine/src/oracleIRExecutorTokenStepHandlers.ts and new
oracleIRExecutorToken*.ts siblings (no folder until the parent is a thin barrel).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent.
Do NOT create new BatchNNN / Bulk filenames.

Do not change appliedSteps ledger for `conditional` wrappers (record wrapper
only when the then/else branch applied nothing). Owner is
oracleIRExecutorMainLoopLateSteps.ts, not this parent.

applyCreateTokenStep (~2331-2553, 8.1 KB) can stay as the leftover dispatcher.
Do not move it whole if that would leave helpers stranded in the parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorTokenStepHandlers.ts --min-bytes 2000

Order:
1. resolveCopyTokenSource (~1089-1467, 17.2 KB) plus exclusive copy helpers
   (createCopiedTokenPermanent 4.8 KB, tryApplyThoseReferencedTokenCreation 5.0 KB).
2. addTokensToBattlefield (~1562-1855, 11.4 KB) + resolveTokenAmount (4.5 KB)
   if they form one cluster under 40KB.
3. for-each copy/create tryApply* helpers (~1948-2330).
4. Remaining until parent < 40960. Parent re-exports applyCreateTokenStep.

Leaf must not import the parent. Byte-copy --dry first.
Typecheck rules-engine. Token-create vitest. No ts-morph.
```
