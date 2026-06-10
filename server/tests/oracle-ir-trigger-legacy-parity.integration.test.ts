import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { isOracleIrTriggerPrimaryEnabled } from '../src/state/modules/oracleIrTriggerExecution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function ensureZonesForPlayer(g: any, pid: PlayerID) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  };
}

function setupPlayerLibrary(g: any, pid: PlayerID, libraryIds: string[]) {
  const player = (g.state as any).players.find((entry: any) => entry.id === pid);
  player.library = libraryIds.map((id) => ({ id, name: id, zone: 'library' }));
  ensureZonesForPlayer(g, pid);
  (g.state as any).zones[pid].library = player.library.map((card: any) => ({ ...card }));
  (g.state as any).zones[pid].libraryCount = player.library.length;
  g.libraries = g.libraries || new Map();
  g.libraries.set(pid, player.library.map((card: any) => ({ ...card })));
}

describe('oracle IR trigger legacy parity (primary mode)', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('routes simple draw triggers through IR primary instead of legacy regex', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_execute_draw';
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

    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);

    executeTriggerEffect(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-1', source: 'mulldrifter-1' },
    );

    const handCount = (player.hand || (game.state as any).zones?.[p1]?.hand || []).length;
    const libraryCount = (player.library || (game.state as any).zones?.[p1]?.library || []).length;
    expect(handCount).toBe(2);
    expect(libraryCount).toBe(0);
  });

  it('does not double-apply draw when IR primary owns the trigger effect', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_no_double_draw';
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
      { id: 'lib-4', name: 'Forest', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);

    executeTriggerEffect(
      ctx,
      p1,
      'Mulldrifter',
      'Draw two cards.',
      { id: 'trigger-1', source: 'mulldrifter-1' },
    );

    const handCount = (player.hand || (game.state as any).zones?.[p1]?.hand || []).length;
    const libraryCount = (player.library || (game.state as any).zones?.[p1]?.library || []).length;
    expect(handCount).toBe(2);
    expect(libraryCount).toBe(2);
  });

  it('routes simple gain-life triggers through IR primary', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_execute_gain_life';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const lifeBefore = (game.state as any).players.find((entry: any) => entry.id === p1)?.life ?? 40;

    executeTriggerEffect(
      ctx,
      p1,
      'Soul Warden',
      'You gain 1 life.',
      { id: 'trigger-1', source: 'warden-1' },
    );

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (game.state as any).life?.[p1]).toBe(lifeBefore + 1);
  });

  it('queues scry via IR primary without duplicate legacy scry regex', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_execute_scry';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    ensureZonesForPlayer(game, p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3']);

    executeTriggerEffect(
      ctx,
      p1,
      'Opt',
      'Scry 1.',
      { id: 'trigger-1', source: 'opt-1' },
    );

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(1);
    expect((scrySteps[0] as any)?.scryCount).toBe(1);
  });

  it('routes simple lose-life triggers through IR primary', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_execute_lose_life';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const lifeBefore = (game.state as any).players.find((entry: any) => entry.id === p1)?.life ?? 40;

    executeTriggerEffect(
      ctx,
      p1,
      'Shock',
      'You lose 2 life.',
      { id: 'trigger-1', source: 'shock-1' },
    );

    const playerAfter = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect(playerAfter?.life ?? (game.state as any).life?.[p1]).toBe(lifeBefore - 2);
  });

  it('does not use legacy pendingDiscard when IR primary owns discard text', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_trigger_execute_discard';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    const p2Hand = [
      { id: 'card-1', name: 'Island', zone: 'hand' },
      { id: 'card-2', name: 'Mountain', zone: 'hand' },
    ];
    (game.state as any).zones = {
      [p2]: {
        hand: p2Hand,
        handCount: p2Hand.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    const p2Player = (game.state as any).players.find((entry: any) => entry.id === p2);
    p2Player.hand = p2Hand.map((card) => ({ ...card }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).pendingDiscard = {};

    executeTriggerEffect(
      ctx,
      p1,
      'Liliana',
      'Target player discards a card.',
      {
        id: 'trigger-1',
        source: 'liliana-1',
        targets: [p2],
        targetPlayerId: p2,
      },
    );

    expect((game.state as any).pendingDiscard?.[p2]).toBeUndefined();
    expect((game.state as any).pendingDiscard?.[p1]).toBeUndefined();
  });
});
