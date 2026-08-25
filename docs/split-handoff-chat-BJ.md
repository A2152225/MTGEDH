# Split handoff - chat BJ (oracleIRParserEffectImpulsePermission.ts)

Parent now: **48439 B / 47.3 KB**. Still over 40960. Parent is mixed CRLF/LF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-BJ.md.
Sole writer for rules-engine/src/oracleIRParserEffectImpulsePermission.ts and new
oracleIRParserEffectImpulsePermission-handlers/** OR family siblings
oracleIRParserEffectImpulse*.ts. Prefer a handlers folder on extract #1.
Never create oracleIRParserEffectImpulsePermission/ beside the .ts.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Preserve existing line endings in the parent; new leaves LF.
Do not Read the whole parent.

Do NOT move whole parseEffectLevelImpulsePermissionClause (~7-1108, 47.1 KB).
Split that function by contiguous if-chain phase into tryParse* siblings.
Leftover parent becomes a dispatcher.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRParserEffectImpulsePermission.ts --min-bytes 2000

Public exports stay on the parent. Leaf must not import the parent or index.
Byte-copy --dry first. Typecheck rules-engine. Impulse-permission parser vitest.
No ts-morph.
```
