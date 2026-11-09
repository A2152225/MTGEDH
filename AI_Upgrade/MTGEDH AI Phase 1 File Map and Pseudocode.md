# MTGEDH AI: Phase 1 File Map and Pseudocode

Nov 3, 2026 · @Bobby

## How the pieces link

&#91;embedded content: data flow · 2 offline runs, 1 live hook\]

Read it from the bottom up. The self-play runs and the card oracle produce two data files, the fitted weights and the card profiles. During a game, `applyBrain` builds an Observation, asks `rankCandidates` for scores (which reads both files), and hands the main loop either the same list (shadow) or a reordered one (v1). The trace file and the shadow report hang off `applyBrain` and are not drawn.

## What Phase 1 takes from Phase 0

Phase 1 builds on five Phase 0 pieces, and every one of them is imported by name, so the Phase 0 PRs must land with these exact exports. Paths are the ones in the [Phase 0-2 plan](https://claude.ai/artifact/W3oPMPH8DnrCSqftG6eVC3).

| Phase 0 piece | File | What Phase 1 imports | Used by |
| --- | --- | --- | --- |
| P0-1 Observation | `rules-engine/src/ai/observation.ts`, `buildObservation.ts` | the `Observation`, `CardView`, `PermanentView` types and `buildObservation(state, seat)` | P1-1, P1-2, P1-5 |
| P0-3 seeded randomness | `rules-engine/src/aiRandom.ts` | nothing in code; Phase 1 must not call `Math.random()` or `aiRandom()` | P1-5 (a rule, not an import) |
| P0-3 self-play harness | `server/tests/helpers/liveGameHarness.ts`, `preconPool.ts`, `ai-selfplay.harness.test.ts` | the game runner, and the per-seat settings object that P1-5 adds a `brain` to | P1-2, P1-5, P1-6 |
| P0-4 decision trace | `server/src/socket/ai-handlers/aiDecisionTrace.ts` | `recordDecision(...)`, `setAIDecisionTraceSink(fn)`, and the `DecisionTrace` type | P1-5 |
| P0-5 puzzle suite | `server/tests/ai-puzzles/puzzleHarness.ts` | nothing imported: the suite runs under `AI_BRAIN`, and P1-6 adds a JSON results file (`AI_PUZZLE_OUT`) | P1-5, P1-6 |
| P0-6 reporting | `server/scripts/selfplay-report.ts`, `docs/ai-baseline-v0.md` | the JSONL result-line type and the interval code; the baseline numbers | P1-3, P1-6 |

**Two facts about the code that shape every Phase 1 file.**

- The server hands its whole game object to the rules engine as `gameState: game.state as any` (for example `aiPriorityHandlers.ts` line 413 and `aiActionCandidateHandlers.ts` line 318). So `buildObservation(state, seat)` takes `game.state` on the server side and `context.gameState` on the rules-engine side, with no conversion step between them.
- The server imports rules-engine files by relative path with a `.js` suffix (`../../../../rules-engine/src/AIEngine.js` from `ai-handlers/`), not by package name. Every new file in `rules-engine/src/ai/` is imported the same way from the server, and rules-engine files import shared types from `../../../shared/src`.

Phase 0 gives Phase 1 one name that does not exist yet in the plan's text: `recordDecision`, the function the trace hooks call. Section 12 lists it as a fix to make in the plan before P0-4 is written. The puzzle suite needs no new function: it is run under `AI_BRAIN`, and P1-6 adds a results file.

## File map at a glance

Every file Phase 1 creates or edits, in task order. All new decision logic is pure code under `rules-engine/src/ai/`; the only edits to existing server code are one hook in `enumerateAIActionCandidates`, one line in the trace hook and the harness. No file that v0 uses to decide (`AIEngine.ts`, `aiEngineCombatSupport.ts`, `aiEngineBlockPlanning.ts`) changes in Phase 1, which is what keeps v0 identical to the baseline.

| File | Status | Task | What it holds and what it connects to |
| --- | --- | --- | --- |
| `rules-engine/src/ai/evaluatorFeatures.ts` | new | P1-1 | `FeatureName`, `SeatFeatures`, `seatFeatures(obs)`. Reads the P0-1 Observation types. Imported by `evaluator.ts`, the harness position logger, `fit-evaluator.ts` and `utilityScorer.ts`. |
| `rules-engine/src/ai/evaluator.ts` | new | P1-1 | `EvalWeights`, `DEFAULT_WEIGHTS`, `getEvalWeights()`, `seatValues(features, weights)`. Imports the fitted weights file. Imported by `winProbability.ts` and `utilityScorer.ts`. |
| `rules-engine/src/ai/winProbability.ts` | new | P1-2 | `winProbabilities(values, eliminated, tau)`. Pure. Imported by the harness logger, `fit-evaluator.ts` and `utilityScorer.ts`. |
| `rules-engine/src/ai/evaluatorWeights.v1.ts` | new stub, then generated | P1-3 | `FITTED_WEIGHTS`, which is an `EvalWeights` object or `null` until the first fit. Written by `fit-evaluator.ts`, read by `evaluator.ts`. |
| `rules-engine/src/ai/cardProfileTypes.ts` | new | P1-4 | `CardRole` and `CardAIProfile`. They live here, not in server, because the scorer in rules-engine needs them. Re-exported by `aiCardProfile.ts`. |
| `rules-engine/src/ai/rolePolicies.ts` | new | P1-5 | One policy per role: a function from `ScoreContext` to a list of `Consideration`. Imported by `utilityScorer.ts`. |
| `rules-engine/src/ai/utilityScorer.ts` | new | P1-5 | `Consideration`, `ScoreContext`, `CandidateView`, `ScoredCandidate`, `rankCandidates`. Imports evaluator, winProbability, rolePolicies and cardProfileTypes. Imported by `aiBrain.ts`. |
| `rules-engine/src/index.ts` | edit | P1-1, P1-2, P1-5 | Export lines beside the P0-1 ones, in the existing `export * from './X'` style. |
| `rules-engine/test/fixtures/aiFixtures.ts` | new | P1-1 | Builders for `Observation`, `PermanentView` and matching `BattlefieldPermanent` objects, shared by the P1-1, P1-2 and P1-5 tests. |
| `rules-engine/test/aiEvaluator.test.ts` | new | P1-1 | Monotonicity tests, the ten-fixture parity test against `evaluatePermanentValue`, and the timing check. |
| `rules-engine/test/aiWinProbability.test.ts` | new | P1-2 | Sum to 1, equal values, monotonic, no NaN at a 500-point gap, eliminated seats. |
| `rules-engine/test/aiUtilityScorer.test.ts` | new | P1-5 | One fixture context per role policy, including a gate that blocks a high-scoring candidate. |
| `server/tests/helpers/liveGameHarness.ts` | edit | P1-2, P1-5 | Position logger on each turn change (`AI_POSITIONS_FILE`), and per-seat `player.aiBrain` from `AI_SELFPLAY_CHALLENGER`. Created in P0-3. |
| `server/scripts/fit-evaluator.ts` | new | P1-3 | Reads the positions JSONL and the P0-3 result JSONL, fits weights, writes `evaluatorWeights.v1.ts` and `docs/ai-evaluator-fit.md`. |
| `server/scripts/lib/conditionalLogit.ts` | new | P1-3 | `softmax`, `lossAndGrad`, `fit`, `logLoss`, `reliability`. Pure functions, imported by `fit-evaluator.ts` and its test. |
| `server/scripts/lib/selfplayRows.ts` | new | P1-3, P1-6 | `ResultRow`, JSONL readers that accept a glob, and `podOf(gameId)`. Imported by `fit-evaluator.ts` and `selfplay-report.ts`. |
| `server/scripts/generate-ai-card-profiles.ts` | new | P1-4 | Reads oracle cards, runs the IR and analyzer, applies overrides, writes `ai-card-profiles.json` and `docs/ai-card-profiles.md`. |
| `server/scripts/lib/cardProfileMapper.ts` | new | P1-4 | `mapCardToProfile`, `collectSteps`, `rolesForStep` and `legacyRoles`. Imported by the generator and `aiCardProfile.test.ts`. |
| `server/src/socket/ai-handlers/aiCardProfile.ts` | new | P1-4 | `getCardAIProfile(name)`: loads the profile JSON once, lazily, and indexes it by lower-cased name. Used by `aiBrain.ts`. |
| `server/data/ai-card-profiles.json` | generated | P1-4 | One `CardAIProfile` per commander-legal card, keyed by oracle id. |
| `server/data/ai-card-overrides.json` | new, hand-written | P1-4 | Per-card corrections keyed by card name; applied last by the generator. |
| `server/src/socket/ai-handlers/aiBrain.ts` | new | P1-5 | `Brain` type, `getSeatBrain`, `applyBrain(...)`, the shadow comparison and `takeShadow(...)`. Called from `enumerateAIActionCandidates`. |
| `server/src/socket/ai-handlers/aiActionCandidateHandlers.ts` | edit | P1-5 | One call to `applyBrain` just before the final `return candidates` of `enumerateAIActionCandidates` (the sort is at about line 443). |
| `server/src/socket/ai-handlers/aiDecisionTrace.ts` | edit | P1-5 | New optional `shadow` field on `DecisionTrace`. Created in P0-4. |
| `server/src/socket/ai-handlers/aiPriorityHandlers.ts` | edit | P1-5 | One line in the P0-4 trace hook: attach `takeShadow(candidates)` to the record. |
| `server/scripts/shadow-report.ts` | new | P1-5 | Reads the trace JSONL, prints the disagreement table and 30 sampled disagreements. |
| `server/tests/aiCardProfile.test.ts` | new | P1-4 | Disposal Mummy and Campfire have no removal role, override precedence, every role in the table has a fixture card. |
| `server/tests/aiBrain.test.ts` | new | P1-5 | `v0` leaves the order alone, `shadow` leaves it alone and fills the trace, `v1` reorders; the scorer never calls `aiRandom`. |
| `server/scripts/selfplay-report.ts` | edit | P1-6 | Adds win rate by brain and a Wilson plus pod-bootstrap interval for the challenger. Created in P0-6. |
| `server/tests/ai-puzzles/puzzleHarness.ts` | edit | P1-6 | Writes the results as JSON when `AI_PUZZLE_OUT` is set. Created in P0-5. |
| `server/tests/aiSelfplayReport.test.ts` | new | P1-6 | Wilson and pod-bootstrap intervals, challenger detection, and gate verdicts on synthetic result files. |
| `server/tests/aiConditionalLogit.test.ts` | new | P1-3 | Weight recovery on synthetic data, gradient check, agreement with `winProbabilities`, and the join and split rules. |
| `server/package.json` | edit | P1-3 to P1-5 | Scripts `ai:fit`, `ai:profiles`, `ai:shadow`. |
| `docs/ai-evaluator-fit.md`, `docs/ai-card-profiles.md`, `docs/ai-phase1-gate.md` | generated or new | P1-3, P1-4, P1-6 | Reports. The first two are written by their scripts; the gate doc is written by hand from the run. |

Two changes to the plan text fall out of this map. First, `CardRole` and `CardAIProfile` move to `rules-engine/src/ai/cardProfileTypes.ts`, because the plan puts them in a server file that rules-engine cannot import. Second, the fitted weights are a generated `.ts` file instead of `evaluatorWeights.v1.json`: `rules-engine/tsconfig.json` does not enable `resolveJsonModule`, so a JSON import would fail its typecheck. Enabling that option is the alternative, if you prefer to keep a JSON file.

## P1-1 Board evaluator

A pure function from an Observation to one number per seat. It needs only the P0-1 types, no running game, and nothing in live code calls it, so v0 cannot change. This is the first task to start.

**Files**

- new `rules-engine/src/ai/evaluatorFeatures.ts`: `FeatureName`, `SeatFeatures`, `EvalWeights`, `FEATURE_NAMES`, `FEATURE_SCALE`, `permanentValue`, `seatFeatures`.
- new `rules-engine/src/ai/evaluator.ts`: `DEFAULT_WEIGHTS`, `getEvalWeights`, `seatValues`, and a re-export of `EvalWeights`.
- new `rules-engine/src/ai/evaluatorWeights.v1.ts`: a one-line stub that exports `FITTED_WEIGHTS = null`. P1-3 overwrites it. It must exist now because `evaluator.ts` imports it.
- new `rules-engine/test/aiEvaluator.test.ts` and `rules-engine/test/fixtures/aiFixtures.ts`.
- edit `rules-engine/src/index.ts`: add `export * from './ai/evaluatorFeatures'` and `export * from './ai/evaluator'` next to the P0-1 lines. None of these names exist elsewhere in `rules-engine/src`, `server/src` or `shared/src`, so `export *` will not collide.

`EvalWeights` is declared in `evaluatorFeatures.ts` beside `FeatureName` and re-exported by `evaluator.ts`. That lets the generated weights file import the type from `evaluatorFeatures.ts` without an import cycle.

**What it reads from P0-1.** The plan leaves the fields of `PermanentView` open. The evaluator needs at least the ones below, so P0-1 has to include them. The type, text, token and counter fields exist so `permanentValue` can match `evaluatePermanentValue` exactly; `producesMana` can come from `permanentHasManaAbilities` in `permanentAbilityDiscovery.ts`, and `keywords` from `extractCombatKeywords`.

```ts
// rules-engine/src/ai/observation.ts (P0-1): the fields Phase 1 reads
interface PermanentView {
  id: string; controller: PlayerID;
  name?: string;                    // absent when face down
  typeLine: string;                 // as printed, e.g. 'Legendary Artifact Creature - Golem'
  types: string[];                  // lower-case: 'creature' | 'land' | 'artifact' | 'enchantment' | 'planeswalker'
  oracleText: string;               // '' when face down
  isToken: boolean; isCommander: boolean;
  power: number; toughness: number; // effective values from getCreaturePower / getCreatureToughness; 0 for non-creatures
  keywords: { flying: boolean; deathtouch: boolean; lifelink: boolean; trample: boolean;
              indestructible: boolean; doubleStrike: boolean; firstStrike: boolean;
              menace: boolean; haste: boolean; defender: boolean };
  tapped: boolean; summoningSick: boolean;
  counters: Record<string, number>; // '+1/+1' is read by permanentValue
  loyalty?: number;                 // planeswalkers only
  producesMana: boolean;
}
```

**Data shapes**

```ts
// evaluatorFeatures.ts
export const FEATURE_NAMES = ['life','commanderDamageTaken','boardValue','otherPermanents',
  'manaSources','handSize','commanderInPlay','loyalty','attackPower'] as const;
export type FeatureName = typeof FEATURE_NAMES[number];
export type SeatFeatures = Record<FeatureName, number>;
export type EvalWeights  = Record<FeatureName, number>;

// A typical mid-game value lands between 0 and 1. The fit in P1-3 depends on this.
export const FEATURE_SCALE: Record<FeatureName, number> = {
  life: 40, commanderDamageTaken: 21, boardValue: 60, otherPermanents: 30,
  manaSources: 10, handSize: 7, commanderInPlay: 1, loyalty: 10, attackPower: 20,
};
```

| Feature | Definition (before dividing by its scale) |
| --- | --- |
| `life` | the seat's life total; may be negative |
| `commanderDamageTaken` | the largest total this seat has taken from any single commander |
| `boardValue` | sum of `permanentValue` over the seat's creatures |
| `otherPermanents` | sum of `permanentValue` over its non-creature, non-land permanents |
| `manaSources` | count of permanents with `producesMana` (lands, rocks and dorks) |
| `handSize` | cards in hand, as a count: `hand.length` for the seat itself, `handSize` for opponents |
| `commanderInPlay` | 1 if any permanent it controls has `isCommander`, else 0 |
| `loyalty` | sum of `loyalty` over its planeswalkers |
| `attackPower` | summed power of creatures that are untapped, not defenders, and either not summoning sick or hasty |

**Pseudocode**

```ts
// evaluatorFeatures.ts
export function permanentValue(p: PermanentView): number {
  // Line-for-line copy of evaluatePermanentValue (aiEngineValueSupport.ts, line 98), reading the view.
  const type = p.typeLine.toLowerCase(), text = p.oracleText.toLowerCase(), k = p.keywords;
  let v = 0;
  if (p.types.includes('creature')) {
    v += (p.power + p.toughness) * 2;
    if (k.flying) v += 3;       if (k.deathtouch) v += 4;      if (k.lifelink) v += 3;
    if (k.trample) v += 2;      if (k.indestructible) v += 10; if (k.doubleStrike) v += 5;
    if (text.includes('when') && text.includes('enters the battlefield')) {
      if (text.includes('draw')) v += 3;
      if (text.includes('search')) v += 3;
      if (text.includes('create')) v += 2;
      if (text.includes('return') && text.includes('from your graveyard')) v += 3;
    }
  }
  if (type.includes('artifact')) { v += 3; if (text.includes('add') && text.includes('mana')) v += 4; }
  if (type.includes('enchantment')) v += 4;
  if (type.includes('land')) v += type.includes('basic') ? 1 : 3;
  if (p.isToken) v -= 2;
  v += (p.counters['+1/+1'] ?? 0) * 2;
  return Math.max(0, v);
}

export function seatFeatures(obs: Observation): Record<PlayerID, SeatFeatures> {
  const seats = [
    { id: obs.seat, life: obs.self.life, hand: obs.self.hand.length, bf: obs.self.battlefield },
    ...obs.opponents.map(o => ({ id: o.id, life: o.life, hand: o.handSize, bf: o.battlefield })),
  ];
  const out: Record<PlayerID, SeatFeatures> = {};
  for (const s of seats) {
    let board = 0, other = 0, mana = 0, loyalty = 0, attack = 0, cmdr = 0;
    for (const p of s.bf) {                       // one pass, no per-permanent allocation
      const creature = p.types.includes('creature'), land = p.types.includes('land');
      if (creature) board += permanentValue(p);
      else if (!land) other += permanentValue(p);
      if (p.producesMana) mana++;
      if (p.types.includes('planeswalker')) loyalty += p.loyalty ?? 0;
      if (p.isCommander) cmdr = 1;
      if (creature && !p.tapped && !p.keywords.defender && (!p.summoningSick || p.keywords.haste)) attack += p.power;
    }
    let worstCommander = 0;
    for (const d of Object.values(obs.commanderDamage[s.id] ?? {})) worstCommander = Math.max(worstCommander, d);
    const raw = { life: s.life, commanderDamageTaken: worstCommander, boardValue: board, otherPermanents: other,
                  manaSources: mana, handSize: s.hand, commanderInPlay: cmdr, loyalty, attackPower: attack };
    out[s.id] = scaled(raw);                      // divides each field by FEATURE_SCALE
  }
  return out;
}

// evaluator.ts
import { FITTED_WEIGHTS } from './evaluatorWeights.v1';
export const DEFAULT_WEIGHTS: EvalWeights = {   // a hand-set guess; the signs are the part that matters
  life: 2.0, commanderDamageTaken: -3.0, boardValue: 2.5, otherPermanents: 0.8, manaSources: 1.2,
  handSize: 0.6, commanderInPlay: 0.3, loyalty: 0.4, attackPower: 0.8,
};
export const getEvalWeights = (): EvalWeights => FITTED_WEIGHTS ?? DEFAULT_WEIGHTS;

export function seatValues(f: Record<PlayerID, SeatFeatures>, w: EvalWeights): Record<PlayerID, number> {
  const v: Record<PlayerID, number> = {};
  for (const id of Object.keys(f)) {
    let sum = 0;
    for (const name of FEATURE_NAMES) sum += w[name] * f[id][name];
    v[id] = sum;
  }
  return v;
}

// evaluatorWeights.v1.ts (stub until P1-3)
import type { EvalWeights } from './evaluatorFeatures';
export const FITTED_WEIGHTS: EvalWeights | null = null;
```

**Links to other tasks.** P1-2's harness logger calls `seatFeatures(buildObservation(state, activeSeat))` and writes the result. P1-3 reads those logged feature rows and fits the weights. P1-5 calls `seatFeatures`, `getEvalWeights` and `seatValues` to build the context its role policies read. Every seat is scored, including eliminated ones; `winProbabilities` (P1-2) is what zeroes them.

**Tests** (`aiEvaluator.test.ts`)

- Monotonic: adding a creature raises that seat's value; losing life lowers it; 20 commander damage lowers it more than 5; 1 mana source more raises it.
- Parity: at least ten fixtures, each built through `buildObservation` from a minimal game state, so a mistake in the view builder is caught as well. For each, assert `permanentValue(view) === evaluatePermanentValue(perm, { hasPermanentType })`, with `hasPermanentType` stubbed as a type-line check. Cover a vanilla 2/2, a flyer, deathtouch with lifelink, indestructible, double strike, an ETB-draw creature, an ETB-search creature, a token, a mana rock, an enchantment, a basic land, a nonbasic land, a creature with +1/+1 counters and a pumped creature.
- Timing: a late-game four-player fixture (about 25 permanents per seat) run 1,000 times. The test fails above 5 ms per call, a loose limit so CI noise does not flake it, and prints the measured mean for the PR. The plan's target is under 1 ms.
- Public-only: build the Observation from two different seats of the same state and check that `seatFeatures` returns equal values for every seat. This is also the P1-2 check, so write it once in the fixtures file.

## P1-2 Win probability and position log

Two pieces: a pure softmax function, and a logger in the self-play harness that records one feature row per seat at the start of every turn. The logger is the only part that touches a running game, and it only reads.

**Files**

- new `rules-engine/src/ai/winProbability.ts`: `winProbabilities`.
- new `rules-engine/test/aiWinProbability.test.ts`.
- edit `rules-engine/src/index.ts`: one export line.
- edit `server/tests/helpers/liveGameHarness.ts` (created in P0-3): a `logPosition` function and one call to it from `advanceLiveGame`.
- edit the P0-3 test file `server/tests/ai-selfplay.harness.test.ts`: a four-game check of the position file.

**Pseudocode**

```ts
// rules-engine/src/ai/winProbability.ts
export function winProbabilities(
  values: Record<PlayerID, number>, eliminated: PlayerID[], tau = 1,
): Record<PlayerID, number> {
  if (!(tau > 0)) throw new RangeError('tau must be positive');
  const out: Record<PlayerID, number> = {};
  for (const id of Object.keys(values)) out[id] = 0;            // eliminated seats stay at 0
  const live = Object.keys(values).filter(id => !eliminated.includes(id));
  if (live.length === 0) return out;
  let max = -Infinity;
  for (const id of live) max = Math.max(max, values[id]);        // subtract the max so big gaps cannot overflow
  let sum = 0;
  for (const id of live) { out[id] = Math.exp((values[id] - max) / tau); sum += out[id]; }
  for (const id of live) out[id] /= sum;
  return out;
}
```

**Where the logger hooks in.** `advanceLiveGame` already has a branch that fires once per new turn: `if (currentTurn > lastLoggedTurn) { ... maybeLogProgress(...) }` (in the current e2e file, about line 490). After the P0-3 extraction it lives in `liveGameHarness.ts`. Call `logPosition(game, gameId)` inside that branch. The state fields it reads are the ones `stateSnapshot` already uses: `turnNumber`, `turnPlayer`, and the players list with `hasLost`, `eliminated`, `conceded` and `spectator`.

```ts
// server/tests/helpers/liveGameHarness.ts
import { appendFileSync } from 'node:fs';
import { buildObservation } from '../../../rules-engine/src/ai/buildObservation.js';
import { seatFeatures } from '../../../rules-engine/src/ai/evaluatorFeatures.js';

const isGone = (p: any) => p.hasLost || p.eliminated || p.conceded || p.spectator || p.isSpectator;

export function logPosition(game: any, gameId: string): void {
  const file = process.env.AI_POSITIONS_FILE;
  if (!file) return;                                   // off by default; costs nothing
  const state = game.state as any;
  const active = state.turnPlayer as string;
  const features = seatFeatures(buildObservation(state, active));
  if (process.env.AI_POSITIONS_VERIFY) {               // public-only check: every live seat's view must agree
    for (const p of state.players) if (!isGone(p))
      assert.deepStrictEqual(seatFeatures(buildObservation(state, p.id)), features);
  }
  const eliminated = state.players.filter(isGone).map((p: any) => p.id);
  appendFileSync(file, JSON.stringify({ v: 1, gameId, turn: Number(state.turnNumber), activeSeat: active,
                                         features, eliminated }) + '\n');
}
```

The logger reads state and writes a file. It never touches the RNG, the timers or the game, so a run with it on must give the same winners and turn counts as a run with it off; the harness test checks that.

**File format.** One JSON line per turn start. Shards write to separate paths, chosen by the caller, the same way `AI_SELFPLAY_OUT` works.

```json
{"v":1,"gameId":"selfplay-1000-3-2","turn":7,"activeSeat":"p2",
 "features":{"p1":{"life":0.55,"commanderDamageTaken":0.1,"boardValue":0.4,"otherPermanents":0.1,"manaSources":0.6,"handSize":0.43,"commanderInPlay":1,"loyalty":0,"attackPower":0.2},"p2":{},"p3":{},"p4":{}},
 "eliminated":["p3"]}
```

**How it joins the results.** The fit script (P1-3) reads this file and the P0-3 result file, and joins them on `gameId`. The P0-3 result line, as the plan lists it, holds the seed and deck ids but no game id, and its `winner` is described as a seat. Two small additions to P0-3 make the join work: the result line carries the harness's `gameId`, and `winner` is the player id, the same key as in `features`. The game id should be built from the pod and rotation, for example `selfplay-<seed>-<pod>-<rotation>`, so it is unique per game and readable.

**Tests**

- `aiWinProbability.test.ts`: probabilities sum to 1 for 2, 3 and 4 live seats; equal values give equal shares; raising one value never lowers that seat's share; a 500-point gap gives a finite result with no NaN; eliminated seats get exactly 0 and the rest still sum to 1; all seats eliminated returns all zeros; `tau` of 0 throws.
- Harness test: with `AI_POSITIONS_FILE` and `AI_POSITIONS_VERIFY` set, a four-game run writes one line per distinct turn number per game, every line parses, and every line's `features` has one entry per seat. The verify flag proves that views from different seats give identical features, which is what shows the features are public-only.
- Determinism: the same four-game run with the file off gives identical winners and turn counts.

## P1-3 Weight fitting

A script that reads the logged positions and the game results, fits the nine weights by conditional logit, and either writes them into `evaluatorWeights.v1.ts` or explains in a report why it did not. Once the file holds real weights, `getEvalWeights()` picks them up and no other code changes.

**Files**

- new `server/scripts/fit-evaluator.ts`: argument parsing, loading, the join, the split, the report and the weights file. Thin; the math is in the library below.
- new `server/scripts/lib/conditionalLogit.ts`: pure functions `softmax`, `lossAndGrad`, `fit`, `logLoss`, `reliability`. It is a separate file so a test can import it without running the script.
- new `server/tests/aiConditionalLogit.test.ts`.
- overwritten by the script: `rules-engine/src/ai/evaluatorWeights.v1.ts` (the P1-1 stub) and `docs/ai-evaluator-fit.md`.
- edit `server/package.json`: `"ai:fit": "node --enable-source-maps --import tsx/esm scripts/fit-evaluator.ts"`.

**How it is run**

```
# 1. Generate data with v0 on seeds 2000 and up, one shard per process, separate output paths
AI_SELFPLAY_GAMES=100 AI_SELFPLAY_SEED=2000 AI_SELFPLAY_SHARD=0/4 \
  AI_SELFPLAY_OUT=out/fit.0.jsonl AI_POSITIONS_FILE=out/pos.0.jsonl \
  npm run ai:selfplay --workspace=server        # repeat for shards 1/4, 2/4 and 3/4

# 2. Fit
npm run ai:fit --workspace=server -- --positions 'out/pos.*.jsonl' --results 'out/fit.*.jsonl' \
  [--l2 0.01] [--seed 1] [--bootstrap 200] [--force]
```

**Data shapes**

```ts
// inputs, one JSON object per line
interface PositionRow { v: 1; gameId: string; turn: number; activeSeat: string;
  features: Record<string, SeatFeatures>; eliminated: string[] }              // written by P1-2
interface ResultRow { gameId: string; winner: string | null;
  endReason: 'win' | 'turn-limit' | 'stall' | 'error'; /* seed, decks, brains, turns, ms */ }  // written by P0-3

// inside the script
interface Example { gameId: string; pod: string;
  X: number[][];       // one row per live seat, one column per feature in FEATURE_NAMES order
  winnerIdx: number }  // row of the seat that won the game
```

**Pseudocode**

```ts
// fit-evaluator.ts
const winners = new Map(results.filter(r => r.endReason === 'win' && r.winner).map(r => [r.gameId, r.winner]));
const examples: Example[] = [];
for (const row of positions) {
  const winner = winners.get(row.gameId);
  if (!winner) continue;                                   // turn-limit, stall and error games carry no label
  const seats = Object.keys(row.features).filter(id => !row.eliminated.includes(id));
  if (seats.length < 2 || !seats.includes(winner)) continue;   // one live seat is a foregone conclusion
  examples.push({ gameId: row.gameId, pod: podOf(row.gameId),
    X: seats.map(id => FEATURE_NAMES.map(f => row.features[id][f])), winnerIdx: seats.indexOf(winner) });
}
const { train, test } = splitByPod(examples, 0.8, seed);  // shuffle pods with a seeded PRNG, never positions
const w     = fit(train, l2);                              // all nine features
const wLife = fit(train.map(keepOnly('life')), l2);        // the life-only baseline, same data and penalty
const model = {
  fitted: logLoss(test, w), lifeOnly: logLoss(test, wLife, keepOnly('life')),
  uniform: mean(test.map(e => Math.log(e.X.length))),      // log of the live-seat count; log 4 = 1.386 when all four are live
};
const rel = reliability(test, w, 10);                      // buckets of predicted probability, 10 points wide
const checks = {
  beatsBoth: model.fitted < Math.min(model.uniform, model.lifeOnly),
  calibrated: rel.every(b => b.n < 100 || Math.abs(b.observed - b.predicted) <= 0.10),
  signs: w.life > 0 && w.boardValue > 0 && w.manaSources > 0 && w.commanderDamageTaken < 0,
};
const pass = checks.beatsBoth && checks.calibrated && checks.signs;
writeReport('docs/ai-evaluator-fit.md', { counts, split, model, rel, w, checks, pass, ci });
if (pass || args.force) writeWeightsFile('rules-engine/src/ai/evaluatorWeights.v1.ts', w, counts, model);
// on a fail the stub stays null, so DEFAULT_WEIGHTS keeps being used and the report says which check failed

// lib/conditionalLogit.ts
export function lossAndGrad(data: Example[], w: number[], l2: number) {
  let loss = 0; const grad = new Array(w.length).fill(0);
  for (const e of data) {
    const s = e.X.map(x => dot(w, x));
    const p = softmax(s);                                  // subtract the max first, as winProbabilities does
    loss -= Math.log(Math.max(p[e.winnerIdx], 1e-12));
    for (let k = 0; k < w.length; k++) {
      let expected = 0;
      for (let j = 0; j < p.length; j++) expected += p[j] * e.X[j][k];
      grad[k] += expected - e.X[e.winnerIdx][k];           // d(-log p_winner)/dw = E_p[x] - x_winner
    }
  }
  const n = data.length;
  for (let k = 0; k < w.length; k++) grad[k] = grad[k] / n + 2 * l2 * w[k];
  return { loss: loss / n + l2 * sumSquares(w), grad };
}

export function fit(data: Example[], l2: number): number[] {   // full-batch gradient descent, backtracking line search
  let w = new Array(featureCount(data)).fill(0), step = 1;
  for (let iter = 0; iter < 5000; iter++) {
    const { loss, grad } = lossAndGrad(data, w, l2);
    if (norm(grad) < 1e-6) break;
    for (step *= 2; step > 1e-12; step /= 2) {
      const w2 = w.map((v, k) => v - step * grad[k]);
      if (lossAndGrad(data, w2, l2).loss <= loss - 1e-4 * step * sumSquares(grad)) { w = w2; break; }
    }
    if (step <= 1e-12) break;
  }
  return w;
}
```

The loss is convex and there are about ten parameters, so this converges in well under a second on 10,000 positions. No dependency is needed. `tau` is fixed at 1 because the weights absorb the scale.

**Two refinements to the plan.** First, the split is by pod, not only by game. The four rotations of a pod share the same four decks, so games from one pod are correlated; `podOf(gameId)` strips the rotation suffix of the P1-2 game id, and a whole pod goes to either the fit set or the hold-out set. Second, `l2` is fixed at 0.01 and is not tuned on the hold-out set, because the hold-out result is also the pass or fail verdict. If you want to tune it, split off a third set for that.

**Output files**

```ts
// rules-engine/src/ai/evaluatorWeights.v1.ts (generated; the header says not to edit it by hand)
// Fitted on 312 games / 7,804 positions. Held-out log-loss 1.21 vs uniform 1.37 and life-only 1.30.
import type { EvalWeights } from './evaluatorFeatures';
export const FITTED_WEIGHTS: EvalWeights | null = { life: 1.83, commanderDamageTaken: -2.4, boardValue: 2.1, /* ... */ };
```

The numbers in that example are placeholders, not predictions. `docs/ai-evaluator-fit.md` holds: games read and games used, by end reason; positions used; the split sizes; the three log-loss values; the reliability table (bucket, positions, mean predicted, observed rate, gap, flagged if 100 or more positions and a gap over 10 points); each weight with its sign, whether the sign is the expected one, and a 95% interval from `--bootstrap` (resampling whole pods); the verdict; and the known limit that the labels come from v0 games.

**Tests** (`aiConditionalLogit.test.ts`)

- Recovery: draw 3,000 synthetic positions with known weights on three features, sample each winner from the softmax with a seeded PRNG, fit with `l2` near 0, and expect each weight within 0.3 of the truth.
- Gradient: compare `lossAndGrad` against a finite-difference estimate on a small random dataset.
- Agreement: the library's `softmax` equals `winProbabilities` from P1-2 on random inputs, so the fit and the runtime cannot drift apart.
- Join and split: games that did not end in a win are dropped; no pod appears in both the fit and hold-out sets; a position with one live seat is dropped.

## P1-4 Card profiles

An offline generator turns every commander-legal Oracle card into a small profile (its roles, timing and target needs), and a loader hands those profiles to the scorer at runtime. Nothing is parsed during a game. This task has no dependency on P1-1 to P1-3, so it can run in parallel with them.

**Files**

- new `rules-engine/src/ai/cardProfileTypes.ts`: `CardRole`, `CardAIProfile`, and a `CARD_ROLES` array. Types only, because the scorer in rules-engine must be able to import them.
- new `server/scripts/lib/cardProfileMapper.ts`: the pure mapping from one Oracle card to one profile (`mapCardToProfile`, `collectSteps`, `rolesForStep`) plus `legacyRoles`, which copies the substring checks of today's `calculateSpellPriority` for the disagreement report.
- new `server/scripts/generate-ai-card-profiles.ts`: reads cards, calls the mapper, applies overrides, writes the data file and the report.
- new `server/src/socket/ai-handlers/aiCardProfile.ts`: `getCardAIProfile(name)`, and a re-export of the types.
- generated `server/data/ai-card-profiles.json`; hand-written `server/data/ai-card-overrides.json`; generated `docs/ai-card-profiles.md`.
- new `server/tests/aiCardProfile.test.ts`.
- edit `server/package.json`: `"ai:profiles": "node --enable-source-maps --import tsx/esm scripts/generate-ai-card-profiles.ts"`. Edit `rules-engine/src/index.ts`: `export * from './ai/cardProfileTypes'`.

**Data shapes**

```ts
// rules-engine/src/ai/cardProfileTypes.ts
export const CARD_ROLES = ['ramp','draw','removal','sweeper','counterspell','protection',
  'token_maker','tutor','recursion','lifegain','wincon'] as const;
export type CardRole = typeof CARD_ROLES[number];
export interface CardAIProfile {
  oracleId: string; name: string;
  roles: CardRole[];                                   // sorted, no duplicates; may be empty
  timing: 'instant' | 'sorcery_speed';
  needs: Array<'target_creature' | 'target_permanent' | 'target_player' | 'graveyard_card'>;
  source: 'ir' | 'analyzer' | 'override';
}
```

The generator reads Scryfall-style oracle cards through `readOracleCardsSync()` in `server/src/services/oracleCardsIndex.ts`, which returns `unknown[]`. It uses only these fields: `oracle_id`, `name`, `type_line`, `oracle_text`, `legalities.commander` and, for double-faced and adventure cards, `card_faces[]` with the same text fields.

```json
// server/data/ai-card-profiles.json: one profile per line so a regenerated file diffs cleanly
{"version":1,"count":27000,"profiles":[
{"oracleId":"…","name":"Sol Ring","roles":["ramp"],"timing":"sorcery_speed","needs":[],"source":"ir"},
{"oracleId":"…","name":"Swords to Plowshares","roles":["removal"],"timing":"instant","needs":["target_creature"],"source":"ir"}
]}

// server/data/ai-card-overrides.json: keyed by exact card name; any field left out keeps the generated value
{
  "Disposal Mummy": { "roles": [] },
  "Heroic Intervention": { "roles": ["protection"], "timing": "instant" }
}
```

The count above is a placeholder; the real number is whatever the pool holds. The data file will be several megabytes. Committing it means the server never needs the oracle-card dump at runtime, which is why this map assumes it is committed.

**Pseudocode: the mapper**

```ts
// server/scripts/lib/cardProfileMapper.ts
const SIMPLE_ROLE: Partial<Record<string, CardRole>> = {
  add_mana: 'ramp', draw: 'draw', counter_spell: 'counterspell', create_token: 'token_maker',
  gain_life: 'lifegain', win_game: 'wincon', take_extra_turn: 'wincon', prevent_damage: 'protection',
};
const ANALYZER_ROLE: Partial<Record<CardCategory, CardRole>> = {   // CardCategory from CardAnalyzer-handlers/cardAnalyzerTypes.ts
  [CardCategory.RAMP]: 'ramp', [CardCategory.DRAW]: 'draw', [CardCategory.TUTOR]: 'tutor',
  [CardCategory.REMOVAL]: 'removal', [CardCategory.BOARD_WIPE]: 'sweeper', [CardCategory.COUNTERSPELL]: 'counterspell',
  [CardCategory.PROTECTION]: 'protection', [CardCategory.TOKEN_GENERATOR]: 'token_maker', [CardCategory.REANIMATOR]: 'recursion',
};
const words = (t: string) => new Set(t.split(/[^a-z']+/));        // word tests without regex escapes
const GRAVEYARD_HATE = ['from a graveyard', 'from any graveyard', 'from each graveyard', 'from all graveyards'];

export function collectSteps(steps: OracleEffectStep[], out: OracleEffectStep[] = []) {
  for (const s of steps) {
    out.push(s);
    if (s.kind === 'conditional') { collectSteps(s.steps, out); collectSteps(s.elseSteps ?? [], out); }
    if (s.kind === 'choose_mode') for (const m of s.modes) collectSteps(m.steps, out);
  }
  return out;
}

function rolesForStep(step: OracleEffectStep): CardRole[] {
  const raw = (step.raw ?? '').toLowerCase(), w = words(raw);
  switch (step.kind) {
    case 'destroy': case 'exile': case 'gain_control': case 'deal_damage': {
      const massNoun = ['creature','creatures','permanent','permanents','nonland','artifacts','enchantments'].some(n => w.has(n));
      if ((w.has('each') || w.has('all')) && massNoun) return ['sweeper'];
      if (w.has('target') && !GRAVEYARD_HATE.some(p => raw.includes(p))) return ['removal'];
      return [];                                      // 'exile this', 'each opponent loses', graveyard hate
    }
    case 'search_library': {
      const wanted = step.criteria.kind === 'raw' ? step.criteria.text.toLowerCase() : '';
      return wanted.includes('basic land') ? ['ramp'] : ['tutor'];
    }
    case 'move_zone':
      return raw.includes('graveyard') && (step.to === 'hand' || step.to === 'battlefield') ? ['recursion'] : [];
    case 'grant_temporary_ability':
      return ['hexproof','indestructible','shroud'].some(k => w.has(k)) || raw.includes('protection from') ? ['protection'] : [];
    default: { const r = SIMPLE_ROLE[step.kind]; return r ? [r] : []; }
  }
}

export function mapCardToProfile(card: OracleCard, deps: { parse: typeof parseOracleTextToIR; analyze: (c: any) => CardAnalysis }): CardAIProfile {
  const faces = card.card_faces?.length ? card.card_faces : [card];
  const roles = new Set<CardRole>(); let sawGap = false, hasText = false;
  for (const face of faces) {
    const text = face.oracle_text ?? ''; hasText ||= text.length > 0;
    const ir = deps.parse(text, face.name ?? card.name);
    const steps = ir.abilities.flatMap(a => collectSteps([...a.steps]));
    sawGap ||= ir.abilities.length === 0 || steps.some(s => s.kind === 'unknown' || s.kind === 'raw');
    for (const s of steps) rolesForStep(s).forEach(r => roles.add(r));
  }
  let source: CardAIProfile['source'] = 'ir';
  if (roles.size === 0 && hasText && sawGap) {         // the IR said nothing usable: ask the analyzer
    const cats = deps.analyze({ ...card }).categories;
    for (const c of cats) { const r = ANALYZER_ROLE[c]; if (r) { roles.add(r); source = 'analyzer'; } }
  }
  if ((card.type_line ?? '').includes('Land')) roles.delete('ramp');   // a land's mana is not a spell role; land drops are scored separately
  const text = faces.map(f => f.oracle_text ?? '').join('\n').toLowerCase();
  return { oracleId: card.oracle_id, name: card.name, roles: [...roles].sort(), source,
    timing: (card.type_line ?? '').includes('Instant') || text.includes('flash') ? 'instant' : 'sorcery_speed',
    needs: needsFrom(text) };                             // regex-free checks: 'target creature', 'target player', 'target opponent', 'target permanent', 'from your graveyard'
}
```

The role table in the plan is implemented by `SIMPLE_ROLE` and `rolesForStep`. All fifteen step kinds it names exist in the IR union (`oracleIREffectStepA.ts` to `C.ts`). Steps carry a `raw` string with the clause text, which is what the selector check reads. Nested steps live in `conditional.steps`, `conditional.elseSteps` and `choose_mode.modes[].steps`; other kinds that hold steps (the `unless_*` family, delayed triggers) are added to `collectSteps` only if the report shows they matter.

**Pseudocode: the generator and the loader**

```ts
// server/scripts/generate-ai-card-profiles.ts
const cards = readOracleCardsSync() as OracleCard[];
const overrides = loadOverrides('server/data/ai-card-overrides.json');       // keys starting with '_' are ignored
const legal = cards.filter(c => c.legalities?.commander === 'legal');
const profiles: CardAIProfile[] = [], failures: { name: string; error: string }[] = [];
for (const card of legal) {
  let p: CardAIProfile;
  try { p = mapCardToProfile(card, { parse: parseOracleTextToIR, analyze: c => cardAnalyzer.analyzeCard(c) }); }
  catch (e) { failures.push({ name: card.name, error: String(e) }); p = emptyProfile(card); }   // still writes one profile per card
  const o = overrides[card.name];
  profiles.push(o ? { ...p, ...o, source: 'override' } : p);
}
profiles.sort((a, b) => a.name.localeCompare(b.name));
writeProfilesFile('server/data/ai-card-profiles.json', profiles);               // one profile per line
writeReport('docs/ai-card-profiles.md', {
  bySource: countBy(profiles, p => p.source), noRole: profiles.filter(p => p.roles.length === 0).length,
  byRole: countByRole(profiles), unusedOverrideKeys: Object.keys(overrides).filter(k => !legalNames.has(k)),
  disagreements: sample(20, seed, legal.filter(c => differs(legacyRoles(c), roles3(profileFor(c))))),  // ramp, draw and removal only
  failures,
});
if (failures.length) process.exitCode = 1;     // the Done-when says no exceptions, so a failure must be visible

// server/src/socket/ai-handlers/aiCardProfile.ts
let byName: Map<string, CardAIProfile> | null = null;
export function getCardAIProfile(name: string): CardAIProfile | undefined {
  byName ??= loadProfiles();                  // read once, on first use
  return byName.get(name.toLowerCase());
}
function loadProfiles() {
  const file = path.resolve(moduleDir, '../../../data/ai-card-profiles.json');   // server/src/socket/ai-handlers -> server/data
  const map = new Map<string, CardAIProfile>();
  try {
    for (const p of JSON.parse(readFileSync(file, 'utf8')).profiles as CardAIProfile[]) {
      map.set(p.name.toLowerCase(), p);
      for (const face of p.name.split(' // ')) map.set(face.toLowerCase(), p);   // double-faced cards answer to either face
    }
  } catch { console.warn('[ai] card profiles not loaded; every card falls back to v0 priority'); }
  return map;                                 // never throws: a missing file means no profiles, not a crash
}
```

The disagreement report compares only ramp, draw and removal, because those are the three things the old substring checks in `calculateSpellPriority` (lines 55 to 166 of `aiSpellPriority.ts`) try to detect. `legacyRoles` copies those text checks so the report can show where the two disagree. It is a one-off comparison tool and is not used at runtime.

**Tests** (`aiCardProfile.test.ts`)

- Real Oracle text through the real parser, no mocks. One fixture card per role: Sol Ring (ramp), Cultivate (search for basic lands, so ramp), a card draw spell, Swords to Plowshares (removal, instant, needs `target_creature`), Wrath of God (sweeper), Counterspell (counterspell, instant), a token maker, Demonic Tutor (tutor), Raise Dead (recursion, needs `graveyard_card`), Heroic Intervention (protection), a life-gain spell, and a win-the-game card.
- Disposal Mummy has no removal role (graveyard hate), and Campfire has lifegain and no removal role (its exile is a cost).
- A land never gets `ramp`. A double-faced card gets the union of its faces' roles.
- Override precedence: an override changes roles and sets `source` to `override`, and fields it leaves out keep the generated values.
- Analyzer fallback: a card whose IR is all unknown or raw steps gets `source: 'analyzer'`. Pick the fixture from the generator's first run, since the 21% gap list changes.
- Loader: lookup is case-insensitive, a double-faced card answers to either face name, and a missing file returns `undefined` without throwing.
- The fixture expectations are written from the table above. The first run of the mapper against real parser output may disagree with them; each disagreement is either a table fix or a documented override.

## P1-5 Utility scorer and shadow mode

The one task that touches the live decision loop. A pure scorer in rules-engine adjusts the priority of the candidates v0 already lists; a small server module chooses between v0, shadow and v1 per seat; one line in `enumerateAIActionCandidates` calls it. In `v0` the function returns its input untouched. In `shadow` it computes the new ranking, attaches it to the trace and still returns the v0 order. Only `v1` changes what the bot does. Needs P1-1, P1-2 and P1-4.

**Files**

- new `rules-engine/src/ai/rolePolicies.ts`: curve helpers and one list of considerations per role.
- new `rules-engine/src/ai/utilityScorer.ts`: `Consideration`, `ScoreContext`, `CandidateView`, `ScoredCandidate`, `buildScoreContext`, `rankCandidates`.
- new `server/src/socket/ai-handlers/aiBrain.ts`: `Brain`, `getSeatBrain`, `applyBrain`, `takeShadow`.
- edit `aiActionCandidateHandlers.ts`: `enumerateAIActionCandidates` ends with `candidates.sort(...)` then `return candidates;` (about line 443). Replace the return with `return applyBrain(game, playerId, query, candidates);` and add the import. The P0-4 response-window trace hook in `tryAIResponseActions` also calls `takeShadow`.
- edit `aiPriorityHandlers.ts`: the P0-4 trace hook for the main-phase loop calls `takeShadow(actionCandidates)` and puts the result on the record.
- edit `aiDecisionTrace.ts` (P0-4): add the optional `shadow` field.
- edit `liveGameHarness.ts`: after seats are registered, set `player.aiBrain` for each seat (challenger seat from `AI_SELFPLAY_CHALLENGER`, default `v0`; the other seats `v0` until P2-8 adds a baseline variable).
- new `server/scripts/shadow-report.ts`, `rules-engine/test/aiUtilityScorer.test.ts`, `server/tests/aiBrain.test.ts`; edit `server/package.json` (`ai:shadow`) and `rules-engine/src/index.ts`.

**What the live loop looks like today.** The main-phase loop enumerates land plays in their own call (`kinds: ['play_land']`, at most one candidate), then enumerates `activate_ability`, `cast_commander` and `cast_spell` together and tries them in priority order until one makes progress. It never passes while something is castable. The response path (`tryAIResponseActions`) does the same with `mode: 'response'`. Two consequences shape the design:

- Land plays have a single candidate, so there is nothing to rank. The plan's scope item for lands is a no-op in Phase 1.
- Reordering alone does not hold a card back, because the loop reaches every castable candidate eventually. **Only removing a candidate holds it.** So the scorer can drop a candidate, and only a gate of exactly 0 does that. Everything else reorders.

**Data shapes**

```ts
// utilityScorer.ts
export interface CandidateView {            // built by aiBrain.ts from an AIActionCandidate
  index: number;                            // position in the v0-sorted array
  kind: 'play_land' | 'cast_spell' | 'cast_commander' | 'activate_ability';
  name?: string; cmc?: number; typeLine?: string;
  v0Priority: number;                       // the candidate's existing priority field
}
export interface ScoreContext {             // shared part built once per call, plus the per-candidate part
  obs: Observation; features: Record<PlayerID, SeatFeatures>; p: Record<PlayerID, number>;
  me: number; leader: { seat: PlayerID; p: number };   // my win probability; the best opponent's
  boardGap: number;                         // (average opposing boardValue - mine) / max(that average, 1/60)
  myCreatures: number; oppCreatures: number; manaAvailable: number; turn: number; handSize: number;
  mode: 'main' | 'response'; stackTop?: StackItemView;
  cand: CandidateView; profile: CardAIProfile;          // per candidate
}
export interface Consideration {
  name: string; kind: 'gate' | 'preference';
  input: (ctx: ScoreContext) => number; curve: (x: number) => number;   // curve maps to 0..1
  weight?: number;                          // preferences only, in priority points
}
export interface ScoredCandidate { index: number; score: number; parts: Record<string, number>; dropped: boolean }
```

Two small widenings of the plan's types: `input` receives the candidate (it needs the card's cost and profile), and `ScoredCandidate` has `dropped`. The mode needs no extra argument: it is `response` exactly when the Observation's stack is non-empty.

