import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

describe('Hope Estheim end step mill', () => {
  it('mills each opponent for life gained this turn', () => {
    const game = createInitialGameState('hope_estheim_mill');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'P3' } as any);

    const makeLibrary = (prefix: string) =>
      Array.from({ length: 5 }, (_, i) => ({
        id: `${prefix}_lib_${i}`,
        name: `${prefix} Card ${i}`,
        type_line: 'Instant',
        zone: 'library',
      }));

    (game.state as any).players = [
      { id: p1, name: 'P1' },
      { id: p2, name: 'P2' },
      { id: p3, name: 'P3' },
    ];
    (game.state as any).lifeGainedThisTurn = { [p1]: 2 };
    (game.state as any).zones = {
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p2'), libraryCount: 5 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, library: makeLibrary('p3'), libraryCount: 5 },
    };

    const ctx = game as any;
    (ctx as any).libraries = new Map([
      [p2, [...(game.state as any).zones[p2].library]],
      [p3, [...(game.state as any).zones[p3].library]],
    ]);

    const trigger = {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'end_step',
      description:
        'Each opponent mills X cards, where X is the amount of life you gained this turn',
    };

    executeTriggerEffect(
      ctx,
      p1,
      'Hope Estheim',
      trigger.description,
      trigger,
    );

    expect((game.state as any).zones[p2].graveyard).toHaveLength(2);
    expect((game.state as any).zones[p3].graveyard).toHaveLength(2);
    expect((ctx as any).libraries.get(p2)).toHaveLength(3);
    expect((ctx as any).libraries.get(p3)).toHaveLength(3);
  });

  it('mills zero when no life was gained this turn', () => {
    const game = createInitialGameState('hope_estheim_mill_zero');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).players = [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }];
    (game.state as any).lifeGainedThisTurn = { [p1]: 0 };
    (game.state as any).zones = {
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'c1', name: 'Card', type_line: 'Instant', zone: 'library' }],
        libraryCount: 1,
      },
    };

    const ctx = game as any;
    (ctx as any).libraries = new Map([[p2, [...(game.state as any).zones[p2].library]]]);

    executeTriggerEffect(ctx, p1, 'Hope Estheim', 'Each opponent mills X cards, where X is the amount of life you gained this turn', {
      type: 'triggered_ability',
      controller: p1,
      triggerType: 'end_step',
    });

    expect((game.state as any).zones[p2].graveyard).toHaveLength(0);
  });
});
