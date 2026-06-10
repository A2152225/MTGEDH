import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  isOracleIrTriggerPrimaryEnabled,
  tryResolveTriggerViaOracleIR,
} from '../src/state/modules/oracleIrTriggerExecution.js';

describe('oracle IR trigger execution', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('shadow mode probes ETB draw without mutating game state', () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;

    const gameId = 'oracle_ir_trigger_shadow';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [];
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Test Creature',
      effectText: 'Draw a card.',
      triggerItem: { id: 'trigger-1', source: 'perm-1' },
    });

    expect(isOracleIrTriggerPrimaryEnabled()).toBe(false);
    expect(outcome.handled).toBe(false);
    expect(outcome.shadowWouldHandle).toBe(true);
    expect(player.hand).toHaveLength(0);
  });

  it('primary mode applies draw trigger effects', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_primary_draw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [];
    player.library = [{ id: 'lib-1', name: 'Island', zone: 'library' }];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    const outcome = tryResolveTriggerViaOracleIR(ctx, {
      controller: p1,
      sourceName: 'Mulldrifter',
      effectText: 'Draw two cards.',
      triggerItem: { id: 'trigger-1', source: 'mulldrifter-1' },
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThan(0);
    expect(player.hand.length + player.library.length).toBe(1);
  });
});
