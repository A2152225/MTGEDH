# Split handoff - chat T (PlayerStepHandlers)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-T.md.
Sole writer for rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts and new
oracleIRExecutorPlayer*.ts siblings. Keep the oracleIRExecutor* prefix.
No *-handlers/ folder. Keep peeling until parent is under 40960 bytes.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Do not Read the whole parent. Do not touch MainLoop.ts (chat W) or ZoneOps.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts START END

Parent re-exports apply* from the leaf. Leaf must not import the parent.

Order (confirm ranges with toc; copy helpers only if exclusive to that apply*):
1. applySearchLibraryStep (~4194-4624, 16.5 KB) -> oracleIRExecutorPlayerSearchLibraryStep.ts
2. applyDiscardStep (~6120-6597, 15.6 KB)
3. applyAddManaStep (~7659-8123, 16.8 KB) + resolveAddManaAmount if exclusive
4. applyLookChooseFromTopStep (~5550-5811, 10.4 KB)
5. applyVentureIntoDungeonStep then remaining apply* until parent < 40960.

Do not change scry/shuffle/search choice behavior (empty-library scry, up-to-N search
always prompts, optional shuffle). Byte-copy --dry first.
Typecheck rules-engine. Player-step / scry / search-library vitest. No ts-morph.
```
