import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { processAttractionVisitRollAtPrecombatMain } from '../src/state/modules/triggers/attraction-visit.js';
import { queueFreshDieRollTriggers } from '../src/state/modules/triggers/playLandSaddleDieRollHooks.js';
import { maybeQueueDiceExchangeFromLastDieRoll } from '../src/state/modules/diceExchangeBasePTPrompt.js';

const SQUIRREL = "As this creature enters, roll a six-sided die twice. Its base power becomes the first result and its base toughness becomes the second result.\nIf you would roll one or more six-sided dice, instead roll them and you may exchange one result with this creature's base power or base toughness.";

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function putWhacker(game: any, p1: string) {
  (game.state as any).battlefield = (game.state as any).battlefield || [];
  (game.state as any).battlefield.push({
    id: 'whacker_1',
    controller: p1,
    owner: p1,
    basePower: 2,
    baseToughness: 3,
    card: {
      name: 'Vedalken Squirrel-Whacker',
      type_line: 'Creature — Vedalken Guest',
      oracle_text: SQUIRREL,
      power: '2',
      toughness: '3',
    },
  });
}

function exchangeStep(gameId: string) {
  return ResolutionQueueManager.getQueue(gameId).steps.find((queued: any) => queued?.diceExchangeBasePT === true) as any;
}

describe('dice exchange hook on remaining die-roll paths', () => {
  const gameId = 'test_dice_exchange_remaining_roll_paths';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('queues the exchange prompt after an attraction visit roll', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game as any).gameId = gameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    putWhacker(game, p1);
    (game.state as any).battlefield.push({
      id: 'attraction_1',
      controller: p1,
      owner: p1,
      card: {
        name: 'Balloon Stand',
        type_line: 'Artifact — Attraction',
        oracle_text: 'Visit — Create a 1/1 red Guest creature token.\nThe numbers 2, 4, and 6 are lit up on this Attraction.',
        litUpNumbers: [2, 4, 6],
      },
    });
    (game as any).rng = () => 0.99;

    const result = processAttractionVisitRollAtPrecombatMain(game as any, p1 as any);
    expect(result).toBeTruthy();
    expect(Number((game.state as any).lastDieRoll?.result)).toBeGreaterThanOrEqual(1);
    expect(Number((game.state as any).lastDieRoll?.sides)).toBe(6);
    const step = exchangeStep(gameId);
    expect(step).toBeDefined();
    expect(step.type).toBe('option_choice');
  });

  it('queues the exchange prompt from queueFreshDieRollTriggers after lastDieRoll is recorded', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game as any).gameId = gameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    putWhacker(game, p1);
    const timestamp = Date.now();
    (game.state as any).lastDieRoll = { playerId: p1, sides: 6, result: 5, timestamp };
    (game.state as any).lastDieRollByPlayer = { [p1]: { sides: 6, result: 5, timestamp } };

    const queued = queueFreshDieRollTriggers(game as any, p1);
    expect(Array.isArray(queued)).toBe(true);
    const step = exchangeStep(gameId);
    expect(step).toBeDefined();
    expect(Number(step.dieResult)).toBe(5);
  });

  it('does not queue a second exchange prompt for the same recorded roll (forced-path reruns)', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game as any).gameId = gameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    putWhacker(game, p1);
    const timestamp = Date.now();
    (game.state as any).lastDieRoll = { playerId: p1, sides: 6, result: 4, timestamp };
    (game.state as any).lastDieRollByPlayer = { [p1]: { sides: 6, result: 4, timestamp } };

    expect(maybeQueueDiceExchangeFromLastDieRoll(game as any, game.state)).toBe(true);
    expect(maybeQueueDiceExchangeFromLastDieRoll(game as any, game.state)).toBe(false);
    const steps = ResolutionQueueManager.getQueue(gameId).steps.filter((queued: any) => queued?.diceExchangeBasePT === true);
    expect(steps).toHaveLength(1);
  });
});
