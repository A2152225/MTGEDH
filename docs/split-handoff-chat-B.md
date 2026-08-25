# Split handoff — chat B (`oracleIRParserPostprocess.ts`, then `oracleIRParser.ts`)

Scope of this chat: **only** `rules-engine/src/oracleIRParserPostprocess.ts`, new
`oracleIRParserPostprocess*.ts` siblings, and (after postprocess is a thin barrel)
`rules-engine/src/oracleIRParser.ts`. No other writer may touch these files.

Do not edit `docs/mtg-logic-module-map.md` from this chat.

## Why extraction is script-driven here

`oracleIRParserPostprocess.ts` started at **1,200,219 bytes / 29,087 lines**, is **100% CRLF**,
and contains **203 literal `U+FFFD` characters baked into the source** (the parser matches them
as data, e.g. `/^[\u2022\uFFFD]\s*/` and bare `�` inside regex character classes).

Retyping those bytes through an editor corrupts the replacement characters and mixes line
endings, so clusters are moved with a byte-exact slicer that never re-encodes the moved region:

- `tools/_tmp-chatB-extract-cluster.mjs` — slices an exact line range out of the parent,
  writes `header + movedBytes + footer` to the new module and `before + replacement + after`
  back to the parent. It refuses to write unless
  `before + moved + after === original` (byte identity), so a split cannot silently corrupt.
  It also runs a **boundary guard** (the range must start at a top-level declaration and must
  not begin in the middle of a multi-line statement) and prints the parent seam plus both ends
  of the new file for the required import-neighbor check.
- `tools/_tmp-chatB-cluster-deps.mjs` — for a line range, reports `IN->OUT` (symbols the parent
  must import back), `OUT->IN` (symbols the cluster still needs from the parent — must be zero
  or already extracted, otherwise the leaf would import its parent) and the exact import block
  the new module needs.
- `tools/_tmp-chatB-encoding-probe.mjs` — UTF-8 validity, BOM, CRLF vs bare LF, `U+FFFD` count.
- `tools/_tmp-chatB-toc.mjs` — every top-level declaration with its line range and byte size, so
  a cluster can be sized without reading the megafile.
- `tools/_tmp-chatB-line-bytes.mjs` — byte size of an arbitrary line range.

These are `_tmp-chatB-*` prefixed because another chat overwrote an unprefixed `_tmp-` helper
mid-session. Delete them when the campaign ends.

## Guard-run hoisting (how the elephants are being split)

The three oversized functions are single `if (...) return [...]` chains over a tiny prologue
(`raw`, `sequence`, `clauseBody`, `staticMetadata`, `temporaryMetadata`). They are split by moving
contiguous runs of guards into sibling helpers that are called from the exact position the run
occupied, so first-match order is unchanged:

```ts
const hoistedX = parseX(raw, sequence);
if (hoistedX) return hoistedX;
```

- `tools/_tmp-chatB-guard-runs.mjs` — classifies every indent-2 statement in the chain and emits
  maximal **safe runs**, plus a size-budgeted plan. `--why` explains what blocks the rest.
- `tools/_tmp-chatB-hoist-guards.mjs` — performs a multi-range hoist into one module, byte-exact,
  with the same identity check and a boundary guard.
- `tools/_tmp-chatB-name-plans.mjs` — attaches real module/helper names and headers to a plan.
  Generated plans use placeholder ordinals; **never ship those names**.
- `tools/_tmp-chatB-fix-imports.mjs` — runs the typecheck, resolves every `Cannot find name` in the
  new modules against the parent's own import map, and refuses to add an import to the parent.

A statement may only join a run when **all** of these hold, because a hoisted run that returns
`null` means "keep trying later guards" rather than "stop":

1. every `return` it can execute is provably non-null — an array/object literal, a
   `staticMetadata` / `temporaryMetadata` call, or `if (x) return x;` on a guarded local;
2. it declares nothing the chain's prologue owns, and no reference span of a function-scope local
   crosses either edge of the run (otherwise the moved code loses or silently rebinds the name);
3. it touches no symbol declared at the parent's top level, which would make the leaf import its
   own parent.

