# Split handoff - chat CF (DeckManagerModal.tsx)

Parent now: **47610 B / 46.5 KB**. Still over 40960. Parent is CRLF.

`DeckManagerModal` itself is **44.3 KB**. Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CF.md.
Sole writer for client/src/components/DeckManagerModal.tsx and new
client/src/components/DeckManagerModal-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit any docs/mtg-logic-module-map*.md — report owed rows.
Create DeckManagerModal-handlers/index.ts on extract #1.
Never create DeckManagerModal/ beside DeckManagerModal.tsx.
Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move DeckManagerModal (~52-1168, 44.3 KB) whole.
Split nested helpers/hooks/JSX with --allow-nested.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/DeckManagerModal.tsx --min-bytes 400

Order:
1. Nested import/save/cache handlers (~326-644, 9.3 KB) plus exclusive
   helpers they close over.
2. Nested JSX `content` (~714-1168, 22.5 KB) if still over — split if
   the header would push over 40 KB.
3. Remaining nested clusters until leftover body and parent are both
   under 40960.

Public DeckManagerModal stays on the parent. Leaf must not import the
parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
