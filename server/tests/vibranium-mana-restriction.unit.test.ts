import { describe, expect, it } from 'vitest';

import { parseManaSpendRestrictionFromOracle } from '../src/state/modules/mana-abilities.js';
import { canPayManaCostWithAvailableSources } from '../src/state/modules/mana-check.js';
import { tryConsumeCastSpellManaFromHand } from '../src/socket/game-actions-handlers/gameActionsCastSpellFromHandConsumeMana.js';
import { consumeExplicitSelectedCastSpellMana } from '../src/socket/game-actions-handlers/gameActionsCastSpellPaymentSources.js';
import { applySelectedManaPaymentForResolutionCost } from '../src/socket/resolution-handlers/resolutionManaPaymentApplication.js';
import { addCastSpellPaymentProducedMana } from '../src/socket/util.js';

describe('Vibranium / Powerstone mana spend restriction', () => {
  const vibraniumOracle =
    "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.";

  it('parses no_nonartifact_spells from Vibranium oracle text', () => {
    expect(parseManaSpendRestrictionFromOracle(vibraniumOracle)).toEqual({
      restriction: 'no_nonartifact_spells',
    });
  });

  it('does not count Vibranium toward casting Generous Gift (nonartifact instant)', () => {
    const generousGift = {
      name: 'Generous Gift',
      type_line: 'Instant',
      mana_cost: '{2}{W}',
      oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.',
    };

    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact - Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
        {
          id: 'plains-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] },
      },
    };

    const canPay = canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 2, hasX: false },
      Infinity,
      {
        restrictedSpendPurpose: {
          isCreature: false,
          isArtifact: false,
          isInstantOrSorcery: true,
          spellCard: generousGift,
        },
      },
    );

    expect(canPay).toBe(false);
  });

  it('allows Vibranium toward an artifact spell when other mana covers colors', () => {
    const solRing = {
      name: 'Sol Ring',
      type_line: 'Artifact',
      mana_cost: '{1}',
      oracle_text: '{T}: Add {C}{C}.',
    };

    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact - Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] },
      },
    };

    const canPay = canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 1, hasX: false },
      Infinity,
      {
        restrictedSpendPurpose: {
          isArtifact: true,
          spellCard: solRing,
        },
      },
    );

    expect(canPay).toBe(true);
  });
  it('allows Vibranium toward an Artifact Vehicle spell (not only Artifact Creature)', () => {
    const royalTalon = {
      name: 'Royal Talon Fighter Jet',
      type_line: 'Artifact - Vehicle',
      mana_cost: '{X}{W}{W}',
      oracle_text: 'Flying',
    };

    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact - Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
        {
          id: 'plains-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
        {
          id: 'plains-2',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Plains',
            type_line: 'Basic Land - Plains',
            oracle_text: '{T}: Add {W}.',
          },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: {
        player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] },
      },
    };

    const canPay = canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 2, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 1, hasX: false },
      Infinity,
      {
        restrictedSpendPurpose: {
          isArtifact: true,
          spellCard: royalTalon,
        },
      },
    );

    expect(canPay).toBe(true);
  });

  const emptyColors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const artifactPurpose = {
    isArtifact: true,
    spellCard: { name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}' },
  };
  const instantPurpose = {
    isInstantOrSorcery: true,
    spellCard: { name: 'Generous Gift', type_line: 'Instant', mana_cost: '{2}{W}' },
  };

  function produceVibraniumIntoPool(amount = 1) {
    const gameState = {
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    };
    const pool = gameState.manaPool.player1 as any;
    const selected = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
    addCastSpellPaymentProducedMana(
      gameState,
      'player1',
      pool,
      selected,
      { colorless: amount },
      { restriction: 'no_nonartifact_spells' },
      { id: 'vib-1', name: 'Vibranium' },
    );
    return { pool, selected };
  }

  it('spends Vibranium mana auto-selected for an artifact spell', () => {
    const { pool, selected } = produceVibraniumIntoPool();
    expect(pool.colorless).toBe(0);
    expect(pool.restricted?.[0]?.restriction).toBe('no_nonartifact_spells');
    expect(selected.colorless).toBe(1);

    const paid = consumeExplicitSelectedCastSpellMana(pool, selected, emptyColors, 1, artifactPurpose);
    expect(paid).toEqual({ consumed: expect.objectContaining({ colorless: 1 }) });
    expect(pool.restricted).toBeUndefined();
    expect(pool.colorless).toBe(0);
  });

  it('spends floating Vibranium on a noncreature artifact when payment is left to auto-pay', () => {
    const { pool } = produceVibraniumIntoPool();
    const game = { state: { manaPool: { player1: pool }, battlefield: [] } };
    const failure: { message?: string } = {};
    const consumed = tryConsumeCastSpellManaFromHand({
      game,
      playerId: 'player1',
      cardInHand: artifactPurpose.spellCard,
      payment: undefined,
      isForceAltCostPaid: false,
      explicitPaymentSelected: false,
      selectedPaymentAvailableTotals: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      totalColored: emptyColors,
      totalGeneric: 1,
      restrictedManaPurpose: artifactPurpose,
      abortCastSpellPayment: (payload) => {
        failure.message = payload.message;
      },
      castingCreatureSpell: false,
      poolBeforePayment: { ...pool },
      poolBeforeSpellPayment: { ...pool },
      creatureSpellHasteLowerBoundBeforePayment: undefined,
      creatureSpellHasteLowerBoundBeforeSpellPayment: undefined,
      producedNonSnowByColor: {},
      producedSnowByColor: {},
      producedTreasureByColor: {},
      producedNonTreasureByColor: {},
    });

    expect(failure.message).toBeUndefined();
    expect(consumed?.manaConsumption?.consumed?.colorless).toBe(1);
    expect(pool.restricted).toBeUndefined();
  });

  it('does not spend Vibranium on a nonartifact spell and leaves it for a legal fallback source', () => {
    const { pool, selected } = produceVibraniumIntoPool();
    pool.white = 1;
    selected.white = 1;
    selected.colorless = 0;

    const paid = consumeExplicitSelectedCastSpellMana(
      pool,
      selected,
      { ...emptyColors, W: 1 },
      0,
      instantPurpose,
    );
    expect('error' in paid).toBe(false);
    expect(pool.white).toBe(0);
    expect(pool.restricted?.[0]?.amount).toBe(1);

    const blocked = consumeExplicitSelectedCastSpellMana(
      produceVibraniumIntoPool().pool,
      { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      emptyColors,
      1,
      instantPurpose,
    );
    expect(blocked).toEqual({
      error: 'Selected colorless mana is restricted and cannot be spent on this payment.',
    });
  });

  it('pays an artifact activated ability with Vibranium, including mana already in the pool', () => {
    const vibraniumOracle =
      "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.";
    const game = {
      id: 'unknown',
      state: {
        battlefield: [
          {
            id: 'vib-1',
            controller: 'player1',
            owner: 'player1',
            tapped: false,
            card: {
              name: 'Vibranium',
              type_line: 'Token Artifact — Vibranium',
              oracle_text: `Indestructible\n${vibraniumOracle}`,
            },
          },
          {
            id: 'basilisk',
            controller: 'player1',
            owner: 'player1',
            tapped: false,
            card: {
              name: 'Basalt Monolith',
              type_line: 'Artifact',
              mana_cost: '{3}',
              oracle_text: '{T}: Add {C}{C}{C}. {3}: Untap this artifact.',
            },
          },
        ],
        manaPool: {
          player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      },
    };

    const tapped = applySelectedManaPaymentForResolutionCost(
      game,
      'player1',
      '{1}',
      [{ permanentId: 'vib-1', mana: 'C', count: 1 }],
      { isActivatedAbility: true, isAbility: true },
      { skipEventPersistence: true },
    );
    expect(tapped.ok).toBe(true);
    if (tapped.ok) {
      expect(tapped.tappedPermanents).toContain('vib-1');
    }

    const floatingGame = {
      id: 'unknown',
      state: {
        battlefield: [],
        manaPool: {
          player1: {
            white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
            restricted: [{
              type: 'colorless',
              amount: 1,
              restriction: 'no_nonartifact_spells',
              sourceId: 'vib-1',
              sourceName: 'Vibranium',
            }],
          },
        },
      },
    };
    const fromPool = applySelectedManaPaymentForResolutionCost(
      floatingGame,
      'player1',
      '{1}',
      [{ permanentId: '__pool__:restricted:0', mana: 'C', count: 1 }],
      { isActivatedAbility: true, isAbility: true },
      { skipEventPersistence: true },
    );
    expect(fromPool.ok).toBe(true);
    expect(floatingGame.state.manaPool.player1.restricted).toBeUndefined();
  });

  
  it('prefers Vibranium restricted mana before regular colorless for an artifact spell', () => {
    const { pool, selected } = produceVibraniumIntoPool();
    pool.colorless = 2;
    selected.colorless = 3; // 1 restricted (already counted) + 2 regular

    const paid = consumeExplicitSelectedCastSpellMana(pool, selected, emptyColors, 1, artifactPurpose);
    expect('error' in paid).toBe(false);
    expect(pool.restricted).toBeUndefined();
    expect(pool.colorless).toBe(2);
  });

  it('prefers floating Vibranium before regular mana when auto-paying an artifact spell', () => {
    const { pool } = produceVibraniumIntoPool();
    pool.colorless = 1;
    const game = { state: { manaPool: { player1: pool }, battlefield: [] } };
    const failure: { message?: string } = {};
    const consumed = tryConsumeCastSpellManaFromHand({
      game,
      playerId: 'player1',
      cardInHand: artifactPurpose.spellCard,
      payment: undefined,
      isForceAltCostPaid: false,
      explicitPaymentSelected: false,
      selectedPaymentAvailableTotals: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      totalColored: emptyColors,
      totalGeneric: 1,
      restrictedManaPurpose: artifactPurpose,
      abortCastSpellPayment: (payload) => {
        failure.message = payload.message;
      },
      castingCreatureSpell: false,
      poolBeforePayment: { ...pool },
      poolBeforeSpellPayment: { ...pool },
      creatureSpellHasteLowerBoundBeforePayment: undefined,
      creatureSpellHasteLowerBoundBeforeSpellPayment: undefined,
      producedNonSnowByColor: {},
      producedSnowByColor: {},
      producedTreasureByColor: {},
      producedNonTreasureByColor: {},
    });

    expect(failure.message).toBeUndefined();
    expect(consumed?.manaConsumption?.consumed?.colorless).toBe(1);
    expect(pool.restricted).toBeUndefined();
    expect(pool.colorless).toBe(1);
  });

  it('prefers Vibranium before regular colorless when paying an artifact activated ability', () => {
    const floatingGame = {
      id: 'unknown',
      state: {
        battlefield: [],
        manaPool: {
          player1: {
            white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2,
            restricted: [{
              type: 'colorless',
              amount: 1,
              restriction: 'no_nonartifact_spells',
              sourceId: 'vib-1',
              sourceName: 'Vibranium',
            }],
          },
        },
      },
    };
    const fromPool = applySelectedManaPaymentForResolutionCost(
      floatingGame,
      'player1',
      '{1}',
      [{ permanentId: '__pool__:restricted:0', mana: 'C', count: 1 }],
      { isActivatedAbility: true, isAbility: true },
      { skipEventPersistence: true },
    );
    expect(fromPool.ok).toBe(true);
    expect(floatingGame.state.manaPool.player1.restricted).toBeUndefined();
    expect(floatingGame.state.manaPool.player1.colorless).toBe(2);
  });

it('can pay a nonartifact spell from other lands when Vibranium is also available', () => {
    const state = {
      battlefield: [
        {
          id: 'vib-1',
          controller: 'player1',
          tapped: false,
          card: {
            name: 'Vibranium',
            type_line: 'Token Artifact — Vibranium',
            oracle_text: vibraniumOracle,
          },
        },
        {
          id: 'plains-1',
          controller: 'player1',
          tapped: false,
          card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.' },
        },
        {
          id: 'plains-2',
          controller: 'player1',
          tapped: false,
          card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.' },
        },
      ],
      manaPool: {
        player1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      zones: { player1: { hand: [], libraryCount: 0, graveyard: [], exile: [] } },
    };

    expect(canPayManaCostWithAvailableSources(
      state,
      'player1',
      { colors: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, generic: 1, hasX: false },
      Infinity,
      { restrictedSpendPurpose: instantPurpose },
    )).toBe(true);
  });

});
