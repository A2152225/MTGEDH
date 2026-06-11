import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

describe('exile top where X (integration)', () => {
  it('exiles top cards equal to lands controlled via IR fallback', () => {
    const game = createInitialGameState('exile_top_where_x');
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.importDeckResolved(
      p1,
      Array.from({ length: 8 }, (_, i) => ({
        id: `p1_lib_${i}`,
        name: `Card ${i}`,
        type_line: 'Instant',
        zone: 'library',
      })) as any
    );

    (game.state as any).battlefield.push(
      {
        id: 'land_1',
        controller: p1,
        owner: p1,
        card: { id: 'forest', name: 'Forest', type_line: 'Land — Forest' },
      },
      {
        id: 'land_2',
        controller: p1,
        owner: p1,
        card: { id: 'island', name: 'Island', type_line: 'Land — Island' },
      },
      {
        id: 'land_3',
        controller: p1,
        owner: p1,
        card: { id: 'mountain', name: 'Mountain', type_line: 'Land — Mountain' },
      }
    );

    executeTriggerEffect(
      game as any,
      p1,
      'Test Exile',
      'Exile the top X cards of your library, where X is the number of lands you control.',
      {
        type: 'triggered_ability',
        controller: p1,
        triggerType: 'spell_effect',
      }
    );

    expect(game.libraries.get(p1)?.length).toBe(5);
    expect((game.state as any).zones?.[p1]?.exileCount).toBe(3);
    expect((game.state as any).zones?.[p1]?.libraryCount).toBe(5);
  });
});
