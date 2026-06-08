import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { queueLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';

describe('Mindcrank life-loss mill (integration)', () => {
  it('mills the losing player for life lost this trigger', () => {
    const game = createInitialGameState('mindcrank_life_loss_mill');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    game.importDeckResolved(
      p2,
      Array.from({ length: 6 }, (_, i) => ({
        id: `p2_lib_${i}`,
        name: `Card ${i}`,
        type_line: 'Instant',
        zone: 'library',
      })) as any
    );

    (game.state as any).battlefield.push({
      id: 'mindcrank_perm',
      controller: p1,
      owner: p1,
      card: {
        id: 'mindcrank_card',
        name: 'Mindcrank',
        type_line: 'Artifact',
        oracle_text: 'Whenever an opponent loses life, that player mills that many cards.',
      },
    });

    const queued = queueLifeLossTriggers(game as any, p2, 3, p1);
    expect(queued).toHaveLength(1);

    const trigger = queued[0];
    executeTriggerEffect(
      game as any,
      p1,
      'Mindcrank',
      String(trigger.description || trigger.effect || ''),
      trigger
    );

    expect(game.state.zones?.[p2]?.graveyardCount).toBe(3);
    expect(game.libraries.get(p2)?.length).toBe(3);
  });
});
