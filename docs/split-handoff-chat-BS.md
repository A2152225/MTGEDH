# Split handoff - chat BS (triggers/zone-change.ts)

Parent now: **41423 B / 40.5 KB**. Still over 40960. Parent is CRLF.

`triggers/zone-changes.ts` is a **different** file (death/ETB/attack re-export barrel). Do not merge or create `zone-change/`.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BS.md.
Sole writer for server/src/state/modules/triggers/zone-change.ts and new
triggers/zone-change-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create zone-change-handlers/index.ts on extract #1.
Never create triggers/zone-change/ beside zone-change.ts
(zone-changes.ts already exists). Parent CRLF; leaves LF.
Do not Read the whole parent.

Dual-copy: death/ETB/attack live under triggers/zone-changes.ts + death-detection
/ etb-detection. This parent owns exile-from-battlefield / put-into-graveyard-from-anywhere
/ left-graveyard. Do not merge those families.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/zone-change.ts --min-bytes 2000

Order:
1. detectExiledFromBattlefieldTriggers (~25-227, 8.0 KB) plus exclusive helpers.
2. detectPutIntoGraveyardTriggers (~394-750, 12.0 KB) if still over.
3. Remaining queue/left-graveyard until parent < 40960.

Public exports stay on zone-change.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Graveyard-from-anywhere / Syr Konrad vitest. No ts-morph.
```
