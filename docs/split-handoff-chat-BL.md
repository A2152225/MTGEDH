# Split handoff - chat BL (oracleIRParserLifeAndCombatClauses.ts)

Parent now: **45342 B / 44.3 KB**. Still over 40960. Parent is CRLF (BOM present — do not add another BOM).

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BL.md.
Sole writer for rules-engine/src/oracleIRParserLifeAndCombatClauses.ts and new
oracleIRParserLifeAndCombatClauses-handlers/** OR family siblings
oracleIRParserLifeAndCombat*.ts. Prefer a handlers folder on extract #1.
Never create oracleIRParserLifeAndCombatClauses/ beside the .ts.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent. Do not add a BOM.

tryParseLifeAndCombatClause (~250-1071, 32.9 KB) can move as one leaf if it stays
under 40KB after header. parseDamageAmount / parseLifeChangeAmount (~12-188)
just-in-time if the clause leaf closes over them.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRParserLifeAndCombatClauses.ts --min-bytes 2000

Public exports stay on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. Life/combat clause parser vitest.
No ts-morph.
```
