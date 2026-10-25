import { describe, expect, it } from 'vitest';
import { getContinuousPTBonusForPermanent } from '../src/state/modules/staticEffectSpec';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities';

function perm(id: string, name: string, type_line: string, oracle_text: string, extra: any = {}) {
  return { id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, timestamp: Number(id.replace(/\D/g, '')) || 1,
    card: { id, name, type_line, oracle_text, power: '2', toughness: '2' }, ...extra } as any;
}

describe('lord under Humility (CR 613.1f)', () => {
  const lord = perm('c1', 'Lord of Atlantis', 'Creature — Merfolk', 'Other Merfolk get +1/+1.\nOther creatures you control have flying.');
  const fish = perm('c2', 'Merfolk Token', 'Creature — Merfolk', '');
  const humility = perm('c3', 'Humility', 'Enchantment', 'All creatures lose all abilities and have base power and toughness 1/1.');

  it('lord grants anthem and keyword without Humility', () => {
    const state: any = { battlefield: [lord, fish], players: [{ id: 'p1' }] };
    expect(getContinuousPTBonusForPermanent(fish, state).power).toBe(1);
    expect(permanentHasKeywordAbility(fish, 'flying', state.battlefield)).toBe(true);
  });

  it('ability-less lord grants no anthem or keyword', () => {
    const state: any = { battlefield: [lord, fish, humility], players: [{ id: 'p1' }] };
    expect(getContinuousPTBonusForPermanent(fish, state).power).toBe(0);
    expect(permanentHasKeywordAbility(fish, 'flying', state.battlefield)).toBe(false);
  });

  it('Turn to Frog style flag on the lord also stops its grants', () => {
    const frog = { ...lord, losesAllAbilities: true };
    const state: any = { battlefield: [frog, fish], players: [{ id: 'p1' }] };
    expect(getContinuousPTBonusForPermanent(fish, state).power).toBe(0);
    expect(permanentHasKeywordAbility(fish, 'flying', state.battlefield)).toBe(false);
  });
});
