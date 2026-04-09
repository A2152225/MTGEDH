import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { processPendingDanceWithCalamity, processPendingLimDulsVault, processPendingPonder, processPendingProliferate } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const LIM_DULS_VAULT_ORACLE = "Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.";
const DANCE_WITH_CALAMITY_ORACLE = 'Shuffle your library. As many times as you choose, you may exile the top card of your library. If the total mana value of the cards exiled this way is 13 or less, you may cast any number of spells from among those cards without paying their mana costs.';

function initZones(game: any, playerId: string) {
  (game.state as any).zones = {
    ...(game.state as any).zones,
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
}

describe('pending-effect prompt persistence (integration)', () => {
  const ponderGameId = 'test_pending_effect_prompt_ponder';
  const proliferateGameId = 'test_pending_effect_prompt_proliferate';
  const vaultGameId = 'test_pending_effect_prompt_vault';
  const danceGameId = 'test_pending_effect_prompt_dance';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of [ponderGameId, proliferateGameId, vaultGameId, danceGameId]) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  });

  it('persists Ponder-style prompts when processPendingPonder queues the resolution step', () => {
    createGameIfNotExists(ponderGameId, 'commander', 40);
    const game = ensureGame(ponderGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game as any).gameId = ponderGameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    initZones(game, p1);
    game.importDeckResolved(p1, [
      { id: 'p_a', name: 'A', zone: 'library' },
      { id: 'p_b', name: 'B', zone: 'library' },
      { id: 'p_c', name: 'C', zone: 'library' },
    ] as any);
    (game.state as any).pendingPonder = {
      [p1]: {
        effectId: 'ponder_1',
        cardCount: 3,
        cardName: 'Ponder',
        drawAfter: true,
        targetPlayerId: p1,
        variant: 'ponder',
      },
    };

    processPendingPonder({} as any, game, ponderGameId);

    const queue = ResolutionQueueManager.getQueue(ponderGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PONDER_EFFECT);

    const promptEvent = getEvents(ponderGameId).find((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: p1,
      sourceId: 'ponder_1',
      queuedResolutionStep: {
        type: ResolutionStepType.PONDER_EFFECT,
        playerId: p1,
        effectId: 'ponder_1',
      },
    });
  });

  it('persists proliferate prompts when processPendingProliferate queues the resolution step', () => {
    createGameIfNotExists(proliferateGameId, 'commander', 40);
    const game = ensureGame(proliferateGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game as any).gameId = proliferateGameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40, counters: { energy: 2 } }];
    initZones(game, p1);
    (game.state as any).battlefield = [
      {
        id: 'perm_1',
        controller: p1,
        owner: p1,
        counters: { '+1/+1': 1 },
        card: { id: 'perm_card_1', name: 'Counter Creature', type_line: 'Creature — Test' },
      },
    ];
    (game.state as any).pendingProliferate = [
      {
        id: 'proliferate_1',
        controller: p1,
        sourceId: 'source_proliferate_1',
        sourceName: 'Proliferate Test',
      },
    ];

    processPendingProliferate({} as any, game, proliferateGameId);

    const queue = ResolutionQueueManager.getQueue(proliferateGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.PROLIFERATE);
    expect(((queue.steps[0] as any)?.availableTargets || []).map((target: any) => target.id)).toEqual(['perm_1', 'p1']);

    const promptEvent = getEvents(proliferateGameId).find((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: p1,
      sourceId: 'source_proliferate_1',
      queuedResolutionStep: {
        type: ResolutionStepType.PROLIFERATE,
        playerId: p1,
        proliferateId: 'proliferate_1',
      },
    });
  });

  it('persists Lim-Dul\'s Vault prompts when processPendingLimDulsVault queues the resolution step', () => {
    createGameIfNotExists(vaultGameId, 'commander', 40);
    const game = ensureGame(vaultGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game as any).gameId = vaultGameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    initZones(game, p1);
    game.importDeckResolved(p1, [
      { id: 'a', name: 'A', zone: 'library' },
      { id: 'b', name: 'B', zone: 'library' },
      { id: 'c', name: 'C', zone: 'library' },
      { id: 'd', name: 'D', zone: 'library' },
      { id: 'e', name: 'E', zone: 'library' },
    ] as any);
    (game.state as any).pendingLimDulsVault = {
      [p1]: {
        effectId: 'vault_1',
        sourceName: "Lim-Dûl's Vault",
        totalLifePaid: 0,
      },
    };

    processPendingLimDulsVault({} as any, game, vaultGameId);

    const queue = ResolutionQueueManager.getQueue(vaultGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.LIM_DULS_VAULT);

    const promptEvent = getEvents(vaultGameId).find((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: p1,
      sourceId: 'vault_1',
      queuedResolutionStep: {
        type: ResolutionStepType.LIM_DULS_VAULT,
        playerId: p1,
        effectId: 'vault_1',
      },
    });
  });

  it('persists the initial Dance with Calamity prompt when processPendingDanceWithCalamity queues it', () => {
    createGameIfNotExists(danceGameId, 'commander', 40);
    const game = ensureGame(danceGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game as any).gameId = danceGameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    initZones(game, p1);
    game.importDeckResolved(p1, [
      { id: 'dance_a', name: 'A', zone: 'library', cmc: 1 },
      { id: 'dance_b', name: 'B', zone: 'library', cmc: 2 },
    ] as any);
    (game.state as any).pendingDanceWithCalamity = {
      [p1]: {
        effectId: 'dance_1',
        sourceName: 'Dance with Calamity',
        sourceImage: 'https://example.com/dance.jpg',
        exiledCards: [],
        totalManaValue: 0,
        stage: 'exile',
      },
    };

    processPendingDanceWithCalamity({} as any, game, danceGameId);

    const queue = ResolutionQueueManager.getQueue(danceGameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.DANCE_WITH_CALAMITY);

    const promptEvent = getEvents(danceGameId).find((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId: p1,
      sourceId: 'dance_1',
      queuedResolutionStep: {
        type: ResolutionStepType.DANCE_WITH_CALAMITY,
        playerId: p1,
        effectId: 'dance_1',
      },
    });
  });
});