---
name: split-ts-module
description: Behavior-preserving extraction playbook for oversized MTG logic TypeScript modules. Use when splitting a large .ts file, extracting handlers from resolution.ts / game-actions.ts / triggered-abilities.ts / oracleIRParser / oracleIRExecutor, adding logic to a file already over 40KB, or reconciling a symbol that exists in both a monolith and a folder submodule.
---

# Split a TypeScript logic module

Goal: MTG logic `.ts` files at or under **40960 bytes on disk**. One domain cluster per file (~10–40KB). Move code only — no card fixes, no renames, no cleanup in an extract diff.

Related: `.cursor/rules/typescript-max-40kb-split.mdc` (ceiling, naming, dual barrel), `.cursor/rules/mtg-logic-split-playbook.mdc` (where new code goes), `docs/mtg-logic-module-map.md` (who owns which mechanic).

## Session scope

**One parent per session. Keep peeling that parent until it is under 40960 bytes.** That is the only success condition. A 4-leaf cap leaves a 200–500 KB parent mostly intact (4 × ~20 KB ≈ 80 KB moved). Finish the file.

One cluster at a time: inventory, byte-copy `--dry`, write, typecheck/targeted tests, then the next cluster. Do not start a second parent. Do not run two writers on the same parent.

If a leftover **function itself** is over 40KB (`dealCombatDamage`, `nextTurn`, `evaluateInterveningIfClauseInternal`, `applyGrantTemporaryAbilityStep`), **do not move it whole**. Split that function by phase into siblings (same technique as move-zone guard chains). Keep splitting that function until **its remaining body** is also under 40KB.

**Abort and hand off** only when the session is no longer safe: extract `--dry` disagrees with the TOC, typecheck/tests fail twice on the same peel, line numbers drift, or mixed CRLF/junk appears. Then paste leftover TOC (`node tools/ts-cluster-toc.mjs <parent> --min-bytes 3000`) plus a continue prompt. Do not stop because you hit a leaf count.

## Sizes

```bash
node tools/ts-logic-file-sizes.mjs             # files over the ceiling
node tools/ts-logic-file-sizes.mjs --all --top 40
node tools/ts-logic-file-sizes.mjs --scope server/src/socket --json
```

Bytes, never line count: `oracleIRParser.ts` is ~2.1k lines and ~863 KB.

## Extract tools (byte-copy, not AST reprint)

Do **not** use ts-morph, jscodeshift, recast, `ts.createPrinter`, organize-imports auto-fix, or `tools/_refactor_scratch/*.mjs`. Those reprint or reconstruct source and mixed CRLF / dropped comments.

Inventory without reading the megafile:

```bash
node tools/ts-cluster-toc.mjs <parent> --min-bytes 2000
node tools/ts-cluster-range-bytes.mjs <parent> cluster=START-END
node tools/ts-cluster-deps.mjs <parent> START END
```

Copy the cluster as raw bytes (`--dry` first). Write only a small header file and a small replacement file by hand; the script copies the body:

```bash
node tools/extract-ts-cluster.mjs --parent <file> --start N --end M \
  --out <newFile> --header <header.txt> --replacement <replacement.txt> \
  [--export] [--allow-nested] [--dry]
```

`--allow-nested` is required for indented `socket.on` bodies inside `registerX`. The script refuses a non-top-level start otherwise. Leaf over 40960 B: split the cluster; do not pack.

Then wire imports / deps-seam / barrel re-export by hand (hundreds of bytes). Re-read the printed parent seam plus import neighbors.

## Steps

