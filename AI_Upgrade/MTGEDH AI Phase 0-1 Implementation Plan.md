# MTGEDH AI: Phase 0-2 Implementation Plan

Oct 30, 2026 · @Bobby

## Scope

This plan covers Phase 0 (measure), Phase 1 (evaluate) and Phase 2 (plan) of the strategy document. When Phases 0 and 1 are done, you can run a reproducible four-bot game on the real engine, see why each bot made each decision, and run a new scorer in shadow mode beside today's. Phase 2 then adds a planning bot that checks for lethal, weighs the crack-back, and picks attack targets, blocks and play order by their effect on its chances.

**In scope:** the `Observation` builder and information-leak test, the decision trace, a headless self-play harness, the first puzzle fixtures, the board evaluator, win-probability softmax and weight fitting, `CardAIProfile` generation, and the shadow-mode comparison. Phase 2 adds a combat resolver, a lethal check and a crack-back estimate, 24 more puzzles, attack, block and turn planners behind a `v2` brain, and a gate that compares `v2` with `v1`.

**Out of scope:** seat memory and table reading, lookahead with a forward model, and personas (Phases 3 to 5). They are outlined in the strategy document and get their own plan once the Phase 2 gate has passed. That outline now also specifies a deck game plan (win routes, must-answer roles, mulligan sampling), opponent belief priors, poison and sweeper exposure on the evaluator, and a human-move overlap check. None of those are part of `v1` or `v2`.

**Safety rule:** live games do not change behaviour until a gate passes: the Phase 1 gate for the `v1` brain, the Phase 2 gate for `v2`. Everything lands behind an environment flag or in shadow mode, so each task can be merged on its own and reverted on its own.

**How to read the tasks:** each has an ID (`P0-1`, `P1-3`), the files it touches, an interface where one is new, and an acceptance test that decides when it is done. Do them in the order shown in the dependency diagram.

## Spike results

All four open questions from the strategy document were checked against commit `e43d44e`, and the answers change the plan in two places: a seeded AI-vs-AI harness already exists, and copying game state is cheap, so the real obstacle to lookahead is engine side effects.

| Check | What was done | Result | Effect on the plan |
| --- | --- | --- | --- |
| Hidden-information reads | Searched `ai.ts`, `ai-handlers/` and the `rules-engine/src/aiEngine*` files for reads of zones, libraries and hands | No read of an opponent's hand or library contents. Every `.hand` read is for the deciding seat. Other-player zone reads are graveyards (public) and library size (public). Own-library contents are read for deck profiling | P0-2 still adds the leak test, because grep cannot see indirect reads through shared helpers outside these folders. It also permutes the bot's own library order |
| State clone cost | Ran the existing live test to turn 15 (3 AI players) and timed `structuredClone(game.state)` | State is about 1.0 MB of JSON; `structuredClone` takes about 1.5 ms and a JSON round trip about 4.1 ms. Players and zones are 90% of the bytes. The library map lives outside `game.state` | Copying is not the blocker. Stepping the engine on a copy is, because engine code persists events, broadcasts to sockets and uses global singletons such as `ResolutionQueueManager`. Phase 4 should use the abstract model, as planned |
| IR coverage for AI tagging | Parsed the first 3,000 commander-legal cards with `parseOracleTextToIR` and compared against the substring rules the AI uses today | 2,963 cards have rules text; no parser exceptions; 2,930 (98.9%) yield at least one typed step; 6 contain an `unknown` step. Substring "destroy or exile" flags 524 cards, but only 290 have a destroy or exile step, so 234 (45%) are false positives such as Disposal Mummy and Campfire. Draw: 383 by substring, 334 by IR step | The IR is a better source for roles. Object selectors are often raw text (for example "target permanent card from your graveyard"), so P1-4 still needs a light check on the selector text. The repo's May 2026 gap audit found some gap in 6,356 of 29,800 cards (21%), so the analyzer fallback is still needed |
| Deck pool and headless play | Read the precon loaders and ran `precon-live-e2e.integration.test.ts` | The test already runs a seeded three-AI game on the real engine: 7 turns in about 3.2 s, 15 turns in about 14 s on this machine. The old test decks are text files in `precon_json/`; the current pool is the 169-deck catalogue in `shared/src/precons.ts` with decklists in `server/data/precon-decklists.sqlite`, baked from MTGJSON deck files | P0-3 extends the existing test into a runnable harness and builds the pool from the baked store. The SQLite file is not in the repo, so I could not count how many decks are baked on your machine |

Two caveats. The IR sample is the first 3,000 matching cards in file order, not a random draw, and the full pool takes about four minutes to parse (about 157 cards per second), so generate profiles ahead of time instead of parsing during games. And the timing figures come from this sandbox with the `aggressive` strategy at difficulty 0.5; treat them as an order of magnitude, not a benchmark.

Your sample deck file confirms the MTGJSON deck format the bake script reads: `data.commander`, `data.mainBoard` (each card with `name` and `count`), plus `data.name`, `data.type` and `data.code`. The sample was a Secret Lair drop, which the bake excludes; precons carry `type` of "Commander Deck".

## Task order

&#91;embedded content: task dependencies · 12 tasks, 2 gates\]

The highlighted boxes are gates: a pass or fail call made on measured numbers, not a coding task. Task numbers double as the merge order, because every task's prerequisites have a lower number. Five tasks have no prerequisites (P0-1, P0-3, P0-4, P0-5 and P1-4), so two people can split the work: one takes information safety (P0-1, P0-2) and the other takes measurement (P0-3 to P0-5).

Only P1-1 and P1-4 can start before the Phase 0 gate, and P1-1 needs P0-1 to have landed first. P1-2 waits for P0-6 because it logs positions and calibrates against baseline games, and P1-3 and P1-5 both build on P1-2.

### Phase 2 order

&#91;embedded content: Phase 2 task dependencies · 8 tasks, 1 gate\]

The resolver, lethal check, crack-back estimate and puzzle growth (P2-1 to P2-4) are pure code and tests, so they can start before the Phase 1 gate. The three planners (P2-5 to P2-7) change what the bot does and build on the Phase 1 scorer and evaluator, so they wait for it. As before, every task's prerequisites have a lower number.

## Phase 0 tasks

Phase 0 changes no bot behaviour: every task adds a seam, a measurement or a test. Paths are proposed locations beside the existing AI code. The hook points named are existing functions, checked at commit `e43d44e`.

### P0-1 Observation builder

**Goal:** one function that turns `game.state` into exactly what a player may know, so the evaluator, scorer and later planner read an `Observation` and never `game.state`.

**Files:** new `rules-engine/src/ai/observation.ts` (the types), new `rules-engine/src/ai/buildObservation.ts` (the builder), and export lines in `rules-engine/src/index.ts`. The builder lives in `rules-engine`, not `server`, because the Phase 2 planners run inside `rules-engine` and cannot import from `server`. It takes the game state object (`game.state` on the server, `context.gameState` in the decision functions), so both sides can call it.

**Interface** (proposed; match field names to the server state while writing the builder):

```ts
export interface Observation {
  seat: PlayerID;
  turn: number; phase: string; step?: string;
  activeSeat: PlayerID; priority: PlayerID;
  self: {
    life: number; hand: CardView[]; deckList: CardView[]; // own cards, unordered
    librarySize: number; graveyard: CardView[]; exile: CardView[];
    battlefield: PermanentView[]; commanders: CommanderView[]; manaPool: ManaPool;
  };
  opponents: Array<{
    id: PlayerID; life: number; handSize: number; librarySize: number;
    graveyard: CardView[]; exile: CardView[]; battlefield: PermanentView[];
    commanders: CommanderView[]; eliminated: boolean;
  }>;
  stack: StackItemView[];
  commanderDamage: Record<PlayerID, Record<string, number>>; // victim, then the commander's card id, the key the engine uses
}
export function buildObservation(state: any, seat: PlayerID): Observation;
```

**Steps:**

- Copy fields into `CardView` and `PermanentView` by name. Never spread a whole player or card object, so a new hidden field cannot slip through.
- Show face-down permanents and face-down exiled cards without a name or oracle text.
- Sort every array by id, and sort `deckList` by name: the bot knows its decklist, not its library order.
- Fill each permanent's power, toughness and keywords from the engine's effective values (`getCreaturePower`, `getCreatureToughness`, `extractCombatKeywords`), not from the printed card, so planners see what combat will use. The snapshot fixture includes a creature with a pump effect.

**Done when:** a unit test builds an `Observation` for a four-player fixture state and matches a stored snapshot, the opponent type has no `hand` or `library` property, and both workspaces typecheck. Nothing calls the builder yet.

