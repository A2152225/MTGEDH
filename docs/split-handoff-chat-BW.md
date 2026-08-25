# Split handoff - chat BW (client/src/App.tsx)

Parent now: **397860 B / 388.5 KB**. Still over 40960. Parent is CRLF.

`App` itself is **378.8 KB**. Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BW.md.
Sole writer for client/src/App.tsx and new client/src/App-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create App-handlers/index.ts on extract #1. Never create App/ beside App.tsx.
Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move export function App (~170-9803, 378.8 KB) whole. Split nested
callbacks/hooks inside App with --allow-nested. TOC --min-bytes 2000 will not
show nested const handle* / useCallback clusters — Grep those and
range-bytes before extracting.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/App.tsx --min-bytes 2000
  rg -n "^  const handle" client/src/App.tsx

Order:
1. Auto-pass handlers (~1138-1375) plus exclusive helpers they close over.
2. Resolution-prompt helpers (~859-940).
3. Loop-shortcut handlers (~1623+) then remaining nested clusters until
   leftover App body and parent are both under 40960.

Public App stays on App.tsx. Leaf must not import App.tsx or the index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
