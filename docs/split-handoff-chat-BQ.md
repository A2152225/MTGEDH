# Split handoff - chat BQ (stackResolvePermanentEntryUtils.ts)

Parent now: **42978 B / 42 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BQ.md.
Sole writer for server/src/state/modules/stackResolvePermanentEntryUtils.ts and new
stackResolvePermanentEntryUtils-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create stackResolvePermanentEntryUtils-handlers/index.ts on extract #1.
Never create stackResolvePermanentEntryUtils/ beside the .ts.
Parent LF; leaves LF. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/stackResolvePermanentEntryUtils.ts --min-bytes 2000

Order:
1. queueMutateTriggeredAbilities (~127-304, 7.4 KB) plus exclusive helpers.
2. resolvePermanentSpellBattlefieldEntry (~305-921, 28.8 KB) if leftover still
   over — keep a thin dispatcher in the parent. Do not pack if the leaf would
   exceed 40KB after header.

Public exports stay on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Mutate / planeswalker-entry vitest. No ts-morph.
```