### P0-2 Leak test

**Goal:** a test that fails if a bot ever uses information it should not have.

**Files:** new `server/tests/ai.observation-leak.test.ts`, using the fixture and executor-mock style of `ai.cast-sequencing.integration.test.ts`.

**Steps:**

- Build three four-player states: a main phase with several castable spells, a declare-attackers step, and a response window.
- For each, build a twin state: swap each opponent's hand and library for other cards of the same counts, and reorder the bot's own library.
- Check 1 (strong): `buildObservation` returns deep-equal output for the state and its twin.
- Check 2 (behavioural): stub `Math.random`, run `handleAIPriority` on both with the cast and activate executors mocked, and assert the same first action is requested. This covers reads that bypass the `Observation` until Phase 1 moves decisions onto it.

**Done when:** both checks pass on current code, as the spike predicts. Prove the test can fail once: temporarily add the mana value of an opponent's first hand card to a spell's priority in `calculateSpellPriority`, confirm check 2 fails, revert, and say so in the PR.

### P0-3 Self-play runner

**Goal:** a headless command that plays many four-bot games on the real engine and writes one result line per game, reproducibly.

**Files:** new `server/tests/helpers/liveGameHarness.ts`, `server/tests/helpers/preconPool.ts`, `server/tests/ai-selfplay.harness.test.ts`, new `rules-engine/src/aiRandom.ts`, edits to `server/tests/precon-live-e2e.integration.test.ts` and `server/package.json`.

**Steps:**

- **Extract the harness.** Move `createNoopIo`, `resolveDeckCards`, `instantiateDeckCards`, `selectCommanders`, `prepareLiveGame`, `advanceLiveGame`, `cleanupLiveGame` and `stateSnapshot` out of `precon-live-e2e.integration.test.ts` into `liveGameHarness.ts`, parameterised on decks, seat count, seed and per-seat settings (`aiStrategy`, `difficulty`, later a brain name). The e2e test imports them and behaves as before.
- **Seed the AI's randomness.** The engine's shuffles use the seeded PRNG, but the AI does not: `Math.random()` is called in `rules-engine/src/AIEngine.ts` (`shouldMakeMistake`), `aiEngineCombatSupport.ts`, `aiEngineCoreSupport.ts`, `aiEngineTargetSupport.ts`, and three times in `server/src/socket/ai-handlers/aiLegacyActivateAbilityHandlers.ts`. Add `aiRandom()` and `seedAIRandom(seed)` with `Math.random` as the default, replace those seven calls (two choose a random opponent and one only builds a token id; afterwards a search for Math.random in the AI files should find none), and seed it from the game seed in the harness. Live games behave as before because the default is unchanged.
- **Build the deck pool.** `preconPool.ts` lists decks with `listPreconDeckMeta()`, keeps sources `mtgjson` and `mtgjson-local` with `cardCount` 100 (the bake writes commanders before the main board for these, which `selectCommanders` relies on), and loads lines with `getPreconDecklistLines`. Decks with unresolved card names are skipped and listed in the report.
- **Schedule pods.** Draw four distinct decks per pod with a seeded shuffle and play four games, putting the challenger brain in each seat once and baseline in the other three. Until P1-5 exists, all four seats run `v0`.
- **Write the runner.** `ai-selfplay.harness.test.ts` is skipped unless `AI_SELFPLAY_GAMES` is set; add an `ai:selfplay` script to `server/package.json`. Environment: `AI_SELFPLAY_GAMES`, `AI_SELFPLAY_SEED`, `AI_SELFPLAY_OUT` (JSONL path), `AI_SELFPLAY_SHARD` (`i/n`) and `AI_SELFPLAY_MAX_TURNS` (default 60, to be tuned by P0-6). Each line holds the seed, deck ids, seat brains, winner seat or null, end reason (`win`, `turn-limit`, `stall` or `error`), turns and real milliseconds.
- **Parallelise by process.** The server's `games` map, `priorityTimers` and `ResolutionQueueManager` are shared across the process, so run shards as separate processes, not threads.

**Done when:**

- `precon-live-e2e` still passes.
- `AI_SELFPLAY_GAMES=4 AI_SELFPLAY_SEED=1 npm run ai:selfplay --workspace=server` finishes and writes four lines; running it twice gives lines that are identical apart from real milliseconds.
- No game ends as `error` because of the harness itself. Stalls and turn limits are recorded outcomes, not failures.

### P0-4 Decision trace

**Goal:** every AI decision explains itself in a file, so “why did it do that?” becomes a lookup.

**Files:** new `server/src/socket/ai-handlers/aiDecisionTrace.ts`, plus hooks that change no logic in `aiPriorityHandlers.ts` (the main-phase loop that tries the sorted results of `enumerateAIActionCandidates` in order), `aiActionCandidateHandlers.ts` (`tryAIResponseActions`), `aiPriorityPassCombatExecutors.ts` (`executeDeclareAttackers`, `executeDeclareBlockers`), `aiMulliganHandlers.ts` (`handleAIMulligan`) and `aiKeepHand.ts` (`commitAIKeepHand`).

**Record** (one JSON line per decision):

```ts
interface DecisionTrace {
  v: 1; gameId: string; seq: number; turn: number; phase: string; step?: string;
  seat: PlayerID;
  kind: 'priority' | 'response' | 'attack' | 'block' | 'mulligan';
  candidates: Array<{ kind: string; name?: string; score: number }>; // in the order tried
  chosen: number | null; // index that made progress; null means pass
  note?: string;
}
```

**Steps:**

- Keep the sink off by default. `AI_TRACE_FILE=<path>` appends lines, and `setAIDecisionTraceSink(fn)` lets tests capture records.
- In the main-phase loop, record the sorted candidates the code already holds (kind, card name, `priority`), then set `chosen` to the index whose executor reported progress, or null when the bot passes.
- For combat and mulligan, record the options and the choice the existing function already makes.
- Tracing must not touch RNG, timers or game state.

**Done when:** a unit test with a stub sink shows a fixture main phase producing a record whose candidates are in priority order and whose `chosen` points at the spell cast, and two P0-3 runs of one seed, with and without `AI_TRACE_FILE`, give identical winners and turn counts.

### P0-5 Puzzle suite

**Goal:** a fast set of positions with a known right answer, which catches regressions now and shows Phase 1 improving later.

**Files:** new `server/tests/ai-puzzles/` with a helper `puzzleHarness.ts` and one file per category. Priority decisions use the style of `ai.cast-sequencing.integration.test.ts`: build `game.state` directly, mock the executors, call `handleAIPriority`. Attack, block and mulligan decisions call `new AIEngine()` as `aiBlockDecision.test.ts` does.

**Format:** each puzzle has an id, a one-line description of the position, a list of acceptable actions and a list of forbidden ones. The suite prints a pass table. A puzzle that `v0` fails is marked `knownFailing`, so the suite stays green and the table shows the baseline.

**Steps:**

- Write the helper and 12 first puzzles across: exact lethal including commander damage, not attacking into a clearly lethal block, chump blocking when facing lethal, holding a counterspell for a game-winning spell, not wiping its own board with a sweeper, removing the biggest threat rather than the nearest, playing a land before spells, and keeping or mulliganing a two-land seven.
- List each position and its answer in the PR for owner sign-off (see the open decisions).

**Done when:** the 12 puzzles run in under a minute, every one has an answer you have signed off, and the report shows how many `v0` passes.

### P0-6 Phase 0 gate

**Goal:** freeze `v0` and write down the numbers every later change is compared with.

**Files:** new `server/scripts/selfplay-report.ts` (script `ai:report`; reads the JSONL result files and prints the tables below, with 95% intervals for win rates) and new `docs/ai-baseline-v0.md`.

**Steps:**

- Run 100 games (25 pods, four seat rotations each) with `AI_SELFPLAY_SEED=1000`, split across shards.
- Record in the report: how many decks the pool holds and which were skipped; games by end reason; median and 90th-percentile turns and real seconds per game; win share by seat, to expose any turn-order skew; win share by deck, to spot broken decks; decks with the most `stall` or `error` results; the `v0` puzzle pass count; and the commit hash.
- Fix failures that belong to the runner. Engine bugs it uncovers go to your issue tracker, not into this plan.

**Gate** (thresholds are proposals; see the open decisions): at least 90 of 100 games end in a win or at the turn limit, none as `error`; the repeat-run check from P0-3 passes; the leak test is green; the trace is on; the puzzle suite is committed; the report is committed. If more than 20% of games hit the turn limit, raise `AI_SELFPLAY_MAX_TURNS` or read the traces before starting Phase 1, because win rate means little when games rarely finish.

