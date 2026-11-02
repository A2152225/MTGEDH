import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

type Emitted = Array<{ room?: string; event: string; payload: any }>;

const gameId = 'test_player_initiated_step_cancel_replay';
const replayGameId = gameId + '_replay';
const playerId = 'p1';
const opponentId = 'p2';

function createMockIo(emitted: Emitted, sockets: any[]) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => { emitted.push({ room, event, payload }); } }),
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id, socket])) },
  } as any;
}

function createMockSocket(emitted: Emitted) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: playerId + '_socket',
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
    to: (room: string) => ({ emit: (event: string, payload: any) => { emitted.push({ room, event, payload }); } }),
  } as any;
  return { socket, handlers };
}

async function resetGames() {
  for (const id of [gameId, replayGameId]) {
    ResolutionQueueManager.removeQueue(id);
    games.delete(id as any);
  }
  await deleteGame(gameId);
}

function land(id: string) {
  return {
    id, controller: playerId, owner: playerId, tapped: false,
    card: { name: 'Mountain', type_line: 'Basic Land - Mountain', oracle_text: '{T}: Add {R}.' },
  };
}

function seedState(s: any, hand: any[], extraBattlefield: any[]) {
  s.players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  s.startingLife = 40;
  s.life = { [playerId]: 40, [opponentId]: 40 };
  s.phase = 'precombatMain';
  s.step = 'MAIN1';
  s.turnPlayer = playerId;
  s.activePlayer = playerId;
  s.priority = playerId;
  s.stack = [];
  s.manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  s.battlefield = [
    land('mountain_1'), land('mountain_2'), land('mountain_3'),
    {
      id: 'opp_artifact', controller: opponentId, owner: opponentId, tapped: false,
      card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' },
    },
    ...extraBattlefield.map((perm) => JSON.parse(JSON.stringify(perm))),
  ];
  s.zones = {
    [playerId]: { hand: hand.map((c) => ({ ...c })), handCount: hand.length, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
}

function setupLive(hand: any[], extraBattlefield: any[] = []) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  seedState(game.state as any, hand, extraBattlefield);
  const emitted: Emitted = [];
  const { socket, handlers } = createMockSocket(emitted);
  const io = createMockIo(emitted, [socket]);
  registerResolutionHandlers(io as any, socket as any);
  registerGameActions(io as any, socket as any);
  registerInteractionHandlers(io as any, socket as any);
  return { game, s: game.state as any, emitted, handlers, eventStart: getEvents(gameId).length };
}

function toReplayEvents(startIndex: number) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) => (event?.payload && typeof event.payload === 'object'
      ? { type: event.type, ...(event.payload as Record<string, unknown>) }
      : { type: event.type }));
}

function replayInto(events: any[], hand: any[], extraBattlefield: any[] = []) {
  ResolutionQueueManager.removeQueue(replayGameId);
  const replayGame = createInitialGameState(replayGameId) as any;
  seedState(replayGame.state, hand, extraBattlefield);
  replayGame.replay(events);
  return replayGame.state as any;
}

async function cancelVia(handlers: Record<string, Function>, path: string, stepId: string, selections: any) {
  if (path === 'cancelResolutionStep') {
    await handlers['cancelResolutionStep']({ gameId, stepId });
  } else {
    await handlers['submitResolutionResponse']({ gameId, stepId, selections, cancelled: true });
  }
}

function expectReplayClean(rs: any, cardId: string | null) {
  expect(ResolutionQueueManager.getQueue(replayGameId).steps).toEqual([]);
  if (cardId) {
    expect((rs.zones[playerId].hand || []).map((c: any) => c.id)).toContain(cardId);
    const pending = Object.values(rs.pendingSpellCasts || {}).filter((entry: any) => entry?.cardId === cardId);
    expect(pending).toEqual([]);
  }
  expect(rs.stack || []).toHaveLength(0);
}

const BLAZE = {
  id: 'blaze_1', name: 'Blaze', mana_cost: '{X}{R}', manaCost: '{X}{R}', type_line: 'Sorcery',
  oracle_text: 'Blaze deals X damage to any target.',
};
const SPREE = {
  id: 'spree_1', name: 'Shattering Spree', mana_cost: '{R}', manaCost: '{R}', type_line: 'Sorcery',
  oracle_text: 'Replicate {R} (When you cast this spell, copy it for each time you paid its replicate cost. You may choose new targets for the copies.)\nDestroy target artifact.',
};
const SHATTER = {
  id: 'shatter_1', name: 'Shatter', mana_cost: '{1}{R}', manaCost: '{1}{R}', type_line: 'Instant',
  oracle_text: 'Destroy target artifact.',
};
const WALKER = {
  id: 'pw_1', controller: playerId, owner: playerId, tapped: false,
  counters: { loyalty: 5 }, loyalty: 5,
  card: {
    name: 'Test Walker', type_line: 'Legendary Planeswalker - Test', loyalty: '5',
    oracle_text: '\u2212X: Test Walker deals X damage to each opponent.\n+1: You gain 1 life.',
  },
};

const PATHS = ['cancelResolutionStep', 'submitResolutionResponse'] as const;

