# Split handoff - chat V (SimpleActionClauses)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-V.md.
Sole writer for rules-engine/src/oracleIRParserSimpleActionClauses.ts and new
oracleIRParserSimpleAction*.ts siblings. Keep the oracleIRParser* prefix.
No *-handlers/ folder. Keep peeling until parent is under 40960 bytes.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Do not Read the whole parent. Do not touch oracleIRParser.ts barrel or postprocess.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRParserSimpleActionClauses.ts --min-bytes 2000
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/oracleIRParserSimpleActionClauses.ts
    elephant=247-5668

The elephant is tryParseSimpleActionClause (~247-5668, 204.2 KB). Do NOT move it whole.
Same as intervening-if / move-zone guards: hoist contiguous clause-family runs into
oracleIRParserSimpleAction<Family>.ts that take the parse args and return a step or null
(null = fall through). Parent calls tryX; if non-null, return.

Grep for comment banners or leading clause.match / if (clause families (combat, draw,
life, mill, discard, vote, search, token, counter). Each leaf under 40KB.
Keep tryParseSimpleActionClause as the dispatcher. Recursion into itself stays in the
parent or is passed as a callback - leaves must not import the parent.

Byte-copy --dry first. Typecheck rules-engine. Parser / simple-action vitest. No ts-morph.
```
