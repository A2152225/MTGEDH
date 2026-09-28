import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
// The exact payload builder the client uses for socket.emit('playLand', ...).
import { buildPlayLandRequestPayload } from '../../client/src/utils/playLandRequestPayload';

type Emitted = Array<{ room?: string; event: string; payload: any }>;

const CONDUIT_ORACLE = "You may play lands from your graveyard.\n{T}: Choose target nonland permanent card in your graveyard. If you haven't cast a spell this turn, you may cast that card. If you do, you can't cast additional spells this turn. Activate only as a sorcery.";

function createMockIo(emitted: Emitted) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Emitted) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try { await deleteGame(gameId); } catch { /* test-only ids */ }
}

function setupGame(gameId: string, opts: { withConduit: boolean; landsPlayed?: number }) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const s = game.state as any;
  s.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40, isAI: false },
    { id: 'p2', name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  s.turnOrder = ['p1', 'p2'];
  s.startingLife = 40;
  s.life = { p1: 40, p2: 40 };
  s.phase = 'precombatMain';
  s.step = 'MAIN1';
  s.turnPlayer = 'p1';
  s.priority = 'p1';
  s.turnNumber = 3;
  s.stack = [];
  s.battlefield = opts.withConduit
    ? [{ id: 'conduit_perm', controller: 'p1', owner: 'p1', tapped: false, card: { id: 'conduit_card', name: 'Conduit of Worlds', type_line: 'Artifact', oracle_text: CONDUIT_ORACLE } }]
    : [];
  s.manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  s.landsPlayedThisTurn = { p1: opts.landsPlayed ?? 0, p2: 0 };
  s.zones = {
    p1: {
      hand: [], handCount: 0,
      graveyard: [
        { id: 'gy_forest', name: 'Forest', type_line: 'Basic Land \u2014 Forest', oracle_text: '({T}: Add {G}.)', image_uris: { small: 'https://example.com/forest.jpg' } },
      ],
      graveyardCount: 1,
      exile: [], exileCount: 0, library: [], libraryCount: 0,
    },
    p2: {
      hand: [], handCount: 0,
      graveyard: [
        { id: 'opp_gy_island', name: 'Island', type_line: 'Basic Land \u2014 Island', oracle_text: '({T}: Add {U}.)' },
      ],
      graveyardCount: 1,
      exile: [], exileCount: 0, library: [], libraryCount: 0,
    },
  };
  return game;
}

describe('playLand from graveyard with the live rules bridge (Conduit of Worlds)', () => {
  const gameId = 'test_play_land_gy_live_bridge';
  let previousIo: any;

  beforeAll(async () => {
    await initDb();
    previousIo = GameManager.getIOServer();
    // A real server has an IO server, which makes the playLand handler validate through the RulesBridge.
    GameManager.setIOServer(createMockIo([]));
  });

  afterAll(() => {
    GameManager.setIOServer(previousIo);
  });

  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('plays a graveyard land with the exact client payload, moving it to the battlefield and using the land drop', async () => {
    const game = setupGame(gameId, { withConduit: true });
    const emitted: Emitted = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createMockIo(emitted), socket);

    const payload = buildPlayLandRequestPayload({ gameId, cardId: 'gy_forest', fromZone: 'graveyard' });
    expect(payload).toEqual({ gameId, cardId: 'gy_forest', fromZone: 'graveyard' });
    await handlers['playLand'](payload);

    const errors = emitted.filter((e) => e.event === 'error').map((e) => e.payload);
    expect(errors).toEqual([]);
    expect(GameManager.getRulesBridge(gameId)).toBeDefined();

    const s = game.state as any;
    expect(s.battlefield.some((p: any) => p?.card?.id === 'gy_forest' && p.controller === 'p1')).toBe(true);
    expect(s.zones.p1.graveyard.some((c: any) => c?.id === 'gy_forest')).toBe(false);
    expect(s.landsPlayedThisTurn.p1).toBe(1);
  });

  it('the rules-engine mirror only accepts a static graveyard permission when the server vouches for it', () => {
    setupGame(gameId, { withConduit: true });
    const bridge = GameManager.syncRulesBridge(gameId, (ensureGame(gameId) as any).state);
    expect(bridge).toBeDefined();
    const base = { type: 'playLand', playerId: 'p1', cardId: 'gy_forest', fromZone: 'graveyard' };
    // This is what the live handler used to send: Conduit's static permission is invisible to the engine.
    expect(bridge!.validateAction(base).legal).toBe(false);
    expect(bridge!.validateAction({ ...base, serverVerifiedZonePermission: true }).legal).toBe(true);
  });

  it('rejects a graveyard land without a permission source, even if the client claims a bypass', async () => {
    const game = setupGame(gameId, { withConduit: false });
    const emitted: Emitted = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createMockIo(emitted), socket);

    await handlers['playLand']({ ...buildPlayLandRequestPayload({ gameId, cardId: 'gy_forest', fromZone: 'graveyard' }), bypassGraveyardPermissionCheck: true });

    const codes = emitted.filter((e) => e.event === 'error').map((e) => e.payload?.code);
    expect(codes).toContain('NO_PERMISSION');
    const s = game.state as any;
    expect(s.zones.p1.graveyard.some((c: any) => c?.id === 'gy_forest')).toBe(true);
    expect(s.landsPlayedThisTurn.p1).toBe(0);
  });

  it("rejects playing a land from an opponent's graveyard", async () => {
    const game = setupGame(gameId, { withConduit: true });
    const emitted: Emitted = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createMockIo(emitted), socket);

    await handlers['playLand'](buildPlayLandRequestPayload({ gameId, cardId: 'opp_gy_island', fromZone: 'graveyard' }));

    expect(emitted.some((e) => e.event === 'error')).toBe(true);
    expect((game.state as any).zones.p2.graveyard.some((c: any) => c?.id === 'opp_gy_island')).toBe(true);
    expect((game.state as any).landsPlayedThisTurn.p1).toBe(0);
  });

  it('rejects a graveyard land once the land drop is used', async () => {
    const game = setupGame(gameId, { withConduit: true, landsPlayed: 1 });
    const emitted: Emitted = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    registerGameActions(createMockIo(emitted), socket);

    await handlers['playLand'](buildPlayLandRequestPayload({ gameId, cardId: 'gy_forest', fromZone: 'graveyard' }));

    const codes = emitted.filter((e) => e.event === 'error').map((e) => e.payload?.code);
    expect(codes).toContain('LAND_LIMIT_REACHED');
    expect((game.state as any).zones.p1.graveyard.some((c: any) => c?.id === 'gy_forest')).toBe(true);
  });
});
