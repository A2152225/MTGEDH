# Split handoff - chat BK (keyword-detection.ts)

Parent now: **47950 B / 46.8 KB**. Still over 40960. Parent is LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BK.md.
Sole writer for server/src/state/modules/keyword-detection.ts and new
keyword-detection-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create keyword-detection-handlers/index.ts on extract #1. Never create
keyword-detection/ beside keyword-detection.ts. Parent LF; leaves LF.
Do not Read the whole parent.

Grep dual-copy vs keyword-handlers.ts / keyword-trigger-handlers.
Do not create a third copy of the same export.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/keyword-detection.ts --min-bytes 2000

Order:
1. TRIGGERED_KEYWORD_PATTERNS (~108-483, 12.3 KB).
2. STATIC_KEYWORD_PATTERNS (~484-806, 7.5 KB).
3. REPLACEMENT_KEYWORD_PATTERNS (~807-934, 4.5 KB) then KEYWORD_ACTION_PATTERNS
   (~935-1197, 8.6 KB).
4. detectKeywords (~1266-1362, 3.6 KB) if still needed for the ceiling.

Public exports stay on keyword-detection.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Keyword-detection vitest. No ts-morph.
```
