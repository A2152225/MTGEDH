import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { PUT_NO_HAND_CARDS_OPTION_ID } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerHandCardToLibraryPrompts.js';

// Quoted from Valakut Awakening (ZNR).
const VALAKUT_ORACLE =
  'Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.';

const gameId = 'valakut_awakening_choice';
const p1 = 'p1' as any;

function handCards() {
  return [
    { id: 'hand-a', name: 'Shock', type_line: 'Instant', zone: 'hand' },
    { id: 'hand-b', name: 'Lightning Bolt', type_line: 'Instant', zone: 'hand' },
    { id: 'hand-c', name: 'Opt', type_line: 'Instant', zone: 'hand' },
  ];
}

function libraryCards() {
  return [
    { id: 'lib-1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
    { id: 'lib-2', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
    { id: 'lib-3', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
    { id: 'lib-4', name: 'Swamp', type_line: 'Basic Land — Swamp', zone: 'library' },
  ];
}

async function reset() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Valakut Awakening', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    await reset();
  });

  it('offers any number of hand cards, bottoms the chosen ones, then draws that many plus one', async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    await reset();
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const state = game.state as any;
    state.players = [{ id: p1, name: 'A2', spectator: false, life: 40 }];
    state.life = { [p1]: 40 };
    state.turnPlayer = p1;
    state.priority = p1;
    state.phase = 'precombatMain';
    state.zones = {
      [p1]: {
        hand: handCards(),
        handCount: 3,
        library: libraryCards(),
        libraryCount: 4,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([[p1, libraryCards()]]);
    const player = state.players[0];
    player.hand = handCards();
    player.library = libraryCards();

    const eventStart = getEvents(gameId).length;
    const outcome = tryResolveSpellViaOracleIR(game as any, {
      controller: p1,
      spellName: 'Valakut Awakening',
      oracleText: VALAKUT_ORACLE,
      sourceId: 'valakut-1',
    });

    expect(outcome.handled).toBe(true);
    const prompt = (ResolutionQueueManager.getQueue(gameId)?.steps || [])
      .find((step: any) => step.moveChosenHandCardToLibraryChoice === true) as any;
    expect(prompt).toBeTruthy();
    expect(prompt.moveChosenHandCardToLibraryAnyNumber).toBe(true);
    expect(prompt.moveChosenHandCardToLibraryPosition).toBe('bottom');
    expect(prompt.minSelections).toBe(1);
    expect(prompt.maxSelections).toBe(3);
    expect(prompt.options.map((option: any) => option.id)).toEqual([
      'hand-a',
      'hand-b',
      'hand-c',
      PUT_NO_HAND_CARDS_OPTION_ID,
    ]);
    expect(state.zones[p1].hand.map((card: any) => card.id)).toEqual(['hand-a', 'hand-b', 'hand-c']);

    const handlers: Record<string, Function> = {};
    const socket = {
      data: { playerId: p1, spectator: false, gameId },
      rooms: new Set<string>([gameId]),
      on: (event: string, fn: Function) => { handlers[event] = fn; },
      emit: () => {},
    } as any;
    const io = {
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map([['s_0', socket]]) },
    } as any;
    registerResolutionHandlers(io, socket);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: prompt.id,
      selections: ['hand-b', 'hand-a'],
    });

    const library = ((game as any).libraries.get(p1) || []).map((card: any) => card.id);
    const hand = (state.zones[p1].hand || []).map((card: any) => card.id);
    expect(library).toEqual(['lib-4', 'hand-b', 'hand-a']);
    expect(hand).toEqual(['hand-c', 'lib-1', 'lib-2', 'lib-3']);

    const saved = getEvents(gameId).slice(eventStart);
    expect(saved.some((event: any) => event.type === 'moveChosenHandCardToLibraryChoiceResolve')).toBe(true);
    expect(saved.some((event: any) => event.type === 'drawCards' && Number(event.payload?.count) === 3)).toBe(true);

    const replayGame = createInitialGameState(`${gameId}_replay`);
    const replayState = replayGame.state as any;
    replayState.players = [{ id: p1, name: 'A2', spectator: false, life: 40, hand: handCards(), library: libraryCards() }];
    replayState.zones = {
      [p1]: {
        hand: handCards(),
        handCount: 3,
        library: libraryCards(),
        libraryCount: 4,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (replayGame as any).libraries = new Map([[p1, libraryCards()]]);
    (replayGame as any).gameId = `${gameId}_replay`;
    replayGame.replay(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);

    expect(((replayGame as any).libraries.get(p1) || []).map((card: any) => card.id)).toEqual(library);
    expect((replayState.zones[p1].hand || []).map((card: any) => card.id)).toEqual(hand);
  });
});