**Time estimate (unverified):** the spike ran 15 turns of a three-player game in about 14 seconds. If a four-player game to 30 turns takes about a minute, 100 games across four processes would take roughly 25 minutes. Treat this as a guess until P0-3 produces real timings.

## Phase 1 tasks

Phase 1 builds the new scorer and runs it beside the old one. Live games keep using `v0` until the Phase 1 gate passes. The evaluator uses only information every seat can see (hand size, not hand contents), so a position can be scored from any seat's `Observation`; card-level knowledge enters through the card profiles instead.

### P1-1 Board evaluator

**Goal:** a pure function that turns an `Observation` into one number per seat, higher meaning that seat is doing better.

**Files:** new `rules-engine/src/ai/evaluatorFeatures.ts`, `rules-engine/src/ai/evaluator.ts` and `rules-engine/test/aiEvaluator.test.ts`.

**Interface:**

```ts
export type FeatureName =
  | 'life' | 'commanderDamageTaken' | 'boardValue' | 'otherPermanents'
  | 'manaSources' | 'handSize' | 'commanderInPlay' | 'loyalty' | 'attackPower';
export type SeatFeatures = Record<FeatureName, number>;
export type EvalWeights = Record<FeatureName, number>;

export function seatFeatures(obs: Observation): Record<PlayerID, SeatFeatures>;
export function seatValues(f: Record<PlayerID, SeatFeatures>, w: EvalWeights): Record<PlayerID, number>;
export const DEFAULT_WEIGHTS: EvalWeights; // hand-set starting guess, replaced by P1-3
```

**Steps:**

- Compute each feature per seat from that seat's own public board, scaled so a typical mid-game value is between 0 and 1 (for example life divided by 40). Comparable scales keep the fit in P1-3 well behaved.
- `boardValue` mirrors `evaluatePermanentValue` in `aiEngineValueSupport.ts` (power plus toughness times two, plus keyword bonuses) but reads `PermanentView`. Add a parity test against the existing function on shared fixtures so the two cannot drift apart.
- `commanderDamageTaken` uses the largest total from any single commander, since 21 from one source ends the game. `attackPower` is the combined power of untapped creatures that could attack.
- Set `DEFAULT_WEIGHTS` by hand to something plausible. It is a guess, and P1-3 replaces it with fitted values.

**Done when:** unit tests show that adding a creature raises that seat's value, losing life lowers it, and 20 commander damage lowers it more than 5; the parity test passes on at least ten fixtures; and `seatFeatures` on a late-game four-player fixture runs in under 1 ms (a target; record the measured time in the PR, because search will call this many times later).

### P1-2 Win probability and position log

**Goal:** turn seat values into win probabilities, and record positions during self-play so P1-3 has data to fit.

**Files:** new `rules-engine/src/ai/winProbability.ts`, edits to `server/tests/helpers/liveGameHarness.ts`.

**Interface:**

```ts
// P_i = exp(V_i / tau) / sum over live seats j of exp(V_j / tau)
export function winProbabilities(
  values: Record<PlayerID, number>, eliminated: PlayerID[], tau?: number, // tau defaults to 1
): Record<PlayerID, number>;
```

**Steps:**

- Subtract the maximum value before exponentiating so large gaps cannot overflow. Eliminated seats get probability 0 and the rest renormalise.
- In the harness, when the turn number changes, build an `Observation` from the active seat, compute `seatFeatures`, and append one JSONL line to `AI_POSITIONS_FILE`: game id, turn, features per seat, eliminated seats. Winners are joined from the P0-3 result file by game id when fitting.

**Done when:** unit tests confirm probabilities sum to 1, equal values give equal shares, higher value never lowers a share, and a 500-point gap does not produce NaN. A four-game run writes a position for every turn start, and positions built from two different seats' views of the same state are identical, which shows the features really are public-only.

### P1-3 Weight fitting

**Goal:** replace the hand-set weights with weights fitted to who actually won.

**Files:** new `server/scripts/fit-evaluator.ts` (script `ai:fit` in `server/package.json`), output `rules-engine/src/ai/evaluatorWeights.v1.json`, report `docs/ai-evaluator-fit.md`.

**Method:** a conditional logit. At each logged position the model gives each live seat the score `w · features`, turns the scores into probabilities with the P1-2 softmax, and maximises the log-likelihood of the observed winner with a small L2 penalty. The loss is convex, so plain gradient descent in TypeScript is enough for about ten weights and needs no new dependency. With the weights fitted jointly, `tau` stays at 1.

**Steps:**

- Generate data with `v0` on seeds 2000 and up, disjoint from the P0-6 baseline seeds. About 400 games gives roughly 10,000 positions if games last about 25 turns. Positions within one game are strongly correlated, so the real sample is closer to 400 outcomes than 10,000 rows. Treat both numbers as estimates until the first run.
- Use only games that end in a win; skip turn-limit games.
- Split by game, 80% to fit and 20% held out, never by position.
- The report shows held-out log-loss against two baselines (uniform, which is the log of 4, about 1.386, and a life-only model), a reliability table (predicted win probability in 10-point buckets against observed win rate), and each weight with its sign.

**Done when:** held-out log-loss beats both baselines; every reliability bucket with at least 100 positions is within 10 points of the observed rate (a proposal); and the weight signs make sense (life, board value and mana sources positive, commander damage taken negative). If it does not, keep `DEFAULT_WEIGHTS` and carry on: P1-5 uses whichever weights exist, and the report says what failed.

**Known limit:** the labels come from `v0` games, so the fit describes what wins among weak bots. Refit with `v1` games after the first strong version.

### P1-4 Card profiles

**Goal:** a precomputed `CardAIProfile` for every commander-legal card, built from the parsed Oracle text instead of substring matching.

**Files:** new `server/scripts/generate-ai-card-profiles.ts` (script `ai:profiles`), new `server/src/socket/ai-handlers/aiCardProfile.ts` (types and `getCardAIProfile`), generated `server/data/ai-card-profiles.json`, hand-written `server/data/ai-card-overrides.json`, report `docs/ai-card-profiles.md`.

**Interface:**

```ts
export type CardRole =
  | 'ramp' | 'draw' | 'removal' | 'sweeper' | 'counterspell' | 'protection'
  | 'token_maker' | 'tutor' | 'recursion' | 'lifegain' | 'wincon';

export interface CardAIProfile {
  oracleId: string; name: string;
  roles: CardRole[];
  timing: 'instant' | 'sorcery_speed';
  needs: Array<'target_creature' | 'target_permanent' | 'target_player' | 'graveyard_card'>;
  source: 'ir' | 'analyzer' | 'override';
}
```

**Steps:**

- Parse each card with `parseOracleTextToIR` and map step kinds to roles with the table below. Where the step does not say enough (the spike found selectors are often raw text such as “target permanent card from your graveyard”), apply a light check on the selector text.
- Fall back to `CardAnalyzer.analyzeCard` when the IR gives no typed step or only `unknown` and `raw` steps, and record `source: 'analyzer'`. The repo's May 2026 gap audit found some gap in 21% of cards, so expect this path to be used.
- Apply `ai-card-overrides.json` last (`source: 'override'`), keyed by card name, so a wrong tag is fixed with a one-line edit and no code change.
- Read cards through `readOracleCardsSync` from `oracleCardsIndex.ts`, the same source the e2e test uses. The spike parsed about 157 cards per second, so a full run takes a few minutes: generate ahead of time, never during a game.

| IR step kind | Role | Selector text check |
| --- | --- | --- |
| `add_mana` | `ramp` | none |
| `draw` | `draw` | none |
| `destroy`, `exile`, `gain_control`, `deal_damage` | `removal` | becomes `sweeper` when the text says each or all |
| `counter_spell` | `counterspell` | none |
| `create_token` | `token_maker` | none |
| `search_library` | `tutor` | becomes `ramp` when it fetches basic lands |
| `move_zone` | `recursion` | only when the source is the graveyard |
| `prevent_damage`, `grant_temporary_ability` | `protection` | only for hexproof, indestructible or damage prevention |
| `gain_life` | `lifegain` | none |
| `win_game`, `take_extra_turn` | `wincon` | none |

**Done when:** the generator runs over the whole pool with no exceptions and writes a profile for every commander-legal card; the report gives the share of profiles by `source` and the count of cards with no role; Disposal Mummy and Campfire, which the substring rule wrongly flags as removal, get no removal role; and the report lists 20 random disagreements between the old substring rules and the new profiles for you to judge.

### P1-5 Utility scorer in shadow mode

