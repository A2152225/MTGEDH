import { describe, expect, it } from 'vitest';
import { applyStateBasedActions } from '../src/rules-engine/index.js';

function stateWith(perm: Record<string, unknown>) {
  return {
    battlefield: [
      {
        id: 'kynaios_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        counters: {},
        baseToughness: 8,
        basePower: 2,
        card: {
          id: 'kynaios_card_1',
          name: 'Kynaios and Tiro of Meletis',
          type_line: 'Legendary Creature - Human Soldier',
          oracle_text: '',
          power: '2',
          toughness: '8',
        },
        ...perm,
      },
    ],
    players: [{ id: 'p1', name: 'P1', life: 40 }],
    zones: { p1: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0 } },
    life: { p1: 40 },
    commandZone: {},
    emblems: [],
    conspiracies: [],
  } as any;
}

describe('applyStateBasedActions marked damage field precedence', () => {
  it('destroys a creature with lethal combat damage even when a stale damage:0 is left from an earlier cleanup', () => {
    // Earlier cleanup steps write damage=0/markedDamage=0/damageMarked=0; combat then only bumps
    // markedDamage/damageMarked. A stale `damage: 0` must not mask the real marked damage.
    const result = applyStateBasedActions(stateWith({ damage: 0, markedDamage: 13, damageMarked: 13 }));
    expect(result.destroys).toContain('kynaios_1');
  });

  it('still destroys when only damageMarked is set', () => {
    expect(applyStateBasedActions(stateWith({ damageMarked: 8 })).destroys).toContain('kynaios_1');
  });

  it('still destroys when only spell-style damage is set', () => {
    expect(applyStateBasedActions(stateWith({ damage: 9 })).destroys).toContain('kynaios_1');
  });

  it('does not destroy when every damage field is below toughness', () => {
    expect(applyStateBasedActions(stateWith({ damage: 0, markedDamage: 7, damageMarked: 7 })).destroys).not.toContain('kynaios_1');
  });
});
describe('applyDamageToPermanentWithCounterEffects keeps every damage mirror in sync', () => {
  it('combat-style markedDamage on top of a stale damage:0 is lethal to SBA and the blocker dies', async () => {
    const { applyDamageToPermanentWithCounterEffects } = await import('../src/state/modules/counter-common-effects.js');
    const perm: any = { id: 'k', damage: 0, markedDamage: 0, damageMarked: 0 };
    applyDamageToPermanentWithCounterEffects(perm, 6, 'markedDamage');
    applyDamageToPermanentWithCounterEffects(perm, 7, 'markedDamage');
    expect(perm.damage).toBe(13);
    expect(perm.markedDamage).toBe(13);
    expect(perm.damageMarked).toBe(13);
    const result = applyStateBasedActions(stateWith({ damage: perm.damage, markedDamage: perm.markedDamage, damageMarked: perm.damageMarked }));
    expect(result.destroys).toContain('kynaios_1');
  });

  it('does not lose earlier spell damage when combat damage is added afterwards', async () => {
    const { applyDamageToPermanentWithCounterEffects } = await import('../src/state/modules/counter-common-effects.js');
    const perm: any = { id: 'k', damage: 3, markedDamage: 0, damageMarked: 0 };
    applyDamageToPermanentWithCounterEffects(perm, 2, 'markedDamage');
    expect(perm.markedDamage).toBe(5);
    expect(perm.damage).toBe(5);
  });
});

describe('damage after a previous turn cleanup (the real-game sequence)', () => {
  it('a creature damaged on an earlier turn, cleaned up, then dealt lethal combat damage dies in SBA', async () => {
    const { applyDamageToPermanentWithCounterEffects, clearMarkedPermanentDamage } = await import('../src/state/modules/counter-common-effects.js');
    const perm: any = { id: 'k' };
    applyDamageToPermanentWithCounterEffects(perm, 1, 'damageMarked'); // earlier turn damage
    clearMarkedPermanentDamage(perm); // cleanup step leaves damage:0 on every mirror
    expect(perm.damage).toBe(0);
    applyDamageToPermanentWithCounterEffects(perm, 13, 'markedDamage'); // combat, next turn
    const result = applyStateBasedActions(stateWith({ damage: perm.damage, markedDamage: perm.markedDamage, damageMarked: perm.damageMarked }));
    expect(result.destroys).toContain('kynaios_1');
  });
});
