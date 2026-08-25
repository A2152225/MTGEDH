# Split handoff - chat BH (staticEffects.ts)

Parent now: **53170 B / 51.9 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BH.md.
Sole writer for server/src/rules-engine/staticEffects.ts and new
staticEffects-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create staticEffects-handlers/index.ts on extract #1. Never create staticEffects/
beside staticEffects.ts. Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT add new card-name tables. Extracting the existing KNOWN_STATIC_EFFECT_CARDS
const is OK. Do not move whole computeContinuousEffects (~325-1209, 38.5 KB) if
the new file would exceed 40KB after header; split that function by phase.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/rules-engine/staticEffects.ts --min-bytes 2000

Order:
1. KNOWN_STATIC_EFFECT_CARDS (~114-161, 2.7 KB) plus exclusive table helpers.
2. Split computeContinuousEffects by contiguous phase until leftover body and
   parent are both under 40960.
3. Remaining small helpers until parent < 40960.

Public exports stay on staticEffects.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Static-effects vitest. No ts-morph.
```
