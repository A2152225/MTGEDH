import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Attack trigger mana payment via Resolution Queue (integration)', () => {
  const gameId = 'test_attack_trigger_mana_payment_resolution_queue';

  beforeAll(async () => {
    await initDb();

    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('enqueues an OPTION_CHOICE step and executes transform on pay', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    // Declare attackers validation requirements.
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';

    // Enough mana to pay {1}{G}.
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    // Minimal Casal-like DFC that matches the generic "you may pay {..}. If you do, transform" regex.
    (game.state as any).battlefield = [
      {
        id: 'casal_1',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Casal, Lurkwood Pathfinder',
          type_line: 'Legendary Creature — Human',
          oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
          image_uris: { small: 'https://example.com/casal-front.jpg' },
          card_faces: [
            {
              name: 'Casal, Lurkwood Pathfinder',
              type_line: 'Legendary Creature — Human',
              oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
              power: '2',
              toughness: '2',
              mana_cost: '{2}{G}',
              colors: ['G'],
            },
            {
              name: 'Casal, Pathbreaker Owlbear',
              type_line: 'Legendary Creature — Bear',
              oracle_text: 'Trample',
              power: '4',
              toughness: '4',
              mana_cost: '',
              colors: ['G'],
            },
          ],
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    expect(typeof handlers['declareAttackers']).toBe('function');

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'casal_1', targetPlayerId: p2 }],
    });

    // Should be Resolution Queue based.
    expect(emitted.some(e => e.event === 'attackTriggerManaPaymentPrompt')).toBe(false);
    expect(emitted.some(e => e.event === 'resolutionStepPrompt')).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(step).toBeDefined();
    expect((step as any).attackTriggerManaPaymentChoice).toBe(true);

    // Pay the mana and transform.
    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({ gameId, stepId: (step as any).id, selections: 'pay_mana' });

    const perm = (game.state as any).battlefield.find((p: any) => p.id === 'casal_1');
    expect(perm).toBeDefined();
    expect(Boolean((perm as any).transformed)).toBe(true);
    expect(String((perm as any).card?.name || '').toLowerCase()).toContain('pathbreaker');

    // Mana should be consumed.
    expect((game.state as any).manaPool[p1].green + (game.state as any).manaPool[p1].colorless).toBe(0);
  });

  it('does not consume the step on insufficient mana for pay selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';

    // Not enough mana to pay {1}{G}.
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };

    (game.state as any).battlefield = [
      {
        id: 'casal_1',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Casal, Lurkwood Pathfinder',
          type_line: 'Legendary Creature — Human',
          oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
          image_uris: { small: 'https://example.com/casal-front.jpg' },
          card_faces: [
            {
              name: 'Casal, Lurkwood Pathfinder',
              type_line: 'Legendary Creature — Human',
              oracle_text: 'Whenever Casal, Lurkwood Pathfinder attacks, you may pay {1}{G}. If you do, transform her.',
              power: '2',
              toughness: '2',
              mana_cost: '{2}{G}',
              colors: ['G'],
            },
            {
              name: 'Casal, Pathbreaker Owlbear',
              type_line: 'Legendary Creature — Bear',
              oracle_text: 'Trample',
              power: '4',
              toughness: '4',
              mana_cost: '',
              colors: ['G'],
            },
          ],
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'casal_1', targetPlayerId: p2 }],
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(step).toBeDefined();
    expect((step as any).attackTriggerManaPaymentChoice).toBe(true);

    const stepId = String((step as any).id);

    // Attempt to pay without mana.
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 'pay_mana' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INSUFFICIENT_MANA');

    // Step should still be pending (not consumed).
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    const stillThere = queueAfter.steps.find((s: any) => String(s.id) === stepId);
    expect(stillThere).toBeDefined();

    // Permanent should not have transformed.
    const perm = (game.state as any).battlefield.find((p: any) => p.id === 'casal_1');
    expect(Boolean((perm as any).transformed)).toBe(false);
  });
});
