import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { seedVariantDecks } from '../src/state/modules/variantDeckSeeding.js';
import { performPlanarDieSpecialAction } from '../src/state/modules/planarDieSpecialAction.js';

/**
 * The planar die roll is a special action (CR 901.9). Reload replays the saved log and never
 * re-rolls, so the `planarDieRoll` event must carry the face, the generic cost paid and the
 * per-turn counter. A planeswalk result is saved by its own `planeswalk` snapshot event and must
 * be applied exactly once on replay.
 */

const GAME_ID = 'replay_planar_die_roll';
const rules = { enablePlanechase: true };

const plane = (n: number) => ({ id: `plane-${n}`, name: `Plane ${n}`, type_line: 'Plane — Test', oracle_text: '' });
const phenomenon = { id: 'phen-1', name: 'Phenomenon One', type_line: 'Phenomenon', oracle_text: '' };

function prepare(state: any) {
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  state.houseRules = rules;
  state.phase = 'precombatMain';
  state.step = 'MAIN1';
  state.turnPlayer = 'p1';
  state.priority = 'p1';
  state.turnNumber = 0;
  state.stack = [];
}

function seededRandom(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ctxOf = (game: any) => ({ ...game, gameId: GAME_ID, state: game.state }) as any;
const ids = (cards: any[] | undefined) => (cards || []).map((card) => card.id);

describe('planar die roll survives reload', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue(GAME_ID);
    games.delete(GAME_ID as any);
    await deleteGame(GAME_ID);
  });

  it('free first roll, paid later rolls and a planeswalk replay to the same state, applied once', async () => {
    await deleteGame(GAME_ID);
    createGameIfNotExists(GAME_ID, 'commander', 40);
    const game: any = ensureGame(GAME_ID)!;
    prepare(game.state);
    const live = game.state as any;
    const start = getEvents(GAME_ID).length;

    seedVariantDecks(
      game,
      'p1',
      { planar: [...Array.from({ length: 11 }, (_, i) => plane(i + 1)), phenomenon], schemes: [] },
      { gameId: GAME_ID, random: seededRandom() },
    );
    const startingPlaneId = live.currentPlane.id;

    // 1st roll is free.
    const first = performPlanarDieSpecialAction(ctxOf(game), 'p1', { face: 'blank' });
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(first).toMatchObject({ ok: true, face: 'blank', cost: 0, actionsThisTurn: 1 });
    expect(live.currentPlane.id).toBe(startingPlaneId);

    // 2nd roll costs {1}: refused with an empty pool, nothing saved or counted.
    const eventsBefore = getEvents(GAME_ID).length;
    const refused = performPlanarDieSpecialAction(ctxOf(game), 'p1', { face: 'planeswalk' });
    expect(refused.ok).toBe(false);
    expect((refused as any).reason).toMatch(/costs \{1\}/);
    expect(getEvents(GAME_ID).length).toBe(eventsBefore);
    expect(live.planarDieSpecialActionsThisTurn.p1).toBe(1);

    // Pay {1} from the floating pool and planeswalk.
    live.manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
    const second = performPlanarDieSpecialAction(ctxOf(game), 'p1', { face: 'planeswalk' });
    expect(second).toMatchObject({ ok: true, face: 'planeswalk', cost: 1, actionsThisTurn: 2 });
    expect(live.manaPool.p1.colorless).toBe(0);
    expect(live.currentPlane.id).not.toBe(startingPlaneId);
    expect(live.planeswalksAttempted).toBe(1);

    // The third roll now costs {2}.
    const third = performPlanarDieSpecialAction(ctxOf(game), 'p1', { face: 'blank' });
    expect(third.ok).toBe(false);
    expect((third as any).reason).toMatch(/costs \{2\}/);

    const saved = getEvents(GAME_ID).slice(start);
    const rollEvents = saved.filter((event: any) => event.type === 'planarDieRoll') as any[];
    expect(rollEvents.map((event) => [event.payload.face, event.payload.cost, event.payload.actionsThisTurn])).toEqual([
      ['blank', 0, 1],
      ['planeswalk', 1, 2],
    ]);
    expect(saved.filter((event: any) => event.type === 'planeswalk')).toHaveLength(1);

    // Replay into a fresh game that has the same pre-game state and the {1} the player tapped.
    const replayGame: any = createInitialGameState(`${GAME_ID}_replay`);
    prepare(replayGame.state);
    replayGame.state.manaPool = { p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 } };
    replayGame.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);
    const replayed = replayGame.state as any;

    expect(replayed.currentPlane?.id).toBe(live.currentPlane.id);
    expect(ids(replayed.planarDeckFaceDown)).toEqual(ids(live.planarDeckFaceDown));
    expect(replayed.planarDieSpecialActionsThisTurn).toEqual({ p1: 2 });
    expect(replayed.manaPool.p1.colorless).toBe(0);
    expect(replayed.planeswalksAttempted).toBe(1); // applied once, not once per event
    expect(replayed.planarDieRollsThisTurn.map((roll: any) => roll.face)).toEqual(['blank', 'planeswalk']);
    expect(replayed.lastPlanarDieRoll).toMatchObject({ playerId: 'p1', face: 'planeswalk' });
  });
});
