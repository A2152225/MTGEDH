import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';
import { getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}


describe('Magnetic Mountain paid untap (integration)', () => {
  const gameId = 'test_magnetic_mountain_paid_untap';
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(createNoopIo() as any); });
  afterEach(async () => { await resetGame(gameId); });
  it('upkeep player picks tapped blue creatures, pays {4} each, and they untap', async () => {
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game: any = ensureGame(gameId);
    const s: any = game.state;
    s.players = [{ id: 'p1', name: 'P1', life: 40 }, { id: 'p2', name: 'P2', life: 40 }];
    s.life = { p1: 40, p2: 40 }; s.phase = 'beginning'; s.step = 'UPKEEP'; s.turnPlayer = 'p1'; s.activePlayer = 'p1'; s.priority = 'p1'; s.stack = [];
    s.manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 }, p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
    s.zones = { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } };
    s.battlefield = [
      { id: 'mm', controller: 'p2', owner: 'p2', tapped: false, counters: {}, card: { id: 'mmc', name: 'Magnetic Mountain', type_line: 'Enchantment', colors: ['R'], oracle_text: "Blue creatures don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures." } },
      { id: 'b1', controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { id: 'b1c', name: 'Merfolk', type_line: 'Creature - Merfolk', colors: ['U'], power: '1', toughness: '1' } },
      { id: 'b2', controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { id: 'b2c', name: 'Merfolk Two', type_line: 'Creature - Merfolk', colors: ['U'], power: '1', toughness: '1' } },
      { id: 'g1', controller: 'p1', owner: 'p1', tapped: true, counters: {}, card: { id: 'g1c', name: 'Elf', type_line: 'Creature - Elf', colors: ['G'], power: '1', toughness: '1' } },
    ];
    const emitted: any[] = []; const { socket, handlers } = createMockSocket('p1', gameId, emitted); registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);
    const t = getUpkeepTriggersForPlayer(game as any, 'p1').find((x: any) => x.cardName === 'Magnetic Mountain');
    expect(t).toBeDefined();
    s.stack.push({ id: 'mmt', type: 'triggered_ability', controller: (t as any).controllerId || 'p2', source: 'mm', permanentId: 'mm', sourceName: 'Magnetic Mountain', description: String((t as any).effect || (t as any).description), effect: String((t as any).effect || (t as any).description), triggerType: (t as any).triggerType || 'upkeep', mandatory: (t as any).mandatory });
    game.resolveTopOfStack();
    const step: any = ResolutionQueueManager.getQueue(gameId).steps.find((x: any) => x.upkeepPaidUntapSelection === true);
    expect(step).toBeDefined();
    expect(step.type).toBe('target_selection');
    expect(step.playerId).toBe('p1');
    expect(step.minTargets).toBe(0);
    expect(step.maxTargets).toBe(1); // only {4} available
    expect(step.validTargets.map((v: any) => v.id).sort()).toEqual(['b1', 'b2']);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(step.id), selections: ['b2'] });
    const bf = s.battlefield;
    expect(bf.find((p: any) => p.id === 'b2').tapped).toBe(false);
    expect(bf.find((p: any) => p.id === 'b1').tapped).toBe(true);
    expect(bf.find((p: any) => p.id === 'g1').tapped).toBe(true);
    expect(s.manaPool.p1.colorless).toBe(0);
    const ev = getEvents(gameId).filter((e: any) => e.type === 'upkeepPaidUntapResolve');
    expect(ev.length).toBe(1);
    const payload = (ev[0] as any).payload;
    expect(payload.untapped).toEqual(['b2']);
    expect(payload.paymentManaDelta).toEqual({ colorless: -4 });
    // Replay: rewind the payment and re-apply the persisted event.
    bf.find((p: any) => p.id === 'b2').tapped = true;
    s.manaPool.p1.colorless = 4;
    applyEvent({ state: s, bumpSeq: () => undefined } as any, { type: 'upkeepPaidUntapResolve', ...payload } as any);
    expect(bf.find((p: any) => p.id === 'b2').tapped).toBe(false);
    expect(s.manaPool.p1.colorless).toBe(0);
  });
});
