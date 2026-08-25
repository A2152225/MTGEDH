# Split handoff - chat BY (CombatSelectionModal.tsx)

Parent now: **95502 B / 93.3 KB**. Still over 40960. Parent is LF.

`CombatSelectionModal` itself is **74.8 KB**. Do not move it whole.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BY.md.
Sole writer for client/src/components/CombatSelectionModal.tsx and new
client/src/components/CombatSelectionModal-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create CombatSelectionModal-handlers/index.ts on extract #1. Never create
CombatSelectionModal/ beside CombatSelectionModal.tsx.
Parent LF; leaves LF. Do not Read the whole parent.

Do NOT move CombatSelectionModal (~545-2260, 74.8 KB) whole.
Extract getCreatureInfo (~152-265, 3.8 KB) and groupCreatures (~400-486, 3.0 KB)
then nested clusters inside the modal (--allow-nested) until leftover body
and parent are both under 40960.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/CombatSelectionModal.tsx --min-bytes 2000

Public CombatSelectionModal stays on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
