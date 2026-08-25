# Split handoff - chat W (MainLoop)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-W.md.
Sole writer for rules-engine/src/oracleIRExecutorMainLoop.ts and new
oracleIRExecutorMainLoop*.ts siblings. Keep the oracleIRExecutor* prefix.
No *-handlers/ folder. Keep peeling until parent is under 40960 bytes.
Do not edit docs/mtg-logic-module-map.md - report owed rows.
Do not Read the whole parent. Do not touch PlayerStepHandlers (chat T) or Battlefield.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorMainLoop.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs rules-engine/src/oracleIRExecutorMainLoop.ts START END

The elephant is applyOracleIRStepsToGameStateImpl (~732-4012, 128.5 KB).
Do NOT move it whole. Hoist contiguous switch-case families into
oracleIRExecutorMainLoop<Family>Steps.ts. Each export is
tryApplyMainLoopXSteps(ctx, step, ...): result | undefined (undefined = fall through).
Parent keeps the for-loop + switch dispatcher.

Order (confirm with grep case '):
1. applyCounterSpellStep (~494-687) if exclusive.
2. First case family: exile_top / impulse_exile_top / exile permissions / goad-detain-
   cant_attack-cant_block-force_block-cant_activate / airbend-earthbend-animate.
3. Next: flip_coin / roll_die / draw-win-lose / clash-learn-attraction / venture-monarch.
4. Keep hoisting until the remaining impl body is under 40KB.

Leaves already exist for many apply* functions - the MainLoop leaf only dispatches to
those imports. Do not duplicate PlayerStepHandlers / Battlefield bodies.
Leaf must not import MainLoop.ts. Byte-copy --dry first.
Typecheck rules-engine. Executor smoke / applyOracleIRSteps vitest. No ts-morph.
```
