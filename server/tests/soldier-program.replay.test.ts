import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('SOLDIER Military Program replay semantics', () => {
  beforeEach(() => {
    resetGame('t_soldier_program_replay_prompt');
  });

  it('replays token creation and queued Soldier selection after choosing both', () => {
    const gameId = 't_soldier_program_replay_prompt';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'soldier_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'soldier_card_1', name: 'Soldier One', type_line: 'Creature — Soldier' },
      },
      {
        id: 'soldier_2',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'soldier_card_2', name: 'Soldier Two', type_line: 'Creature — Soldier' },
      },
      {
        id: 'soldier_3',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'soldier_card_3', name: 'Soldier Three', type_line: 'Creature — Soldier' },
      },
    ];

    game.applyEvent({
      type: 'executeEffect',
      effectType: 'createToken',
      controllerId: p1,
      tokenData: {
        id: 'soldier_token_1',
        name: 'Soldier',
        typeLine: 'Token Creature — Soldier',
        power: 1,
        toughness: 1,
        colors: ['W'],
        abilities: [],
      },
    } as any);

    game.applyEvent({
      type: 'resolveTopOfStackPrompt',
      playerId: p1,
      sourceId: 'soldier_program_1',
      queuedResolutionStep: {
        id: 'queued_soldier_program_prompt_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        description: 'SOLDIER Military Program: Choose up to 2 Soldiers to get +1/+1 counters',
        mandatory: false,
        sourceId: 'soldier_program_1',
        sourceName: 'SOLDIER Military Program',
        validTargets: [
          { id: 'soldier_1', name: 'Soldier One', type: 'permanent', controller: p1 },
          { id: 'soldier_2', name: 'Soldier Two', type: 'permanent', controller: p1 },
          { id: 'soldier_3', name: 'Soldier Three', type: 'permanent', controller: p1 },
          { id: 'soldier_token_1', name: 'Soldier', type: 'permanent', controller: p1 },
        ],
        targetTypes: ['creature'],
        minTargets: 0,
        maxTargets: 2,
        targetDescription: 'Soldier creatures you control',
        soldierProgramCounters: true,
      },
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    const token = battlefield.find((perm: any) => perm && perm.id === 'soldier_token_1');
    expect(token).toBeTruthy();
    expect(token?.card?.name).toBe('Soldier');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any)?.soldierProgramCounters).toBe(true);
    expect(((queue.steps[0] as any)?.validTargets || []).map((target: any) => String(target.id))).toContain('soldier_token_1');
  });
});