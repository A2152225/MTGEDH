# MTGEDH On-Cast Trigger Coverage Audit

- **Date:** 2026-08-22 (America/New_York)
- **Scryfall query:** `oracle:"When you cast this spell, " (game:paper) prefer:best`
- **API:** https://api.scryfall.com/cards/search?q=oracle%3A%22When+you+cast+this+spell%2C+%22+%28game%3Apaper%29+prefer%3Abest
- **Unique cards audited:** 85 (Scryfall total_cards=85)
- **Scope:** paper faces, unique by `oracle_id`

## Executive summary

Creature on-cast triggers do queue (Hatut G1). Shared infrastructure around detection, target metadata, and multi-clause extraction was the highest-leverage gap class (same family as Artisan of Kozilek).

### Fixes landed this pass

1. **Full-clause on-cast extraction** (`rules-engine/src/cards/castTriggers.ts`): no longer truncates at the first `.`, preserves casing, strips trailing reminder text, absorbs modal bullet lines, returns all self-cast clauses.
2. **Multi on-cast queueing** (`onCastSpellTriggerUtils.ts` + `game-actions.ts` ~14066): `resolveOnCastSpellTriggerDescriptions` + loop so Wastescape Battlemage / Sowing Mycospawn queue both abilities.
3. **Richer on-cast target metadata** (`inferTriggeredAbilityTargetMetadata.ts`): compound `artifact, enchantment, or land`; non-GY `up to N` / `two target` min/max.
4. **Bruna-style OR subtypes** (`resolution.ts` `matchesRequiredTypeWords`): `Angel or Human` matches either subtype.
5. **Unit tests** (`server/tests/on-cast-spell-trigger.unit.test.ts` + `reflexive-if-you-do-on-cast.unit.test.ts`).
6. **Optional pay / processor If-you-do** - bare on-cast effect; fixed-payment parser accepts If/When you do; generic controller optional mana-pay; processor exile->GY ask/select + followup trigger.
7. **Compound / up-to / two-target on-cast targeting** - `triggeredAbilityBattlefieldTargetMatch.ts`; color filter metadata; game-actions action map keeps inferred min/max; IR up-to exile/tap zero-choice no-ops.
8. **Kicker intervening-if for multi on-cast** - stamp wasKicked/paidKickerCosts on cast + trigger; intervening-if refs always include stack ledger; specific `{G}` / `{1}{U}` cost match.

8. **Commander Storm CZ copy suite** - one generic taxById/2 cast count feeding copy_spell for Echo/Fury/Genesis/Empyrial/Skull (+ Hatut).
9. **Depth Defiler** - kickerChooseBoth forced-both when kicked; draw-then-discard subject repair inside modes.
10. **Distended Mindbender / Mana Vortex** - reveal_hand choose-from-it discard repair; unless_sacrifices for counter-unless-sacrifice-land.

11. **Control-next-turn / World Anew bulk control** - generic `during_that_players_next_turn` duration + applyGainControlStep handlers; preface renamed off Emrakul.
12. **Lashweed library_top metadata** - non-GY put-on-owner's-library destination inference.
13. **Any-player-may tax windows** - generic `any_player_may` (life/half-life/discard/sacrifice) + APNAP prompts; Brain Gorgers / Dash Hopes / Temporal Extortion / Phantasmagorian.
14. **Targeted gain-control on-cast** - Obligator compound rider repair; Flayer/Beast transfer; Taskmaster for-each-opponent maxTargets.
15. **Mutated Cultist** - remove-all-counters + next-spell cost reduce for counters removed.

### Top remaining retest priorities

