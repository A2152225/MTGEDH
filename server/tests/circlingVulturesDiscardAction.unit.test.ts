import { describe, expect, it } from 'vitest';
import {
  applyCirclingVulturesDiscard,
  getCirclingVulturesDiscardActions,
  isCirclingVulturesDiscardPlayableId,
} from '../src/state/modules/circlingVulturesDiscardAction.js';

const VULTURES = {
  id: 'cv1',
  name: 'Circling Vultures',
  oracle_text: 'Flying\nYou may discard this card any time you could cast an instant.\nAt the beginning of your upkeep, sacrifice Circling Vultures unless you exile the top creature card of your graveyard.',
};

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    priorityPlayerId: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    zones: {
      p1: { hand: [{ ...VULTURES }], graveyard: [], handCount: 1, graveyardCount: 0 },
    },
    players: [{ id: 'p1' }],
    ...overrides,
  };
}

describe('Circling Vultures special-action discard', () => {
  it('lists a Discard action when the player has priority and the card is in hand', () => {
    const actions = getCirclingVulturesDiscardActions(makeState(), 'p1');
    expect(actions).toHaveLength(1);
    expect(actions[0].cardId).toBe('cv1');
    expect(actions[0].label).toBe('Discard');
    expect(isCirclingVulturesDiscardPlayableId(actions[0].playableId)).toBe(true);
  });

  it('does not list the action when the player does not have priority', () => {
    const actions = getCirclingVulturesDiscardActions(makeState({ priorityPlayerId: 'p2' }), 'p1');
    expect(actions).toHaveLength(0);
  });

  it('discards the card from hand into the graveyard', () => {
    const state = makeState();
    const result = applyCirclingVulturesDiscard({ state, bumpSeq: () => {} }, { playerId: 'p1', cardId: 'cv1' });
    expect(result.applied).toBe(true);
    expect(state.zones.p1.hand).toHaveLength(0);
    expect(state.zones.p1.graveyard).toHaveLength(1);
    expect(state.zones.p1.graveyard[0].id).toBe('cv1');
    expect(state.zones.p1.graveyard[0].zone).toBe('graveyard');
  });
});
