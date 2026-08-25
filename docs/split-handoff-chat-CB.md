# Split handoff - chat CB (CreateGameModal.tsx)

Parent now: **53438 B / 52.2 KB**. Still over 40960. Parent is LF.

`CreateGameModal` itself is **48.8 KB**. Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CB.md.
Sole writer for client/src/components/CreateGameModal.tsx and new
client/src/components/CreateGameModal-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create CreateGameModal-handlers/index.ts on extract #1. Never create
CreateGameModal/ beside CreateGameModal.tsx. Parent LF; leaves LF.
Do not Read the whole parent.

Do NOT move CreateGameModal (~130-1374, 48.8 KB) whole. Split nested
helpers/hooks inside the component (--allow-nested) until leftover body
and parent are both under 40960.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/CreateGameModal.tsx --min-bytes 2000

Public CreateGameModal stays on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
