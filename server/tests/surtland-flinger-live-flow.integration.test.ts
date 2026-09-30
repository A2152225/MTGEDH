import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

/**
 * Surtland Flinger, live server flow: attack trigger -> "you may sacrifice another creature" ->
 * sacrifice choice -> reflexive "When you do" -> player chooses "any target" -> damage equal to the
 * sacrificed creature's power (twice that for a Giant). Covers both the legacy trigger path and the
 * production Effect Program (trigger IR primary) path.
 */
const SURTLAND_TEXT =
  "Whenever this creature attacks, you may sacrifice another creature. When you do, this creature deals damage equal to the sacrificed creature's power to any target. If the sacrificed creature was a Giant, this creature deals twice that much damage instead.";

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

describe.each([
  { mode: 'legacy trigger path', flag: '0' },
  { mode: 'Effect Program (IR primary) path', flag: '1' },
])('Surtland Flinger live attack-trigger flow: $mode', ({ flag }) => {
  const gameId = `test_surtland_flinger_live_flow_${flag}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {} } as any);
  });
  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = flag;
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

  async function runFlinger(fodder: { type_line: string; power: string }) {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    const state = game.state as any; // seeded once; the Effect Program path swaps game.state, so re-read below
    state.players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    state.life = { [p1]: 40, [p2]: 40 };
    state.turnPlayer = p1;
    state.priority = p1;
    state.battlefield = [
      { id: 'flinger', controller: p1, owner: p1, counters: {}, card: { name: 'Surtland Flinger', type_line: 'Creature — Giant Berserker', power: '4', toughness: '4', oracle_text: SURTLAND_TEXT } },
      { id: 'fodder', controller: p1, owner: p1, counters: {}, card: { name: 'Fodder', type_line: fodder.type_line, power: fodder.power, toughness: '3' } },
    ];
    state.zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };
    const description = SURTLAND_TEXT.replace(/^Whenever this creature attacks, /, '');
    state.stack = [{
      id: 'trig1', type: 'triggered_ability', controller: p1, source: 'flinger', permanentId: 'flinger',
      sourceName: 'Surtland Flinger', description, effect: description, mandatory: true,
    }];
    game.resolveTopOfStack();

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);

    const seenStepTypes: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const step = (ResolutionQueueManager.getQueue(gameId).steps as any[])[0];
      if (!step) break;
      seenStepTypes.push(`${step.type}:${step.description}`);
      const options = (step.options || []).map((o: any) => o.id);
      const targets = (step.validTargets || []).map((t: any) => t.id);
      let selections: string[];
      if (options.includes('yes')) selections = ['yes'];
      else if (options.includes('sacrifice')) selections = ['sacrifice'];
      else if (targets.includes('fodder')) selections = ['fodder'];
      else if (targets.includes(p2)) selections = [p2];
      else selections = [String(targets[0] ?? options[0])];
      await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections });
      if (((game.state as any).stack || []).length > 0 && ResolutionQueueManager.getQueue(gameId).steps.length === 0) {
        game.resolveTopOfStack();
      }
    }
    return { state: game.state as any, seenStepTypes };
  }

  it('sacrifices a non-Giant and deals damage equal to its power to the chosen target', async () => {
    const { state, seenStepTypes } = await runFlinger({ type_line: 'Creature — Goblin', power: '3' });
    expect(state.battlefield.map((p: any) => p.id)).toEqual(['flinger']);
    expect(state.life.p2).toBe(37);
    expect(state.life.p1).toBe(40);
    expect(state.stack).toHaveLength(0);
    expect(seenStepTypes.some((entry) => /Choose any target/i.test(entry))).toBe(true);
  });

  it('doubles the damage when the sacrificed creature was a Giant', async () => {
    const { state } = await runFlinger({ type_line: 'Creature — Giant', power: '3' });
    expect(state.battlefield.map((p: any) => p.id)).toEqual(['flinger']);
    expect(state.life.p2).toBe(34);
    expect(state.stack).toHaveLength(0);
  });
});