Rule 2 was learned the hard way: the first analyzer derived locals from statement segmentation and
missed `namedPtAndKeyword`, so one guard was hoisted without its match variable. `tsc` caught that
one, but a local that shadows a module import would **not** produce an error, so locals are now
collected by plain indent-2 line scan.

## Progress

| Parent size | When |
| --- | --- |
| 1,200,219 B (1172.1 KB) | start |
| 1,013,695 B (989.9 KB) | after 9 cluster extracts |
| 744,119 B (726.7 KB) | after 20 cluster extracts |
| 712,752 B (696.0 KB) | after 21 cluster extracts |
| 465,518 B (454.6 KB) | after 12 guard-run hoists out of `parseCurrentResidualUnknownStep` |
| 193,732 B (189.2 KB) | after all three elephants were broken up |
| 12,830 B (12.5 KB) | **done** — parent is a pure barrel, 0 function declarations |

Modules created (all under 40 KB, all CRLF, all verified by byte identity). Every
`oracleIRParserPostprocess*.ts` sibling in the tree was written by this chat; run
`node tools/ts-logic-file-sizes.mjs --all` for current sizes.

Cluster moves (whole already-exported families):

| New module | KB |
| --- | --- |
| `...GraveyardCastPermission.ts` | 21.8 |
| `...DrawDiscardStepSplitters.ts` | 21.8 |
| `...LifeDestroyLibrarySearchSteps.ts` | 17.8 |
| `...KeywordStaticGrantSteps.ts` | 20.9 |
| `...GraveyardAdditionalCostPermission.ts` | 19.0 |
| `...ExileAndGraveyardPermissionModifiers.ts` | 26.7 |
| `...CopySpellTailHelpers.ts` | 10.3 |
| `...CopySpellUnknownSteps.ts` | 32.1 |
| `...KeywordReminderPrunes.ts` | 26.6 |
| `...GraveyardKeywordExpansions.ts` | 19.0 |
| `...TokenCreationMetadata.ts` | 15.7 |
| `...UnlessSacrificeConditionals.ts` | 5.4 |
| `...DrawLifeDestroyMetadata.ts` | 20.3 |
| `...SacrificeCounterDamageMetadata.ts` | 24.0 |
| `...DieRollAndReplacementExpansions.ts` | 24.7 |
| `...BattlefieldEntryAndTopLibraryFollowups.ts` | 30.9 |
| `...CompoundMoveZoneAndChoiceExpansions.ts` | 31.0 |
| `...VoteRestrictionAndEmblemExpansions.ts` | 28.7 |
| `...GapClosureStepRepairs.ts` | 37.0 |
| `...DiscardMillLifeStepSplitters.ts` | 24.8 |
| `...DynamicCounterRiders.ts` | 15.8 |
| `...MoveZoneCopyAndLandAnimationExpansions.ts` | 18.9 |

Guard-run hoists out of `parseCurrentResidualUnknownStep`:

| New module | KB |
| --- | --- |
| `...ResidualStaticGrantGuards.ts` | 24.3 |
| `...ResidualEntryAndPermissionGuards.ts` | 31.8 |
| `...ResidualTextChangeAndCatalogGuards.ts` | 26.9 |
| `...ResidualCombatCounterAndPaymentGuards.ts` | 22.4 |
| `...ResidualPerpetualAndSecretChoiceGuards.ts` | 31.2 |
| `...ResidualReflexiveFragmentGuards.ts` | 12.8 |
| `...ResidualManaPhasingAndAttachGuards.ts` | 32.0 |
| `...ResidualNumberChangeAndGroupPtGuards.ts` | 31.6 |
| `...ResidualNamedModeSearchGuards.ts` | 27.0 |
| `...ResidualAttackerTokenAndMetadataGuards.ts` | 13.4 |
| `...ResidualSelfReferenceAndLibraryOrderGuards.ts` | 31.6 |
| `...ResidualWardAndEvidenceGuards.ts` | 5.4 |

Final cluster moves, once the elephants were gone and the parent was ordinary code again:

