import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { canPermanentBeTargetedByPlayer, evaluateTargeting } from '../src/rules-engine/targeting.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';

const LIGHTNING_GREAVES_ORACLE = 'Equipped creature has haste and shroud.\nEquip {0}';

function makeState(options?: { attachedTo?: string; attachedEquipment?: string[] }) {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const greaves = {
    id: 'greaves_1',
    controller: p1,
    attachedTo: options?.attachedTo,
    card: {
      name: 'Lightning Greaves',
      type_line: 'Artifact — Equipment',
      oracle_text: LIGHTNING_GREAVES_ORACLE,
    },
  };
  const bear = {
    id: 'bear_1',
    controller: p1,
    attachedEquipment: options?.attachedEquipment,
    card: {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
  const state = {
    players: [{ id: p1 }, { id: p2 }],
    battlefield: [greaves, bear],
  };
  return { p1, p2, greaves, bear, state };
}

describe('Lightning Greaves shroud targeting', () => {
  it('blocks opponent targeting when greaves are attached via attachedTo', () => {
    const { p2, bear, state } = makeState({ attachedTo: 'bear_1' });

    expect(canPermanentBeTargetedByPlayer(bear as any, state as any, p2)).toBe(false);
  });

  it('blocks opponent targeting when only attachedEquipment is set', () => {
    const { p2, bear, state } = makeState({ attachedEquipment: ['greaves_1'] });

    expect(canPermanentBeTargetedByPlayer(bear as any, state as any, p2)).toBe(false);
  });

  it('blocks the controller from targeting a shrouded equipped creature', () => {
    const { p1, bear, state } = makeState({ attachedTo: 'bear_1', attachedEquipment: ['greaves_1'] });

    expect(canPermanentBeTargetedByPlayer(bear as any, state as any, p1)).toBe(false);
  });

  it('does not give Lightning Greaves itself shroud', () => {
    const { p2, greaves, state } = makeState({ attachedTo: 'bear_1', attachedEquipment: ['greaves_1'] });

    expect(canPermanentBeTargetedByPlayer(greaves as any, state as any, p2)).toBe(true);
  });

  it('omits the equipped creature from opponent spell targeting', () => {
    const { p2, state } = makeState({ attachedTo: 'bear_1', attachedEquipment: ['greaves_1'] });
    const legal = evaluateTargeting(
      state as any,
      p2,
      { op: 'DESTROY_TARGET', filter: 'CREATURE', minTargets: 1, maxTargets: 1 } as any,
    );

    expect(legal.map((target) => target.id)).not.toContain('bear_1');
  });

  it('blocks targeting after continuous effects sync (badge path)', () => {
    const { p2, bear, state } = makeState({ attachedTo: 'bear_1', attachedEquipment: ['greaves_1'] });
    syncDerivedContinuousEffects(state);

    expect(canPermanentBeTargetedByPlayer(bear as any, state as any, p2)).toBe(false);
  });
});
