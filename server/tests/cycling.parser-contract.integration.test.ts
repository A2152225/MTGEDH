import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
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

describe('cycling parser contract (integration)', () => {
  const gameId = 'test_cycling_parser_contract';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('accepts parser-emitted cycling ids through activateCycling and resolves the draw from the stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'cycler_card_1',
            name: 'Test Cycler',
            type_line: 'Creature - Beast',
            oracle_text: 'Cycling {2}',
          },
        ],
        library: [
          {
            id: 'drawn_card_1',
            name: 'Drawn Card',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
        libraryCount: 1,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
      {
        id: 'forest_lib_1',
        name: 'Forest',
        type_line: 'Basic Land - Forest',
        oracle_text: '',
      },
      {
        id: 'island_lib_1',
        name: 'Island',
        type_line: 'Basic Land - Island',
        oracle_text: '',
      },
      {
        id: 'spell_lib_1',
        name: 'Cult Insight',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
      },
      ]],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateCycling']({
      gameId,
      cardId: 'cycler_card_1',
      abilityId: 'cycler_card_1-cycling-0',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.handCount).toBe(0);
    expect(zones?.graveyardCount).toBe(1);
    expect((zones?.graveyard || [])[0]?.id).toBe('cycler_card_1');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.abilityType).toBe('cycling');
    expect(stack[0]?.abilityId).toBe('cycler_card_1-cycling-0');

    game.resolveTopOfStack();

    expect(zones?.handCount).toBe(1);
    expect((zones?.hand || [])[0]?.id).toBe('drawn_card_1');
    expect(zones?.libraryCount).toBe(0);
  });

  it('replays activateCycling events by discarding, spending mana, and rebuilding the cycling stack item', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'cycler_card_1',
            name: 'Test Cycler',
            type_line: 'Creature - Beast',
            oracle_text: 'Cycling {2}',
          },
        ],
        library: [],
        graveyard: [],
        exile: [],
        handCount: 1,
        libraryCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
      {
        id: 'wizard_creature_1',
        name: 'Wizard Adept',
        type_line: 'Creature - Wizard',
        oracle_text: '',
      },
      {
        id: 'goblin_creature_1',
        name: 'Goblin Raider',
        type_line: 'Creature - Goblin',
        oracle_text: '',
      },
      {
        id: 'kindred_spell_1',
        name: 'Kindred Lesson',
        type_line: 'Kindred Sorcery - Wizard',
        oracle_text: '',
      },
      ]],
    ]);
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateCycling',
      playerId,
      cardId: 'cycler_card_1',
      cardName: 'Test Cycler',
      abilityId: 'cycler_card_1-cycling-0',
      cyclingCost: '{2}',
      stackId: 'ability_cycling_replay_1',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.handCount).toBe(0);
    expect(zones?.graveyardCount).toBe(1);
    expect((zones?.graveyard || [])[0]?.id).toBe('cycler_card_1');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe('ability_cycling_replay_1');
    expect(stack[0]?.abilityType).toBe('cycling');
    expect(stack[0]?.abilityId).toBe('cycler_card_1-cycling-0');
  });

  it('routes basic landcycling through activateCycling and resolves a filtered library search step', async () => {
    const landcyclingGameId = `${gameId}_landcycling`;
    games.delete(landcyclingGameId as any);
    ResolutionQueueManager.removeQueue(landcyclingGameId);

    createGameIfNotExists(landcyclingGameId, 'commander', 40);
    const game = ensureGame(landcyclingGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'landcycler_card_1',
            name: 'Test Landcycler',
            type_line: 'Creature - Wurm',
            oracle_text: 'Basic landcycling {2}',
          },
        ],
        library: [
          {
            id: 'forest_lib_1',
            name: 'Forest',
            type_line: 'Basic Land - Forest',
            oracle_text: '',
          },
          {
            id: 'island_lib_1',
            name: 'Island',
            type_line: 'Basic Land - Island',
            oracle_text: '',
          },
          {
            id: 'spell_lib_1',
            name: 'Cult Insight',
            type_line: 'Sorcery',
            oracle_text: 'Draw a card.',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
        libraryCount: 3,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'forest_lib_1',
          name: 'Forest',
          type_line: 'Basic Land - Forest',
          oracle_text: '',
        },
        {
          id: 'island_lib_1',
          name: 'Island',
          type_line: 'Basic Land - Island',
          oracle_text: '',
        },
        {
          id: 'spell_lib_1',
          name: 'Cult Insight',
          type_line: 'Sorcery',
          oracle_text: 'Draw a card.',
        },
      ]],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, landcyclingGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateCycling']({
      gameId: landcyclingGameId,
      cardId: 'landcycler_card_1',
      abilityId: 'landcycler_card_1-cycling-0',
    });

    const zones = (game.state as any).zones?.[playerId];
    expect(zones?.handCount).toBe(0);
    expect(zones?.graveyardCount).toBe(1);
    expect((zones?.graveyard || [])[0]?.id).toBe('landcycler_card_1');

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.abilityType).toBe('typecycling');
    expect(stack[0]?.searchCriteria).toBe('a basic land card');

    game.resolveTopOfStack();

    const searchStep = ResolutionQueueManager.getStepsForPlayer(landcyclingGameId, playerId)
      .find((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeTruthy();
    expect(searchStep.filter).toEqual({ types: ['land'], supertypes: ['basic'] });
    expect((searchStep.availableCards || []).map((card: any) => card.id).sort()).toEqual(['forest_lib_1', 'island_lib_1']);
    expect(zones?.handCount).toBe(0);
  });

  it('routes creature-type cycling to a creature-only library search', async () => {
    const wizardcyclingGameId = `${gameId}_wizardcycling`;
    games.delete(wizardcyclingGameId as any);
    ResolutionQueueManager.removeQueue(wizardcyclingGameId);

    createGameIfNotExists(wizardcyclingGameId, 'commander', 40);
    const game = ensureGame(wizardcyclingGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'wizardcycler_card_1',
            name: 'Test Wizardcycler',
            type_line: 'Creature - Horror',
            oracle_text: 'Wizardcycling {3}',
          },
        ],
        library: [
          {
            id: 'wizard_creature_1',
            name: 'Wizard Adept',
            type_line: 'Creature - Wizard',
            oracle_text: '',
          },
          {
            id: 'goblin_creature_1',
            name: 'Goblin Raider',
            type_line: 'Creature - Goblin',
            oracle_text: '',
          },
          {
            id: 'kindred_spell_1',
            name: 'Kindred Lesson',
            type_line: 'Kindred Sorcery - Wizard',
            oracle_text: '',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
        libraryCount: 3,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'wizard_creature_1',
          name: 'Wizard Adept',
          type_line: 'Creature - Wizard',
          oracle_text: '',
        },
        {
          id: 'goblin_creature_1',
          name: 'Goblin Raider',
          type_line: 'Creature - Goblin',
          oracle_text: '',
        },
        {
          id: 'kindred_spell_1',
          name: 'Kindred Lesson',
          type_line: 'Kindred Sorcery - Wizard',
          oracle_text: '',
        },
      ]],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, wizardcyclingGameId, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateCycling']({
      gameId: wizardcyclingGameId,
      cardId: 'wizardcycler_card_1',
      abilityId: 'wizardcycler_card_1-cycling-0',
    });

    game.resolveTopOfStack();

    const searchStep = ResolutionQueueManager.getStepsForPlayer(wizardcyclingGameId, playerId)
      .find((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeTruthy();
    expect(searchStep.filter).toEqual({ types: ['creature'], subtypes: ['wizard'] });
    expect((searchStep.availableCards || []).map((card: any) => card.id)).toEqual(['wizard_creature_1']);
  });

  it('replays typecycling stack items with their search metadata intact', () => {
    const replayGameId = `${gameId}_typecycling_replay`;
    games.delete(replayGameId as any);
    ResolutionQueueManager.removeQueue(replayGameId);

    createGameIfNotExists(replayGameId, 'commander', 40);
    const game = ensureGame(replayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'landcycler_card_1',
            name: 'Test Landcycler',
            type_line: 'Creature - Wurm',
            oracle_text: 'Basic landcycling {2}',
          },
        ],
        library: [],
        graveyard: [],
        exile: [],
        handCount: 1,
        libraryCount: 0,
        graveyardCount: 0,
        exileCount: 0,
      },
    };
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'activateCycling',
      playerId,
      cardId: 'landcycler_card_1',
      cardName: 'Test Landcycler',
      abilityId: 'landcycler_card_1-cycling-0',
      cyclingCost: '{2}',
      stackId: 'ability_typecycling_replay_1',
      stackAbilityType: 'typecycling',
      stackDescription: 'Search your library for a basic land card',
      searchCriteria: 'a basic land card',
      searchFilter: { types: ['land'], supertypes: ['basic'] },
    });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe('ability_typecycling_replay_1');
    expect(stack[0]?.abilityType).toBe('typecycling');
    expect(stack[0]?.searchCriteria).toBe('a basic land card');
    expect(stack[0]?.searchFilter).toEqual({ types: ['land'], supertypes: ['basic'] });
  });
});