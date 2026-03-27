import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';

describe('setTriggerShortcut replay semantics', () => {
  it('rebuilds saved trigger shortcuts from persisted events', () => {
    const game = createInitialGameState('t_trigger_shortcut_replay');

    game.applyEvent({
      type: 'setTriggerShortcut',
      playerId: 'p1',
      cardName: 'Soul Warden',
      preference: 'always_resolve',
    } as any);

    expect((game.state as any).triggerShortcuts).toEqual({
      p1: [
        {
          cardName: 'soul warden',
          playerId: 'p1',
          preference: 'always_resolve',
          triggerDescription: undefined,
        },
      ],
    });
  });

  it('removes a saved shortcut when replaying ask_each_time', () => {
    const game = createInitialGameState('t_trigger_shortcut_replay_remove');
    (game.state as any).triggerShortcuts = {
      p1: [
        {
          cardName: 'soul warden',
          playerId: 'p1',
          preference: 'always_resolve',
        },
      ],
    };

    game.applyEvent({
      type: 'setTriggerShortcut',
      playerId: 'p1',
      cardName: 'Soul Warden',
      preference: 'ask_each_time',
    } as any);

    expect((game.state as any).triggerShortcuts).toEqual({ p1: [] });
  });

  it('updates the matching triggerDescription-specific shortcut in place', () => {
    const game = createInitialGameState('t_trigger_shortcut_replay_update');
    (game.state as any).triggerShortcuts = {
      p1: [
        {
          cardName: 'rhystic study',
          playerId: 'p1',
          preference: 'always_pay',
          triggerDescription: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      ],
    };

    game.applyEvent({
      type: 'setTriggerShortcut',
      playerId: 'p1',
      cardName: 'Rhystic Study',
      preference: 'never_pay',
      triggerDescription: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    } as any);

    expect((game.state as any).triggerShortcuts.p1).toEqual([
      {
        cardName: 'rhystic study',
        playerId: 'p1',
        preference: 'never_pay',
        triggerDescription: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
      },
    ]);
  });
});