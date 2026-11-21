import { describe, expect, it, vi } from 'vitest';

const recomputes = vi.hoisted(() => ({ stamps: 0 }));

vi.mock('../src/state/modules/layer4TypeSetting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state/modules/layer4TypeSetting.js')>();
  return {
    ...actual,
    // One layer 4 stamp runs per continuous-effects recompute.
    stampLayer4TypeSetting: (state: any) => {
      recomputes.stamps += 1;
      return actual.stampLayer4TypeSetting(state);
    },
  };
});

import { runWithDerivedContinuousEffectsForScan } from '../src/state/modules/derivedContinuousEffectsScanScope.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  readDerivedContinuousEffects,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getPutIntoGraveyardTriggers } from '../src/state/modules/triggers/zone-change.js';

/**
 * Self-play game 144: after an Effect Program resume the game state had no derived
 * continuous-effects view, and the "card put into a graveyard" trigger scan asked for each
 * permanent's granted abilities. Every question rebuilt the whole view: 97 rebuilds, 155 seconds.
 */
function borg(index: number) {
  return {
    id: `borg_${index}`,
    controller: 'p1',
    owner: 'p1',
    isToken: true,
    counters: {},
    card: { id: `borg_card_${index}`, name: 'Borg', type_line: 'Token Artifact Creature — Borg', oracle_text: '', power: '1', toughness: '1' },
  };
}

function makeState(count: number) {
  return {
    players: [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }],
    life: { p1: 40, p2: 40 },
    turnPlayer: 'p1',
    activePlayer: 'p1',
    stack: [],
    battlefield: Array.from({ length: count }, (_, index) => borg(index)),
    zones: {
      p1: { hand: [], graveyard: [], exile: [], library: [] },
      p2: { hand: [], graveyard: [], exile: [], library: [] },
    },
  } as any;
}

describe('derived continuous effects during a battlefield-wide scan', () => {
  it('rebuilds once for the whole scan and leaves no view behind', () => {
    const state = makeState(40);
    expect(readDerivedContinuousEffects(state)).toBeNull();

    recomputes.stamps = 0;
    const answers = runWithDerivedContinuousEffectsForScan(state, () => (
      state.battlefield.map((perm: any) => getContinuousGrantedAbilitiesForPermanent(perm, state))
    ));

    expect(answers).toHaveLength(40);
    expect(recomputes.stamps).toBe(1);
    // Removed afterwards: code that changes the battlefield next must not read a stale view.
    expect(readDerivedContinuousEffects(state)).toBeNull();
  });

  it('reuses a view that is already there and does not remove it', () => {
    const state = makeState(10);
    syncDerivedContinuousEffects(state);
    const existing = readDerivedContinuousEffects(state);
    expect(existing).not.toBeNull();

    recomputes.stamps = 0;
    runWithDerivedContinuousEffectsForScan(state, () => (
      state.battlefield.map((perm: any) => getContinuousGrantedAbilitiesForPermanent(perm, state))
    ));

    expect(recomputes.stamps).toBe(0);
    expect(readDerivedContinuousEffects(state)).toBe(existing);
  });

  it('the put-into-graveyard trigger scan rebuilds once, not once per permanent', () => {
    const state = makeState(40);
    const ctx = { state, gameId: 'scan_scope_graveyard', bumpSeq: () => {}, libraries: new Map() } as any;

    recomputes.stamps = 0;
    const triggers = getPutIntoGraveyardTriggers(
      ctx,
      'p1',
      { id: 'spent_spell', name: 'Borg Incursion', type_line: 'Instant', oracle_text: '' },
      { controllerId: 'p1', originZone: 'stack' },
    );

    expect(triggers).toEqual([]);
    expect(recomputes.stamps).toBeLessThanOrEqual(1);
    expect(readDerivedContinuousEffects(state)).toBeNull();
  });
});
