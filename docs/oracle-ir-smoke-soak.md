# Oracle IR smoke / soak framework

**Last updated:** 2026-08-12  
**Audience:** Anyone adding a targeted card soak after an IR batch (new step kind, choice UX, cost rider, etc.)

**Related:** [oracle-ir-track-e-remaining-work.md](./oracle-ir-track-e-remaining-work.md) (D2 telemetry, live-readiness) · [oracle-ir-architecture-guide.md](./oracle-ir-architecture-guide.md) (parse → execute → server) · `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`

---

## 1. What this is

A **small-list smoke harness** for Oracle IR. You name ≤30 EDH cards per soak, the runner looks them up in local oracle, parses/collects IR, optionally applies Layer 3 (`applyOracleIRStepsOnServer` / Effect Program), records **expected vs actual**, and correlates with **gap telemetry**.

With **`--live`**, it also talks to the **running game server**: create a commander table, seat AI opponents, import a soak deck, free-cast each listed card, and assert the live resolution queue + D2 telemetry.

The default (no `--live`) is **in-process**. It calls the same server IR modules the live process uses but does **not** join an open match. `GET /api/oracle-ir/telemetry` is still fetched before/after for correlation.

Use this after a Layer 1–3 batch when you have a **known card list** and want a fast pass/fail plus a JSON report, not a 47k-card audit.

---

## 2. How a run works

```
CLI --suite <id> [--live]
  → enable ORACLE_IR_*_PRIMARY=1
  → reset in-process gap telemetry
  → GET live /api/oracle-ir/telemetry (before)
  → suite.run()                         # in-process parse / apply / EP
  → if --live:
       POST /api/oracle-ir/live-soak/session   # create game + AI + decks
       POST /api/oracle-ir/live-soak/cast      # per card, free-cast on that table
       POST /api/oracle-ir/live-soak/end
  → GET live telemetry (after)
  → write report JSON + print PASS/FAIL
```

`soakCard(name, fn)` is the unit of work:

1. Lookup oracle (accent-folded fallback, e.g. Círdan).
2. Collect IR (`spellSteps` = spell-resolution only; `allSteps` includes triggered/static).
3. Run your checks via `result.checks.push(check(id, expected, actual, pass))`.
4. Attach any telemetry events emitted during that card.
5. Fail the card if lookup missed, any check failed, or telemetry was not clean.

A **suite** is a list of soaks (sessions). A **soak** is one table setup (modal night, votes, combat, …). Keep soaks split when setup differs (4-player votes vs live combat vs Spree-at-cast).

---

## 3. Layout

| Path | Role |
|------|------|
| `server/scripts/soak/oracleIrSmokeHelpers.ts` | Pure helpers: `check`, IR walkers (`kindsOf` / `hasKind` / `findStep`), CLI arg parse. No game imports — unit-tested. |
| `server/scripts/soak/oracleIrSmokeCore.ts` | Lookup, `makeGame`, `applySteps`, `startEp`, `soakCard`, live telemetry fetch, report writer |
| `server/scripts/soak/oracleIrSmokeCli.ts` | `--list` / `--suite` / `--url` / `--out` / `--live` |
| `server/src/oracleIrLiveSoak.ts` | Live-table driver + localhost HTTP API (`/api/oracle-ir/live-soak/*`) |
| `server/scripts/soak/oracleIrLiveSmoke.ts` | CLI HTTP client for `--live` |
| `server/scripts/soak/suites/<name>.ts` | One suite’s card lists and assertions |
| `server/scripts/soak/suites/index.ts` | Registry (`SMOKE_SUITES`) |
| `server/scripts/oracle-ir-edh-readiness-soak.ts` | Thin wrapper that defaults `--suite edh-readiness` |
| `server/tests/oracle-ir-smoke-framework.unit.test.ts` | Helper + CLI-arg tests |
| `server/tests/oracle-ir-live-soak.driver.unit.test.ts` | Live-table driver (create game, AI, deck, free-cast Opt) |
| `server/scripts/out/<id>-soak-report.json` | Expected vs actual + telemetry correlation |
| `server/scripts/out/<id>-soak-telemetry.json` | In-process D2 snapshot |

---

## 4. Commands

From `server/`:

```powershell
npm run oracle-ir:smoke -- --list
npm run oracle-ir:smoke -- --suite edh-readiness
npm run oracle-ir:smoke -- --suite edh-readiness --url http://127.0.0.1:3001/api/oracle-ir/telemetry
npm run oracle-ir:smoke -- --suite edh-readiness --live
npm run oracle-ir:smoke:live
npm run oracle-ir:edh-readiness:soak
```