describe('playerInitiatedStepCancel replay', () => {
  beforeAll(async () => { await initDb(); });
  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGames();
  });
  afterEach(async () => { await resetGames(); });

  it('a cancelled cast-time Choose X step does not come back on replay', async () => {
    for (const path of PATHS) {
      await resetGames();
      const { handlers, eventStart } = setupLive([BLAZE]);
      await handlers['requestCastSpell']({ gameId, cardId: 'blaze_1' });
      const xStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st.spellCastXSelection === true) as any;
      expect(xStep).toBeDefined();
      await cancelVia(handlers, path, String(xStep.id), []);

      const events = toReplayEvents(eventStart);
      const types = events.map((e: any) => e.type);
      expect(types).toContain('castSpellContinuation');
      expect(types).toContain('playerInitiatedStepCancel');
      const cancelEvent = events.find((e: any) => e.type === 'playerInitiatedStepCancel') as any;
      expect(cancelEvent.cancelledStepIds).toContain(String(xStep.id));

      // Without the cancel event the step would be re-queued on reload.
      replayInto(events.filter((e: any) => e.type !== 'playerInitiatedStepCancel'), [BLAZE]);
      expect(ResolutionQueueManager.getQueue(replayGameId).steps.some((st: any) => st.spellCastXSelection === true)).toBe(true);

      const rs = replayInto(events, [BLAZE]);
      expectReplayClean(rs, 'blaze_1');
      expect(rs.priority).toBe(playerId);
    }
  });

  it('a cancelled Replicate count step does not come back on replay', async () => {
    for (const path of PATHS) {
      await resetGames();
      const { handlers, eventStart } = setupLive([SPREE]);
      await handlers['requestCastSpell']({ gameId, cardId: 'spree_1' });
      const rStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st.spellCastReplicateSelection === true) as any;
      expect(rStep).toBeDefined();
      await cancelVia(handlers, path, String(rStep.id), 0);

      const events = toReplayEvents(eventStart);
      expect(events.map((e: any) => e.type)).toContain('playerInitiatedStepCancel');
      const rs = replayInto(events, [SPREE]);
      expectReplayClean(rs, 'spree_1');
    }
  });

  it('a cancelled planeswalker +X/-X step does not come back on replay and pays no loyalty', async () => {
    for (const path of PATHS) {
      await resetGames();
      const { handlers, eventStart } = setupLive([], [WALKER]);
      await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'pw_1', abilityId: 'pw-ability-0' });
      const xStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) => st.planeswalkerLoyaltyX === true) as any;
      expect(xStep).toBeDefined();
      await cancelVia(handlers, path, String(xStep.id), []);

      const events = toReplayEvents(eventStart);
      const cancelEvent = events.find((e: any) => e.type === 'playerInitiatedStepCancel') as any;
      expect(cancelEvent?.planeswalkerLoyaltyX).toBe(true);
      expect(events.map((e: any) => e.type)).not.toContain('activatePlaneswalkerAbility');
      const rs = replayInto(events, [], [WALKER]);
      expectReplayClean(rs, null);
      const walker = rs.battlefield.find((p: any) => p.id === 'pw_1');
      expect(walker.counters.loyalty).toBe(5);
      expect(rs.life[opponentId]).toBe(40);
    }
  });

  it('a cancelled cast-time target selection does not come back on replay', async () => {
    for (const path of PATHS) {
      await resetGames();
      const { s, handlers, eventStart } = setupLive([SHATTER]);
      await handlers['requestCastSpell']({ gameId, cardId: 'shatter_1' });
      const tStep = ResolutionQueueManager.getQueue(gameId).steps.find((st: any) =>
        st.type === ResolutionStepType.TARGET_SELECTION && st.spellCastContext?.cardId === 'shatter_1') as any;
      expect(tStep).toBeDefined();
      await cancelVia(handlers, path, String(tStep.id), []);

      // Live: step gone, pending cast dropped, card still in hand.
      expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
      expect(s.pendingSpellCasts?.[String(tStep.spellCastContext.effectId)]).toBeUndefined();
      expect(s.zones[playerId].hand.map((c: any) => c.id)).toContain('shatter_1');

      const events = toReplayEvents(eventStart);
      const types = events.map((e: any) => e.type);
      expect(types).toContain('castSpellContinuation');
      expect(types).toContain('playerInitiatedStepCancel');

      replayInto(events.filter((e: any) => e.type !== 'playerInitiatedStepCancel'), [SHATTER]);
      expect(ResolutionQueueManager.getQueue(replayGameId).steps.some((st: any) => st.type === ResolutionStepType.TARGET_SELECTION)).toBe(true);

      const rs = replayInto(events, [SHATTER]);
      expectReplayClean(rs, 'shatter_1');
      expect(rs.pendingSpellCasts?.[String(tStep.spellCastContext.effectId)]).toBeUndefined();
    }
  });

  it('applies a bare playerInitiatedStepCancel event: cancels the re-queued step and drops the pending cast', () => {
    ResolutionQueueManager.removeQueue(replayGameId);
    const replayGame = createInitialGameState(replayGameId) as any;
    seedState(replayGame.state, [BLAZE], []);
    replayGame.state.priority = null;
    replayGame.applyEvent({
      type: 'castSpellContinuation',
      playerId,
      cardId: 'blaze_1',
      effectId: 'cast_blaze_1',
      pendingSpellCast: { effectId: 'cast_blaze_1', cardId: 'blaze_1', playerId },
      queuedResolutionStep: {
        id: 'step_x_blaze', type: ResolutionStepType.X_VALUE_SELECTION, playerId,
        description: 'Choose X', mandatory: true, spellCastXSelection: true, spellCardId: 'blaze_1',
      },
    });
    expect(ResolutionQueueManager.getQueue(replayGameId).steps.map((st: any) => st.id)).toEqual(['step_x_blaze']);

    replayGame.applyEvent({
      type: 'playerInitiatedStepCancel',
      playerId,
      stepId: 'step_x_blaze',
      cancelledStepIds: ['step_x_blaze'],
      spellCardId: 'blaze_1',
    });
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toEqual([]);
    expect(replayGame.state.pendingSpellCasts?.cast_blaze_1).toBeUndefined();
    expect(replayGame.state.priority).toBe(playerId);
  });
});
