import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function makeLibrary(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_lib_${i}`,
    name: `${prefix} Card ${i}`,
    type_line: 'Instant',
    zone: 'library',
  }));
}

describe('trigger scry and surveil oracle IR fallback', () => {
  it('queues scry via oracle IR when a trigger effect scries', () => {
    const gameId = 'trigger_scry_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.importDeckResolved(p1, makeLibrary('p1', 5) as any);

    const ctx = game as any;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(ctx, p1, 'Opt', 'Scry 2', {
      type: 'triggered_ability',
      controller: p1,
      sourceId: 'opt_source',
      id: 'opt_trigger',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const scryStep = steps.find(step => step.type === ResolutionStepType.SCRY);
    expect(scryStep).toBeTruthy();
    expect((scryStep as any)?.scryCount).toBe(2);
  });

  it('queues surveil via oracle IR when a trigger effect surveils', () => {
    const gameId = 'trigger_surveil_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.importDeckResolved(p1, makeLibrary('p1', 5) as any);

    const ctx = game as any;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(ctx, p1, 'Discovery', 'Surveil 2', {
      type: 'triggered_ability',
      controller: p1,
      sourceId: 'discovery_source',
      id: 'discovery_trigger',
    });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const surveilStep = steps.find(step => step.type === ResolutionStepType.SURVEIL);
    expect(surveilStep).toBeTruthy();
    expect((surveilStep as any)?.surveilCount).toBe(2);
  });

  it('queues surveil with whereX resolved from battlefield count', () => {
    const gameId = 'trigger_surveil_where_x';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.importDeckResolved(p1, makeLibrary('p1', 5) as any);

    (game.state as any).battlefield.push(
      {
        id: 'bear_1',
        controller: p1,
        owner: p1,
        card: { id: 'bear_1_card', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'bear_2',
        controller: p1,
        owner: p1,
        card: { id: 'bear_2_card', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      }
    );

    const ctx = game as any;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Desmond Miles',
      'Surveil X, where X is the number of creatures you control.',
      {
        type: 'triggered_ability',
        controller: p1,
        sourceId: 'desmond_source',
        id: 'desmond_trigger',
        damagedPlayerId: p2,
        damageAmount: 2,
        effectData: { damageAmount: 2, damagedPlayerId: p2 },
      }
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const surveilStep = steps.find(step => step.type === ResolutionStepType.SURVEIL);
    expect(surveilStep).toBeTruthy();
    expect((surveilStep as any)?.surveilCount).toBe(2);
  });
});
