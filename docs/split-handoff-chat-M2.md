# Split handoff - chat M2 (ZoneOps, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-M2.md.
CONTINUE oracleIRExecutorZoneOps.ts (now 375302 B / 366.5 KB).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC only if you must abort. Do not edit the module map.
Leaf must not import the parent. May import ZoneOpsCardTypeMatchers. Parent re-exports public API.

Inventory:
  node tools/ts-cluster-toc.mjs rules-engine/src/oracleIRExecutorZoneOps.ts --min-bytes 2500
  node tools/ts-cluster-deps.mjs rules-engine/src/oracleIRExecutorZoneOps.ts START END

Already extracted: CardTypeMatchers, ShuffleIntoLibrary, GY count parsers (Chat M). Dual-copy grep each symbol.

Next families (byte-copy --dry):
1. parseMoveZoneTypedCardFromAmongThem (~3213-3526, 12.7 KB) + parseAmongThemSplitFromMoveZoneParts (~2998-3199)
2. moveTargetedCardFromGraveyard + moveTopCardFromLibrary + moveBottomCardFromLibrary (~1260-1727)
   if combined under 40KB; else graveyard mover alone.
3. moveTargetedCardFromHand + moveTargetedCardFromExile (~6985-7249)
4. parseMoveZoneTypedCardFromYourHand + parseMoveZoneUpToTargetCountFromYourGraveyard

Typecheck rules-engine. oracleIRExecutor GY/library/exile tests. No ts-morph.
```
