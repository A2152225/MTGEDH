import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { chooseAISpellPaymentSelections } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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

const trackedGameIds: string[] = [];
const playerId = 'ai1';

function createTestGameId(label: string): string {
  const gameId = `test_ai_shared_spell_payment_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI shared spell-payment integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    for (const gameId of trackedGameIds.splice(0, trackedGameIds.length)) {
      games.delete(gameId as any);
    }
  });

  it('selects the exact non-tap mana ability id when building a spell payment plan', async () => {
    const gameId = createTestGameId('non_tap_exact_id');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'prism_cache_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'prism_cache_card_1',
          name: 'Prism Cache',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice this artifact: Add {C}.\nSacrifice this artifact: Add {U}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}',
      totalManaCost: '{U}',
    });

    expect(plan).toEqual({
      payment: [
        {
          permanentId: 'prism_cache_1',
          mana: 'U',
          abilityId: 'prism_cache_card_1-ability-1',
        },
      ],
    });
    expect((game.state as any).manaPool?.[playerId]?.blue).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'prism_cache_1')).toBe(true);
    expect(getEvents(gameId)).toEqual([]);
  });

  it('uses the selected exact mana line amount and preserves excess with count for spell payment plans', async () => {
    const gameId = createTestGameId('exact_amount_count');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'azure_dynamo_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'azure_dynamo_card_1',
          name: 'Azure Dynamo',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice this artifact: Add {U}.\n{T}: Add {U}{U}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}',
      totalManaCost: '{U}',
    });

    expect(plan).toEqual({
      payment: [
        {
          permanentId: 'azure_dynamo_1',
          mana: 'U',
          count: 1,
          abilityId: 'azure_dynamo_card_1-ability-1',
        },
      ],
    });
    expect((game.state as any).manaPool?.[playerId]?.blue).toBe(0);
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'azure_dynamo_1')).toBe(true);
    expect(getEvents(gameId)).toEqual([]);
  });

  it('includes sacrificedPermanentIds for mana abilities that require sacrificing another permanent', async () => {
    const gameId = createTestGameId('sacrifice_another_payment_ids');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'crucible_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'crucible_card_1',
          name: 'Aether Crucible',
          type_line: 'Artifact',
          oracle_text: 'Sacrifice another artifact: Add {U}.',
        },
      },
      {
        id: 'spare_artifact_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'spare_artifact_card_1',
          name: 'Spare Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}',
      totalManaCost: '{U}',
    });

    expect(plan).toEqual({
      payment: [
        {
          permanentId: 'crucible_1',
          mana: 'U',
          abilityId: 'crucible_card_1-ability-0',
          sacrificedPermanentIds: ['spare_artifact_1'],
        },
      ],
    });
    expect((game.state as any).manaPool?.[playerId]?.blue).toBe(0);
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'spare_artifact_1')).toBe(true);
    expect(getEvents(gameId)).toEqual([]);
  });

  it('pre-activates a non-tap return-to-hand mana line when another land can be bounced', async () => {
    const gameId = createTestGameId('non_tap_return_to_hand');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'tidal_commons_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'tidal_commons_card_1',
          name: 'Tidal Commons',
          type_line: 'Land',
          oracle_text: "Return another land you control to its owner's hand: Add {U}{U}.",
        },
      },
      {
        id: 'plains_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'plains_card_1',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}{U}',
      totalManaCost: '{U}{U}',
    });

    expect(plan).toEqual({ payment: [] });
    expect((game.state as any).manaPool?.[playerId]).toEqual({
      white: 0,
      blue: 2,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    const battlefieldIds = ((game.state as any).battlefield || []).map((perm: any) => perm?.id);
    expect(battlefieldIds).toContain('tidal_commons_1');
    expect(battlefieldIds).not.toContain('plains_1');
    expect((game.state as any).zones?.[playerId]?.hand?.map((card: any) => card?.id)).toEqual(['plains_card_1']);
    expect(getEvents(gameId)).toEqual([
      expect.objectContaining({
        type: 'activateBattlefieldAbility',
        payload: expect.objectContaining({
          permanentId: 'tidal_commons_1',
          abilityId: 'tidal_commons_card_1-ability-0',
          returnedPermanentsToHandForCost: ['plains_1'],
        }),
      }),
      expect.objectContaining({
        type: 'activateManaAbility',
        payload: expect.objectContaining({
          permanentId: 'tidal_commons_1',
          abilityId: 'tidal_commons_card_1-ability-0',
          addedMana: { blue: 2 },
        }),
      }),
    ]);
  });

  it('activates an exact non-tap mana line even when the permanent also has a tap mana line', async () => {
    const gameId = createTestGameId('non_tap_fallback_multi_line');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'pain_cache_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'pain_cache_card_1',
          name: 'Pain Cache',
          type_line: 'Artifact',
          oracle_text: 'Pay 1 life: Add {U}.\n{T}: Add {C}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}',
      totalManaCost: '{U}',
    });

    expect(plan).toEqual({ payment: [] });
    expect((game.state as any).manaPool?.[playerId]).toEqual({
      white: 0,
      blue: 1,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect((game.state as any).life?.[playerId]).toBe(39);
    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'pain_cache_1');
    expect(permanent?.tapped).toBe(false);
  });

  it('reuses the same non-tap pay-life mana source until enough mana is floating for spell payment', async () => {
    const gameId = createTestGameId('non_tap_repeatable_pay_life');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'pain_cache_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'pain_cache_card_1',
          name: 'Pain Cache',
          type_line: 'Artifact',
          oracle_text: 'Pay 1 life: Add {U}.\n{T}: Add {C}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}{U}',
      totalManaCost: '{U}{U}',
    });

    expect(plan).toEqual({ payment: [] });
    expect((game.state as any).manaPool?.[playerId]).toEqual({
      white: 0,
      blue: 2,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect((game.state as any).life?.[playerId]).toBe(38);
    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'pain_cache_1');
    expect(permanent?.tapped).toBe(false);
  });

  it('refuses to pre-activate a discard mana source when the only discard candidate is the spell being paid for', async () => {
    const gameId = createTestGameId('non_tap_discard_requires_other_card');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'opt_hand',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'mind_cache_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mind_cache_card_1',
          name: 'Mind Cache',
          type_line: 'Artifact',
          oracle_text: 'Discard a card: Add {U}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      cardId: 'opt_hand',
      manaCost: '{U}',
      totalManaCost: '{U}',
    });

    expect(plan).toBeNull();
    expect((game.state as any).manaPool?.[playerId]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect((game.state as any).zones?.[playerId]?.hand?.map((card: any) => card?.id)).toEqual(['opt_hand']);
    expect(getEvents(gameId)).toEqual([]);
  });

  it('refuses signet-style spell payment plans that require unsupported activation costs or all-at-once mixed colors', async () => {
    const gameId = createTestGameId('signet_unsupported_spell_payment');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'island_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '',
        },
      },
      {
        id: 'izzet_signet_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'izzet_signet_card_1',
          name: 'Izzet Signet',
          type_line: 'Artifact',
          oracle_text: '{1}, {T}: Add {U}{R}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{U}{R}',
      totalManaCost: '{U}{R}',
    });

    expect(plan).toBeNull();
    expect((game.state as any).manaPool?.[playerId]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'izzet_signet_1')).toBe(true);
    expect(getEvents(gameId)).toEqual([]);
  });
});