**Scoring rule.** For an in-scope candidate, `score = (v0Priority + sum of weight x curve over preferences) x product of curve over gates`, and a candidate with `gate = 0` is dropped. Layering on `v0Priority` keeps everything v0 already knows (curve, synergy, creature and rock bonuses). Candidates that are out of scope keep `score = v0Priority`. In scope means: kind is `cast_spell` or `cast_commander`, and the profile has at least one of ramp, draw, removal, sweeper or counterspell (a commander cast always counts). Activated abilities and cards with no profile pass through unchanged, which is how a missing profile can never drop a candidate.

**Pseudocode: policies and scorer**

```ts
// rolePolicies.ts
const ramp = (lo: number, hi: number) => (x: number) => clamp01((x - lo) / (hi - lo));
const inv  = (f: (x: number) => number) => (x: number) => 1 - f(x);
const atLeast = (t: number) => (x: number) => (x >= t ? 1 : 0);

export const POLICIES: Record<'ramp'|'draw'|'removal'|'sweeper'|'counterspell'|'commander', Consideration[]> = {
  ramp: [
    pref('ramp_early',         c => c.turn,          inv(ramp(3, 10)), 60),
    pref('ramp_mana_starved',  c => c.manaAvailable, inv(ramp(2, 10)), 30),
  ],
  draw: [
    pref('draw_hand_small',    c => c.handSize,      inv(ramp(0, 7)),  30),
    pref('draw_when_behind',   c => c.leader.p - c.me, ramp(0, 0.3),   20),
  ],
  removal: [
    gate('removal_has_target', bestTargetValue,      atLeast(8)),            // see below
    pref('removal_big_threat', bestTargetValue,      ramp(8, 40),      50),
    pref('removal_commander_pressure', c => c.features[c.obs.seat].commanderDamageTaken, ramp(0, 1), 40),
  ],
  sweeper: [
    gate('sweeper_only_when_behind', c => c.boardGap, atLeast(0.25)),        // ahead on board: held back
    pref('sweeper_many_threats', c => c.oppCreatures - c.myCreatures, ramp(0, 6), 40),
  ],
  counterspell: [
    gate('counter_needs_enemy_spell', c => (c.mode === 'response' && c.stackTop && c.stackTop.controller !== c.obs.seat ? 1 : 0), atLeast(1)),
    pref('counter_big_spell',    c => c.stackTop?.cmc ?? 0, ramp(2, 7), 60),
    pref('counter_leader_spell', c => (c.stackTop?.controller === c.leader.seat ? 1 : 0), atLeast(1), 20),
  ],
  commander: [ pref('commander_when_behind', c => c.leader.p - c.me, ramp(0, 0.3), 25) ],
};

// The executor picks the real target later, so the policy only asks whether a worthwhile one exists.
function bestTargetValue(c: ScoreContext): number {
  const opp = c.obs.opponents.filter(o => !o.eliminated);
  if (c.profile.needs.includes('target_creature'))
    return Math.max(0, ...opp.flatMap(o => o.battlefield.filter(isCreature).map(permanentValue)));
  if (c.profile.needs.includes('target_permanent'))
    return Math.max(0, ...opp.flatMap(o => o.battlefield.filter(p => !isLand(p)).map(permanentValue)));
  return 1e9;                                                              // unknown targeting: never gate it
}

// utilityScorer.ts
export function rankCandidates(obs, candidates, profile, base = buildScoreContext(obs)): ScoredCandidate[] {
  // buildScoreContext: seatFeatures -> seatValues(getEvalWeights()) -> winProbabilities, built once per call
  return candidates.map(cand => {
    const prof = cand.name ? profile(cand.name) : undefined;
    const roles = scopedRoles(cand, prof);         // [] when out of scope; adds 'commander' for cast_commander
    if (roles.length === 0) return { index: cand.index, score: cand.v0Priority, parts: {}, dropped: false };
    const ctx = { ...base, cand, profile: prof ?? EMPTY_PROFILE };
    let pref = 0, gate = 1; const parts: Record<string, number> = {};
    for (const role of roles) for (const k of POLICIES[role]) {
      const y = clamp01(k.curve(k.input(ctx)));
      parts[role + '.' + k.name] = y;
      if (k.kind === 'gate') gate *= y; else pref += (k.weight ?? 0) * y;
    }
    return gate === 0 ? { index: cand.index, score: 0, parts, dropped: true }
                      : { index: cand.index, score: (cand.v0Priority + pref) * gate, parts, dropped: false };
  });
}
```