**Goal:** a new way to rank the candidate actions the bot already enumerates, run beside the old ranking and compared with it, without changing what the bot does.

**Files:** new `rules-engine/src/ai/utilityScorer.ts` and `rules-engine/src/ai/rolePolicies.ts` (pure), new `server/src/socket/ai-handlers/aiBrain.ts` (brain selection and the shadow comparison), a small edit in `enumerateAIActionCandidates` in `aiActionCandidateHandlers.ts`, and new `server/scripts/shadow-report.ts`.

**Interface:**

```ts
export type Brain = 'v0' | 'shadow' | 'v1';

export interface Consideration {
  name: string;
  kind: 'gate' | 'preference';       // gates multiply, preferences add
  input: (ctx: ScoreContext) => number;
  curve: (x: number) => number;      // maps the input to 0..1
  weight?: number;                   // preferences only
}
export interface ScoredCandidate { index: number; score: number; parts: Record<string, number> }

export function rankCandidates(
  obs: Observation, candidates: CandidateView[], profile: (name: string) => CardAIProfile | undefined,
): ScoredCandidate[];
```

**Steps:**

- **Context, not simulation.** Phase 1 has no forward model, so the evaluator does not score the state after an action. It supplies context to the considerations: this seat's win probability, the leader's, mana available, turn number, hand size. Each role policy turns that context into a score, for example `sweeper` is gated on this seat being behind on board, `counterspell` is held while mana is open and a threat is on the stack, and `ramp` is preferred early.
- **Scope.** Rank land, ramp, draw, removal, sweeper, counterspell and commander casts in main phase and response windows. Everything else keeps `v0`'s priority, so a candidate with no profile cannot be dropped.
- **Brain switch.** Read the brain from the seat (`player.aiBrain`, set by the harness) or from `AI_BRAIN`. `v0` is the default and behaves as today. `shadow` runs `rankCandidates` after the existing sort, adds the result to the P0-4 trace record in a new optional shadow field, and leaves the order unchanged. `v1` reorders by the new score.
- **No randomness.** The scorer must not call `aiRandom`, so shadow mode cannot disturb a seeded run.
- **Report.** `shadow-report.ts` reads the trace and prints the share of decisions where the new top candidate differs from `v0`'s, split by role, plus 30 sampled disagreements with the position, for you to mark which choice was better.

**Done when:**

- A P0-3 run with `AI_BRAIN=shadow` on the P0-6 baseline seeds gives exactly the same winners and turn counts as the baseline, and its trace carries the shadow entries.
- Unit tests cover each role policy with fixture contexts, including a case where a gate blocks an otherwise high-scoring candidate.
- The puzzle suite with `AI_BRAIN=v1` passes at least as many puzzles as `v0`.
- You have reviewed the 30 sampled disagreements.

### P1-6 Phase 1 gate: v1 against v0

**Goal:** decide on measured results whether `v1` plays better than `v0`.

**Files:** new `docs/ai-phase1-gate.md`; reuses `server/scripts/selfplay-report.ts`.

**Steps:**

- Run 320 games (80 pods, each played four times with `v1` in a different seat and `v0` in the other three) on seeds 3000 and up. Do not tune against these seeds; if the gate fails, fix and rerun on new seeds.
- Report the `v1` win rate with 95% intervals (Wilson, and a bootstrap that resamples whole pods; the gate uses the lower of the two lower bounds), the end-reason mix, median real seconds per game, and win rate by seat and by deck.

**Gate (proposed):**

- The lower bound of the `v1` win-rate interval is above 25%, the share equal-strength seats would win. With 320 games, a true win rate of 32% passes this at most about 80% of the time (a little less if resampling whole pods widens the interval), using the sample sizes in the measurement protocol.
- The share of games ending in `stall` or `error` is no higher than for `v0`.
- Median seconds per game is no more than 25% above `v0`'s.
- The puzzle suite passes at least as many puzzles as `v0`.

A pass lets you switch `AI_BRAIN` to `v1` for live games in a separate PR. A fail sends you back to the shadow disagreements and the traces of lost games.

## Phase 2 tasks

Phase 2 teaches the bot to plan: to see how a combat will resolve, check for lethal, weigh the crack-back, pick attack targets and blocks by their effect on its chances, and sequence its plays under its mana. P2-1 to P2-4 are pure code and tests. The planners (P2-5 to P2-7) run behind a new brain, `v2`, which is `v1` scoring plus the planners; live games change only when you switch the default.

Two rules apply to every planner. First, the attack and block planners run inside `rules-engine` (`makeBasicAttackDecision`, `planAIBlocks`), which cannot import from `server`, which is why the `Observation` builder lives in `rules-engine` (P0-1). Second, any exception or timeout falls back to the `v1` decision, so a planner bug costs one decision, not a stalled game.

### P2-1 Combat resolver

**Goal:** a pure function that says what happens in a combat, given the attacks and the blocks.

**Files:** new `rules-engine/src/ai/combatResolver.ts` and `rules-engine/test/combatResolver.test.ts`. It builds on `CombatCreature` (`combatAutomation.ts`), `BlockAssignment` (`aiEngineBlockPlanning.ts`) and `evaluateSingleBlockOutcome`, which already handles one blocker against one attacker with first strike, double strike, deathtouch and indestructible, but not trample, several blockers, lifelink or several defenders.

**Interface:**

```ts
export interface DefenderState {
  id: string; life: number;
  commanderDamageTaken: Record<string, number>; // by attacking commander's card id, as readCommanderDamageTaken reads it
}
export interface CombatOutcome {
  deaths: string[];                                        // creature ids
  lifeLost: Record<string, number>;                        // by defender id
  lifeGained: Record<string, number>;                      // lifelink, by controller id
  commanderDamage: Record<string, Record<string, number>>; // defender id, then attacker card id
  defendersKilled: string[];                               // life 0 or less, or 21 commander damage
  uncertain: boolean;                                      // the result depends on something the model skips
}
export function resolveCombat(
  attacks: ReadonlyArray<{ attacker: CombatCreature; defenderId: string }>,
  blocks: readonly BlockAssignment[],
  creatures: ReadonlyMap<string, CombatCreature>,
  defenders: readonly DefenderState[],
): CombatOutcome;
```

**Steps:**

- Model two damage steps, first strike and double strike first, then regular. Handle deathtouch, trample (excess damage over lethal goes to the defender, and with deathtouch one damage counts as lethal), indestructible, lifelink, damage already marked, and several blockers on one attacker (the attacker kills the most valuable blockers its damage allows).
- Read power, toughness and keywords through `getCreaturePower` and `extractCombatKeywords`, never from printed card values, so continuous effects count.
- Set `uncertain` when a creature involved has something the model skips: a light text check for regeneration, protection, damage prevention or replacement effects. Tricks and triggers are not modelled, which is why the flag exists.

**Done when:** a table of at least 40 cases passes, including a generated grid of one-on-one cases (every combination of first strike, double strike, deathtouch and indestructible on each side) whose survival results agree with `evaluateSingleBlockOutcome`, plus multiple blockers, trample, lifelink, commander damage reaching 21, and two defenders in one combat; and a regeneration case sets `uncertain`.

### P2-2 Lethal check

**Goal:** find the attacks that kill a player even against that player's best blocks.

**Files:** new `rules-engine/src/ai/lethalCheck.ts` and a test file beside the resolver's.

**Interface:**

```ts
export interface LethalPlan {
  targetId: string;
  attackers: Array<{ creatureId: string; defendingPlayerId: string }>; // the shape executeDeclareAttackers takes
  certainty: 'guaranteed' | 'unless_trick'; // unless_trick: the defender has open mana and cards in hand
}
export function findLethal(input: {
  attackers: readonly CombatCreature[];
  defenders: readonly DefenderState[];
  blockersByDefender: ReadonlyMap<string, readonly CombatCreature[]>;
  trickRisk: Record<string, boolean>; // from the Observation: untapped mana and hand size
}): LethalPlan[];
```

**Method:** for each defender, assume the blocks that save the most damage: each untapped legal blocker stops the attacker it stops most, menace attackers need two blockers, and trample only loses what the blocker's toughness absorbs. Confirm the result with `resolveCombat`. Damage counts toward life and toward 21 from any single commander, including damage taken in earlier turns. If several defenders can be killed, return each and let the scorer choose.

**Done when:** at least 15 fixtures pass: commander damage carried over from earlier turns, trample past chump blockers, menace, a no-lethal case, two killable opponents returning both, and `unless_trick` set only when the defender has open mana and cards in hand. A typical late-game check runs in under 1 ms (a target; record the measured time).

### P2-3 Crack-back estimate

