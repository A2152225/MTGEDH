import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { applyPlayableFromGraveyardPermissionFromText } from '../src/state/modules/graveyard-permissions.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { moveResolvedInstantOrSorceryAfterResolution } from '../src/state/modules/stackResolveSpellZoneUtils.js';
import '../src/state/modules/priority.js';

const MOSSWOOD = {
  id: 'mosswood_1',
  name: 'Mosswood Dreadknight // Dread Whispers',
  layout: 'adventure',
  mana_cost: '{1}{G}',
  type_line: 'Creature — Human Knight // Sorcery — Adventure',
  oracle_text:
    'Trample\nWhen this creature dies, you may cast it from your graveyard as an Adventure until the end of your next turn.',
  power: '3',
  toughness: '2',
  colors: ['G', 'B'],
  card_faces: [
    {
      name: 'Mosswood Dreadknight',
      mana_cost: '{1}{G}',
      type_line: 'Creature — Human Knight',
      oracle_text:
        'Trample\nWhen this creature dies, you may cast it from your graveyard as an Adventure until the end of your next turn.',
      power: '3',
      toughness: '2',
      colors: ['G'],
    },
    {
      name: 'Dread Whispers',
      mana_cost: '{1}{B}',
      type_line: 'Sorcery — Adventure',
      oracle_text: 'You draw a card and you lose 1 life. (Then exile this card. You may cast the creature later from exile.)',
      colors: ['B'],
    },
  ],
};

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[]) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    sockets: { sockets: new Map(sockets.map((socket) => [socket.id || socket.data.playerId, socket])) },
  } as any;
}

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId: string,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
    data: { playerId, spectator: false, gameId },
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

describe('Adventure cast loop', () => {
  const gameId = 'test_adventure_cast_loop';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('exiles an adventure on resolution and allows casting the creature from exile', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).stack = [];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 1, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'swamp_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'swamp_card', name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '{T}: Add {B}.' },
      },
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'forest_card', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ ...MOSSWOOD }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'mosswood_1', faceIndex: 1 });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: 'swamp_1', mana: 'B', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 1 },
        ],
      },
    });

    const top = ((game.state as any).stack || [])[0] as any;
    expect(top?.card?.name).toBe('Dread Whispers');
    expect(top?.castAsAdventure).toBe(true);

    moveResolvedInstantOrSorceryAfterResolution(
      { state: game.state } as any,
      {
        controller: playerId as any,
        card: { ...MOSSWOOD },
        effectiveCard: top.card,
        item: top,
        oracleText: String(top.card?.oracle_text || ''),
      },
    );
    (game.state as any).stack = [];

    const exile = (game.state as any).zones?.[playerId]?.exile || [];
    expect(exile).toHaveLength(1);
    expect(exile[0].onAdventure).toBe(true);
    expect(exile[0].adventureUsed).toBe(true);
    expect(exile[0].adventureCaster).toBe(playerId);

    const candidates = getCastableSpellCandidates({ state: game.state } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });
    const adventureCreature = candidates.find(
      (c) => c.sourceZone === 'exile' && c.castMethod === 'adventure_creature',
    );
    expect(adventureCreature).toBeDefined();
    expect(adventureCreature?.castCard?.name).toBe('Mosswood Dreadknight');
    expect(adventureCreature?.castCard?.faceIndex).toBe(0);

    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
    };

    await handlers['requestCastSpell']({ gameId, cardId: 'mosswood_1', fromZone: 'exile' });

    const creaturePayment = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && entry.spellPaymentRequired === true,
    ) as any;
    expect(creaturePayment).toBeDefined();
    expect(creaturePayment.cardName).toBe('Mosswood Dreadknight');
    expect(creaturePayment.fromZone).toBe('exile');
  });

  it('grants Mosswood-style GY-as-Adventure permission until end of next turn', () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 5;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [{ ...MOSSWOOD, zone: 'graveyard' }],
        graveyardCount: 1,
        exile: [],
        exileCount: 0,
      },
    };

    const applied = applyPlayableFromGraveyardPermissionFromText(
      { state: game.state } as any,
      playerId as any,
      'Mosswood Dreadknight',
      'When this creature dies, you may cast it from your graveyard as an Adventure until the end of your next turn.',
      { card: { ...MOSSWOOD }, sourceId: 'mosswood_1' },
    );
    expect(applied).toBeGreaterThan(0);

    const candidates = getCastableSpellCandidates({ state: game.state } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });
    const gyAdventure = candidates.filter((c) => c.sourceZone === 'graveyard');
    expect(gyAdventure.length).toBe(1);
    expect(gyAdventure[0].castMethod).toBe('graveyard_adventure');
    expect(gyAdventure[0].castAsAdventureOnly).toBe(true);
    expect(gyAdventure[0].castCard?.name).toBe('Dread Whispers');
    expect(gyAdventure[0].castCard?.faceIndex).toBe(1);
  });
});