`buildScoreContext` computes `p` once per call, picks the leader as the live opponent with the highest `p`, and takes `manaAvailable` as the untapped mana sources plus the mana pool. A card with several in-scope roles collects all their considerations, so one closed gate drops it. The scorer never calls `aiRandom`, `Math.random` or `Date.now`.

**Pseudocode: the brain switch**

```ts
// server/src/socket/ai-handlers/aiBrain.ts
export type Brain = 'v0' | 'shadow' | 'v1';
const isBrain = (x: unknown): x is Brain => x === 'v0' || x === 'shadow' || x === 'v1';

export function getSeatBrain(game: any, playerId: string): Brain {
  const seat = (game.state?.players ?? []).find((p: any) => p?.id === playerId)?.aiBrain;   // the seat wins over the env var
  if (isBrain(seat)) return seat;
  return isBrain(process.env.AI_BRAIN) ? process.env.AI_BRAIN : 'v0';
}

export interface ShadowRecord {                  // the P0-4 trace record's optional `shadow` field
  brain: 'shadow' | 'v1';
  winProb: Record<string, number>;
  scores: Array<{ v0Index: number; score: number; dropped: boolean; parts: Record<string, number> }>;  // same order as the record's candidates
}
const records = new WeakMap<object, ShadowRecord>();          // keyed by the array applyBrain returned
export const takeShadow = (list: object) => { const r = records.get(list); records.delete(list); return r; };

export function applyBrain(game: any, playerId: string, query: AIActionCandidateQuery, sorted: AIActionCandidate[]): AIActionCandidate[] {
  const brain = getSeatBrain(game, playerId);
  if (brain === 'v0' || sorted.length === 0) return sorted;                  // nothing runs, nothing allocates
  const kinds = query.kinds;
  if (kinds && !kinds.includes('cast_spell') && !kinds.includes('cast_commander')) return sorted;
  try {
    const obs = buildObservation(game.state, playerId);
    const ctx = buildScoreContext(obs);                                       // built once, passed in, so the record can carry ctx.p
    const ranked = rankCandidates(obs, sorted.map(toView), getCardAIProfile, ctx);
    const keep = ranked.filter(r => !r.dropped).sort((a, b) => b.score - a.score || a.index - b.index);   // stable: ties keep v0 order
    const out = brain === 'v1' ? keep.map(r => sorted[r.index]) : sorted;     // shadow returns the SAME array
    const order = brain === 'v1' ? keep.map(r => r.index) : sorted.map((_, i) => i);
    records.set(out, { brain, winProb: ctx.p,
      scores: order.map(i => ({ v0Index: i, score: ranked[i].score, dropped: ranked[i].dropped, parts: ranked[i].parts })) });
    return out;
  } catch (err) {
    warnOnce('[ai] brain scorer failed, using v0 order', err);                // any failure costs one decision, not the game
    return sorted;
  }
}
// toView: cast_spell -> { name: (spell.castCard ?? spell.card).name, cmc: spell.cmc, typeLine: spell.typeLine }; cast_commander -> the commander card;
//         activate_ability and play_land -> name only (they are out of scope and pass through)
```

