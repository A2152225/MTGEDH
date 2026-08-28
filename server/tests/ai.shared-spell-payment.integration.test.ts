import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { chooseAISpellPaymentSelections, canAIAssembleSpellPaymentPlan } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { parseManaCost } from '../src/state/modules/mana-check.js';

async function cleanupTrackedGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
}

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

async function cleanupTrackedGames() {
  for (const gameId of trackedGameIds.splice(0, trackedGameIds.length)) {
    await cleanupTrackedGame(gameId);
  }
}

describe('AI shared spell-payment integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await cleanupTrackedGames();
  });

  afterEach(async () => {
    await cleanupTrackedGames();
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

  it('pays only the adjusted mana cost after a shared static reduction', async () => {
    const gameId = createTestGameId('adjusted_reduction_payment');
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
          type_line: 'Basic Land - Island',
          oracle_text: '{T}: Add {U}.',
        },
      },
      {
        id: 'wastes_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'wastes_card_1',
          name: 'Wastes',
          type_line: 'Basic Land',
          oracle_text: '{T}: Add {C}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      cardId: 'opt_hand',
      manaCost: '{U}',
      totalManaCost: '{U}',
      costAdjustment: {
        originalManaCost: '{1}{U}',
        adjustedManaCost: '{U}',
        genericReduction: 1,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 0,
        reductionMessages: ['Sapphire Medallion: -{1}'],
        taxMessages: [],
        sources: [{ kind: 'reduction', message: 'Sapphire Medallion: -{1}' }],
        kind: 'reduction',
      },
    });

    expect(plan?.payment).toHaveLength(1);
    expect(plan?.payment).toContainEqual(expect.objectContaining({ permanentId: 'island_1', mana: 'U' }));
    expect(plan?.payment).not.toContainEqual(expect.objectContaining({ permanentId: 'wastes_1' }));
  });

  it('includes extra generic payment required by a shared static tax', async () => {
    const gameId = createTestGameId('adjusted_tax_payment');
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
          type_line: 'Basic Land - Island',
          oracle_text: '{T}: Add {U}.',
        },
      },
      {
        id: 'wastes_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'wastes_card_1',
          name: 'Wastes',
          type_line: 'Basic Land',
          oracle_text: '{T}: Add {C}.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      cardId: 'opt_hand',
      manaCost: '{1}{U}',
      totalManaCost: '{1}{U}',
      costAdjustment: {
        originalManaCost: '{U}',
        adjustedManaCost: '{1}{U}',
        genericReduction: 0,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 1,
        reductionMessages: [],
        taxMessages: ['Sphere of Resistance: +{1}'],
        sources: [{ kind: 'increase', message: 'Sphere of Resistance: +{1}' }],
        kind: 'increase',
      },
    });

    expect(plan?.payment).toHaveLength(2);
    expect(plan?.payment).toContainEqual(expect.objectContaining({ permanentId: 'island_1', mana: 'U' }));
    expect(plan?.payment).toContainEqual(expect.objectContaining({ permanentId: 'wastes_1', mana: 'C' }));
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

  it('refuses Gemstone Array spell payment plans that require removing unsupported charge counters', async () => {
    const gameId = createTestGameId('gemstone_array_unsupported_spell_payment');
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
        id: 'mountain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mountain_card_1',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'mountain_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mountain_card_2',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'mountain_3',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mountain_card_3',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'stack_gemstone_array',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: '19ef37a3-4538-47b2-8f88-3fa0a4e32329_gemstone',
          name: 'Gemstone Array',
          type_line: 'Artifact',
          oracle_text:
            '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
        },
      },
    ];

    // {4} needs 4 mana. Three mountains + Gemstone Array would only be enough if the
    // remove-counter ability were treated as a free tap-for-mana source.
    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{4}',
      totalManaCost: '{4}',
    });

    expect(plan).toBeNull();
    expect(getEvents(gameId)).toEqual([]);
  });

  it('pays {4} from four real lands without selecting Gemstone Array remove-counter mana', async () => {
    const gameId = createTestGameId('gemstone_array_ignored_when_lands_cover');
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
      ...[1, 2, 3, 4].map((n) => ({
        id: `mountain_${n}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `mountain_card_${n}`,
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      })),
      {
        id: 'stack_gemstone_array',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: { charge: 2 },
        card: {
          id: '19ef37a3-4538-47b2-8f88-3fa0a4e32329_gemstone',
          name: 'Gemstone Array',
          type_line: 'Artifact',
          oracle_text:
            '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{4}',
      totalManaCost: '{4}',
    });

    expect(plan).not.toBeNull();
    expect(plan!.payment).toHaveLength(4);
    expect(plan!.payment.every((entry) => String(entry.permanentId).startsWith('mountain_'))).toBe(true);
    expect(plan!.payment.some((entry) => String(entry.permanentId).includes('gemstone'))).toBe(false);
  });

  it('pays {4} using three lands plus a charged mana-battery remove-counter source', async () => {
    const gameId = createTestGameId('charged_mana_battery_spell_payment');
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
      ...[1, 2, 3].map((n) => ({
        id: `mountain_${n}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `mountain_card_${n}`,
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      })),
      {
        id: 'stack_mana_battery',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: { charge: 2 },
        card: {
          id: 'mana_battery_card',
          name: 'Custom Mana Battery',
          type_line: 'Artifact',
          oracle_text:
            '{1}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{4}',
      totalManaCost: '{4}',
    });

    expect(plan).not.toBeNull();
    expect(plan!.payment).toHaveLength(4);
    expect(plan!.payment.filter((entry) => String(entry.permanentId).startsWith('mountain_'))).toHaveLength(3);
    expect(plan!.payment.some((entry) => String(entry.permanentId) === 'stack_mana_battery')).toBe(true);
    expect(getEvents(gameId)).toEqual([]);
  });

  it('assembles {R} payment by charging a mana battery with spare green as a color fix', async () => {
    const gameId = createTestGameId('mana_battery_color_fix');
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 0 },
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
        id: 'stack_gemstone_array',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'gemstone_array_card',
          name: 'Gemstone Array',
          type_line: 'Artifact',
          oracle_text:
            '{2}: Put a charge counter on this artifact.\nRemove a charge counter from this artifact: Add one mana of any color.',
        },
      },
    ];

    const parsedCost = parseManaCost('{R}');
    expect(canAIAssembleSpellPaymentPlan(game, playerId as any, parsedCost)).toBe(true);

    // Assemblability is simulated on a clone; the live board should remain unchanged.
    const gemstone = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'stack_gemstone_array');
    expect(Number(gemstone?.counters?.charge || 0)).toBe(0);
    expect(Number((game.state as any).manaPool[playerId].green || 0)).toBe(2);
    expect(getEvents(gameId)).toEqual([]);
  });

  it('batches free lands before Three Tree City and prefers the multi-mana invest line', async () => {
    const gameId = createTestGameId('three_tree_city_invest');
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
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
      {
        id: 'forest_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'forest_card_2',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
      {
        id: 'three_tree_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        chosenCreatureType: 'Elf',
        card: {
          id: 'three_tree_card_1',
          name: 'Three Tree City',
          type_line: 'Legendary Land',
          oracle_text:
            'As Three Tree City enters, choose a creature type.\n' +
            '{T}: Add {C}.\n' +
            '{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.',
        },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `elf_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `elf_card_${index + 1}`,
          name: `Elf ${index + 1}`,
          type_line: 'Creature — Elf',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      })),
    ];

    // {3}{G} needs 4 mana. Two Forests float the {2} activation; Three Tree then makes 4{G}.
    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{3}{G}',
      totalManaCost: '{3}{G}',
    });

    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    const threeTreePayment = payment.find((entry) => entry.permanentId === 'three_tree_1');
    expect(threeTreePayment).toBeTruthy();
    expect(String(threeTreePayment?.abilityId || '')).toContain('three_tree_card_1-ability-1');
    expect(String(threeTreePayment?.mana || '').toUpperCase()).toBe('G');

    const threeTreeIndex = payment.findIndex((entry) => entry.permanentId === 'three_tree_1');
    const forestIndexes = payment
      .map((entry, index) => (String(entry.permanentId || '').startsWith('forest_') ? index : -1))
      .filter((index) => index >= 0);
    expect(forestIndexes.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...forestIndexes)).toBeLessThan(threeTreeIndex);
  });

  it('does not stop generic payment at Three Tree City invest when free lands cover the cost', async () => {
    const gameId = createTestGameId('three_tree_city_generic_free_taps');
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
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `forest_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `forest_card_${index + 1}`,
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      })),
      {
        id: 'three_tree_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        chosenCreatureType: 'Elf',
        card: {
          id: 'three_tree_card_1',
          name: 'Three Tree City',
          type_line: 'Legendary Land',
          oracle_text:
            'As Three Tree City enters, choose a creature type.\n' +
            '{T}: Add {C}.\n' +
            '{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.',
        },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `elf_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `elf_card_${index + 1}`,
          name: `Elf ${index + 1}`,
          type_line: 'Creature — Elf',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      })),
    ];

    // Eight Forests already make {8}. Using the {2} invest line plus only four Forests nets 6.
    const parsedCost = parseManaCost('{8}');
    expect(canAIAssembleSpellPaymentPlan(game, playerId as any, parsedCost)).toBe(true);

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{8}',
      totalManaCost: '{8}',
    });
    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    const forestCount = payment.filter((entry) => String(entry.permanentId || '').startsWith('forest_')).length;
    expect(forestCount).toBeGreaterThanOrEqual(8);
  });

  it('includes enough free lands to pay Three Tree City {2} when invest is required for generic', async () => {
    const gameId = createTestGameId('three_tree_city_generic_invest_net');
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
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `forest_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `forest_card_${index + 1}`,
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      })),
      {
        id: 'three_tree_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        chosenCreatureType: 'Elf',
        card: {
          id: 'three_tree_card_1',
          name: 'Three Tree City',
          type_line: 'Legendary Land',
          oracle_text:
            'As Three Tree City enters, choose a creature type.\n' +
            '{T}: Add {C}.\n' +
            '{2}, {T}: Choose a color. Add an amount of mana of that color equal to the number of creatures you control of the chosen type.',
        },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `elf_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `elf_card_${index + 1}`,
          name: `Elf ${index + 1}`,
          type_line: 'Creature — Elf',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      })),
    ];

    // Six Forests + {C} = 7. Invest: 6 - {2} + 4 = 8.
    const parsedCost = parseManaCost('{8}');
    expect(canAIAssembleSpellPaymentPlan(game, playerId as any, parsedCost)).toBe(true);

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{8}',
      totalManaCost: '{8}',
    });
    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    expect(payment.some((entry) => entry.permanentId === 'three_tree_1')).toBe(true);
    const forestCount = payment.filter((entry) => String(entry.permanentId || '').startsWith('forest_')).length;
    expect(forestCount).toBeGreaterThanOrEqual(6);
  });

  it('uses Nyx Lotus devotion choose-a-color mana for spell payment', async () => {
    const gameId = createTestGameId('nyx_lotus_devotion');
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
        id: 'nyx_lotus_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'nyx_lotus_card_1',
          name: 'Nyx Lotus',
          type_line: 'Legendary Artifact',
          mana_cost: '{4}',
          oracle_text:
            'Nyx Lotus enters tapped.\n{T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.',
        },
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `devotion_creature_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `devotion_creature_card_${index + 1}`,
          name: `Devoted Elf ${index + 1}`,
          type_line: 'Creature — Elf',
          mana_cost: '{G}{G}',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      })),
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{3}{G}',
      totalManaCost: '{3}{G}',
    });

    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    expect(payment.some((entry) => entry.permanentId === 'nyx_lotus_1')).toBe(true);
    const nyxPayment = payment.find((entry) => entry.permanentId === 'nyx_lotus_1');
    expect(String(nyxPayment?.mana || '').toUpperCase()).toBe('G');
  });

  it('uses charged Astral Cornucopia choose-a-color mana for spell payment', async () => {
    const gameId = createTestGameId('astral_cornucopia_charged');
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
        id: 'cornucopia_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: { charge: 3 },
        card: {
          id: 'cornucopia_card_1',
          name: 'Astral Cornucopia',
          type_line: 'Artifact',
          mana_cost: '{X}{X}{X}',
          oracle_text:
            'This artifact enters with X charge counters on it.\n{T}: Choose a color. Add one mana of that color for each charge counter on this artifact.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{2}{G}',
      totalManaCost: '{2}{G}',
    });

    expect(plan).not.toBeNull();
    expect(plan?.payment).toEqual([
      expect.objectContaining({
        permanentId: 'cornucopia_1',
        mana: 'G',
      }),
    ]);
  });

  it('uses transformed Itlimoc multi-creature green mana for spell payment', async () => {
    const gameId = createTestGameId('itlimoc_cradle');
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
        id: 'itlimoc_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'itlimoc_card_1',
          name: 'Itlimoc, Cradle of the Sun',
          type_line: 'Legendary Land',
          oracle_text:
            '(Transforms from Growing Rites of Itlimoc.)\n{T}: Add {G}.\n{T}: Add {G} for each creature you control.',
        },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `beast_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `beast_card_${index + 1}`,
          name: `Beast ${index + 1}`,
          type_line: 'Creature — Beast',
          mana_cost: '{G}',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      })),
    ];

    // Four creatures → Itlimoc makes {G}{G}{G}{G}, enough for {3}{G} alone.
    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{3}{G}',
      totalManaCost: '{3}{G}',
    });

    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    expect(payment.some((entry) => entry.permanentId === 'itlimoc_1')).toBe(true);
    expect(payment.every((entry) => entry.permanentId === 'itlimoc_1')).toBe(true);
    expect(String(payment[0]?.mana || '').toUpperCase()).toBe('G');
  });

  it('pays Elemental Bond with Sunpetal Grove for {G} and Secluded Courtyard {C} for generic', async () => {
    const gameId = createTestGameId('secluded_courtyard_generic_c');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const elementalBond = {
      id: 'bond_card_1',
      name: 'Elemental Bond',
      type_line: 'Enchantment',
      mana_cost: '{2}{G}',
      oracle_text: 'Whenever a creature you control with power 3 or greater enters, draw a card.',
    };

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
        hand: [elementalBond],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).pendingSpellCasts = {
      cast_bond_1: {
        cardId: elementalBond.id,
        cardName: elementalBond.name,
        card: elementalBond,
        playerId,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'sunpetal_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'sunpetal_card_1',
          name: 'Sunpetal Grove',
          type_line: 'Land',
          oracle_text: 'Sunpetal Grove enters tapped unless you control two or more basic lands.\n{T}: Add {G} or {W}.',
        },
      },
      {
        id: 'mountain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'mountain_card_1',
          name: 'Mountain',
          type_line: 'Basic Land — Mountain',
          oracle_text: '{T}: Add {R}.',
        },
      },
      {
        id: 'courtyard_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        chosenCreatureType: 'Elf',
        card: {
          id: 'courtyard_card_1',
          name: 'Secluded Courtyard',
          type_line: 'Land',
          oracle_text:
            'As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.',
        },
      },
    ];

    const plan = await chooseAISpellPaymentSelections(createNoopIo(), gameId, game, playerId as any, {
      manaCost: '{2}{G}',
      totalManaCost: '{2}{G}',
      effectId: 'cast_bond_1',
      cardId: elementalBond.id,
      card: elementalBond,
    });

    expect(plan).not.toBeNull();
    const payment = plan?.payment || [];
    expect(payment).toHaveLength(3);

    const sunpetal = payment.find((entry) => entry.permanentId === 'sunpetal_1');
    const courtyard = payment.find((entry) => entry.permanentId === 'courtyard_1');
    const mountain = payment.find((entry) => entry.permanentId === 'mountain_1');
    expect(String(sunpetal?.mana || '').toUpperCase()).toBe('G');
    expect(mountain).toBeTruthy();
    expect(String(courtyard?.mana || '').toUpperCase()).toBe('C');
    expect(String(courtyard?.abilityId || '')).toBe('courtyard_card_1-ability-0');
  });
});

