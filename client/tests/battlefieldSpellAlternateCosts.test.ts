import { describe, expect, it } from 'vitest';
import {
  buildBattlefieldSpellAlternateCosts,
  shouldApplyBattlefieldSpellAlternateCosts,
} from '../src/utils/battlefieldSpellAlternateCosts';

const fistOfSuns = {
  controller: 'p1',
  card: {
    name: 'Fist of Suns',
    oracle_text: 'You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast.',
  },
};

describe('battlefieldSpellAlternateCosts', () => {
  it('does not apply Fist of Suns to activated ability payment contexts', () => {
    expect(shouldApplyBattlefieldSpellAlternateCosts({
      activatingPermanentId: 'three_tree_city_1',
    })).toBe(false);

    expect(shouldApplyBattlefieldSpellAlternateCosts({
      // Activation / ward / extort leave fromZone unset
    })).toBe(false);

    const costs = buildBattlefieldSpellAlternateCosts({
      spellToCast: {
        activatingPermanentId: 'three_tree_city_1',
      },
      controllerId: 'p1',
      battlefield: [fistOfSuns],
    });
    expect(costs).toEqual([]);
  });

  it('still offers Fist of Suns when casting a spell from hand', () => {
    expect(shouldApplyBattlefieldSpellAlternateCosts({ fromZone: 'hand' })).toBe(true);

    const costs = buildBattlefieldSpellAlternateCosts({
      spellToCast: { fromZone: 'hand' },
      controllerId: 'p1',
      battlefield: [fistOfSuns],
    });
    expect(costs).toEqual([
      expect.objectContaining({
        id: 'wubrg_external',
        manaCost: '{W}{U}{B}{R}{G}',
        label: 'WUBRG Alternative (Fist of Suns)',
      }),
    ]);
  });

  it('does not apply battlefield spell alts for non-hand cast zones', () => {
    expect(shouldApplyBattlefieldSpellAlternateCosts({ fromZone: 'graveyard' })).toBe(false);
    expect(shouldApplyBattlefieldSpellAlternateCosts({ fromZone: 'command' })).toBe(false);
  });
});
