import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { queueSecretEachPlayerNumberPrompts } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerSecretEachPlayerNumberPrompts.js';
import { applySecretEachPlayerNumberBatchResult } from '../src/state/modules/secretEachPlayerNumberBatch.js';
import { handleSecretEachPlayerNumberChoiceResponse } from '../src/socket/resolutionSecretEachPlayerNumberResponseHandlers.js';

// Quoted from Wheel of Misfortune oracle.
const WHEEL =
  "Each player secretly chooses a number 0 or greater, then all players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way. Wheel of Misfortune deals damage equal to the highest number to each player who chose that number. Each player who didn't choose the lowest number discards their hand, then draws seven cards.";

describe('Wheel of Misfortune secret number', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  it('collects one secret number step for every player, not a caster-only draw', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const steps = collectSpellResolutionEffectSteps(WHEEL, 'Wheel of Misfortune');
    expect(steps.map((step) => step.kind)).toEqual(['secret_each_player_number']);
    expect(steps[0]).toMatchObject({
      secret: true,
      minNumber: 0,
      drawCount: 7,
      choosers: { kind: 'each_player' },
    });
  });

  it('damages only the highest choice and wheels everyone who did not choose the lowest', () => {
    const ctx = wheelCtx();
    const result = applySecretEachPlayerNumberBatchResult(ctx, {
      expectedPlayerIds: ['p1', 'p2', 'p3'],
      choices: { p1: 3, p2: 5, p3: 5 },
      drawCount: 7,
    });
    expect(result.damageByPlayerId).toEqual({ p2: 5, p3: 5 });
    expect(result.wheeledPlayerIds).toEqual(['p2', 'p3']);
    expect((ctx.state as any).life).toMatchObject({ p1: 40, p2: 35, p3: 35 });
    expect(handIds(ctx, 'p1')).toEqual(['p1_keep']);
    expect(handIds(ctx, 'p2')).toHaveLength(7);
    expect(graveyardIds(ctx, 'p2')).toContain('p2_keep');
    expect(handIds(ctx, 'p3')).toHaveLength(7);
  });

  it('deals the tied number and does not wheel when every player chooses the same number', () => {
    const ctx = wheelCtx();
    const result = applySecretEachPlayerNumberBatchResult(ctx, {
      expectedPlayerIds: ['p1', 'p2', 'p3'],
      choices: { p1: 2, p2: 2, p3: 2 },
      drawCount: 7,
    });
    expect(result.damageByPlayerId).toEqual({ p1: 2, p2: 2, p3: 2 });
    expect(result.wheeledPlayerIds).toEqual([]);
    expect(handIds(ctx, 'p1')).toEqual(['p1_keep']);
    expect((ctx.state as any).life.p1).toBe(38);
  });

  it('queues a secret number prompt for every player, including the caster', () => {
    const ctx = wheelCtx();
    queueSecretEachPlayerNumberPrompts(ctx, {
      controller: 'p1' as PlayerID,
      card: { id: 'wheel_1', name: 'Wheel of Misfortune' },
      effectiveCard: { name: 'Wheel of Misfortune', oracle_text: WHEEL },
      item: { id: 'wheel_1' },
      gameId: ctx.gameId,
      minNumber: 0,
      drawCount: 7,
    });
    const steps = ResolutionQueueManager.getQueue(ctx.gameId).steps;
    expect(steps.map((step: any) => step.type)).toEqual([
      ResolutionStepType.X_VALUE_SELECTION,
      ResolutionStepType.X_VALUE_SELECTION,
      ResolutionStepType.X_VALUE_SELECTION,
    ]);
    expect(steps.map((step: any) => String(step.playerId))).toEqual(['p1', 'p2', 'p3']);
    expect(steps.every((step: any) => step.secretEachPlayerNumberChoice === true)).toBe(true);
    expect(steps.every((step: any) => step.minValue === 0 && step.maxValue === 999)).toBe(true);
    ResolutionQueueManager.clearAllSteps(ctx.gameId);
  });

  it('reveals numbers only after every player has chosen', async () => {
    const ctx = wheelCtx();
    const chats: string[] = [];
    const io = {
      to: () => ({
        emit: (_event: string, payload: any) => {
          if (payload?.message) chats.push(String(payload.message));
        },
      }),
    };
    const game = { state: ctx.state, libraries: ctx.libraries, bumpSeq: () => {}, seq: 1 };
    const step = {
      id: 'step_1',
      type: ResolutionStepType.X_VALUE_SELECTION,
      playerId: 'p1',
      sourceId: 'wheel_1',
      sourceName: 'Wheel of Misfortune',
      secretEachPlayerNumberChoice: true,
      secretEachPlayerNumberBatchId: 'wheel_1:secret_each_player_number',
      secretEachPlayerNumberExpectedPlayerIds: ['p1', 'p2', 'p3'],
      secretEachPlayerNumberSourceName: 'Wheel of Misfortune',
      secretEachPlayerNumberDrawCount: 7,
      secretEachPlayerNumberMin: 0,
      minValue: 0,
      maxValue: 999,
    };
    await handleSecretEachPlayerNumberChoiceResponse(io as any, game, ctx.gameId, { ...step, playerId: 'p1' } as any, {
      playerId: 'p1' as PlayerID,
      selections: 1,
    } as any);
    expect(chats.some((line) => line.includes('secret choice'))).toBe(true);
    expect(chats.some((line) => line.includes('revealed'))).toBe(false);
    expect((ctx.state as any).life.p2).toBe(40);

    await handleSecretEachPlayerNumberChoiceResponse(io as any, game, ctx.gameId, { ...step, playerId: 'p2' } as any, {
      playerId: 'p2' as PlayerID,
      selections: { xValue: 4 },
    } as any);
    await handleSecretEachPlayerNumberChoiceResponse(io as any, game, ctx.gameId, { ...step, playerId: 'p3' } as any, {
      playerId: 'p3' as PlayerID,
      selections: '4',
    } as any);

    expect(chats.some((line) => line.includes('P1: 1') && line.includes('P2: 4') && line.includes('P3: 4'))).toBe(true);
    expect((ctx.state as any).life).toMatchObject({ p1: 40, p2: 36, p3: 36 });
    expect(handIds(ctx, 'p1')).toEqual(['p1_keep']);
    expect(handIds(ctx, 'p2')).toHaveLength(7);
  });
});

