import { describe, expect, it } from 'vitest';
import { getContinuousPTBonusSourcesForPermanent } from '../src/state/modules/staticEffectSpec.js';
import { detectActivationTimingRestriction, isActivatedAbilityTimingLegal } from '../src/state/modules/activation-timing.js';
import { canActivateAnyAbility } from '../src/state/modules/can-respond-handlers/canRespondActivatableAbilities.js';

// Issue reports #46 / #47 (game_mv4dicck, Oct 11).
const FLOWERING = 'Legendary creatures you control get +2/+1 and have ward {1}.\nNonlegendary creatures you control get +1/+1.';
const CARETAKER = "(Gain the next level as a sorcery to add its ability.)\nWhenever one or more tokens you control enter, draw a card. This ability triggers only once each turn.\n{W}: Level 2\nWhen this Class becomes level 2, create a token that's a copy of target token you control.\n{3}{W}: Level 3\nCreature tokens you control get +2/+2.";

function perm(id: string, controller: string, name: string, type_line: string, oracle = '', extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: `${id}_c`, name, type_line, oracle_text: oracle, power: '2', toughness: '2' } };
}

describe('#46 Flowering of the White Tree nonlegendary anthem', () => {
  it('gives nonlegendary creatures +1/+1 and legendary creatures +2/+1 (not both)', () => {
    const state: any = { battlefield: [
      perm('flower', 'p1', 'Flowering of the White Tree', 'Legendary Enchantment', FLOWERING),
      perm('leg', 'p1', 'Legend', 'Legendary Creature - Human'),
      perm('non', 'p1', 'Grizzly Bears', 'Creature - Bear'),
      perm('opp', 'p2', 'Opposing Bears', 'Creature - Bear'),
    ] };
    const pt = (id: string) => {
      const r = getContinuousPTBonusSourcesForPermanent(state.battlefield.find((p: any) => p.id === id), state);
      return [r.power, r.toughness];
    };
    expect(pt('leg')).toEqual([2, 1]);
    expect(pt('non')).toEqual([1, 1]);
    expect(pt('opp')).toEqual([0, 0]);
  });

  it('a lone "Nonlegendary creatures you control get" line is not read as a legendary anthem', () => {
    const state: any = { battlefield: [
      perm('src', 'p1', 'Test Anthem', 'Enchantment', 'Nonlegendary creatures you control get +1/+1.'),
      perm('leg', 'p1', 'Legend', 'Legendary Creature - Human'),
    ] };
    const r = getContinuousPTBonusSourcesForPermanent(state.battlefield[1], state);
    expect([r.power, r.toughness]).toEqual([0, 0]);
  });
});

describe('#47 Class level-up is sorcery speed', () => {
  it('detects "{W}: Level 2" and "Level up {1}{W}" as sorcery timing', () => {
    expect(detectActivationTimingRestriction('{W}: Level 2')).toBe('sorcery');
    expect(detectActivationTimingRestriction('Level 3')).toBe('sorcery');
    expect(detectActivationTimingRestriction('Level up {1}{W}')).toBe('sorcery');
    expect(detectActivationTimingRestriction('{T}: Add {W}.')).toBeNull();
  });

  function caretakerState(turnPlayer: string, step: string, stack: any[] = []) {
    return {
      turnPlayer, activePlayer: turnPlayer, priority: 'p1', phase: step.startsWith('MAIN') ? 'precombatMain' : 'combat', step, stack,
      players: [{ id: 'p1', name: 'p1', life: 40 }, { id: 'p2', name: 'p2', life: 40 }],
      zones: { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } },
      manaPool: { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      battlefield: [
        perm('talent', 'p1', "Caretaker's Talent", 'Enchantment - Class', CARETAKER),
        perm('plains1', 'p1', 'Plains', 'Basic Land - Plains', '({T}: Add {W}.)'),
        perm('plains2', 'p1', 'Plains', 'Basic Land - Plains', '({T}: Add {W}.)'),
        perm('plains3', 'p1', 'Plains', 'Basic Land - Plains', '({T}: Add {W}.)'),
        perm('plains4', 'p1', 'Plains', 'Basic Land - Plains', '({T}: Add {W}.)'),
      ],
    };
  }

  it('does not count as an instant-speed response on an opponent turn or with a stack', () => {
    expect(canActivateAnyAbility({ state: caretakerState('p2', 'MAIN1') } as any, 'p1' as any)).toBe(false);
    expect(canActivateAnyAbility({ state: caretakerState('p1', 'MAIN1', [{ id: 's1', type: 'ability', controller: 'p2' }]) } as any, 'p1' as any)).toBe(false);
    expect(isActivatedAbilityTimingLegal(caretakerState('p2', 'MAIN1') as any, 'p1', '{W}: Level 2', '{W}: Level 2')).toBe(false);
  });

  it('is still legal in your own main phase with an empty stack', () => {
    expect(isActivatedAbilityTimingLegal(caretakerState('p1', 'MAIN1') as any, 'p1', '{W}: Level 2', '{W}: Level 2')).toBe(true);
  });
});
