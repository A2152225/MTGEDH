# Split handoff - chat U (util.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-U.md.
Sole writer for server/src/socket/util.ts and util-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create socket/util/. Parent CRLF; leaves LF.
Already extracted: manaColorConstants, manaPoolStateOperations, manaProvenanceLowerBounds,
manaRestrictedPoolOperations - do not re-move.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/util.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/socket/util.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/socket/util.ts mana=4670-5942

Do NOT move whole: calculateManaProduction (~4670-5942, 55.0 KB). Split by ability family
(land/basic, any-color, treasure/artifact, creature mana, special/storage/battery).
Parent keeps the function and calls tryCalculateX(...); first defined result wins.

Order:
1. Hoist the first contiguous ability-family run from calculateManaProduction under 40KB.
2. consumeManaFromPool (~3369-4066, 26.2 KB) if OUT->IN is small.
3. checkAndTriggerAutoPass (~2258-2699, 22.2 KB)
4. getPlayableCardIds / getGraveyardAbilityHints / broadcast helpers until parent < 40960.

Leaf must not import util.ts or the index. Byte-copy --dry first.
Typecheck server. Mana-production / auto-pass vitest. No ts-morph.
```
