# Split handoff - chat AV (join.ts)

Parent now: **60823 B / 59.4 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AV.md.
Sole writer for server/src/socket/join.ts and new join-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create join-handlers/index.ts on extract #1. Never create socket/join/.
Parent CRLF; leaves LF. Do not Read the whole parent.
registerJoinHandlers stays a real function.
Do NOT move whole registerJoinHandlers (~549-1303, 29.0 KB) if peeling nested
sockets is enough; if you do extract sockets, use --allow-nested.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/join.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/join.ts
    ensureZones=152-407 register=549-1303

Order:
1. ensureStateZonesForPlayers (~152-407, 20.9 KB) plus exclusive helpers.
2. normalizeViewForEmit (~408-486, 2.6 KB) if several sockets close over it.
3. Nested join/leave/seat sockets with --allow-nested until parent < 40960.
   Group only if the new file stays under 40KB after LF+header.

Leaf must not import join.ts or the index. Byte-copy --dry first.
Typecheck server. Join / seat / spectate vitest. No ts-morph.
```