| New module | KB |
| --- | --- |
| `...KeywordActionUnknownSteps.ts` | 17.2 |
| `...UnknownAbilityPredicates.ts` | 0.5 |
| `...AmassDiscoverConniveRecruitKeywords.ts` | 22.7 |
| `...ClashScryExploreReminderPrunes.ts` | 18.2 |
| `...VanishingModularStaticPrunes.ts` | 19.5 |
| `...ReminderPlatformTextPredicates.ts` | 17.8 |
| `...CrewChampionLateKeywordPrunes.ts` | 14.6 |
| `...TriggerEffectFragmentPrunes.ts` | 18.9 |
| `...FutureSpellAndTokenReminderPrunes.ts` | 15.8 |
| `...DeterministicBodyAndConditionalExpansions.ts` | 21.3 |
| `...ResidualUnknownLowering.ts` | 22.1 |

Wiring pattern: the parent keeps `export { ... } from './newModule'` for anything that was
already public, plus `import { ... } from './newModule'` for private helpers the remaining
parent code still calls. No leaf imports the parent, so there are no cycles.

## Two mistakes made and how they were caught

1. **Sliced into the tail of a previous import block.** The range began two lines early and
   swept `} from './...GraveyardAdditionalCostPermission';` into the new module. Caught by the
   seam printout, repaired in the same turn, and the extractor now has a boundary guard that
   refuses such a range. Always confirm the boundary lines are blank / statement-closing before
   slicing — do not infer them from a single grep hit.
2. **`prune*/upgrade*` inside a header block comment** closed the comment early. Never put `*/`
   in a header, including inside a glob.

## Remaining work

Both campaign parents are **finished**.

`oracleIRParserPostprocess.ts` is a 12.5 KB barrel. All 71 `oracleIRParserPostprocess*.ts`
siblings are under the ceiling (largest is `...GapClosureStepRepairs.ts` at 37.0 KB, which
predates this campaign).

`oracleIRParser.ts` is a 0.1 KB barrel (`export { parseOracleTextToIR } from '...'`). New
`oracleIRParser*` modules written in this chat are all under the ceiling. Pre-existing
oversized clause files (`SimpleActionClauses` 215.7 KB, `StaticAbilityClauses` 67.2 KB,
`Utils` 55.1 KB, `EffectImpulsePermission` 47.3 KB, `LifeAndCombatClauses` 44.3 KB) were
already over the ceiling and were not appended to.

All three "elephant" functions were broken up. For the record:

| Function | Peak size | How it was split |
| --- | --- | --- |
| `parseCurrentResidualUnknownStep` | 287.9 KB | 12 guard-run hoists, then head/tail extracts |
| `parseStructuredTriggerResidualGrant` | 115.6 KB | guard-run hoists into five P/T-grant siblings |
| `isCurrentBatchReminderOrPlatformOnlyText` | 62.5 KB | disjunction split into three pattern-table siblings |

## `oracleIRParser.ts` — encoding restore then extract

`oracleIRParser.ts` was **865.2 KB**, of which **87% was one apostrophe** that had been
CP1252/UTF-8-misdecoded into a 2,026-character seed repeated 166 times. A single regex line
was larger than the 40 KB ceiling, so no extract could produce a legal sibling.

This chat applied a mechanical encoding restore (`tools/_tmp-chatB-repair-mojibake.mjs`):
each seed was replaced with U+2019 (or dropped when it sat next to an existing `\u2022` in
a bullet class). File dropped to **99.7 KB / 0.0% mojibake**. Targeted parser tests stayed
green (1086/1086), so the garbage bytes were not load-bearing for oracle text.

Then the remaining real code was extracted:

| New module | KB |
| --- | --- |
| `oracleIRParserEffectClauseToStep.ts` | 9.6 |
| `oracleIRParserAbilityMerges.ts` | 6.3 |
| `oracleIRParserImpulseExileTop.ts` | 28.6 |
| `oracleIRParserExileTopOnlyLegacy.ts` | 17.4 |
| `oracleIRParserAbilityToIR.ts` | 14.2 |
| `oracleIRParserParseOracleTextToIR.ts` | 27.7 |
| `oracleIRParserParseOracleTextToIRLatePasses.ts` | 18.3 |

