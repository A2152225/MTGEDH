import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
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

describe('FIGHT_TARGET validate-before-complete (integration)', () => {
  const gameId = 'test_fight_target_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on invalid target selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const sourceId = 'src_cre';
    const targetId = 'tgt_cre';

    (game.state as any).battlefield = [
      {
        id: sourceId,
        controller: p1,
        owner: p1,
        tapped: false,
        damageMarked: 0,
        card: { id: 'c_src', name: 'Source', type_line: 'Creature — Test', power: '2', toughness: '2' },
      },
      {
        id: targetId,
        controller: p2,
        owner: p2,
        tapped: false,
        damageMarked: 0,
        card: { id: 'c_tgt', name: 'Target', type_line: 'Creature — Test', power: '3', toughness: '3' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'existing_trigger',
        type: 'triggered_ability',
        controller: p2,
        source: 'kynaios_src',
        sourceName: 'Kynaios and Tiro of Meletis',
        description: 'At the beginning of your end step, draw a card.',
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.FIGHT_TARGET,
      playerId: p1 as any,
      description: 'Fight a creature',
      activatedAbilityText: '{2}{R}, {T}: This creature fights another target creature.',
      mandatory: true,
      sourceId,
      sourceName: 'Fight Spell',
      targetFilter: { controller: 'opponent', excludeSource: true },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'fight_target');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    // Invalid selection (no target)
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: [] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_TARGET');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Now submit a valid target id
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: [targetId] });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const battlefield = (game.state as any).battlefield as any[];
    const src = battlefield.find(p => p.id === sourceId);
    const tgt = battlefield.find(p => p.id === targetId);
    expect(Number(src?.damageMarked || 0)).toBe(0);
    expect(Number(tgt?.damageMarked || 0)).toBe(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(2);
    const fightAbility = stack.find((item: any) => String(item?.abilityType || '') === 'fight');
    expect(fightAbility).toBeDefined();
    expect(fightAbility).toMatchObject({
      type: 'ability',
      controller: p1,
      source: sourceId,
      targets: [targetId],
    });

    expect((game.state as any).priority).toBe(p1);

    resolveTopOfStack({
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: () => {
        if (typeof (game as any).bumpSeq === 'function') {
          (game as any).bumpSeq();
        }
      },
      rng: Math.random,
      gameId,
    } as any);

    expect(Number(src?.damageMarked || 0)).toBeGreaterThan(0);
    expect(Number(tgt?.damageMarked || 0)).toBeGreaterThan(0);
  });

  it('rejects a shrouded fight target without consuming the step', async () => {
    const shroudGameId = `${gameId}_shroud`;
    ResolutionQueueManager.removeQueue(shroudGameId);
    games.delete(shroudGameId as any);

    createGameIfNotExists(shroudGameId, 'commander', 40);
    const game = ensureGame(shroudGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const sourceId = 'src_cre';
    const targetId = 'shroud_cre';

    (game.state as any).battlefield = [
      {
        id: sourceId,
        controller: p1,
        owner: p1,
        tapped: false,
        damageMarked: 0,
        card: { id: 'c_src', name: 'Source', type_line: 'Creature — Test', power: '2', toughness: '2' },
      },
      {
        id: targetId,
        controller: p2,
        owner: p2,
        tapped: false,
        damageMarked: 0,
        card: {
          id: 'c_tgt',
          name: 'Target',
          type_line: 'Creature — Test',
          power: '3',
          toughness: '3',
          oracle_text: 'Shroud',
        },
      },
    ];

    ResolutionQueueManager.addStep(shroudGameId, {
      type: ResolutionStepType.FIGHT_TARGET,
      playerId: p1 as any,
      description: 'Fight a creature',
      activatedAbilityText: '{2}{R}, {T}: This creature fights another target creature.',
      mandatory: true,
      sourceId,
      sourceName: 'Fight Spell',
      targetFilter: { controller: 'opponent', excludeSource: true },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(shroudGameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(shroudGameId);
    const step = queue.steps.find((s: any) => s.type === 'fight_target');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId: shroudGameId, stepId, selections: [targetId] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_TARGET');

    const queueAfter = ResolutionQueueManager.getQueue(shroudGameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);
    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => String(item?.abilityType || '') === 'fight')).toBe(false);
  });
});
