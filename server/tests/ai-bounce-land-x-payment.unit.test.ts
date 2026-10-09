import { describe, expect, it } from 'vitest';

import { paymentActivationCostHasUnsupportedAdditionalCosts } from '../src/socket/util-handlers/paymentActivationCostHasUnsupportedAdditionalCosts.js';
import { getPaymentSources } from '../src/socket/ai-handlers/aiPaymentSources.js';
import { canAIAssembleSpellPaymentPlan, chooseAISpellPaymentSelections } from '../src/socket/ai.js';
import {
  buildAISpellPaymentPlan,
  chooseAssembleableSpellXValueFromStep,
} from '../src/socket/ai-handlers/aiSpellPaymentPlanHelpers.js';
import { parseManaCost } from '../src/state/modules/mana-check.js';

const BORIS = 'boris';

const GARRISON = {
  id: 'garrison_1',
  controller: BORIS,
  tapped: false,
  card: {
    id: 'garrison_card',
    name: 'Boros Garrison',
    type_line: 'Land',
    oracle_text: '{T}, Return this land to its owner\'s hand: Add {R}{W}.',
  },
};

const PLAINS = {
  id: 'plains_1',
  controller: BORIS,
  tapped: false,
  card: {
    id: 'plains_card',
    name: 'Plains',
    type_line: 'Basic Land — Plains',
    oracle_text: '{T}: Add {W}.',
  },
};

const MOUNTAIN = (n: number) => ({
  id: `mountain_${n}`,
  controller: BORIS,
  tapped: false,
  card: {
    id: `mountain_card_${n}`,
    name: 'Mountain',
    type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.',
  },
});

function makeGame(battlefield: any[], handCards: any[] = []) {
  return {
    state: {
      players: [{ id: BORIS, name: 'Boris', isAI: true }],
      battlefield,
      manaPool: { [BORIS]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      zones: {
        [BORIS]: { hand: handCards, graveyard: [], exile: [] },
      },
    },
  };
}

describe('AI bounce-land payment and X step-down', () => {
  it('treats bounce-land return-self as a supported mana activation cost', () => {
    expect(
      paymentActivationCostHasUnsupportedAdditionalCosts(
        '{T}, Return this land to its owner\'s hand',
        'Boros Garrison',
      ),
    ).toBe(false);
    expect(
      paymentActivationCostHasUnsupportedAdditionalCosts(
        '{T}, Discard a card',
        'Lotus Petal',
      ),
    ).toBe(true);
  });

  it('assembles {5}{W} using Garrison as two mana plus four basics', () => {
    const game = makeGame([GARRISON, PLAINS, MOUNTAIN(1), MOUNTAIN(2), MOUNTAIN(3)]);
    const parsed = parseManaCost('{5}{W}');
    const sources = getPaymentSources(game, BORIS as any, {
      colors: { ...(parsed.colors || {}), W: Number(parsed.colors?.W || 0) },
      generic: Number(parsed.generic || 0),
    });
    expect(sources.some((source) => source.sourceId === 'garrison_1')).toBe(true);
    expect(canAIAssembleSpellPaymentPlan(game, BORIS as any, parsed)).toBe(true);
    expect(buildAISpellPaymentPlan(game, BORIS as any, parsed)).not.toBeNull();
  });

  it('steps X down to an assembleable value and fails payment selection cheaply when over-X', async () => {
    const wastes = {
      id: 'wastes_1',
      name: 'Secure the Wastes',
      mana_cost: '{X}{W}',
      oracle_text: 'Create X 1/1 white Warrior creature tokens.',
    };
    const game = makeGame(
      [GARRISON, PLAINS, MOUNTAIN(1), MOUNTAIN(2), MOUNTAIN(3)],
      [wastes],
    );

    const chosenX = chooseAssembleableSpellXValueFromStep(game, BORIS as any, {
      spellCastXSelection: true,
      spellCardId: 'wastes_1',
      spellFromZone: 'hand',
      minValue: 0,
      maxValue: 9,
    });
    expect(chosenX).toBeGreaterThanOrEqual(1);
    expect(chosenX).toBeLessThanOrEqual(5);
    expect(canAIAssembleSpellPaymentPlan(game, BORIS as any, parseManaCost(`{${chosenX}}{W}`), ['wastes_1'], wastes)).toBe(true);

    const started = Date.now();
    const overX = await chooseAISpellPaymentSelections({} as any, 'g', game, BORIS as any, {
      totalManaCost: '{9}{W}',
      cardId: 'wastes_1',
    });
    expect(Date.now() - started).toBeLessThan(250);
    expect(overX).toBeNull();
  });
});
