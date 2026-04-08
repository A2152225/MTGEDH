import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('cascadeResolve replay semantics', () => {
  it('replays a declined cascade by restoring the library and clearing pending prompt state', () => {
    const game = createInitialGameState('t_cascade_resolve_decline_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries?.set?.(p1, []);
    (game.state as any).pendingCascade = {
      [p1]: [
        {
          sourceCardId: 'bloodbraid_elf',
          sourceName: 'Bloodbraid Elf',
          manaValue: 4,
          instance: 1,
          effectId: 'cascade_1',
          awaiting: true,
        },
      ],
    };

    ResolutionQueueManager.addStep('t_cascade_resolve_decline_replay', {
      type: ResolutionStepType.CASCADE,
      playerId: p1,
      description: 'Cascade - Cast Lightning Bolt?',
      mandatory: true,
      sourceId: 'bloodbraid_elf',
      sourceName: 'Bloodbraid Elf',
      cascadeNumber: 1,
      totalCascades: 1,
      effectId: 'cascade_1',
      hitCard: { id: 'lightning_bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Deal 3 damage to any target.' },
      exiledCards: [],
    } as any);

    game.applyEvent({
      type: 'cascadeResolve',
      playerId: p1,
      effectId: 'cascade_1',
      sourceCardId: 'bloodbraid_elf',
      sourceName: 'Bloodbraid Elf',
      cascadeNumber: 1,
      cast: false,
      hitCard: { id: 'lightning_bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Deal 3 damage to any target.' },
      libraryAfter: [
        { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
        { id: 'lightning_bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Deal 3 damage to any target.' },
      ],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['forest_1', 'lightning_bolt']);
    expect((game.state as any).zones[p1].library.map((card: any) => card.id)).toEqual(['forest_1', 'lightning_bolt']);
    expect((game.state as any).pendingCascade).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer('t_cascade_resolve_decline_replay', p1)).toHaveLength(0);
  });

  it('replays a cast cascade by moving the hit card into exile before the free cast event', () => {
    const game = createInitialGameState('t_cascade_resolve_cast_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries?.set?.(p1, []);
    (game.state as any).pendingCascade = {
      [p1]: [
        {
          sourceCardId: 'bloodbraid_elf',
          sourceName: 'Bloodbraid Elf',
          manaValue: 4,
          instance: 1,
          effectId: 'cascade_2',
          awaiting: true,
        },
      ],
    };

    game.applyEvent({
      type: 'cascadeResolve',
      playerId: p1,
      effectId: 'cascade_2',
      sourceCardId: 'bloodbraid_elf',
      sourceName: 'Bloodbraid Elf',
      cascadeNumber: 1,
      cast: true,
      hitCard: {
        id: 'lightning_bolt',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        oracle_text: 'Deal 3 damage to any target.',
      },
      libraryAfter: [
        { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
      ],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['forest_1']);
    expect((game.state as any).zones[p1].exile.map((card: any) => card.id)).toEqual(['lightning_bolt']);
    expect((game.state as any).zones[p1].exileCount).toBe(1);
    expect((game.state as any).pendingCascade).toBeUndefined();
  });
});