1. **TOC only.** Run `node tools/ts-cluster-toc.mjs`, or Grep `^(export )?(async )?function`, `case ResolutionStepType`, or `case '`. Record start/end lines. **Never Read a megafile whole** — a 1 MB parent is 250–400K tokens.
2. **Dual-copy check.** Grep the symbol across the repo. If a folder submodule already defines it (`triggers/zone-changes.ts`, `triggers/combat.ts`), merge into that copy and re-export — never create a third implementation.
3. **Pick a leaf cluster.** Best: a handler that already calls extracted deps, or exported functions that do not close over parent locals (`OUT->IN` from cluster-deps). If it closes over many parent helpers, extract those helpers first into a `*Utils.ts` — extract helpers just-in-time, not into a 40KB junk drawer. Confirm size with range-bytes.
4. **Create the module.** `domain + mechanic + role` filename. Header comment: origin parent, cluster moved, public entry symbols. **Byte-copy** the body with extract-cluster (`--dry` then write). Minimal imports from cluster-deps IMPORTS / OUT->IN; `import type` for types. Add a named re-export plus one-line comment to the domain `*-handlers/index.ts` (create the folder on extract #1; never `X/` beside `X.ts`).
5. **Wire it** (see below).
6. The extract script already deletes the moved body when `--replacement` is the call or re-export. Do not retype the body.
7. **Verify** (see checklist). **Solo extract:** add the module-map row. **Parallel wave:** do not edit `docs/mtg-logic-module-map.md` — paste owed rows in the wrap-up. The coordinator chat merges them; the user should not copy rows by hand.
8. **Stop** when the new file nears 40KB — split the cluster instead of packing more cases.

## Wiring

**Resolution (preferred): deps seam.** `server/src/socket/resolution.ts` is not a re-export-only barrel; the four cores (`registerResolutionHandlers`, `handleStepResponse`, `handleTargetSelectionResponse`, `handleOptionChoiceResponse`) reach extracted handlers through `resolutionHandlerDeps.ts`.

```ts
// resolutionHandlerDeps.ts
import { handleFooResponse } from "./resolution-handlers/fooResponseHandlers.js";

export type ResolutionHandlerDeps = {
  handleFooResponse: ResolutionStepHandler;
};

export function createResolutionHandlerDeps(
  overrides: Partial<ResolutionHandlerDeps> = {},
): ResolutionHandlerDeps {
  return { handleFooResponse, ...overrides };
}
```

```ts
// resolution.ts core - the case body becomes a delegation
case ResolutionStepType.FOO:
  await getResolutionHandlerDeps().handleFooResponse(io, game, gameId, step, response);
  return;
```

Rules for this seam:

- Extracted files **must not import `resolution.ts`**. If a handler needs something the deps module also default-imports, use a lazy `await import("./resolutionHandlerDeps.js")` inside the body.
- Also add pre-complete validation for the extracted step type in `resolutionRegisterPreCompleteValidationForExtractedSteps.ts`, so invalid input cannot `completeStep`. That file is at 37.5 KB — split validation into a new module rather than appending past 40KB.
- If one handler would exceed 40KB, split by **phase** (apply vs resume), like graveyard and discard.
- A parent may import an already-leaf handler directly (library search does this). No `socket/resolution/` folder.

**Parser / postprocess / game-actions:** parent does `export { foo } from './newModule.js'` or keeps a thin wrapper, so existing import paths keep working.

**Triggers:** merge into the `triggers/` folder module, then replace the leftover body with `export { detectDeathTriggers } from "./triggers/zone-changes.js";`.

## Barrels

| Barrel | File | Job |
| --- | --- | --- |
| Public / compatibility | `X.ts` | Stable path for the app and tests. Keeps `from "./resolution.js"` working. |
| Internal / agent TOC | `X-handlers/index.ts` (or `triggers/index.ts`) | Named re-exports of extracted modules, one-line comment each, under ~10KB. |

Never `X.ts` and `X/index.ts` in the same directory. Index files: named re-exports only, no `export *`, no implementations. A leaf must not import the public parent or the index that re-exports it.

`resolutionHandlerDeps.ts` is the **runtime injection seam**, not a second public barrel.

## Verification checklist

- [ ] Re-read every new/changed import line **plus 2–3 neighbors** in both files: no literal `` `r`n ``, stray backticks, doubled backslashes, merged lines, or a lone CRLF line in an LF file.
- [ ] New file under 40960 bytes; parent shrank by more than the import lines it gained (`node tools/ts-logic-file-sizes.mjs --all --scope <dir>`).
- [ ] No duplicated implementation left behind.
- [ ] `npm run typecheck --workspace=server` (or `--workspace=rules-engine`).
- [ ] Targeted `npx vitest run <test file>` for the domain. Full suite only for applyEvent/triggers work.
- [ ] `docs/mtg-logic-module-map.md` row added (solo) **or** owed rows pasted for the coordinator (parallel wave).

## Anti-patterns

- Reading the whole parent "to be safe".
- `utils2.ts`, `helpers.ts`, `...Batch368Bulk.ts` names.
- Appending to a sibling already at ~36–40KB.
- Creating `socket/resolution/` or `socket/game-actions/` next to the same-named `.ts`.
- Returning behavior changes inside a split diff.
- Always appending a successful `conditional` wrapper to `appliedSteps` after inner/else steps already ran. Record the wrapper only when that branch applied nothing (`oracleIRExecutorMainLoopLateSteps.ts`). Tests assert inner kinds (`move_zone`, `unless_discards`, …), not a trailing `'conditional'`.
- Reviving `tools/_refactor_scratch/*.mjs` dump-and-cut scripts — they caused CRLF and reconstruction bugs. Use `tools/extract-ts-cluster.mjs` (byte-copy) instead.
- ts-morph / jscodeshift / recast / `ts.createPrinter` as extract writers — they reprint the file. Parser-only inventory is fine; printing is not.
- A second agent writing the same parent file concurrently.

## Paste prompts (one cluster per chat)

**A — Inventory**

```text
Read .cursor/skills/split-ts-module/SKILL.md and .cursor/rules/typescript-max-40kb-split.mdc.
Do not extract yet. Run: node tools/ts-logic-file-sizes.mjs
Then run: node tools/ts-cluster-toc.mjs <PARENT> --min-bytes 2000
Return: ranked clusters with start-end lines and byte size, plus any dual-copy symbols (same export in a sibling/folder). Do not Read the whole file.
```

**B — Extract one resolution cluster**

```text
Read .cursor/skills/split-ts-module/SKILL.md. Behavior-preserving extract only.
Parent: server/src/socket/resolution.ts
Cluster: <SYMBOL or case list> lines <START>-<END>
Byte-copy the body with node tools/extract-ts-cluster.mjs --dry first (header + replacement files by hand). Follow resolutionHandlerDeps: new file under server/src/socket/resolution-handlers/<name>Handlers.ts, named-re-export from resolution-handlers/index.ts, add to ResolutionHandlerDeps + createResolutionHandlerDeps, call via getResolutionHandlerDeps(). New file must not import resolution.ts. Also add pre-complete validation for this step type in resolutionRegisterPreCompleteValidationForExtractedSteps.ts (do not grow that file past 40KB - split validation if needed). If the handler would exceed 40KB, split apply vs resume like graveyard/discard. Keep under 40KB. Do not append to siblings already at ~39-40KB. Do not mass-move existing flat resolution* files in this session.
After edits: re-read every new/changed import and the two adjacent lines for CRLF, backticks, merged lines. Typecheck server. Run targeted vitest for this step type. Update docs/mtg-logic-module-map.md. Do not Read all of resolution.ts.
```

**C — Extract exported functions (postprocess / game-actions)**

```text
Read .cursor/skills/split-ts-module/SKILL.md. Move only these already-exported functions from <PARENT> to <NEWFILE> (for game-actions/interaction/ai: put NEWFILE under <parent>-handlers/ and named-re-export from that folder's index.ts; parent re-exports public API so existing imports keep working). Copy private helpers they close over. No logic changes. Never create game-actions/ next to game-actions.ts. Verify import lines + neighbors. Typecheck the workspace. Update the module map. Stop if the new file would exceed 40KB; split the list instead.
```

**D — Dual-copy reconcile (triggers)**

```text
Read .cursor/skills/split-ts-module/SKILL.md. Symbol: <detectX>. Grep both definitions and all importers. Diff leftover vs triggers/<file>. Merge leftover unique behavior into the folder module (split that module if it would stay over 40KB). Replace leftover with a re-export. Do not leave two implementations. Typecheck server; run trigger-related vitest. Update the module map.
```

**E — Feature landing on an oversized file**

```text
The target file is over 40KB. Do not add the feature into it. Put new logic in a new descriptive module (or the existing extracted sibling that owns this mechanic) and import it. Parent may gain import lines only. Re-read import neighbors. If this is a brand-new mechanic, name the file domain+mechanic+role, not utils2.
```
