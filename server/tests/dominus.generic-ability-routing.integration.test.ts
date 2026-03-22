import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { applyStateBasedActions } from '../src/rules-engine/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Dominus generic ability routing (integration)', () => {
  const gameId = 'test_dominus_generic_activation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('routes parser-emitted Dominus ids through phyrexian payment, sacrifice selection, and self indestructible-counter resolution', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        graveyard: [],
        exile: [],
        handCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'dominus_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        damageMarked: 0,
        card: {
          id: 'mondrak_card_1',
          name: 'Mondrak, Glory Dominus',
          type_line: 'Legendary Creature - Phyrexian Horror',
          oracle_text: 'If one or more tokens would be created under your control, twice that many of those tokens are created instead.\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak, Glory Dominus.',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'artifact_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'artifact_card_1',
          name: 'Test Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
      {
        id: 'creature_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        damageMarked: 0,
        card: {
          id: 'creature_card_1',
          name: 'Test Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'dominus_1',
      abilityId: 'mondrak_card_1-dominus-indestructible-0',
    });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const phyrexianStep = queue.steps[0] as any;
    expect(phyrexianStep.type).toBe('mana_payment_choice');
    expect(phyrexianStep.phyrexianManaChoice).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: phyrexianStep.id,
      selections: [
        { index: 0, payWithLife: false },
        { index: 1, payWithLife: true },
      ],
    });

    expect((game.state as any).life?.[playerId]).toBe(38);
    expect((game.state as any).manaPool?.[playerId]?.white).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const sacrificeStep = queue.steps[0] as any;
    expect(sacrificeStep.type).toBe('target_selection');
    expect(sacrificeStep.sacrificeAbilityAsCost).toBe(true);
    expect(sacrificeStep.sacrificeCount).toBe(2);
    expect((sacrificeStep.validTargets as any[]).map((entry: any) => String(entry?.id)).sort()).toEqual(['artifact_1', 'creature_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: sacrificeStep.id,
      selections: ['artifact_1', 'creature_1'],
    });

    const battlefieldAfterCosts = (game.state as any).battlefield || [];
    expect((battlefieldAfterCosts as any[]).some((perm: any) => String(perm?.id) === 'artifact_1')).toBe(false);
    expect((battlefieldAfterCosts as any[]).some((perm: any) => String(perm?.id) === 'creature_1')).toBe(false);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('indestructible counter');

    game.resolveTopOfStack();

    const dominus = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'dominus_1');
    expect(dominus?.counters?.indestructible).toBe(1);

    dominus.damageMarked = 4;
    const sbaResult = applyStateBasedActions((game.state as any));
    expect((sbaResult as any).destroys || []).not.toContain('dominus_1');
  });
});