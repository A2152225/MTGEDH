# Split handoff - chat BD (oracleIRParserUtils.ts)

Parent now: **56411 B / 55.1 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BD.md.
Sole writer for rules-engine/src/oracleIRParserUtils.ts and new
oracleIRParserUtils-handlers/** OR family siblings oracleIRParserUtils*.ts.
Prefer a handlers folder on extract #1. Never create oracleIRParserUtils/
beside the .ts. Keep peeling until parent is under 40960 bytes.
Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Parent CRLF; leaves LF. Do not Read the whole parent.

Do NOT move whole parseQuantity (~110-667, 41.4 KB). Split that function by
contiguous if-chain phase into siblings (same technique as simple-action
clauses). Leftover parent becomes a dispatcher.

Grep dual-copy: isThatOwnerOrControllerSelector / isThoseOpponentsSelector also
live in oracleIRExecutorPlayerResolvePlayers.ts — leftover in parser utils if
present; do not merge in this split.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRParserUtils.ts --min-bytes 2000

Order:
1. First parseQuantity if-chain family under 40KB.
2. Continue phases until leftover parseQuantity body is under 40KB and parent
   file is under 40960.
3. parsePlayerSelector (~692-773, 5.9 KB) / splitIntoClauses / normalizeClause
   if still needed.

Public exports stay on the parent (re-export / dispatcher).
Leaf must not import the parent or the index. Byte-copy --dry first.
Typecheck rules-engine. Quantity / player-selector parser vitest. No ts-morph.
```
