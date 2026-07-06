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
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

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

  it('Swords to Plowshares on a commander queues command-zone choice and grants life', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'oracle_ir_swords_commander';
    const game = createInitialGameState(gameId);
    const caster = 'p1' as PlayerID;
    const owner = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: caster, name: 'Caster' } as any);
    game.applyEvent!({ type: 'join', playerId: owner, name: 'Owner' } as any);

    (game.state as any).players = [
      { id: caster, name: 'Caster', spectator: false, life: 40 },
      { id: owner, name: 'Owner', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [caster]: 40, [owner]: 40 };
    (game.state as any).zones = {
      [caster]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [owner]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
        commandZone: [],
        commandZoneCount: 0,
      },
    };
    (game.state as any).commandZone = {
      [owner]: {
        commanderIds: ['myrel_card'],
        commanderNames: ['Myrel, Shield of Argive'],
        inCommandZone: [],
      },
    };
    (game as any).commandZone = (game.state as any).commandZone;
    (game.state as any).battlefield = [
      {
        id: 'myrel_perm',
        controller: owner,
        owner,
        isCommander: true,
        tapped: false,
        counters: {},
        effectivePower: 3,
        card: {
          id: 'myrel_card',
          name: 'Myrel, Shield of Argive',
          type_line: 'Legendary Creature — Human Soldier',
          oracle_text: '',
          power: '3',
          toughness: '4',
          zone: 'battlefield',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: caster,
      spellName: 'Swords to Plowshares',
      oracleText: 'Exile target creature. Its controller gains life equal to its power.',
      sourceId: 'swords-1',
      targets: ['myrel_perm'],
    });

    expect(outcome.handled).toBe(true);
    expect((game.state as any).life[owner]).toBe(43);

    const commanderChoice = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step?.type === ResolutionStepType.OPTION_CHOICE && step?.commanderZoneChoice === true,
    );
    expect(commanderChoice).toBeDefined();
    expect(String((commanderChoice as any)?.playerId || '')).toBe(owner);
    expect(((game.state as any).zones?.[owner]?.exile || [])).toHaveLength(0);
    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual([]);
  });
});
