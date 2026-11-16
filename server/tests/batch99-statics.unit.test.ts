import { describe, it, expect } from 'vitest';
import { collectReplacementEffectSpecsFromState } from '../src/state/modules/replacementEffectSpec.js';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { oracleGrantsAuraControl } from '../../rules-engine/src/controlEffectRegistry.js';
import { removeLoyaltyFromPlaneswalker } from '../../rules-engine/src/oracleIRExecutorPermanentUtils.js';
import { nextLoyaltyAfterDamageWithSave, deificationLoyaltySaveApplies } from '../../rules-engine/src/planeswalkerLoyaltyReplacements.js';
import {
  parseAsTransformsEmblemGrant,
  parseAsTransformsChooseOpponent,
  applyAsTransformsEvents,
  applyTransformChooseOpponentOnContext,
} from '../src/state/modules/batch99TransformEvents.js';
import { parseEnduringAngelLifeFloor, applyEnduringAngelLifeFloor } from '../src/state/modules/batch99LifeFloorTransform.js';
import { parseAsEntersChooseNumberAtRandom, applyAsEntersRandomNumberChoice } from '../src/state/modules/batch99AsEntersRandom.js';
import {
  parseStarfieldAnimation,
  parseBatch99LongTailStaticKind,
  BATCH99_LAYER4_SPECS,
} from '../src/state/modules/staticEffectSpec-handlers/batch99LongTailStatics.js';
import {
  parseAdditionalLifeToActivateManaAbilities,
  withAdditionalManaAbilityLifeCost,
} from '../src/state/modules/batch99ManaAbilityAdditionalLife.js';
import { parseAdditionalTypesAndSaddle, permanentGainsSaddleFromTypeGrant } from '../src/state/modules/batch98CombatAndKeywords.js';
import { collectLayer4TypePayloads, layer4AddedTypesFor, layer4BasePowerToughnessFor } from '../src/state/modules/layer4TypeSetting.js';
import { evaluateDefenderCondition } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { resolveManaAbilityLifeEffect } from '../src/state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js';

const P1 = 'p1';
const P2 = 'p2';

function perm(partial: any): any {
  return {
    id: partial.id || 'perm-1',
    controller: partial.controller || P1,
    card: partial.card || {},
    ...partial,
  };
}

describe('B99 as-transforms emblem and choose-opponent', () => {
  const sephirothBack = 'As this creature transforms into Sephiroth, One-Winged Angel, you get an emblem with "Whenever a creature dies, target opponent loses 1 life and you gain 1 life."';
  const zenosBack = 'As this creature transforms into Shinryu, choose an opponent.';

  it('parses the Super Nova emblem grant', () => {
    const parsed = parseAsTransformsEmblemGrant(sephirothBack);
    expect(parsed?.face).toMatch(/Sephiroth, One-Winged Angel/i);
    expect(parsed?.text).toMatch(/whenever a creature dies/i);
  });

  it('creates the emblem when transforming onto that face', () => {
    const state: any = { emblems: [], players: [{ id: P1 }, { id: P2 }] };
    const permanent = perm({ id: 'seph', controller: P1, card: { name: 'Sephiroth, One-Winged Angel' } });
    applyAsTransformsEvents({ state } as any, permanent, { name: 'Sephiroth, One-Winged Angel', oracle_text: sephirothBack });
    expect(state.emblems).toHaveLength(1);
    expect(state.emblems[0].controller).toBe(P1);
    expect(state.emblems[0].effect).toMatch(/whenever a creature dies/i);
  });

  it('parses Shinryu as-transforms choose-opponent and auto-picks the only opponent', () => {
    expect(parseAsTransformsChooseOpponent(zenosBack)).toBe(true);
    const state: any = { players: [{ id: P1 }, { id: P2 }], battlefield: [] };
    const permanent = perm({ id: 'zenos', controller: P1, card: { name: 'Shinryu' } });
    applyAsTransformsEvents({ state } as any, permanent, { name: 'Shinryu', oracle_text: zenosBack });
    expect(permanent.chosenOpponentId).toBe(P2);
    expect(permanent.chosenPlayer).toBe(P2);
  });

  it('applies a later choose-opponent resolution onto the permanent', () => {
    const permanent = perm({ id: 'zenos', controller: P1, card: { name: 'Shinryu' } });
    const state: any = { battlefield: [permanent], players: [{ id: P1 }, { id: P2 }, { id: 'p3' }] };
    const result = applyTransformChooseOpponentOnContext({ state } as any, { permanentId: 'zenos', playerId: 'p3' });
    expect(result.applied).toBe(true);
    expect(permanent.chosenOpponentId).toBe('p3');
  });

  it('collects as-transforms replacement specs so census can mark them handled', () => {
    const seph = perm({ id: 'seph', card: { name: 'Sephiroth, One-Winged Angel', oracle_text: sephirothBack } });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [seph] });
    expect(specs.some((spec) => spec.effectId === 'as-transforms-emblem')).toBe(true);
  });
});