`parseAbilityToIRAbility` takes `parseOracleTextToIR` as a parameter so the ability module
does not import the public parent (choose-mode recursion). Closures became exported
functions that take `clauses` as the first argument; the parent wrappers were then deleted
once the pipeline moved out.

## `oracleIRParser.ts` encoding notes (historical)

Next parent was going to be `rules-engine/src/oracleIRParser.ts` (865.2 KB). It cannot be brought
near the ceiling by moving code, because **87% of the file is not code**.

```powershell
node tools/_tmp-chatB-mojibake-scan.mjs rules-engine/src/oracleIRParser.ts
```

| Measure | Value |
| --- | --- |
| File | 885,979 B (865.2 KB) |
| Mojibake | 770,737 B (752.7 KB) — **87.0%** |
| Lines carrying it | 26 |
| Distinct corrupted seeds | 1 dominant seed, 2,026 chars, repeated 166× |
| Placement | 167 runs inside regex character classes, 4 in comments, 2 elsewhere |

The seed sits exactly where a right single quote belongs — contexts read
`^if you don[<RUN>']t` and `(?:'s|[<RUN>]s)`. It is one apostrophe that has been through many
rounds of CP1252/UTF-8 mis-decoding, each round re-encoding the previous round's output, so a
single character now occupies 2,026. Some rounds were already lossy (the runs contain U+FFFD), so
the damage cannot be *decoded* back — only rewritten.

This is isolated to this one file. Every other megafile in the repo scans at 0.0% mojibake
(`applyEvent.ts`, `resolution.ts`, `triggered-abilities.ts`, `intervening-if.ts`,
`oracleIRExecutorBattlefieldStepHandlers.ts`, `ai.ts`, `interaction.ts`, `game-actions.ts`,
`oracleIRExecutorZoneOps.ts`). It is committed at HEAD (blob 883,709 B), so it predates this
campaign — no session in this chat introduced it.

Structure underneath the damage (`node tools/_tmp-chatB-toc.mjs`):

| Range | Decl | Size | Clean size |
| --- | --- | --- | --- |
| 499-1546 | `parseAbilityToIRAbility` | 808 KB | ~78 KB |
| 1684-2271 | `parseOracleTextToIR` | 31.5 KB | 31.5 KB |
| 273-448 | `parseEffectClauseToStep` | 6.1 KB | 6.1 KB |
| 1592-1683 | `mergeSplitChooseModeParsedAbilities` | 4.1 KB | 4.1 KB |

Almost all of `parseAbilityToIRAbility` is two closures — `tryParseImpulseExileTop` (608-1076,
437.9 KB) and `tryParseExileTopOnlyLegacy` (1078-1363, 377.7 KB) — and each is dominated by
~60 KB single-line regexes. **A single one of those lines is larger than the ceiling**, so no
arrangement of extracts puts these siblings under 40 KB. Even after moving both closures out, the
parent would still be ~70 KB, ~63 KB of which is mojibake.

Option 1 (repair the literals, then extract) is what this chat did. See the section above.

## Verification recipe used after every cluster

```powershell
cd D:\Git\MTGEDH\rules-engine
npx tsc -p tsconfig.typecheck.json --noEmit > ..\tools\_tmp-chatB-tsc.txt 2>&1
Select-String -Path ..\tools\_tmp-chatB-tsc.txt -Pattern "^\.\./server" -NotMatch
npx vitest run test/oracleIRParser.test.ts test/oracleIRCurrentBatch.test.ts
```

The shared `tsconfig.typecheck.json` also compiles `server/`, which other chats are editing
live, so filter out `../server` lines — only `src/...` errors belong to this chat.

Likewise the full rules-engine suite is **not** a usable signal right now: at 03:58 it reported
10 failures, all in `test/oracleIRExecutor.test.ts` and all `move_zone` / exile / `search_library`
cases, matching another chat's in-flight split of `oracleIRExecutorMoveZoneStepHandlers.ts`.
`test/oracleIRParser.test.ts` (1002 tests) and `test/oracleIRCurrentBatch.test.ts` (84 tests) have
passed after every cluster in this chat.