**Goal:** estimate how much damage the table could send back after this bot attacks.

**Files:** new `rules-engine/src/ai/crackBack.ts` and a test file.

**Interface:**

```ts
export interface CrackBack {
  perOpponent: Record<string, number>; // damage each opponent could deal to me next turn
  worstCase: number;                    // the largest single opponent's damage
  tableEstimate: number;                // worstCase + discount * sum of the other opponents
  lethal: boolean;                      // tableEstimate >= my life after combat, or a commander reaches 21
}
export function estimateCrackBack(args: {
  lifeAfterCombat: number;
  myUntappedBlockers: readonly CombatCreature[]; // creatures that stay home, plus vigilance
  opponents: ReadonlyArray<{ id: string; attackers: readonly CombatCreature[]; commanderIds?: readonly string[] }>;
  commanderDamageTaken?: Record<string, number>;  // already dealt to me, by commander card id
  discount?: number;                              // named constant, default 0.5
}): CrackBack;
```

**Method:** assume every creature an opponent controls can attack next turn, let my remaining blockers stop the largest attackers first, and count what gets through. The discount exists because opponents also attack each other, so the sum of everyone's best attack overstates the risk. 0.5 is a guess; tune it with the puzzle suite, and keep it a named constant, never a number buried in the code. Commander damage counts separately: if an opponent's commander would get through my blockers and its damage plus what it has already dealt to me reaches 21, the crack-back is lethal whatever my life total. Pump spells, haste and tricks are not modelled.

**Done when:** at least 10 fixtures pass (no blockers, blockers absorbing the biggest attackers, one huge opponent versus several small ones, and a commander that reaches 21 damage while my life is still 40) and the boundary where `lethal` flips is tested at exactly my life.

### P2-4 Puzzle growth

**Goal:** grow the puzzle suite from 12 to at least 36 positions aimed at what Phase 2 changes, and keep some back so tuning cannot memorise them.

**Files:** `server/tests/ai-puzzles/`, using the P0-5 helper.

**Steps:**

- Add 24 puzzles: lethal including commander damage (4), not attacking into a lethal crack-back (4), choosing a target among three opponents (4), multi-creature combats with first strike, deathtouch and trample (4), blocks when ahead and when behind, including trades that help the leader (3), and sequencing under mana: ramp before the big spell, never trying a spell it cannot pay for, summoning-sick mana creatures, mana from rocks already in play, and spending mana to avoid discarding (5). The 24 drafts are in the appendix at the end of this plan.
- Mark 8 of the 36 `heldOut`. Nobody looks at those while writing or tuning P2-5 to P2-7; they run once, at the gate. You pick them, before the planners are written.
- Record the `v0` and `v1` pass counts in the PR. The `v1` count is the Phase 2 baseline.

**Done when:** 36 puzzles run in under two minutes, you have signed off every answer, 8 are marked held out, and the `v0` and `v1` pass counts are recorded.

### P2-5 Attack planner

**Goal:** choose attackers and their targets by lethal, crack-back and effect on win probability.