1. ~~**Bearer of Silence / Ruin Processor / Blight Herder / Vile Redeemer**~~ - **wired** (2026-08-22): bare on-cast effect; fixed-payment parser accepts If/When you do; generic optional mana-pay; processor exile->GY ask/select + followup queue.
2. ~~**World Breaker / Ugin / Elder Deep-Fiend / Ulamog Ceaseless Hunger**~~ - **wired** (2026-08-22): compound `artifact, enchantment, or land` matching; up-to N min=0 + cancel/empty no-op; colored-permanent filter; exactly-two for Ceaseless Hunger (fixed bad minTargets=0 override); IR tap/exile respect zero chosen targets.
3. ~~**Wastescape Battlemage / Sowing Mycospawn**~~ - **wired** (2026-08-22): both clauses still queue; on-cast stamps wasKicked/paidKickerCosts; intervening-if skips unkicked / wrong-kicker costs.
4. ~~**Commander *Storm* suite** (Echo/Fury/Genesis/Empyrial/Skull + Hatut)~~ - **wired** (2026-08-22): generic `resolveCommanderCastsFromCommandZoneThisGame` (taxById/2) feeds `resolveCopySpellCount` / server copy_spell push for all suite cards.
5. ~~**Depth Defiler**~~ - **wired** (2026-08-22): `kickerChooseBoth` on choose_mode; unkicked min=max=1; kicked auto-resolves both; target-player draw-then-discard who repair.
6. ~~**Distended Mindbender / Mana Vortex**~~ - **wired** (2026-08-22): reveal_hand+dual-filter discard repair; `unless_sacrifices` wraps counter_spell; both IR-fully-wired.
7. ~~**Emrakul Promised End / World Anew**~~ - **wired** (2026-08-22): generic control-next-turn (`during_that_players_next_turn` + `controlledPlayerNextTurn`) / bulk `all creatures target player controls` gain_control; preface uses `applyControlOfTargetOpponentNextTurnFromTrigger` (no card-name helper).
8. ~~**Lashweed Lurker**~~ - **wired** (2026-08-22): non-GY `targetDestination: library_top` (+ owner library) in `inferTriggeredAbilityTargetMetadata`.

Named retest priorities 1-8 are cleared. Leftover clusters wired (2026-08-22 evening):
9. ~~**Brain Gorgers / Dash Hopes / Temporal Extortion / Phantasmagorian**~~ - **wired**: generic `any_player_may` IR + APNAP Pay/Decline; discard/sac Pay opens hand/sac pickers then resumes APNAP (cancel=decline).
10. ~~**Eldrazi Obligator / Flayer of Loyalties / The Beast / Hideous Taskmaster**~~ - **wired**: compound gain-control rider repair; creature target metadata; for-each-opponent multi maxTargets; `applyGainControlStep` until-EOT transfer.
11. ~~**Mutated Cultist**~~ - **wired**: `remove_counter` all/any from up-to-one permanent or opponent + `grant_next_spell_cost_reduction` for each counter removed this way.

## Wiring map (shared)

| Stage | Location | Notes |
|---|---|---|
| Detection | `rules-engine/src/cards/castTriggers.ts` `extractSelfCastEffectClauses` / `detectCastTrigger` | Self-cast paragraphs + Emrakul shorthand |
| Resolve text | `server/src/state/modules/onCastSpellTriggerUtils.ts` | One or many descriptions |
| Queue on cast | `server/src/socket/game-actions.ts` ~14066 | Pushes `triggered_ability` stack items; optional via `/you may/i` |
| Target metadata | `inferTriggeredAbilityTargetMetadata` | Rich GY + compound/up-to |
| Execute | `executeTriggerEffect` -> oracle IR primary then legacy preface/body/tail | `stackExecuteTriggerEffectUtils.ts` |

## Pattern clusters

### create_tokens

- **Count:** 11
- **Status:** `partial`
- **Examples:** Abby, Merciless Soldier, Benthic Anomaly, Blight Herder, Desolation Twin, Drowner of Truth // Drowned Jungle
- **Static IR-wired (effect body):** 11/11
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Token creation generally IR/legacy wired; Blight Herder / Vile Redeemer optional pay/processor gates wired. X-from-mana-spent (Prossh/Abby) still higher risk.

### copy_spell_or_permanent

- **Count:** 8
- **Status:** `partial`
- **Examples:** Brass Knuckles, Bygone Marvels, Lumaret's Favor, Mentor's Guidance, Photon Blast Barrage
- **Static IR-wired (effect body):** 8/8
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Spell-copy stack IR exists; creature token-copy and conditional copies (Sage/Bygone/Malicious) vary.

### exile_target_permanent

- **Count:** 7
- **Status:** `partial`
- **Examples:** Devourer of Destiny, Sowing Mycospawn, Thief of Existence, Ugin, Eye of the Storms, Ulamog, the Ceaseless Hunger
- **Static IR-wired (effect body):** 7/7
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** World Breaker compound + Ugin up-to-one colored + Ulamog exactly-two targeting UX/resolution wired. Thief of Existence colored-permanent rider may still need playtest beyond Ugin filter.

