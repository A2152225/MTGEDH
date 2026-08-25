# Split handoff - chat O (turn.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-O.md.
Sole writer for server/src/state/modules/turn.ts and turn-handlers/**.
Do not edit docs/mtg-logic-module-map.md - report the owed row. nextStep() stays the dispatcher.
Do not Read the whole parent. Do not move dealCombatDamage or nextTurn.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/turn.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs server/src/state/modules/turn.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/state/modules/turn.ts draw=START-END

First cluster: draw-step body under else if (nextStep === "DRAW") (~4717) inside nextStep().
Extract runTurnStepDraw(ctx, ...) the same way upkeep was peeled. Parent keeps the if/else if.
Copy helpers only if they are draw-step exclusive. Confirm OUT->IN from cluster-deps before moving.

If that leaf is small, a second FILE may take the leaving-UNTAP run (shouldUntap ~
4937) as runTurnStepUntap. Do not move performUntapStepTurnAction unless it is used only from that peel.

Already extracted: turnStepCleanup, turnStepUpkeep, pendingDelayedTriggerDequeues.
Named re-export from turn-handlers/index.ts. Leaf must not import turn.ts or the index.
Parent is likely CRLF; new leaves LF. Indented body inside nextStep() needs --allow-nested.

Byte-copy --dry first, then write.

Verify: import neighbors. npm run typecheck --workspace=server. Targeted vitest for draw-step extra
draws (Howling Mine / Immortal Sun / calculateAdditionalDraws), beginning-of-draw triggers, untap if
extracted. No ts-morph / _refactor_scratch.
```

## Parent

**239242 B (~233.6 KB)**.
