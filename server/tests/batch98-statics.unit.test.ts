import { describe, it, expect } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.ts';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { detectTriggerDoublers, applyTriggerDoublers } from '../src/state/modules/triggers/trigger-doublers.js';
import {
  parseAlsoAttacksIfAble,
  permanentMustAttackIfAnotherYouControlAttacks,
  faceUpBlockedByOpponentsLock,
  parseImprintExiledKeywordList,
  imprintExiledGrantsKeyword,
  parseSoulshiftXCount,
  getSoulshiftValueForPermanent,
  parseAdditionalTypesAndSaddle,
  permanentGainsSaddleFromTypeGrant,
  parseMadnessCostParts,
  parseLandsWithChosenNameHaveAbility,
  quotedAbilityForChosenNameLand,
  parseTransformEmblemGrant,
  grantsCascadeFromHandByOpponentsLifeLost,
  parseOgreSingleSourceLethal,
  shouldSkipLethalDestroyUnlessSingleSource,
  recordMarkedDamageFromSource,
} from '../src/state/modules/batch98CombatAndKeywords.js';
import { parseBatch98LongTailStaticKind } from '../src/state/modules/staticEffectSpec-handlers/batch98LongTailStatics.js';
import { parseIchorPlanarDiceReplacement, ichorPlanarDiceAdjustment, collectBatch98ReplacementSpecs } from '../src/state/modules/replacementBatch98Collect.js';
import { ghostlyFlameDamageSourceIsColorless, countCardsNamedInGraveyards } from '../src/state/modules/staticEffectSpec-handlers/batch97LongTailStatics.js';

const SRC = { sourcePermanentId: 'src-1', sourceController: 'p1', sourceName: 'Test' };

function perm(id: string, controller: string, name: string, oracle: string, extra: Record<string, unknown> = {}) {
  return { id, controller, card: { name, oracle_text: oracle, ...extra }, ...extra };
}

