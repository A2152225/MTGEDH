# MTGEDH AI: Stronger Player Emulation

Oct 29, 2026 · @Bobby

Nov 9, 2026: the evaluation guide’s unique details now live here. That guide is superseded by this document plus the Phase 0–2 plan.

## Recommendation

Keep scoring as the foundation, but stop asking it to be the whole brain: the best-supported upgrade is a layered hybrid that adds a real board evaluator, a turn planner, threat and politics modeling, and a short lookahead for the few decisions where scores alone mislead.

Why not swap scoring out for something else:

- **Search needs a cheap forward model.** MTGEDH's live game is an event-sourced socket server (`appendEvent`, replay locks, ad-hoc `_`-prefixed state fields), not a pure function you can clone thousands of times per decision.
- **The research gain is modest and narrow.** The best-known MTG search paper (ensemble-determinized MCTS) used a stripped-down game of creatures and lands, one colour, 40-card decks. It reached 50.5% against its own hand-written expert rules player at about 0.2 s per move.
- **Learned agents are deck-specific.** MageZero trains one agent per constructed deck and reports about 250 games per hour on 13 threads. Commander's 100-card singleton decks over the whole card pool do not fit that model.
- **Heuristics are the industry norm.** Forge's wiki describes its AI as mostly heuristics and says it is weakest in control and combo decks, which is also where a pure scoring bot will hit a ceiling.

What the hybrid adds, in order of payoff:

1. A measurement loop (self-play plus a puzzle suite). Without it, no upgrade can be shown to help.
2. An evaluation function `V(state)` that replaces additive card priorities such as `calculateSpellPriority`.
3. A turn planner that sequences plays under the mana budget and checks for lethal.
4. Threat, memory and politics modeling for 4-player pods.
5. Lookahead over the top few candidates for combat, sweepers, counterspells and win attempts.
6. Personas and human-like imperfection, so the bots feel like players rather than noisy optimizers.

On LLMs: my assessment, not a sourced finding, is to use them offline (tagging cards, drafting card hints, explaining decision logs) and not for live move choice. Live play needs guaranteed-legal moves, low latency and predictable cost.

## How other card-game AIs work

Heuristic scoring is still the practical standard for MTG; search and learning have only been shown to work on narrowed versions of the game.

