import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
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

describe('oracle IR trigger primary production default', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_TRIGGER_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
    if (previousLegacy === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    } else {
      process.env.ORACLE_IR_TRIGGER_LEGACY = previousLegacy;
    }
  });

  it('enables trigger primary when env overrides are cleared', () => {
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);
  });

  it('applies draw trigger effects through IR primary without legacy regex', () => {
    const gameId = 'oracle_ir_default_trigger_draw';
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

  it('does not double-apply draw when production default IR primary owns the effect', () => {
    const gameId = 'oracle_ir_default_trigger_no_double_draw';
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

  it('queues a single scry step under production default without legacy duplicates', () => {
    const gameId = 'oracle_ir_default_trigger_scry';
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
    expect((game.state as any).pendingScry?.[p1]).toBeUndefined();
  });

  it('queues a single surveil step under production default without legacy duplicates', () => {
    const gameId = 'oracle_ir_default_trigger_surveil';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    ensureZonesForPlayer(game, p1);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    setupPlayerLibrary(game, p1, ['lib-1', 'lib-2', 'lib-3', 'lib-4']);

    executeTriggerEffect(
      ctx,
      p1,
      'Discovery',
      'Surveil 2.',
      { id: 'trigger-1', source: 'discovery-1' },
    );

    const surveilSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .filter((step) => step.type === ResolutionStepType.SURVEIL);
    expect(surveilSteps).toHaveLength(1);
    expect((surveilSteps[0] as any)?.surveilCount).toBe(2);
  });

  it('routes target-player mill triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_mill_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Glimpse',
      'Target player mills three cards.',
      {
        id: 'trigger-1',
        source: 'glimpse-1',
        targets: [p2],
        targetPlayerId: p2,
      },
    );

    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(3);
    expect((game.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(1);
  });

  it('queues each-opponent discard trigger steps through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_discard_each_opponent';
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
      'Each opponent discards a card.',
      { id: 'trigger-1', source: 'liliana-1' },
    );

    expect((game.state as any).pendingDiscard?.[p2]).toBeUndefined();
    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
  });

  it('routes each-opponent mill triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_mill_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p2, ['mill-1', 'mill-2', 'mill-3', 'mill-4']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Glimpse',
      'Each opponent mills two cards.',
      { id: 'trigger-1', source: 'glimpse-1' },
    );

    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.length).toBe(2);
    expect((game.state as any).zones?.[p2]?.libraryCount ?? 0).toBe(2);
  });

  it('queues each-player discard trigger steps through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_discard_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    const handCardsFor = (prefix: string) => [
      { id: `${prefix}-1`, name: 'Hand 1', zone: 'hand' },
      { id: `${prefix}-2`, name: 'Hand 2', zone: 'hand' },
      { id: `${prefix}-3`, name: 'Hand 3', zone: 'hand' },
    ];
    for (const [playerId, prefix] of [[p1, 'p1'], [p2, 'p2']] as const) {
      const handCards = handCardsFor(prefix);
      (game.state as any).zones[playerId].hand = handCards.map((card) => ({ ...card }));
      (game.state as any).zones[playerId].handCount = handCards.length;
      const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
      player.hand = handCards.map((card) => ({ ...card }));
    }

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).pendingDiscard = {};

    executeTriggerEffect(
      ctx,
      p1,
      'Wheel',
      'Each player discards two cards.',
      { id: 'trigger-1', source: 'wheel-1' },
    );

    expect((game.state as any).pendingDiscard?.[p1]).toBeUndefined();
    expect((game.state as any).pendingDiscard?.[p2]).toBeUndefined();
    for (const playerId of [p1, p2]) {
      const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
        .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
      expect(discardSteps).toHaveLength(1);
      expect((discardSteps[0] as any)?.discardCount).toBe(2);
    }
  });

  it('routes each-player mill triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_mill_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p1, ['p1-mill-1', 'p1-mill-2', 'p1-mill-3', 'p1-mill-4']);
    setupPlayerLibrary(game, p2, ['p2-mill-1', 'p2-mill-2', 'p2-mill-3', 'p2-mill-4']);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Glimpse',
      'Each player mills two cards.',
      { id: 'trigger-1', source: 'glimpse-1' },
    );

    for (const playerId of [p1, p2]) {
      const gy = (game.state as any).zones?.[playerId]?.graveyard || [];
      expect(gy.length).toBe(2);
      expect((game.state as any).zones?.[playerId]?.libraryCount ?? 0).toBe(2);
    }
  });

  it('routes destroy-target-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_destroy';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Shock',
      'Destroy target creature.',
      {
        id: 'trigger-1',
        source: 'shock-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('routes gain-life triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_gain_life';
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

  it('routes lose-life triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_lose_life';
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

  it('routes each-opponent lose-life triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_lose_life_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Ob Nixilis',
      'Each opponent loses 3 life.',
      { id: 'trigger-1', source: 'nixilis-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(37);
  });

  it('routes each-player lose-life triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_lose_life_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Sulfuric Vortex',
      'Each player loses 2 life.',
      { id: 'trigger-1', source: 'vortex-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(38);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(38);
  });

  it('routes gain-life target-player triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_gain_life_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Healing Salve',
      'Target player gains 3 life.',
      { id: 'trigger-1', source: 'salve-1', targets: [p2], targetPlayerId: p2 },
    );

    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(43);
  });

  it('routes each-opponent gain-life triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_gain_life_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Group Hug',
      'Each opponent gains 1 life.',
      { id: 'trigger-1', source: 'hug-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(41);
  });

  it('routes each-player gain-life triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_gain_life_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Team Heal',
      'Each player gains 2 life.',
      { id: 'trigger-1', source: 'heal-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(42);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(42);
  });

  it('routes lose-life target-player triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_lose_life_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Bump',
      'Target player loses 2 life.',
      { id: 'trigger-1', source: 'bump-1', targets: [p2], targetPlayerId: p2 },
    );

    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(38);
  });

  it('queues discard trigger steps through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_discard';
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
    const discardSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p2)
      .filter((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardSteps).toHaveLength(1);
  });

  it('routes create-token triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_create_token';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const battlefieldBefore = (game.state as any).battlefield?.length ?? 0;

    executeTriggerEffect(
      ctx,
      p1,
      'Smothering Tithe',
      'Create a Treasure token.',
      { id: 'trigger-1', source: 'tithe-1' },
    );

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Treasure' && perm?.controller === p1)).toBe(true);
  });

  it('routes damage-target-player triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_target_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Lightning Strike',
      'Deal 3 damage to target player.',
      { id: 'trigger-1', source: 'strike-1', targets: [p2], targetPlayerId: p2 },
    );

    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(37);
  });

  it('routes each-opponent damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_opponent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Guttersnipe',
      'Deal 2 damage to each opponent.',
      { id: 'trigger-1', source: 'guttersnipe-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(40);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(38);
  });

  it('routes each-player damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Coalhauler Swine',
      'Deal 1 damage to each player.',
      { id: 'trigger-1', source: 'swine-1' },
    );

    const p1After = (game.state as any).players.find((entry: any) => entry.id === p1);
    const p2After = (game.state as any).players.find((entry: any) => entry.id === p2);
    expect(p1After?.life ?? (game.state as any).life?.[p1]).toBe(39);
    expect(p2After?.life ?? (game.state as any).life?.[p2]).toBe(39);
  });

  it('routes creature-token triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_create_creature_token';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const battlefieldBefore = (game.state as any).battlefield?.length ?? 0;

    executeTriggerEffect(
      ctx,
      p1,
      'Recruit',
      'Create a 1/1 white Soldier creature token.',
      { id: 'trigger-1', source: 'recruit-1' },
    );

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) =>
      perm?.controller === p1
      && String(perm?.card?.name || '').includes('Soldier'),
    )).toBe(true);
  });

  it('routes any-target damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_any_target_damage';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Lightning Bolt',
      'Lightning Bolt deals 3 damage to any target.',
      { id: 'trigger-1', source: 'bolt-1', targets: ['c1'] },
    );

    const perm = (game.state as any).battlefield.find((p: any) => p?.id === 'c1');
    expect(perm?.damageMarked ?? perm?.damage ?? perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('routes damage-target triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [{
      id: 'c1',
      controller: p2,
      owner: p2,
      tapped: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'c1_card',
        name: 'Target Creature',
        type_line: 'Creature — Human',
        power: '1',
        toughness: '1',
        oracle_text: '',
      },
    }];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Shock',
      'Deal 3 damage to target creature.',
      { id: 'trigger-1', source: 'shock-1', targets: ['c1'] },
    );

    const perm = (game.state as any).battlefield.find((p: any) => p?.id === 'c1');
    expect(perm?.damageMarked ?? perm?.damage ?? perm?.damageThisTurn ?? perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('routes each-creature damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p1, 'Knight', 1, 2, 2);
    const creatureIds = (game.state as any).battlefield.map((perm: any) => perm.id);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Sweep',
      'Deal 1 damage to each creature.',
      { id: 'trigger-1', source: 'sweep-1' },
    );

    for (const creatureId of creatureIds) {
      const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
      expect(perm?.damageMarked ?? perm?.damage ?? perm?.damageThisTurn ?? perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('routes opponent-scoped damage-target triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_target_opponent_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);
    const p2CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Scoped Burn',
      'Deal 3 damage to target creature an opponent controls.',
      { id: 'trigger-1', source: 'burn-1', targets: [p2CreatureId] },
    );

    const p2Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p2CreatureId);
    expect(p2Perm?.damageMarked ?? p2Perm?.damage ?? p2Perm?.damageThisTurn ?? p2Perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('routes each-creature-you-control damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_you_control';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);
    const p1CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p1)?.id;
    const p2CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Self Sweep',
      'Deal 1 damage to each creature you control.',
      { id: 'trigger-1', source: 'sweep-1' },
    );

    const p1Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p1CreatureId);
    const p2Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p2CreatureId);
    expect(p1Perm?.damageMarked ?? p1Perm?.damage ?? p1Perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(1);
    expect(p2Perm?.damageMarked ?? p2Perm?.damage ?? p2Perm?.counters?.damage ?? 0).toBe(0);
  });

  it('routes each-opponent-creature damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_opponent_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);
    const p1CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p1)?.id;
    const p2CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Opp Sweep',
      'Deal 1 damage to each creature your opponents control.',
      { id: 'trigger-1', source: 'sweep-1' },
    );

    const p1Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p1CreatureId);
    const p2Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p2CreatureId);
    expect(p1Perm?.damageMarked ?? p1Perm?.damage ?? p1Perm?.counters?.damage ?? 0).toBe(0);
    expect(p2Perm?.damageMarked ?? p2Perm?.damage ?? p2Perm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('routes each-creature-and-planeswalker damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_creature_pw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    const creatureId = (game.state as any).battlefield[0]?.id;
    (game.state as any).battlefield.push({
      id: 'pw1',
      owner: p1,
      controller: p1,
      tapped: false,
      loyalty: 3,
      card: { id: 'jace', name: 'Jace', type_line: 'Planeswalker — Jace', oracle_text: '' },
    });

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Swelter',
      'Deal 1 damage to each creature and each planeswalker.',
      { id: 'trigger-1', source: 'swelter-1' },
    );

    const creaturePerm = (game.state as any).battlefield.find((perm: any) => perm?.id === creatureId);
    const pwPerm = (game.state as any).battlefield.find((perm: any) => perm?.id === 'pw1');
    expect(creaturePerm?.damageMarked ?? creaturePerm?.damage ?? creaturePerm?.counters?.damage ?? 0).toBeGreaterThanOrEqual(1);
    expect(pwPerm?.loyalty ?? pwPerm?.damageMarked ?? pwPerm?.damage ?? 0).toBeLessThanOrEqual(2);
  });

  it('routes planeswalker-only each damage triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_damage_each_planeswalker';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield.push({
      id: 'pw1',
      owner: p1,
      controller: p1,
      tapped: false,
      loyalty: 3,
      card: { id: 'jace', name: 'Jace', type_line: 'Planeswalker — Jace', oracle_text: '' },
    });

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test PW Burn',
      'Deal 1 damage to each planeswalker.',
      { id: 'trigger-1', source: 'pw-burn-1' },
    );

    const pwPerm = (game.state as any).battlefield.find((perm: any) => perm?.id === 'pw1');
    expect(pwPerm?.loyalty ?? pwPerm?.damageMarked ?? pwPerm?.damage ?? 0).toBeLessThanOrEqual(2);
  });

  it('routes destroy-all-creatures triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_destroy_all_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Wrath',
      'Destroy all creatures.',
      { id: 'trigger-1', source: 'wrath-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('routes destroy-each-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_destroy_each_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Each Wrath',
      'Destroy each creature.',
      { id: 'trigger-1', source: 'each-wrath-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('routes exile-target-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_exile_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Path to Exile',
      'Exile target creature.',
      {
        id: 'trigger-1',
        source: 'path-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const exile2 = (game.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('routes exile-all-creatures triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_exile_all_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Terminus',
      'Exile all creatures.',
      { id: 'trigger-1', source: 'terminus-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('routes exile-each-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_exile_each_creature';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'Soldier', 1, 1, 1);
    game.createToken!(p2, 'Knight', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Each Terminus',
      'Exile each creature.',
      { id: 'trigger-1', source: 'each-terminus-1' },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.card?.type_line?.includes('Creature'))).toBe(false);
  });

  it('routes opponent-scoped exile-all-creatures triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_exile_all_opponent_creatures';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.createToken!(p1, 'P1 Token', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);
    const p1CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p1)?.id;
    const p2CreatureId = (game.state as any).battlefield.find((perm: any) => perm?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Opp Terminus',
      'Exile all creatures your opponents control.',
      { id: 'trigger-1', source: 'opp-terminus-1' },
    );

    const p1Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p1CreatureId);
    const p2Perm = (game.state as any).battlefield.find((perm: any) => perm?.id === p2CreatureId);
    expect(p1Perm).toBeDefined();
    expect(p2Perm).toBeUndefined();
  });

  it('routes exile-target-nonland-permanent triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_exile_nonland';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'a1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'a1_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Oblivion Ring',
      'Exile target nonland permanent.',
      {
        id: 'trigger-1',
        source: 'ring-1',
        targets: ['a1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'a1')).toBe(false);
    const exile2 = (game.state as any).zones?.[p2]?.exile || [];
    expect(exile2.some((card: any) => card?.id === 'a1_card')).toBe(true);
  });

  it('routes bounce-target-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_bounce_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Unsummon',
      "Return target creature to its owner's hand.",
      {
        id: 'trigger-1',
        source: 'unsummon-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    expect((game.state as any).zones?.[p2]?.hand?.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('routes exile-target-player-graveyard triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_exile_graveyard';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);
    (game.state as any).zones[p2].graveyard = [
      { id: 'dead-1', name: 'Dead Card', zone: 'graveyard' },
    ];
    (game.state as any).zones[p2].graveyardCount = 1;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Bojuka Bog',
      "Exile all cards from target player's graveyard.",
      {
        id: 'trigger-1',
        source: 'bog-1',
        targets: [p2],
      },
    );

    expect(((game.state as any).zones?.[p2]?.graveyard || []).length).toBe(0);
    expect(((game.state as any).zones?.[p2]?.exile || []).some((card: any) => card?.id === 'dead-1')).toBe(true);
  });

  it('routes sacrifice-target-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_sacrifice_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Edict',
      'Sacrifice target creature.',
      {
        id: 'trigger-1',
        source: 'edict-1',
        targets: ['c1'],
      },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.id === 'c1')).toBe(false);
    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'c1_card')).toBe(true);
  });

  it('routes counter-target-spell triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_counter_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackBoltId = 'stack_bolt_trigger';

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    ensureZonesForPlayer(game, p1);
    ensureZonesForPlayer(game, p2);

    game.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackBoltId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [],
      },
    });

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Counterspell',
      'Counter target spell.',
      {
        id: 'trigger-1',
        source: 'counterspell-1',
        targets: [stackBoltId],
      },
    );

    expect((game.state as any).stack?.length || 0).toBe(0);
    const gy2 = (game.state as any).zones?.[p2]?.graveyard || [];
    expect(gy2.some((card: any) => card?.id === 'bolt_card')).toBe(true);
  });

  it('routes tap-target-creature triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_tap_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Twiddle',
      'Tap target creature.',
      {
        id: 'trigger-1',
        source: 'twiddle-1',
        targets: ['c1'],
      },
    );

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.tapped).toBe(true);
  });

  it('routes add-counters-target triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_add_counters_target';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p2,
        owner: p2,
        tapped: false,
        isToken: false,
        counters: {},
        card: {
          id: 'c1_card',
          name: 'Target Creature',
          type_line: 'Creature — Human',
          oracle_text: '',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Incubate',
      'Put a +1/+1 counter on target creature.',
      {
        id: 'trigger-1',
        source: 'incubate-1',
        targets: ['c1'],
      },
    );

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === 'c1');
    expect(perm?.counters?.['+1/+1']).toBe(1);
  });

  it('routes add-counters-each triggers through IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_add_counters_each';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    game.createToken!(p1, 'P1 Token A', 1, 1, 1);
    game.createToken!(p1, 'P1 Token B', 1, 1, 1);
    game.createToken!(p2, 'P2 Token', 1, 1, 1);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Collective Growth',
      'Put a +1/+1 counter on each creature you control.',
      {
        id: 'trigger-1',
        source: 'growth-1',
      },
    );

    const p1Creatures = (game.state as any).battlefield.filter((entry: any) => entry?.controller === p1);
    const p2Creature = (game.state as any).battlefield.find((entry: any) => entry?.controller === p2);
    expect(p1Creatures.length).toBe(2);
    expect(p1Creatures.every((entry: any) => entry?.counters?.['+1/+1'] === 1)).toBe(true);
    expect(p2Creature?.counters?.['+1/+1']).toBeUndefined();
  });

  it('queues each-player scry steps under production default without legacy duplicates', () => {
    const gameId = 'oracle_ir_default_trigger_scry_each_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    setupPlayerLibrary(game, p1, ['p1-lib-1', 'p1-lib-2']);
    setupPlayerLibrary(game, p2, ['p2-lib-1', 'p2-lib-2']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Test Scry Each',
      'Each player scries 1.',
      { id: 'trigger-scry-each-player', source: 'scry-1' },
    );

    const scrySteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .concat(ResolutionQueueManager.getStepsForPlayer(gameId, p2))
      .filter((step) => step.type === ResolutionStepType.SCRY);
    expect(scrySteps).toHaveLength(2);
    expect((game.state as any).pendingScry).toBeUndefined();
  });

  it('creates a Clue token via IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_investigate';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ctx = game as any;
    ctx.gameId = gameId;

    const battlefieldBefore = (game.state as any).battlefield?.length ?? 0;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Investigate',
      'Investigate.',
      { id: 'trigger-investigate', source: 'clue-1' },
    );

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore + 1);
    expect(battlefield.some((perm: any) => perm?.card?.name === 'Clue')).toBe(true);
  });

  it('goads target creature via IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_goad';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    game.createToken!(p2, 'P2 Creature', 1, 2, 2);
    const creatureId = (game.state as any).battlefield.find((entry: any) => entry?.controller === p2)?.id;

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Disrupt Decorum',
      'Goad target creature.',
      { id: 'trigger-goad', source: 'decor-1', targets: [creatureId] },
    );

    const perm = (game.state as any).battlefield.find((entry: any) => entry?.id === creatureId);
    expect(Array.isArray(perm?.goadedBy) ? perm.goadedBy.includes(p1) : false).toBe(true);
  });

  it('destroys all creatures target player controls via IR primary under production default', () => {
    const gameId = 'oracle_ir_default_trigger_destroy_all_target_player';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    game.createToken!(p1, 'P1 Creature', 1, 2, 2);
    game.createToken!(p2, 'P2 Creature', 1, 2, 2);

    const ctx = game as any;
    ctx.gameId = gameId;

    executeTriggerEffect(
      ctx,
      p1,
      'Test Target Wrath',
      'Destroy all creatures target player controls.',
      { id: 'trigger-destroy-all-target', source: 'wrath-1', targets: [p2] },
    );

    expect((game.state as any).battlefield.some((perm: any) => perm?.controller === p2)).toBe(false);
    expect((game.state as any).battlefield.some((perm: any) => perm?.controller === p1)).toBe(true);
  });
});