describe('batch98 statics', () => {
  it('requires Ekundu Cyclops to attack if another creature you control attacks', () => {
    const oracle = 'If a creature you control attacks, this creature also attacks if able.';
    expect(parseAlsoAttacksIfAble(oracle)).toBe(true);
    expect(permanentMustAttackIfAnotherYouControlAttacks(perm('e1', 'p1', 'Ekundu Cyclops', oracle))).toBe(true);
    expect(parseBatch98LongTailStaticKind(oracle)).toContain('also-attacks-if-able');
  });

  it('blocks opponents turning permanents face up on the Watchdog controller\'s turn', () => {
    const oracle = "Permanents your opponents control can't be turned face up during your turn.";
    const state = { activePlayer: 'p1', battlefield: [perm('w1', 'p1', 'Karlov Watchdog', oracle)] };
    expect(faceUpBlockedByOpponentsLock(state, 'p2').blocked).toBe(true);
    expect(faceUpBlockedByOpponentsLock(state, 'p1').blocked).toBe(false);
    expect(faceUpBlockedByOpponentsLock({ ...state, activePlayer: 'p2' }, 'p2').blocked).toBe(false);
  });

  it('doubles triggers of permanents you control but do not own (Jabs)', () => {
    const jabs = perm('j1', 'p1', 'Jabs, Mistress of Mockery', "If a triggered ability of a permanent you control but don't own triggers, that ability triggers an additional time.");
    const stolen = { id: 's1', controller: 'p1', owner: 'p2', card: { name: 'Stolen Bear', type_line: 'Creature — Bear', oracle_text: 'Whenever this creature attacks, draw a card.' } };
    const own = { id: 'o1', controller: 'p1', owner: 'p1', card: { name: 'My Bear', type_line: 'Creature — Bear', oracle_text: 'Whenever this creature attacks, draw a card.' } };
    const doublers = detectTriggerDoublers([jabs, stolen, own], 'p1');
    expect(doublers.length).toBe(1);
    expect(doublers[0].unsupportedReason).toBeFalsy();
    const triggers = [{ permanentId: 's1', cardName: 'Stolen Bear', description: 'attacks', controller: 'p1' } as any];
    const doubled = applyTriggerDoublers(triggers, doublers, 'any', stolen, [jabs, stolen, own]);
    expect(doubled.length).toBe(2);
    const ownTriggers = applyTriggerDoublers(
      [{ permanentId: 'o1', cardName: 'My Bear', description: 'attacks', controller: 'p1' } as any],
      doublers,
      'any',
      own,
      [jabs, stolen, own],
    );
    expect(ownTriggers.length).toBe(1);
  });

  it('parses Ichor Elixir planar-dice plus-and-ignore and Deification loyalty save', () => {
    const ichorOracle = 'If you would roll one or more planar dice, instead roll that many planar dice plus one and ignore one.';
    expect(parseIchorPlanarDiceReplacement(ichorOracle)).toEqual({ extra: 1, ignore: 1 });
    const state = { battlefield: [perm('i1', 'p1', 'Ichor Elixir', ichorOracle)] };
    expect(ichorPlanarDiceAdjustment(state, 'p1')).toEqual({ extra: 1, ignore: 1 });
    const deif = 'As long as you control a creature, if damage dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one of those counters are removed.';
    const specs = collectBatch98ReplacementSpecs(deif, SRC);
    expect(specs.some((s) => String(s.effectId).includes('deification'))).toBe(true);
  });

  it('skips Ogre Enforcer lethal-damage SBA unless a single source marked lethal', () => {
    const oracle = "This creature can't be destroyed by lethal damage unless lethal damage dealt by a single source is marked on it.";
    expect(parseOgreSingleSourceLethal(oracle)).toBe(true);
    const ogre: any = perm('og', 'p1', 'Ogre Enforcer', oracle);
    recordMarkedDamageFromSource(ogre, 'a', 2);
    recordMarkedDamageFromSource(ogre, 'b', 2);
    expect(shouldSkipLethalDestroyUnlessSingleSource(ogre, 3)).toBe(true);
    recordMarkedDamageFromSource(ogre, 'a', 2);
    expect(shouldSkipLethalDestroyUnlessSingleSource(ogre, 3)).toBe(false);
  });

  it('computes Kodama soulshift X from Spirits you control', () => {
    const oracle = "Kodama of the Center Tree has soulshift X, where X is the number of Spirits you control.";
    expect(parseSoulshiftXCount(oracle)).toEqual({ type: 'Spirit' });
    const kodama = perm('k1', 'p1', 'Kodama of the Center Tree', oracle);
    const spirits = [
      kodama,
      perm('s1', 'p1', 'Tree Spirit', '', { type_line: 'Creature — Spirit' }),
      perm('s2', 'p2', 'Their Spirit', '', { type_line: 'Creature — Spirit' }),
    ];
    kodama.card.type_line = 'Legendary Creature — Spirit';
    expect(getSoulshiftValueForPermanent(kodama, { battlefield: spirits })).toBe(2);
  });

  it('grants Death-Mask Duplicant keywords from imprinted cards', () => {
    const oracle = 'As long as a card exiled with this creature has flying, this creature has flying. The same is true for fear, first strike, double strike, haste, landwalk, protection, and trample.';
    expect(parseImprintExiledKeywordList(oracle)).toEqual(expect.arrayContaining(['flying', 'trample', 'protection']));
    const mask = perm('m1', 'p1', 'Death-Mask Duplicant', oracle);
    const bird = { name: 'Bird', oracle_text: 'Flying', keywords: ['Flying'], exiledBy: 'm1' };
    const state = { players: [{ id: 'p1', exile: [bird] }] };
    expect(imprintExiledGrantsKeyword(mask, 'flying', state)).toBe(true);
    expect(imprintExiledGrantsKeyword(mask, 'trample', state)).toBe(false);
  });

  it('grants Jandor saddle 2 and Mount to listed creature types', () => {
    const oracle = 'Each Beast, Camel, Horse, Elephant, and Wolf creature you control is a Mount in addition to its other types and has saddle 2.';
    const parsed = parseAdditionalTypesAndSaddle(oracle);
    expect(parsed?.saddle).toBe(2);
    expect(parsed?.types).toEqual(expect.arrayContaining(['Beast', 'Wolf']));
    const jandor = perm('j1', 'p1', 'Jandor, Fortuned Traveler', oracle);
    const wolf = perm('w1', 'p1', 'Pack Wolf', '', { type_line: 'Creature — Wolf' });
    expect(permanentGainsSaddleFromTypeGrant(wolf, { battlefield: [jandor, wolf] })).toBe(2);
  });

  it('grants Abaddon cascade when the spell MV is at most opponents\' life lost this turn', () => {
    const oracle = "During your turn, spells you cast from your hand with mana value X or less have cascade, where X is the total amount of life your opponents have lost this turn.";
    const abaddon = perm('a1', 'p1', 'Abaddon the Despoiler', oracle);
    const state = {
      activePlayer: 'p1',
      lifeLostThisTurn: { p2: 3, p3: 1 },
      players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      battlefield: [abaddon],
    };
    expect(grantsCascadeFromHandByOpponentsLifeLost(state, 'p1', { mana_value: 4 })).toBe(true);
    expect(grantsCascadeFromHandByOpponentsLifeLost(state, 'p1', { mana_value: 5 })).toBe(false);
  });

  it('parses madness mana plus pay-life and Petrified Hamlet / Sephiroth leftover statics', () => {
    expect(parseMadnessCostParts('Madness—{2}{B}, Pay 8 life.')).toEqual({ mana: '{2}{B}', life: 8 });
    expect(parseMadnessCostParts('Madness {1}{B}')).toEqual({ mana: '{1}{B}', life: 0 });
    const hamlet = 'When this land enters, choose a land card name.\nLands with the chosen name have "{T}: Add {C}."';
    expect(parseLandsWithChosenNameHaveAbility(hamlet)).toBe('{T}: Add {C}.');
    const source = perm('h1', 'p1', 'Petrified Hamlet', hamlet, { chosenCardName: 'Island' });
    const island = perm('l1', 'p1', 'Island', '', { name: 'Island', type_line: 'Basic Land — Island' });
    island.card.name = 'Island';
    expect(quotedAbilityForChosenNameLand(island, { battlefield: [source, island] })).toContain('Add {C}');
    const emblem = parseTransformEmblemGrant('Super Nova — As this creature transforms into Sephiroth, One-Winged Angel, you get an emblem with "Whenever a creature dies, target opponent loses 1 life and you gain 1 life."');
    expect(emblem?.text).toMatch(/whenever a creature dies/i);
  });

  it('uses Ghostly Flame and Farmhand helpers on the live damage-color and named-graveyard counts', () => {
    const flame = perm('f1', 'p1', 'Ghostly Flame', 'Black and/or red permanents and spells are colorless sources of damage.');
    const source = perm('b1', 'p1', 'Swamp Thing', 'Deals damage', { colors: ['B'], type_line: 'Creature — Elemental' });
    source.card.colors = ['B'];
    expect(ghostlyFlameDamageSourceIsColorless(source, { battlefield: [flame, source] })).toBe(true);
    const burst = { name: 'Muscle Burst' };
    const farmhand = { name: 'Diligent Farmhand', oracle_text: 'If this card is in a graveyard, effects from spells named Muscle Burst count it as a card named Muscle Burst.' };
    const state = { players: [{ id: 'p1', graveyard: [burst, farmhand] }, { id: 'p2', graveyard: [] }] };
    expect(countCardsNamedInGraveyards(state, 'Muscle Burst')).toBe(2);
  });

  it('does not classify implemented or out-of-scope B98 lines as owned_but_unhandled', () => {
    const lines: Array<[string, string]> = [
      ['If a creature you control attacks, this creature also attacks if able.', 'Ekundu Cyclops'],
      ["Permanents your opponents control can't be turned face up during your turn.", 'Karlov Watchdog'],
      ["If a triggered ability of a permanent you control but don't own triggers, that ability triggers an additional time.", 'Jabs, Mistress of Mockery'],
      ["This creature can't be destroyed by lethal damage unless lethal damage dealt by a single source is marked on it.", 'Ogre Enforcer'],
      ['Kodama of the Center Tree has soulshift X, where X is the number of Spirits you control.', 'Kodama of the Center Tree'],
      ['As long as a card exiled with this creature has flying, this creature has flying. The same is true for fear, first strike, double strike, haste, landwalk, protection, and trample.', 'Death-Mask Duplicant'],
      ['Lands with the chosen name have "{T}: Add {C}."', 'Petrified Hamlet'],
      ["During your turn, spells you cast from your hand with mana value X or less have cascade, where X is the total amount of life your opponents have lost this turn.", 'Abaddon the Despoiler'],
      ['Other creatures you control of a type you noted for cards named Paliano Vanguard get +1/+1.', 'Paliano Vanguard'],
      ['As long as you control one or more creatures with a name you noted for cards named Noble Banneret, this creature and those creatures get +1/+1 and have lifelink.', 'Noble Banneret'],
      ['Clandestine Chameleon has all abilities of ability stickers on other permanents you own and cards in your graveyard.', 'Clandestine Chameleon'],
      ['Throw ...', 'Captain America, First Avenger'],
    ];
    for (const [line, name] of lines) {
      const result = classifyStaticCensusLine(line, name);
      if (result == null || (result as any).system) continue;
      const creature = {
        id: 'census-perm', controller: 'p1', owner: 'p1',
        card: { name, type_line: 'Creature', oracle_text: line },
      };
      let st = false;
      let rp = false;
      try { st = parseStaticEffectSpecsFromOraclePermanent(creature).length > 0; } catch { st = false; }
      try { rp = collectReplacementEffectSpecsFromState({ battlefield: [creature], players: [{ id: 'p1', life: 40 }] }).length > 0; } catch { rp = false; }
      expect(st || rp, `${name}: classify=${JSON.stringify(result)} parse=${st} collect=${rp}`).toBe(true);
    }
  });
});
