# Split handoff - chat AH (mana-check.ts)

Parent now: **116777 B / 114 KB**. Still over 40960.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AH.md.
Sole writer for server/src/state/modules/mana-check.ts and new mana-check-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create mana-check-handlers/index.ts on extract #1. Never create mana-check/
beside mana-check.ts. Parent CRLF; leaves LF. Do not Read the whole parent.

No single elephant over 40KB. Extract contiguous helper families, not helpers.ts.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/mana-check.ts --min-bytes 2000

Order:
1. getAvailableMana (~2192-2687, 22.2 KB) plus exclusive helpers it closes over.
2. canPayManaCostWithAvailableSources (~2688-2986, 11.1 KB).
3. canPayManaCost (~6.0 KB) + exact-source builders (buildExactManaSources 10.0 KB,
   produced-mana / non-tap / battery color-fix) until parent < 40960.
4. Color helpers (getOpponentPermanentColors / getControlledPermanentColors)
   just-in-time if several leaves close over them.

Public exports stay on mana-check.ts (re-export from leaf).
Leaf must not import mana-check.ts or the index. Byte-copy --dry first.
Typecheck server. Mana-payment / available-mana vitest. No ts-morph.
```
