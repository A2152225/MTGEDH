# MTGEDH Bot AI: Stronger Player Emulation (Evaluation & Implementation Guide)

Oct 29, 2026 · @Bobby

## Verdict: keep scoring, but make it the backbone of a layered bot

Scoring is still the right foundation for a Commander bot. Your current version scores each decision on its own scale and never looks ahead, and that is what holds it back. The strongest upgrade is a hybrid: one shared position evaluator, a game-plan layer above it, small targeted simulations where lookahead pays, and an opponent model beside it.

**Why not replace scoring with search or learning outright**

- Search needs a fast, faithful copy of the rules. In the one academic Magic study I found, tree search only matched a hand-written expert player (about 47 to 52% wins against it, versus 23% for naive search), and that was a simplified, creature-only game. See [Cowling, Ward and Powley (2012)](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf).
- Your engine resolves cards through layered handlers with fallbacks (known-card list, regex matcher, Oracle IR executor), so cheap full-fidelity simulation is not available today.
- Forge, the best-known open-source Magic engine, uses hand-written rules and heuristics rather than learned models. Its maintainers rate it best with aggro and midrange, mediocre with control, and weak with most combo decks ([Forge AI wiki](https://github.com/Card-Forge/forge/wiki/ai)).
- Reinforcement learning exists for Magic, but the [MTG-Causal-RL benchmark](https://www.alphaxiv.org/abs/2605.06066) covers five Standard archetypes with a fixed action space. Nothing I found handles singleton 100-card Commander decks.

**What to build, in order of payoff**

1. A bot-vs-bot benchmark on the real engine, so every change is measured (Section 10).
2. One shared position evaluator, so "cast removal", "attack" and "hold mana" can be compared on one scale (Section 5).
3. A game-plan layer that tells the evaluator what this deck is trying to do (Section 9).
4. Targeted lookahead for combat, lethal checks, sweepers and removal targets (Section 6).
5. An opponent model with belief tracking, and Commander-specific threat and politics logic (Sections 7 and 8).
6. Skill levels built from noise, horizon and information limits instead of random mistakes (Section 5).

## Where the field stands

Every approach that has worked on Magic-like games combines hand-written knowledge with some form of search or learning; none replaces the knowledge. The table compares the options on how well they fit a Commander bot running inside a Node.js server.

| Approach | How it works | Evidence | Fit for MTGEDH |
| --- | --- | --- | --- |
| Heuristic scoring and rules | Hand-written value rules per decision type | Forge relies on this; strongest with aggro and midrange, weak with combo ([Forge wiki](https://github.com/Card-Forge/forge/wiki/ai)) | Your current approach. Cheap and debuggable, but needs one shared scale. |
| Flat Monte-Carlo search | Random playouts after each legal move, pick the best win rate | Prototype on lands, sorceries and creatures only; assumed known decklists ([Towards Data Science](https://towardsdatascience.com/monte-carlo-search-for-magic-the-gathering-6ca60750fcc6)) | Too weak as built: random playouts, no stack, no instants. |
| Ensemble determinization MCTS | Guess hidden cards, search many trees, merge votes | About 47 to 52% wins versus a strong rules player; best with 20 to 100 trees on simplified Magic ([Cowling et al.](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf)) | Best search candidate, but needs a fast forward model. |
| ISMCTS | Searches trees of information sets, not guessed states | MO-ISMCTS beat determinized search on two games and roughly tied on a third; single-observer variants did worse on one ([Cowling, Powley, Whitehouse](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf)) | Later upgrade, once determinized search works. |
| MCTS plus learned value network | A network estimates win chance and cuts playouts short | Hearthstone bot beat plain MCTS, for example 82% versus 73.5% as first player at 0.5 s per move ([Hearthstone paper](https://arxiv.org/pdf/1808.04794)) | Realistic after you have thousands of self-play games. |
| Blueprint plus depth-limited search | Train a baseline offline, search a few steps live | Pluribus beat 15 professionals at six-player poker on two CPUs ([HPCwire](https://www.hpcwire.com/2019/07/15/new-cmu-ai-poker-bot-pluribus-humbles-the-prosagain/)) | The right shape for you: your scoring is the blueprint. |
| Deep reinforcement learning | Learn a policy from self-play | Masked PPO reached competitive win rates on five Standard archetypes ([MTG-Causal-RL](https://www.alphaxiv.org/abs/2605.06066)) | Not practical for open Commander card pools. |
| Language models | Prompt or fine-tune an LLM | The fine-tuned model I found picks draft cards only and ignores gameplay ([UrzaGPT](https://arxiv.org/html/2508.08382v1)) | Not for live play: slow and unreliable on rules. |

I could not load XMage's AI documentation, so its internals are left out of this survey.

**Three lessons that carry over**

- **Heuristics belong inside the search.** In the Magic study, a weaker stochastic rule-based player made better playouts than the strong expert player, and uniform random playouts were very weak.
- **Keep ensembles small.** A later study on three card games found the best ensembles had about 5 to 10 trees, and ensembles gained about 10 to 13 points over a single tree ([ED-MCTS allocation paper](https://arxiv.org/pdf/2607.13007)).
- **Multiplayer changes the search.** Survey work on multi-player games finds max^n weakest for alpha-beta search and best-reply search generally strongest, while MCTS with a max^n tree structure did best among MCTS variants ([Multi-player search overview](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf)). Those were board games, so treat the ranking as a hint.

## What your bot does today

Your bot is a per-decision rule engine with no lookahead, and each decision type uses its own private score scale. I read the public repo (A2152225/MTGEDH, commit e43d44e): about 5,600 lines of decision logic in `rules-engine/src` (`AIEngine.ts` and `aiEngine*.ts`), a 983-line `CardAnalyzer.ts`, and about 18,500 lines across 60 handler files in `server/src/socket/ai-handlers` that execute the choices.

| Decision | Where | How it decides today | Gap |
| --- | --- | --- | --- |
| Mulligan | `aiMulliganHandlers.ts` | Rules on land count and mana sources; mulligans zero-land and all-land hands | Ignores spell quality, curve, colors and the commander |
| Spell order | `aiSpellPriority.ts` | Base 50 plus bonuses (mana rock +40, creature +30, removal +25, draw +20), with hard-coded card-name lists | Not tied to board state or game plan |
| Attackers | `aiEngineCombatSupport.ts` | Per-creature value (power plus toughness, death-trigger and deck bias) compared to a strategy threshold | Never scores the resulting board or the crack-back |
| Attack target | `aiEngineThreatSupport.ts` | Threat x100, combo pieces +300, life tiers +50 to +200; per attacker, avoids profitable blocks | No commander-damage progress, politics or retaliation |
| Blocks | `aiEngineBlockPlanning.ts` | Free block 25, kill-and-survive 60 plus value, trade by value difference, chump only when lethal | Strongest module; its approach should become the template |
| Strategies | `aiEngineStrategySupport.ts` | Six strategies that mostly shift thresholds; aggressive delegates to basic | Too coarse to express a deck's plan |
| Difficulty | `AIEngine.shouldMakeMistake` | Coin flip per decision: 0.4 x (1 - difficulty)^2 | Produces random errors, not human-like ones |
| Lookahead | none | Only state clone is a JSON copy for mana-payment checks (`aiSpellPaymentPlanHelpers.ts`) | No search of any kind |
| Testing | `GameSimulator.ts` | Separate simplified model: its own keep rule, no Oracle IR resolution, combat skipped early | Smoke test, not a faithful benchmark |

**What is already good**

- **Blocking is principled.** It handles menace, double blocks, chump blocks only when lethal, and 21-damage commander threats.
- **No peeking.** I found no reads of opponents' hands or libraries in the AI code, so there is no cheating to unwind.
- **Hard sanity rules.** The design notes in AIEngine.ts say mistakes must stay tactical, never rule-level, such as buffing an opponent or destroying your own permanents.
- **A card analyzer and deck profile exist.** `CardAnalyzer` already classifies cards and archetypes, including aristocrats, tokens, landfall, politics and group hug, and the deck profile tracks combo pairs and key cards.

**The five structural gaps**

1. **No common currency.** Spell priority, combat value and threat score use unrelated scales, so the bot cannot trade a removal spell against an attack against holding mana.
2. **Card knowledge is text matching.** Scores come from oracle-text substrings and name lists, which break on new cards and phrasing.
3. **No lookahead.** Every choice is greedy, including combat and sweeper timing.
4. **No opponent model.** The bot has no memory of what each opponent has shown, can hold, or has done to it.
5. **No faithful benchmark.** You cannot tell whether a change made the bot stronger.

## Recommended architecture

The bot should choose every action the same way: generate candidates, score them with one evaluator, simulate the top few, then pick. Your existing handlers stay as the executors.

&#91;embedded content: decision pipeline · 6 layers, 2 side inputs\]

Layers 1 to 3 are covered in Sections 5 and 9, layer 4 in Section 6, and the opponent model in Section 8. The skill profile also caps the lookahead budget.

**Design rules**

- **One currency.** The evaluator returns a number on one scale for any game state, and every candidate is scored by the state it leads to. Spell, combat and hold-mana choices then compete directly.
- **Reuse candidate generation.** `enumerateAIActionCandidates` in `aiActionCandidateHandlers.ts` already yields land, spell, commander and activated-ability candidates. Extend it with attack plans and pass or hold-mana options instead of writing a second generator.
- **Cheap first, expensive last.** Score every candidate with the evaluator, then spend simulation only on the top three to five.
- **One switch per layer.** Put the game plan, lookahead and opponent model behind flags, as you did for the Oracle IR, so the benchmark can measure each layer alone.
- **Every decision leaves a record.** Log the candidates, their scores, the choice and the reason. Your `AIDecision` type already carries `reasoning` and `confidence` fields.

## The position evaluator and skill levels

Build one function that rates a whole game state for every player, and score each candidate action by the state it leads to. In multiplayer the useful output is a win share per player, so the bot values weakening the leader and strengthening itself on one scale.

```latex
p_i = \frac{e^{S_i/\tau}}{\sum_j e^{S_j/\tau}}, \qquad S_i = \sum_k w_k \, f_k(s, i)
```

Here `S_i` is player i's strength from weighted features `f_k`, and `p_i` is the win share. The temperature `tau` controls how sharply the leader is favored. This is my design recommendation, not a published result for Magic.

**Feature groups to start with**

| Group | Example features | Where to get the data |
| --- | --- | --- |
| Survival | Life, commander damage taken per source, poison | `commanderDamage` and `life` on game state (already read by block planning) |
| Board | Creature value, evasion, summoning sickness, attachments | Replace the regexes in `evaluatePermanentValue` |
| Mana | Lands, rocks, dorks, colors available versus needed | Existing mana helpers in `ai-handlers` |
| Card flow | Hand size and quality, draw engines, graveyard value | Zones on game state |
| Engines and wins | Combo pieces assembled, engine pieces, turns to win | `CardAnalyzer` categories plus the game plan (Section 9) |
| Interaction | Held counters and removal, open mana on the opponent's turn | Hand contents and untapped lands |
| Exposure | Commitment to the board versus sweepers, reliance on one permanent | Board counts plus opponent beliefs (Section 8) |
| Clock | My turns to kill versus each opponent's turns to kill me | Board power, life and evasion |

Start with weights copied from your current numbers, then tune them by self-play in the benchmark (Section 10). Clock and exposure are the features your bot lacks entirely, and they drive most human-looking decisions.

**Derive card features from your Oracle IR, not from text matching**

Your engine already compiles Oracle text into an IR for resolution. Add an extractor that turns each card's IR into a cached `CardFeatures` record once, when the deck loads. I did not inspect the IR's shape in depth, so where it lacks a field, fall back to the current regex and log the gap, as your IR gap audits do.

```ts
interface CardFeatures {
  roles: Array<'ramp' | 'removal' | 'sweeper' | 'draw' | 'tutor' | 'counter'
    | 'protection' | 'engine' | 'finisher'>;
  manaValue: number;
  instantSpeed: boolean;
  removalScope?: 'single' | 'mass';
  evasion: boolean;
  planWeight: number; // 0..10, how much this card matters to its own deck's plan
}

type Evaluate = (
  state: GameState,
  beliefs: OpponentModel,
  plan: GamePlan,
) => Record<PlayerID, number>; // win share per player, sums to 1
```

**Scoring a candidate**

1. Apply a cheap approximate effect to a lightweight copy of the state: a creature joins the board, a removal spell takes a permanent out, a draw spell adds cards to hand.
2. Compute win shares before and after.
3. Subtract a tempo cost for the mana spent.
4. Treat "pass and hold mana" as a candidate whose value is the chance of using the held card, times its value.

**Skill levels that look human**

Replace the per-decision coin flip with dials that each change how the bot thinks. A human's weakness is usually misjudging a position, not ignoring a legal play. The dials below also keep your rule that mistakes stay tactical, never rule-level.

| Dial | What it changes | Easy | Hard |
| --- | --- | --- | --- |
| Choice temperature | Softmax over candidate scores instead of always taking the top one | High | Near zero |
| Floor | Candidates scoring far below the best are never chosen, so no nonsense plays | Wide | Narrow |
| Attention | How many opponent permanents and threats it evaluates | Obvious ones only | All |
| Horizon | Lookahead budget in milliseconds and depth | None | Full budget |
| Information use | Whether it tracks cards seen and open mana | Off | On |

Set the dials as one `SkillProfile` per bot, and keep the existing 0 to 1 difficulty slider by mapping it onto the profile. Tune the starting values in the benchmark so each level wins a fixed share against the next.

## Targeted lookahead

Add lookahead where a small, cheap simulator can answer the question, and hold full rollouts until you have a fast forward model. Your AI acts through async socket handlers that persist events to the database, so simulating through them is too slow. The one state clone I found is a JSON copy for mana-payment checks (`cloneAISpellPaymentSimulationGame`).

For scale: the Magic study ran 10,000 simulations per move across 40 trees on a game with only lands and creatures ([Cowling et al.](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf)). Commander with the stack, triggers and a full card pool is far heavier per simulation.

**Five tiers, cheapest first**

| Tier | Question | Method | Needs |
| --- | --- | --- | --- |
| 1. Lethal and survival | Can I kill someone this turn? Can anyone kill me next turn? | Exact arithmetic over board power, evasion, blockers, life and commander damage | Nothing new |
| 2. Combat plan | Which attackers, at whom, and what happens on the crack-back? | Enumerate a few attack plans, resolve blocks with your `planAIBlocks` as the defender model, score the board after | Abstract simulator |
| 3. Commit or wait | Do I add to the board now or hold back against a sweeper? | Score both lines against sampled opponent hands | Abstract simulator and beliefs |
| 4. Removal target | Which permanent should this spell hit? | Score the state after each target; pick the biggest win-share gain | Evaluator |
| 5. Rare big turns | Combo turns, long stack sequences | Determinized rollouts with a heuristic playout policy | Forward model |

Tiers 1 to 4 deliver most of the visible improvement and need no full-engine fork. Build them first.

**Forward model options**

- **A. Abstract simulator (build first).** A compact `SimState` of life, commander damage, mana, hand size and lightweight permanents, advanced by `CardFeatures` effect deltas. It runs in microseconds and powers tiers 1 to 4.
- **B. Fork the real engine.** Clone `game.state` and apply events in a sandbox context, using the replay machinery behind `applyEvent`. Fidelity is high, but measure the clone cost on a late-game Commander state before committing.
- **C. Upgrade `GameSimulator`.** It currently uses its own simplified rules, so it cannot serve as a forward model without major work.

```ts
interface SimPlayer {
  life: number;
  cmdDamage: Record<PlayerID, number>;
  manaAvailable: number;
  handSize: number;
  knownHand: CardFeatures[];
  board: SimPermanent[];
}
interface SimState {
  turn: number;
  active: PlayerID;
  phase: 'main1' | 'combat' | 'main2' | 'end';
  players: Record<PlayerID, SimPlayer>;
}
declare function applyCandidate(s: SimState, c: Candidate): SimState; // pure and cheap
declare function resolveCombat(s: SimState, attacks: Attack[], blocks: Block[]): SimState;
```

**Determinized rollouts for tier 5**

1. Sample K hidden-information worlds from the opponent model (Section 8). Start with K between 5 and 10: a recent study found the best ensembles at that size, though on other card games ([ED-MCTS paper](https://arxiv.org/pdf/2607.13007)).
2. In each world, run a tree search where playouts follow your evaluator's softmax policy, not uniform random. The Magic study found a weaker stochastic rules player made better playouts than the expert, and random playouts were very weak.
3. Cut each playout early and score the position with the evaluator. A Hearthstone bot did the same with a learned value network and beat plain MCTS ([Hearthstone paper](https://arxiv.org/pdf/1808.04794)).
4. Merge the trees by summing root visit counts, as the Magic study did.
5. Model each opponent as maximizing its own win share (a max^n structure), not as a coalition against you. Commander tables are not coalitions, and the multi-player survey found max^n the strongest tree structure for MCTS ([overview](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf)).

**Running it in Node.js**

- Run lookahead in `worker_threads` so the socket loop never blocks, and send only the compact `SimState`.
- Give every decision a wall-clock budget set by the skill profile, and return the best answer found so far when time runs out.
- Seed the random generator per decision so a bad choice can be replayed exactly.
- **No peeking.** Worlds may only use public state, the bot's own hand, and samples from beliefs. Add a test that fails if lookahead code reads an opponent's real hand or library.
- **Gate each tier.** Turn it on by default only after the benchmark shows it beats the same bot with it switched off.

## Commander multiplayer: threats, politics and combat

At a four-player table the core skill is choosing whom to pressure and when, so the bot should treat each opponent as a rival with separate goals, not as one blended enemy. Everything in this section is design guidance from how Commander is played; none of it comes from a published benchmark.

**Split threat into four numbers per opponent**

Your `selectAttackTarget` blends threat, combo pieces, life tiers and creature count into one score. Humans reason about at least four separate questions.

| Signal | Question it answers | Typical inputs |
| --- | --- | --- |
| Table threat | Is this player close to winning or locking the game? | Clock, assembled combo or engine pieces, tutors, extra-turn effects, board dominance |
| Personal threat | Can they hurt me soon? | Evasive power against my life and blockers, commander damage already dealt to me, removal aimed at my key permanents |
| Opportunity | How cheaply can I hurt them now? | Open lanes (`attackerHasOpenLane`), low life, few untapped blockers |
| Grudge | What have they done to me? | Attacks, removal and counterspells aimed at me, decaying over turns |

```ts
interface ThreatReport {
  table: number;       // 0..1
  personal: number;    // 0..1
  opportunity: number; // 0..1
  grudge: number;      // 0..1
}

// Starting rule, tune in the benchmark:
// if any table >= panicCutoff, target that player;
// otherwise rank by opportunity + 0.6 * personal + 0.3 * grudge.
```

**Attack planning**

- **Plan the whole attack, not each creature.** Choose the set of attackers and defenders together, then score the board after combat including the crack-back (Section 6, tier 2).
- **Keep a deterrent.** Leave enough untapped blockers against the strongest visible attacker at the table, as measured by your personal-threat number.
- **Route the commander by the damage ledger.** Track 21-damage progress per source (your `readCommanderDamageTaken` already reads it) and send the commander at the player closest to lethal, while defending against the same rule.
- **Respect sweepers.** Use the exposure feature so the bot stops overcommitting when an opponent holds up mana in a color that sweeps.
- **Choose among players, planeswalkers and battles by value,** using the evaluator, not a fixed order.

**Politics and memory**

- **Grudge ledger.** Record who attacked, removed or countered the bot's permanents. Let it decay each turn and feed it into target choice as a modest bias. Retaliation is what makes a bot feel like a person at the table.
- **Leader pressure comes for free.** With win shares from the evaluator, hitting the leader raises the bot's own share, so the table converges on the leader without any coalition code.
- **Avoid kingmaking.** When the bot cannot win, it should not spend resources that hand the game to one specific rival. Add a penalty for actions that raise one opponent's win share far above the others.
- **Optional narration.** Your decision records already hold the reason for each choice. A simple template layer could post short lines such as "attacking Alex: lowest life, no blockers" to the game chat. It changes no rules and makes the bot read as human.

**Commander-specific resource decisions**

- **Casting the commander.** Compare the tax against the plan's need. Recasting a commander for a high tax late can lose to developing the board; the evaluator's tempo cost handles this if it includes mana spent.
- **Premium removal.** Save it for table threats the game plan marks as must-answer, such as a combo piece or a win condition, rather than the first large creature.
- **Unused mana is a cost.** Count wasted mana as lost tempo in the evaluator, with held-up instant-speed cards counting as used when the bot has a plausible play.
- **Responding to the stack.** Score the state after a spell resolves versus after a counter, and counter only when the difference passes a threshold tied to the plan's must-answer list.

## Hidden information and opponent modeling

The bot cannot see opponents' hands, but public play reveals a lot, so keep a belief state per opponent and sample from it wherever the bot needs a guess. Commander helps here: each deck is 100 singleton cards inside its commander's color identity, which sharply limits what an opponent can hold. The inputs below are design guidance; the sampling idea follows the determinization work in Section 2.

**What to track per opponent**

| Belief item | How it is learned | Used for |
| --- | --- | --- |
| Color identity | Their commander's colors | Limiting which cards they could hold |
| Cards seen | Casts, activations, reveals, graveyard and exile | Removing cards from the unknown pool; spotting the archetype |
| Role counts seen | Roles of cards seen (removal, sweeper, ramp, draw) | Estimating how many of each role remain unseen |
| Open mana | Untapped lands and colors during my turn | Odds of instant-speed interaction |
| Hand size and known cards | Draw and discard counts, tutors, reveals, put-backs | How many unknown cards they hold |
| Aggression and targets | Who they attacked last turn and how many creatures | Predicting the crack-back in lookahead |

```ts
interface OpponentBelief {
  colorIdentity: string[];
  cardsSeen: Set<string>;                 // public information only
  roleCountsSeen: Record<string, number>;
  archetypePosterior: Record<string, number>; // keyed by SynergyArchetype
  openMana: Record<string, number>;       // observed on my turn
  handSize: number;
  knownInHand: string[];                  // revealed or tutored, still in hand
  grudge: number;                         // 0..1, see Section 7
  aggression: number;                     // 0..1, rolling attack frequency
}
```

**Build beliefs by folding public events.** Your game is event-sourced (`appendEvent`, `applyEvent` and replay), so derive each belief from the public event stream. Beliefs then survive a server restart or a replay without extra storage.

**Turn beliefs into probabilities**

The questions the bot cares about are "could they hold a sweeper, a counterspell or cheap removal right now?" A hypergeometric estimate answers them from the unknown pool.

```latex
P(\geq 1) = 1 - \frac{\binom{N-K}{n}}{\binom{N}{n}}
```

Here N is the unknown cards in their deck (library plus hand), K is the expected number of that role still unseen, and n is their hand size. For K, start from common Commander deckbuilding templates, roughly 10 each of ramp, draw and removal, 2 to 4 sweepers and 36 to 38 lands. These are approximate rules of thumb, so replace them with counts from real decks you gather.

Adjust the result by open mana. An opponent with no untapped blue sources cannot counter a spell this turn, so that probability is zero regardless of hand.

**Archetype inference**

Keep a posterior over your existing `SynergyArchetype` values plus a few plan labels such as combo, control and stompy. Update it each time a card is seen: multiply the prior by how likely that card is under each archetype, then renormalize. Use the result to adjust sweeper odds, combo threat and expected removal.

**Sample worlds for lookahead**

1. Draw each opponent's hand from the unknown pool, weighted by role counts and archetype.
2. Force-include known cards in hand and exclude cards already seen.
3. Reuse the same sampler for every tier that needs a guess (Section 6), so beliefs are written once.

**Optional priors**

When an opponent's commander matches a public precon, the precon list can serve as a prior for their deck, the way a human who knows the product would guess. Your repo already includes `precon_json`. Treat this as an option only, and never read a player's actual deck list or hand.

**Guardrails**

- Add a unit test that fails if any belief or sampling code reads an opponent's real hand, library or deck list.
- Keep beliefs as data on the bot, not on game state, so human players and spectators never see them.
- Log the belief inputs next to each decision record so "why did it hold back?" has an answer.

## Game plans: playing the deck, not just the board

Turn your existing deck profile into a `GamePlan` that tells the evaluator what winning looks like for this specific deck. You already compute most of the inputs. `DeckArchetypeProfile` holds the curve, `categoryCounts`, `archetypeScores` (including politics and group hug), `comboPairs` and up to 10 `keyCards`, and `aiEngineDeckSupport.ts` collapses all of that into one of six `AIStrategy` values.

The collapse is the loss. A tokens deck with a drain finisher and a voltron deck both land on a threshold tweak, when they want different things from the same board.

**What a plan adds on top of the profile**

| Plan element | What it holds | Used by |
| --- | --- | --- |
| Archetype mix | Weights across archetypes instead of one label | Evaluator weight overrides |
| Win routes | Ordered list: combo lines, commander damage, go-wide alpha strike, drain | The clock feature and turns-to-win |
| Weighted key cards | A 0 to 10 weight per card, not a fixed top 10 | Casting order, protection, tutor targets, mulligans |
| Must-answer roles | What the bot should keep removal for at this table | Removal targeting (Section 6, tier 4) |
| Mulligan needs | Land range, ramp count, color sources, a play by turn 3, commander castability | Keep or mulligan (below) |
| Sequencing notes | For example ramp before engines, engines before win conditions | Tie-breaks between similar scores |

```ts
interface GamePlan {
  archetypeMix: Record<string, number>;      // sums to 1
  winRoutes: Array<{ kind: 'combo' | 'commanderDamage' | 'goWide' | 'drain' | 'other';
                     pieces: string[]; turnsAway?: number }>;
  cardWeights: Record<string, number>;       // 0..10
  mustAnswer: string[];                      // roles such as 'combo-piece', 'sweeper'
  mulligan: { landMin: number; landMax: number; wantsRamp: boolean; colorsNeeded: string[] };
  weightOverrides: Partial<Record<string, number>>; // keyed by evaluator feature name
}
```

Build the plan once at game start from the deck, and rebuild it only when the commander changes.

**Archetype emphasis**

| Archetype | Signature in the decklist | Evaluator emphasis | Play pattern |
| --- | --- | --- | --- |
| Voltron or aggro | Cheap creatures, equipment and auras, an attacking commander | Clock, evasion, commander damage | Attack early; protect the commander |
| Midrange or value | Balanced creature, removal and draw counts | Board and card flow | Trade efficiently; keep pace |
| Control | Counterspells, sweepers, spot removal, few threats | Interaction, card flow, life | Hold mana; answer must-answer threats |
| Combo | Tutors, linked pieces, protection | Pieces assembled, protection held | Keep pieces; tutor and protect the last one |
| Ramp | Many ramp spells, large finishers | Mana development, then big threats | Develop mana first; deploy payoffs on time |
| Tokens or aristocrats | Token makers, sacrifice outlets, drain | Board width, engine pieces, exposure to sweepers | Build wide; avoid overcommitting into sweeps |
| Politics or group hug | Goad, forced combat, symmetrical effects | Personal threat, grudge, table balance | Deflect attention; steer others' attacks |

Express each row as weight overrides on the Section 5 features, such as a higher weight on interaction for control or on commander damage for voltron. Use relative changes and let the benchmark set the numbers.

**Combo detection**

Your `comboPairs` come from pattern matching inside one deck. For known combos, consider a public database. Commander Spellbook's backend is open source under the MIT license, and it publishes an npm client ([backend repo](https://github.com/SpaceCowMedia/commander-spellbook-backend)). I could not confirm its lookup endpoints from that page, so check them, or its data export, before relying on it.

Once the plan lists a combo, track pieces in hand, on the battlefield and in the library. When all but one piece is assembled, give that last piece top priority for tutoring and hold protection for it.

**Mulligans from simulation**

The bot knows its own deck, so a cheap simulation is allowed here. Sample a few hundred draw sequences for the next three or four turns from the library composition, and measure how often the hand makes its land drops, casts a play by turn 3 and casts the commander on time. Keep when that score meets or beats the average for a fresh six-card hand. Commander's free first mulligan (your code already models it) lowers the bar to mulligan once.

**Test it on real decks**

Your `precon_json` folder holds 12 full precon deck lists. Extend `aiDeckStrategyInference.test.ts` so each deck's expected archetype mix and key cards are asserted, then use the same decks as the benchmark pool (Section 10).

## Roadmap and benchmark

Build the benchmark first, then ship one layer at a time, each gated by a measured win-rate gain over the previous version. Skip Phase 6 if Phases 1 to 5 already give the strength you want.

&#91;embedded content: roadmap · 7 phases, 7 benchmark gates\]

**Benchmark design**

- **A faithful headless runner.** Run all-bot pods on the real server engine, not `GameSimulator`. Your AI handlers take the socket.io `io` object as a parameter, so a recording stub plus an in-memory stand-in for the `appendEvent` database calls should let a four-bot game run in one process. Verify that early, because it decides how fast you can iterate.
- **Fair pods.** Use four seats with one new bot and three baseline bots, and rotate decks and seats so each deck plays each seat equally. Draw decks from your 12 `precon_json` decks first, then add your friends' real decks with their permission.
- **Seeded runs.** Seed each game so any result can be replayed exactly.
- **Metrics.** Win rate per version (25% is even at four seats), turns per game, draws and timeouts, stuck-game rate, no-op action rate, and time per decision.
- **Ratings.** Rank bot versions with Glicko-2, as the Hearthstone bot study did for 64 versions ([paper](https://arxiv.org/pdf/1808.04794)).

**How many games you need**

A win rate near 25% has a standard error of about 1.4 points at 1,000 games. The table shows the 95% margin, so you can tell whether a gain is real.

| Games per matchup | 95% margin on a 25% win rate |
| --- | --- |
| 100 | about 8.5 points |
| 400 | about 4.2 points |
| 1,000 | about 2.7 points |
| 2,500 | about 1.7 points |

Treat a gain as real only when it clears the margin. If a game takes seconds on the real engine, run thousands overnight.

**Decision records and golden decisions**

- Log each decision as JSON: turn, phase, every candidate with its score, the choice, the belief summary, the skill profile and the seed.
- Turn every bad play you notice into a fixture in the style of `aiSensibleBlocks.regression.test.ts`, so it cannot return.

**Measuring human-likeness**

Strength and human-likeness are different goals, so measure both. Your event log already stores real games. Replay recorded human decisions and count how often the bot's top three candidates include what the human chose. Also run short blind playtests with friends and family, and ask which seat they think is the bot.

**Pitfalls to plan for**

- **Overfitting to 12 decks.** Add decks over time and keep a held-out set that you never tune on.
- **Bots tuned only against bots.** They learn each other's quirks. Keep a set of human-played positions as a regression check.
- **Latency.** Cap time per decision and watch the slowest 1% of decisions, not the average.
- **Think-time feel.** `AIPlayerConfig` already has a `thinkTime` field. Use a short randomized delay so fast lookahead does not make the bot feel robotic.
- **Rule-level errors from lookahead.** Take candidates only from the legal-action enumerator, never from the simulator.
- **Stuck games.** Your handlers include many idle and auto-pass guards. Track stuck games as a first-class metric.
- **Complexity creep.** Keep every layer behind a flag, and delete a layer that does not pay for itself in the benchmark.

## Sources

Pages I opened for this guide, as of 2026-10-29. Sections 5, 7, 8 and 9 are design recommendations built on these results and on your code; they are not published findings.

- [Cowling, Ward and Powley (2012), ensemble determinization MCTS for Magic](https://eprints.whiterose.ac.uk/75050/1/EnsDetMagic.pdf): win rates versus the expert rules player, tree counts, playout policies.
- [Cowling, Powley and Whitehouse (2012), Information Set MCTS](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf): strategy fusion and the three ISMCTS variants.
- [Dynamic resource allocation for ensemble determinization MCTS](https://arxiv.org/pdf/2607.13007): best ensemble sizes on three card games.
- [Monte-Carlo search for Magic: The Gathering (Towards Data Science)](https://towardsdatascience.com/monte-carlo-search-for-magic-the-gathering-6ca60750fcc6): flat Monte-Carlo prototype and its limits.
- [Improving Hearthstone AI by combining MCTS and supervised learning](https://arxiv.org/pdf/1808.04794): value network with early cutoff; Glicko-2 ranking.
- [An overview of search techniques in multi-player games](https://dke.maastrichtuniversity.nl/m.winands/documents/Multi_Overview.pdf): max^n, paranoid, best-reply search and MCTS variants.
- [Pluribus coverage (HPCwire)](https://www.hpcwire.com/2019/07/15/new-cmu-ai-poker-bot-pluribus-humbles-the-prosagain/): blueprint plus depth-limited search at six players.
- [Forge AI wiki](https://github.com/Card-Forge/forge/wiki/ai): heuristic design and strength by archetype.
- [MTG-Causal-RL benchmark](https://www.alphaxiv.org/abs/2605.06066): reinforcement learning on Standard archetypes.
- [UrzaGPT](https://arxiv.org/html/2508.08382v1): language models for draft card selection.
- [Commander Spellbook backend](https://github.com/SpaceCowMedia/commander-spellbook-backend): open-source combo database, MIT license.
- [MTGEDH repository](https://github.com/A2152225/mtgedh), commit e43d44e: AI engine, handlers, simulator and docs I read for Section 3.

Not available: I could not load XMage's AI documentation, so it is not covered.
