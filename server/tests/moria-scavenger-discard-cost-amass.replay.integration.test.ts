import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { persistAndResolveTopOfStack } from '../src/socket/util-handlers/appendGameEvent.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

/**
 * Moria Scavenger, oracle text from oracle-cards.jsonl:
 *   Deathtouch, haste
 *   {T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a
 *   +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0
 *   black Orc Army creature token first.)
 *
 * Self-play games 136 and 139 reported it as an all-or-nothing failure: the reminder text was parsed as
 * a real "put a +1/+1 counter on an Army you control" step, and the "if the discarded card was a
 * creature card" clause was not parsed at all.
 */
const MORIA_ORACLE =
  'Deathtouch, haste\n'
  + "{T}, Discard a card: Draw a card. If the discarded card was a creature card, amass Orcs 1. (Put a +1/+1 counter on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)";

const usedGameIds = new Set<string>();

function seedState(state: any) {
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  state.life = { p1: 40, p2: 40 };
  state.startingLife = 40;
  state.turnPlayer = 'p1';
  state.priority = 'p1';
  state.activePlayer = 'p1';
  state.phase = 'precombatMain';
  state.step = 'MAIN1';
  state.stack = [];
  state.battlefield = [
    {
      id: 'moria',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        id: 'moria_card',
        name: 'Moria Scavenger',
        type_line: 'Creature — Goblin Rogue',
        power: '1',
        toughness: '2',
        oracle_text: MORIA_ORACLE,
        keywords: ['Deathtouch', 'Haste', 'Amass'],
      },
    },
  ];
  const zone = () => ({ hand: [] as any[], handCount: 0, graveyard: [] as any[], graveyardCount: 0, library: [] as any[], libraryCount: 0, exile: [] as any[], exileCount: 0 });
  state.zones = { p1: zone(), p2: zone() };
  state.zones.p1.hand = [
    { id: 'h_creature', name: 'Grizzly Bears', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', zone: 'hand' },
    { id: 'h_land', name: 'Swamp', type_line: 'Basic Land — Swamp', zone: 'hand' },
  ];
  state.zones.p1.handCount = 2;
  state.zones.p1.library = [
    { id: 'lib_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
    { id: 'lib_2', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
  ];
  state.zones.p1.libraryCount = 2;
}

function summarize(state: any) {
  const armies = (state.battlefield || []).filter((perm: any) => /\barmy\b/i.test(String(perm?.card?.type_line || '')));
  return {
    hand: (state.zones?.p1?.hand || []).map((card: any) => String(card.id)).sort(),
    graveyard: (state.zones?.p1?.graveyard || []).map((card: any) => String(card.id)).sort(),
    armies: armies.map((perm: any) => ({
      typeLine: String(perm.card?.type_line || ''),
      counters: Number(perm.counters?.['+1/+1'] || 0),
      controller: String(perm.controller || ''),
    })),
    stack: (state.stack || []).length,
  };
}

async function activateLive(gameId: string, discardCardId: string) {
  usedGameIds.add(gameId);
  await deleteGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId)!;
  seedState(game.state as any);
  const start = getEvents(gameId).length;

  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: 'p1', spectator: false, gameId },
    rooms: new Set([gameId]),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: () => {},
  } as any;
  const io = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map([['s', socket]]) } } as any;
  registerResolutionHandlers(io, socket);
  registerInteractionHandlers(io, socket);

  await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'moria', abilityId: 'moria-ability-0' });
  const discardStep = (ResolutionQueueManager.getQueue(gameId).steps as any[]).find((step) => step.discardAbilityAsCost === true);
  expect(discardStep, 'discard cost prompt').toBeTruthy();
  await handlers['submitResolutionResponse']({ gameId, stepId: discardStep.id, selections: [discardCardId] });

  expect(((game.state as any).stack || []).length).toBe(1);
  expect(persistAndResolveTopOfStack(game, gameId, { playerId: 'p1' })).toBe(true);
  return { game, start };
}

function replayFrom(gameId: string, start: number) {
  const saved = getEvents(gameId).slice(start);
  const replayGame = createInitialGameState(`${gameId}_replay`);
  seedState(replayGame.state as any);
  replayGame.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);
  return { replayState: replayGame.state as any, saved };
}

describe('Moria Scavenger: "If the discarded card was a creature card, amass Orcs 1"', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {} } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(async () => {
    for (const id of usedGameIds) {
      ResolutionQueueManager.removeQueue(id);
      games.delete(id as any);
      await deleteGame(id);
    }
    usedGameIds.clear();
  });

  it('parses the amass behind the condition and drops the reminder text', () => {
    const ir = parseOracleTextToIR(MORIA_ORACLE, 'Moria Scavenger');
    const activated = ir.abilities.filter((ability) => ability.type === 'activated');
    expect(activated).toHaveLength(1);
    const steps = activated[0].steps || [];
    expect(steps.map((step) => step.kind)).toEqual(['draw', 'conditional']);
    const conditional = steps.find((step) => step.kind === 'conditional') as any;
    expect(conditional?.condition?.raw).toBe('the discarded card was a creature card');
    expect((conditional?.steps || []).map((step: any) => step.kind)).toEqual(['conditional', 'add_counter', 'add_types']);
    // Reminder text must not survive as its own step.
    expect(steps.some((step) => /^\(/.test(String((step as any).raw || '')))).toBe(false);
  });

  it('draws and amasses when a creature card was discarded, and replays to the same board', async () => {
    const gameId = 'moria_scavenger_discard_creature';
    const { game, start } = await activateLive(gameId, 'h_creature');

    const live = summarize(game.state);
    expect(live.hand).toEqual(['h_land', 'lib_1']);
    expect(live.graveyard).toEqual(['h_creature']);
    expect(live.armies).toHaveLength(1);
    expect(live.armies[0].counters).toBe(1);
    expect(live.armies[0].typeLine).toMatch(/Orc/);
    expect(live.armies[0].typeLine).toMatch(/Army/);
    expect(live.stack).toBe(0);

    const { replayState, saved } = replayFrom(gameId, start);
    const activation = saved.find((event: any) => event.type === 'activateBattlefieldAbility') as any;
    expect(activation?.payload?.discardedCardIds).toEqual(['h_creature']);
    // The counter is saved after the token it sits on, or replay finds no permanent to put it on.
    const types = saved.map((event: any) => String(event.type === 'executeEffect' ? event.payload?.effectType : event.type));
    expect(types.indexOf('createToken')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('updateCounters')).toBeGreaterThan(types.indexOf('createToken'));
    expect(summarize(replayState)).toEqual(live);
  });

  it('only draws when a land card was discarded, and replays to the same board', async () => {
    const gameId = 'moria_scavenger_discard_land';
    const { game, start } = await activateLive(gameId, 'h_land');

    const live = summarize(game.state);
    expect(live.hand).toEqual(['h_creature', 'lib_1']);
    expect(live.graveyard).toEqual(['h_land']);
    expect(live.armies).toEqual([]);
    expect(live.stack).toBe(0);

    const { replayState } = replayFrom(gameId, start);
    expect(summarize(replayState)).toEqual(live);
  });
});
