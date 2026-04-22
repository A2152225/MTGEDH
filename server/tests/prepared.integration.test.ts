import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ event: string; payload: any }>) {
  return {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (_event: string, _handler: Function) => {},
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
}

function buildEmeritusOfTruceCard() {
  return {
    id: 'em_truce_raw',
    name: 'Emeritus of Truce // Swords to Plowshares',
    layout: 'prepare',
    mana_cost: '{1}{W}{W} // {W}',
    type_line: 'Creature — Cat Cleric // Instant',
    colors: ['W'],
    color_identity: ['W'],
    card_faces: [
      {
        name: 'Emeritus of Truce',
        mana_cost: '{1}{W}{W}',
        type_line: 'Creature — Cat Cleric',
        oracle_text: "When this creature enters, target player creates a 1/1 white and black Inkling creature token with flying. Then if an opponent controls more creatures than you, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: '3',
        toughness: '3',
      },
      {
        name: 'Swords to Plowshares',
        mana_cost: '{W}',
        type_line: 'Instant',
        oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      },
    ],
    power: '3',
    toughness: '3',
    image_uris: { small: 'https://example.com/em_truce.jpg' },
  };
}

function buildPreparedOnEntryCard() {
  return {
    id: 'prepared_student_raw',
    name: 'Prepared Student // Timely Insight',
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Human Wizard // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: 'Prepared Student',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Wizard',
        oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: '2',
        toughness: '3',
      },
      {
        name: 'Timely Insight',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
      },
    ],
    power: '2',
    toughness: '3',
    image_uris: { small: 'https://example.com/prepared_student.jpg' },
  };
}

function buildPreparedConditionalCard(frontName: string, frontOracleText: string) {
  return {
    id: `${frontName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_raw`,
    name: `${frontName} // Study Break`,
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Wizard // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: frontName,
        mana_cost: '{2}{U}',
        type_line: 'Creature — Wizard',
        oracle_text: frontOracleText,
        power: '2',
        toughness: '3',
      },
      {
        name: 'Study Break',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
      },
    ],
    power: '2',
    toughness: '3',
    image_uris: { small: 'https://example.com/prepared_conditional.jpg' },
  };
}

function createPreparedSourcePermanent(permanentId: string, controller: string, card: any) {
  const frontFace = card.card_faces[0];
  return {
    id: permanentId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: Number(frontFace.power || 0),
    baseToughness: Number(frontFace.toughness || 0),
    card: {
      ...card,
      name: frontFace.name,
      mana_cost: frontFace.mana_cost,
      type_line: frontFace.type_line,
      oracle_text: frontFace.oracle_text,
      zone: 'battlefield',
    },
  } as any;
}

function seedBaseGame(game: any, playerId = 'p1') {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).priority = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).turnPlayer = playerId;
  (game.state as any).turnNumber = 3;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    p1: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0, white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
    p2: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
}