### draw

- **Count:** 7
- **Status:** `wired`
- **Examples:** Herigast, Erupting Nullkite, Hydroid Krasis, Kozilek, Butcher of Truth, Kozilek, the Broken Reality, Kozilek, the Great Distortion
- **Static IR-wired (effect body):** 7/7
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Queued on cast; Kozilek draw-four covered by eldrazi-cast-trigger-resolution.integration.test.ts + oracle IR draw steps.

### commander_cast_copy

- **Count:** 6
- **Status:** `wired`
- **Examples:** Echo Storm, Empyrial Storm, Fury Storm, Genesis Storm, Hatut Zeraze Strike Force
- **Static IR-wired (effect body):** 6/6
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Generic `resolveCommanderCastsFromCommandZoneThisGame` (taxById sum/2) feeds `resolveCopySpellCount` + server deferred copy push. Suite unit tests cover Echo/Fury/Genesis/Empyrial/Skull + Hatut.

### gain_control

- **Count:** 6
- **Status:** `wired`
- **Examples:** Eldrazi Obligator, Emrakul, the Promised End, Emrakul, the World Anew, Flayer of Loyalties, Hideous Taskmaster
- **Static IR-wired (effect body):** 6/6
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Targeted gain-control (Obligator/Flayer/Beast) prompts + until-EOT transfer via repaired gain_control steps. Hideous Taskmaster for-each-opponent sets multi maxTargets. Promised End / World Anew remain on generic control-next-turn / bulk handlers.

### return_from_graveyard

- **Count:** 5
- **Status:** `wired`
- **Examples:** Artisan of Kozilek, Bruna, the Fading Light, Demigod of Revenge, Sauron, Lord of the Rings, Vexing Scuttler
- **Static IR-wired (effect body):** 5/5
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** On-cast path uses inferTriggeredAbilityTargetMetadata (GY zone/destination). Artisan-class fix already landed; Bruna Angel-or-Human OR matching fixed in resolution.

### sacrifice

- **Count:** 4
- **Status:** `wired`
- **Examples:** Bearer of Silence, Brain Gorgers, Gluttonous Hellkite, Mana Vortex
- **Static IR-wired (effect body):** 4/4
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Bearer optional pay->opponent sacrifice wired via generic pay/If-you-do path. Mana Vortex uses generic `unless_sacrifices`. Brain Gorgers uses generic `any_player_may` sacrifice payment window.

### tap

- **Count:** 4
- **Status:** `partial`
- **Examples:** Elder Deep-Fiend, Petrifying Meddler, Supernatural Rescue, Twisted Riddlekeeper
- **Static IR-wired (effect body):** 4/4
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Elder Deep-Fiend up-to-four targeting UX + empty-choice IR no-op wired. Stun-counter riders (Petrifying/Twisted) need counter placement verification.

### gain_life

- **Count:** 3
- **Status:** `partial`
- **Examples:** Abundant Maw, Breaker of Creation, Ruin Processor
- **Static IR-wired (effect body):** 3/3
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Ruin Processor processor gate->gain 5 life wired. Breaker-of-Creation for-each and Hydroid Krasis half-X remain value-expression sensitive.

### discard

- **Count:** 3
- **Status:** `partial`
- **Examples:** Depth Defiler, Distended Mindbender, Phantasmagorian
- **Static IR-wired (effect body):** 3/3
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Distended Mindbender reveal+dual CMV choose-from-it discard repaired (no grant_static). Depth Defiler kickerChooseBoth + then-discard who fixed. Phantasmagorian on-cast tax uses generic `any_player_may` discard window (see any_player_may_tax).

### put_onto_battlefield

- **Count:** 3
- **Status:** `partial`
- **Examples:** Genesis Hydra, Hatchery Spider, Wumpus Aberration
- **Static IR-wired (effect body):** 3/3
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Library/reveal-into-battlefield patterns (Genesis Hydra, Hatchery Spider, Oblivion Sower) are multi-step.

### any_player_may_tax

- **Count:** 2
- **Status:** `wired`
- **Examples:** Dash Hopes, Temporal Extortion
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Generic `any_player_may` IR + server OPTION_CHOICE APNAP window covers Dash Hopes / Temporal Extortion / Phantasmagorian / Brain Gorgers (life / half-life / discard / sacrifice). Discard/sacrifice Pay chains into DISCARD_SELECTION / TARGET_SELECTION for the paying player, then resumes APNAP (picker cancel = decline for that player).

