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

describe('energy activation costs on the live socket path', () => {
  const gameId = 'test_energy_activation_cost_live';
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(noopIo);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await reset(gameId); });
  afterEach(async () => { await reset(gameId); });

  it('pays both the mana and the energy of "{2}, Pay {E}"', async () => {
    const { game, handlers, emitted, p1 } = setup(gameId, '{2}, Pay {E}: Draw a card.', 1);
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const errors = emitted.filter((e) => e.event === 'error').map((e) => e.payload?.code);
    expect(errors).toEqual([]);
    expect((game.state as any).energy[p1]).toBe(0);
    expect((game.state as any).manaPool[p1].colorless).toBe(0);
    expect(((game.state as any).stack || []).length).toBe(1);
  });

  it('rejects "{2}, Pay {E}" without enough energy and spends nothing', async () => {
    const { game, handlers, emitted, p1 } = setup(gameId, '{2}, Pay {E}: Draw a card.', 0);
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    expect(emitted.some((e) => e.event === 'error' && e.payload?.code === 'INSUFFICIENT_ENERGY')).toBe(true);
    expect((game.state as any).manaPool[p1].colorless).toBe(2);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('pays energy together with a self-sacrifice cost ("{1}, Pay {E}{E}, Sacrifice this artifact")', async () => {
    const { game, handlers, emitted, p1 } = setup(gameId, '{1}, Pay {E}{E}, Sacrifice this artifact: Draw a card.', 2);
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });
    const errors = emitted.filter((e) => e.event === 'error').map((e) => e.payload?.message || e.payload?.code);
    expect(errors).toEqual([]);
    expect((game.state as any).energy[p1]).toBe(0);
    expect((game.state as any).manaPool[p1].colorless).toBe(1);
    expect(((game.state as any).battlefield || []).some((perm: any) => perm.id === 'src_1')).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(1);
  });
});

describe('extractActivationEnergyCost', () => {
  it('splits the energy clause off mixed costs', async () => {
    const { extractActivationEnergyCost, unsupportedEnergyCostCompanions } = await import('../src/socket/interaction-handlers/activationEnergyCost.js');
    expect(extractActivationEnergyCost('{2}, Pay {E}')).toEqual({ amount: 1, remainingCost: '{2}' });
    expect(extractActivationEnergyCost('{1}, Pay {E}{E}, Sacrifice this artifact')).toEqual({ amount: 2, remainingCost: '{1}, Sacrifice this artifact' });
    expect(extractActivationEnergyCost('Pay eight {E}')).toEqual({ amount: 8, remainingCost: '' });
    expect(extractActivationEnergyCost('{T}, Pay {E}')).toEqual({ amount: 1, remainingCost: '{T}' });
    expect(extractActivationEnergyCost('{E}{E}{E}, {T}')).toEqual({ amount: 3, remainingCost: '{T}' });
    expect(extractActivationEnergyCost('{2}{R}').amount).toBe(0);
    expect(unsupportedEnergyCostCompanions('{1}, Sacrifice this artifact')).toBe('');
    expect(unsupportedEnergyCostCompanions('{1}, Pay 2 life')).toBe('');
    expect(unsupportedEnergyCostCompanions('{1}, Discard a card')).toBe('Discard a card');
  });
});