`rankCandidates` takes the shared context as an optional fourth argument, so `applyBrain` builds it once and the trace record can carry the win probabilities without computing them twice. Callers that pass three arguments, as the plan's interface shows, still work.

**Why shadow cannot change a run.** It returns the same array object, reads state without writing, never touches the RNG, and the harness runs on fake timers (`vi.advanceTimersByTimeAsync`), so the extra CPU time cannot move any scheduled event. That is what the exact-reproduction check in the Done-when relies on.

**Trace record and report**

```ts
// aiDecisionTrace.ts (P0-4): one optional field added
interface DecisionTrace { /* v, gameId, seq, turn, phase, step, seat, kind, candidates, chosen, note */
  shadow?: ShadowRecord;                // present for kind 'priority' and 'response' when the seat's brain is shadow or v1
}
```

`shadow-report.ts` reads the trace JSONL (`AI_TRACE_FILE`) and, for each record with a `shadow`, finds the v1 top (the highest-scoring candidate that is not dropped) and the v0 top (`candidates[0]` in shadow mode). A decision is a disagreement when they differ, or when v0's top was dropped. It prints: decisions with a shadow record, the disagreement share, the share split by the role of v0's top and of v1's top (looked up with `getCardAIProfile`), the count of drops by role, and 30 sampled disagreements (seeded sample) with turn, phase, the win probabilities, each candidate's v0 priority and v1 score, and the `parts` of the top two. The sampled list is written to the file named by `--out` as Markdown, with a blank column for you to mark which choice was better.

