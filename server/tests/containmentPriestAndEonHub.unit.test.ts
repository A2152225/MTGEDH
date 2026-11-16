import { describe, expect, it } from 'vitest';
import {
  applyContainmentPriestExileIfNeeded,
  eonHubIsInPlay,
  shouldSkipUpkeepForEonHub,
  wouldContainmentPriestExileEntry,
} from '../src/state/modules/containmentPriestAndEonHubApply.js';

function priestState() {
  const priest = {
    id: 'priest1',
    name: 'Containment Priest',
    card: {
      name: 'Containment Priest',
      oracle_text: "If a nontoken creature would enter the battlefield and it wasn't cast, exile it instead.",
    },
  };
  return {
    battlefield: [priest],
    zones: { p1: { exile: [], exileCount: 0 } },
    players: [{ id: 'p1' }],
  };
}

describe('Containment Priest', () => {
  it('exiles a nontoken creature that was not cast', () => {
    const state = priestState();
    const creature = {
      id: 'reanim1',
      owner: 'p1',
      controller: 'p1',
      type_line: 'Creature — Zombie',
      card: { id: 'reanim1', name: 'Grizzly Bears', type_line: 'Creature — Bear', owner: 'p1' },
    };
    state.battlefield.push(creature);
    expect(wouldContainmentPriestExileEntry({ state, permanent: creature, enteredFromZone: 'graveyard' })).toBe(true);
    const result = applyContainmentPriestExileIfNeeded({ state, permanent: creature, enteredFromZone: 'graveyard' });
    expect(result.applied).toBe(true);
    expect(result.redirectedTo).toBe('exile');
    expect(state.battlefield.find((p: any) => p.id === 'reanim1')).toBeUndefined();
    expect(state.zones.p1.exile.some((c: any) => c.id === 'reanim1')).toBe(true);
  });

  it('does not exile a creature that was cast, or a token', () => {
    const state = priestState();
    const cast = {
      id: 'cast1',
      owner: 'p1',
      enteredFromCast: true,
      type_line: 'Creature — Bear',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', enteredFromCast: true },
    };
    const token = {
      id: 'tok1',
      isToken: true,
      type_line: 'Token Creature — Soldier',
      card: { name: 'Soldier', type_line: 'Token Creature — Soldier', isToken: true },
    };
    expect(wouldContainmentPriestExileEntry({ state, permanent: cast })).toBe(false);
    expect(wouldContainmentPriestExileEntry({ state, permanent: token })).toBe(false);
  });
});

describe('Eon Hub', () => {
  it('skips the upkeep step while Eon Hub is in play', () => {
    const state = {
      battlefield: [{
        id: 'hub1',
        card: { name: 'Eon Hub', oracle_text: 'Players skip their upkeep steps.' },
      }],
    };
    expect(eonHubIsInPlay(state)).toBe(true);
    expect(shouldSkipUpkeepForEonHub(state, 'upkeep')).toBe(true);
    expect(shouldSkipUpkeepForEonHub(state, 'UPKEEP')).toBe(true);
    expect(shouldSkipUpkeepForEonHub(state, 'draw')).toBe(false);
  });

  it('does not skip upkeep when Eon Hub is not in play', () => {
    expect(shouldSkipUpkeepForEonHub({ battlefield: [] }, 'upkeep')).toBe(false);
  });
});
