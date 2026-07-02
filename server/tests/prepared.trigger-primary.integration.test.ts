import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { isOracleIrTriggerPrimaryEnabled } from '../src/state/modules/oracleIrTriggerExecution.js';

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
  };
}

function seedZones(game: any, playerId: string) {
  (game.state as any).zones = (game.state as any).zones || {};
  (game.state as any).zones[playerId] = {
    hand: [],
    handCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

function findBattlefieldPermanent(game: any, permanentId: string) {
  return ((game.state as any).battlefield || []).find((entry: any) => entry?.id === permanentId);
}

describe('prepared triggers under trigger IR primary production default', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_TRIGGER_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
    if (previousLegacy === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    } else {
      process.env.ORACLE_IR_TRIGGER_LEGACY = previousLegacy;
    }
  });

  it('enables trigger primary when env overrides are cleared', () => {
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);
  });

  it('prepares via grant_static_ability IR when life-gain threshold is met', () => {
    const game = createInitialGameState('prepared_trigger_primary_life_true');
    game.applyEvent!({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    const ctx = game as any;
    ctx.gameId = 'prepared_trigger_primary_life_true';

    const card = buildPreparedConditionalCard(
      'Scheming Silvertongue',
      "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_life_true', 'p1', card);
    (game.state as any).battlefield = [sourcePermanent];
    (game.state as any).lifeGainedThisTurn = { p1: 2 };
    seedZones(game, 'p1');

    executeTriggerEffect(
      ctx,
      'p1',
      'Scheming Silvertongue',
      "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared.",
      {
        id: 'trigger_life_true',
        source: sourcePermanent.id,
        sourceName: 'Scheming Silvertongue',
        targets: [],
      },
    );

    const updatedPermanent = findBattlefieldPermanent(game, sourcePermanent.id);
    expect(updatedPermanent?.prepared).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(1);
    expect((game.state as any).zones.p1.exile[0].name).toBe('Study Break');
  });

  it('does not prepare when life-gain condition is false under IR primary', () => {
    const game = createInitialGameState('prepared_trigger_primary_life_false');
    game.applyEvent!({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    const ctx = game as any;
    ctx.gameId = 'prepared_trigger_primary_life_false';

    const card = buildPreparedConditionalCard(
      'Eccentric Pestfinder',
      "At the beginning of each end step, if you gained life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_life_false', 'p1', card);
    (game.state as any).battlefield = [sourcePermanent];
    (game.state as any).lifeGainedThisTurn = { p1: 0 };
    seedZones(game, 'p1');

    executeTriggerEffect(
      ctx,
      'p1',
      'Eccentric Pestfinder',
      "At the beginning of each end step, if you gained life this turn, this creature becomes prepared.",
      {
        id: 'trigger_life_false',
        source: sourcePermanent.id,
        sourceName: 'Eccentric Pestfinder',
        targets: [],
      },
    );

    const updatedPermanent = findBattlefieldPermanent(game, sourcePermanent.id);
    expect(updatedPermanent?.prepared).not.toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
  });

  it('prepares when opponent controls more creatures via conditional IR grant', () => {
    const game = createInitialGameState('prepared_trigger_primary_creature_count');
    game.applyEvent!({ type: 'join', playerId: 'p1', name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: 'p2', name: 'P2' } as any);
    const ctx = game as any;
    ctx.gameId = 'prepared_trigger_primary_creature_count';

    const card = buildPreparedConditionalCard(
      'Emeritus of Truce',
      "When this creature enters, target player creates a 1/1 white and black Inkling creature token with flying. Then if an opponent controls more creatures than you, this creature becomes prepared.",
    );
    card.card_faces[1] = {
      name: 'Swords to Plowshares',
      mana_cost: '{W}',
      type_line: 'Instant',
      oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
    };
    const sourcePermanent = createPreparedSourcePermanent('perm_emeritus', 'p1', card);
    (game.state as any).battlefield = [
      sourcePermanent,
      {
        id: 'opp_creature_a',
        controller: 'p2',
        owner: 'p2',
        card: { type_line: 'Creature — Bear' },
      },
      {
        id: 'opp_creature_b',
        controller: 'p2',
        owner: 'p2',
        card: { type_line: 'Creature — Bear' },
      },
    ];
    seedZones(game, 'p1');

    executeTriggerEffect(
      ctx,
      'p1',
      'Emeritus of Truce',
      'Then if an opponent controls more creatures than you, this creature becomes prepared.',
      {
        id: 'trigger_emeritus',
        source: sourcePermanent.id,
        sourceName: 'Emeritus of Truce',
        targets: ['p2'],
      },
    );

    const updatedPermanent = findBattlefieldPermanent(game, 'perm_emeritus');
    expect(updatedPermanent?.prepared).toBe(true);
    expect((game.state as any).zones.p1.exile).toHaveLength(1);
    expect((game.state as any).zones.p1.exile[0].name).toBe('Swords to Plowshares');
  });
});
