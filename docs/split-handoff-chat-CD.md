# Split handoff - chat CD (CastSpellModal.tsx)

Parent now: **48555 B / 47.4 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-CD.md.
Sole writer for client/src/components/CastSpellModal.tsx and new
client/src/components/CastSpellModal-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create CastSpellModal-handlers/index.ts on extract #1. Never create
CastSpellModal/ beside CastSpellModal.tsx. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs client/src/components/CastSpellModal.tsx --min-bytes 2000

Order:
1. parseAlternateCosts (~36-484, 15.1 KB) plus exclusive helpers.
2. Nested clusters inside CastSpellModal (~639-1260, 26.0 KB) only if still
   over — do not move the component whole if the leftover would pack a
   26 KB function into a leaf already near 40KB.

Public exports stay on CastSpellModal.tsx. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck client. No ts-morph. No UI behavior changes.
```