describe('Prepared integration', () => {
  const gameIds = [
    'test_prepared_resolve',
    'test_prepared_request_cast',
    'test_prepared_cast_from_exile',
    'test_prepared_emeritus_condition',
  ];

  async function resetAllGames() {
    for (const gameId of gameIds) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      await deleteGame(gameId);
    }
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetAllGames();
  });

  afterEach(async () => {
    await resetAllGames();
  });

  it('resolves a prepare creature on its front face and creates a prepared exile copy on entry', () => {
    createGameIfNotExists(gameIds[0], 'commander', 40);
    const game = ensureGame(gameIds[0]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: 'p1',
        card: buildPreparedOnEntryCard(),
      },
    ];

    game.resolveTopOfStack();

    const permanent = (game.state as any).battlefield[0] as any;
    expect(permanent).toBeDefined();
    expect(permanent.card.name).toBe('Prepared Student');
    expect(permanent.card.mana_cost).toBe('{2}{U}');
    expect(permanent.prepared).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(1);
    expect((game.state as any).zones.p1.exile[0]).toMatchObject({
      name: 'Timely Insight',
      mana_cost: '{1}{U}',
      preparedSourcePermanentId: permanent.id,
      canBePlayedBy: 'p1',
    });
  });

  it('queues payment using the front face mana cost when casting a prepare card from hand', async () => {
    createGameIfNotExists(gameIds[1], 'commander', 40);
    const game = ensureGame(gameIds[1]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    (game.state as any).zones.p1.hand = [buildPreparedOnEntryCard()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ event: string; payload: any }> = [];
    const socket = createMockSocket('p1', gameIds[1], emitted);

    await requestCastSpellForSocket(createNoopIo() as any, socket as any, {
      gameId: gameIds[1],
      cardId: 'prepared_student_raw',
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameIds[1])
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && step.spellPaymentRequired === true) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Prepared Student');
    expect(paymentStep.manaCost).toBe('{2}{U}');
  });

  it('unprepares the source permanent when a prepared copy is cast and the copy ceases after resolution', () => {
    createGameIfNotExists(gameIds[2], 'commander', 40);
    const game = ensureGame(gameIds[2]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const preparedCard = buildPreparedOnEntryCard();
    const frontFace = preparedCard.card_faces[0];
    const permanent = {
      id: 'perm_truce',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      basePower: 3,
      baseToughness: 3,
      summoningSickness: false,
      card: {
        ...preparedCard,
        name: frontFace.name,
        mana_cost: frontFace.mana_cost,
        type_line: frontFace.type_line,
        oracle_text: frontFace.oracle_text,
        zone: 'battlefield',
      },
    } as any;
    (game.state as any).battlefield = [permanent];
    setPermanentPrepared((game.state as any), permanent);
    const preparedCopy = (game.state as any).zones.p1.exile[0];

    game.applyEvent({
      type: 'castSpell',
      playerId: 'p1',
      fromZone: 'exile',
      cardId: String(preparedCopy.id),
      card: { ...preparedCopy },
      targets: [],
    } as any);

    expect(permanent.prepared).toBe(false);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    expect((game.state as any).stack).toHaveLength(0);
    expect((game.state as any).zones.p1.graveyard).toHaveLength(0);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
  });

  it('marks Emeritus of Truce prepared when its post-token condition is satisfied', () => {
    createGameIfNotExists(gameIds[3], 'commander', 40);
    const game = ensureGame(gameIds[3]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const frontFace = buildEmeritusOfTruceCard().card_faces[0];
    const sourcePermanent = {
      id: 'perm_emeritus',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      basePower: 3,
      baseToughness: 3,
      card: {
        ...buildEmeritusOfTruceCard(),
        name: frontFace.name,
        mana_cost: frontFace.mana_cost,
        type_line: frontFace.type_line,
        oracle_text: frontFace.oracle_text,
        zone: 'battlefield',
      },
    } as any;
    const opposingCreatureA = {
      id: 'opp_creature_a',
      controller: 'p2',
      owner: 'p2',
      tapped: false,
      counters: {},
      basePower: 2,
      baseToughness: 2,
      card: { id: 'opp_a', name: 'Opponent Creature A', type_line: 'Creature — Bear', power: '2', toughness: '2', zone: 'battlefield' },
    } as any;
    const opposingCreatureB = {
      id: 'opp_creature_b',
      controller: 'p2',
      owner: 'p2',
      tapped: false,
      counters: {},
      basePower: 2,
      baseToughness: 2,
      card: { id: 'opp_b', name: 'Opponent Creature B', type_line: 'Creature — Bear', power: '2', toughness: '2', zone: 'battlefield' },
    } as any;

    (game.state as any).battlefield = [sourcePermanent, opposingCreatureA, opposingCreatureB];

    executeTriggerEffect(
      game as any,
      'p1' as any,
      'Emeritus of Truce',
      "Then if an opponent controls more creatures than you, this creature becomes prepared.",
      {
        id: 'trigger_emeritus',
        source: sourcePermanent.id,
        sourceName: 'Emeritus of Truce',
        targets: ['p2'],
      },
    );

    expect(sourcePermanent.prepared).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(1);
    expect((game.state as any).zones.p1.exile[0].name).toBe('Swords to Plowshares');
  });

  it('does not prepare when a life-gain condition is false', () => {
    createGameIfNotExists(gameIds[0], 'commander', 40);
    const game = ensureGame(gameIds[0]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const card = buildPreparedConditionalCard(
      'Eccentric Pestfinder',
      "At the beginning of each end step, if you gained life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_life_check', 'p1', card);
    (game.state as any).battlefield = [sourcePermanent];
    (game.state as any).lifeGainedThisTurn = { p1: 0 };

    executeTriggerEffect(
      game as any,
      'p1' as any,
      'Eccentric Pestfinder',
      "At the beginning of each end step, if you gained life this turn, this creature becomes prepared.",
      {
        id: 'trigger_life_false',
        source: sourcePermanent.id,
        sourceName: 'Eccentric Pestfinder',
        targets: [],
      },
    );

    expect(sourcePermanent.prepared).not.toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
  });

  it('prepares when a life-gain threshold condition is met', () => {
    createGameIfNotExists(gameIds[1], 'commander', 40);
    const game = ensureGame(gameIds[1]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const card = buildPreparedConditionalCard(
      'Scheming Silvertongue',
      "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_life_true', 'p1', card);
    (game.state as any).battlefield = [sourcePermanent];
    (game.state as any).lifeGainedThisTurn = { p1: 2 };

    executeTriggerEffect(
      game as any,
      'p1' as any,
      'Scheming Silvertongue',
      "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared.",
      {
        id: 'trigger_life_true',
        source: sourcePermanent.id,
        sourceName: 'Scheming Silvertongue',
        targets: [],
      },
    );

    expect(sourcePermanent.prepared).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(1);
  });

  it('does not prepare when a hand-size condition is false', () => {
    createGameIfNotExists(gameIds[2], 'commander', 40);
    const game = ensureGame(gameIds[2]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const card = buildPreparedConditionalCard(
      'Naktamun Lorespinner',
      "At the beginning of your upkeep, if a player has one or fewer cards in hand, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_hand_false', 'p1', card);
    (game.state as any).battlefield = [sourcePermanent];
    (game.state as any).zones.p1.handCount = 3;
    (game.state as any).zones.p2.handCount = 2;

    executeTriggerEffect(
      game as any,
      'p1' as any,
      'Naktamun Lorespinner',
      "At the beginning of your upkeep, if a player has one or fewer cards in hand, this creature becomes prepared.",
      {
        id: 'trigger_hand_false',
        source: sourcePermanent.id,
        sourceName: 'Naktamun Lorespinner',
        targets: [],
      },
    );

    expect(sourcePermanent.prepared).not.toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
  });

  it('does not prepare when a land-count condition is false', () => {
    createGameIfNotExists(gameIds[3], 'commander', 40);
    const game = ensureGame(gameIds[3]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const card = buildPreparedConditionalCard(
      'Emeritus of Abundance',
      "Whenever this creature attacks, if you control eight or more lands, this creature becomes prepared.",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_land_false', 'p1', card);
    const lands = Array.from({ length: 7 }, (_, index) => ({
      id: `land_${index}`,
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      card: { id: `land_card_${index}`, name: `Land ${index}`, type_line: 'Basic Land — Plains', zone: 'battlefield' },
    }));
    (game.state as any).battlefield = [sourcePermanent, ...lands];

    executeTriggerEffect(
      game as any,
      'p1' as any,
      'Emeritus of Abundance',
      "Whenever this creature attacks, if you control eight or more lands, this creature becomes prepared.",
      {
        id: 'trigger_land_false',
        source: sourcePermanent.id,
        sourceName: 'Emeritus of Abundance',
        targets: [],
      },
    );

    expect(sourcePermanent.prepared).not.toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
  });

  it('removes a prepared exile copy immediately when the source permanent goes to the graveyard', () => {
    createGameIfNotExists(gameIds[0], 'commander', 40);
    const game = ensureGame(gameIds[0]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const preparedCard = buildPreparedOnEntryCard();
    const sourcePermanent = createPreparedSourcePermanent('perm_cleanup_graveyard', 'p1', preparedCard);
    (game.state as any).battlefield = [sourcePermanent];
    setPermanentPrepared((game.state as any), sourcePermanent);

    expect((game.state as any).zones.p1.exile).toHaveLength(1);

    const moved = movePermanentToGraveyard(game as any, sourcePermanent.id, false);

    expect(moved).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
    expect((game.state as any).zones.p1.graveyard).toHaveLength(1);
  });

  it('removes a prepared exile copy immediately when the source permanent returns to hand', () => {
    createGameIfNotExists(gameIds[1], 'commander', 40);
    const game = ensureGame(gameIds[1]);
    if (!game) throw new Error('ensureGame returned undefined');

    seedBaseGame(game);
    const preparedCard = buildPreparedOnEntryCard();
    const sourcePermanent = createPreparedSourcePermanent('perm_cleanup_hand', 'p1', preparedCard);
    (game.state as any).battlefield = [sourcePermanent];
    setPermanentPrepared((game.state as any), sourcePermanent);

    expect((game.state as any).zones.p1.exile).toHaveLength(1);

    const moved = movePermanentToHand(game as any, sourcePermanent.id);

    expect(moved).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
    expect((game.state as any).zones.p1.hand).toHaveLength(1);
  });
});