| Flag | Meaning |
|------|---------|
| `--list` | Print registered suite ids |
| `--suite <id>` | Run that suite |
| `--live` | After the in-process soak, create a real table on the running server (AI + decks + free-cast) |
| `--url <telemetry>` | Live D2 endpoint (default `http://127.0.0.1:$PORT/api/oracle-ir/telemetry`) |
| `--out <dir>` | Report directory (default `server/scripts/out`) |
| `--help` | Usage + suite list |

Exit code **1** if any in-process or live-table check failed. `--live` also fails if the server is unreachable. Live telemetry unreachable does **not** fail an in-process-only run unless you pass `requireLiveTelemetry` in `runSmokeSuite` options.

`--live` requires `npm run dev` / `start` on the same host. It does **not** attach to a human-played match already in progress; it creates a dedicated `live-soak-*` game and deletes it at the end.

---

## 5. Built-in suite: `edh-readiness`

Shipped as the first suite. Eight soaks, ~51 cards, split by table setup:

| Session | Soak id | What it proves |
|---------|---------|----------------|
| A — Modal night | `season_p` | Season `{P}`: `choose_mode` + `pBudget` / repeats; Effect Program `MODE_SELECTION` carries budget |
| A | `choose_mode` | Urza / Austere / Cryptic / Brokers: count-based modes, no outer duplication |
| B — Votes | `vote` | Council / secret / dilemma / ETB votes; APNAP `VOTE` queue |
| C — Modes-at-cast | `spree_tiered` | Selected Spree/Tiered modes only (no over-execution) |
| D — Combat end | `end_combat_phase` | Mandate of Peace clears combat + stack → postcombat main; extra-combat setup cards parse `add_extra_combat` |
| E — Choices/costs | `cast_cost_riders` | Delirium / Void / Vivid `calculateCostReduction` off vs on |
| E | `compound_resume` | Opt / Consider / Preordain / unless / discard halt + continuation |
| F — Static smoke | `spell_static` | Instant/sorcery effects typed SPELL; exile + follow-up (Path / Swords / Brave) |

Do not merge B (multiplayer votes) or D (live combat board) into modal/Spree soaks.

---

## 6. Adding a suite

1. Create `server/scripts/soak/suites/<name>.ts` exporting a `SoakSuite`:

```ts
import {
  check,
  soakCard,
  makeGame,
  applySteps,
  startEp,
  finishSoak,
  kindsOf,
  hasKind,
  unknownRaws,
  type SoakSuite,
} from '../oracleIrSmokeCore.js';

export const mySuite: SoakSuite = {
  id: 'my-batch',
  title: 'My IR batch smoke',
  description: 'Short operator blurb',
  live: {
    my_soak: { playerCount: 2, setup: 'main', expectAnyQueue: ['scry'] },
  },
  run: () => [
    finishSoak('my_soak', 'Session label', 'Human title', [
      soakCard('Opt', (_card, collected, result) => {
        result.checks.push(
          check('has_scry', true, kindsOf(collected.spellSteps), hasKind(collected.spellSteps, 'scry')),
        );
        result.checks.push(
          check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0),
        );
      }),
    ]),
  ],
};
```

2. Register it in `server/scripts/soak/suites/index.ts` (`SMOKE_SUITES` array).

3. Run `npm run oracle-ir:smoke -- --suite my-batch` (add `--live` when the server is up).

Optional `live` map (keyed by soak id): `playerCount`, `setup` (`main` / `combat` / `vote_board`), `expectAnyQueue`, `expectPBudget`, `perCard`. Without it, `--live` still creates a 2-player table and asserts the card left hand / queued / stacked plus `live_telemetry_clean`.

### Helpers to reuse

| Helper | Use |
|--------|-----|
| `soakCard(name, fn)` | Lookup + collect + telemetry_clean wrapper |
| `check(id, expected, actual, pass, note?)` | One expected-vs-actual row |
| `collectFor` / `lookupCard` | Already inside `soakCard`; call directly if needed |
| `makeGame(gameId, playerCount)` | Synthetic commander table, libraries seeded |
| `applySteps(game, name, steps)` | `applyOracleIRStepsOnServer` with halt-on-choice |
| `startEp(game, name, steps)` | Effect Program (modal `choose_mode`, etc.) |
| `queueTypes(gameId)` | Resolution queue step types (`vote`, `scry`, `mode_selection`, …) |
| `kindsOf` / `hasKind` / `findStep` / `unknownRaws` | IR inspection (walks nested modes / then / else) |
| `scopedOmitsOtherEffects` | Spree/Tiered: scoped oracle must not include other mode **full lines** |
| `hasVoteTail` | Vote soaks: a non-vote follow-on exists |

### Card-list rules

- **Under ~30 cards per soak** so the run stays fast and failures stay readable.
- **Split by setup**, not by set name: votes need 3–4 players; combat needs attackers on the battlefield; Spree needs mode scoping, not a full cast payment UI.
- **Look up oracle locally** (`lookupLocalCardByNameSync` / `oracle-cards.jsonl`). Do not hardcode stale oracle text.
- **No bespoke card-name handlers** in production code to make a soak green. Extend generic IR (parser step, executor, server queue) instead. See `.cursor/rules/oracle-ir-no-bespoke-handlers.mdc`.