**Tests**

- `aiUtilityScorer.test.ts`: one fixture context per policy. Ramp scores higher on turn 2 than turn 9. Draw scores higher with a one-card hand than a seven-card hand. Removal is dropped when no opposing creature is worth 8 or more and is boosted by a big one. A sweeper is dropped when the seat is ahead on board and kept when it is behind. A counterspell is dropped in main phase and with only its own spell on the stack, and scores higher against a six-mana enemy spell than a two-mana one. A card with no profile passes through at exactly its `v0Priority`. The gate case the plan asks for: a high-priority sweeper dropped by its gate even though its `v0Priority` is the highest in the list. Determinism: the same input twice gives deep-equal output.
- `aiBrain.test.ts`: `v0` returns the same array and does not call `buildObservation` (spy). `shadow` returns the same array in the same order and `takeShadow` returns a record. `v1` reorders, removes dropped candidates, and keeps out-of-scope candidates in their v0 relative order. A seat's `aiBrain` beats `AI_BRAIN`. A scorer that throws leaves the v0 order. With `Math.random` replaced by a function that throws, all three brains still run.
- Exact reproduction (extends `ai-selfplay.harness.test.ts`): the P0-6 baseline seeds with `AI_BRAIN=shadow` give the same winners and turn counts as the baseline file, and the trace has `shadow` entries.
- Puzzles: `AI_BRAIN=v1` on the P0-5 suite passes at least as many puzzles as `v0`. The puzzle helper builds `game.state` directly with no `aiBrain` on the players, so the environment variable applies.

