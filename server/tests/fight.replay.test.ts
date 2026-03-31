import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('fight replay semantics', () => {
  it('replays fight by restoring damage-received pending triggers', () => {
    const game = createInitialGameState('t_fight_replay_damage_trigger');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).battlefield = [
      {
        id: 'taunter_1',
        controller: p1,
        owner: p1,
        damage: 0,
        card: {
          id: 'taunter_card',
          name: 'Brash Taunter',
          type_line: 'Creature — Goblin',
          oracle_text: 'Indestructible. Whenever Brash Taunter is dealt damage, it deals that much damage to target opponent.',
        },
      },
      {
        id: 'bear_1',
        controller: p2,
        owner: p2,
        damage: 0,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    game.applyEvent({
      type: 'fight',
      playerId: p1,
      sourceId: 'taunter_1',
      targetId: 'bear_1',
      sourcePower: 1,
      targetPower: 2,
    } as any);

    const taunter = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'taunter_1');
    const bear = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bear_1');
    expect(Number(taunter?.damage || 0)).toBe(2);
    expect(Number(bear?.damage || 0)).toBe(1);

    expect((game.state as any).pendingDamageTriggers).toBeUndefined();

    const queue = ResolutionQueueManager.getQueue('t_fight_replay_damage_trigger');
    const step = queue.steps.find((entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeDefined();
    expect(step).toMatchObject({
      playerId: p1,
      sourceId: 'taunter_1',
      sourceName: 'Brash Taunter',
      mandatory: true,
      damageReceivedTrigger: true,
    });
    expect((step as any).damageTrigger).toMatchObject({
      sourceId: 'taunter_1',
      sourceName: 'Brash Taunter',
      controller: p1,
      damageAmount: 2,
      triggerType: 'dealt_damage',
      targetType: 'opponent',
    });
  });
});