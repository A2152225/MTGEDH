# Split handoff - chat BX (TableLayout.tsx)

Parent now: **107156 B / 104.6 KB**. Still over 40960. Parent is LF.

`TableLayout` itself is **94.0 KB**. Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BX.md.
Sole writer for client/src/components/TableLayout.tsx and new
client/src/components/TableLayout-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create TableLayout-handlers/index.ts on extract #1. Never create TableLayout/
beside TableLayout.tsx. Parent LF; leaves LF. Do not Read the whole parent.

Do NOT move TableLayout (~240-2315, 94.0 KB) whole. Extract isManaSource
(~89-181, 4.3 KB) then nested helpers/hooks inside the component
(--allow-nested) until leftover body and parent are both under 40960.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/TableLayout.tsx --min-bytes 2000

Public TableLayout stays on TableLayout.tsx. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
