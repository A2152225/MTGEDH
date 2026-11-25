import { describe, expect, it } from 'vitest';
import { activationSourceLastKnownContext } from '../src/state/modules/sacrificedCostLastKnown.js';
import { withDeathLastKnownPowerToughness } from '../src/state/modules/deathLastKnownPowerToughness.js';

describe('activation source last-known context (sacrificed source)', () => {
  const snapshot = { id: 'ghitu', power: 4, toughness: 2, counters: { charge: 3 } };

  it('returns nothing while the source is still on the battlefield', () => {
    expect(activationSourceLastKnownContext({ sourceLastKnown: snapshot }, 'ghitu', [{ id: 'ghitu' }])).toEqual({});
  });

  it('uses the stack item snapshot once the source is gone', () => {
    const ctx: any = activationSourceLastKnownContext({ sourceLastKnown: snapshot }, 'ghitu', []);
    expect(ctx.sourceLastKnownPermanent).toMatchObject({ id: 'ghitu', power: 4, counters: { charge: 3 } });
  });

  it('falls back to the matching lastSacrificedPermanents entry', () => {
    const ctx: any = activationSourceLastKnownContext({ lastSacrificedPermanents: [{ id: 'other', power: 1 }, snapshot] }, 'ghitu', []);
    expect(ctx.sourceLastKnownPermanent).toMatchObject({ id: 'ghitu', power: 4 });
  });
});

describe('dies-trigger last-known power includes anthems', () => {
  it('stamps effective P/T computed with the anthem still applying', () => {
    const anthem = {
      id: 'anthem', controller: 'p1', owner: 'p1', counters: {},
      card: { id: 'anthem_c', name: 'Glorious Anthem', type_line: 'Enchantment', oracle_text: 'Creatures you control get +1/+1.' },
    };
    const dying = {
      id: 'bear', controller: 'p1', owner: 'p1', counters: { '+1/+1': 1 }, basePower: 2, baseToughness: 2,
      card: { id: 'bear_c', name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' },
    };
    const state: any = { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [anthem], stack: [] };
    const stamped = withDeathLastKnownPowerToughness(state, dying);
    expect(stamped.effectivePower).toBe(4);
    expect(stamped.effectiveToughness).toBe(4);
    expect(state.battlefield).toHaveLength(1);
  });

  it('leaves non-creatures untouched', () => {
    const artifact = { id: 'ring', card: { type_line: 'Artifact' } };
    expect(withDeathLastKnownPowerToughness({ battlefield: [] }, artifact)).toBe(artifact);
  });
});
