// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: the redundant trigger-effect-fragment unknown-step predicate and its deep prune pass.
//
// Public entry points:
//   pruneRedundantTriggerEffectFragmentUnknownAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeUnknownStepText } from './oracleIRParserPostprocessCopySpellTailHelpers';

function isRedundantTriggerEffectFragmentUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized || step.kind !== 'unknown') return false;

  return (
    /^that amount of$/i.test(normalized) ||
    /^that mana value$/i.test(normalized) ||
    /^that many$/i.test(normalized) ||
    /^another$/i.test(normalized) ||
    /^this$/i.test(normalized) ||
    /^\(?whenever it attacks, add \{[rwubgc]\}/i.test(normalized) ||
    /^then for each blight counter on it,/i.test(normalized) ||
    /^two cards unless you discard an instant or sorcery card or a creature card with flying$/i.test(normalized) ||
    /^you may put up to two name stickers on it$/i.test(normalized) ||
    /^\(put the top three cards of your library into your graveyard\.\)$/i.test(normalized) ||
    /^when the last is removed, they may cast this card without paying its mana cost$/i.test(normalized) ||
    /^\(?to have (?:this creature|that creature|it) explore, reveal the top card of your library$/i.test(normalized) ||
    /^\(?put a \+1\/\+1 counter on each of up to two other target creatures\.\)?$/i.test(normalized) ||
    /^\(?activate each exhaust ability only once\.\)?$/i.test(normalized) ||
    /^\(?you get two energy counters/i.test(normalized) ||
    /^\(?each player puts the top card of their library into their graveyard\.\)?$/i.test(normalized) ||
    /^\(?at the beginning of its owner's upkeep, they remove a time counter/i.test(normalized) ||
    /^you spell that word$/i.test(normalized) ||
    /^excess combat$/i.test(normalized) ||
    /^an additional card$/i.test(normalized) ||
    /^two additional cards$/i.test(normalized) ||
    /^up to two cards$/i.test(normalized) ||
    /^seek a nonland card$/i.test(normalized) ||
    /^dredge \d+$/i.test(normalized) ||
    /^persist$/i.test(normalized) ||
    /^undying$/i.test(normalized) ||
    /^rebound$/i.test(normalized) ||
    /^afterlife \d+$/i.test(normalized) ||
    /^storm$/i.test(normalized) ||
    /^station \d+\+?(?:\s*\|\s*.+)?$/i.test(normalized) ||
    /^augment (?:\{[^}]+\})+(?:\s*\|.*)?$/i.test(normalized) ||
    /^that player loses the game$/i.test(normalized) ||
    /^you control enchanted (?:creature|permanent)$/i.test(normalized) ||
    /^cards you own named this permanent intensify by \d+$/i.test(normalized) ||
    /^draft a card from this permanent's spellbook$/i.test(normalized) ||
    /^return this card transformed under its owner's control$/i.test(normalized) ||
    /^combine it with target host$/i.test(normalized) ||
    /^collect your reward$/i.test(normalized) ||
    /^this permanent perpetually gets [+-]/i.test(normalized) ||
    /^this creature perpetually gets [+-]/i.test(normalized) ||
    /^target creature you control perpetually gets [+-]/i.test(normalized) ||
    /^those creatures perpetually get [+-]/i.test(normalized) ||
    /^creature cards in your graveyard perpetually get [+-]/i.test(normalized) ||
    /^.+ perpetually get[s]? [+-]/i.test(normalized) ||
    /^it perpetually gets [+-]/i.test(normalized) ||
    /^this ability also triggers if this permanent is in exile$/i.test(normalized) ||
    /^you may transform (?:it|this creature)$/i.test(normalized) ||
    /^(?:then\s+)?heist target opponent's library$/i.test(normalized) ||
    /^unattach it$/i.test(normalized) ||
    /^chaos ensues$/i.test(normalized) ||
    /^you may convert this permanent$/i.test(normalized) ||
    /^until the end of your next turn, you may play that card$/i.test(normalized) ||
    /^two cards instead$/i.test(normalized) ||
    /^then seeks that many nonland cards$/i.test(normalized) ||
    /^you get \{[a-z0-9]+\}$/i.test(normalized) ||
    /^they don't untap during their controllers' next untap steps$/i.test(normalized) ||
    /^the token enters with half that many \+1\/\+1 counters on it, rounded down$/i.test(normalized) ||
    /^you gain protection from everything until your next turn$/i.test(normalized) ||
    /^target opponent reveals each nonland card in their hand$/i.test(normalized) ||
    /^until you exile a nonland permanent card$/i.test(normalized) ||
    /^a card if it was attacking$/i.test(normalized) ||
    /^craft with .+ (?:\{[^}]+\})+(?:\s+.+)?$/i.test(normalized) ||
    /^a card" until end of turn$/i.test(normalized) ||
    /^convert this permanent$/i.test(normalized) ||
    /^the result$/i.test(normalized) ||
    /^a card at the beginning of the next turn's upkeep$/i.test(normalized) ||
    /^this ability triggers only once$/i.test(normalized) ||
    /^then planeswalk away from this phenomenon\.\)?$/i.test(normalized) ||
    /^planeswalk away from this phenomenon\.\)?$/i.test(normalized) ||
    /^rewards$/i.test(normalized) ||
    /^\([^)]+\)\.?$/i.test(normalized) ||
    /^\([^)]*$/i.test(normalized) ||
    /^excess combat$/i.test(normalized) ||
    /^you may cast the (?:artifact|enchantment) later from exile\.\)?$/i.test(normalized) ||
    /^to win:$/i.test(normalized) ||
    /^you get \{[a-z0-9]+\} \(an energy counter\) for each .+ you control$/i.test(normalized) ||
    /^that much life plus 1 instead$/i.test(normalized) ||
    /^then the owner of each permanent chosen this way shuffles$/i.test(normalized) ||
    /^that player puts the rest on the bottom of their library in a random order$/i.test(normalized) ||
    /^unicorn, or horse creature spell, copy it$/i.test(normalized) ||
    /^when the last is removed, you may cast it without paying its mana cost$/i.test(normalized) ||
    /^draft a card from this artifact's spellbook$/i.test(normalized) ||
    /^the mana value of the sacrificed permanent$/i.test(normalized) ||
    /^transform this equipment$/i.test(normalized) ||
    /^you can't lose the game$/i.test(normalized) ||
    /^the exiled card's owner seeks a nonland card with lesser mana value than the exiled card$/i.test(normalized) ||
    /^you choose one of those cards and exile it$/i.test(normalized) ||
    /^up to one hundred target creatures each get \+0\/\+x until end of turn, where x is /i.test(normalized) ||
    /^then each opponent who didn't sacrifice a creature discards two cards$/i.test(normalized) ||
    /^then if there are three or more ribbon counters on this creature, remove those counters and untap it$/i.test(normalized) ||
    /^until your next turn, whenever a player taps a land for mana, that player adds one mana of any type that land produced$/i.test(normalized) ||
    /^until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast (?:that spell|spells this way)$/i.test(normalized) ||
    /^the horde sacrifices two minotaurs$/i.test(normalized) ||
    /^select target player at random$/i.test(normalized) ||
    /^that player returns a creature they control to its owner's hand$/i.test(normalized) ||
    /^then both of them perpetually lose double team\.\)?$/i.test(normalized) ||
    /^the first instant or sorcery spell you cast each turn costs /i.test(normalized) ||
    /^you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost\. put the rest on the bottom of your library in a random order$/i.test(normalized) ||
    /^\(?to (?:mill|sacrifice|exile|scry|surveil|earthbend|treasure|energy)/i.test(normalized) ||
    /^\(?put the top (?:card|two cards|three cards)/i.test(normalized) ||
    /^\(?if unsolved, solve at the beginning/i.test(normalized) ||
    /^\(?choose a creature with the least toughness/i.test(normalized) ||
    /^\(?this token's mana cost is/i.test(normalized) ||
    /^\(?put the top card of your contraption deck/i.test(normalized) ||
    /^\(?if it would be dealt damage or destroyed, remove a shield counter/i.test(normalized) ||
    /^craft only as a sorcery\.\)?$/i.test(normalized) ||
    /^augment only as a sorcery\.\)?$/i.test(normalized) ||
    /^claim the revealed bounty during your turn and collect your reward!$/i.test(normalized) ||
    /^you may forage$/i.test(normalized) ||
    /^\(it's not a creature\.\)$/i.test(normalized) ||
    /^it unspecializes$/i.test(normalized) ||
    /^\(that creature returns under its owner's control\.\)$/i.test(normalized) ||
    /^the horde casts that card$/i.test(normalized) ||
    /^saddle only as a sorcery\.\)?$/i.test(normalized) ||
    /^station only as a sorcery\.\)?$/i.test(normalized) ||
    /^the blocking creature gets -1\/-1 until end of turn$/i.test(normalized) ||
    /^you may flip it$/i.test(normalized) ||
    /^\(it returns only from the battlefield/i.test(normalized) ||
    /^three cards at random$/i.test(normalized) ||
    /^two cards and loses 2$/i.test(normalized) ||
    /^damage to an opponent this turn, it deals double that$/i.test(normalized) ||
    /^you gain 2 life for each black and\/or red creature target opponent controls$/i.test(normalized) ||
    /^you gain 3 life for each harvest vote$/i.test(normalized) ||
    /^the same number$/i.test(normalized) ||
    /^a card if you had no cards in hand at the beginning of this turn$/i.test(normalized) ||
    /^then you may pay \{x\}, where x is the number of \+1\/\+1 counters on it$/i.test(normalized) ||
    /^you may look at that card for as long as it remains exiled$/i.test(normalized) ||
    /^you may have it become a copy of another target dinosaur you control/i.test(normalized) ||
    /^the next instant or sorcery spell you cast this turn costs \{x\} less to cast/i.test(normalized) ||
    /^three cards if three or more creatures died this turn$/i.test(normalized) ||
    /^you may pay an amount of \{e\} equal to target nonland permanent's mana value$/i.test(normalized) ||
    /^\(\{g\/p\} can be paid with either \{g\} or 2 life\.\)$/i.test(normalized) ||
    /^\(it returns only from the battlefield/i.test(normalized) ||
    /^until end of turn, each other creature you control gets \+1\/\+1 if it has flying/i.test(normalized) ||
    /^you may flip it$/i.test(normalized) ||
    /^the blocking creature gets -1\/-1 until end of turn$/i.test(normalized) ||
    /^two cards unless you discard an instant or sorcery card or a creature card with flying$/i.test(normalized) ||
    /^draft a card from this creature's spellbook$/i.test(normalized) ||
    /^you may pay any amount of life$/i.test(normalized) ||
    /^you have no maximum hand size until your next turn$/i.test(normalized) ||
    /^level \d+ you may play an additional land on each of your turns$/i.test(normalized) ||
    /^you get \{[a-z0-9]+\} for each .+ you control$/i.test(normalized) ||
    /^transform up to one other target double-faced artifact you control$/i.test(normalized) ||
    /^this effect can't reduce a number below \d+ or a number word below one$/i.test(normalized) ||
    /^then incubate x, where x is /i.test(normalized) ||
    /^your favorite creatures get [+-]/i.test(normalized) ||
    /^the life that player lost this turn$/i.test(normalized) ||
    /^(?:a card|\d+ cards?) and reveal(?:s)? it$/i.test(normalized) ||
    /^your maximum hand size is (?:two|three|four|five|six|seven|eight|nine|ten|\d+)$/i.test(normalized) ||
    /^(?:a card|\d+ cards?) and sacrifices? /i.test(normalized) ||
    /^it perpetually gains this ability$/i.test(normalized) ||
    /^the game is a draw$/i.test(normalized) ||
    /^then if that creature's power is greater than this permanent's power, put another \+1\/\+1 counter on this permanent$/i.test(normalized) ||
    /^x can't be greater than the greatest toughness among creatures you control$/i.test(normalized) ||
    /^awaken \d+-/i.test(normalized) ||
    /^then that player copies each instant or sorcery card exiled with this enchantment$/i.test(normalized) ||
    /^two target players each reveal the top card of their library$/i.test(normalized) ||
    /^then repeats this process for an artifact, an enchantment, and a land$/i.test(normalized) ||
    /^then if it has three or more \+1\/\+1 counters on it, transform it$/i.test(normalized) ||
    /^you may pay that much life again$/i.test(normalized) ||
    /^that creature can't become untapped for as long as you control this permanent$/i.test(normalized) ||
    /^you may choose new targets for any number of other spells and\/or abilities$/i.test(normalized) ||
    /^perpetually exchange target creature's base power with another target creature's base power$/i.test(normalized) ||
    /^the power of target creature you control$/i.test(normalized) ||
    /^you may fold this token in half$/i.test(normalized) ||
    /^hum that many notes of a festive song$/i.test(normalized) ||
    /^leaving empty spaces where any previously collected cards were$/i.test(normalized) ||
    /^the player with the most points wins!$/i.test(normalized) ||
    /^ties are shared$/i.test(normalized) ||
    /^two cards unless you discard an instant or sorcery card or a creature card with flying$/i.test(normalized) ||
    /^double that$/i.test(normalized) ||
    /^then you may pay \{x\}, where x is the number of \+1\/\+1 counters on it$/i.test(normalized) ||
    /^the greatest mana value among equipment attached(?: to it)?$/i.test(normalized) ||
    /^a card unless /i.test(normalized) ||
    /^this permanent gets \+1\/\+1 for each lesson card in your graveyard$/i.test(normalized) ||
    /^it perpetually gains double team$/i.test(normalized) ||
    /^you may choose a creature card from among them$/i.test(normalized) ||
    /^until end of turn, this creature has base power and toughness \d+\/\d+, gains trample, and isn't a human$/i.test(normalized) ||
    /^you have no maximum hand size and don't lose the game for having \d+ or less life$/i.test(normalized) ||
    /^then if you have no cards in hand, you lose the game$/i.test(normalized) ||
    /^then they each put the card they revealed into their hand$/i.test(normalized) ||
    /^horror of zhava is untapped, any opponent may sacrifice a nontoken creature$/i.test(normalized) ||
    /^then seek a land card and put it onto the battlefield tapped$/i.test(normalized) ||
    /^that player puts a flood counter on target non-island land they control of their choice$/i.test(normalized) ||
    /^that land is an island for as long as it has a flood counter on it$/i.test(normalized) ||
    /^then you may pay one or more \{e\}$/i.test(normalized) ||
    /^then play passes to the next player$/i.test(normalized) ||
    /^the exiled card's owner$/i.test(normalized) ||
    /^where x is this creature's power$/i.test(normalized) ||
    /^this permanent's power$/i.test(normalized) ||
    /^until end of turn, that player can't cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way$/i.test(normalized) ||
    /^storied matriarch, return up to one target goblin card from your graveyard to your hand$/i.test(normalized) ||
    /^bert, and william die, if they were a creature, return them to the battlefield$/i.test(normalized) ||
    /^vehicles you control have crew 1$/i.test(normalized) ||
    /^you may move all counters from this permanent onto target creature$/i.test(normalized) ||
    /^you may draw x cards, where x is the number of shrines you control$/i.test(normalized) ||
    /^this creature isn't a creature until end of turn$/i.test(normalized) ||
    /^you may have that opponent gain control of this permanent until end of combat$/i.test(normalized) ||
    /^then conjure two cards named mishra's foundry onto the battlefield tapped$/i.test(normalized) ||
    /^you may copy it, except the copy is a 1\/1 spirit in addition to its other types$/i.test(normalized) ||
    /^x life and you gain x$/i.test(normalized) ||
    /^they're an artifact$/i.test(normalized) ||
    /^you may have this permanent enter as a copy of a doctor card in your graveyard that was put there from your library this turn$/i.test(normalized) ||
    /^the next time you would set a scheme in motion, set three schemes in motion instead$/i.test(normalized) ||
    /^seek two creature cards with mana value less than or equal to the number of study counters removed this way$/i.test(normalized) ||
    /^you may copy this permanent and may choose a new target for the copy$/i.test(normalized) ||
    /^until end of turn, whenever one or more gorgons and\/or snakes you control deal combat damage to a player, you gain 2 life$/i.test(normalized) ||
    /^this permanent is attacking that player or planeswalker$/i.test(normalized) ||
    /^this creature gains landwalk of the chosen type until the end of that turn$/i.test(normalized) ||
    /^you may cast shattered seraph for as long as it remains exiled$/i.test(normalized) ||
    /^you get that many additional upkeep steps after this phase$/i.test(normalized) ||
    /^you may reveal a permanent card from among them and put it into your hand\. put the rest on the bottom of your library(?: in any order)?$/i.test(normalized)
  );
}

function pruneUnknownStepsDeep(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const pruned: OracleEffectStep[] = [];

  for (const step of steps) {
    let nextStep = step;
    if (nextStep.kind === 'conditional') {
      const conditional = nextStep as Extract<OracleEffectStep, { kind: 'conditional' }>;
      const nestedSteps = pruneUnknownStepsDeep(conditional.steps);
      if (
        nestedSteps.length !== conditional.steps.length
        || nestedSteps.some((nested, index) => nested !== conditional.steps[index])
      ) {
        nextStep = { ...conditional, steps: nestedSteps } as unknown as OracleEffectStep;
      }
    } else if (nextStep.kind === 'schedule_delayed_trigger' && Array.isArray((nextStep as any).steps)) {
      const currentSteps = (nextStep as any).steps as readonly OracleEffectStep[];
      const nestedSteps = pruneUnknownStepsDeep(currentSteps);
      if (
        nestedSteps.length !== currentSteps.length
        || nestedSteps.some((nested, index) => nested !== currentSteps[index])
      ) {
        nextStep = { ...(nextStep as any), steps: nestedSteps } as unknown as OracleEffectStep;
      }
    }

    if (nextStep.kind === 'unknown' && isRedundantTriggerEffectFragmentUnknownStep(nextStep)) {
      continue;
    }

    pruned.push(nextStep);
  }

  return pruned;
}

export function pruneRedundantTriggerEffectFragmentUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = pruneUnknownStepsDeep(ability.steps);
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

