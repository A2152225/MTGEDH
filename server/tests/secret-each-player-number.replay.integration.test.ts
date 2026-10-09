/**
 * Replay contract for the Wheel of Misfortune "each player secretly chooses a number"
 * family: `secretEachPlayerNumberChoiceResolve` must clear the resolved prompt and
 * record the choice; `secretEachPlayerNumberBatchResolve` must clear every remaining
 * prompt for the batch, apply damage/wheel outcomes, and drop the batch record.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { queueSecretEachPlayerNumberPrompts } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerSecretEachPlayerNumberPrompts.js';

// Quoted from Wheel of Misfortune oracle.
const WHEEL =
  "Each player secretly chooses a number 0 or greater, then all players reveal those numbers simultaneously and determine the highest and lowest numbers revealed this way. Wheel of Misfortune deals damage equal to the highest number to each player who chose that number. Each player who didn't choose the lowest number discards their hand, then draws seven cards.";

describe('secret each-player number replay', () => {
  let ctx: GameContext | null = null;

  afterEach(() => {
    if (ctx) ResolutionQueueManager.removeQueue(ctx.gameId);
    ctx = null;
  });

  it('choice events clear their prompt and the batch event applies the reveal', () => {
    ctx = wheelCtx();
    const gameId = ctx.gameId;
    queueSecretEachPlayerNumberPrompts(ctx, {
      controller: 'p1' as PlayerID,
      card: { id: 'wheel_1', name: 'Wheel of Misfortune' },
      effectiveCard: { name: 'Wheel of Misfortune', oracle_text: WHEEL },
      item: { id: 'wheel_1' },
      gameId,
      minNumber: 0,
      drawCount: 7,
    });

    const steps = ResolutionQueueManager.getQueue(gameId).steps as any[];
    expect(steps.map((step) => step.type)).toEqual([
      ResolutionStepType.X_VALUE_SELECTION,
      ResolutionStepType.X_VALUE_SELECTION,
      ResolutionStepType.X_VALUE_SELECTION,
    ]);
    const byPlayer = Object.fromEntries(steps.map((step) => [String(step.playerId), step]));
    const batchId = String(byPlayer.p1.secretEachPlayerNumberBatchId || '');
    expect(batchId).not.toBe('');
    const expectedPlayerIds = ['p1', 'p2', 'p3'];

    const choiceEvent = (playerId: string, number: number) => ({
      type: 'secretEachPlayerNumberChoiceResolve',
      playerId,
      batchId,
      resolvedStepId: String(byPlayer[playerId].id),
      sourceId: 'wheel_1',
      sourceName: 'Wheel of Misfortune',
      number,
      drawCount: 7,
      minNumber: 0,
      expectedPlayerIds,
    });

    applyEvent(ctx, choiceEvent('p1', 3) as any);
    expect(ResolutionQueueManager.getQueue(gameId).steps.map((step: any) => String(step.playerId))).toEqual(['p2', 'p3']);
    expect((ctx.state as any).secretEachPlayerNumberBatches?.[batchId]?.choices).toEqual({ p1: 3 });
    // Nothing is revealed or applied until the batch resolves.
    expect((ctx.state as any).life).toMatchObject({ p1: 40, p2: 40, p3: 40 });

    applyEvent(ctx, choiceEvent('p2', 5) as any);
    applyEvent(ctx, choiceEvent('p3', 5) as any);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    expect((ctx.state as any).secretEachPlayerNumberBatches?.[batchId]?.choices).toEqual({ p1: 3, p2: 5, p3: 5 });

    applyEvent(ctx, {
      type: 'secretEachPlayerNumberBatchResolve',
      batchId,
      sourceId: 'wheel_1',
      sourceName: 'Wheel of Misfortune',
      expectedPlayerIds,
      drawCount: 7,
      choices: { p1: 3, p2: 5, p3: 5 },
    } as any);

    // Highest (5) damages p2 and p3; p1 chose the lowest and keeps their hand.
    expect((ctx.state as any).life).toMatchObject({ p1: 40, p2: 35, p3: 35 });
    expect(handIds(ctx, 'p1')).toEqual(['p1_keep']);
    expect(handIds(ctx, 'p2')).toHaveLength(7);
    expect(graveyardIds(ctx, 'p2')).toContain('p2_keep');
    expect(handIds(ctx, 'p3')).toHaveLength(7);
    expect((ctx.state as any).secretEachPlayerNumberBatches).toBeUndefined();
  });

  it('batch event clears prompts that were still queued for the batch', () => {
    ctx = wheelCtx();
    const gameId = ctx.gameId;
    queueSecretEachPlayerNumberPrompts(ctx, {
      controller: 'p1' as PlayerID,
      card: { id: 'wheel_1', name: 'Wheel of Misfortune' },
      effectiveCard: { name: 'Wheel of Misfortune', oracle_text: WHEEL },
      item: { id: 'wheel_1' },
      gameId,
      minNumber: 0,
      drawCount: 7,
    });
    const steps = ResolutionQueueManager.getQueue(gameId).steps as any[];
    const batchId = String(steps[0].secretEachPlayerNumberBatchId || '');
    expect(steps).toHaveLength(3);

    applyEvent(ctx, {
      type: 'secretEachPlayerNumberBatchResolve',
      batchId,
      sourceId: 'wheel_1',
      sourceName: 'Wheel of Misfortune',
      expectedPlayerIds: ['p1', 'p2', 'p3'],
      drawCount: 7,
      choices: { p1: 2, p2: 2, p3: 2 },
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    // Everyone tied: everyone takes 2, nobody wheels.
    expect((ctx.state as any).life).toMatchObject({ p1: 38, p2: 38, p3: 38 });
    expect(handIds(ctx, 'p1')).toEqual(['p1_keep']);
    expect(handIds(ctx, 'p3')).toEqual(['p3_keep']);
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
  const ctx = createContext(`wheel_replay_${Math.random().toString(36).slice(2, 8)}`);
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
    players: players.map((id) => ({ id, name: id.toUpperCase(), life: 40, hasLost: false })),
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
