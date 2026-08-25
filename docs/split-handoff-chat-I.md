# Split handoff - chat I (resolution.ts)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-I.md.
Behavior-preserving extract only. One writer for server/src/socket/resolution.ts,
resolution-handlers/**, resolutionHandlerDeps.ts, resolutionRegisterPreCompleteValidation*.ts.
Do not edit docs/mtg-logic-module-map.md - report the owed row. Do not Read all of resolution.ts.

Inventory (do not ingest the parent):
  node tools/ts-cluster-toc.mjs server/src/socket/resolution.ts --min-bytes 1500
  node tools/ts-cluster-deps.mjs server/src/socket/resolution.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/socket/resolution.ts xValue=START-END

First cluster: handleXValueSelectionResponse (confirm lines with toc; was ~3148-3294).
Byte-copy with --dry first:
  node tools/extract-ts-cluster.mjs --parent server/src/socket/resolution.ts --start N --end M \
    --out server/src/socket/resolution-handlers/xValueSelectionResponseHandlers.ts \
    --header tools/_extract-header-I.txt --replacement tools/_extract-replace-I.txt --export --dry
Then write. Header = origin/cluster/entries + the imports cluster-deps listed. Replacement in the
parent is not needed if you only cut the function and switch the case to deps - write the function
cut as empty replacement and separately patch handleStepResponse to:
  await getResolutionHandlerDeps().handleXValueSelectionResponse(...); return;
(parent used break; extracted fn uses return).

Wire: named re-export on resolution-handlers/index.ts; add to ResolutionHandlerDeps +
createResolutionHandlerDeps. Leaf must not import resolution.ts or the handlers index.
X_VALUE pre-complete already lives in resolutionRegisterPreCompleteValidationForChoicePromptSteps.ts
- do not append to a near-40KB sibling.

If the X-value leaf is well under 40KB, a second FILE may take handleTriggerOrderResponse (~3715-3796)
the same way. Do not pack both into one module. Do not mass-move flat resolution*.ts siblings.

Verify: re-read import neighbors. npm run typecheck --workspace=server. Targeted vitest for X-value /
pay-X (and trigger-order if taken). Parent byte delta. No ts-morph / _refactor_scratch.
```

## Parent

`server/src/socket/resolution.ts` is **186192 B (~181.8 KB)**. Cores stay here:
`registerResolutionHandlers`, `handleStepResponse` (dispatch), `handleTargetSelectionResponse` (dispatch),
`handleOptionChoiceResponse` (dispatch), `handleAIResolutionStep`, `sanitizeStepForClient`.

## Wiring notes

- New file: `resolution-handlers/xValueSelectionResponseHandlers.ts`
- Leaf **must not** import `resolution.ts` or the handlers index
