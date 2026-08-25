# Split handoff - chat BG (oracleTextParser.ts)

Parent now: **54037 B / 52.8 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BG.md.
Sole writer for rules-engine/src/oracleTextParser.ts and new
oracleTextParser-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create oracleTextParser-handlers/index.ts on extract #1. Never create
oracleTextParser/ beside oracleTextParser.ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleTextParser.ts --min-bytes 2000

Order:
1. parseOracleText (~1178-1325, 5.3 KB) plus exclusive helpers it closes over.
2. parseActivatedAbility (~158-303, 5.0 KB).
3. isSpellInstructionLineInner (~941-1086, 5.7 KB) then parseReplacementEffect.
4. Remaining parse helpers until parent < 40960.

Public exports stay on oracleTextParser.ts. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. oracleTextParser vitest. No ts-morph.
```
