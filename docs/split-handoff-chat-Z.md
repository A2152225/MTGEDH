# Split handoff - chat Z (oracleIRExecutorSpecialTargetHandlers.ts)

Parent now: **147075 B / 143.6 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-Z.md.
Sole writer for rules-engine/src/oracleIRExecutorSpecialTargetHandlers.ts and new
oracleIRExecutorSpecialTarget*.ts siblings (no folder until the parent is a thin barrel).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent.
Do NOT create new BatchNNN / Bulk filenames. Existing Batch386-391 siblings stay;
do not append to them if they are near 40KB.

Already extracted: oracleIRExecutorExileOneOfThemHandlers.ts
(tryApplyExileOneOfThemLookedCards). trySpecial* still dispatch into Batch386-391.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorSpecialTargetHandlers.ts --min-bytes 2500

Order:
1. trySpecialExileStep (~405-1290, 39.4 KB) — do NOT move whole. Split leftover
   regex families AFTER the existing tryBatch386-389ExileStep calls into named
   tryApplyExile… leaves (domain+mechanic, not Bulk). Parent keeps the batch
   dispatch plus a short fall-through.
2. Move remaining trySpecial* that are already under 40KB:
   trySpecialDestroyStep 14.1, RemoveCounter 13.5, CopyPermanent 8.9,
   MoveCounters 7.6, AddCounter 7.2, ForceBlock 5.9, Sacrifice 5.3,
   DoubleCounters 4.9, DealDamage 3.9, TurnFaceDown 3.6, TapOrUntap 3.2,
   PreventDamage 3.0. Group only if the new file stays under 40KB after LF+header.
3. Shared normalizeRaw / normalizeTargetText / collectBoundIds helpers
   just-in-time if several leaves close over them.

Parent re-exports public trySpecial* so existing imports keep working.
Leaf must not import the parent. Byte-copy --dry first.
Typecheck rules-engine. Special-target / exile / destroy vitest. No ts-morph.
```
