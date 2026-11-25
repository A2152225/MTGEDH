import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { resolveDividedAsYouChooseTotal } from '../src/state/modules/dividedDamageDivision.js';
import '../src/state/modules/priority.js';

const INFERNO_TITAN =
  'Whenever Inferno Titan enters the battlefield or attacks, it deals 3 damage divided as you choose among one, two, or three target creatures and/or players.';

const EQUAL_TO_POWER =
  'Whenever this creature enters the battlefield, it deals damage equal to its power divided as you choose among one or two target creatures.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [socket.id || `s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

function damageOf(state: any, id: string): number {
  const perm = (state.battlefield || []).find((entry: any) => entry.id === id);
  return Number(perm?.damageMarked ?? perm?.damage ?? 0);
}

const gameId = 'test_divided_damage_trigger_division';
const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('triggered ability divided-damage chooser', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame();
  });

  afterEach(async () => {
    if (previousTriggerPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    await resetGame();
  });

  it('computes an equal-to-its-power total from the battlefield source', () => {
    const source = {
      id: 'titan',
      controller: 'p1',
      power: '5',
      toughness: '5',
      card: { name: 'Power Titan', type_line: 'Creature — Giant', power: '5', toughness: '5' },
    };
    const total = resolveDividedAsYouChooseTotal({
      oracleText: EQUAL_TO_POWER,
      gameOrState: { battlefield: [source] },
      sourceId: 'titan',
      sourcePermanent: source,
    });
    expect(total).toBe(5);
    expect(resolveDividedAsYouChooseTotal({ oracleText: EQUAL_TO_POWER })).toBeNull();
  });

  it('prompts for Inferno Titan after trigger targets and applies an uneven split through the live path', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const state = game.state as any;
    state.players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    state.life = { [p1]: 40, [p2]: 40 };
    state.battlefield = [
      {
        id: 'titan',
        controller: p1,
        owner: p1,
        power: '6',
        toughness: '6',
        damageMarked: 0,
        card: { name: 'Inferno Titan', type_line: 'Creature — Giant', power: '6', toughness: '6', oracle_text: INFERNO_TITAN },
      },
      {
        id: 'giant',
        controller: p2,
        owner: p2,
        power: '3',
        toughness: '5',
        damageMarked: 0,
        card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '5', oracle_text: '' },
      },
      {
        id: 'wurm',
        controller: p2,
        owner: p2,
        power: '6',
        toughness: '4',
        damageMarked: 0,
        card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4', oracle_text: '' },
      },
    ];
    state.stack = [
      {
        id: 'titan_trigger',
        type: 'triggered_ability',
        controller: p1,
        source: 'titan',
        permanentId: 'titan',
        sourceName: 'Inferno Titan',
        description: INFERNO_TITAN,
        effect: INFERNO_TITAN,
        triggerType: 'etb',
        mandatory: true,
        requiresTarget: true,
        targetType: 'any',
        needsTargetSelection: true,
      },
    ];

    game.resolveTopOfStack();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    let queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.targetedTriggeredAbility).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['giant', 'wurm'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const divisionStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.DAMAGE_DIVISION) as any;
    expect(divisionStep).toBeDefined();
    expect(Number(divisionStep.totalAmount)).toBe(3);
    // resolveTopOfStack pops the trigger before the target prompt is queued.
    expect(divisionStep.triggerItem?.targets).toEqual(['giant', 'wurm']);
    expect(String(divisionStep.triggerStackItemId || '')).toBe('titan_trigger');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(divisionStep.id),
      selections: { giant: 2, wurm: 1 },
    });

    expect(damageOf(state, 'giant')).toBe(2);
    expect(damageOf(state, 'wurm')).toBe(1);
    expect(damageOf(state, 'titan')).toBe(0);
    expect((state.stack || []).some((entry: any) => entry.id === 'titan_trigger')).toBe(false);
  });

  it('uses a battlefield power total for an equal-to-its-power trigger split', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const state = game.state as any;
    state.players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    state.life = { [p1]: 40, [p2]: 40 };
    state.battlefield = [
      {
        id: 'source',
        controller: p1,
        owner: p1,
        power: '5',
        toughness: '5',
        damageMarked: 0,
        card: { name: 'Power Titan', type_line: 'Creature — Giant', power: '5', toughness: '5', oracle_text: EQUAL_TO_POWER },
      },
      {
        id: 'giant',
        controller: p2,
        owner: p2,
        power: '3',
        toughness: '5',
        damageMarked: 0,
        card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '5', oracle_text: '' },
      },
      {
        id: 'wurm',
        controller: p2,
        owner: p2,
        power: '6',
        toughness: '4',
        damageMarked: 0,
        card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4', oracle_text: '' },
      },
    ];
    state.stack = [
      {
        id: 'power_trigger',
        type: 'triggered_ability',
        controller: p1,
        source: 'source',
        permanentId: 'source',
        sourceName: 'Power Titan',
        description: EQUAL_TO_POWER,
        effect: EQUAL_TO_POWER,
        triggerType: 'etb',
        mandatory: true,
        requiresTarget: true,
        targetType: 'creature',
        needsTargetSelection: true,
      },
    ];

    game.resolveTopOfStack();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    let queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['giant', 'wurm'],
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const divisionStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.DAMAGE_DIVISION) as any;
    expect(divisionStep).toBeDefined();
    expect(Number(divisionStep.totalAmount)).toBe(5);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(divisionStep.id),
      selections: { giant: 4, wurm: 1 },
    });

    expect(damageOf(state, 'giant')).toBe(4);
    expect(damageOf(state, 'wurm')).toBe(1);
  });
});
