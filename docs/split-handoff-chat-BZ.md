# Split handoff - chat BZ (FreeField.tsx)

Parent now: **79236 B / 77.4 KB**. Still over 40960. Parent is LF.

`FreeField` itself is **71.4 KB**. Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BZ.md.
Sole writer for client/src/components/FreeField.tsx and new
client/src/components/FreeField-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create FreeField-handlers/index.ts on extract #1. Never create FreeField/
beside FreeField.tsx. Parent LF; leaves LF. Do not Read the whole parent.

Do NOT move FreeField (~175-1949, 71.4 KB) whole. Split nested helpers/hooks
inside the component (--allow-nested) until leftover body and parent are
both under 40960.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/FreeField.tsx --min-bytes 2000

Public FreeField stays on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
