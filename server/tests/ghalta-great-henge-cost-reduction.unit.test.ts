import { describe, expect, it } from 'vitest';
import { buildPendingCastCostMetadata, calculateCostReduction } from '../src/socket/game-actions.js';
import { applySpellSelfCreaturePowerCostReduction } from '../src/state/modules/spellSelfCreaturePowerCostReduction.js';

const GHALTA_ORACLE =
  'This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample';

const GREAT_HENGE_ORACLE =
  'This spell costs {X} less to cast, where X is the greatest power among creatures you control.\n{T}: Add {G}{G}. You gain 2 life.\nWhenever a nontoken creature you control enters, put a +1/+1 counter on it and draw a card.';

function makeGame(battlefield: any[]) {
  return {
    state: {
      battlefield,
      zones: { p1: { graveyard: [] } },
    },
  } as any;
}

function creature(id: string, power: number, controller = 'p1') {
  return {
    id,
    controller,
    power,
    basePower: power,
    card: {
      name: id,
      type_line: 'Creature',
      power: String(power),
    },
  };
}

describe('spellSelfCreaturePowerCostReduction (Ghalta / Great Henge)', () => {
  it('reduces Ghalta by the total power of creatures you control, not the spell itself', () => {
    const delta = applySpellSelfCreaturePowerCostReduction({
      oracleText: GHALTA_ORACLE,
      cardName: 'Ghalta, Primal Hunger',
      playerId: 'p1',
      battlefield: [
        creature('c1', 4),
        creature('c2', 8),
        creature('opp', 99, 'p2'),
        {
          id: 'sol',
          controller: 'p1',
          card: { name: 'Sol Ring', type_line: 'Artifact' },
        },
      ],
    });
    expect(delta.generic).toBe(12);
    expect(delta.messages[0]).toMatch(/total creature power/);
  });

  it('reduces The Great Henge by the greatest power among creatures you control', () => {
    const delta = applySpellSelfCreaturePowerCostReduction({
      oracleText: GREAT_HENGE_ORACLE,
      cardName: 'The Great Henge',
      playerId: 'p1',
      battlefield: [creature('c1', 4), creature('c2', 12), creature('c3', 7)],
    });
    expect(delta.generic).toBe(12);
    expect(delta.messages[0]).toMatch(/greatest creature power/);
  });

  it('applies through calculateCostReduction for Ghalta and Great Henge', () => {
    const battlefield = [creature('c1', 5), creature('c2', 7)];
    const game = makeGame(battlefield);

    const ghalta = calculateCostReduction(game, 'p1', {
      name: 'Ghalta, Primal Hunger',
      mana_cost: '{10}{G}{G}',
      type_line: 'Legendary Creature — Elder Dinosaur',
      oracle_text: GHALTA_ORACLE,
      colors: ['G'],
    });
    expect(ghalta.generic).toBe(12);

    const henge = calculateCostReduction(game, 'p1', {
      name: 'The Great Henge',
      mana_cost: '{7}{G}{G}',
      type_line: 'Legendary Artifact',
      oracle_text: GREAT_HENGE_ORACLE,
      colors: ['G'],
    });
    expect(henge.generic).toBe(7);
  });

  it('matches Ghalta reminder-text oracle and counts owner-only creatures', () => {
    const delta = applySpellSelfCreaturePowerCostReduction({
      oracleText:
        'This spell costs {X} less to cast, where X is the total power of creatures you control.\nTrample (This creature can deal excess combat damage to the player or planeswalker it\'s attacking.)',
      cardName: 'Ghalta, Primal Hunger',
      playerId: 'p_nkau8om1',
      battlefield: [
        {
          id: 'stack_bug',
          owner: 'p_nkau8om1',
          card: { name: 'Bugenhagen, Wise Elder', type_line: 'Legendary Creature — Elf Druid Advisor', power: '1' },
        },
        {
          id: 'perm_dino',
          owner: 'p_nkau8om1',
          card: { name: 'Apex Altisaur', type_line: 'Creature — Dinosaur', power: '10' },
        },
      ],
    });
    expect(delta.generic).toBe(11);
  });

  it('hydrates printed power from local lookup when battlefield P/T fields are missing', () => {
    const delta = applySpellSelfCreaturePowerCostReduction({
      oracleText: GHALTA_ORACLE,
      cardName: 'Ghalta, Primal Hunger',
      playerId: 'p1',
      battlefield: [
        {
          id: 'bears',
          controller: 'p1',
          card: { name: 'Knight of the White Orchid', type_line: 'Creature — Human Knight' },
        },
        {
          id: 'elves',
          controller: 'p1',
          card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
        },
      ],
    });
    expect(delta.generic).toBe(3);
  });

  it('applies the reduction to pending-cast effectiveManaCost, not only costReduction.generic', () => {
    const metadata = buildPendingCastCostMetadata(
      makeGame([creature('c1', 5), creature('c2', 7)]),
      'p1',
      {
        name: 'Ghalta, Primal Hunger',
        mana_cost: '{10}{G}{G}',
        type_line: 'Legendary Creature — Elder Dinosaur',
        oracle_text: GHALTA_ORACLE,
        colors: ['G'],
      },
      'hand',
    );
    expect(metadata.costReduction.generic).toBe(12);
    expect(metadata.paymentModel.effectiveManaCost).toBe('{G}{G}');
    expect(metadata.paymentModel.parsedEffectiveCost.generic).toBe(0);
  });

  it('zeros pending-cast effectiveManaCost when the card is stamped as a free cast', () => {
    const metadata = buildPendingCastCostMetadata(
      makeGame([]),
      'p1',
      {
        name: 'Baeloth Barrityl, Entertainer',
        mana_cost: '{4}{R}',
        type_line: 'Legendary Creature — Elf Shaman',
        oracle_text: 'Creatures your opponents control with power less than Baeloth Barrityl\'s power are goaded.',
        colors: ['R'],
        castWithoutPayingManaCost: true,
        forcedAlternateCostId: 'free',
      },
      'exile',
    );
    expect(metadata.paymentModel.effectiveManaCost).toBe('{0}');
    expect(metadata.paymentModel.castWithoutPayingManaCost).toBe(true);
    expect(metadata.paymentModel.originalManaCost).toBe('{4}{R}');
  });
});
