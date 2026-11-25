import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const noopIo = { to: () => ({ emit: () => {} }), emit: () => {} } as any;

function setup(gameId: string, oracle: string, energy: number, extraBattlefield: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const p1 = 'p1';
  (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [p1]: 40 };
  (game.state as any).turnPlayer = p1;
  (game.state as any).priority = p1;
  (game.state as any).phase = 'precombatMain';
  (game.state as any).stack = [];
  (game.state as any).energy = { [p1]: energy };
  (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 } };
  (game.state as any).battlefield = [
    {
      id: 'src_1', controller: p1, owner: p1, tapped: false, counters: {},
      card: { name: 'Energy Engine', type_line: 'Artifact', oracle_text: oracle, image_uris: { small: 'x' } },
    },
    ...extraBattlefield,
  ];
  (game.state as any).zones = {
    [p1]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, library: [], libraryCount: 0 },
  };
  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: p1, spectator: false },
    rooms: new Set<string>([gameId]),
    on: (ev: string, fn: Function) => { handlers[ev] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  const io = {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map([['s_0', socket]]) },
  } as any;
  registerResolutionHandlers(io, socket);
  registerInteractionHandlers(io, socket);
  return { game, handlers, emitted, p1 };
}

async function reset(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}


const HAZEL = '{T}, Pay 2 life, Tap X untapped tokens you control: Add X mana in any combination of colors.';
const token = (id: string, tapped = false) => ({
  id, controller: 'p1', owner: 'p1', tapped, counters: {}, isToken: true,
  card: { name: 'Squirrel', type_line: 'Creature \u2014 Squirrel', oracle_text: '' },
});
const nontoken = { id: 'bear_1', controller: 'p1', owner: 'p1', tapped: false, counters: {}, card: { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '' } };

describe('Tap X untapped tokens you control (Hazel of the Rootbloom)', () => {
  const gameId = 'test_tap_x_tokens_cost_live';
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await reset(gameId); });
  afterEach(async () => { await reset(gameId); });

  it('prompts for 1..N untapped tokens and uses the count tapped as X', async () => {
    const { game, handlers, emitted, p1 } = setup(gameId, HAZEL, 0, [token('tok_1'), token('tok_2'), token('tok_3'), token('tok_4', true), nontoken]);
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload?.message)).toEqual([]);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s.tapOtherAbilityAsCost === true) as any;
    expect(step).toBeDefined();
    expect(step.targetCount).toBe(3);
    expect(step.minTargetCount).toBe(1);

    await handlers['submitResolutionResponse']({ gameId, stepId: String(step.id), selections: ['tok_1', 'tok_2'] });
    expect(emitted.filter((e) => e.event === 'error').map((e) => e.payload?.message)).toEqual([]);
    const battlefield = (game.state as any).battlefield as any[];
    expect(battlefield.filter((perm) => perm.tapped).map((perm) => perm.id).sort()).toEqual(['src_1', 'tok_1', 'tok_2', 'tok_4']);
    expect((game.state as any).life[p1]).toBe(38);
    const stackText = JSON.stringify((game.state as any).stack || []);
    const queueText = JSON.stringify(ResolutionQueueManager.getQueue(gameId).steps || []);
    process.stdout.write('HAZEL ' + stackText.slice(0, 600) + ' || ' + queueText.slice(0, 600) + ' || pool=' + JSON.stringify((game.state as any).manaPool[p1]) + '\n');
    expect(stackText + queueText).not.toMatch(/Add X mana/);
  });

  it('rejects a nontoken creature for a token tap cost', async () => {
    const { handlers, emitted } = setup(gameId, HAZEL, 0, [token('tok_1'), nontoken]);
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s.tapOtherAbilityAsCost === true) as any;
    expect(step?.targetCount).toBe(1);
    await handlers['submitResolutionResponse']({ gameId, stepId: String(step.id), selections: ['bear_1'] });
    expect(emitted.some((e) => e.event === 'error')).toBe(true);
  });
});