**Files:** new `rules-engine/src/ai/attackPlanner.ts`; edits to `makeBasicAttackDecision` in `aiEngineCombatSupport.ts`, to `AIPlayerConfig` (a new optional `brain` field, set from the seat's brain so the `rules-engine` side can choose), to `aiBrain.ts` (add `'v2'` to `Brain`), and to `DecisionTrace` (a new optional `ms` field for elapsed milliseconds).

**Steps:**

- **Lethal first.** Call `findLethal`. A `guaranteed` plan is declared. An `unless_trick` plan is declared when the crack-back is survivable.
- **Otherwise, per-attacker targets by win probability.** For each legal attacker, predict the defender's best blocks, resolve the combat with `resolveCombat`, apply the outcome (life, commander damage, deaths) to a copy of the `Observation`, recompute `seatFeatures` and `winProbabilities`, and take the change in this seat's win probability. Assign greedily over the attackers by value, in two passes. There are rarely more than about ten attackers, so no exhaustive search is needed.
- **Keep enough at home.** If `estimateCrackBack` says lethal, hold back the attackers with the smallest gain until it no longer is.
- **Same output shape.** Return the `DECLARE_ATTACKERS` decision `makeBasicAttackDecision` already returns, so `executeDeclareAttackers` and its forced-attacker merge need no change.
- **Forced attackers and old settings.** Goaded creatures must attack, so the planner treats them as fixed attackers and only picks their targets; the existing forced-attacker merge stays. The `strategy` and `difficulty` settings do not change `v2` attacks in Phase 2 (they come back as persona settings in Phase 5); `v0` and `v1` keep using them.
- **Shadow mode.** `AI_BRAIN=shadow` now also records what this planner would declare next to what the bot declared.

**Done when:** unit tests show lethal declared, no attack that leaves a lethal crack-back, and the target with the largest win-probability gain chosen among three opponents; the lethal and attack puzzles that `v1` failed pass under `v2`; a shadow run reproduces the baseline exactly; and the planner's 95th-percentile time on fixtures is under 50 ms (a proposal; the trace `ms` field gives the real number).

### P2-6 Block planner

**Goal:** choose blocks by their effect on win probability, with the whole attack in view.

**Files:** new `rules-engine/src/ai/blockPlanner.ts`; an edit to `planAIBlocks` in `aiEngineBlockPlanning.ts`, behind `v2`.

**What exists:** `planAIBlocks` already takes free blocks and good trades, chumps only when the attack is lethal on life or commander damage, and handles menace and double blocks. It compares trades with a fixed `creatureValue`.

**Steps:**

- Generate the candidate block sets from the existing planner (free blocks, trades, the chump set, double blocks) plus no block, about ten in all.
- Resolve each with `resolveCombat`, apply it to a copy of the `Observation`, and pick the set with the highest win probability for this seat. No special rule for the leader is needed: a trade that removes the leader's creature lowers the leader's value, which raises this seat's win probability.
- On any exception, return the `planAIBlocks` result.

**Done when:** unit tests show no chump when the damage is survivable, a chump when commander damage would reach 21, and a trade against the leader's creature preferred over an otherwise equal trade against the trailing player's; the block puzzles that `v1` failed pass under `v2`.

### P2-7 Turn planner

**Goal:** choose a short sequence of plays under the mana budget, instead of trying candidates in priority order.

**Files:** new `rules-engine/src/ai/turnPlanner.ts` (the pure search), a server wrapper `server/src/socket/ai-handlers/aiTurnPlanHook.ts`, and an edit to the main-phase loop in `aiPriorityHandlers.ts` (about lines 558 to 625), behind `v2`.

**Interface:**

```ts
export interface PlannerCandidate {
  id: string; kind: 'cast_spell' | 'cast_commander' | 'activate_ability';
  score: number;          // from the P1-5 scorer
  manaCost: number;
  roles: CardRole[];      // from the P1-4 profile
  instantSpeed: boolean;
}
export interface TurnPlan { plays: PlannerCandidate[]; reserved: number; score: number }

export function planTurn(args: {
  candidates: PlannerCandidate[];
  manaAvailable: number;
  affordable: (plays: PlannerCandidate[]) => boolean; // supplied by the server; wraps canAIAssembleManaPaymentPlan
  maxPlays?: number;                                  // default 3
  beam?: number;                                      // default 8
}): TurnPlan;
```

**Steps:**

- Search sequences of up to three plays over the eight best candidates, which is at most 400 sequences (8 + 56 + 336). Score a sequence as the sum of the P1-5 scores plus `MANA_EFFICIENCY` times the share of mana spent.
- Rules before the search: land drops are not planned, because the existing loop already plays them in an earlier step (about lines 493 to 524). Mana rocks and other ramp come before spells that do not need the extra mana, and mana is reserved for a counterspell or protection spell when the P1-5 policy says to hold it up.
- **Plan one step at a time.** The engine is event-driven, so the bot gets priority again after each play. The hook runs the planner at each main-phase priority, executes only the first play through the existing executors, and plans again. Their progress and failure handling stay as they are.
- **This is not a forward model.** The planner ranks plays by the P1-5 scores, not by a predicted change in the evaluator. Looking ahead by simulating effects is Phase 4.
- Record the planned sequence and the elapsed time in the trace.

**Done when:** at least 12 unit tests on `planTurn` pass: with five mana and a two-drop, a three-drop and a five-drop, the plan spends all five on the first two when the scores are equal; ramp comes before the big spell; mana is held for a counterspell; an unaffordable play is never planned. The sequencing puzzles that `v1` failed pass under `v2`. With `AI_BRAIN=v1` the loop behaves exactly as before, and a shadow run reproduces the baseline exactly.

### P2-8 Phase 2 gate: v2 against v1

**Goal:** decide on measured results whether planning improves on `v1` without making the bot fail more often.

**Files:** new `docs/ai-phase2-gate.md`; an edit to the harness to read `AI_SELFPLAY_BASELINE` (default `v0`), so a challenger can play against `v1` seats.

**Steps:**

- Run the whole puzzle suite, held-out puzzles included, for `v0`, `v1` and `v2`, and report pass counts by category. Run the held-out puzzles once.
- Run 320 games on seeds 4000 and up with `v2` as the challenger and `v1` in the other three seats. Report the `v2` win rate with both intervals, the end-reason mix, and median seconds per game.
- From the trace, report failed actions per game (for each decision, the candidates tried that made no progress: the `chosen` index when it is set, or every candidate when it is null) and the 95th-percentile decision time from the `ms` field.

**Gate (proposed):**

- `v2` passes at least 90% of all puzzles and at least 90% of the held-out ones, and no puzzle that `v1` passed now fails without an explanation in the report.
- The share of games ending in `stall` or `error` is no higher than for `v1`, and failed actions per game are no higher than for `v1`.
- Median seconds per game is no more than 25% above `v1`'s, and the 95th-percentile planner decision is under 100 ms.
- The upper bound of the `v2` win-rate interval is not below 25%, which would be a clear regression. The gate does not require `v2` to beat `v1` on win rate: 320 games can only show a large edge, so treat the win rate as information.

A pass lets you make `v2` the default brain in a separate PR. A fail sends you back to the puzzles that `v2` lost and the traces of the decisions involved.

## Measurement protocol

Every claim that a bot got better rests on the same procedure, so numbers from different weeks can be compared.

### Pod design

- A pod is four distinct decks drawn from the pool with a seeded shuffle, seated in a fixed order.
- Each pod is played four times, with the challenger brain in a different seat each time and the baseline brain in the other three. Across the four games the challenger plays each of the pod's decks once and sits in each seat once, so deck strength and turn order average out.
- If the challenger is no better than the baseline, it wins 25% of games. That is the number every result is compared with.
- The four games of a pod share decks, so they are not fully independent. `ai:report` therefore prints two intervals for each win rate: a Wilson interval over games and a bootstrap that resamples whole pods. When they differ, trust the lower bound of the wider one.

### Seed ranges

Each purpose gets its own range, and a range is never reused for another purpose or tuned against.

| Purpose | Seeds | Games | Task |
| --- | --- | --- | --- |
| Baseline for `v0` | 1000 and up | 100 | P0-6 |
| Fitting the evaluator | 2000 and up | about 400 | P1-3 |
| The Phase 1 gate | 3000 and up | 320 | P1-6 |
| The Phase 2 gate | 4000 and up | 320 | P2-8 |

### Commands

Run shards as separate processes and merge the result files. `AI_SELFPLAY_CHALLENGER` is added in P1-5 and defaults to `v0`, which means all four seats run `v0`. `AI_SELFPLAY_BASELINE` is added in P2-8 and defaults to `v0`; it sets the brain of the other three seats, so a challenger can be compared with `v1`.

```bash
# four shards in parallel, each its own process
for i in 0 1 2 3; do
  AI_SELFPLAY_GAMES=100 AI_SELFPLAY_SEED=1000 AI_SELFPLAY_SHARD=$i/4 \
  AI_SELFPLAY_OUT=out/baseline-$i.jsonl npm run ai:selfplay --workspace=server &
done; wait
npm run ai:report --workspace=server -- out/baseline-*.jsonl

# the gate run (once P1-5 exists): the same loop with these variables
AI_SELFPLAY_CHALLENGER=v1 AI_SELFPLAY_GAMES=320 AI_SELFPLAY_SEED=3000 \
AI_SELFPLAY_SHARD=$i/4 AI_SELFPLAY_OUT=out/gate-$i.jsonl npm run ai:selfplay --workspace=server

# the Phase 2 gate (once P2-8 exists): v2 against v1 seats
AI_SELFPLAY_CHALLENGER=v2 AI_SELFPLAY_BASELINE=v1 AI_SELFPLAY_GAMES=320 AI_SELFPLAY_SEED=4000 \
AI_SELFPLAY_SHARD=$i/4 AI_SELFPLAY_OUT=out/gate2-$i.jsonl npm run ai:selfplay --workspace=server
```

### Metrics

| Metric | How it is computed | Used for |
| --- | --- | --- |
| Challenger win rate | wins divided by games, with the two 95% intervals | Phase 1 and Phase 2 gates |
| End-reason mix | share of `win`, `turn-limit`, `stall`, `error` | health of the harness and the bots |
| Turns and real seconds per game | median and 90th percentile | cost, and the speed checks in P1-6 and P2-8 |
| Win share by seat and by deck | wins per seat position and per deck | bias checks: turn order, broken decks |
| Puzzle pass count | puzzles passed out of the suite | regression and improvement signal |
| Held-out log-loss and reliability table | from `fit-evaluator.ts` | quality of the evaluator |
| Shadow disagreement rate | share of decisions where `v1` and `v0` pick different candidates, by role | how far `v1` departs from `v0` |
| Failed actions per game | from the trace: for each decision, the candidates tried that made no progress (the chosen index when it is set, every candidate when it is null), summed over a game | Phase 2 gate |
| Planner decision time | 95th percentile of the trace ms field on planner decisions | Phase 2 gate |

### How many games

To tell a challenger from 25% with 95% confidence (two-sided) and 80% power, the number of games depends on how good it really is:

| True win rate | 40% | 35% | 32% | 30% |
| --- | --- | --- | --- | --- |
| Games needed | 71 | 156 | 314 | 609 |

The 320-game gate run is sized for a true win rate of about 32%. A smaller improvement needs far more games, so decide before a run what size of improvement is worth detecting.

A separate question is how precisely a finished win rate is measured. Near 25%, the 95% margin is about:

| Games | 95% margin on a 25% win rate |
| --- | --- |
| 100 | 8.5 points |
| 400 | 4.2 points |
| 1,000 | 2.7 points |
| 2,500 | 1.7 points |

The Phase 0 baseline of 100 games can show a broken bot. It cannot separate a 30% bot from an even one. The pod bootstrap in `ai:report` is the interval to quote; this table is only the scale.

### Rules that keep results valid

- **Same seed, same game.** P0-3 checks this. If it ever fails, stop trusting comparisons until it is fixed.
- **Freeze the baseline.** `v0` must behave identically before and after the new code lands. Shadow mode proves this for P1-5 by reproducing the baseline run exactly. Any later change to shared AI code means regenerating the baseline.
- **Count turn limits and stalls.** They are outcomes, not missing data. If they are common, win rate describes only the games that finished.
- **No tuning on gate seeds.** If the gate fails, change the bot and rerun on new seeds.
- **Held-out puzzles run once.** Phase 2 keeps 8 puzzles back. Nobody looks at them while the planners are written and tuned; they run once, at the gate.

A nightly 200-game run against `v0` is outlined in the strategy document and belongs after the Phase 1 gate, not in this plan.

## Risks and open decisions

### Risks

| Risk | Why it matters | What the plan does about it |
| --- | --- | --- |
| Games rarely finish | If most games hit the turn limit or stall, win rate describes only the few that ended. The full-finish test in `precon-live-e2e` is skipped by default and the spike did not run it, so the finish rate is unknown | P0-6 measures the end-reason mix and blocks Phase 1 if turn limits exceed 20% |
| Hidden randomness | Seven unseeded `Math.random()` calls in AI code would make two runs of one seed differ, and every comparison would be noise | P0-3 routes them through a seeded source and checks that two runs match. Any other source of drift (timers, `Date.now` ids) shows up in the same check |
| Engine bugs in bot-only games | Four bots playing hundreds of games will hit stalls and errors that human games rarely reach | They are real bugs found cheaply. The report lists the decks involved; bugs go to your issue tracker and a deck that keeps stalling can be dropped from the pool |
| Baseline drift | If shared AI or engine code changes between the baseline and the gate, `v1` is compared with a different `v0` | Record the commit hash in the baseline, prove with shadow mode that `v0` is unchanged, and regenerate the baseline after any later change to shared code |
| Evaluator learns from weak play | The P1-3 labels come from `v0` games, so the fit rewards what wins among weak bots | Accepted for `v1`; refit on `v1` games once it exists |
| Wrong card tags | About 21% of cards have some IR gap, and role tags come partly from raw selector text | Analyzer fallback, the override file, the `source` field, and your review of 20 random disagreements in P1-4 and 30 shadow disagreements in P1-5 |
| Precons only | The pool is precon decks, which sit in a narrow power band. Results may not carry over to the custom decks your friends and family play | See open decision 4 |
| New code peeks at `game.state` | No lint rule is configured in this repo (`npm run lint` exits with an error), so nothing stops it | The leak test's behavioural check catches reads that change a decision; code review covers the rest |
| Run time | Four-bot games are slow and one process runs one game at a time. Estimates here are extrapolated from a three-player run | Shard across processes and run long jobs overnight; P0-3 produces the first real timings |
| Combat resolver blind spots | The resolver ignores tricks, triggers and replacement effects, so a predicted lethal or a predicted safe attack can be wrong when an opponent has open mana and cards | Outcomes carry an uncertain flag, P2-2 marks a lethal plan as unless\_trick when the defender has open mana and cards, and the attack planner declares those only when the crack-back is survivable |
| Planners see wrong stats | If the Observation or the combat creatures carry printed power, toughness and keywords instead of the engine's effective values, every prediction is off | P0-1 fills them from the engine's own functions, P2-1 builds creatures the same way, and a fixture with a pump effect covers both |
| Planning fights the event loop | The engine hands the bot priority one decision at a time, so a multi-step plan can go stale or fail halfway | The turn planner plans one step, executes only the first play, and plans again. Failed actions per game is a gate metric |
| Puzzle overfitting | Tuning the planners against the same puzzles that judge them proves little | 8 of the 36 puzzles are held out, nobody looks at them during tuning, and they run once at the gate |
| Crack-back discount is a guess | Too high and the bot never attacks; too low and it leaves itself open to the table | A named constant with a default of 0.5, tuned on the puzzles and never on gate seeds |
| Planners built on a v1 that fails its gate | P2-5 to P2-7 use the Phase 1 evaluator and scorer, so planning on top of a weak v1 may not help | P2-1 to P2-4 are pure code and tests and stay useful. If the Phase 1 gate fails, fix v1 first; shadow mode can check the planners without changing live play |

### Open decisions

Each has a recommendation, so you can answer with a number and “yes”.

1. **Puzzle answers (P0-5).** I will propose the 12 positions and the acceptable and forbidden plays, but you are the Magic player and the judge. Recommendation: review them in the PR before they count. Several will look arguable; drop any you would not defend.
2. **Gate thresholds.** The proposals are: at least 90 of 100 baseline games ending in a win or at the turn limit (P0-6); a `v1` win-rate lower bound above 25%, no more stalls or errors than `v0`, and median game time within 25% of `v0` (P1-6); and a default turn limit of 60. Recommendation: accept them for now and revise after P0-6 shows real numbers.
3. **Where the generated profile file lives.** Either commit `server/data/ai-card-profiles.json` (simple to deploy, large diff each time it is regenerated) or build it with a script after each Oracle data refresh, as `card-lookup.sqlite` is. I did not check how your repo treats generated data files. Recommendation: build it with a script, and confirm that matches your habits.
4. **Deck pool.** Precons only, or also some real friends-and-family decks? The harness already reads text decklists from `precon_json/`, so adding a few is cheap. Recommendation: precons for the Phase 0, Phase 1 and Phase 2 gates, then add a handful of custom decks before trusting the results for your own games.
5. **Turning `v1` on.** After a pass, a separate PR can switch the default brain. Decide whether that is a global default or a per-game setting your group can pick, for example while you are still testing it against `v0` in live games. Recommendation: a per-game setting first, default later.
6. **Puzzle answers and the held-out set (P2-4).** I will propose 24 more positions, and you choose the 8 held-out ones before any planner code is written. Recommendation: review the answers in the PR as in P0-5, and pick held-out puzzles from every category, not only the easy ones.
7. **How the planners rank plays (P2-5 to P2-7).** They rank by the P1-5 utility scores and by the evaluator's win probability after combat. Predicting the change in win probability from spells and abilities needs a forward model, which is Phase 4. Recommendation: accept the utility-score sums now.
8. **Crack-back discount (P2-3).** How much of the other opponents' attacks the bot assumes will land on it. The default is 0.5, a guess. Recommendation: start at 0.5 and let the puzzle suite show whether the bot is too timid or too reckless.
9. **Phase 2 gate thresholds (P2-8).** The proposals are: 90% of all puzzles and of the held-out ones passing; no more stalls, errors or failed actions than `v1`; median game time within 25% of `v1`; planner decisions under 100 ms at the 95th percentile; and a `v2` win-rate upper bound not below 25%. Recommendation: accept them for now and revise after the first `v2` run shows real timings. A pass lets you switch the default brain to `v2` in a separate PR, with the same per-game-setting-first approach as decision 5.

## Gate checklist

Tick items as they are done. A gate passes only when every item under it is ticked.

### Phase 0 gate (P0-6)

- [x] P0-1: the `Observation` snapshot test passes and both workspaces typecheck.
- [x] P0-2: both leak-test checks pass (attack/response twins included). Deliberate-peek fail-once still to confirm in PR.
- [ ] P0-3: `precon-live-e2e` still passes after the harness extraction.
- [x] P0-3: the seven unseeded `Math.random()` calls in AI code go through `aiRandom`.
- [x] P0-3: two runs of `AI_SELFPLAY_SEED=1` write identical result lines, apart from real milliseconds and join-assigned player ids (`npm run ai:selfplay:determinism`).
- [x] P0-4: the trace unit test passes, and a run with `AI_TRACE_FILE` matches a run without it.
- [x] P0-5: 12 puzzles run in under a minute (`npm run ai:puzzles`; v0 baseline 8/12). Owner sign-off of answers still open.
- [ ] P0-6: 100 baseline games on seeds 1000 and up, at least 90 ending in a win or at the turn limit, none as `error`.
- [ ] P0-6: turn limits are 20% of games or fewer, or the limit was raised, or the traces were read and explained.
- [ ] P0-6: `docs/ai-baseline-v0.md` is committed with the commit hash and the `v0` puzzle pass count.

### Phase 1 gate (P1-6)

- [ ] P1-1: evaluator unit tests and the ten-fixture parity test pass, and the measured feature time is in the PR.
- [ ] P1-2: the win-probability tests pass, and positions built from two seats' views of one state are identical.
- [ ] P1-3: held-out log-loss beats uniform and life-only, and reliability buckets are within 10 points, or the report explains why `DEFAULT_WEIGHTS` stayed.
- [ ] P1-4: profiles exist for every commander-legal card with no exceptions, Disposal Mummy and Campfire have no removal role, and you have reviewed 20 disagreements.
- [ ] P1-5: a shadow run reproduces the baseline exactly, each role policy has a unit test, and the puzzle suite with `AI_BRAIN=v1` passes at least as many puzzles as `v0`.
- [ ] P1-5: you have reviewed 30 sampled shadow disagreements.
- [ ] P1-6: 320 games on seeds 3000 and up; the `v1` win-rate lower bound is above 25%; stalls and errors are no more common than for `v0`; median game time is within 25% of `v0`; the puzzle pass count is at least `v0`'s.
- [ ] Decision recorded: switch the default brain in a separate PR, or go back to the shadow disagreements and the traces of lost games.

### Phase 2 gate (P2-8)

- [ ] P2-1: the 40-case resolver table passes, including the one-on-one grid that agrees with `evaluateSingleBlockOutcome`.
- [ ] P2-2: the 15 lethal fixtures pass, including commander damage carried over from earlier turns.
- [ ] P2-3: the 10 crack-back fixtures pass, and the boundary where `lethal` flips is tested at exactly my life.
- [ ] P2-4: 36 puzzles run in under two minutes, you have signed off every answer, 8 are marked held out, and the `v0` and `v1` pass counts are recorded.
- [ ] P2-5: the attack-planner unit tests pass, the planner's 95th-percentile time on fixtures is under 50 ms, and a shadow run reproduces the baseline exactly.
- [ ] P2-6: the block-planner unit tests pass.
- [ ] P2-7: at least 12 `planTurn` unit tests pass, and `AI_BRAIN=v1` behaves exactly as before.
- [ ] P2-8: 320 games on seeds 4000 and up with `v2` against `v1`; stalls, errors and failed actions per game are no higher than for `v1`; median game time is within 25% of `v1`'s; planner decisions are under 100 ms at the 95th percentile; the `v2` win-rate upper bound is not below 25%.
- [ ] P2-8: `v2` passes at least 90% of all puzzles and of the held-out ones, and no puzzle that `v1` passed fails without an explanation in `docs/ai-phase2-gate.md`.
- [ ] Decision recorded: switch the default brain to `v2` in a separate PR, or go back to the puzzles `v2` lost and the traces of the decisions involved.

## Appendix: Phase 2 puzzle drafts

These are the 24 positions for P2-4, drafted for your review. Read them as a Magic player: drop or rewrite any answer you would not defend, then pick the 8 held-out ones. The 12 puzzles from P0-5 are not repeated here.

**Conventions.** You are the bot; A, B and C are the opponents. Everyone is at 40 life unless a row says otherwise. Creatures are power/toughness, untapped, and able to attack on their controller's next turn. Commander damage of 21 from one commander kills. A puzzle passes when the bot's action is on the acceptable list; the forbidden list names plays that the report counts as blunders. Rows marked (judgement) are the ones I think are arguable.

**Suggested held-out set:** L3, C2, C4, T1, M1, M4, B2 and S3. These are the ones I am most sure have one defensible answer; swap any you disagree with before the planners are written.

### Lethal

These test the combat resolver and lethal check (P2-1, P2-2) and the attack planner (P2-5).

| Puzzle | Position | Acceptable | Forbidden |
| --- | --- | --- | --- |
| L1 Trample and a lone blocker | You have a 6/6 trample, a 4/4 and a 2/2. A is at 8 with one untapped 2/2. B and C have no creatures. | All three attack A. A's best block (the 2/2 on the 4/4) still lets 8 through. | Any attack that leaves A alive, or any attacker sent at B or C. |
| L2 Commander damage carried over | Your commander is a 5/5 and has dealt 16 damage to B in earlier turns. B is at 40 with no untapped creatures. A is at 8 with no untapped creatures. C has an untapped 5/5. | The commander attacks B (16 + 5 = 21). | The commander attacks A (5 damage is not lethal) or C (blocked), or no attack. |
| L3 Menace stretches the blockers | You have two 3/3 menace creatures and a 3/3 with no keywords. A is at 6 with two untapped 1/1s. B and C have no creatures. | All three attack A. Two blockers can stop at most 3 damage, so 6 get through. | Leaving any attacker home, or sending any at B or C. |
| L4 Lethal into open mana | You have a 5/5 and are at 40. A is at 5 with no creatures, four untapped lands and three cards in hand. B and C have no creatures. | The 5/5 attacks A. A trick could stop it, but you lose nothing if it does. | No attack, or the 5/5 attacks B or C. |

### Not attacking into a crack-back

These test the crack-back estimate (P2-3) and the attack planner (P2-5).

| Puzzle | Position | Acceptable | Forbidden |
| --- | --- | --- | --- |
| C1 Keep the blocker home | You are at 6 with an untapped 4/4 and 2/2. A has a 5/5 and a 3/3. B and C have no creatures. | No attackers. Blocked, A's 5/5 and 3/3 deal nothing. | Both creatures attack: they stay tapped and A's 8 power is lethal. |
| C2 Vigilance keeps the blocker | You are at 4 with a 4/4 vigilance and a 3/3. A has one 4/4. B and C have no creatures. | The vigilance 4/4 attacks B or C; the 3/3 may attack B or C too. The 4/4 is still untapped to block A's 4/4. | No attackers, or the 3/3 attacking A (A's 4/4 blocks and kills it). |
| C3 Do not hold back for a small crack-back | You are at 20 with three 3/3s. B is at 12 with no creatures. A has a 3/3 and a 2/2. C has no creatures. | Two or three of the 3/3s attack B. Even if A hits back with 5, you are far from dead. | No attackers. |
| C4 Commander damage crack-back | You are at 40 with one untapped 3/3. A's commander is an untapped 6/6 and has already dealt 15 commander damage to you. B and C have no creatures. | No attackers. The 3/3 stays home to chump the commander. | The 3/3 attacks. Nothing blocks, 15 + 6 = 21 commander damage, and you lose at 40 life. |

