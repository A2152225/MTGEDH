# Split handoff - chat L (battlefield step handlers)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-L.md.
Sole writer for rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts and new
oracleIRExecutorBattlefield*.ts siblings. Keep the oracleIRExecutor* prefix. No *-handlers/ folder.
Do not edit docs/mtg-logic-module-map.md - report the owed row. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts --min-bytes 2000
  node tools/ts-cluster-deps.mjs rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts START END
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.ts cluster=START-END

Do not start with applyTapOrUntapStep / applySkipNextUntapStep / applyOptionalUntapChoiceStep if they
still close over resolveDirectBattlefieldPermanents (OUT->IN from cluster-deps). Previous extract left
those in the parent on purpose.

Preferred first cluster if they do not close over parent-only helpers: applySuspectStep, applyDetainStep,
applyCantBlockStep (was ~5164-5893). Stop before applyCantAttackStep if the leaf would exceed 40KB.
Already extracted - do not re-move: BattlefieldSacrificeWhat, BattlefieldPhaseCombatAuraSteps,
ExileGraveyardCardHandlers.

Byte-copy --dry first, then write. Parent re-exports the moved apply* names. Leaf must not import the parent.

Verify: import neighbors. npm run typecheck --workspace=rules-engine - ignore server/src errors from
parallel chats; no new errors in the battlefield files. Targeted vitest: oracleIRExecutor.test.ts plus
detain/suspect/cant-block tests if present. No ts-morph / _refactor_scratch.
```

## Parent

**534484 B (~522 KB)**.
