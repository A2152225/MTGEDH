import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { detectCycleTriggers } from '../src/state/modules/triggers/cycle.js';
import { resolveCyclingCostX } from '../src/socket/interaction-handlers/interactionCyclingActivationDefinitions.js';

const SHARK_TYPHOON = {
  id: 'shark_typhoon',
  name: 'Shark Typhoon',
  type_line: 'Enchantment',
  mana_cost: '{5}{U}',
  oracle_text: "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, create an X/X blue Shark creature token with flying.",
};
const KROSAN_TUSKER = {
  id: 'krosan_tusker',
  name: 'Krosan Tusker',
  type_line: 'Creature — Boar Beast',
  mana_cost: '{5}{G}{G}',
  oracle_text: 'Cycling {2}{G} ({2}{G}, Discard this card: Draw a card.)\nWhen you cycle this card, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle. (Do this before you draw.)',
};
const DECREE_OF_JUSTICE = {
  id: 'decree',
  name: 'Decree of Justice',
  type_line: 'Sorcery',
  mana_cost: '{X}{X}{2}{W}{W}',
  oracle_text: 'Create X 4/4 white Angel creature tokens with flying.\nCycling {2}{W} ({2}{W}, Discard this card: Draw a card.)\nWhen you cycle this card, you may pay {X}. If you do, create X 1/1 white Soldier creature tokens.',
};
const LIGHTNING_RIFT_CARD = {
  name: 'Lightning Rift',
  type_line: 'Enchantment',
  oracle_text: 'Whenever a player cycles a card, you may pay {1}. If you do, this enchantment deals 2 damage to any target.',
};
const DRAKE_HAVEN_CARD = {
  name: 'Drake Haven',
  type_line: 'Enchantment',
  oracle_text: 'Whenever you cycle or discard a card, you may pay {1}. If you do, create a 2/2 blue Drake creature token with flying.',
};
const ARCHFIEND_CARD = {
  name: 'Archfiend of Ifnir',
  type_line: 'Creature — Demon',
  oracle_text: 'Flying\nWhenever you cycle or discard another card, put a -1/-1 counter on each creature your opponents control.\nCycling {2} ({2}, Discard this card: Draw a card.)',
};

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  ResolutionQueueManager.removeQueue(gameId);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

function setupGame(gameId: string, handCard: any, manaPool: Record<string, number>, battlefield: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const state = game.state as any;
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  state.life = { p1: 40, p2: 40 };
  state.turnPlayer = 'p1';
  state.priority = 'p1';
  state.phase = 'main1';
  state.step = 'MAIN1';
  state.battlefield = battlefield;
  state.stack = [];
  state.manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...manaPool },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  state.zones = {
    p1: {
      hand: [{ ...handCard, zone: 'hand' }],
      library: [{ id: 'drawn_card', name: 'Drawn Card', type_line: 'Sorcery', oracle_text: 'Draw a card.' }],
      graveyard: [],
      exile: [],
      handCount: 1,
      libraryCount: 1,
      graveyardCount: 0,
      exileCount: 0,
    },
    p2: { hand: [], library: [], graveyard: [], exile: [], handCount: 0, libraryCount: 0, graveyardCount: 0, exileCount: 0 },
  };
  (game as any).libraries = new Map([['p1', [...state.zones.p1.library]], ['p2', []]]);

  const emitted: Array<{ room?: string; event: string; payload: any }> = [];
  const { socket, handlers } = createMockSocket('p1', gameId, emitted);
  registerInteractionHandlers(createMockIo(emitted) as any, socket as any);
  return { game, state, handlers, emitted };
}