### Choosing among three opponents

These test the attack planner (P2-5).

| Puzzle | Position | Acceptable | Forbidden |
| --- | --- | --- | --- |
| T1 Avoid the deathtouch blocker | You have a 5/5. A has an untapped 1/1 deathtouch, B an untapped 1/1, C no creatures. | The 5/5 attacks C or B. | The 5/5 attacks A (deathtouch kills it). |
| T2 Attack the player you can kill | You have three 4/4s. A is at 12 with three untapped 2/2s, B is at 12 with no creatures, C is at 40 with no creatures. | All three attack B: 12 damage is exactly lethal. | Any attacker sent at A (three blockers can stop all of it). |
| T3 Send the big attacker where it is unblocked | You have a 7/7 and a 1/1. A and B each have one untapped 2/2. C has no creatures. | The 7/7 attacks C (best), A or B. The 1/1 attacks C or stays home. | The 1/1 attacks A or B (a 2/2 blocks and kills it). |
| T4 Focus the weakest (judgement) | You have a 4/4 and a 3/3. B is at 9; A and C are at 40. No opponent has a creature. | Both attack B, taking it to 2. | No attackers. |

### Multi-creature combat

These test the combat resolver (P2-1) through the block planner (P2-6) and the attack planner (P2-5).

| Puzzle | Position | Acceptable | Forbidden |
| --- | --- | --- | --- |
| M1 First strike block | A attacks you with a 4/4 and a 3/3. You have a 4/4 first strike and a 2/2. | The first striker blocks the 4/4 and kills it without taking damage. The 2/2 does not block. | The 2/2 blocks either attacker (it dies and kills nothing). |
| M2 Deathtouch attacker | A attacks with a 1/1 deathtouch and a 5/5. You have a 6/6 commander and a 2/2 token. | The commander blocks the 5/5. The token blocks the 1/1 or nothing blocks it. | The commander blocks the 1/1 (deathtouch kills it). |
| M3 Double-block threat | You have a 5/5. A has two untapped 3/3s. B and C have no creatures. | The 5/5 attacks B or C, or stays home. | The 5/5 attacks A (a double block kills it and costs A one 3/3). |
| M4 Trample into two blockers | A attacks with a 5/5 trample. You have two untapped 3/3s. | Both block (6 damage kills it; it kills only one 3/3 and cannot trample over), or no block. | One 3/3 blocks alone (it dies and 2 damage tramples over). |

