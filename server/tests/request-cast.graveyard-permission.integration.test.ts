import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // Ignore cleanup failures for non-existent test rows.
  }
}

describe('requestCastSpell graveyard permission windows (integration)', () => {
  const gameId = 'test_request_cast_graveyard_permission_window';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  function setupGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const consider = {
      id: 'consider_1',
      name: 'Consider',
      mana_cost: '{U}',
      manaCost: '{U}',
      type_line: 'Instant',
      oracle_text: 'Look at the top card of your library. You may put that card into your graveyard. Draw a card.',
      image_uris: { small: 'https://example.com/consider.jpg' },
    };
    const bear = {
      id: 'bear_1',
      name: 'Runeclaw Bear',
      mana_cost: '{1}{G}',
      manaCost: '{1}{G}',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      image_uris: { small: 'https://example.com/bear.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [consider, bear],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 2, colorless: 0 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'kess_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'kess_card',
          name: 'Kess, Dissident Mage',
          type_line: 'Legendary Creature — Human Wizard',
          oracle_text: 'Flying\nOnce during each of your turns, you may cast an instant or sorcery spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 2, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [consider, bear],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupLurrusGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const mindStone = {
      id: 'mind_stone_1',
      name: 'Mind Stone',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
      image_uris: { small: 'https://example.com/mind-stone.jpg' },
    };
    const hedronArchive = {
      id: 'hedron_archive_1',
      name: 'Hedron Archive',
      mana_cost: '{4}',
      manaCost: '{4}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      image_uris: { small: 'https://example.com/hedron-archive.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [mindStone, hedronArchive],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'lurrus_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'lurrus_card',
          name: 'Lurrus of the Dream-Den',
          type_line: 'Legendary Creature — Cat Nightmare',
          oracle_text: 'Lifelink\nOnce during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [mindStone, hedronArchive],
        graveyardCount: 2,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupRivazGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const dragon = {
      id: 'dragon_spell_1',
      name: 'Scorchscale Dragon',
      mana_cost: '{2}{R}',
      manaCost: '{2}{R}',
      type_line: 'Creature — Dragon',
      oracle_text: 'Flying',
      power: '3',
      toughness: '3',
      image_uris: { small: 'https://example.com/dragon.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [dragon],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'rivaz_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'rivaz_card',
          name: 'Rivaz of the Claw',
          type_line: 'Legendary Creature — Lizard Warlock',
          oracle_text: 'Menace\n{T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon creature spells.\nOnce during each of your turns, you may cast a Dragon creature spell from your graveyard.\nWhenever you cast a Dragon creature spell from your graveyard, it gains "When this creature dies, exile it."',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [dragon],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupSixGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const mindStone = {
      id: 'six_mind_stone_1',
      name: 'Mind Stone',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
      image_uris: { small: 'https://example.com/mind-stone.jpg' },
    };
    const forest = {
      id: 'six_forest_1',
      name: 'Forest',
      mana_cost: '',
      manaCost: '',
      type_line: 'Basic Land — Forest',
      oracle_text: '({T}: Add {G}.)',
      image_uris: { small: 'https://example.com/forest.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [forest],
        library: [],
        graveyard: [mindStone],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'six_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'six_card',
          name: 'Six',
          type_line: 'Legendary Creature — Treefolk',
          oracle_text: 'Reach\nWhenever Six attacks, mill three cards. You may put a land card from among them into your hand.\nDuring your turn, nonland permanent cards in your graveyard have retrace. (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [forest],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [mindStone],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupExplorationBroodshipGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const mindStone = {
      id: 'broodship_mind_stone_1',
      name: 'Mind Stone',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}.',
      image_uris: { small: 'https://example.com/mind-stone.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [mindStone],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'exploration_broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'exploration_broodship_card',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: 'Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It\'s an artifact creature at 8+.)\n3+ | You may play an additional land on each of your turns.\n8+ | Flying\nOnce during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.',
        },
      },
      {
        id: 'broodship_forest_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'broodship_forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [mindStone],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupQuilledGreatwurmGame(options?: { totalCounters?: number }) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const greatwurm = {
      id: 'quilled_greatwurm_1',
      name: 'Quilled Greatwurm',
      mana_cost: '{4}{G}{G}',
      manaCost: '{4}{G}{G}',
      type_line: 'Creature - Wurm',
      oracle_text: 'Trample\nWhenever a creature you control deals combat damage during your turn, put that many +1/+1 counters on it. (It must survive to get the counters.)\nYou may cast this card from your graveyard by removing six counters from among creatures you control in addition to paying its other costs.',
      power: '7',
      toughness: '7',
      image_uris: { small: 'https://example.com/quilled-greatwurm.jpg' },
    };
    const firstCreatureCounters = Math.min(4, Math.max(0, Number(options?.totalCounters ?? 6)));
    const secondCreatureCounters = Math.max(0, Math.min(2, Number(options?.totalCounters ?? 6) - firstCreatureCounters));

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [greatwurm],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 6, colorless: 0 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'greatwurm_bear_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: firstCreatureCounters > 0 ? { '+1/+1': firstCreatureCounters } : {},
        card: {
          id: 'greatwurm_bear_card',
          name: 'Counter Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'greatwurm_snake_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: secondCreatureCounters > 0 ? { shield: secondCreatureCounters } : {},
        card: {
          id: 'greatwurm_snake_card',
          name: 'Shielded Snake',
          type_line: 'Creature - Snake',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'greatwurm_relic_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'greatwurm_relic_card',
          name: 'Charged Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
      {
        id: 'greatwurm_opponent_creature_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: { '+1/+1': 6 },
        card: {
          id: 'greatwurm_opponent_creature_card',
          name: 'Opponent Counter Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 6, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [greatwurm],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupChainerGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const discardCard = {
      id: 'chainer_discard_1',
      name: 'Mountain',
      mana_cost: '',
      manaCost: '',
      type_line: 'Basic Land — Mountain',
      oracle_text: '({T}: Add {R}.)',
      image_uris: { small: 'https://example.com/mountain.jpg' },
    };
    const creatureCard = {
      id: 'chainer_sable_1',
      name: 'Bronze Sable',
      mana_cost: '{2}',
      manaCost: '{2}',
      type_line: 'Artifact Creature — Sable',
      oracle_text: '',
      image_uris: { small: 'https://example.com/bronze-sable.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [discardCard],
        library: [],
        graveyard: [creatureCard],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'chainer_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'chainer_card',
          name: 'Chainer, Nightmare Adept',
          type_line: 'Legendary Creature — Human Minion',
          oracle_text: 'Discard a card: You may cast a creature spell from your graveyard this turn. Activate only once each turn.\nWhenever a nontoken creature enters the battlefield under your control, if you didn\'t cast it from your hand, it gains haste.',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [discardCard],
        handCount: 1,
        exile: [],
        exileCount: 0,
        graveyard: [creatureCard],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupHarmonizeGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const naturesRhythm = {
      id: 'natures_rhythm_1',
      name: "Nature's Rhythm",
      mana_cost: '{X}{G}{G}',
      manaCost: '{X}{G}{G}',
      type_line: 'Sorcery',
      oracle_text: 'Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.\nHarmonize {X}{G}{G}{G}{G} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by an amount of generic mana equal to its power. Then exile this spell.)',
      image_uris: { small: 'https://example.com/natures-rhythm.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [naturesRhythm],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 4, colorless: 0 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'harmonize_bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'harmonize_bear_card',
          name: 'Harmony Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '3',
          toughness: '3',
          image_uris: { small: 'https://example.com/harmony-bear.jpg' },
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 4, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [naturesRhythm],
        graveyardCount: 1,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupIgniteTheFutureGame(options?: { fromGraveyard?: boolean }) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const fromGraveyard = options?.fromGraveyard === true;
    const igniteTheFuture = {
      id: 'ignite_the_future_1',
      name: 'Ignite the Future',
      mana_cost: '{3}{R}',
      manaCost: '{3}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Exile the top three cards of your library. Until the end of your next turn, you may play those cards. If this spell was cast from a graveyard, you may play cards this way without paying their mana costs. Flashback {7}{R}.',
      image_uris: { small: 'https://example.com/ignite-the-future.jpg' },
    };
    const shivanDragon = {
      id: 'shivan_dragon_1',
      name: 'Shivan Dragon',
      mana_cost: '{4}{R}{R}',
      manaCost: '{4}{R}{R}',
      type_line: 'Creature — Dragon',
      oracle_text: 'Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.',
      power: '5',
      toughness: '5',
      image_uris: { small: 'https://example.com/shivan-dragon.jpg' },
    };
    const mountain = {
      id: 'ignite_mountain_1',
      name: 'Mountain',
      mana_cost: '',
      manaCost: '',
      type_line: 'Basic Land — Mountain',
      oracle_text: '({T}: Add {R}.)',
      image_uris: { small: 'https://example.com/mountain.jpg' },
    };
    const bear = {
      id: 'ignite_bear_1',
      name: 'Grizzly Bears',
      mana_cost: '{1}{G}',
      manaCost: '{1}{G}',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      image_uris: { small: 'https://example.com/grizzly-bears.jpg' },
    };
    const library = [shivanDragon, mountain, bear];
    const redMana = fromGraveyard ? 8 : 4;
    const hand = fromGraveyard ? [] : [igniteTheFuture];
    const graveyard = fromGraveyard ? [igniteTheFuture] : [];

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand,
        library: [...library],
        graveyard,
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: redMana, green: 0, colorless: 0 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 1;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: redMana, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand,
        handCount: hand.length,
        exile: [],
        exileCount: 0,
        graveyard,
        graveyardCount: graveyard.length,
        library: [],
        libraryCount: library.length,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, [...library]);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupLidlessGazeGame(options?: { fromGraveyard?: boolean }) {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const fromGraveyard = options?.fromGraveyard === true;
    const lidlessGaze = {
      id: 'lidless_gaze_1',
      name: 'Lidless Gaze',
      mana_cost: '{2}{B}{R}',
      manaCost: '{2}{B}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Exile the top card of each player\'s library. Until the end of your next turn, you may play those cards, and mana of any type can be spent to cast those spells.\nFlashback {2}{B}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      image_uris: { small: 'https://example.com/lidless-gaze.jpg' },
    };
    const playerMountain = {
      id: 'lidless_mountain_1',
      name: 'Mountain',
      mana_cost: '',
      manaCost: '',
      type_line: 'Basic Land — Mountain',
      oracle_text: '({T}: Add {R}.)',
      image_uris: { small: 'https://example.com/lidless-mountain.jpg' },
    };
    const opponentConsider = {
      id: 'lidless_opponent_consider_1',
      name: 'Consider',
      mana_cost: '{U}',
      manaCost: '{U}',
      type_line: 'Instant',
      oracle_text: 'Look at the top card of your library. You may put that card into your graveyard. Draw a card.',
      image_uris: { small: 'https://example.com/lidless-opponent-consider.jpg' },
    };
    const playerLibrary = [playerMountain];
    const opponentLibrary = [opponentConsider];
    const hand = fromGraveyard ? [] : [lidlessGaze];
    const graveyard = fromGraveyard ? [lidlessGaze] : [];
    const manaPool = fromGraveyard
      ? { white: 0, blue: 0, black: 1, red: 2, green: 0, colorless: 2 }
      : { white: 0, blue: 0, black: 1, red: 1, green: 0, colorless: 2 };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand,
        library: [...playerLibrary],
        graveyard,
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { ...manaPool },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [...opponentLibrary],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 1;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { ...manaPool },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand,
        handCount: hand.length,
        exile: [],
        exileCount: 0,
        graveyard,
        graveyardCount: graveyard.length,
        library: [],
        libraryCount: playerLibrary.length,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: opponentLibrary.length,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, [...playerLibrary]);
    (game as any).libraries.set(opponentId, [...opponentLibrary]);

    return game;
  }

  function setupMishraResearchDeskGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const researchDesk = {
      id: 'research_desk_1',
      name: "Mishra's Research Desk",
      mana_cost: '{1}',
      manaCost: '{1}',
      type_line: 'Artifact',
      oracle_text: '{1}, {T}, Sacrifice this artifact: Exile the top two cards of your library. Choose one of them. Until the end of your next turn, you may play that card.\nUnearth {1}{R} ({1}{R}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
      image_uris: { small: 'https://example.com/research-desk.jpg' },
    };
    const mishrasBauble = {
      id: 'research_bauble_1',
      name: "Mishra's Bauble",
      mana_cost: '{0}',
      manaCost: '{0}',
      type_line: 'Artifact',
      oracle_text: '{T}, Sacrifice Mishra\'s Bauble: Look at the top card of target player\'s library. Draw a card at the beginning of the next turn\'s upkeep.',
      image_uris: { small: 'https://example.com/mishras-bauble.jpg' },
    };
    const giantGrowth = {
      id: 'research_growth_1',
      name: 'Giant Growth',
      mana_cost: '{G}',
      manaCost: '{G}',
      type_line: 'Instant',
      oracle_text: 'Target creature gets +3/+3 until end of turn.',
      image_uris: { small: 'https://example.com/giant-growth.jpg' },
    };
    const library = [mishrasBauble, giantGrowth];

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [...library],
        graveyard: [researchDesk],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [researchDesk],
        graveyardCount: 1,
        library: [],
        libraryCount: library.length,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, [...library]);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  function setupZenithFestivalGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const zenithFestival = {
      id: 'zenith_festival_1',
      name: 'Zenith Festival',
      mana_cost: '{X}{R}{R}',
      manaCost: '{X}{R}{R}',
      type_line: 'Sorcery',
      oracle_text: 'Exile the top X cards of your library. You may play them until the end of your next turn.\nHarmonize {X}{R}{R} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by an amount of generic mana equal to its power. Then exile this spell.)',
      image_uris: { small: 'https://example.com/zenith-festival.jpg' },
    };
    const ragingGoblin = {
      id: 'zenith_goblin_1',
      name: 'Raging Goblin',
      mana_cost: '{R}',
      manaCost: '{R}',
      type_line: 'Creature — Goblin Berserker',
      oracle_text: 'Haste',
      power: '1',
      toughness: '1',
      image_uris: { small: 'https://example.com/raging-goblin.jpg' },
    };
    const mountain = {
      id: 'zenith_mountain_1',
      name: 'Mountain',
      mana_cost: '',
      manaCost: '',
      type_line: 'Basic Land — Mountain',
      oracle_text: '({T}: Add {R}.)',
      image_uris: { small: 'https://example.com/zenith-mountain.jpg' },
    };
    const library = [ragingGoblin, mountain];

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [...library],
        graveyard: [zenithFestival],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 3, green: 0, colorless: 0 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 1;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'zenith_bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'zenith_bear_card',
          name: 'Zenith Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '3',
          toughness: '3',
          image_uris: { small: 'https://example.com/zenith-bear.jpg' },
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 3, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [zenithFestival],
        graveyardCount: 1,
        library: [],
        libraryCount: library.length,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, [...library]);
    (game as any).libraries.set(opponentId, []);

    return game;
  }

  it('allows a Kess-legal graveyard instant to enter the cast request flow', async () => {
    setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'consider_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Consider');
  });

  it('lets a Wrenn and Realmbreaker emblem cast permanent spells but not nonpermanent spells from the graveyard', async () => {
    const game = setupGame();
    (game.state as any).battlefield = [];
    (game.state as any).emblems = [
      {
        id: 'wrenn_emblem_1',
        controller: playerId,
        sourceName: 'Wrenn and Realmbreaker Emblem',
        effect: 'You may play lands and cast permanent spells from your graveyard.',
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const firstErrors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(firstErrors).toContain('NO_PERMISSION');

    await handlers['requestCastSpell']({ gameId, cardId: 'bear_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    const noPermissionCount = errors.filter((code) => code === 'NO_PERMISSION').length;
    expect(noPermissionCount).toBe(1);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'bear_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Runeclaw Bear');

    const candidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'consider_1')).toBe(false);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'bear_1')).toBe(true);
  });

  it('lets Serra Paragon cast cheap permanents from the graveyard and gain 2 life when they die', async () => {
    const game = setupGame();
    const hedronArchive = {
      id: 'hedron_archive_1',
      name: 'Hedron Archive',
      mana_cost: '{4}',
      manaCost: '{4}',
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      image_uris: { small: 'https://example.com/hedron-archive.jpg' },
    };

    const updatedGraveyard = [
      ...((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]),
      hedronArchive,
    ];

    (game.state as any).battlefield = [
      {
        id: 'serra_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'serra_card',
          name: 'Serra Paragon',
          type_line: 'Creature — Angel',
          oracle_text: 'Flying\nOnce during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."',
          power: '3',
          toughness: '4',
        },
      },
    ];
    (game.state as any).players[0].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyardCount = updatedGraveyard.length;

    const candidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any);
    const bearCandidate = candidates.find((candidate: any) => candidate?.card?.id === 'bear_1');

    expect(candidates.some((candidate: any) => candidate?.card?.id === 'consider_1')).toBe(false);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'hedron_archive_1')).toBe(false);
    expect(bearCandidate).toBeDefined();
    expect(bearCandidate?.leaveBattlefieldReplacementDestination).toBe('exile');
    expect(bearCandidate?.leaveBattlefieldReplacementSourceName).toBe('Serra Paragon');
    expect(bearCandidate?.leaveBattlefieldReplacementLifeGain).toBe(2);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'bear_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'bear_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:green', mana: 'G', count: 1 },
          { permanentId: '__pool__:blue', mana: 'U', count: 1 },
        ],
      },
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const bearPermanent = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => permanent?.card?.id === 'bear_1'
    );

    expect(bearPermanent).toBeDefined();
    expect(bearPermanent?.card?.leaveBattlefieldReplacementDestination).toBe('exile');
    expect(bearPermanent?.card?.leaveBattlefieldReplacementLifeGain).toBe(2);

    expect(movePermanentToGraveyard(game as any, String(bearPermanent.id))).toBe(true);

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);

    expect(graveyardIds).not.toContain('bear_1');
    expect(exileIds).toContain('bear_1');
    expect((game.state as any).life?.[playerId]).toBe(42);
    expect(((game.state as any).players || []).find((player: any) => player?.id === playerId)?.life).toBe(42);
  });

  it('lets Zask cast Insect spells but not other spells from the graveyard', async () => {
    const game = setupGame();
    const hornbeetle = {
      id: 'hornbeetle_1',
      name: 'Nessian Hornbeetle',
      mana_cost: '{1}{G}',
      manaCost: '{1}{G}',
      type_line: 'Creature — Insect',
      oracle_text: 'At the beginning of combat on your turn, if you control another creature with power 4 or greater, put a +1/+1 counter on Nessian Hornbeetle.',
      power: '2',
      toughness: '2',
      image_uris: { small: 'https://example.com/hornbeetle.jpg' },
    };

    const updatedGraveyard = [
      ...((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]),
      hornbeetle,
    ];

    (game.state as any).battlefield = [
      {
        id: 'zask_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'zask_card',
          name: 'Zask, Skittering Swarmlord',
          type_line: 'Legendary Creature — Insect',
          oracle_text: 'You may play lands and cast Insect spells from your graveyard.\nWhenever another Insect you control dies, put it on the bottom of its owner\'s library, then mill two cards.\n{1}{B/G}: Target Insect gets +1/+0 and gains deathtouch until end of turn.',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).players[0].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyardCount = updatedGraveyard.length;

    const candidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any);

    expect(candidates.some((candidate: any) => candidate?.card?.id === 'consider_1')).toBe(false);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'bear_1')).toBe(false);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'hornbeetle_1')).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'bear_1', fromZone: 'graveyard' });
    await handlers['requestCastSpell']({ gameId, cardId: 'hornbeetle_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    const noPermissionCount = errors.filter((code) => code === 'NO_PERMISSION').length;
    expect(noPermissionCount).toBe(1);

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'hornbeetle_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Nessian Hornbeetle');
  });

  it('lets Kethis activate into a temporary legendary graveyard cast window', async () => {
    const game = setupGame();
    const isamaru = {
      id: 'isamaru_1',
      name: 'Isamaru, Hound of Konda',
      mana_cost: '{W}',
      manaCost: '{W}',
      type_line: 'Legendary Creature — Dog',
      oracle_text: '',
      power: '2',
      toughness: '2',
      image_uris: { small: 'https://example.com/isamaru.jpg' },
    };
    const moxAmber = {
      id: 'mox_amber_1',
      name: 'Mox Amber',
      mana_cost: '{0}',
      manaCost: '{0}',
      type_line: 'Legendary Artifact',
      oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
      image_uris: { small: 'https://example.com/mox-amber.jpg' },
    };
    const teferi = {
      id: 'teferi_1',
      name: 'Teferi, Temporal Pilgrim',
      mana_cost: '{3}{U}{U}',
      manaCost: '{3}{U}{U}',
      type_line: 'Legendary Planeswalker — Teferi',
      oracle_text: '',
      image_uris: { small: 'https://example.com/teferi.jpg' },
    };

    const updatedGraveyard = [
      ...((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]),
      isamaru,
      moxAmber,
      teferi,
    ];

    (game.state as any).battlefield = [
      {
        id: 'kethis_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'kethis_card',
          name: 'Kethis, the Hidden Hand',
          type_line: 'Legendary Creature — Elf Advisor',
          oracle_text: 'Legendary spells you cast cost {1} less to cast.\nExile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."',
          power: '3',
          toughness: '4',
        },
      },
    ];
    (game.state as any).manaPool[playerId] = { white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 };
    (game.state as any).players[0].manaPool = { white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 };
    (game.state as any).players[0].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyardCount = updatedGraveyard.length;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'kethis_1', abilityId: 'kethis_1-ability-0' });

    const costStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.GRAVEYARD_SELECTION && step.graveyardExileAbilityAsCost === true
    ) as any;

    expect(costStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(costStep.id),
      selections: ['mox_amber_1', 'teferi_1'],
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const graveyardIdsAfterActivation = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIdsAfterActivation = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);

    expect(graveyardIdsAfterActivation).toContain('isamaru_1');
    expect(exileIdsAfterActivation).toContain('mox_amber_1');
    expect(exileIdsAfterActivation).toContain('teferi_1');

    const candidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any);

    expect(candidates.some((candidate: any) => candidate?.card?.id === 'consider_1')).toBe(false);
    expect(candidates.some((candidate: any) => candidate?.card?.id === 'isamaru_1')).toBe(true);

    await handlers['requestCastSpell']({ gameId, cardId: 'isamaru_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'isamaru_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Isamaru, Hound of Konda');
  });

  it('lets Horde of Notions target and cast an Elemental from the graveyard without paying its mana cost', async () => {
    const game = setupGame();
    const flamekin = {
      id: 'flamekin_1',
      name: 'Flamekin Harbinger',
      mana_cost: '{R}',
      manaCost: '{R}',
      type_line: 'Creature — Elemental Shaman',
      oracle_text: 'When Flamekin Harbinger enters, you may search your library for an Elemental card, reveal it, then shuffle and put that card on top.',
      power: '1',
      toughness: '1',
      image_uris: { small: 'https://example.com/flamekin.jpg' },
    };

    const updatedGraveyard = [
      ...((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]),
      flamekin,
    ];

    (game.state as any).battlefield = [
      {
        id: 'horde_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'horde_card',
          name: 'Horde of Notions',
          type_line: 'Legendary Creature — Elemental',
          oracle_text: 'Vigilance, trample, haste\n{W}{U}{B}{R}{G}: You may play target Elemental card from your graveyard without paying its mana cost.',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).manaPool[playerId] = { white: 1, blue: 1, black: 1, red: 1, green: 1, colorless: 0 };
    (game.state as any).players[0].manaPool = { white: 1, blue: 1, black: 1, red: 1, green: 1, colorless: 0 };
    (game.state as any).players[0].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyard = updatedGraveyard;
    (game.state as any).zones[playerId].graveyardCount = updatedGraveyard.length;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'horde_1', abilityId: 'horde_1-ability-0' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.activationPaymentChoice === true
    ) as any;
    if (paymentStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(paymentStep.id),
        selections: {
          payment: [
            { permanentId: '__pool__:white', mana: 'W', count: 1 },
            { permanentId: '__pool__:blue', mana: 'U', count: 1 },
            { permanentId: '__pool__:black', mana: 'B', count: 1 },
            { permanentId: '__pool__:red', mana: 'R', count: 1 },
            { permanentId: '__pool__:green', mana: 'G', count: 1 },
          ],
        },
        cancelled: false,
      });
    }

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.battlefieldAbilityTargetSelection === true && Array.isArray(step.validTargets)
    ) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target?.id)).toEqual(['flamekin_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['flamekin_1'],
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const promptStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.OPTION_CHOICE && step.playFromGraveyardCardId === 'flamekin_1'
    ) as any;
    expect(promptStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(promptStep.id),
      selections: ['play'],
      cancelled: false,
    });

    const castPaymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'flamekin_1'
    ) as any;
    if (castPaymentStep) {
      expect(String(castPaymentStep.manaCost || '{0}')).toContain('0');
      expect(castPaymentStep.forcedAlternateCostId).toBe('free');

      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(castPaymentStep.id),
        selections: { payment: [] },
        cancelled: false,
      });
    }

    safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    const battlefield = ((game.state as any).battlefield || []) as any[];
    const graveyard = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]) as any[];

    expect(errors).not.toContain('NO_PERMISSION');
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'flamekin_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'flamekin_1')).toBe(false);
  });

  it('lets Magus of the Will activate into a graveyard cast window and exiles resolved cards for the turn', async () => {
    const game = setupGame();
    (game.state as any).battlefield = [
      {
        id: 'magus_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'magus_card',
          name: 'Magus of the Will',
          type_line: 'Creature — Human Wizard',
          oracle_text: '{2}{B}, {T}, Exile this creature: Until end of turn, you may play lands and cast spells from your graveyard. If a card would be put into your graveyard from anywhere this turn, exile that card instead.',
          power: '3',
          toughness: '3',
        },
      },
    ];
    (game.state as any).manaPool[playerId] = { white: 0, blue: 1, black: 1, red: 0, green: 0, colorless: 2 };
    (game.state as any).players[0].manaPool = { white: 0, blue: 1, black: 1, red: 0, green: 0, colorless: 2 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'magus_1', abilityId: 'magus_1-ability-0' });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    expect(((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).some((card: any) => card?.id === 'magus_card')).toBe(true);

    const activatedCandidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any);
    expect(activatedCandidates.some((candidate: any) => candidate?.card?.id === 'consider_1')).toBe(true);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'consider_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:blue', mana: 'U', count: 1 }],
      },
      cancelled: false,
    });

    safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);

    expect(graveyardIds).not.toContain('consider_1');
    expect(exileIds).toContain('consider_1');
  });

  it('treats free graveyard permissions as {0} in the normal request-cast pipeline', async () => {
    const game = setupGame();
    (game.state as any).battlefield[0].card.oracle_text = 'Flying\nOnce during each of your turns, you may cast an instant or sorcery spell from your graveyard without paying its mana cost. If a spell cast this way would be put into your graveyard, exile it instead.';
    (game.state as any).manaPool[playerId] = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    (game.state as any).players[0].manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');
    expect(errors).not.toContain('INSUFFICIENT_MANA');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'consider_1'
    ) as any;

    if (paymentStep) {
      expect(String(paymentStep.manaCost || '{0}')).toContain('0');
      expect(paymentStep.forcedAlternateCostId).toBe('free');
    } else {
      const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => String(entry?.card?.id || '') === 'consider_1');
      expect(stackItem).toBeDefined();
      expect(stackItem?.castWithoutPayingManaCost).toBe(true);
    }
  });

  it('keeps source-granted additional costs when the graveyard permission also makes the spell free', async () => {
    const game = setupGame();
    const spareCard = {
      id: 'spare_card_1',
      name: 'Spare Card',
      mana_cost: '{1}',
      manaCost: '{1}',
      type_line: 'Artifact',
      oracle_text: '',
      image_uris: { small: 'https://example.com/spare-card.jpg' },
    };
    (game.state as any).battlefield[0].card.oracle_text = 'Flying\nOnce during each of your turns, you may cast an instant or sorcery spell from your graveyard without paying its mana cost by discarding a card in addition to paying its other costs. If a spell cast this way would be put into your graveyard, exile it instead.';
    (game.state as any).manaPool[playerId] = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    (game.state as any).players[0].manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    (game.state as any).zones[playerId].hand = [spareCard];
    (game.state as any).zones[playerId].handCount = 1;
    (game.state as any).players[0].hand = [spareCard];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');
    expect(errors).not.toContain('INSUFFICIENT_MANA');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const discardStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT && step.cardId === 'consider_1'
    ) as any;

    expect(discardStep).toBeDefined();
    expect(discardStep.costType).toBe('discard');
    expect(discardStep.castSpellFromHandArgs?.alternateCostId).toBe('free');
    expect(discardStep.castSpellFromHandArgs?.castWithoutPayingManaCost).toBe(true);
  });

  it('persists graveyard permission replay metadata on castSpell events from request-cast', async () => {
    const game = setupGame();
    (game.state as any).battlefield[0].card.oracle_text = 'Flying\nOnce during each of your turns, you may cast an instant or sorcery spell from your graveyard without paying its mana cost. If a spell cast this way would be put into your graveyard, exile it instead.';
    (game.state as any).manaPool[playerId] = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    (game.state as any).players[0].manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'consider_1'
    ) as any;
    if (paymentStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(paymentStep.id),
        selections: { payment: [] },
        cancelled: false,
      });
    }

    const castEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'castSpell' && String((event as any)?.payload?.cardId || '') === 'consider_1'
    ) as any;

    expect(castEvent?.payload?.fromZone).toBe('graveyard');
    expect(castEvent?.payload?.alternateCostId).toBe('free');
    expect(castEvent?.payload?.castWithoutPayingManaCost).toBe(true);
    expect(castEvent?.payload?.graveyardPermissionId).toEqual(expect.any(String));
    expect(castEvent?.payload?.graveyardPermissionSourceName).toBe('Kess, Dissident Mage');
    expect(castEvent?.payload?.graveyardPermissionCostMode).toBe('without_paying_mana_cost');
    expect(castEvent?.payload?.exileAfterResolution).toBe(true);
  });

  it('exiles a Kess-cast graveyard spell after it resolves', async () => {
    const game = setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'consider_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:blue', mana: 'U', count: 1 }],
      },
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);

    expect(graveyardIds).not.toContain('consider_1');
    expect(exileIds).toContain('consider_1');
  });

  it('rejects graveyard spells outside the shared permission surface', async () => {
    setupGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'bear_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.cardId === 'bear_1')).toBe(false);
  });

  it('rejects Lurrus-style graveyard permanents outside their legal timing window', async () => {
    const game = setupLurrusGame();
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'DECLARE_ATTACKERS';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'mind_stone_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).toContain('NO_PERMISSION');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((step: any) => step.cardId === 'mind_stone_1')).toBe(false);
  });

  it('allows graveyard spells marked playable by effect-program permissions', async () => {
    const game = setupGame();
    (game.state as any).battlefield = [];
    (game.state as any).turnNumber = 4;
    (game.state as any).playableFromGraveyard = {
      [playerId]: { consider_1: 4 },
    };

    const graveyardCard = (game.state as any).zones[playerId].graveyard.find((card: any) => card?.id === 'consider_1');
    Object.assign(graveyardCard, {
      canBePlayedBy: playerId,
      playableUntilTurn: 4,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.cardId === 'consider_1')).toBe(true);
  });

  it('rejects expired first-class graveyard permissions in the request-cast flow', async () => {
    const game = setupGame();
    (game.state as any).battlefield = [];
    (game.state as any).turnNumber = 5;
    (game.state as any).graveyardCastingPermissions = [
      {
        id: 'expired_perm_1',
        playerId,
        permission: 'cast',
        sourceZone: 'graveyard',
        sourceId: 'test_source',
        sourceName: 'Test Source',
        cardFilter: { cardIds: ['consider_1'] },
        costMode: 'normal',
        duration: 'this_turn',
        turnApplied: 4,
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).toContain('NO_PERMISSION');
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((step: any) => step.cardId === 'consider_1')).toBe(false);
  });

  it('allows a Lurrus-legal graveyard permanent to enter the cast request flow', async () => {
    setupLurrusGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'mind_stone_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'mind_stone_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Mind Stone');
  });

  it('rejects Lurrus-illegal graveyard permanents above mana value two', async () => {
    setupLurrusGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'hedron_archive_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.cardId === 'hedron_archive_1')).toBe(false);
  });

  it('exiles a Rivaz-cast Dragon creature when it dies', async () => {
    const game = setupRivazGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'dragon_spell_1', fromZone: 'graveyard' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'dragon_spell_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:red', mana: 'R', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 2 },
        ],
      },
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const dragonPermanent = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => permanent?.card?.id === 'dragon_spell_1'
    );

    expect(dragonPermanent).toBeDefined();
    expect(movePermanentToGraveyard(game as any, String(dragonPermanent.id))).toBe(true);

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);

    expect(graveyardIds).not.toContain('dragon_spell_1');
    expect(exileIds).toContain('dragon_spell_1');
  });

  it('queues the granted retrace discard cost for Six before casting a permanent from graveyard', async () => {
    const game = setupSixGame();

    const sixCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'six_mind_stone_1');

    expect(sixCandidate?.castMethod).toBe('retrace');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'six_mind_stone_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const discardStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.DISCARD_SELECTION && step.cardId === 'six_mind_stone_1'
    ) as any;

    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['six_forest_1']);
  });

  it('queues Exploration Broodship\'s land-sacrifice cost before casting a graveyard permanent', async () => {
    const game = setupExplorationBroodshipGame();

    const broodshipCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'broodship_mind_stone_1');

    expect(broodshipCandidate?.castMethod).toBe('graveyard_permanent');
    expect(broodshipCandidate?.sourceGrantedAdditionalCost).toEqual({ type: 'sacrifice', amount: 1, filter: 'land' });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'broodship_mind_stone_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const sacrificeStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && step.costType === 'sacrifice'
      && step.cardId === 'broodship_mind_stone_1'
    ) as any;

    expect(sacrificeStep).toBeDefined();
    expect((sacrificeStep.availableTargets || []).map((target: any) => target.id)).toEqual(['broodship_forest_perm_1']);
  });

  it('does not offer Quilled Greatwurm from graveyard without six counters among controlled creatures', async () => {
    const game = setupQuilledGreatwurmGame({ totalCounters: 5 });

    const candidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });

    expect(candidates.some((candidate: any) => String(candidate?.card?.id || '') === 'quilled_greatwurm_1')).toBe(false);
  });

  it('casts Quilled Greatwurm from graveyard after distributed counter removal', async () => {
    const game = setupQuilledGreatwurmGame();

    const greatwurmCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'quilled_greatwurm_1');

    expect(greatwurmCandidate?.castMethod).toBe('graveyard_permanent');
    expect(greatwurmCandidate?.sourceGrantedAdditionalCost).toEqual({
      type: 'remove_counters',
      amount: 6,
      filter: 'creature',
      distributed: true,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'quilled_greatwurm_1', fromZone: 'graveyard' });

    const counterRemovalStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT
      && step.costType === 'remove_counters'
      && step.cardId === 'quilled_greatwurm_1'
    ) as any;

    expect(counterRemovalStep).toBeDefined();
    expect((counterRemovalStep.availableCounters || []).map((counter: any) => counter.permanentId)).toEqual([
      'greatwurm_bear_perm_1',
      'greatwurm_bear_perm_1',
      'greatwurm_bear_perm_1',
      'greatwurm_bear_perm_1',
      'greatwurm_snake_perm_1',
      'greatwurm_snake_perm_1',
    ]);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(counterRemovalStep.id),
      selections: {
        counterSelections: [
          { permanentId: 'greatwurm_bear_perm_1', counterType: '+1/+1', count: 4 },
          { permanentId: 'greatwurm_snake_perm_1', counterType: 'shield', count: 2 },
        ],
      },
      cancelled: false,
    });

    const bear = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent.id === 'greatwurm_bear_perm_1');
    const snake = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent.id === 'greatwurm_snake_perm_1');
    const relic = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent.id === 'greatwurm_relic_perm_1');
    const opponentCreature = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent.id === 'greatwurm_opponent_creature_1');

    expect(bear?.counters).toBeUndefined();
    expect(snake?.counters).toBeUndefined();
    expect(relic?.counters?.charge).toBe(8);
    expect(opponentCreature?.counters?.['+1/+1']).toBe(6);

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'quilled_greatwurm_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:green', mana: 'G', count: 6 },
        ],
      },
      cancelled: false,
    });

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry?.card?.id === 'quilled_greatwurm_1');
    expect(stackItem).toBeDefined();
    expect(stackItem?.card?.castFromGraveyard).toBe(true);
  });

  it('lets Chainer cast a graveyard creature and gives it haste when it enters', async () => {
    const game = setupChainerGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'chainer_1', abilityId: 'chainer_1-ability-0' });

    const discardStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.DISCARD_SELECTION
      && step.discardAbilityAsCost === true
      && step.permanentId === 'chainer_1'
    ) as any;

    expect(discardStep).toBeDefined();
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['chainer_discard_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['chainer_discard_1'],
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const chainerCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'chainer_sable_1');

    expect(chainerCandidate?.castMethod).toBe('graveyard_permanent');

    await handlers['requestCastSpell']({ gameId, cardId: 'chainer_sable_1', fromZone: 'graveyard' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'chainer_sable_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 2 }],
      },
      cancelled: false,
    });

    safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const castCreature = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => permanent?.card?.id === 'chainer_sable_1'
    );

    expect(castCreature).toBeDefined();
    expect((castCreature?.grantedAbilities || []).map((ability: any) => String(ability || '').toLowerCase())).toContain('haste');
    expect(Boolean(castCreature?.summoningSickness)).toBe(false);
  });

  it('casts Nature\'s Rhythm with harmonize from graveyard using tapped-creature generic reduction and exiles it on resolution', async () => {
    const game = setupHarmonizeGame();

    const harmonizeCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'natures_rhythm_1');

    expect(harmonizeCandidate?.castMethod).toBe('harmonize');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'natures_rhythm_1', fromZone: 'graveyard' });

    const xStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.X_VALUE_SELECTION && step.spellCardId === 'natures_rhythm_1'
    ) as any;

    expect(xStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(xStep.id),
      selections: { xValue: 3 },
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'natures_rhythm_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.xValue).toBe(3);
    expect((paymentStep.harmonizeOptions || []).map((entry: any) => entry.id)).toEqual(['harmonize_bear_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:green', mana: 'G', count: 4 },
        ],
        harmonizeTappedCreatureId: 'harmonize_bear_1',
      },
      cancelled: false,
    });

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry?.card?.id === 'natures_rhythm_1');
    expect(stackItem).toBeDefined();
    expect(String(stackItem?.card?.castWithAbility || '')).toBe('harmonize');
    expect(stackItem?.castFromGraveyard === true || stackItem?.card?.castFromGraveyard === true).toBe(true);
    expect(Number(stackItem?.xValue || 0)).toBe(3);

    (game as any).resolveTopOfStack();

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);
    expect(graveyardIds).not.toContain('natures_rhythm_1');
    expect(exileIds).toContain('natures_rhythm_1');
  });

  it('lets Zenith Festival harmonize from graveyard and surface paid exile candidates from its X impulse effect', async () => {
    const game = setupZenithFestivalGame();

    const zenithCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'zenith_festival_1');

    expect(zenithCandidate?.castMethod).toBe('harmonize');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'zenith_festival_1', fromZone: 'graveyard' });

    const xStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.X_VALUE_SELECTION && step.spellCardId === 'zenith_festival_1'
    ) as any;

    expect(xStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(xStep.id),
      selections: { xValue: 2 },
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'zenith_festival_1'
    ) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.xValue).toBe(2);
    expect((paymentStep.harmonizeOptions || []).map((entry: any) => entry.id)).toEqual(['zenith_bear_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:red', mana: 'R', count: 2 },
        ],
        harmonizeTappedCreatureId: 'zenith_bear_1',
      },
      cancelled: false,
    });

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry?.card?.id === 'zenith_festival_1');
    expect(stackItem).toBeDefined();
    expect(String(stackItem?.card?.castWithAbility || '')).toBe('harmonize');
    expect(Number(stackItem?.xValue || 0)).toBe(2);

    (game as any).resolveTopOfStack();

    const exiledGoblin = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).find(
      (card: any) => String(card?.id || '') === 'zenith_goblin_1'
    );
    const goblinCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'zenith_goblin_1');

    expect(exiledGoblin).toBeDefined();
    expect(exiledGoblin?.castWithoutPayingManaCost).not.toBe(true);
    expect(goblinCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
      manaCost: '{R}',
    }));
  });

  it('keeps Ignite the Future impulse cards paid when cast from hand', async () => {
    const game = setupIgniteTheFutureGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'ignite_the_future_1', fromZone: 'hand' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'ignite_the_future_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:red', mana: 'R', count: 4 },
        ],
      },
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const exiledShivan = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).find(
      (card: any) => String(card?.id || '') === 'shivan_dragon_1'
    );
    const shivanCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'shivan_dragon_1');

    expect(exiledShivan).toBeDefined();
    expect(exiledShivan?.castWithoutPayingManaCost).not.toBe(true);
    expect(shivanCandidate).toBeUndefined();
  });

  it('lets Ignite the Future grant free exile casts when flashed back from graveyard', async () => {
    const game = setupIgniteTheFutureGame({ fromGraveyard: true });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'ignite_the_future_1',
      abilityId: 'flashback',
    });

    const igniteStackItem = (((game.state as any).stack || []) as any[]).find((entry: any) =>
      String(entry?.card?.id || '') === 'ignite_the_future_1'
    );

    expect(igniteStackItem).toBeDefined();
    expect(String(igniteStackItem?.card?.castWithAbility || '')).toBe('flashback');
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const exiledShivan = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).find(
      (card: any) => String(card?.id || '') === 'shivan_dragon_1'
    );
    const shivanCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'shivan_dragon_1');

    expect(exiledShivan).toBeDefined();
    expect(exiledShivan?.castWithoutPayingManaCost).toBe(true);
    expect(shivanCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
      manaCost: '',
    }));

    await handlers['requestCastSpell']({ gameId, cardId: 'shivan_dragon_1', fromZone: 'exile' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');
    expect(errors).not.toContain('INSUFFICIENT_MANA');

    const shivanPaymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'shivan_dragon_1'
    ) as any;

    if (shivanPaymentStep) {
      expect(String(shivanPaymentStep.manaCost || '{0}')).toContain('0');
    } else {
      const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) =>
        String(entry?.card?.id || '') === 'shivan_dragon_1'
      );
      expect(stackItem).toBeDefined();
      expect(stackItem?.castWithoutPayingManaCost).toBe(true);
    }
  });

  it('lets Mishra\'s Research Desk unearth into a next-turn exile choice that only surfaces the selected card', async () => {
    const game = setupMishraResearchDeskGame();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'research_desk_1',
      abilityId: 'unearth',
    });

    const unearthedDesk = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => String(permanent?.card?.id || '') === 'research_desk_1'
    );

    expect(unearthedDesk).toBeDefined();

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: String(unearthedDesk?.id || ''),
      abilityId: `${String(unearthedDesk?.id || '')}-ability-0`,
    });

    let safety = 0;
    while ((((game.state as any).stack || []) as any[]).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const preChoiceCandidates = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).filter((candidate: any) => ['research_bauble_1', 'research_growth_1'].includes(String(candidate?.card?.id || '')));
    const queue = ResolutionQueueManager.getQueue(gameId);
    const choiceStep = queue.steps.find((step: any) => step.grantPlayableFromExileChoice === true) as any;

    expect(preChoiceCandidates).toHaveLength(0);
    expect(choiceStep).toBeDefined();
    expect(choiceStep.grantPlayableFromExileUntilTurn).toBe(5);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(choiceStep.id),
      selections: 'research_bauble_1',
      cancelled: false,
    });

    const exileZone = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]);
    const chosenExiledCard = exileZone.find((card: any) => String(card?.id || '') === 'research_bauble_1');
    const unchosenExiledCard = exileZone.find((card: any) => String(card?.id || '') === 'research_growth_1');
    const chosenCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'research_bauble_1');
    const unchosenCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'research_growth_1');

    expect(chosenExiledCard).toBeDefined();
    expect(chosenExiledCard?.canBePlayedBy).toBe(playerId);
    expect(chosenExiledCard?.playableUntilTurn).toBe(5);
    expect(unchosenExiledCard).toBeDefined();
    expect(unchosenExiledCard?.canBePlayedBy).toBeUndefined();
    expect(unchosenExiledCard?.playableUntilTurn).toBeUndefined();
    expect((game.state as any).playableFromExile?.[playerId]?.research_bauble_1).toBe(5);
    expect((game.state as any).playableFromExile?.[playerId]?.research_growth_1).toBeUndefined();
    expect(chosenCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
    }));
    expect(unchosenCandidate).toBeUndefined();
  });

  it('casts Lidless-style opponent-owned exiled spells through the shared exile surface', async () => {
    const game = setupGame();
    (game.state as any).battlefield = [];
    (game.state as any).turnNumber = 1;

    const opponentExiledConsider = {
      id: 'lidless_consider_1',
      name: 'Consider',
      mana_cost: '{U}',
      manaCost: '{U}',
      type_line: 'Instant',
      oracle_text: 'Look at the top card of your library. You may put that card into your graveyard. Draw a card.',
      image_uris: { small: 'https://example.com/lidless-consider.jpg' },
      canBePlayedBy: playerId,
      playableUntilTurn: 2,
    };

    ((game.state as any).zones?.[opponentId] as any).exile = [opponentExiledConsider];
    ((game.state as any).zones?.[opponentId] as any).exileCount = 1;
    const opponentPlayer = (((game.state as any).players || []) as any[]).find((player: any) => String(player?.id || '') === opponentId);
    if (opponentPlayer) {
      opponentPlayer.exile = [opponentExiledConsider];
    }
    (game.state as any).playableFromExile = {
      [playerId]: {
        lidless_consider_1: 2,
      },
    };

    const lidlessCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'lidless_consider_1');

    expect(lidlessCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
      manaCost: '{U}',
    }));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'lidless_consider_1', fromZone: 'exile' });

    const requestErrors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(requestErrors).not.toContain('NO_PERMISSION');
    expect(requestErrors).not.toContain('CARD_NOT_IN_EXILE');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'lidless_consider_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:blue', mana: 'U', count: 1 },
        ],
      },
      cancelled: false,
    });

    const stackItem = ((((game.state as any).stack) || []) as any[]).find(
      (entry: any) => String(entry?.card?.id || '') === 'lidless_consider_1'
    );

    expect(stackItem).toBeDefined();
    expect(String(stackItem?.castSourceZone || stackItem?.fromZone || '')).toBe('exile');
    expect(((((game.state as any).zones?.[opponentId]?.exile) || []) as any[]).some(
      (card: any) => String(card?.id || '') === 'lidless_consider_1'
    )).toBe(false);
  });

  it('lets Lidless Gaze flashback spend off-color mana on the opponent\'s exiled spell', async () => {
    const game = setupLidlessGazeGame({ fromGraveyard: true });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'lidless_gaze_1',
      abilityId: 'flashback',
    });

    const lidlessStackItem = (((game.state as any).stack || []) as any[]).find((entry: any) =>
      String(entry?.card?.id || '') === 'lidless_gaze_1'
    );

    expect(lidlessStackItem).toBeDefined();
    expect(String(lidlessStackItem?.card?.castWithAbility || '')).toBe('flashback');

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const exiledOpponentSpell = ((((game.state as any).zones?.[opponentId]?.exile) || []) as any[]).find(
      (card: any) => String(card?.id || '') === 'lidless_opponent_consider_1'
    );
    const initialCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'lidless_opponent_consider_1');

    expect(exiledOpponentSpell).toBeDefined();
    expect(String(exiledOpponentSpell?.canBePlayedBy || '')).toBe(playerId);
    expect(initialCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
    }));

    (game.state as any).manaPool[playerId] = { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 };

    const offColorCandidate = getCastableSpellCandidates({ state: game.state, libraries: (game as any).libraries } as any, playerId as any, {
      mode: 'main',
      allowUnknownCostFallback: false,
    }).find((candidate: any) => String(candidate?.card?.id || '') === 'lidless_opponent_consider_1');

    expect(offColorCandidate).toEqual(expect.objectContaining({
      sourceZone: 'exile',
      castMethod: 'playable_from_exile',
      manaCost: '{U}',
    }));

    await handlers['requestCastSpell']({ gameId, cardId: 'lidless_opponent_consider_1', fromZone: 'exile' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');
    expect(errors).not.toContain('INSUFFICIENT_MANA');

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.cardId === 'lidless_opponent_consider_1'
    ) as any;

    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:red', mana: 'R', count: 1 },
        ],
      },
      cancelled: false,
    });

    const castStackItem = (((game.state as any).stack || []) as any[]).find((entry: any) =>
      String(entry?.card?.id || '') === 'lidless_opponent_consider_1'
    );

    expect(castStackItem).toBeDefined();
    expect(String(castStackItem?.castSourceZone || castStackItem?.fromZone || '')).toBe('exile');
  });
});


