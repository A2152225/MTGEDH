# Split handoff - chat N2 (zoneSync, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-N2.md.
CONTINUE oracleIrServerZoneSync.ts (now 214256 B / 209.2 KB).
Keep peeling until parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC only if you must abort. Do not edit the module map.
Parent imports the leaf directly. Leaf must not import the parent or the handlers index.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/state/modules/oracleIrServerZoneSync.ts --min-bytes 1500
  node tools/ts-cluster-deps.mjs server/src/state/modules/oracleIrServerZoneSync.ts START END

Already extracted: look-choose/pile, vote/join-forces, tap-untap/tap-matching, explore/populate/change-target.
Skip any queue* that calls resumeOracleIRRemainingStepsFromResolution / applyOracleIRStepsOnServer.

Next resume-free queue groups (confirm with cluster-deps OUT->IN):
1. queueAddManaChoicePromptsFromOracleIRResult (~1670) + queueAddCounterTargetSelectionPromptsFromOracleIRResult
   (~1798) + queueCounterDistributionPromptsFromOracleIRResult (~1906) if under 40KB
2. queueConniveChoicePromptsFromOracleIRResult + queuePlayerChoicePromptsFromOracleIRResult
3. queueMoveZoneChoicePromptsFromOracleIRResult + queueMoveZoneDestinationChoicePromptsFromOracleIRResult
4. land-from-hand trio (~752-890) if resume-free

Byte-copy --dry first. Named TOC re-export. Typecheck server. Targeted prompt vitest. No ts-morph.
```