function handIds(ctx: GameContext, playerId: string): string[] {
  return (((ctx.state as any).zones?.[playerId]?.hand) || []).map((card: any) => card.id);
}

function graveyardIds(ctx: GameContext, playerId: string): string[] {
  return (((ctx.state as any).zones?.[playerId]?.graveyard) || []).map((card: any) => card.id);
}

function library(prefix: string) {
  return Array.from({ length: 7 }, (_, index) => ({
    id: `${prefix}_lib_${index}`,
    name: `${prefix} Card ${index}`,
    type_line: 'Instant',
  }));
}

function wheelCtx(): GameContext {
  const ctx = createContext(`wheel_${Math.random().toString(36).slice(2, 8)}`);
  const players = ['p1', 'p2', 'p3'] as PlayerID[];
  const zones: Record<string, any> = {};
  for (const playerId of players) {
    const cards = library(playerId);
    ctx.libraries.set(playerId, cards.map((card) => ({ ...card })));
    zones[playerId] = {
      hand: [{ id: `${playerId}_keep`, name: `${playerId} Hand Card`, type_line: 'Creature' }],
      graveyard: [],
      library: cards.map((card) => ({ ...card })),
    };
  }
  (ctx as any).state = {
    ...(ctx.state as any),
    players: players.map((id) => ({ id, name: id === 'p1' ? 'P1' : id === 'p2' ? 'P2' : 'P3', life: 40, hasLost: false })),
    life: { p1: 40, p2: 40, p3: 40 },
    startingLife: 40,
    zones,
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
  };
  ctx.life = { p1: 40, p2: 40, p3: 40 };
  return ctx;
}