### other

- **Count:** 2
- **Status:** `unknown`
- **Examples:** Malicious Affliction, Naya Soulbeast
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Residual unique effects.

### destroy

- **Count:** 2
- **Status:** `wired`
- **Examples:** Mockery of Nature, Ulamog, the Infinite Gyre
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Ulamog destroy target permanent: detection + target metadata + game-actions action map destroy_target_permanent; integration test present.

### exile_library_top

- **Count:** 2
- **Status:** `partial`
- **Examples:** Oblivion Sower, Ulamog, the Defiler
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Oblivion Sower / Ulamog Defiler involve multi-step exile + optional put-lands; IR may parse but UX/choice flows are complex.

### reveal_library

- **Count:** 2
- **Status:** `partial`
- **Examples:** Old Stickfingers, The Fourteenth Doctor
- **Static IR-wired (effect body):** 2/2
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Reveal-until / put Doctor cards / X creatures patterns are bespoke.

### search_library

- **Count:** 1
- **Status:** `partial`
- **Examples:** Conduit of Ruin
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Conduit of Ruin / Sowing Mycospawn use library search infra; optional + put-on-top vs put-onto-battlefield differ.

### pump

- **Count:** 1
- **Status:** `wired`
- **Examples:** Decimator of the Provinces
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Decimator mass pump until EOT is a common continuous-effect pattern under IR.

### extra_turn

- **Count:** 1
- **Status:** `wired`
- **Examples:** Emrakul, the Aeons Torn
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Emrakul Aeons Torn shorthand remains. Promised End uses generic control-next-turn pattern (`applyControlOfTargetOpponentNextTurnFromTrigger` / IR `during_that_players_next_turn`).

### counter_related

- **Count:** 1
- **Status:** `partial`
- **Examples:** Hope-Ender Coatl
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Hope-Ender Coatl counter-target may work; Mana Vortex counter-unless-sacrifice is IR unknown.

### put_on_library_top

- **Count:** 1
- **Status:** `wired`
- **Examples:** Lashweed Lurker
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Non-GY put-on-library (Lashweed Lurker) sets `targetDestination: library_top` + `destinationUsesSelectedCardOwner` via generic oracle patterns.

### remove_counters_cost_reduce

- **Count:** 1
- **Status:** `wired`
- **Examples:** Mutated Cultist
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Generic remove-all-counters from up-to-one permanent/opponent + `grant_next_spell_cost_reduction` deferred via `nextSpellCostReduction` grants.

### lose_life

- **Count:** 1
- **Status:** `partial`
- **Examples:** Scourge of the Skyclaves
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Abundant Maw opponent-lose+gain; Scourge kicked half-life needs kicker intervening-if.

### put_counters

- **Count:** 1
- **Status:** `partial`
- **Examples:** The Master, Formed Anew
- **Static IR-wired (effect body):** 1/1
- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR
- **Gap notes:** Stun/takeover counters may need specialized counter handlers.

## Per-card appendix (name -> primary pattern -> IR)

