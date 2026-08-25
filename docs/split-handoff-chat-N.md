# Split handoff - chat N (oracleIrServerZoneSync)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-N.md.
Sole writer for server/src/state/modules/oracleIrServerZoneSync.ts and
oracleIrServerZoneSync-handlers/**. Do not edit docs/mtg-logic-module-map.md - report the owed row.
Do not Read the whole parent. Parent imports the leaf directly (not only via the index).
Leaf must not import oracleIrServerZoneSync.ts or the handlers index.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/oracleIrServerZoneSync.ts --min-bytes 1500
  node tools/ts-cluster-deps.mjs server/src/state/modules/oracleIrServerZoneSync.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/state/modules/oracleIrServerZoneSync.ts tap=START-END

First cluster: queueTapMatchingPermanentsChoicePromptsFromOracleIRResult (~2449) and
queueTapOrUntapChoicePromptsFromOracleIRResult (~2823), plus private helpers they close over.
Skip any helper that calls resumeOracleIRRemainingStepsFromResolution / applyOracleIRStepsOnServer
(that is why sacrifice/discard/proliferate stayed in the parent).

If this pair is small, a second FILE may take explore/populate/change-target
(queueExploreChoicePromptsFromOracleIRResult ~1286) only if those also stay resume-free.

Suggested file: oracleIrServerTapUntapChoicePrompts.ts. Named TOC re-export.
Already extracted - do not re-move: LibrarySearchLookChoosePilePrompts, VoteJoinForcesPrompts,
PostExecutionStateSync, scry/surveil/blight/prompt-resume utils.

Byte-copy --dry first, then write.

Verify: import neighbors. npm run typecheck --workspace=server. Targeted vitest for tap/untap IR
prompts and tap-matching permanents. No ts-morph / _refactor_scratch.
```

## Parent

**232546 B (~227.1 KB)**.
