import { describe, expect, it } from 'vitest';
import { stampMissingTargetMetadataAfterOptionalAccept } from '../src/state/modules/stackResolveTriggeredAbilityMissingTargetSafetyNet.js';
import {
  buildSacrificedCostLastKnownSnapshot,
  sacrificedCostLastKnownContext,
  stampSacrificedCostLastKnown,
} from '../src/state/modules/sacrificedCostLastKnown.js';
import { isTriggerStepRuntimeWired } from '../src/state/modules/trigger-runtime-wiring.js';

describe('death-trigger target stamping (mandatory creature_dies)', () => {
  it('stamps target metadata on a mandatory "it deals 1 damage to any target" dies trigger', () => {
    const item: any = {
      type: 'triggered_ability',
      triggerType: 'creature_dies',
      controller: 'p1',
      sourceName: 'Perilous Myr',
      effect: 'it deals 2 damage to any target.',
      mandatory: true,
    };
    const ctx: any = { state: { players: [{ id: 'p1' }, { id: 'p2' }], battlefield: [], stack: [] } };
    expect(stampMissingTargetMetadataAfterOptionalAccept(ctx, item, ctx.state, { triggerType: 'creature_dies' })).toBe(true);
    expect(item.requiresTarget).toBe(true);
    expect(item.needsTargetSelection).toBe(true);
  });

  it('leaves other mandatory trigger types alone', () => {
    const item: any = {
      type: 'triggered_ability',
      triggerType: 'upkeep',
      controller: 'p1',
      effect: 'it deals 2 damage to any target.',
      mandatory: true,
    };
    const ctx: any = { state: { players: [], battlefield: [], stack: [] } };
    expect(stampMissingTargetMetadataAfterOptionalAccept(ctx, item, ctx.state, { triggerType: 'upkeep' })).toBe(false);
    expect(item.requiresTarget).toBeUndefined();
  });
});

describe('cost-sacrifice last-known snapshots', () => {
  const state: any = {
    battlefield: [{
      id: 'perm_fodder', controller: 'p1', owner: 'p1', basePower: 3, baseToughness: 3, counters: { '+1/+1': 2 },
      card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3', cmc: 4, colors: ['R'] },
    }],
  };

  it('snapshots power with counters and round-trips through the stack item to the IR context', () => {
    const snapshot = buildSacrificedCostLastKnownSnapshot(state, 'perm_fodder');
    expect(snapshot).toMatchObject({ id: 'perm_fodder', power: 5, toughness: 5, manaValue: 4, typeLine: 'creature — giant' });
    const stackItem: any = { id: 'thud' };
    stampSacrificedCostLastKnown(stackItem, [snapshot]);
    expect(sacrificedCostLastKnownContext(stackItem).lastSacrificedPermanents?.[0]).toMatchObject({ id: 'perm_fodder', power: 5 });
  });

  it('returns nothing for unknown ids or items without snapshots', () => {
    expect(buildSacrificedCostLastKnownSnapshot(state, 'missing')).toBeNull();
    expect(sacrificedCostLastKnownContext({})).toEqual({});
  });
});

describe('trigger runtime wiring for self-sourced move_counters', () => {
  it('owns "put its counters on target creature you control" but not graft-style "onto it"', () => {
    expect(isTriggerStepRuntimeWired({
      kind: 'move_counters', from: { kind: 'raw', text: 'it' }, to: { kind: 'raw', text: 'target creature you control' },
      amount: { kind: 'all' }, raw: 'put its counters on target creature you control',
    } as any)).toBe(true);
    expect(isTriggerStepRuntimeWired({
      kind: 'move_counters', from: { kind: 'raw', text: 'this creature' }, to: { kind: 'raw', text: 'it' },
      amount: { kind: 'number', value: 1 }, raw: 'move a +1/+1 counter from this creature onto it',
    } as any)).toBe(false);
  });
});
