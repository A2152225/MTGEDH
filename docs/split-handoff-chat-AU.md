# Split handoff - chat AU (oracleIRParserStaticAbilityClauses.ts)

Parent now: **68784 B / 67.2 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AU.md.
Sole writer for rules-engine/src/oracleIRParserStaticAbilityClauses.ts and new
oracleIRParserStaticAbilityClauses-handlers/** OR family siblings with the
oracleIRParserStaticAbility* prefix (same directory is OK if you do not create
oracleIRParserStaticAbilityClauses/ beside the .ts). Prefer a handlers folder
on extract #1 so the parent can stay the public path.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Never create oracleIRParserStaticAbilityClauses/ beside the .ts.
Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move whole tryParseStaticAbilityGrantClause (~138-1162, 43.8 KB).
Split that function by contiguous if-chain phase into tryParse* siblings
(same technique as oracleIRParserSimpleActionClauses). Leftover parent becomes
a dispatcher. tryParseRulesTextClause (~1163-1871, 19.4 KB) can move as one
leaf if it stays under 40KB after header.

Do not change appliedSteps / conditional wrapper recording.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRParserStaticAbilityClauses.ts --min-bytes 2000

Order:
1. First grant-clause if-chain family (~150-400 range) as one leaf under 40KB.
2. Continue grant-clause phases until leftover tryParseStaticAbilityGrantClause
   body is under 40KB.
3. tryParseRulesTextClause if still needed for the parent ceiling.
4. Shared helpers just-in-time, not helpers.ts.

Public exports stay on the parent (re-export / dispatcher).
Leaf must not import the parent or the index. Byte-copy --dry first.
Typecheck rules-engine. Static-ability / grant-clause parser vitest. No ts-morph.
```
