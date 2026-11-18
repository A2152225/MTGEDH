import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { advanceStepPersistingEvent } from '../src/socket/step-advance.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { seedVariantDecks } from '../src/state/modules/variantDeckSeeding.js';
import { runArchenemySchemeInMotionTurnAction } from '../src/state/modules/turn-handlers/turnStepArchenemySchemeInMotion.js';

/**
 * CR 904.9: the archenemy sets the top scheme in motion as their precombat main phase begins.
 * Replay re-runs nextStep, so the turn-based action must be skipped there and the saved
 * `setSchemeInMotion` snapshot must be the only thing that moves the scheme (once, not twice).
 */

const GAME_ID = 'replay_archenemy_scheme_in_motion';
const rules = { enableArchenemy: true };

const io: any = {
  to: () => ({ emit: () => {} }),
  emit: () => {},
  sockets: { sockets: new Map() },
};

const SET_IN_MOTION = 'When you set this scheme in motion, you gain 1 life.';
const schemes = [
  { id: 's1', name: 'Scheme One', type_line: 'Scheme', oracle_text: SET_IN_MOTION },
  { id: 's2', name: 'Scheme Two', type_line: 'Scheme', oracle_text: SET_IN_MOTION },
  { id: 's3', name: 'Scheme Three', type_line: 'Scheme', oracle_text: SET_IN_MOTION },
  { id: 's4', name: 'Ongoing One', type_line: 'Ongoing Scheme', oracle_text: SET_IN_MOTION },
];

function prepare(state: any) {
  state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 20 },
    { id: 'p2', name: 'P2', spectator: false, life: 20 },
  ];
  state.houseRules = rules;
  state.startingLife = 20;
  state.phase = 'beginning';
  state.step = 'DRAW';
  state.turnPlayer = 'p1';
  state.turnNumber = 0;
  state.stack = [];
}

function seededRandom(seed = 11) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ids = (cards: any[] | undefined) => (cards || []).map((card) => card.id);

describe('archenemy sets a scheme in motion at precombat main', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue(GAME_ID);
    games.delete(GAME_ID as any);
    await deleteGame(GAME_ID);
  });

  it('moves exactly one scheme live and replays to the same decks without a second set-in-motion', async () => {
    await deleteGame(GAME_ID);
    createGameIfNotExists(GAME_ID, 'commander', 20);
    const game: any = ensureGame(GAME_ID)!;
    prepare(game.state);
    const live = game.state as any;
    live.life = live.life || {};
    live.life.p1 = 20;
    const start = getEvents(GAME_ID).length;

    seedVariantDecks(game, 'p1', { planar: [], schemes }, { gameId: GAME_ID, random: seededRandom() });
    expect(live.archenemyPlayerId).toBe('p1');
    expect(live.life.p1).toBe(40); // CR 904.5
    const deckBefore = ids(live.schemeDeck);
    const topId = deckBefore[0]!;
    const topIsOngoing = topId === 's4';
    live.turnNumber = 1;

    expect(advanceStepPersistingEvent(io, game, GAME_ID)).toBe(true);
    expect(live.step).toBe('MAIN1');

    // One scheme moved: an ongoing scheme stays face up, a regular one goes back under the deck.
    if (topIsOngoing) {
      expect(ids(live.ongoingSchemes)).toEqual([topId]);
      expect(ids(live.schemeDeck)).toEqual(deckBefore.slice(1));
    } else {
      expect(live.lastSchemeInMotion?.id).toBe(topId);
      expect(ids(live.schemeDeck)).toEqual([...deckBefore.slice(1), topId]);
      expect(live.ongoingSchemes).toEqual([]);
    }

    // Its "when you set this scheme in motion" ability is on the stack once.
    expect(live.stack.filter((item: any) => item.triggerType === 'scheme_in_motion')).toHaveLength(1);

    const saved = getEvents(GAME_ID).slice(start);
    expect(saved.filter((event: any) => event.type === 'setSchemeInMotion')).toHaveLength(1);

    // Replay re-runs nextStep, but the turn-based action must not run a second time.
    const replayGame: any = createInitialGameState(`${GAME_ID}_replay`);
    prepare(replayGame.state);
    replayGame.state.life = replayGame.state.life || {};
    replayGame.state.life.p1 = 20;
    replayGame.replay!(saved.map((event: any) => ({ type: event.type, ...(event.payload || {}) })) as any);
    const replayed = replayGame.state as any;

    expect(replayed.step).toBe('MAIN1');
    expect(replayed.stack.filter((item: any) => item.triggerType === 'scheme_in_motion')).toHaveLength(1);
    expect(ids(replayed.schemeDeck)).toEqual(ids(live.schemeDeck));
    expect(ids(replayed.ongoingSchemes)).toEqual(ids(live.ongoingSchemes));
    expect(replayed.lastSchemeInMotion?.id).toBe(live.lastSchemeInMotion?.id);
    expect(replayed.life.p1).toBe(40);
  });

  it('does nothing for other players, with an empty deck, when Archenemy is off, or while replaying', () => {
    const base = () => {
      const ctx: any = { gameId: 'unit-archenemy', state: {}, bumpSeq() {} };
      prepare(ctx.state);
      ctx.state.archenemyPlayerId = 'p1';
      ctx.state.schemeDeck = schemes.map((scheme) => ({ ...scheme }));
      ctx.state.ongoingSchemes = [];
      ctx.state.schemeGraveyard = [];
      return ctx;
    };

    const notArchenemyTurn = base();
    runArchenemySchemeInMotionTurnAction(notArchenemyTurn, 'p2');
    expect(notArchenemyTurn.state.schemeDeck).toHaveLength(4);
    expect(notArchenemyTurn.state.lastSchemeInMotion).toBeUndefined();

    const emptyDeck = base();
    emptyDeck.state.schemeDeck = [];
    runArchenemySchemeInMotionTurnAction(emptyDeck, 'p1');
    expect(emptyDeck.state.lastSchemeInMotion).toBeUndefined();

    const off = base();
    off.state.houseRules = {};
    runArchenemySchemeInMotionTurnAction(off, 'p1');
    expect(off.state.schemeDeck).toHaveLength(4);

    const replaying = base();
    replaying.isReplaying = true;
    runArchenemySchemeInMotionTurnAction(replaying, 'p1');
    expect(replaying.state.schemeDeck.map((scheme: any) => scheme.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(replaying.state.lastSchemeInMotion).toBeUndefined();
  });
});
