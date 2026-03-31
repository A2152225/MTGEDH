import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('shock land and request-cast regressions (integration)', () => {
  const shockGameId = 'test_shock_land_decline_regression';
  const castGameId = 'test_request_cast_duplicate_regression';
  const targetedCastGameId = 'test_request_cast_targeted_completion_regression';
  const artifactCastGameId = 'test_request_cast_artifact_completion_regression';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(shockGameId);
    ResolutionQueueManager.removeQueue(castGameId);
    ResolutionQueueManager.removeQueue(targetedCastGameId);
    ResolutionQueueManager.removeQueue(artifactCastGameId);
    games.delete(shockGameId as any);
    games.delete(castGameId as any);
    games.delete(targetedCastGameId as any);
    games.delete(artifactCastGameId as any);
  });

  it('keeps Steam Vents tapped when the player chooses enter tapped through the live playLand flow', async () => {
    createGameIfNotExists(shockGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(shockGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'main1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'steam_vents_1',
            name: 'Steam Vents',
            type_line: 'Land — Island Mountain',
            oracle_text: "As Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.",
            image_uris: { small: 'https://example.com/steam.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = shockGameId;
    socket.rooms.add(shockGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId: shockGameId, cardId: 'steam_vents_1' });

    const queue = ResolutionQueueManager.getQueue(shockGameId);
    const step = queue.steps.find((entry: any) => (entry as any).shockLandChoice === true) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: shockGameId,
      stepId: String(step.id),
      selections: 'enter_tapped',
      cancelled: false,
    });

    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry.card?.name === 'Steam Vents');
    expect(permanent).toBeDefined();
    expect(Boolean(permanent?.tapped)).toBe(true);
  });

  it('re-emits the queued spell payment step instead of failing when the same card is double-clicked again', async () => {
    createGameIfNotExists(castGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(castGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'fire_sages_1',
            name: 'Fire Sages',
            mana_cost: '{1}{R}',
            manaCost: '{1}{R}',
            type_line: 'Creature — Human Shaman',
            oracle_text: 'Whenever you cast a red spell, Fire Sages deals 1 damage to any target.',
            image_uris: { small: 'https://example.com/fire-sages.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = castGameId;
    socket.rooms.add(castGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: castGameId, cardId: 'fire_sages_1' });

    const queueAfterFirst = ResolutionQueueManager.getQueue(castGameId);
    const firstPaymentStep = queueAfterFirst.steps.find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(firstPaymentStep).toBeDefined();

    const firstPrompt = emitted.find(event => event.event === 'resolutionStepPrompt');
    expect(firstPrompt?.payload?.step?.id).toBe(String(firstPaymentStep.id));
    expect(firstPrompt?.payload?.step?.type).toBe('mana_payment_choice');
    expect(Boolean(firstPrompt?.payload?.step?.spellPaymentRequired)).toBe(true);

    emitted.length = 0;
    await handlers['requestCastSpell']({ gameId: castGameId, cardId: 'fire_sages_1' });

    const queueAfterSecond = ResolutionQueueManager.getQueue(castGameId);
    const paymentSteps = queueAfterSecond.steps.filter((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true);
    expect(paymentSteps).toHaveLength(1);
    expect(String((paymentSteps[0] as any).id)).toBe(String(firstPaymentStep.id));

    const prompt = emitted.find(event => event.event === 'resolutionStepPrompt');
    expect(prompt?.payload?.step?.type).toBe('mana_payment_choice');
    expect(Boolean(prompt?.payload?.step?.spellPaymentRequired)).toBe(true);

    const noPriorityError = emitted.find(event => event.event === 'error' && event.payload?.code === 'NO_PRIORITY');
    expect(noPriorityError).toBeUndefined();
  });

  it('completes a targeted instant cast after target selection even if priority was restored before payment resumes', async () => {
    createGameIfNotExists(targetedCastGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(targetedCastGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'mountain_1',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'mountain_2',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'stack_spell_1',
        type: 'spell',
        controller: opponentId,
        canBeCountered: true,
        card: {
          id: 'furious_rise_stack_card',
          name: 'Furious Rise',
          type_line: 'Enchantment',
          image_uris: { small: 'https://example.com/furious-rise.jpg' },
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'tibalt_1',
            name: "Tibalt's Trickery",
            mana_cost: '{1}{R}',
            manaCost: '{1}{R}',
            type_line: 'Instant',
            oracle_text: "Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.",
            image_uris: { small: 'https://example.com/tibalt.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = targetedCastGameId;
    socket.rooms.add(targetedCastGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: targetedCastGameId, cardId: 'tibalt_1' });

    const targetStep = ResolutionQueueManager
      .getQueue(targetedCastGameId)
      .steps
      .find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: targetedCastGameId,
      stepId: String(targetStep.id),
      selections: ['stack_spell_1'],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(targetedCastGameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: targetedCastGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'mountain_1', mana: 'R', count: 1 },
          { permanentId: 'mountain_2', mana: 'R', count: 1 },
        ],
      },
    });

    const continueEvent = emitted.find(event => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.effectId).toBeDefined();

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);
    await new Promise(resolve => setTimeout(resolve, 0));

    const noPriorityError = emitted.find(event => event.event === 'error' && event.payload?.code === 'NO_PRIORITY');
    expect(noPriorityError).toBeUndefined();

    const stackNames = ((game.state as any).stack || []).map((entry: any) => entry.card?.name || entry.sourceName || entry.id);
    expect(stackNames).toContain('Furious Rise');
    expect(stackNames).toContain("Tibalt's Trickery");

    const handIds = (((game.state as any).zones?.[playerId]?.hand) || []).map((card: any) => card.id);
    expect(handIds).not.toContain('tibalt_1');
  });

  it('completes a targetless artifact cast after payment and removes it from hand', async () => {
    createGameIfNotExists(artifactCastGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(artifactCastGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'training_center_1',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Training Center',
          type_line: 'Land',
          oracle_text: '{T}: Add {U} or {R}.',
        },
      },
      {
        id: 'homeward_path_1',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Homeward Path',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'runechanters_pike_1',
            name: "Runechanter's Pike",
            mana_cost: '{2}',
            manaCost: '{2}',
            type_line: 'Artifact — Equipment',
            oracle_text: 'Equipped creature has first strike and gets +X/+0, where X is the number of instant and sorcery cards in your graveyard. Equip {2}.',
            image_uris: { small: 'https://example.com/pike.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = artifactCastGameId;
    socket.rooms.add(artifactCastGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: artifactCastGameId, cardId: 'runechanters_pike_1' });

    const paymentStep = ResolutionQueueManager
      .getQueue(artifactCastGameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId: artifactCastGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'training_center_1', mana: 'U', count: 1 },
          { permanentId: 'homeward_path_1', mana: 'C', count: 1 },
        ],
      },
    });

    const continueEvent = emitted.find(event => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('runechanters_pike_1');

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);

    const castError = emitted.find(event => event.event === 'error');
    expect(castError).toBeUndefined();

    const handIds = (((game.state as any).zones?.[playerId]?.hand) || []).map((card: any) => card.id);
    expect(handIds).not.toContain('runechanters_pike_1');

    const stackNames = ((game.state as any).stack || []).map((entry: any) => entry.card?.name || entry.sourceName || entry.id);
    expect(stackNames).toContain("Runechanter's Pike");

    const trainingCenter = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'training_center_1');
    expect(trainingCenter?.tapped).toBe(true);
    const homewardPath = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'homeward_path_1');
    expect(homewardPath?.tapped).toBe(true);
  });
});