## P1-6 Phase 1 gate: v1 against v0

Mostly a set of runs plus one report mode. The only new logic is the statistics: a challenger win rate with two kinds of interval, and the comparisons with a v0 control run. Needs P1-5, the P0-3 runner and the P0-5 puzzle suite.

**Files**

- edit `server/scripts/selfplay-report.ts` (P0-6): add `--mode gate`.
- new `server/scripts/lib/selfplayRows.ts`: the `ResultRow` type, JSONL readers that accept a glob, and `podOf(gameId)`. P1-3's fit script uses the same file, so write it once and import it from both.
- edit `server/tests/ai-puzzles/puzzleHarness.ts` (P0-5): when `AI_PUZZLE_OUT` is set, write the results as JSON after the run.
- new `server/tests/aiSelfplayReport.test.ts`.
- new `docs/ai-phase1-gate.md`: written by the report script with `--out`, then you add a short decision paragraph at the top.

**What to run.** All of it on seeds 3000 and up, which nothing has been tuned against. One control run is added to the plan's list, because the gate compares stalls, errors and speed with v0 and the P0-6 baseline used other seeds.

```
# 1. Challenger run: 320 games = 80 pods x 4 rotations, v1 in one seat and v0 in the other three. Four shards.
AI_SELFPLAY_GAMES=320 AI_SELFPLAY_SEED=3000 AI_SELFPLAY_CHALLENGER=v1 AI_SELFPLAY_SHARD=0/4 \
  AI_SELFPLAY_OUT=out/gate-v1.0.jsonl AI_TRACE_FILE=out/gate-v1.trace.0.jsonl \
  npm run ai:selfplay --workspace=server            # repeat for 1/4, 2/4, 3/4

# 2. Control run: the same seeds and pods with v0 in all four seats
AI_SELFPLAY_GAMES=320 AI_SELFPLAY_SEED=3000 AI_SELFPLAY_CHALLENGER=v0 AI_SELFPLAY_SHARD=0/4 \
  AI_SELFPLAY_OUT=out/gate-v0.0.jsonl npm run ai:selfplay --workspace=server

# 3. Puzzles under each brain
AI_BRAIN=v0 AI_PUZZLE_OUT=out/puzzles-v0.json npm exec --workspace=server -- vitest run tests/ai-puzzles
AI_BRAIN=v1 AI_PUZZLE_OUT=out/puzzles-v1.json npm exec --workspace=server -- vitest run tests/ai-puzzles

# 4. The gate report
npm run ai:report --workspace=server -- --mode gate \
  --challenger 'out/gate-v1.*.jsonl' --control 'out/gate-v0.*.jsonl' \
  --puzzles-v0 out/puzzles-v0.json --puzzles-v1 out/puzzles-v1.json --out docs/ai-phase1-gate.md
```