| Card | Primary pattern | IR wired | Targeted |
|---|---|---|---|
| Abby, Merciless Soldier | create_tokens | yes | no |
| Abundant Maw | gain_life | yes | yes |
| Artisan of Kozilek | return_from_graveyard | yes | yes |
| Bearer of Silence | sacrifice | yes | yes |
| Benthic Anomaly | create_tokens | yes | no |
| Blight Herder | create_tokens | yes | no |
| Brain Gorgers | sacrifice | yes | no |
| Brass Knuckles | copy_spell_or_permanent | yes | no |
| Breaker of Creation | gain_life | yes | no |
| Bruna, the Fading Light | return_from_graveyard | yes | yes |
| Bygone Marvels | copy_spell_or_permanent | yes | yes |
| Conduit of Ruin | search_library | yes | no |
| Dash Hopes | any_player_may_tax | yes | no |
| Decimator of the Provinces | pump | yes | no |
| Demigod of Revenge | return_from_graveyard | yes | no |
| Depth Defiler | discard | yes | no |
| Desolation Twin | create_tokens | yes | no |
| Devourer of Destiny | exile_target_permanent | yes | yes |
| Distended Mindbender | discard | yes | yes |
| Drowner of Truth // Drowned Jungle | create_tokens | yes | no |
| Echo Storm | commander_cast_copy | yes | yes |
| Elder Deep-Fiend | tap | yes | yes |
| Eldrazi Obligator | gain_control | yes | yes |
| Empyrial Storm | commander_cast_copy | yes | no |
| Emrakul, the Aeons Torn | extra_turn | yes | no |
| Emrakul, the Promised End | gain_control | yes | yes |
| Emrakul, the World Anew | gain_control | yes | yes |
| Flayer of Loyalties | gain_control | yes | yes |
| Fury Storm | commander_cast_copy | yes | yes |
| Genesis Hydra | put_onto_battlefield | yes | no |
| Genesis Storm | commander_cast_copy | yes | no |
| Gluttonous Hellkite | sacrifice | yes | no |
| Hatchery Spider | put_onto_battlefield | yes | no |
| Hatut Zeraze Strike Force | commander_cast_copy | yes | no |
| Herigast, Erupting Nullkite | draw | yes | no |
| Hideous Taskmaster | gain_control | yes | yes |
| Hope-Ender Coatl | counter_related | yes | yes |
| Hydroid Krasis | draw | yes | no |
| It of the Horrid Swarm | create_tokens | yes | no |
| Kozilek, Butcher of Truth | draw | yes | no |
| Kozilek, the Broken Reality | draw | yes | yes |
| Kozilek, the Great Distortion | draw | yes | no |
| Lashweed Lurker | put_on_library_top | yes | yes |
| Lumaret's Favor | copy_spell_or_permanent | yes | yes |
| Malicious Affliction | other | yes | yes |
| Mana Vortex | sacrifice | yes | no |
| Mentor's Guidance | copy_spell_or_permanent | yes | no |
| Mockery of Nature | destroy | yes | yes |
| Mutated Cultist | remove_counters_cost_reduce | yes | yes |
| Naya Soulbeast | other | yes | no |
| Nulldrifter | draw | yes | no |
| Oblivion Sower | exile_library_top | yes | yes |
| Old Stickfingers | reveal_library | yes | no |
| Osgood, Operation Double | create_tokens | yes | no |
| Petrifying Meddler | tap | yes | yes |
| Phantasmagorian | discard | yes | no |
| Photon Blast Barrage | copy_spell_or_permanent | yes | yes |
| Prossh, Skyraider of Kher | create_tokens | yes | no |
| Ruin Processor | gain_life | yes | no |
| Sage of the Skies | copy_spell_or_permanent | yes | no |
| Sauron, Lord of the Rings | return_from_graveyard | yes | no |
| Scourge of the Skyclaves | lose_life | yes | no |
| Show of Confidence | copy_spell_or_permanent | yes | yes |
| Skull Storm | commander_cast_copy | yes | no |
| Sowing Mycospawn | exile_target_permanent | yes | no |
| Spawn-Gang Commander | create_tokens | yes | no |
| Storm of Forms | copy_spell_or_permanent | yes | yes |
| Supernatural Rescue | tap | yes | yes |
| Temporal Extortion | any_player_may_tax | yes | no |
| The Beast, Deathless Prince | gain_control | yes | yes |
| The Fourteenth Doctor | reveal_library | yes | no |
| The Master, Formed Anew | put_counters | yes | no |
| Thief of Existence | exile_target_permanent | yes | yes |
| Twisted Riddlekeeper | tap | yes | yes |
| Ugin, Eye of the Storms | exile_target_permanent | yes | yes |
| Ulamog, the Ceaseless Hunger | exile_target_permanent | yes | yes |
| Ulamog, the Defiler | exile_library_top | yes | yes |
| Ulamog, the Infinite Gyre | destroy | yes | yes |
| Vexing Scuttler | return_from_graveyard | yes | yes |
| Vile Redeemer | create_tokens | yes | no |
| Wastescape Battlemage | exile_target_permanent | yes | yes |
| World Breaker | exile_target_permanent | yes | yes |
| Wretched Gryff | draw | yes | no |
| Writhing Chrysalis | create_tokens | yes | no |
| Wumpus Aberration | put_onto_battlefield | yes | yes |

## Companion JSON

- `tools/on-cast-trigger-coverage.json` - structured cluster + per-card probe
- `tools/_oncast_audit/probe-post.json` - raw post-fix probe
- `tools/_oncast_audit/scryfall.json` - Scryfall snapshot used for this audit

