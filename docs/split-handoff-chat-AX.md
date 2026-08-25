# Split handoff - chat AX (effectProgram.ts)

Parent now: **62982 B / 61.5 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AX.md.
Sole writer for rules-engine/src/effectProgram.ts and new effectProgram-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create effectProgram-handlers/index.ts on extract #1. Never create effectProgram/
beside effectProgram.ts. Parent CRLF; leaves LF. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/effectProgram.ts --min-bytes 2000

Order:
1. appendOracleStepToEffectProgram (~747-1007, 8.0 KB) plus exclusive helpers.
2. createChoiceEventFromEffectProgramChoiceRequest (~229-417, 6.8 KB).
3. runEffectProgram (~418-578, 5.6 KB).
4. Remaining append/build choice helpers until parent < 40960.

Public exports stay on effectProgram.ts (re-export from leaf).
Leaf must not import effectProgram.ts or the index. Byte-copy --dry first.
Typecheck rules-engine. Effect-program vitest. No ts-morph.
```
