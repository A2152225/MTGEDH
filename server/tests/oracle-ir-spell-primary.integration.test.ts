import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  isOracleIrExecutionHandled,
  isOracleIrSpellPrimaryEnabled,
  tryResolveSpellViaOracleIR,
} from '../src/state/modules/oracleIrSpellExecution.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR spell execution', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('shadow mode probes without mutating game state', () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;

    const gameId = 'oracle_ir_spell_shadow';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const handBefore = [{ id: 'card-1', name: 'Forest', zone: 'hand' }];
    (game.state as any).zones = {
      [p1]: {
        hand: [...handBefore],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [...handBefore];
    player.library = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Ancestral Recall',
      oracleText: 'Target player draws three cards.',
      sourceId: 'ancestral-recall-1',
      targets: [p1],
    });

    expect(isOracleIrSpellPrimaryEnabled()).toBe(false);
    expect(outcome.handled).toBe(false);
    expect(outcome.shadowWouldHandle).toBe(true);
    expect(player.hand).toHaveLength(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('primary mode applies draw steps and skips duplicate legacy execution', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_spell_primary_draw';
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
      { id: 'lib-3', name: 'Plains', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: p1,
      spellName: 'Divination',
      oracleText: 'Draw two cards.',
      sourceId: 'divination-1',
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThan(0);
    expect(player.hand.length + player.library.length).toBe(3);
  });

  it('treats player-choice halts as handled', () => {
    const gameId = 'oracle_ir_spell_handled_helper';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const handCards = [
      { id: 'card-1', name: 'Lightning Bolt', zone: 'hand' },
      { id: 'card-2', name: 'Counterspell', zone: 'hand' },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: handCards.map((card) => ({ ...card })),
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = handCards.map((card) => ({ ...card }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'mind-rot-1',
      sourceName: 'Mind Rot',
    });

    const queueBefore = ResolutionQueueManager.getQueue(gameId).steps.length;
    const result = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'discard',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          raw: 'Discard a card.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );
    const queueAfter = ResolutionQueueManager.getQueue(gameId).steps.length;

    expect(isOracleIrExecutionHandled(result, queueBefore, queueAfter)).toBe(true);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1).some(
      (step) => step.type === ResolutionStepType.DISCARD_SELECTION,
    )).toBe(true);
  });
});
