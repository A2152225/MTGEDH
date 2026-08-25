# Split handoff - chat BT (executeSpellEffect.ts)

Parent now: **41101 B / 40.1 KB**. Still over 40960. Parent is CRLF with a BOM.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BT.md.
Sole writer for server/src/state/modules/executeSpellEffect.ts and new
executeSpellEffect-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create executeSpellEffect-handlers/index.ts on extract #1. Never create
executeSpellEffect/ beside executeSpellEffect.ts. Parent CRLF; leaves LF.
Do not add another BOM. Do not Read the whole parent.

Existing sibling executeSpellEffectMillCards.ts (3.2 KB) stays put — do not
append more cases there.

executeSpellEffect (~26-822, 34.1 KB) may move whole if the leaf stays under
40KB after header. Keep a thin dispatcher / re-export on the parent.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/executeSpellEffect.ts --min-bytes 2000

Order:
1. executeSpellEffect if leaf < 40KB; otherwise split the switch/if-chain by
   effect family.
2. returnExiledCardToBattlefield if still needed for the ceiling.

Public exports stay on executeSpellEffect.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck server. Spell-effect / mill vitest. No ts-morph.
```
