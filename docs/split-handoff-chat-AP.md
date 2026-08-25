# Split handoff - chat AP (planeswalker registry.ts)

Parent now: **145076 B / 141.7 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AP.md.
Sole writer for server/src/state/planeswalker/templates/registry.ts and new
registry-handlers/** (next to registry.ts, not under resolve-handlers/).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create registry-handlers/index.ts on extract #1. Never create templates/registry/
beside registry.ts. Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move whole getPlaneswalkerTemplateMatch (~1015-2720, 72.8 KB).
Split that function by phase into siblings after the regex tables are out.

Already exists nearby: templates/resolve-handlers/ (resolve.ts). Do not write there.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/planeswalker/templates/registry.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs server/src/state/planeswalker/templates/registry.ts
    regexA=4-250 regexB=251-500 regexC=501-750 regexD=751-1014 matcher=1015-2720

Order:
1. Regex const families in ~18 KB chunks (lines ~4-250, 251-500, 501-750, 751-1014).
   Name by domain (draw / exile-top / discard / damage), not helpers.ts.
2. Split getPlaneswalkerTemplateMatch by contiguous if-chain phase until the
   leftover body is under 40KB and the parent file is under 40960.
3. Remaining small helpers until parent < 40960.

Public export stays on registry.ts (re-export from leaf).
Leaf must not import registry.ts or the index. Byte-copy --dry first.
Typecheck server. Planeswalker template / loyalty vitest. No ts-morph.
```