---

## 7. Reading a report

`server/scripts/out/<suite-id>-soak-report.json`:

| Field | Meaning |
|-------|---------|
| `summary` | Soaks / cards / checks passed vs failed |
| `soaks[].cards[].checks` | Each `id` with `expected`, `actual`, `pass` |
| `soaks[].cards[].spellStepKinds` / `allStepKinds` | Parsed IR for debugging |
| `soakTelemetry` | In-process D2 snapshot (`totalEvents` should be **0** on a clean IR-primary soak) |
| `liveServer.before` / `after` | Running server’s telemetry; unchanged unless a live table fired gaps |
| `liveTable` | Present when `--live`: per-card live queue / telemetry checks |

Console output is the same data, one line per card (`ok` / `!!` + failed check ids).

A **clean** soak: every card `pass: true`, `telemetry_clean` actual `[]`, in-process `totalEvents: 0`. If a check fails, fix IR (or the assertion if it was too strict — e.g. Path uses `exile` not `move_zone`). If `telemetry_clean` fails, the card hit `all_or_nothing_failure`, `owned_but_unhandled`, or `legacy_handled` — that is a real primary-path gap.

---

## 8. Telemetry vs live server

| Source | When it fills |
|--------|----------------|
| In-process snapshot | Any gap recorded while `soakCard` / apply / EP ran in this Node process |
| `GET /api/oracle-ir/telemetry` | Only the **running server** (`npm run dev` / `start`). Restarting that process zeros it. |
| `--live` table | Casts go through `requestCastSpellForSocket` **in the running process**, so D2 counters move |

The smoke runner always **reads** the live endpoint. Without `--live` it does not write into that process. After a server restart you should see live `totalEvents: 0` even when the in-process soak is green.

`--live` creates a commander table on that process (1 human soak driver + AI seats), imports a constructed deck (Kenrith + listed cards + Islands), skips lobby/mulligan, and free-casts each card (`castWithoutPayingManaCost` + `ignoreTimingRestrictions`) with a board setup (`main` / `combat` / `vote_board`). Before each cast, `provisionSpellCastBoardContext` fills the same gaps the AI uses to skip no-op spells (creature/permanent/stack targets, Windfall-style empty hands, combat for fog). Battlefield creatures are always `Creature — Bear`, never a land fallback. Target and mana-payment steps are auto-completed so `seenQueueTypes` still records `target_selection`. AI auto-play is paused on those tables (`state.oracleIrLiveSoak`) so the driver is not racing 300ms AI timers. Endpoints are **localhost-only**:

- `POST /api/oracle-ir/live-soak/session`
- `POST /api/oracle-ir/live-soak/cast`
- `POST /api/oracle-ir/live-soak/end`

This is still not a substitute for playing a real multiplayer game (mana, targeting UX, client modals). It is the scripted way to make live D2 telemetry move for a known card list.

D2 event kinds (see `oracleIrGapTelemetry.ts`):

- `all_or_nothing_failure` — IR started and failed the mandatory-step gate
- `owned_but_unhandled` — IR primary owns the text but did not handle it (silent no-op risk)
- `legacy_handled` — a legacy handler ran while IR primary is on (retirement triage)

---

## 9. What this is not a substitute for

| Need | Use instead |
|------|-------------|
| Corpus / overlay gaps on a new set | `npm run oracle-ir:delta` |
| Single-card overlay probe | `npm run oracle-ir:overlay:probe -- --name "Card"` |
| Full Layer 3 regression bar | `npm run test:oracle-ir-migration` |
| Legacy export ratchet / forced-legacy | `oracle-ir:legacy-triage:soak` / `:forced` |
| Proof a **new choice UI** works in the client | Socket integration test + client unit test |
| Real multiplayer timing / combat | Play the listed cards on a live table, then re-fetch telemetry |
| Scripted live table for a known list | `npm run oracle-ir:smoke -- --suite edh-readiness --live` (server must be running) |

After a new-set workflow (track-e §A), step 7 is still “live EDH soak.” This framework is the **scripted short list** you can run in the same session; live tables remain the long soak.

---

## 10. Example: Layer 3 apply inside a soak

```ts
const gameId = `soak-opt-${slug('Opt')}`;
const { game } = makeGame(gameId, 2);
const applied = applySteps(game, 'Opt', collected.spellSteps);
result.checks.push(
  check('queued_scry', 'scry', queueTypes(gameId), queueTypes(gameId).includes('scry')),
);
```

`makeGame` starts in precombat main with 8 library cards per player. Mutate `game.state` first when the effect needs a board (combat, graveyard types, opponent permanents for Council's Judgment, hand for discard).