| Approach | How it works | Evidence | Fit for MTGEDH |
| --- | --- | --- | --- |
| Heuristic scoring | Hand-written rules and weights pick the highest-scoring action | [Forge's wiki](https://github.com/Card-Forge/forge/wiki/ai): logic is "mostly based on heuristics"; best with aggro and midrange, poor to OK in control, pretty bad for most combo decks | Already in place. The ceiling is planning, not weight tuning |
| Utility AI | Each option is scored from several inputs through response curves, so options sort themselves by score ([overview](https://en.wikipedia.org/wiki/Utility_system)) | Used in The Sims; can be combined with MCTS | Natural next step: your scores, but on consistent scales with explicit curves |
| Ensemble determinized MCTS | Sample the hidden cards, search each sampled world, add up visit counts ([Cowling, Ward, Powley 2012](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf)) | Simplified MTG; 40 trees of 250 simulations each; 50.5% against an expert rules player at about 0.2 s per move; one tree over all deals won only 23% | Good for a few high-stakes decisions. Needs a forward model |
| ISMCTS | One tree over information sets instead of game states ([Cowling, Powley, Whitehouse 2012](https://eprints.whiterose.ac.uk/75048)) | Abstract claims it beats existing hidden-information approaches; no numbers on the page I opened | Heavier to build than ensembles. Revisit after a forward model exists |
| Multiplayer search | max^n, paranoid, best-reply search ([Nijssen and Winands](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf)) | Board games only. Paranoid over-defends; BRS strongest with alpha-beta; the max^n tree structure did best inside MCTS | Commander is free-for-all: use per-player value vectors, not "everyone against me" |
| Deep RL | Self-play with a learned policy and value network ([MageZero](https://github.com/WillWroble/MageZero), [MTG-Causal-RL](https://arxiv.org/abs/2605.06066)) | MageZero: one agent per deck, 16-deck pool, about 250 games per hour. Benchmark: 478-action masked space, Standard archetypes | Poor fit: Commander decks and pods vary too much, and training needs a fast engine |
| LLM agents | Prompt a model with the state and legal actions | No source I could open and verify | Offline helper only (see Recommendation) |

I could not verify Forge's or XMage's internals beyond what the pages above state, so nothing here depends on them.

## Where scoring breaks down today

The handler layer is extensive (about 60 files under `server/src/socket/ai-handlers/`); the weaknesses are in how choices are ranked, and they are almost all about context rather than about the numbers.

- **Additive priorities with text matching.** `calculateSpellPriority` starts at 50 and adds fixed bonuses: mana rock +40, mana dork +35, creature +30, removal +25, card draw +20. Removal is detected with `oracleText.includes('destroy')` or `'exile'`, so any card with that word scores as removal, and real removal scores +25 whether or not a target is worth killing. Mana rocks are found partly through a hardcoded name list.
- **Context-blind ranking.** A card gets the same base priority on turn 2 and turn 12, ahead or behind. Only the deck-profile synergy term and a hand-size bonus adapt.
- **No turn plan.** `enumerateAIActionCandidates` returns candidates that each carry a `priority`, and the AI executes the best one at a time. Nothing weighs whole-turn lines such as land + rock + four-drop, two two-drops, or holding up a counterspell, and mana efficiency is never scored.
- **Combat is per-creature thresholds.** `makeBasicAttackDecision` scores each creature against `minVoluntaryAttackValue`, archetype branches and `maxAttackFraction`. It already assigns a defender per attacker (`selectBestDefenderForAttacker`), which is a good base, but it never searches for lethal across several opponents and never estimates the crack-back on the next turn.
- **Strategy is one global enum.** `AIStrategy` (random, basic, aggressive, defensive, control, combo) sets attack modifiers for the whole game. A deck that should be the beatdown early and the control late has no way to switch.
- **Mistakes are noise, not human error.** `shouldMakeMistake` fires with probability 0.4 × (1 − difficulty)², and in the attack decision it then either halves the attackers or over-commits, 50/50. Real players misjudge threats and forget to hold up mana; they do not flip coins.
- **Strength cannot be measured.** `server/tests/ai-*.test.ts` verify that handlers work. `rules-engine/src/GameSimulator.ts` models cards as name strings under its own simplified rules, so it cannot grade the real bot against the real engine.

## Target architecture

&#91;embedded content: target architecture · 6 layers plus memory\]

The existing candidate enumerators and executors stay as they are. The new path runs from what the seat can see to the final action, with strategy and memory feeding scoring and planning, and outcomes feeding memory back.

Rules for building it:

- The engine keeps enforcing legality. The AI only ranks options the engine already offers.
- One entry point, `decide(obs, candidates, persona)`, so each layer can be switched off for A/B tests against the current bot.
- Every layer records its top candidates and the features behind them, which is what makes the decision trace in the testing section possible.
- Each layer is useful alone, so they can ship in the roadmap order without a big-bang rewrite.

```ts
interface Observation {
  seat: PlayerID;
  hand: CardView[];            // own hand only
  battlefield: PermanentView[]; // public
  stack: StackItemView[];
  opponents: OpponentView[];    // life, public zones, revealed cards, open mana
  memory: SeatMemory;           // grudges, cards seen, observed behaviour
}

interface Scored<T> { candidate: T; utility: number; features: Record<string, number>; }

function decide<T>(obs: Observation, candidates: T[], persona: Persona): Scored<T>;
```

## Board evaluation function

Replace per-card bonuses with one function that scores how well each player's position is going, then rank actions by how much they improve it: the same card is worth different amounts in different positions.

Each live player gets a value `V` from weighted features. A softmax turns the values into a win-probability estimate for every seat, and an action's utility is the change in your own estimate. The softmax is what makes it multiplayer-aware: hurting the leader helps you more than hurting the player in last place.

```latex
V_i(s) = \sum_k w_k \, f_k(s, i), \qquad P_i(s) = \frac{e^{V_i(s)/\tau}}{\sum_j e^{V_j(s)/\tau}}, \qquad U(a) = P_{me}(s_a) - P_{me}(s)
```

`τ` sets how decisive the estimate is and `w_k` are the weights. Treat both as parameters to fit, not constants to guess (see the testing section).

| Feature | What it measures | Start from in the current code |
| --- | --- | --- |
| Life | Concave in life total, plus a danger term when life is below the visible power across opponents | `readLife` in `aiEngineBlockPlanning.ts` |
| Poison | Poison counters. Ten from any source is a loss, so this is not on the same scale as life | Player poison counters |
| Board value | Sum of creature and permanent values, keywords included | `evaluatePermanentValue`: (power + toughness) × 2, plus keyword bonuses; a 4/4 flier is at least 19 |
| Mana development | Lands, rocks and dorks, capped at what the hand can actually spend, and colours available against colours the hand still needs | `calculateManaProduction` and the payment-source helpers |
| Hand value | Cards in hand weighted by whether they are castable in the next two turns, plus graveyard cards the deck can actually recur | Hand reads in `aiDeckProfileHandlers.ts` |
| Engines | Draw, ramp, token and sacrifice engines on board | `CardCategory` tags in `CardAnalyzer.ts` |
| Commander | In command zone or on board, tax paid, commander damage dealt and taken | `readCommanderDamageTaken`, `commandZone` state |
| Clock | Turns until each opponent could be dead from the current board | New. The game plan's win routes say which clock counts |
| Exposure | Worst-case damage taken on the next opponent turn (the crack-back) | New |
| Sweeper exposure | How much of the board is committed while an opponent holds mana in a sweeper colour, and how much the position depends on one permanent | New |

Example: a Wrath-style sweeper currently scores +25 because its text contains "destroy", on every board. Under `V` it is cast when the change in your win probability is positive: you lose less board than the leading opponents lose, or your life is at risk. The same card can then be right on turn 6 and wrong on turn 2.

```ts
export function evaluate(obs: Observation, seat: PlayerID, W: Weights): number {
  return W.life * Math.sqrt(Math.max(0, lifeOf(obs, seat)))
       + W.board * boardValue(obs, seat)        // reuse evaluatePermanentValue
       + W.mana * manaDevelopment(obs, seat)
       + W.hand * handValue(obs, seat)
       + W.engines * engineScore(obs, seat)
       + W.commander * commanderTerm(obs, seat)
       - W.poison * poisonOf(obs, seat)
       - W.exposure * crackBackDamage(obs, seat)
       - W.sweeperExposure * sweeperExposure(obs, seat);
}

export function winProbabilities(obs: Observation, W: Weights, tau: number): Map<PlayerID, number> {
  // softmax over evaluate() for every live seat, using visible information only
}
```

Seed the weights on the scales the code already uses, then fit them from self-play outcomes with logistic regression: record each position's features and the eventual winner, and let the data set `w_k`.

## Decision modules

Each decision keeps its current handler as the executor and gains a better chooser in front of it. The table lists what exists, what to change, and the first concrete step.

| Decision | Today | Upgrade | First step |
| --- | --- | --- | --- |
| Mulligan | `handleAIMulligan`: land-count rules with mana-source and synergy exceptions; stops mulliganing once the next hand would be 4 cards or fewer | Sample draws from the deck's own composition and keep when the hand beats an average fresh six on the game plan's mulligan needs | Hypergeometric land-drop probability from the AI's own library list |
| Land and mana | `aiLandPlayHandlers`, `getPaymentSources` | Pick the land that maximizes colour access over the next three turns given the hand; choose tapped lands on turns with nothing to cast | Score each land by colours unlocked for cards in hand |
| Casting and sequencing | `calculateSpellPriority`, best candidate executed first | Turn planner: search short sequences (up to 3 or 4 plays) under the mana budget, scoring mana used plus the change in `V` | Replace the sort with a depth-limited search over `AIActionCandidate[]` |
| Attacks | `makeBasicAttackDecision`: per-creature thresholds | Add a lethal check across all opponents (including commander damage), a crack-back estimate, and defender assignment by win-probability change | Lethal check first; it is a pure function and easy to test |
| Blocks | `planAIBlocks`: free blocks, good trades, chump only when lethal | Add multiplayer awareness: do not chump when another attacker's damage is already survivable, and weigh whether a trade helps the leader | Feed `V` into the existing trade comparison |
| Removal targets | `selectRemovalTarget` using `removalTargetPriority` | Rank targets by the change in your win probability if that permanent were gone, with a penalty for likely responses | Use `V` with and without the target |
| Stack responses | `tryAIResponseActions` | Decide whether a spell is worth countering by comparing its threat to your remaining counters and to what else the pod may cast | Per-spell threat score from `CardAnalyzer` |
| Optional and group choices | `aiJoinForcesDecision`, `aiModeChoiceHandlers` | Route through the same utility scorer so politics and persona apply | Start with Join Forces, which already has its own file |

**Planner shape.** The turn planner is a small search, not a rewrite. The inputs already exist: `enumerateAIActionCandidates` lists legal plays and `parseManaCost` plus the payment helpers say what each costs.

```ts
function planTurn(obs: Observation, cands: AIActionCandidate[], budget: ManaPool): Plan {
  const best = { plays: [] as AIActionCandidate[], score: -Infinity };
  const walk = (plays: AIActionCandidate[], mana: ManaPool, depth: number) => {
    const score = valueOfPlays(obs, plays) + MANA_EFFICIENCY * manaSpent(budget, mana);
    if (score > best.score) { best.plays = plays; best.score = score; }
    if (depth === MAX_PLAYS) return;
    for (const c of cands) {
      if (plays.includes(c) || !affordable(c, mana)) continue;
      walk([...plays, c], pay(mana, c), depth + 1);
    }
  };
  walk([], budget, 0);
  return best;
}
```

Three rules keep this honest. Land drops and mana rocks are sequenced first unless the plan says otherwise. The planner reserves mana for instant-speed interaction when the persona and the board call for it, and that reserved mana counts as spent when the bot has a plausible use for it, so holding interaction is not scored as wasted mana. The affordability check for a sequence has to credit mana an earlier play actually produces, including that a mana creature cannot tap on the turn it enters.

## Lookahead on top of scoring

Add search only where a wrong choice is expensive and a short search can see the answer: attack declarations, sweepers, counterspells and win attempts. Everything else stays with the scorer.

Because the live engine is hard to clone, build lookahead in two tiers.

1. **Tactical resolver.** Pure functions over a compact snapshot (creatures with power, toughness, keywords and damage; life totals; known tricks). `evaluateSingleBlockOutcome` is already the seed. Extend it to multi-creature combat with first strike, deathtouch, trample and double blocks. It runs in microseconds, needs no hidden information, and powers the lethal check, the crack-back estimate and block planning.
2. **Abstract forward model.** For one or two turns of lookahead over the top few candidates: life, board summary, mana, hand size, plus a per-card effect summary (draws N, removes a target class, sweeps, adds mana). Derive the summaries from the Oracle IR the engine already builds to execute cards, and fall back to `CardAnalyzer` tags where the IR has nothing. It is approximate on purpose; it only has to rank three to five lines.

Why not search the real engine: game events are persisted through `appendEvent`, replay is guarded by `isGameReplayLocked`, and `game.state` carries bookkeeping fields such as `_aiProcessingCleanup` and `_autoPassResult`. Cloning is not the blocker. The Phase 0–2 plan timed `structuredClone` of a live state at about 1.5 ms. Stepping the copy is the problem, because engine code persists events, broadcasts to sockets and uses process-wide singletons. Stay on the abstract model. Do not fork the live engine, and do not try to grow `GameSimulator` into the forward model.

**Hidden information.** Sample several complete worlds from what the seat can see: each opponent's hand is filled with cards already revealed plus a prior for their colour identity, matched to their hand size. Search each world separately and combine the results. In the Magic paper this mattered a great deal: a single tree over all possible deals won 23% against an expert rules player, while an ensemble of forty determinized trees plus two move-reduction enhancements reached 50.5%. The authors also name the known weakness, strategy fusion, so treat the search as advice blended with the scorer, not as the final word.

Do not copy that paper's setup as the build target. A later allocation study on three card games found the best ensembles at about 5 to 10 trees, so start there (`N` in the sketch below is the world count, not a tree count to match). Playouts follow this bot's evaluator softmax, not uniform random: the Magic study found a weaker stochastic rules player made better playouts than its expert, and random playouts were very weak. Cut each playout early and score the position with `V`.

**Multiplayer structure.** Let each opponent reply by maximizing its own `V`, in the style of max^n. Nijssen and Winands found that structure strongest inside MCTS, while paranoid search makes the bot overly defensive, which is wrong for a free-for-all.

```ts
function chooseWithLookahead(obs: Observation, scored: Scored<Cand>[], budgetMs: number): Cand {
  const top = scored.slice(0, K);                      // K of about 4 to 6
  const worlds = sampleWorlds(obs, N, rng);            // N of about 16 to 32, hidden cards from priors
  const totals = new Map<Cand, number>();
  const deadline = performance.now() + budgetMs;
  for (const w of worlds) {
    if (performance.now() > deadline) break;           // anytime: use what we have
    for (const s of top) {
      let state = applyAbstract(w, s.candidate);
      state = opponentsReply(state, cheapPolicy);       // each opponent maximizes its own V
      totals.set(s.candidate, (totals.get(s.candidate) ?? 0) + winProb(state, obs.seat));
    }
  }
  return blend(top, totals, LAMBDA);                   // search advice plus scorer prior
}
```

**Where it runs.** Search only when a trigger fires: attackers whose total power approaches any opponent's life, three or more attackers, a sweeper or mass effect, a spell to counter, or a flagged win attempt. Skip land plays, empty-stack passes and payments. Run it in a `worker_threads` worker so one long think does not block the Node event loop that serves every game, keep it under the existing 12 s exclusive-action timeout (`AI_EXCLUSIVE_ACTION_TIMEOUT_MS`) with a target of one to three seconds, seed the sampler so tests are reproducible, and fall back to the scorer's choice on any error or timeout.

## Opponent modeling and hidden information

Make the information boundary explicit and testable, then give the bot the memory a human player has: what was revealed, what mana was left open, and how each opponent has behaved.

**Information boundary.** Build an `Observation` for each seat and make decision code read only that, never `game.state` directly. The handlers take the whole `game` object today. `getVisibleDeckCardsForAI` reads the AI's own library and zones, which is fine for its own deck, but I did not audit the other handler files for reads of an opponent's hand or library. A metamorphic test does that mechanically: shuffle every opponent's hidden zones in a fixture, run `decide` with the same seed, and require the identical result. Any difference is a leak.

**What to remember.** Keep a small `SeatMemory`, updated from the event stream after each action:

```ts
interface SeatMemory {
  seen: Map<PlayerID, CardRef[]>;              // revealed, milled, exiled, commander identity
  openManaOnMyTurn: Map<PlayerID, number[]>;   // untapped mana per opponent, last few turns
  grudge: Map<PlayerID, number>;               // decays every turn
  actions: Map<PlayerID, { attackedMe: number; removedMine: number; counteredMine: number }>;
  style: Map<PlayerID, 'aggro' | 'control' | 'combo' | 'unknown'>;
}
```

**Interaction estimate.** Estimate the chance an opponent holds a relevant instant from their open mana, their colour identity, their hand size and how often they have used instants so far. Use it for three choices: cast the key spell into open mana or bait first, attack into possible tricks, and hold a counterspell or use it now. The starting prior is hypergeometric, not a hand-tuned table:

```latex
P(\geq 1) = 1 - \frac{\binom{N-K}{n}}{\binom{N}{n}}
```

`N` is unseen cards (library plus hand), `n` is hand size, and `K` is how many of that role are still unseen. Until real decks replace them, start `K` from a Commander template of about 10 ramp, 10 draw and 10 removal, 2 to 4 sweepers, and 36 to 38 lands. Open mana gates the result: an opponent with no untapped blue source cannot counter this turn, so that probability is 0 whatever the hand. Log every case where a later reveal checks the guess, and fit a small logistic model from those logs rather than tuning the template by hand.

Also track, per opponent and from public information only: colour identity from their commander, role counts of cards seen, cards known to still be in hand, and a posterior over `SynergyArchetype`. Update that posterior when a card is seen by multiplying the prior by how likely the card is under each archetype, then renormalise. It adjusts sweeper odds, combo threat and expected removal.

Fold beliefs from the public event stream. Keep them on the bot, not on `game.state`, so a restart or a replay rebuilds them and human players never see them.

**Style labels.** Tag each opponent as aggro, control or combo from observed behaviour, and feed the tag into the threat model in the next section. Re-use `detectOpponentCombo` and the `comboPiecesOnBoard` count that `CardAnalyzer` already provides, extended to pieces seen in graveyards and exile.

**Open decklists (a product choice).** The bot should not know an opponent's list by default. If your table agrees to play with open decklists, passing the list to the world sampler as the prior makes the lookahead noticeably better informed. It is cheap to offer as a per-game setting. A narrower default needs no agreement: when an opponent's commander matches a known precon, that precon list may be the prior, the way a player who knows the product would guess. Never read their actual deck list for this.

## Multiplayer Commander: threat, politics, kingmaking

In a four-player pod the real question is who must be stopped, who can be ignored, and how to avoid becoming the table's target; model each as a change in win probability instead of one threat number.

Today `selectAttackTarget` ranks opponents with a single formula: total threat level × 100, +300 for two or more combo pieces, +200, +100 or +50 for life at or under 10, 20 or 30, and +5 per creature. `selectBestDefenderForAttacker` then adjusts per attacker for open lanes. There is no memory of who attacked whom, no separation between "dangerous to me" and "easy for me to hurt", and no sense of how the bot itself looks to the table.

Split the target choice into four parts and weight them by persona:

```latex
\text{target}(j) = \alpha \, \text{Danger}_j + \beta \, \text{Opportunity}_j + \gamma \, \text{Leader}_j + \delta \, \text{Grudge}_j
```

| Component | Signal | Source |
| --- | --- | --- |
| Danger | Their likely damage to me next turn, combo pieces, engines | `assessBattlefieldThreats`, plus the new crack-back estimate |
| Opportunity | Change in my win probability if this opponent takes the hit; lethal reach; commander damage progress | `winProbabilities`, `readCommanderDamageTaken` |
| Leader | Their win probability relative to the rest of the table | Softmax in the evaluator |
| Grudge | Recent hostile acts against me, decaying each turn | `SeatMemory.grudge` |

**Politics that read as human.**

- **Grudges.** Attacking me, removing my permanents or countering my spells raises that player's grudge. It decays over a few turns, so the bot holds a grudge without tunnel vision.
- **Staying off the radar.** Estimate how threatening the bot itself looks (its own rank in the win-probability vector). When it leads, prefer lines that do not paint a target on it: keep blockers home, avoid casting the third big threat into three open opponents.
- **Kingmaking guard.** Before removing or eliminating a player, compare the bot's win probability with and without that player. Do not remove the one opponent who is holding the leader in check.
- **Group effects.** Join Forces, voting, monarch and goad choices should use the same change-in-win-probability measure instead of fixed probabilities. For example, `AI_OPTIONAL_GIVE_CONTROL_PROBABILITY = 0.3` is a constant today.

**Commander rules the evaluator must know.** Commander damage (21 from one commander) belongs in the lethal check and in block planning, where `readCommanderDamageTaken` already feeds chump decisions. Commander tax belongs in the cast decision: recast when the evaluator says the commander on the board beats holding the mana, and hold up protection when removal is likely. Partner and background pairs are already handled at commander selection. Attack choices include planeswalkers and battles, scored by the same change in win probability as a player, not ranked behind players by a fixed order.

## Card knowledge: profiles, policies and the IR

Replace substring matching with structured per-card facts, generated from the Oracle IR where possible, plus a small hand-written override file for the few cards that automated tagging gets wrong.

The current knowledge lives in text matches and name lists. `calculateSpellPriority` and the mulligan code each keep their own list of mana rocks, and the two lists differ (`aiSpellPriority.ts` names 21 rocks, `aiMulliganHandlers.ts` 11), plus different text patterns, so the two can disagree about which cards count as mana sources.

Give every card one cached `CardAIProfile`, keyed by oracle id:

```ts
interface CardAIProfile {
  roles: Role[];             // ramp, fixing, spot-removal, sweeper, counter, draw, tutor,
                             // threat, engine, finisher, protection, combo-piece
  timing: 'sorcery' | 'instant' | 'flash' | 'static';
  needs: TargetNeed[];       // e.g. { zone: 'battlefield', kind: 'creature', controller: 'opponent' }
  policy?: PolicyName;       // 'sweeper' | 'counter' | 'protection' | ... (code, shared by many cards)
  value: { immediate: number; perTurn: number };
  source: 'ir' | 'analyzer' | 'override';
}
```

- **`source`** records which layer produced the profile. It is the same idea as tagging which handler resolved a card's effects: you can then see how much of the bot's card knowledge rests on the IR, how much on the `CardAnalyzer` fallback and how much on overrides, instead of guessing. I have not audited IR coverage for the AI's needs, so expect the analyzer fallback to carry a lot at first.
- **Policies** are shared code per role (sweeper, counterspell, protection, tutor), so most cards need no card-specific logic. Forge's wiki makes the same call: card-specific logic is "usually not a healthy approach", though defensible for highly iconic cards.
- **Overrides** live in a JSON file for the exceptions, with a note on why each exists.

```json
{ "<oracle_id>": { "name": "Example Sweeper", "policy": "sweeper", "note": "Hold until the opposing board is clearly ahead" } }
```

**From priorities to utilities.** Score each role with a few considerations, each mapped through a response curve to a 0 to 1 value. Multiply for hard gates (no worthwhile target means zero) and add for preferences. This is the utility-system pattern from the landscape table, and it fixes the scale problem in today's priorities, where a +25 for removal and a +30 for a creature are not measuring the same thing.

```ts
const considerations: Record<Role, Consideration[]> = {
  'spot-removal': [
    { name: 'targetWorth', gate: true,  input: c => bestTargetValue(c) / (c.cost + 1), curve: logistic({ mid: 2, k: 1.5 }) },
    { name: 'exposure',    gate: false, input: c => exposureReduction(c),               curve: linear() },
  ],
  'ramp': [
    { name: 'turnsLeftToUse', gate: false, input: c => c.manaSinksInHand - c.manaAvailableNextTurn, curve: saturating() },
  ],
};
```

**Migration.** Run the new scorer in shadow mode first: compute both, execute the old one, and log every decision where the top choices differ. Reviewing those disagreements finds missing tags faster than reading code.

## Game plan

A deck profile already exists, and `aiEngineDeckSupport.ts` collapses it into one of six `AIStrategy` values. That collapse is the loss: a tokens deck with a drain finisher and a voltron deck both become a threshold tweak, and they want different things from the same board. Build a `GamePlan` once at game start from the deck, and rebuild it only when the commander changes. It comes after the Phase 2 evaluator and before lookahead, because the clock and the must-answer list are inputs to search. It is not part of the Phase 0–2 plan.

```ts
interface GamePlan {
  archetypeMix: Record<string, number>;      // sums to 1
  winRoutes: Array<{ kind: 'combo' | 'commanderDamage' | 'goWide' | 'drain' | 'other';
                     pieces: string[]; turnsAway?: number }>;
  cardWeights: Record<string, number>;       // 0..10, not a fixed top 10
  mustAnswer: string[];                      // roles such as 'combo-piece' or 'sweeper'
  mulligan: { landMin: number; landMax: number; wantsRamp: boolean; colorsNeeded: string[] };
  weightOverrides: Partial<Record<string, number>>; // evaluator feature names
}
```

| Archetype | What the deck looks like | What the evaluator emphasises | How it plays |
| --- | --- | --- | --- |
| Voltron or aggro | Cheap creatures, equipment, auras, an attacking commander | Clock, evasion, commander damage | Attack early; protect the commander |
| Midrange or value | Balanced creatures, removal and draw | Board and card flow | Trade efficiently |
| Control | Counters, sweepers, spot removal, few threats | Interaction, card flow, life | Hold mana; answer the must-answer list |
| Combo | Tutors, linked pieces, protection | Pieces assembled, protection held | Tutor and protect the last piece |
| Ramp | Many ramp spells, large finishers | Mana, then the payoffs | Develop mana first |
| Tokens or aristocrats | Token makers, sacrifice outlets, drain | Board width, engines, sweeper exposure | Build wide; do not overcommit into sweepers |
| Politics or group hug | Goad, forced combat, symmetrical effects | Personal threat, grudge, table balance | Deflect attention; steer other players' attacks |

Express each row as relative weight overrides and let the benchmark set the numbers. Premium removal is kept for roles on `mustAnswer`, not spent on the first large creature. `comboPairs` today come from pattern matching inside one deck. For known combos, Commander Spellbook's backend is MIT-licensed and publishes an npm client; confirm its lookup or data export before depending on it. Once a line is listed, track its pieces in hand, on the battlefield and in the library, and when one piece is missing give that piece top priority for tutoring and hold protection for it.

**Mulligans.** The bot knows its own deck, so sampling here is allowed. Draw a few hundred sequences for the next three or four turns and measure how often the hand makes its land drops, casts a play by turn 3 and casts the commander on time. Keep when that score meets or beats the average for a fresh six. The free first mulligan lowers the bar for the first one.

**Test.** Extend `rules-engine/test/aiDeckStrategyInference.test.ts` so a handful of known precons assert an expected archetype mix and key cards, and keep those decks in the benchmark pool.

## Personas, difficulty and human-like imperfection

Replace the single random-mistake coin flip with two independent dials, a persona (what the bot wants) and a skill level (how well it carries it out), so an easy bot errs like a casual player instead of randomly.

**Persona.** A small parameter vector read by the layers above. Map today's `AIStrategy` values onto presets so existing games and settings keep working.

| Preset | Built from | Leans |
| --- | --- | --- |
| Aggro | `AGGRESSIVE` | High aggression and opportunity weight, low patience, accepts crack-back until life is low |
| Midrange | `BASIC` | Balanced weights; the default |
| Control | `CONTROL`, `DEFENSIVE` | High patience: holds mana for counters and removal, targets the leader, avoids early attacks |
| Combo | `COMBO` plus the deck profile | Protects key pieces, stays under the radar, attempts a win only when the planner finds a complete line |
| Grudge | New | High grudge and politics weight, group-effect choices tuned to reward friends and punish attackers |

Parameters: `aggression`, `patience`, `grudgeWeight`, `comboEagerness`, `riskTau` (the `τ` in the softmax). Archetype weights from `aiDeckProfileHandlers.ts` stay as the deck-level input.

**Skill.** Map the existing `difficulty` (0 to 1) onto several dials instead of one error rate. Today `shouldMakeMistake` returns true with probability 0.4 × (1 − difficulty)².

- **Choice temperature and floor.** Pick with a softmax over candidate scores. Low skill uses a high temperature; high skill is near zero and takes the top line. A floor drops candidates far below the best, so an easy bot misjudges among plausible lines and never plays nonsense.
- **Search budget.** Difficulty 0 gets no lookahead and no planner; high difficulty gets the full budget and a larger candidate list.
- **Evaluation noise.** Add noise to the bot's estimate of each opponent's `V`, scaled by (1 − difficulty). The visible effect is misjudging who is winning, which is how people actually err.
- **Memory span.** Low skill forgets grudges and open-mana observations sooner.
- **Candidate pruning.** Low skill considers fewer options, so it sometimes misses the best line without ever making an illegal or absurd one.
- **Typed errors.** Replace the coin flip with named, loggable errors: threat misjudgement, greedy sequencing (skip the planner), forgetting to hold up interaction, over-chumping or under-blocking, and tunnel vision on a grudge.

Keep the principle already written into `AIEngine.shouldMakeMistake`: mistakes are high-level judgment errors among legal, plausible options, never rule violations such as buffing an opponent's creature or choosing an invalid target.

**Pacing.** The AI constants already define short fixed delays (`AI_FAST_CONTINUE_MS` 75 ms, `AI_PASSIVE_STEP_DELAY_MS` 300 ms, `AI_THINK_TIME_MS` 500 ms). Scale the delay with decision weight: near-instant for empty-stack passes, longer for attacks and sweepers. The one to three seconds of lookahead then reads as the bot thinking rather than as lag.

**Table feel.** Offer a power-level setting for the pod. A casual table usually wants a bot that is fun to play against, so a low setting can forbid win attempts through combos and cap the search budget. Optional table talk can reuse the `reasoning` string that `AIDecision` already carries, for example a short line when the bot targets someone because of a grudge.

## Testing and measurement

Build the measurement loop before changing behaviour: a headless self-play harness on the real engine, a puzzle suite with known best plays, and a decision trace. Every later upgrade is then accepted or rejected by data.

**Self-play on the real engine.** `GameSimulator.ts` cannot grade the live bot because it uses its own simplified rules. Build the harness on the server's game code, without sockets: load four decks, seed the RNG, run N games and write results as JSON. The repo's `precon_json/` folder holds 12 decks that could seed a benchmark pool (I have not checked that they all load cleanly in the live engine), and `server/tests/ai-*.test.ts` shows how to drive the AI from tests.

- **Pod design.** One candidate bot plus three copies of the frozen current bot, rotating seat and deck assignments so neither confounds the result. A bot of equal strength wins 25% of games.
- **Baseline.** Freeze today's behaviour as `v0` and compare every variant against it.
- **Rating.** For many variants at once, use a multiplayer rating system such as TrueSkill.

Games needed to detect an improvement over the 25% baseline (one-sample test, 95% confidence, 80% power):

| Target win rate | Games needed |
| --- | --- |
| 40% | 71 |
| 35% | 156 |
| 32% | 314 |
| 30% | 609 |

**Metrics to record.** Win rate by variant, seat and deck; game length in turns; failed-action and stall rate (the code already has `noteGameStallAiFailure`); p50 and p95 decision latency by decision type; and how often lookahead overrode the scorer.

**Puzzle suite.** State fixtures paired with the accepted best action: lethal across several opponents, forced chump block, commander-damage lethal, sweeper timing, counter or save, and not attacking into open mana with a known trick. `ai-declare-blocks.integration.test.ts` and `ai.cast-sequencing.integration.test.ts` show the fixture style. Start with 30 to 50 puzzles and run them in CI.

**Decision trace.** For every non-trivial decision write one JSONL line: seat, phase, top three candidates with utilities, the feature vector, which layer decided (scorer, planner or lookahead), the persona and the seed. It extends the `reasoning` and `confidence` fields on `AIDecision`, lets you replay any decision, and supplies the data for fitting weights.

**Fitting.** Log each position's features and the eventual winner during self-play, fit `w_k` with logistic regression, then check calibration: bucket the predicted win probabilities and compare each bucket with the observed win rate, and adjust `τ` until they match. Tune persona parameters last, by random search against `v0`.

**Human feedback.** Add a "bad play" button to the table UI that saves the state snapshot and trace id. Each report becomes a puzzle, which is the cheapest source of realistic test cases for a game played with friends and family. Strength and human-likeness are different, so measure both. Replay recorded human decisions and count how often the human action is in the bot's top three. Keep those positions as a regression set, so a bot tuned only against other bots cannot drift away from how people played. A short blind playtest, asking which seat is the bot, is the check on whether it feels like a player.

**Guards in CI.** The information-leak test from the opponent-modeling section, the puzzle suite, and a nightly 200-game run against `v0` that alerts if win rate drops or p95 latency passes its budget.

## Implementation roadmap

&#91;embedded content: implementation roadmap · 6 phases, 5 gates\]

Phase 0 comes first because nothing after it can be judged without it. Phases 1 and 2 give the largest visible gain for the least risk, since they build on handlers and data the code already has. Phase 3 is the game plan and the opponent beliefs specified above. Phase 4 is lookahead, the most expensive and the hardest to debug, so it waits until the harness can show whether it helps. Phase 5 is personas and skill. Each phase is useful on its own, and you can stop after any gate and keep a better bot than the one you started with.

## References

External sources, all opened and read for this document on 2026-10-29:

- [Forge AI wiki page](https://github.com/Card-Forge/forge/wiki/ai): heuristic design, archetype strengths and weaknesses, per-card logic guidance, headless AI-vs-AI simulation mode.
- [Cowling, Ward, Powley (2012), Ensemble Determinization in Monte Carlo Tree Search for Magic: The Gathering](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf): simplified-game results quoted in the lookahead section.
- [Cowling, Powley, Whitehouse (2012), Information Set Monte Carlo Tree Search](https://eprints.whiterose.ac.uk/75048): abstract only; no numbers used.
- [Nijssen and Winands, An Overview of Search Techniques in Multi-Player Games](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf): max^n, paranoid and best-reply search; results on four board games. The page does not state a year.
- [MageZero](https://github.com/WillWroble/MageZero): per-deck AlphaZero-style agents on XMage; numbers are the author's own.
- [MTG-Causal-RL benchmark (arXiv 2605.06066, May 2026)](https://arxiv.org/abs/2605.06066): abstract only.
- [Utility system (Wikipedia)](https://en.wikipedia.org/wiki/Utility_system): response curves and utility scoring.
- [Dynamic resource allocation for ensemble determinization MCTS (arXiv 2607.13007)](https://arxiv.org/pdf/2607.13007): ensemble sizes of about 5 to 10 trees on three card games. Not a Magic result.
- [Improving Hearthstone AI by combining MCTS and supervised learning](https://arxiv.org/pdf/1808.04794): cutting playouts short and scoring with a value function.
- [Commander Spellbook backend](https://github.com/SpaceCowMedia/commander-spellbook-backend): MIT-licensed combo database. Lookup endpoints were not confirmed from the repo page.

Code reviewed: `A2152225/MTGEDH` at commit `e43d44e`. Main files: `server/src/socket/ai-handlers/` (`aiSpellPriority.ts`, `aiActionCandidateHandlers.ts`, `aiActionCandidateTypes.ts`, `aiDeckProfileHandlers.ts`, `aiMulliganHandlers.ts`, `aiPriorityHandlers.ts`, `aiPriorityPassCombatExecutors.ts`, `aiConstants.ts`), `rules-engine/src/` (`AIEngine.ts`, `aiEngineCombatSupport.ts`, `aiEngineBlockPlanning.ts`, `aiEngineThreatSupport.ts`, `aiEngineValueSupport.ts`, `CardAnalyzer.ts`, `GameSimulator.ts`), and `docs/ai-strategies.md` and `docs/ai-implementation-reference.md`, which are partly out of date relative to the code.

Not verified: Forge's and XMage's internals beyond the pages above, whether LLM-driven Magic play has published results, and IR coverage for AI tagging. The clone cost was measured later in the Phase 0–2 plan. The numbers in the roadmap gates and the sample-size table are proposals and calculations, not measurements of your bot.
