import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const noopIo = () => ({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any);

function mockSocket(playerId: string, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = { data: { playerId, gameId, spectator: false }, rooms: new Set([gameId]), on: (e: string, h: Function) => { handlers[e] = h; }, emit: () => {} } as any;
  const io = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s_0', socket]]) } } as any;
  return { socket, handlers, io };
}

async function reset(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function setup(gameId: string, hand: any[]) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  const s: any = game.state;
  s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }];
  s.life = { p1: 40 }; s.startingLife = 40; s.phase = 'beginning'; s.step = 'UPKEEP'; s.turnNumber = 2;
  s.turnPlayer = 'p1'; s.activePlayer = 'p1'; s.priority = 'p1'; s.stack = [];
  s.zones = { p1: { hand, handCount: hand.length, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } };
  s.battlefield = [{
    id: 'imp', controller: 'p1', owner: 'p1', tapped: false, enteredThisTurn: true, counters: {}, basePower: 2, baseToughness: 2,
    card: { id: 'imp_card', name: 'Deepcavern Imp', type_line: 'Creature - Imp Rebel', oracle_text: 'Flying, haste\nEcho\u2014Discard a card.', power: '2', toughness: '2' },
  }];
  const trig = getUpkeepTriggersForPlayer(game as any, 'p1').find((t: any) => t?.triggerType === 'echo');
  expect(trig).toBeDefined();
  expect(String(trig?.description)).toBe('Discard a card or sacrifice');
  s.stack.push({ id: 't1', type: 'triggered_ability', controller: 'p1', source: 'imp', permanentId: 'imp', sourceName: 'Deepcavern Imp',
    description: String(trig?.description), effect: String(trig?.description), triggerType: 'echo', mandatory: false });
  game.resolveTopOfStack();
  const payStep: any = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st?.optionalPaymentPrompt === true);
  expect(payStep).toBeDefined();
  return { game, payStep };
}

describe('B40 Echo\u2014Discard a card', () => {
  const gameId = 'test_b40_echo_discard';
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo()); await new Promise((r) => setTimeout(r, 0)); });
  beforeEach(async () => { await reset(gameId); });
  afterEach(async () => { await reset(gameId); });

  it('paying queues a discard and keeps the permanent', async () => {
    const { game, payStep } = setup(gameId, [{ id: 'h1', name: 'Opt', type_line: 'Instant', zone: 'hand' }]);
    const { socket, handlers, io } = mockSocket('p1', gameId);
    registerResolutionHandlers(io, socket);
    await handlers.submitResolutionResponse({ gameId, stepId: String(payStep.id), selections: 'pay_echo' });
    const imp = (game.state as any).battlefield.find((p: any) => p.id === 'imp');
    expect(imp?.echoPaid).toBe(true);
    const discard: any = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st?.echoDiscardCost === true);
    expect(discard?.type).toBe('discard_selection');
  });

  it('declining sacrifices the permanent', async () => {
    const { game, payStep } = setup(gameId, []);
    const { socket, handlers, io } = mockSocket('p1', gameId);
    registerResolutionHandlers(io, socket);
    await handlers.submitResolutionResponse({ gameId, stepId: String(payStep.id), selections: 'decline' });
    expect((game.state as any).battlefield.find((p: any) => p.id === 'imp')).toBeUndefined();
  });
});
