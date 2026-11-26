import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { parseAnyCombinationManaEffectAmount } from '../src/socket/resolution-handlers/tapCostAnyCombinationManaOffStack.js';

// Hazel of the Rootbloom: "{T}, Tap X untapped tokens you control: Add X mana in any combination of colors."
// X = tokens tapped; it is a mana ability, so no stack (CR 605.3a) and X mana split across colors.
const gameId = 'test_tap_x_tokens_any_combination_mana';
const HAZEL = '{T}, Tap X untapped tokens you control: Add X mana in any combination of colors.';
const noopIo = { to: () => ({ emit: () => {} }), emit: () => {} } as any;
const token = (id: string) => ({
  id, controller: 'p1', owner: 'p1', tapped: false, counters: {}, isToken: true,
  card: { name: 'Squirrel', type_line: 'Creature \u2014 Squirrel', oracle_text: '' },
});

function setup() {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  (game.state as any).players = [{ id: 'p1', name: 'P1', spectator: false, life: 40 }, { id: 'p2', name: 'P2', spectator: false, life: 40 }];
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).phase = 'precombatMain';
  (game.state as any).stack = [];
  (game.state as any).manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
  (game.state as any).battlefield = [
    { id: 'hazel_1', controller: 'p1', owner: 'p1', tapped: false, summoningSickness: false, counters: {},
      card: { id: 'hazel_card', name: 'Hazel of the Rootbloom', type_line: 'Legendary Creature \u2014 Squirrel Druid', oracle_text: HAZEL } },
    token('tok_1'), token('tok_2'), token('tok_3'),
  ];
  (game.state as any).zones = { p1: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, library: [], libraryCount: 0 } };
  const emitted: Array<{ event: string; payload: any }> = [];
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: 'p1', spectator: false }, rooms: new Set<string>([gameId]),
    on: (ev: string, fn: Function) => { handlers[ev] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  const io = { to: () => ({ emit: (event: string, payload: any) => emitted.push({ event, payload }) }), emit: () => {}, sockets: { sockets: new Map() } } as any;
  registerResolutionHandlers(io, socket);
  registerInteractionHandlers(io, socket);
  return { game, handlers, emitted };
}

async function reset() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { await deleteGame(gameId); } catch { /* fresh db */ }
}

describe('Hazel: tap X tokens for X mana in any combination of colors', () => {
  beforeAll(async () => { await initDb(); initializePriorityResolutionHandler(noopIo); });
  beforeEach(async () => { await reset(); });
  afterEach(async () => { await reset(); });

  it('taps 3 tokens, skips the stack, and adds 3 mana split across colors', async () => {
    const { game, handlers, emitted } = setup();
    await handlers.activateBattlefieldAbility({ gameId, permanentId: 'hazel_1', abilityId: 'hazel_card-ability-0' });
    const tapStep = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s.tapOtherAbilityAsCost === true) as any;
    expect(tapStep?.targetCount).toBe(3);
    await handlers.submitResolutionResponse({ gameId, stepId: String(tapStep.id), selections: ['tok_1', 'tok_2', 'tok_3'] });
    expect(emitted.filter((e) => e.event === 'error')).toEqual([]);
    expect((game.state as any).stack).toEqual([]);

    const manaStep = ResolutionQueueManager.getQueue(gameId).steps
      .find((s: any) => s.type === ResolutionStepType.MANA_COLOR_SELECTION && s.status === 'pending') as any;
    expect(manaStep?.selectionKind).toBe('distribution');
    expect(manaStep?.totalAmount).toBe(3);
    await handlers.submitResolutionResponse({ gameId, stepId: String(manaStep.id), selections: { W: 1, G: 2 } });
    expect(emitted.filter((e) => e.event === 'error')).toEqual([]);
    const pool = (game.state as any).manaPool.p1;
    expect([pool.white, pool.green, pool.blue, pool.colorless]).toEqual([1, 2, 0, 0]);
    expect((game.state as any).battlefield.filter((p: any) => p.tapped).map((p: any) => p.id).sort()).toEqual(['hazel_1', 'tok_1', 'tok_2', 'tok_3']);
  });

  it('parses only plain "Add N mana in any combination of colors" effects', () => {
    expect(parseAnyCombinationManaEffectAmount('add 2 mana in any combination of colors.')).toBe(2);
    expect(parseAnyCombinationManaEffectAmount('Add three mana in any combination of colors')).toBe(3);
    expect(parseAnyCombinationManaEffectAmount('Add X mana in any combination of colors.')).toBeNull();
    expect(parseAnyCombinationManaEffectAmount('Add two mana in any combination of colors. Draw a card.')).toBeNull();
  });
});
