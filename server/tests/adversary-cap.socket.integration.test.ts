import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';
import '../src/state/modules/priority.js';

const noopIo = { to: () => ({ emit: () => {} }), emit: () => {} } as any;
function mockSocket(playerId: string, emitted: any[]) {
  const handlers: Record<string, Function> = {};
  const socket = { data: { playerId, spectator: false }, rooms: new Set<string>(), on: (e: string, h: Function) => { handlers[e] = h; }, emit: (event: string, payload: any) => emitted.push({ event, payload }) } as any;
  return { socket, handlers };
}

describe('Adversary "up to N times" cap (socket)', () => {
  const gameId = 'test_adversary_cap_socket';
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo); await new Promise((r) => setTimeout(r, 0)); });
  beforeEach(async () => { await resetIntegrationGame(gameId); });
  afterEach(async () => { await resetIntegrationGame(gameId); });

  async function setup() {
    createGameIfNotExists(gameId, 'commander', 40);
    const game: any = ensureGame(gameId);
    const s = game.state;
    s.players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
    s.turnPlayer = 'p1'; s.priority = 'p1';
    s.manaPool = { p1: { white: 0, blue: 0, black: 0, red: 4, green: 0, colorless: 0 }, p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    s.battlefield = [{ id: 'adv1', controller: 'p1', owner: 'p1', tapped: false, counters: {}, basePower: 2, baseToughness: 2,
      card: { id: 'adv1_c', name: 'Capped Adversary', type_line: 'Creature - Spirit', zone: 'battlefield', power: '2', toughness: '2',
        oracle_text: 'When this creature dies, you may pay {R} up to two times. When you pay this cost one or more times, it deals that much damage to any target.' } }];
    const z = () => ({ hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 });
    s.zones = { p1: z(), p2: z() };
    expect(movePermanentToGraveyard(game, 'adv1')).toBe(true);
    game.resolveTopOfStack();
    const step: any = ResolutionQueueManager.getQueue(gameId).steps.find((x: any) => x?.reflexiveManaPaymentChoice === true);
    expect(step).toBeDefined();
    const emitted: any[] = [];
    const { socket, handlers } = mockSocket('p1', emitted);
    socket.rooms.add(gameId);
    registerResolutionHandlers({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s0', socket]]) } } as any, socket);
    return { game, step, emitted, handlers };
  }

  it('offers at most N payments even with more mana available', async () => {
    const { step } = await setup();
    expect(step.reflexiveManaPaymentMaxTimes).toBe(2);
    expect(step.options.map((o: any) => o.id).filter((id: string) => id.startsWith('pay_'))).toEqual(['pay_1', 'pay_2']);
  });

  it('rejects a submitted amount above the cap and keeps the mana', async () => {
    const { game, step, emitted, handlers } = await setup();
    step.options = [...step.options, { id: 'pay_3', label: 'Pay 3' }];
    await handlers.submitResolutionResponse({ gameId, stepId: step.id, selections: 'pay_3' });
    expect(game.state.manaPool.p1.red).toBe(4);
    expect(emitted.some((e) => e.event === 'error' && /at most 2/.test(String(e.payload?.message || '')))).toBe(true);
  });

  it('accepts a payment at the cap', async () => {
    const { game, step, handlers } = await setup();
    await handlers.submitResolutionResponse({ gameId, stepId: step.id, selections: 'pay_2' });
    expect(game.state.manaPool.p1.red).toBe(2);
  });
});