The trace is switched on for the v1 run only: it costs little and is what you read if the gate fails. Relative paths in these commands resolve against the server folder, because npm runs a workspace script there, so out/ means server/out/. That folder needs a .gitignore entry.

**Data shapes**

```ts
// server/scripts/lib/selfplayRows.ts (the P0-3 result line, with the two fields P1-2 and P1-6 rely on)
export interface ResultRow {
  gameId: string;                              // 'selfplay-<seed>-<pod>-<rotation>'
  seed: number;
  decks: Record<string, string>;               // player id -> deck id
  seatBrains: Record<string, 'v0' | 'shadow' | 'v1'>;    // player id -> brain
  seatOrder: string[];                         // player ids in turn order, so the report can name a seat position
  winner: string | null;                       // player id
  endReason: 'win' | 'turn-limit' | 'stall' | 'error';
  turns: number; ms: number;
}
export const podOf = (gameId: string) => gameId.replace(/-[0-9]+$/, '');   // drop the rotation suffix

// puzzle results file, written by the puzzle harness
interface PuzzleOut { brain: string; total: number; passed: number; results: Array<{ id: string; status: 'pass' | 'fail' | 'knownFailing' }> }
```

`seatOrder` is one more field to add to the P0-3 result line, so seat position can be reported. If you would rather keep the line as is, seat position can be derived from the seat ids' order in `decks`, but an explicit field is safer.

**Pseudocode: the gate mode**

```ts
// selfplay-report.ts, --mode gate
const v1 = readRows(args.challenger), v0 = readRows(args.control);
const challengerSeat = (r: ResultRow) => Object.keys(r.seatBrains).find(id => r.seatBrains[id] === 'v1')!;
const won = (r: ResultRow) => r.winner === challengerSeat(r);       // a null winner (turn limit, stall) is not a win

const wins = v1.filter(won).length, n = v1.length;
const [wLo, wHi] = wilson(wins, n);
const pods = groupBy(v1, r => podOf(r.gameId)).map(g => ({ wins: g.filter(won).length, games: g.length }));
const [bLo, bHi] = podBootstrap(pods, 10000, mulberry32(args.seed ?? 1));
const lowerBound = Math.min(wLo, bLo);                             // the gate uses the lower of the two

function wilson(k: number, n: number, z = 1.96): [number, number] {
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
function podBootstrap(pods: { wins: number; games: number }[], B: number, rng: () => number): [number, number] {
  const rates: number[] = [];
  for (let b = 0; b < B; b++) {                                      // resample whole pods, with replacement
    let w = 0, g = 0;
    for (let i = 0; i < pods.length; i++) { const p = pods[Math.floor(rng() * pods.length)]; w += p.wins; g += p.games; }
    rates.push(w / g);
  }
  rates.sort((a, b) => a - b);
  return [rates[Math.floor(0.025 * B)], rates[Math.floor(0.975 * B)]];
}

const share = (rows: ResultRow[], f: (r: ResultRow) => boolean) => rows.filter(f).length / rows.length;
const bad = (r: ResultRow) => r.endReason === 'stall' || r.endReason === 'error';
const checks = {
  winRate:   lowerBound > 0.25,
  stalls:    share(v1, bad) <= share(v0, bad),
  seconds:   median(v1.map(r => r.ms)) <= 1.25 * median(v0.map(r => r.ms)),
  puzzles:   puzzlesV1.passed >= puzzlesV0.passed,
};
```

**What the report prints**

- Verdict table: the four checks, each with its measured value and pass or fail.
- Challenger win rate with both intervals (Wilson and pod bootstrap), and the bound the gate used.
- End-reason mix for the v1 run and the control, side by side.
- Median and 90th-percentile real seconds per game, for both runs, and the ratio.
- Challenger win rate by seat position and by deck, with the number of games behind each row. Decks with fewer than five challenger games are marked as noise.
- Control run win share by seat: this is the check that turn order is not skewing the 25% reference.
- Puzzle table: pass count for v0 and v1, and any puzzle whose status differs.
- The commit hash, the seeds, and the file names that were read.

A 320-game run needs at least 96 challenger wins (30%) for the Wilson lower bound to clear 25%: 80 of 320 gives 0.206 to 0.300 and 96 of 320 gives a lower bound of 0.252. The pod bootstrap interval is usually a little wider, so expect to need a few more.

**After the run.** A pass lets you make v1 the live default in a separate PR. The safest first step is setting `AI_BRAIN=v1` in the server's environment, since that can be reverted without a code change; changing the default inside `getSeatBrain` comes later. A fail sends you to the shadow disagreements and to the traces under `out/gate-v1.trace.*.jsonl`. Fix, then rerun on new seeds (4000 is taken by the Phase 2 gate, so use 3500 and up); do not rerun on the same seeds after tuning.

One threshold deserves a second look before the run. The stall check compares raw shares, so one extra stall in 320 games fails it. If that proves noisy, allow a small margin (for example two games) and write the margin into the plan before seeing the result, not after.

**Tests** (`aiSelfplayReport.test.ts`)

- Wilson: 80 of 320 gives about 0.206 to 0.300 (within 0.001); 96 of 320 has a lower bound above 0.25 and 95 of 320 does not.
- Bootstrap: the same seed gives identical intervals; if every pod has the same result the interval collapses to the point estimate; resampling is by pod, not by game (a fixture where one pod holds all the wins gives a much wider interval than the Wilson one).
- Challenger detection: the seat whose brain is `v1` is the one counted, and a null winner is never a win.
- Gate verdict: a synthetic 25% result file prints FAIL on the win-rate check, a 40% file prints PASS, and a control with fewer stalls than the challenger prints FAIL on the stall check.
- Median and share helpers on small hand-computed fixtures.

## Shared wiring

The small edits that several tasks depend on, collected so none gets forgotten.

**`server/package.json` scripts.** `ai:selfplay` and `ai:report` come from P0-3 and P0-6. Phase 1 adds three, in the same style as the existing `test:oracle-ir-migration` script:

```json
"ai:fit":      "node --enable-source-maps --import tsx/esm scripts/fit-evaluator.ts",
"ai:profiles": "node --enable-source-maps --import tsx/esm scripts/generate-ai-card-profiles.ts",
"ai:shadow":   "node --enable-source-maps --import tsx/esm scripts/shadow-report.ts"
```

**`rules-engine/src/index.ts`.** Add these next to the P0-1 lines and the existing `export * from './AIEngine'` (line 158). `evaluatorWeights.v1.ts` and `rolePolicies.ts` stay internal. None of the exported names exist elsewhere in `rules-engine/src`, `server/src` or `shared/src` today.

```ts
export * from './ai/evaluatorFeatures';   // P1-1
export * from './ai/evaluator';           // P1-1
export * from './ai/winProbability';      // P1-2
export * from './ai/cardProfileTypes';    // P1-4
export * from './ai/utilityScorer';       // P1-5
```

**Environment variables.** Every one is off or inert by default, so a server started with none of them behaves exactly as today.

| Variable | Read by | Values and default | Task |
| --- | --- | --- | --- |
| `AI_BRAIN` | `getSeatBrain` in `aiBrain.ts` | `v0`, `shadow` or `v1`; default `v0`. A seat's own `aiBrain` wins over it. | P1-5 |
| `AI_SELFPLAY_CHALLENGER` | `liveGameHarness.ts` | the brain given to the challenger seat; default `v0`, which means all four seats run v0 | P1-5 |
| `AI_POSITIONS_FILE` | `logPosition` in the harness | a file path; unset means no position log | P1-2 |
| `AI_POSITIONS_VERIFY` | `logPosition` | any value turns on the every-seat agreement check | P1-2 |
| `AI_PUZZLE_OUT` | `puzzleHarness.ts` | a file path; unset means no JSON results file | P1-6 |
| `AI_TRACE_FILE` | the P0-4 trace sink | a file path; unset means tracing off | P0-4, used in P1-5 and P1-6 |

The Phase 0 variables `AI_SELFPLAY_GAMES`, `AI_SELFPLAY_SEED`, `AI_SELFPLAY_OUT`, `AI_SELFPLAY_SHARD` and `AI_SELFPLAY_MAX_TURNS` are unchanged.

**Import paths.** Follow the neighbouring files:

