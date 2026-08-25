# Split handoff - chat AN (oracleIRExecutorPlayerUtils.ts)

Parent now: **85728 B / 83.7 KB**. Still over 40960. File is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AN.md.
Sole writer for rules-engine/src/oracleIRExecutorPlayerUtils.ts and new
oracleIRExecutorPlayer*.ts siblings (no folder until the parent is a thin barrel).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent is LF; keep new leaves LF. Do not Read the whole parent.
Do NOT create new BatchNNN / Bulk filenames.
Do not edit oracleIRExecutorPlayerStepHandlers.ts (already under ceiling).
Do not change appliedSteps ledger for `conditional` wrappers
(oracleIRExecutorMainLoopLateSteps.ts: record wrapper only when the then/else
branch applied nothing).

Many small exports. Extract contiguous families, not helpers.ts.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorPlayerUtils.ts --min-bytes 2000

Order:
1. resolvePlayers (~939-1161, 10.0 KB) + resolvePlayersFromDamageTarget (3.2 KB)
   if they form one cluster.
2. lookSelectTopCardsForPlayer (~1423-1679, 7.9 KB) plus exclusive exile-until /
   impulse-permission helpers (applyImpulsePermissionMarkers 4.3 KB,
   resolveUnknownExileUntilAmountForPlayer 4.4 KB).
3. discardCardsForPlayer / discardSpecificCardsForPlayer / addManaToPoolForPlayer /
   adjustPlayerCounter / splitExiledForShuffleRest until parent < 40960.

Parent re-exports public API so existing imports keep working.
Leaf must not import the parent. Byte-copy --dry first.
Typecheck rules-engine. Player-utils / look-select / discard vitest. No ts-morph.
```