describe('B99 Deification loyalty save', () => {
  const deificationText = 'As long as you control a creature, if damage dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one of those counters are removed.';

  it('leaves one loyalty when damage would clear a chosen-type planeswalker you control', () => {
    const walker = perm({
      id: 'ajani',
      controller: P1,
      loyalty: 3,
      counters: { loyalty: 3 },
      card: { name: 'Ajani Goldmane', type_line: 'Legendary Planeswalker — Ajani' },
    });
    const deification = perm({
      id: 'dei',
      controller: P1,
      chosenPlaneswalkerType: 'Ajani',
      card: { name: 'Deification', type_line: 'Enchantment', oracle_text: deificationText },
    });
    const creature = perm({
      id: 'bear',
      controller: P1,
      card: { name: 'Bear', type_line: 'Creature — Bear' },
    });
    const state = { battlefield: [walker, deification, creature] };
    expect(deificationLoyaltySaveApplies(walker, state)).toBe(true);
    expect(nextLoyaltyAfterDamageWithSave(walker, 3, state)).toBe(1);
    const after = removeLoyaltyFromPlaneswalker(walker, 3, state);
    expect(after.loyalty).toBe(1);
    expect(after.counters.loyalty).toBe(1);
  });

  it('does not save when you control no creature, or the type does not match', () => {
    const walker = perm({
      id: 'ajani',
      controller: P1,
      loyalty: 2,
      counters: { loyalty: 2 },
      card: { type_line: 'Legendary Planeswalker — Ajani' },
    });
    const deification = perm({
      id: 'dei',
      controller: P1,
      chosenPlaneswalkerType: 'Ajani',
      card: { oracle_text: deificationText },
    });
    expect(nextLoyaltyAfterDamageWithSave(walker, 2, { battlefield: [walker, deification] })).toBe(0);
    const creature = perm({ id: 'bear', controller: P1, card: { type_line: 'Creature — Bear' } });
    deification.chosenPlaneswalkerType = 'Chandra';
    expect(nextLoyaltyAfterDamageWithSave(walker, 2, { battlefield: [walker, deification, creature] })).toBe(0);
  });

  it('collects the Deification replacement spec', () => {
    const dei = perm({ id: 'dei', card: { name: 'Deification', oracle_text: deificationText } });
    const specs = collectReplacementEffectSpecsFromState({ battlefield: [dei] });
    expect(specs.some((spec) => spec.effectId === 'deification-loyalty-save')).toBe(true);
  });
});

describe('B99 Enduring Angel life-floor transform', () => {
  const angelText = "If your life total would be reduced to 0 or less, instead transform this creature and your life total becomes 3. Then if this creature didn't transform this way, you lose the game.";

  it('parses the life-floor transform replacement', () => {
    expect(parseEnduringAngelLifeFloor(angelText)).toEqual({ life: 3 });
  });

  it('transforms the angel, sets life to 3, and does not lose when the front face is up', () => {
    const angel = perm({
      id: 'angel',
      controller: P1,
      transformed: false,
      card: {
        name: 'Enduring Angel',
        oracle_text: angelText,
        card_faces: [
          { name: 'Enduring Angel', oracle_text: angelText },
          { name: "Angel of Grace's Wrath", oracle_text: 'Flying, double strike' },
        ],
      },
    });
    const state: any = { life: { [P1]: 4 }, battlefield: [angel], players: [{ id: P1, life: 4 }] };
    const result = applyEnduringAngelLifeFloor({ state } as any, P1, 4, 9);
    expect(result.applied).toBe(true);
    expect(result.transformed).toBe(true);
    expect(result.lostGame).toBe(false);
    expect(state.life[P1]).toBe(3);
    expect(angel.transformed).toBe(true);
  });

  it('sets life to 3 and loses the game if the creature cannot transform', () => {
    const angel = perm({
      id: 'angel',
      controller: P1,
      transformed: true,
      card: { name: 'Enduring Angel', oracle_text: angelText, card_faces: [{ name: 'Front' }, { name: 'Back' }] },
    });
    const state: any = { life: { [P1]: 2 }, battlefield: [angel], players: [{ id: P1, life: 2 }] };
    const result = applyEnduringAngelLifeFloor({ state } as any, P1, 2, 5);
    expect(result.applied).toBe(true);
    expect(result.transformed).toBe(false);
    expect(result.lostGame).toBe(true);
    expect(state.life[P1]).toBe(3);
    expect(state.players[0].hasLost).toBe(true);
  });
});

