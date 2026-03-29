import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildMerfolkLoopState() {
  return {
    players: [
      {
        id: 'p1',
        name: 'P1',
        spectator: false,
        life: 40,
      },
      {
        id: 'p2',
        name: 'P2',
        spectator: false,
        life: 40,
      },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    phase: 'main1',
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    manaPool: {
      p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    battlefield: [
      {
        id: 'anointed-procession',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'anointed-procession-card',
          name: 'Anointed Procession',
          type_line: 'Enchantment',
          oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.',
        },
      },
      {
        id: 'exalted-sunborn',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'exalted-sunborn-card',
          name: 'Exalted Sunborn',
          type_line: 'Creature — Angel Wizard',
          oracle_text: 'Flying, lifelink If one or more tokens would be created under your control, twice that many of those tokens are created instead.',
          power: '4',
          toughness: '5',
        },
      },
      {
        id: 'deeproot-waters',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'deeproot-waters-card',
          name: 'Deeproot Waters',
          type_line: 'Enchantment',
          oracle_text: 'Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof.',
        },
      },
      {
        id: 'drowner',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'drowner-card',
          name: 'Drowner of Secrets',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: 'Tap an untapped Merfolk you control: Target player mills a card.',
          power: '1',
          toughness: '3',
        },
      },
      {
        id: 'merfolk-helper-1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'merfolk-helper-1-card',
          name: 'Silvergill Adept',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk-helper-2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'merfolk-helper-2-card',
          name: 'Merfolk Trickster',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk-helper-3',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'merfolk-helper-3-card',
          name: 'Vodalian Hexcatcher',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: '',
        },
      },
      {
        id: 'merfolk-helper-4',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'merfolk-helper-4-card',
          name: 'Lord of Atlantis',
          type_line: 'Creature — Merfolk',
          oracle_text: '',
        },
      },
    ],
    zones: {
      p1: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'summon-loop',
            name: 'Summon the School',
            mana_cost: '{0}',
            manaCost: '{0}',
            type_line: 'Kindred Sorcery — Merfolk',
            oracle_text:
              'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return this card from your graveyard to your hand.',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
      p2: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
  };
}

function applyMerfolkLoopState(game: any): void {
  const state = buildMerfolkLoopState();
  if (typeof game.seedRng === 'function') {
    game.seedRng(12345);
  }

  Object.assign(game.state as any, clone(state));
  game.importDeckResolved('p2' as any, [
    {
      id: 'p2-top-card',
      name: 'Top Card',
      type_line: 'Artifact',
      oracle_text: '',
    },
    {
      id: 'p2-second-card',
      name: 'Second Card',
      type_line: 'Creature — Merfolk',
      oracle_text: '',
    },
  ] as any);
}

function getMerfolkTokenCount(game: any): number {
  return ((game.state as any).battlefield || []).filter((permanent: any) => permanent?.isToken && permanent?.controller === 'p1').length;
}

function getTappedPermanentIds(game: any): string[] {
  return ((game.state as any).battlefield || [])
    .filter((permanent: any) => permanent?.tapped)
    .map((permanent: any) => String(permanent.id))
    .sort();
}

function getTappedNonTokenIds(game: any): string[] {
  return ((game.state as any).battlefield || [])
    .filter((permanent: any) => permanent?.tapped && !permanent?.isToken)
    .map((permanent: any) => String(permanent.id))
    .sort();
}

function getTappedTokenCount(game: any): number {
  return ((game.state as any).battlefield || []).filter((permanent: any) => permanent?.isToken && permanent?.tapped).length;
}