describe('cycle triggers fire when a card is cycled', () => {
  const gameIds = ['cycle_trig_shark', 'cycle_trig_shark_nox', 'cycle_trig_tusker', 'cycle_trig_board', 'cycle_trig_decree'];

  beforeAll(async () => {
    await initDb();
  });
  beforeEach(async () => {
    for (const id of gameIds) await resetGame(id);
  });
  afterEach(async () => {
    for (const id of gameIds) await resetGame(id);
  });

  it('Shark Typhoon cycled for X=3 pays {3}{1}{U} and its trigger creates a 3/3 Shark before the draw', async () => {
    const { state, game, handlers } = setupGame('cycle_trig_shark', SHARK_TYPHOON, { blue: 1, colorless: 4 });

    await handlers['activateCycling']({ gameId: 'cycle_trig_shark', cardId: 'shark_typhoon', abilityId: 'shark_typhoon-cycling-0', xValue: 3 });

    expect(state.manaPool.p1.blue).toBe(0);
    expect(state.manaPool.p1.colorless).toBe(0);
    expect(state.zones.p1.graveyard.map((c: any) => c.id)).toEqual(['shark_typhoon']);

    const stack = state.stack as any[];
    expect(stack).toHaveLength(2);
    expect(stack[0]).toMatchObject({ type: 'ability', abilityType: 'cycling', xValue: 3 });
    expect(stack[1]).toMatchObject({
      type: 'triggered_ability',
      controller: 'p1',
      sourceName: 'Shark Typhoon',
      triggerType: 'cycle_this_card',
      xValue: 3,
    });
    expect(String(stack[1].effect)).toMatch(/create an X\/X blue Shark creature token with flying/i);

    game.resolveTopOfStack();
    const sharks = (state.battlefield as any[]).filter((p: any) => /shark/i.test(String(p?.card?.name || '')));
    expect(sharks).toHaveLength(1);
    expect(Number(sharks[0].basePower ?? sharks[0].card?.power)).toBe(3);
    expect(Number(sharks[0].baseToughness ?? sharks[0].card?.toughness)).toBe(3);
    expect(state.zones.p1.handCount).toBe(0);

    game.resolveTopOfStack();
    expect(state.zones.p1.hand.map((c: any) => c.id)).toEqual(['drawn_card']);
  });

  it('X cycling without a chosen X is rejected and leaves the card in hand', async () => {
    const { state, handlers, emitted } = setupGame('cycle_trig_shark_nox', SHARK_TYPHOON, { blue: 1, colorless: 4 });

    await handlers['activateCycling']({ gameId: 'cycle_trig_shark_nox', cardId: 'shark_typhoon', abilityId: 'shark_typhoon-cycling-0' });

    expect(emitted.some((e) => e.event === 'error' && e.payload?.code === 'X_VALUE_REQUIRED')).toBe(true);
    expect(state.zones.p1.hand.map((c: any) => c.id)).toEqual(['shark_typhoon']);
    expect(state.stack).toHaveLength(0);
    expect(state.manaPool.p1.colorless).toBe(4);
  });

  it('Krosan Tusker and Decree of Justice put their optional "when you cycle" triggers above the draw', async () => {
    const tusker = setupGame('cycle_trig_tusker', KROSAN_TUSKER, { green: 1, colorless: 2 });
    await tusker.handlers['activateCycling']({ gameId: 'cycle_trig_tusker', cardId: 'krosan_tusker', abilityId: 'cycling' });
    expect(tusker.state.stack).toHaveLength(2);
    expect(tusker.state.stack[1]).toMatchObject({ type: 'triggered_ability', sourceName: 'Krosan Tusker', mandatory: false });
    expect(String(tusker.state.stack[1].effect)).toMatch(/search your library for a basic land card/i);
    expect(tusker.state.stack[1].xValue).toBeUndefined();

    const decree = setupGame('cycle_trig_decree', DECREE_OF_JUSTICE, { white: 1, colorless: 2 });
    await decree.handlers['activateCycling']({ gameId: 'cycle_trig_decree', cardId: 'decree', abilityId: 'cycling' });
    expect(decree.state.stack).toHaveLength(2);
    expect(decree.state.stack[1]).toMatchObject({ sourceName: 'Decree of Justice', mandatory: false });
    expect(String(decree.state.stack[1].effect)).toMatch(/you may pay \{X\}\. If you do, create X 1\/1 white Soldier/i);
  });

  it('battlefield "whenever ... cycle(s)" triggers respect who cycled', async () => {
    const battlefield = [
      { id: 'rift', controller: 'p2', owner: 'p2', card: { id: 'rift', ...LIGHTNING_RIFT_CARD } },
      { id: 'haven', controller: 'p1', owner: 'p1', card: { id: 'haven', ...DRAKE_HAVEN_CARD } },
      { id: 'archfiend', controller: 'p2', owner: 'p2', card: { id: 'archfiend', ...ARCHFIEND_CARD } },
    ];
    const plainCycler = { id: 'cycler', name: 'Test Cycler', type_line: 'Creature — Beast', oracle_text: 'Cycling {2}' };
    const { state, handlers } = setupGame('cycle_trig_board', plainCycler, { colorless: 2 }, battlefield);

    await handlers['activateCycling']({ gameId: 'cycle_trig_board', cardId: 'cycler', abilityId: 'cycling' });

    const triggers = (state.stack as any[]).filter((item) => item.type === 'triggered_ability');
    const bySource = new Map(triggers.map((t) => [t.sourceName, t]));
    expect(bySource.get('Lightning Rift')?.controller).toBe('p2');
    expect(bySource.get('Drake Haven')?.controller).toBe('p1');
    expect(bySource.has('Archfiend of Ifnir')).toBe(false);
    // Drake Haven's "cycle or discard" fires once for the cycle, not again as a discard.
    expect(triggers.filter((t) => t.sourceName === 'Drake Haven')).toHaveLength(1);
    expect(state.stack[0]).toMatchObject({ type: 'ability', abilityType: 'cycling' });
  });
});

describe('cycle trigger detection', () => {
  it('finds self, you, any-player and opponent cycle triggers', () => {
    expect(detectCycleTriggers(SHARK_TYPHOON, { sourceId: 's', controllerId: 'p1', asCycledCard: true }).map((t) => t.scope)).toEqual(['self']);
    expect(detectCycleTriggers(SHARK_TYPHOON, { sourceId: 's', controllerId: 'p1', asCycledCard: false })).toEqual([]);
    expect(detectCycleTriggers(LIGHTNING_RIFT_CARD, { sourceId: 'r', controllerId: 'p2', asCycledCard: false }).map((t) => t.scope)).toEqual(['any_player']);
    expect(detectCycleTriggers(DRAKE_HAVEN_CARD, { sourceId: 'h', controllerId: 'p1', asCycledCard: false }).map((t) => t.scope)).toEqual(['you']);
    expect(detectCycleTriggers(ARCHFIEND_CARD, { sourceId: 'a', controllerId: 'p2', asCycledCard: false }).map((t) => t.scope)).toEqual(['you']);
    expect(detectCycleTriggers(
      { name: 'Old Decree', oracle_text: 'Cycling {2}{W}\nWhen you cycle Old Decree, you gain 2 life.' },
      { sourceId: 'd', controllerId: 'p1', asCycledCard: true },
    ).map((t) => t.effect)).toEqual(['you gain 2 life.']);
  });

  it('substitutes the chosen X into the cycling cost', () => {
    expect(resolveCyclingCostX('{X}{1}{U}', 3)).toBe('{3}{1}{U}');
    expect(resolveCyclingCostX('{X}{1}{U}', 0)).toBe('{1}{U}');
    expect(resolveCyclingCostX('{X}', 0)).toBe('{0}');
  });
});
