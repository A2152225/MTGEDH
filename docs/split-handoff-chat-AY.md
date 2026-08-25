# Split handoff - chat AY (effectProgramOracleRunner.ts)

Parent now: **62306 B / 60.8 KB**. Still over 40960. Parent is CRLF.

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-AY.md.
Sole writer for rules-engine/src/effectProgramOracleRunner.ts and new
effectProgramOracleRunner-handlers/**.
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Create effectProgramOracleRunner-handlers/index.ts on extract #1. Never create
effectProgramOracleRunner/ beside the .ts. Parent CRLF; leaves LF.
Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/effectProgramOracleRunner.ts --min-bytes 800

Order:
1. createOracleIRChoiceEvent (~273-545, 10.2 KB) plus exclusive helpers.
2. applyTopLibraryChoiceCommand + applyExploreChoiceCommand (~602-802).
3. deriveOracleIRContextFromEffectProgramBindings (~1377-1499, 4.0 KB) and
   createOracleIRCommandHandler / context-with-bindings.
4. Remaining apply*ChoiceCommand until parent < 40960.

Public exports stay on the parent (re-export from leaf).
Leaf must not import the parent or the index. Byte-copy --dry first.
Typecheck rules-engine. Effect-program / oracle-runner vitest. No ts-morph.
```