describe('Summon the School loop replay persistence (integration)', () => {
  const gameId = 'test_summon_the_school_loop_replay';
  const replayGameId = 'test_summon_the_school_loop_replay_rehydrated';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.removeQueue(replayGameId);
    games.delete(gameId as any);
    games.delete(replayGameId as any);
  });

  it('replays a recorded Summon loop line that taps one of the newly created tokens for Drowner of Secrets', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    applyMerfolkLoopState(game);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'summon-loop',
      abilityId: 'return-from-graveyard',
    });

    const graveyardStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(graveyardStep?.type).toBe('target_selection');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(graveyardStep.id),
      selections: ['merfolk-helper-1', 'merfolk-helper-2', 'merfolk-helper-3', 'merfolk-helper-4'],
    });

    const eventsAfterReturn = getEvents(gameId).length;
    expect(((game.state as any).zones.p1.hand || []).map((card: any) => card.id)).toContain('summon-loop');

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'summon-loop',
      targets: [],
    });

    while ((((game.state as any).stack || []) as any[]).length > 0) {
      game.resolveTopOfStack();
    }

    const eventsAfterCast = getEvents(gameId).length;
    const liveTokenCount = getMerfolkTokenCount(game);
    expect(liveTokenCount).toBeGreaterThanOrEqual(12);

    const createdToken = ((game.state as any).battlefield || []).find(
      (permanent: any) => permanent?.isToken && permanent?.controller === 'p1'
    );
    expect(createdToken?.id).toBeTruthy();

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'drowner',
      abilityId: 'drowner-ability-0',
    });

    const tapStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(tapStep?.type).toBe('tap_untap_target');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(tapStep.id),
      selections: { targetIds: [String(createdToken.id)], action: 'tap' },
    });

    const playerStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(playerStep?.type).toBe('target_selection');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(playerStep.id),
      selections: ['p2'],
    });

    while ((((game.state as any).stack || []) as any[]).length > 0) {
      game.resolveTopOfStack();
    }

    const allEvents = [...getEvents(gameId)];
    const loopEvents = allEvents.filter((event: any) =>
      ['activateGraveyardAbility', 'castSpell', 'pushTriggeredAbility', 'activateBattlefieldAbility'].includes(String(event?.type || ''))
    );
    const graveyardEvents = loopEvents.slice(0, loopEvents.findIndex((event: any, index: number) => index >= eventsAfterReturn) >= 0 ? 0 : 0);
    const afterReturnEvents = allEvents.slice(0, eventsAfterReturn);
    const castStageEvents = allEvents.slice(eventsAfterReturn, eventsAfterCast);
    const drownerStageEvents = allEvents.slice(eventsAfterCast);

    const persistedDrownerEvent = drownerStageEvents.find(
      (event: any) =>
        String(event?.type || '') === 'activateBattlefieldAbility' &&
        Array.isArray(event?.payload?.targets) &&
        event.payload.targets.includes('p2')
    ) as any;
    expect(persistedDrownerEvent).toBeDefined();
    expect(persistedDrownerEvent.payload?.targets || []).toContain('p2');
    expect(persistedDrownerEvent.payload?.tappedPermanents || []).toContain(String(createdToken.id));

    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined for replay');
    applyMerfolkLoopState(replayGame);

    for (const event of afterReturnEvents) {
      replayGame.applyEvent({ type: event.type, ...(event.payload || {}) } as any);
    }

    for (const event of castStageEvents) {
      replayGame.applyEvent({ type: event.type, ...(event.payload || {}) } as any);
    }
    while ((((replayGame.state as any).stack || []) as any[]).length > 0) {
      replayGame.resolveTopOfStack();
    }

    for (const event of drownerStageEvents) {
      replayGame.applyEvent({ type: event.type, ...(event.payload || {}) } as any);
    }
    while ((((replayGame.state as any).stack || []) as any[]).length > 0) {
      replayGame.resolveTopOfStack();
    }

    expect(getMerfolkTokenCount(replayGame)).toBeGreaterThanOrEqual(12);
    expect(Math.abs(getMerfolkTokenCount(replayGame) - liveTokenCount)).toBeLessThanOrEqual(1);
    expect(getTappedTokenCount(replayGame)).toBe(getTappedTokenCount(game));
    expect(getTappedTokenCount(replayGame)).toBeGreaterThan(0);
    expect(getTappedNonTokenIds(replayGame)).toEqual(getTappedNonTokenIds(game));
    expect(((replayGame.state as any).zones.p2.graveyard || []).map((card: any) => card.id)).toEqual(
      ((game.state as any).zones.p2.graveyard || []).map((card: any) => card.id)
    );
    expect(((replayGame.state as any).zones.p2.libraryCount || 0)).toBe((game.state as any).zones.p2.libraryCount || 0);
  });
});