### Blocks when ahead and when behind

These test the block planner (P2-6).

| Puzzle | Position | Acceptable | Forbidden |
| --- | --- | --- | --- |
| B1 Ahead, no chump | You are at 40 with a 2/2 token and a 1/1. A attacks with one 6/6. | No block. | Any chump block. |
| B2 Chump on commander damage | You are at 40 with one untapped 2/2. A's commander, a 5/5, attacks. It has already dealt 17 commander damage to you. | The 2/2 blocks the commander (17 + 5 = 22 would be lethal). | No block. |
| B3 Trade with the leader (judgement) | You are at 30 with one untapped 3/3. A is the leader: 40 life and six creatures. B is behind: 12 life and one creature. A and B each attack you with a 3/3. | Block A's 3/3. Both die, and the leader loses a creature. | Block B's 3/3. |

### Sequencing under mana

These test the turn planner (P2-7). In every position the land drop is already used.

| Puzzle | Position | Acceptable | Forbidden |
| --- | --- | --- | --- |
| S1 Ramp before the big spell | Four untapped lands. Hand: Sol Ring, a 3-mana 3/3, a 5-mana 5/5. | Cast Sol Ring, then the 5/5 (3 lands + 2 from the Ring = 5 mana). | Casting the 3/3 before Sol Ring (the 5/5 is then out of reach this turn). |
| S2 Do not try the unaffordable spell | Five untapped lands. Hand: a 6-mana 6/6, a 3-mana 3/3, a 2-mana 2/2. | Cast the 3/3 and the 2/2 (5 mana). | Trying to cast the 6/6: the attempt fails and counts as a failed action. |
| S3 Summoning-sick ramp | Four untapped lands. Hand: Llanowar Elves, a 3-mana 3/3, a 5-mana 5/5. | Cast the Elves and the 3/3 (1 + 3 = 4 mana). The Elves cannot tap this turn. | Trying to cast the 5/5 off the Elves. |
| S4 Count the rock | Two untapped lands and an untapped Sol Ring in play. Hand: a colorless 4-mana 4/4 and a 2-mana 2/2. | Cast the 4/4, paying with Sol Ring and both lands. | Passing, or casting only the 2/2. |
| S5 Avoid discarding | Five untapped lands, nine cards in hand, maximum hand size seven. Hand: a 3-mana 3/3, two 2-mana 2/2s and six spare lands. | Cast the 3/3 and one 2/2 (5 mana), leaving seven cards. | Passing with mana unused (two cards would be discarded). |
