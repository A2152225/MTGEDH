# Split handoff - chat AQ (zones.ts)

Parent now: **85105 B / 83.1 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AQ.md.
Sole writer for server/src/state/modules/zones.ts and new zones-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create zones-handlers/index.ts on extract #1. Never create zones/ beside zones.ts.
Parent CRLF; leaves LF. Do not Read the whole parent.

Grep dual-copy before moving draw/mill/move helpers (counters_tokens movePermanent*,
drawCardsFromZone elsewhere). Merge into the existing copy if it is the same export;
do not create a third implementation.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/zones.ts --min-bytes 2000

Order:
1. drawCards (~716-905, 7.8 KB) + processDrawTriggers (~966-1153, 7.6 KB) if they
   form one cluster under 40KB, else two leaves. Include exclusive helpers.
2. processMillTriggers (~1154-1316, 6.4 KB).
3. movePermanentToLibrary (~1750-1909, 6.0 KB) then movePermanentToHand (~1910-2055, 5.1 KB).
4. moveRemovedPermanentToExile / dredge / explore / pregame-reset until parent < 40960.

Public exports stay on zones.ts (re-export from leaf).
Leaf must not import zones.ts or the index. Byte-copy --dry first.
Typecheck server. Draw / mill / zone-move vitest. No ts-morph.
```