- Inside `rules-engine/src/ai/`: extensionless relative imports (`'./evaluatorFeatures'`), and `'../../../shared/src'` for shared types.
- From `server/src/socket/ai-handlers/`: `'../../../../rules-engine/src/ai/utilityScorer.js'`, with the `.js` suffix, as the existing AI handlers do.
- From `server/tests/helpers/` and `server/scripts/`: `'../../../rules-engine/src/ai/...'` and `'../../rules-engine/src/ai/...'` respectively, both with `.js`.
- There is a second, unrelated folder `server/src/rules-engine/` (the server's own targeting and stack code). Every AI import above goes to the top-level `rules-engine/`, not to that one.

**Where tests live and what typechecks.**

- Pure rules-engine tests go in `rules-engine/test/` and run with `npm test --workspace=rules-engine`. Server tests go in `server/tests/` (vitest picks up `tests/**/*.test.ts`).
- `npm run typecheck` covers `rules-engine/src` and `server/src` only. Both tsconfigs have `strict: false`, so the new `src/ai/` files are checked leniently. Tests, harness helpers and `server/scripts/` are not typechecked by any script; vitest and tsx just run them. A type mistake in a script shows up when it runs.
- The server's vitest setup file (`tests/vitest.setup.ts`) creates per-worker SQLite files before every server test, even ones that need no database. The pure-math tests (`aiConditionalLogit`, `aiSelfplayReport`) will carry that cost; it is small, but it is why they could move to rules-engine later if you want them faster.

**Files that must not be committed.** The run outputs under `server/out/` (position logs, result files, traces, puzzle JSON) need a `.gitignore` entry. Today `.gitignore` has none for it. The generated files that should be committed are `server/data/ai-card-profiles.json`, `rules-engine/src/ai/evaluatorWeights.v1.ts` once fitted, and the three reports under `docs/`.

**Checks to run before opening any Phase 1 PR**

```
npm run typecheck                                    # rules-engine and server src
npm test --workspace=rules-engine                    # includes the new ai tests
npm run test:vitest --workspace=server -- tests/aiBrain.test.ts tests/aiCardProfile.test.ts
npm run test:vitest --workspace=server -- tests/precon-live-e2e.integration.test.ts   # v0 must still pass untouched
```

## Build order and PR sequence

One PR per task keeps each diff reviewable and each failure attributable. Task numbers are the merge order, as in the plan, with the one refinement noted under the table. Runs between PRs (data generation, the shadow run, the gate run) are not PRs and their raw output is never committed.

| PR | Task | Needs merged first | Touches live code? | Check before merging |
| --- | --- | --- | --- | --- |
| A | P1-1 evaluator | P0-1 | No | Typecheck; the evaluator tests; parity on at least ten fixtures; the measured `seatFeatures` time written in the PR description |
| B | P1-4 card profiles | nothing | No | Generator runs over the whole pool with no failures; Disposal Mummy and Campfire have no removal role; you review the 20 sampled disagreements |
| C | P1-2 win probability and position log | P0-3 and P0-6 (the logger part), P1-1 | No (test harness only) | Win-probability tests; a four-game run writes one line per turn; the every-seat agreement check passes; a run with the log on and off gives identical winners and turns |
| run | fitting data | C |  | 400 games on seeds 2000 and up with v0, positions on, split over four processes |
| D | P1-3 weight fitting | C and the fitting data | Only through the weights file, which only v1 reads | Library tests (recovery, gradient, agreement with `winProbabilities`); the report; a pass writes weights, a fail leaves the stub and the report says why |
| E | P1-5 scorer and shadow mode | A, B, C, and the P0-4 trace and P0-5 puzzles | Yes: one call in `enumerateAIActionCandidates`, inert under `v0` | Scorer and brain tests; the shadow run on the baseline seeds reproduces the baseline winners and turn counts exactly; puzzles under `v1` pass at least as many as `v0`; you review 30 sampled disagreements |
| F | P1-6 gate | E | No | Report-math tests; then the runs and the gate report, committed as `docs/ai-phase1-gate.md` |
| G | Make v1 live | F passing | Yes | Separate PR, set `AI_BRAIN=v1` in the server environment first; revert is a one-line change |

PR D is not a hard prerequisite of PR E. The scorer uses whichever weights exist (`getEvalWeights()` falls back to `DEFAULT_WEIGHTS`), so E can proceed while the fit data is still being generated, and the gate then runs with whichever weights D produced.

**One refinement to the plan's ordering.** The plan says P1-2 waits for P0-6. That is true of the logger, which needs the P0-3 runner and the baseline numbers, but `winProbability.ts` and its tests are a pure function with no such dependency. If you want it earlier, ship them with PR A and leave the harness logger for PR C. Nothing else changes.

**Parallel work.** Two people can start on day one: one on PR A (once P0-1 has landed) and one on PR B. After A, B and C have merged, the rest is sequential, because each step needs the output of the one before it.

**Merge conflicts to expect.** PRs A, B, C and E each add lines to `rules-engine/src/index.ts` and PRs B, D and E each add scripts to `server/package.json`. These are additive and trivial to resolve; merge in the table's order and rebase before each PR.

**Where you decide.** Four points need your judgment, not mine: the 20 profile disagreements (PR B), the weight signs and calibration table (PR D), the 30 shadow disagreements (PR E), and the gate verdict (PR F). Each PR description should link the file where those samples were written, so the review is a read-through and not a hunt.

## What to check in the code before writing it

This map was built from reading the code at commit e43d44e, not from running it. Everything below is something I could not settle by reading, or a change the Phase 0 plan text needs so these maps hold. They are ordered by when they bite.

**Changes to the Phase 0 and Phase 1 plan text, before the PRs that depend on them**

- **P0-1 field list.** The plan leaves `PermanentView` open. Phase 1 needs the fields in the P1-1 code block (`typeLine`, `types`, `oracleText`, `isToken`, `isCommander`, `counters`, `loyalty`, `tapped`, `summoningSick`, `producesMana`, and the keyword flags). It also needs `StackItemView` to carry `controller`, `name` and `cmc`. Add these to the P0-1 interface before it is written; adding them afterwards means reopening the builder and its snapshot test.
- **P0-3 result line.** Add `gameId`, `seatBrains` (player id to brain) and `seatOrder`, and make `winner` the player id. P1-2, P1-3 and P1-6 all join on these.
- **P0-4 function name.** The plan names `setAIDecisionTraceSink` and `DecisionTrace` but not the function the hooks call. Call it `recordDecision(trace)` in the plan so P1-5's `takeShadow` has a named place to attach.
- **P1-3 and P1-4 plan text.** The fitted weights are `evaluatorWeights.v1.ts`, not `.json`; `CardRole` and `CardAIProfile` live in `rules-engine/src/ai/cardProfileTypes.ts`; the fit's train and hold-out split is by pod. Each is explained in its task section above.
- **P1-6 plan text.** Add the v0 control run on the same seeds, and replace `runPuzzles({ brain })` with the `AI_BRAIN` and `AI_PUZZLE_OUT` approach, so the puzzle suite stays an ordinary vitest suite.

**Code facts to confirm when you reach the task**

| Task | Check | Where to look | Why it matters |
| --- | --- | --- | --- |
| P1-1 | Where loyalty and the +1/+1 count live on a permanent (`perm.counters`, or a separate `loyalty` field) | `BattlefieldPermanent` in `shared/src`; `evaluatePermanentValue` reads `perm.counters['+1/+1']` | The `loyalty` feature and the parity test both depend on it |
| P1-1 | The field name for summoning sickness, and whether `tapped` is a plain boolean | the same type; `combatAutomation.ts` | `attackPower` is wrong if it counts creatures that cannot attack |
| P1-1 | `producesMana` is true for a basic Forest taken from the server's real card objects | `permanentHasManaAbilities` in `permanentAbilityDiscovery.ts` (it is substring based and starts with an oracle-text check for a colon) | If a source leaves basic-land text empty, `manaSources` undercounts every seat; add a type-line fallback |
| P1-1 | The real `hasPermanentType` used by the AI | `rules-engine/src/AIEngine.ts` | The parity test stubs it; use the real one if it is exported |
| P1-1 | `export *` of `EvalWeights` from two modules does not raise TS2308 | `npm run typecheck --workspace=rules-engine` | If it does, drop the re-export from `evaluator.ts` and import the type from `evaluatorFeatures.ts` |
| P1-2 | Which turn counter and active-player fields the harness sees at turn change | `stateSnapshot` in `precon-live-e2e.integration.test.ts`: `turnNumber`, `turnPlayer` | The logger keys on them; the e2e file already uses both |
| P1-2 | `deriveLivePreconSeed(gameId)` makes the game seed from a hash of the game id | the same file, line 65 | The id scheme `selfplay-<seed>-<pod>-<rotation>` must still give the reproducibility P0-3 promises |
| P1-4 | The signature of `parseOracleTextToIR` and the exact `OracleZone` names for `move_zone.to` | `oracleIRParserParseOracleTextToIR.ts` line 229; `oracleIRSharedTypes` | The mapper passes the card name and compares `to` against `'hand'` and `'battlefield'` |
| P1-4 | `cardAnalyzer.analyzeCard` accepts a Scryfall-shaped card object | `CardAnalyzer.ts` line 109 | The fallback passes oracle cards, not battlefield permanents |
| P1-4 | Which other IR step kinds hold nested steps | `oracleIREffectStepA` to `C` (the `unless_*` kinds, delayed triggers, `any_player_may`) | `collectSteps` only recurses into `conditional` and `choose_mode`; missed roles show up in the report |
| P1-4 | `server/data/` is shipped in the live deployment | the Dockerfile or deploy config, whichever you use | `getCardAIProfile` reads `server/data/ai-card-profiles.json` at runtime and silently has no profiles otherwise |
| P1-5 | The shape of `SharedCommanderCastCandidate`, to fill `name` and `cmc` in `toView` | `server/src/state/modules/can-respond.ts` | I did not read it; it decides how a commander cast is scored |
| P1-5 | Every call site of `enumerateAIActionCandidates` | `grep -n enumerateAIActionCandidates server/src` | The `kinds` filter in `applyBrain` assumes the land-only and ability-only calls are the only others |
| P1-5 | Order of `state.stack` (is the top the last element?) and what a stack item carries | `server/src/state` stack modules | `stackTop` and its mana value drive the counterspell policy |
| P1-5 | Adding `aiBrain` to `state.players[]` does not reach client payloads or replay data | `registerAIPlayer` writes `isAI`, `strategy` and `aiStrategy` on the same objects, so the pattern exists; check the state-to-client view | A leaked or persisted field is harmless but should be a decision, not an accident |
| P1-5 | How the harness registers AI seats | `prepareLiveGame` in the e2e file (it calls `registerAIPlayer`) | `aiBrain` must be set after registration on the same player objects |
| P1-6 | Where the live server's environment variables are set | your deploy config | PR G flips `AI_BRAIN` there |

**What this map is grounded on.** I read these in the repo and the sections above rely on them: all fifteen step kinds in the P1-4 role table exist in the IR union, and steps carry a `raw` clause string; `conditional.steps`, `conditional.elseSteps` and `choose_mode.modes[].steps` hold nested steps; `enumerateAIActionCandidates` ends with a priority sort and a bare `return`; the main-phase loop enumerates lands separately and then tries the rest in order until one makes progress; `advanceLiveGame` has a once-per-turn branch to hook; the e2e file's `stateSnapshot` fields; both `strict: false` tsconfigs, `resolveJsonModule` only on the server's, and `server/tsconfig.json` including only `src`; the server vitest setup; and that none of the new exported names exist anywhere in `rules-engine/src`, `server/src` or `shared/src`.

**What I did not check.** I did not run any of the pseudocode, the parser on real cards, or the existing test suites. The role-table behaviour for specific cards (Sol Ring, Cultivate, Counterspell and the rest) is what the P1-4 tests assert, so the first run is where any disagreement between this map and the real parser output will show.
