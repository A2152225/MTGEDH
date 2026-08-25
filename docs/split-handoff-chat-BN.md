# Split handoff - chat BN (triggers/card-data-tables.ts)

Parent now: **45379 B / 44.3 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BN.md.
Sole writer for server/src/state/modules/triggers/card-data-tables.ts and new
triggers/card-data-tables-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create card-data-tables-handlers/index.ts on extract #1. Never create
card-data-tables/ beside card-data-tables.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

EXTRACT ONLY. Do NOT add new KNOWN_* rows or card-name table entries.
Moving existing tables is OK.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/triggers/card-data-tables.ts --min-bytes 2000

Order:
1. KNOWN_TAP_UNTAP_ABILITIES (~293-498, 6.0 KB).
2. KNOWN_END_STEP_TRIGGERS (~725-842, 5.2 KB) if still over.
3. Remaining KNOWN_* tables until parent < 40960.

Public exports stay on card-data-tables.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Trigger-table vitest if present. No ts-morph.
```
