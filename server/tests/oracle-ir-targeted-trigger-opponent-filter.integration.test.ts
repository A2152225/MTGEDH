import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { triggerPermanentTargetedTriggersFromSpell } from '../src/state/modules/triggers/targeted.js';

describe('Oracle IR targeted trigger opponent-control filters', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  const wardOracleText =
    'Reach\nWard {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)';

  function seedWardCreature(game: any, ownerId: PlayerID) {
    (game.state as any).battlefield = [
      {
        id: 'cactusfolk_1',
        controller: ownerId,
        card: {
          name: 'Cactusfolk Sureshot',
          type_line: 'Creature — Plant Warrior',
          oracle_text: wardOracleText,
        },
      },
    ];
  }

  it('does not queue Ward when the creature controller targets their own creature', () => {
    const gameId = 'test_oracle_ir_ward_self_target_skip';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    seedWardCreature(game, p1);

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p1,
      stackItemId: 'stack_growth_self_1',
      targetIds: ['cactusfolk_1'],
    });

    expect(targetedTriggers).toHaveLength(0);
  });

  it('queues Ward when an opponent targets the creature with a spell', () => {
    const gameId = 'test_oracle_ir_ward_opponent_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' } as any);
    seedWardCreature(game, p1);

    const targetedTriggers = triggerPermanentTargetedTriggersFromSpell(game as any, {
      castBy: p2,
      stackItemId: 'stack_shock_opponent_1',
      targetIds: ['cactusfolk_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.sourceName).toBe('Cactusfolk Sureshot');
    expect(String(targetedTriggers[0]?.description || '')).toMatch(/counter it/i);
    expect(targetedTriggers[0]?.effectData?.targetedPermanentId).toBe('cactusfolk_1');
  });
});
