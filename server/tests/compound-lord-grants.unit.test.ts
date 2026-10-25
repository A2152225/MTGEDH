import { describe, expect, it } from 'vitest';
import { getContinuousPTBonusForPermanent } from '../src/state/modules/staticEffectSpec';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities';

function perm(id: string, controller: string, type_line: string, oracle_text: string) {
  return { id, controller, owner: controller, tapped: false, counters: {}, timestamp: Number(id.replace(/\D/g, '')) || 1,
    card: { id, name: id, type_line, oracle_text, power: '2', toughness: '2' } } as any;
}

describe('compound lord text: "get +X/+Y and have K"', () => {
  const lord = perm('c1', 'p1', 'Creature \u2014 Merfolk Wizard', 'Other Merfolk get +1/+1 and have islandwalk.');
  const fish = perm('c2', 'p1', 'Creature \u2014 Merfolk', '');
  const enemyFish = perm('c3', 'p2', 'Creature \u2014 Merfolk', '');
  const bear = perm('c4', 'p1', 'Creature \u2014 Bear', '');
  const state: any = { battlefield: [lord, fish, enemyFish, bear], players: [{ id: 'p1' }, { id: 'p2' }] };

  it('grants both the bonus and the keyword to every other Merfolk', () => {
    for (const target of [fish, enemyFish]) {
      expect(getContinuousPTBonusForPermanent(target, state)).toMatchObject({ power: 1, toughness: 1 });
      expect(permanentHasKeywordAbility(target, 'islandwalk', state.battlefield)).toBe(true);
    }
  });

  it('skips the lord itself and non-Merfolk', () => {
    for (const target of [lord, bear]) {
      expect(getContinuousPTBonusForPermanent(target, state).power).toBe(0);
      expect(permanentHasKeywordAbility(target, 'islandwalk', state.battlefield)).toBe(false);
    }
  });

  it('"you control" scope with several keywords', () => {
    const elfLord = perm('c5', 'p1', 'Creature \u2014 Elf', 'Other Elf creatures you control get +1/+1 and have trample and haste.');
    const elf = perm('c6', 'p1', 'Creature \u2014 Elf', '');
    const enemyElf = perm('c7', 'p2', 'Creature \u2014 Elf', '');
    const s: any = { battlefield: [elfLord, elf, enemyElf], players: [{ id: 'p1' }, { id: 'p2' }] };
    expect(getContinuousPTBonusForPermanent(elf, s).power).toBe(1);
    expect(permanentHasKeywordAbility(elf, 'trample', s.battlefield)).toBe(true);
    expect(permanentHasKeywordAbility(elf, 'haste', s.battlefield)).toBe(true);
    expect(getContinuousPTBonusForPermanent(enemyElf, s).power).toBe(0);
    expect(permanentHasKeywordAbility(enemyElf, 'haste', s.battlefield)).toBe(false);
  });
});
