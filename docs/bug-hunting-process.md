# Bug-hunting process

This is the current loop for finding and fixing *runtime* Magic rules bugs in MTGEDH, now that the Oracle IR census is at 100% coverage. It is written for humans and for future agents. Update this page when the process changes.

Official code lives in the repo. Scratch probes, triage helpers, and patch checkers currently live under `D:\tmp\mtgpatch\` on the Windows dev machine and can be promoted into `server/scripts/` later. Robert commits; agents should not.

All commands below are from `server/` unless noted. The workspace name is `@mtgedh/server`, so the same scripts also run from the repo root as `npm --workspace @mtgedh/server run <script> -- …`.

## 1. Why 100% census coverage is not “correct”

The census answers “does a parser or registry *claim* this line?” It does not answer “does the card do the right thing in a game?”

- Statics and replacements: `npm run census:statics` (`server/scripts/static-replacement-census.ts`). It writes `docs/static-replacement-census.md` and `server/scripts/out/static-replacement-census.json`. A line is declarative-handled when `parseStaticEffectSpecsFromOraclePermanent` or `collectReplacementEffectSpecsFromState` returns a spec. Lines owned by another subsystem (cost modifiers, ETB-tapped, and so on) are “elsewhere,” not gaps. Remaining lines are `owned_but_unhandled`.
- Triggers: `npm run census:triggers` (`server/scripts/trigger-ir-census.ts`). It writes `docs/trigger-ir-census.md` and `server/scripts/out/trigger-ir-census.json`. A clause counts as IR when `parseTriggerClause` returns a condition and an effect; otherwise it is a legacy fallback.
- Both use `server/scripts/census-card-filter.ts`: Commander-legal cards by default. Pass `--include-upcoming` to also count unreleased paper cards (writes `*-upcoming.json` and leaves `docs/` alone).

As of the last documented census run (16 Nov 2026, UTC), statics/replacements were `10828` candidate lines, `3237` handled, `7591` elsewhere, `0` unhandled (`0` static | `0` replacement). Triggers were `14359 / 14359` IR (`0` legacy fallback). Console shape: `lines=10828 handled=3237 elsewhere=7591 unhandled=0 (static=0 replacement=0)`.

Runtime failures still happen because:

- Execution paths are different from parse coverage (wrong targets, costs paid in the wrong order, last-known information, X, modes, divided damage).
- Hook and handler `catch` blocks used to swallow errors (empty, log-only, or return-a-fallback), so a throw looked like a no-op. That is what the hook-failure tripwire is for.
- This repo’s server, rules-engine, and shared packages are ESM. A `require()` / `createRequire()` call throws at runtime and was easy to hide inside a swallowed catch (the 15 Nov 2026 breakage). `npm run lint` at the repo root runs `lint:require` (`node tools/ban-cjs-require.mjs`) and fails on those calls. Use static `import` only.

## 2. Hook-failure tripwire

Implementation: `shared/src/hookFailureReporter.ts`. Server code and tests should import the re-export `server/src/utils/hookFailureReporter.ts`. Rules-engine hooks import the shared module directly so they stay free of a server dependency; both share the same in-memory ring (capacity 200).

Public API: `reportHookFailure(tag, err, ctx?)`, `getHookFailures`, `getHookFailureCounts`, `resetHookFailures`, `formatHookFailuresForAssert`, `isStrictHooksEnabled`, `STRICT_HOOKS_ENV` (`MTGEDH_STRICT_HOOKS`).

When a catch used to swallow, call the reporter *before* the existing fallback, then keep the fallback:

```ts
} catch (err) {
  reportHookFailure('cast.modalModeTargetAvailability', err, {
    source: 'castModalModeTargetAvailability',
    cardName,
  });
  return modalSpellInfo;
}
```

Production gameplay is unchanged when `MTGEDH_STRICT_HOOKS` is unset: the failure is logged as `[hook-failure] tag=…` and recorded. Set `MTGEDH_STRICT_HOOKS` to `1`, `true`, `yes`, or `on` to rethrow after recording.

Checks already wired:

- Vitest: `server/tests/vitest.setup.ts` resets the ring in `beforeEach` and, in `afterEach`, fails the test if any failures were recorded. Bypass with `MTGEDH_SKIP_HOOK_FAILURE_CHECK=1` (the outcome-sweep integration test does this because the sweep classifies hook failures itself as `throw`).
- AI self-play (`npm run ai:selfplay`, `server/tests/ai-selfplay.harness.test.ts`): each game row includes `hookFailures`, and the harness asserts that list is empty.
- Oracle IR smoke (`npm run oracle-ir:smoke`, `server/scripts/soak/oracleIrSmokeCore.ts`): writes `hookFailures` into the report and sets `process.exitCode = 1` if any were recorded.
- Outcome sweep: a hook failure on a card is a `throw` with detail `hook_failure:<tag>`.

Finding sites still to convert: the scratch scanner `D:\tmp\mtgpatch\inventory_swallowed_catches.cjs` walks `server/src` and `rules-engine/src` and writes `D:\tmp\mtgpatch\swallowed_catches.txt`. A 25 Nov 2026 1:35 PM America/New_York run reported `2493` catches scanned and `2159` swallowed (empty / log-only / return-only / log-and-return / small-fallback / commented-ignore). That file is a snapshot; regenerate it after a conversion pass. Convert live hook paths first, keep the fallback, use a stable dotted tag, and add a test that goes through the live hook, not only a helper.

## 3. Per-card outcome sweep

Code: `server/scripts/outcome-sweep/`. npm script: `sweep:outcomes`.

The sweep drives each selected Commander-legal oracle card through the real socket paths on a **minimal 2-player main-phase board** (mana, a legal target of common kinds, cards in hand / library / graveyard). For each card it attempts:

- Cast or play (lands use `playLand`; faced cards such as MDFC/split/adventure send `faceIndex: 0`).
- ETB trigger, if the text has one.
- Up to six battlefield activated abilities.
- Dies trigger, if present.
- Zone abilities from the correct zone (cycling via `activateCycling`; unearth / embalm / eternalize / scavenge / encore and some graveyard-activated lines via `activateGraveyardAbility`). Channel, ninjutsu, transmute, and similar hand abilities are recorded as skipped.

It classifies every **phase**, then the card gets the worst phase class (`throw` > `stuck` > `noop` > `ok` > `skipped`):

| Class | Meaning |
| --- | --- |
| `ok` | Observable state change, or a resolution-time prompt appeared. |
| `noop` | The action finished with no meaningful change (`no_state_change`). |
| `throw` | Exception, error log, hook failure, or a socket error (for example `rejected:NO_VALID_TARGETS`). |
| `stuck` | A prompt or the stack could not be resolved, the card timed out, or a worker hung. |
| `skipped` | The minimal board cannot exercise it (reason in `detail`). |

`prompt_only` is **not** a top-level class. It is an `ok` *detail* when the only evidence is a resolution prompt. `ai_builder_rejected:<stepType>:…` is a *note*: the AI resolution builder’s answer was rejected and retried with a human-style answer. That is an AI-builder bug, not automatically a card failure; `summary.txt` lists these separately.

Harness artifacts to discount before treating a failure as an engine bug:

- The bare board is missing a resource (sacrifice fodder, counters, energy, a tribal or stack target, an Aura enchant target, something already tapped).
- Effects that scale with X can look like no-ops when X resolves as 0. Activated `{X}` costs are supposed to send `xValue: 1` (`activationXValue` in `sweepZoneAbilities.ts`); the 25 Nov 2026 `full_1125` run still had `122` `X_VALUE_REQUIRED` throws, triaged as the driver not sending X on those abilities, plus a smaller set of X spells stuck at `x_value_selection`.
- “Turned face up” lines misdetected as ETB; combat / upkeep triggers listed under untested kinds and not driven; stack-only targets skipped as `needs_stack_target`.

```bash
# Hash-mixed 500-card sample (typical pre-merge check)
npm run sweep:outcomes -- --sample 500 --out D:/tmp/mtgpatch/outcome-sweep/sample500