describe('B99 Carry Away, Novice Knight, Starfield, Thran Portal, Haktos, Jandor', () => {
  it('treats "You control enchanted Equipment" as an aura control effect', () => {
    expect(oracleGrantsAuraControl('You control enchanted Equipment.')).toBe(true);
    expect(oracleGrantsAuraControl('You control enchanted creature.')).toBe(true);
  });

  it('lets a defender attack when it is enchanted or equipped', () => {
    const knight = perm({ id: 'knight', controller: P1, card: { name: 'Novice Knight' } });
    const sword = perm({
      id: 'sword',
      controller: P1,
      attachedTo: 'knight',
      card: { name: 'Sword', type_line: 'Artifact — Equipment' },
    });
    expect(evaluateDefenderCondition('~ is enchanted or equipped', knight, [knight, sword], P1)).toBe(true);
    expect(evaluateDefenderCondition('~ is enchanted or equipped', knight, [knight], P1)).toBe(false);
  });

  it('animates other non-Aura enchantments you control only with five or more enchantments', () => {
    expect(parseStarfieldAnimation(
      'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
    )).toBe(true);
    const starfield = perm({
      id: 'star',
      controller: P1,
      card: {
        name: 'Starfield of Nyx',
        type_line: 'Enchantment',
        oracle_text: 'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
      },
    });
    const others = [1, 2, 3, 4].map((n) => perm({
      id: `e${n}`,
      controller: P1,
      card: { name: `Enchantment ${n}`, type_line: 'Enchantment', cmc: n + 1 },
    }));
    const four = { battlefield: [starfield, ...others.slice(0, 3)] };
    expect(collectLayer4TypePayloads(four)).toHaveLength(0);
    const five = { battlefield: [starfield, ...others] };
    const added = layer4AddedTypesFor(others[0], five);
    expect(added).toContain('Creature');
    expect(layer4BasePowerToughnessFor(others[0], five)).toEqual({ power: 2, toughness: 2 });
    expect(layer4AddedTypesFor(starfield, five)).toEqual([]);
  });

  it('adds 1 life to this land\'s mana ability cost', () => {
    const oracle = 'Mana abilities of this land cost an additional 1 life to activate.';
    expect(parseAdditionalLifeToActivateManaAbilities(oracle)).toBe(1);
    const wrapped = withAdditionalManaAbilityLifeCost({ oracle_text: oracle }, { amount: 0, isDamage: false });
    expect(wrapped).toEqual({ amount: 1, isDamage: false });
    const resolved = resolveManaAbilityLifeEffect({
      card: { oracle_text: `{T}: Add {G}.\n${oracle}` },
      producesColoredMana: true,
    });
    expect(resolved.amount).toBe(1);
    expect(resolved.isDamage).toBe(false);
  });

  it('chooses 2, 3, or 4 at random as Haktos enters', () => {
    const oracle = 'As Haktos enters, choose 2, 3, or 4 at random.';
    expect(parseAsEntersChooseNumberAtRandom(oracle)).toEqual([2, 3, 4]);
    const haktos = perm({ id: 'haktos', card: { name: 'Haktos', oracle_text: oracle } });
    expect(applyAsEntersRandomNumberChoice(haktos, () => 0)).toBe(2);
    expect(haktos.chosenNumber).toBe(2);
    const again = perm({ id: 'h2', card: { name: 'Haktos', oracle_text: oracle } });
    expect(applyAsEntersRandomNumberChoice(again, () => 0.99)).toBe(4);
  });

  it('grants Mount and saddle 2 to Jandor-style type lists and exposes the consumer', () => {
    const jandorText = 'Each Beast, Camel, Horse, Elephant, and Wolf creature you control is a Mount in addition to its other types and has saddle 2.';
    expect(parseAdditionalTypesAndSaddle(jandorText)?.saddle).toBe(2);
    const jandor = perm({ id: 'jandor', controller: P1, card: { name: 'Jandor', oracle_text: jandorText, type_line: 'Legendary Creature — Human Soldier' } });
    const wolf = perm({ id: 'wolf', controller: P1, card: { name: 'Wolf', type_line: 'Creature — Wolf' } });
    const state = { battlefield: [jandor, wolf] };
    expect(permanentGainsSaddleFromTypeGrant(wolf, state)).toBe(2);
    expect(layer4AddedTypesFor(wolf, state)).toContain('Mount');
  });

  it('parses the new B99 static kinds', () => {
    const kinds = parseBatch99LongTailStaticKind(
      'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
    );
    expect(kinds).toContain('starfield-non-aura-enchantments-are-creatures');
    const specs = parseStaticEffectSpecsFromOraclePermanent({
      id: 'star',
      controller: P1,
      card: {
        name: 'Starfield of Nyx',
        oracle_text: 'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
      },
    } as any);
    expect(specs.some((spec) => String(spec.id || '').includes('starfield'))).toBe(true);
  });
});

describe('B99 layer-4 Starfield spec is registered', () => {
  it('exports a Starfield regex', () => {
    expect(BATCH99_LAYER4_SPECS.some((spec) => spec.re.test(
      'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.',
    ))).toBe(true);
  });
});
