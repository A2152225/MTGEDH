import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { triggerETBEffectsForToken } from '../src/state/modules/triggerEtbEntryEffects-handlers/triggerEtbTokenEntryEffects.js';

/**
 * Warstorm Surge: "Whenever a creature you control enters, it deals damage equal
 * to its power to any target." The creature is the damage source (lifelink,
 * deathtouch); the player chooses any target when the trigger is put on the stack.
 */
const WARSTORM = 'Whenever a creature you control enters, it deals damage equal to its power to any target.';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

const savedTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
const gameId = 'issue78_warstorm_repeat';

describe('issue #78 Warstorm Surge repeated triggers', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {} } as any);
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  afterEach(async () => {
    if (savedTriggerPrimary === undefined) delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    else process.env.ORACLE_IR_TRIGGER_PRIMARY = savedTriggerPrimary;
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  function setup() {
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
    state.startingLife = 40;
    state.turnPlayer = p1;
    state.priority = p1;
    state.activePlayer = p1;
    state.stack = [];
    state.battlefield = [
      {
        id: 'surge',
        controller: p1,
        owner: p1,
        card: {
          name: 'Warstorm Surge',
          type_line: 'Enchantment',
          oracle_text: WARSTORM,
        },
      },
      {
        id: 'wall',
        controller: p2,
        owner: p2,
        counters: {},
        card: {
          name: 'Wall',
          type_line: 'Creature â€” Wall',
          power: '2',
          toughness: '7',
          oracle_text: '',
        },
      },
    ];
    state.zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };
    return { game, p1, p2, state };
  }

  function enterBear(game: any, p1: string) {
    const bear = {
      id: 'bear',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: true,
      counters: {},
      card: {
        name: 'Bear',
        type_line: 'Creature â€” Bear',
        power: '5',
        toughness: '5',
        oracle_text: 'Lifelink',
        keywords: ['Lifelink'],
      },
    };
    (game.state as any).battlefield.push(bear);
    triggerETBEffectsForPermanent(game, bear, p1 as any);
    return bear;
  }

  async function chooseTarget(game: any, targetId: string) {
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    const bearBefore = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'bear');
    expect(bearBefore).toBeTruthy();
    expect(Number(bearBefore?.damage || bearBefore?.markedDamage || 0)).toBe(0);
    game.resolveTopOfStack();
    const bearAfterPrompt = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'bear');
    expect(bearAfterPrompt).toBeTruthy();
    expect(Number(bearAfterPrompt?.damage || bearAfterPrompt?.markedDamage || bearAfterPrompt?.counters?.damage || 0)).toBe(0);
    expect((game.state as any).life.p1).toBe(40);
    expect((game.state as any).life.p2).toBe(40);
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find((s: any) => s.type === ResolutionStepType.TARGET_SELECTION);
    expect(step?.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(String(step?.description || '')).toMatch(/any target/i);
    const targetIds = (step.validTargets || []).map((entry: any) => String(entry.id));
    expect(targetIds).toContain('p2');
    expect(targetIds).toContain('bear');
    expect(targetIds).toContain('wall');
    expect(targetIds).not.toContain('surge');
    expect(step.damagePreview).toBe(5);
    expect((step.validTargets || []).find((entry: any) => String(entry.id) === 'p2')?.life).toBe(40);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [targetId] });
    return game.state as any;
  }

  function enterNamed(game: any, p1: string, id: string, power: number) {
    const perm = { id, controller: p1, owner: p1, tapped: false, summoningSickness: true, counters: {},
      card: { name: 'Soldier', type_line: 'Token Creature - Soldier', power: String(power), toughness: String(power), oracle_text: '' } };
    (game.state as any).battlefield.push(perm);
    triggerETBEffectsForPermanent(game, perm, p1 as any);
  }
  async function resolveNextTrigger(game: any, targetId: string | null) {
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    game.resolveTopOfStack();
    const step = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find((s: any) => s.type === ResolutionStepType.TARGET_SELECTION);
    const ids = (step?.validTargets || []).map((e: any) => String(e.id));
    if (targetId) await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [targetId] });
    return ids;
  }

  it('a player dealt lethal damage by one trigger is gone before the next trigger asks for targets', async () => {
    const { game, p1, state } = setup();
    state.players.push({ id: 'p3', name: 'P3', spectator: false, life: 40 });
    state.life.p3 = 40; state.life.p2 = 4;
    state.zones.p3 = { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 };
    enterNamed(game, p1, 's1', 6); enterNamed(game, p1, 's2', 6);
    const first = await resolveNextTrigger(game, 'p2');
    expect(first).toContain('p2');
    const second = await resolveNextTrigger(game, null);
    expect(second).not.toContain('p2');
  });

  it('a creature destroyed by one trigger is not offered to the next trigger', async () => {
    const { game, p1, p2, state } = setup();
    state.battlefield.push({ id: 'golem', controller: p2, owner: p2, counters: {}, card: { name: 'Golem', type_line: 'Creature - Golem', power: '4', toughness: '4', oracle_text: '' } });
    enterNamed(game, p1, 's1', 6); enterNamed(game, p1, 's2', 6);
    ResolutionQueueManager.addStep(gameId, { type: ResolutionStepType.OPTION_CHOICE, playerId: p2 as any, description: 'Unrelated pending choice', mandatory: true, sourceId: 'other', sourceName: 'Other Effect', options: [{ id: 'a', label: 'A' }] } as any);
    await resolveNextTrigger(game, 'golem');
    const second = await resolveNextTrigger(game, null);
    expect(second).not.toContain('golem');
  });
});
