# Split handoff - chat M (ZoneOps)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-M.md.
Sole writer for rules-engine/src/oracleIRExecutorZoneOps.ts and new oracleIRExecutorZoneOps*.ts
siblings. Keep the prefix. No *-handlers/ folder. Do not edit docs/mtg-logic-module-map.md -
report the owed row. Do not Read the whole parent.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorZoneOps.ts --min-bytes 1500
  node tools/ts-cluster-deps.mjs rules-engine/src/oracleIRExecutorZoneOps.ts START END
  node tools/ts-cluster-range-bytes.mjs rules-engine/src/oracleIRExecutorZoneOps.ts gyParse=START-END

First cluster: GY parse family starting parseMoveZoneAllFromYourGraveyard (was ~886). Take contiguous
parseMoveZone* count/all-from-graveyard parsers. Stop before movers
(returnUpToMatchingFromGraveyardToHand ~1729) unless the parse leaf is still tiny.
Dual-copy grep each symbol. Suggested file: oracleIRExecutorZoneOpsGraveyardCountParsers.ts.

Already extracted - do not re-move: ZoneOpsCardTypeMatchers, ZoneOpsShuffleIntoLibrary.
Leaf may import CardTypeMatchers. Leaf must not import the parent. Parent re-exports the public names.

Byte-copy --dry first, then write.

Verify: import neighbors. npm run typecheck --workspace=rules-engine - no new errors in ZoneOps files.
Targeted vitest: test/oracleIRExecutor.test.ts plus GY return/exile/shuffle-from-graveyard cases.
No ts-morph / _refactor_scratch.
```

## Parent

**409596 B (~400.0 KB)**.