# Full run, resumable, four workers
npm run sweep:outcomes -- --chunk 200 --workers 4 --out D:/tmp/mtgpatch/outcome-sweep/full_1125
npm run sweep:outcomes -- --chunk 200 --workers 4 --resume --out D:/tmp/mtgpatch/outcome-sweep/full_1125

# Named cards. --name is a substring match unless --exact is set.
# Comma-separated, or `|` when a name itself contains a comma.
npm run sweep:outcomes -- --name "lightning bolt,llanowar elves" --exact
npm run sweep:outcomes -- --name "Kai Winn, Faithless Leader|Opt" --exact

# Rebuild reports from existing JSONL, optionally diff two runs
npm run sweep:outcomes -- --report-only --out D:/tmp/mtgpatch/outcome-sweep/full_1125
npm run sweep:outcomes -- --report-only --out D:/tmp/mtgpatch/outcome-sweep/new_run --compare D:/tmp/mtgpatch/outcome-sweep/full_1125
```

Flags (from `sweepSelect.ts` / the CLI header): `--limit N`, `--offset N`, `--set a,b`, `--name x,y` (`--exact`), `--sample N`, `--chunk N` (default 200), `--workers K` (default 1, max 8), `--timeout MS` (per card, default 20000), `--resume`, `--report-only`, `--out DIR`, `--verbose`, `--compare PREV_DIR`. `--include-upcoming` is honored the same way as the census (`process.argv`, via `includeCardInCensus`), even though it is not stored on the parsed `SweepArgs` object. Default `--out` is `server/scripts/out/outcome-sweep`, or `$env:OUTCOME_SWEEP_DIR`. The process uses an in-memory game DB (`sweepEnv.ts`); nothing is written except the output directory. Set `OUTCOME_SWEEP_RAW_WEAK=1` to keep unfiltered weak snapshot keys on each phase for debugging.

Official outputs in `--out`:

- `results.<worker>.jsonl` — one JSON object per card
- `summary.txt` / `summary.json` — class counts, failure kinds, oracle-pattern families, telemetry on failures, weak-only oks, skipped reasons, untested trigger kinds, AI-builder rejections
- `failures.json` — cards whose class is `noop`, `throw`, or `stuck`
- `cards.json` — the selection; `run-meta.json` — argv, elapsed ms, finish time
- With `--compare`: `compare.txt` / `compare.json`

`triage.md` and `ai_builder_bugs.md` are **not** written by the official reporter. After `full_1125` they were produced under that output directory with the scratch helpers in §5, plus manual review.

`--compare` groups (failing means `noop` / `throw` / `stuck`):

- `newly_ok` — failing before, `ok` now
- `newly_broken` — `ok` or `skipped` before, failing now (treat as a regression)
- `changed_failure` — still failing, but class or detail changed
- `unchanged_failure` — same class and detail
- `newly_skipped` — failing before, `skipped` now (often a harness change, not a fix)
- `only_prev` / `only_cur` — card present in only one run

There is a unit/integration test at `server/tests/outcome-sweep.integration.test.ts`.

## 4. Single-card probes

For a faster before/after on a handful of names, scratch probes in `D:\tmp\mtgpatch\` call the same `sweepOneCard` driver. They are not in the repo yet and could be promoted next to the official sweep.

```bash
# From a directory where tsx resolves (repo root or server/)
node --import tsx/esm D:\tmp\mtgpatch\osweep_probe2.mts "Lightning Bolt,Llanowar Elves"
node --import tsx/esm D:\tmp\mtgpatch\osweep_probe3.mts "Kai Winn, Faithless Leader|Opt"
```

`osweep_probe2.mts` prints class, phase diffs, prompts, notes, errors, and telemetry. `osweep_probe3.mts` also prints emitted socket `error` payloads (`code: message`); set `PROBE_STEPS=1` to include resolution-step outlines. Later variants (`osweep_probe4.mts` … `osweep_probe7.mts`, `osweep_probe_list.mts`) dump a pending step, filter step JSON (`PROBE_DUMP`, `PROBE_FULL`, `PROBE_CHAT`), or probe a file of names using `|` as the `--name` separator.

The probes join leftover CLI args into one `--name` string and pass `--exact`, so they inherit the official comma-vs-`|` rule: use `|` whenever a card name contains a comma.

## 5. Triage

Do not fix failures one card at a time. Group by root cause, rank by card count, and separate engine bugs from AI-builder bugs and harness artifacts.

1. Read `summary.txt`: class totals, then “Failure kinds” and “Noop / Throw / Stuck families (phase:oracle family).”
2. Skim `failures.json` or the JSONL for a family. Oracle families come from `sweepFamilies.ts` (`damage`, `sacrifice`, `fight`, `search_library`, …).
3. Scratch helpers (promote later if they stay useful):
   - `node D:\tmp\mtgpatch\osweep_triage_extract.mjs <outDir>` — heuristic split (`engine:…` vs `artifact:…` vs `probe`).
   - `node D:\tmp\mtgpatch\osweep_triage_families.mjs <outDir>` — counts named engine-candidate families (self-sacrifice-then-target, LKI dies triggers, divided damage, fight noops, X stuck, and so on).
   - `node D:\tmp\mtgpatch\osweep_ai_rejects.mjs <outDir>` — groups `INVALID_SELECTION` / `STEP_MANDATORY` by step type (feeds `ai_builder_bugs.md`).
4. Spot-check about ten cards per top family with a probe and the oracle text before declaring the family “real.”

Typical splits:

- **Engine** — hook failures, exceptions, self-sacrifice paid before targets (`PERMANENT_NOT_FOUND`), LKI (“its power”) noops, silent noops that also record Oracle IR telemetry (`all_or_nothing` / `owned_but_unhandled`), wrong target filters, missing cost support.
- **AI builder** — `ai_builder_rejected` notes, or `INVALID_SELECTION` / `STEP_MANDATORY` after a bad builder answer (card names, tap targets, Phyrexian mana, split searches, counter distribution). These builders are shared with self-play.
- **Harness / board** — missing resources, Aura with no enchant target, conditional text (kicker, raid, metalcraft) on a board that does not meet the condition, X = 0, untested trigger kinds, zone abilities the board still cannot pay.

## 6. Fix workflow

Work in parallel lanes on **non-overlapping files**: cast / targeting, activation costs, IR effects, AI builder, and UI (UI reuses existing elements; give it its own worker). Prefer a generic oracle-pattern fix that covers the family, not a one-card special case (see `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`).

Constraints that have already bitten this repo:

- TypeScript logic files must stay under **40960 bytes** on disk. Split into a new module with a descriptive name rather than growing a large file. Measure with `node tools/ts-logic-file-sizes.mjs` from the repo root. See `.cursor/rules/typescript-max-40kb-split.mdc`.
- ESM only: static `import`, never `require()`. Run `npm run lint` from the repo root before claiming a hook change is done.
- Tests must exercise the **live** hook or socket path, not only a helper.
- On the Windows checkout, agent edits go through node `.cjs` patch scripts under `D:\tmp\mtgpatch\`, delivered byte-exact (for example `[IO.File]::WriteAllBytes` from base64). After each edit, re-read the changed lines plus neighbors (`.cursor/rules/verify-edited-lines.mdc`) and run `node D:\tmp\mtgpatch\b36_check.cjs <repo-relative path>…` (flags BOM, literal `` `r`n ``, mojibake, and files over 40KB).
- Typecheck the workspace you touched (`npm run typecheck --workspace=server`, plus `shared` / `rules-engine` / `client` when those change). Run targeted Vitest **one file at a time** (`npx vitest run tests/<file>.test.ts --pool=threads --maxWorkers=1` from `server/`). Concurrent Vitest runs have caused false failures.
- Never kill Robert’s `ai-selfplay` harness or the dev servers. The usual `npm run dev` server is `dev:noreload` on port 3001; it will not pick up fixes until that process is restarted.

## 7. Validation loop

For a family of fixes:

1. **Probe before and after** the named cards (`osweep_probe2` / `osweep_probe3`, or `npm run sweep:outcomes -- --name … --exact`).
2. **Sample of 500** and compare to the previous sample directory, for example:
   `npm run sweep:outcomes -- --sample 500 --out D:/tmp/mtgpatch/outcome-sweep/sample500_after --compare D:/tmp/mtgpatch/outcome-sweep/sample500_before`
   `newly_broken` must be `0`. Read `newly_ok`, `changed_failure`, and `unchanged_failure` in `compare.txt`.
3. **Two-game self-play** with the hook assertion on (do not set `MTGEDH_SKIP_HOOK_FAILURE_CHECK`). In PowerShell, from `server/`:

   ```powershell
   $env:AI_SELFPLAY_GAMES = '2'
   npm run ai:selfplay
   ```

   The harness is skipped unless `AI_SELFPLAY_GAMES` is set. It asserts `hookFailures: []` on every game. Useful env: `AI_SELFPLAY_SEED`, `AI_SELFPLAY_OUT`, `AI_SELFPLAY_MAX_TURNS` (default 60), `AI_SELFPLAY_CHALLENGER` / `AI_SELFPLAY_BASELINE` (default `v0`).
4. **Full sweep** into a new `--out` directory, `--compare` against the previous baseline (currently `D:\tmp\mtgpatch\outcome-sweep\full_1125`). Use `--resume` if a worker is interrupted.
5. **Robert commits** once the compare and self-play look good. Do not commit or push from an agent session unless he asks.

## 8. Current baseline (`full_1125`)

Directory: `D:\tmp\mtgpatch\outcome-sweep\full_1125\`.

Command: `npm run sweep:outcomes -- --chunk 200 --workers 4 --out D:/tmp/mtgpatch/outcome-sweep/full_1125`.

Finished 25 Nov 2026, 3:08 PM America/New_York (`run-meta.json` `finishedAt` `2026-11-25T20:07:59.426Z`, elapsed `2598586` ms, about 43 minutes, 260 ms/card). **32,643** cards: **ok 27,221 · noop 2,983 · throw 2,012 · stuck 58 · skipped 369**. Hook failures recorded on that run: **none**. Post-pass notes from the same afternoon: `triage.md` (family ranking and artifact-vs-engine estimates) and `ai_builder_bugs.md`.

A later 500-card compare the same day (`sample500_before` → `sample500_after`, compare written 3:28 PM America/New_York) had `newly_ok=13`, `newly_broken=0`, `changed_failure=7`, `unchanged_failure=60`.

When you finish a full rerun, point this section at the new directory and keep `full_1125` as the previous `--compare` baseline until Robert says otherwise.
