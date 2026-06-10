import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionStepType } from '../src/state/resolution/index.js';

describe('explore counter modifications', () => {
  it('doubles explore +1/+1 counters with Branching Evolution when top card is a nonland artifact', () => {
    const gameId = 'test_explore_branching_evolution';
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState(gameId);

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'branching_evolution_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'branching_evolution_card',
          name: 'Branching Evolution',
          type_line: 'Enchantment',
          oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
        },
      },
      {
        id: 'explorer_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'explorer_card', name: 'Merfolk Explorer', type_line: 'Creature — Merfolk Scout' },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game as any).libraries.set(p1, [
      {
        id: 'top_artifact',
        name: 'Sol Ring',
        type_line: 'Artifact',
        zone: 'library',
      },
    ]);

    game.applyEvent({
      type: 'exploreResolve',
      playerId: p1,
      resolvedStepType: ResolutionStepType.EXPLORE_DECISION,
      permanentId: 'explorer_1',
      revealedCardId: 'top_artifact',
      isLand: false,
      toGraveyard: false,
    } as any);

    const explorer = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'explorer_1') as any;
    expect(explorer?.counters?.['+1/+1']).toBe(2);
    expect(((game as any).libraries.get(p1) || []).map((card: any) => card.id)).toEqual(['top_artifact']);
  });
});
