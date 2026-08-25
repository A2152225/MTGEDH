# Split handoff - chat AF (deck.ts)

Parent now: **129401 B / 126.4 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AF.md.
Sole writer for server/src/socket/deck.ts and new deck-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create deck-handlers/index.ts on extract #1. Never create socket/deck/.
Parent CRLF; leaves LF. Do not Read the whole parent.
registerDeckHandlers stays a real function.
Do NOT move whole registerDeckHandlers (~1163-3821, 90.7 KB).

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/deck.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/socket/deck.ts
    apply=627-1162 importDeck=1213-1706 useSaved=1764-2156
    precon=2974-3392 url=3393-3821

Order:
1. applyConfirmedImport (~627-1162, 16.6 KB) plus exclusive helpers it closes over.
2. Nested sockets with --allow-nested: importDeck (~15.7 KB), useSavedDeck (~13.2 KB),
   importPreconDeck (~16.0 KB), importDeckFromUrl (~14.0 KB).
3. Remaining save/list/get/rename/delete/cache/move/candidates sockets until parent < 40960.
   Group only if the new file stays under 40KB after LF+header.

Leaf must not import deck.ts or the index. Byte-copy --dry first.
Typecheck server. Deck import / saved-deck vitest. No ts-morph.
```
