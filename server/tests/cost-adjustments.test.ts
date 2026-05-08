import { describe, expect, it } from 'vitest';
import {
  applyCostAdjustmentToParsedCost,
  buildCostAdjustmentPlan,
  buildLiveSpellCostAdjustment,
} from '../src/state/modules/cost-adjustments.js';

const redSpell = {
  id: 'red_spell',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  mana_cost: '{R}',
  colors: ['R'],
};

const artifactSpell = {
  id: 'artifact_spell',
  name: 'Sol Ring',
  type_line: 'Artifact',
  mana_cost: '{1}',
  colors: [],
};

const blueSpell = {
  id: 'blue_spell',
  name: 'Opt',
  type_line: 'Instant',
  mana_cost: '{1}{U}',
  colors: ['U'],
};

const creatureSpell = {
  id: 'creature_spell',
  name: 'Grizzly Bears',
  type_line: 'Creature - Bear',
  mana_cost: '{1}{G}',
  colors: ['G'],
};

function permanent(options: {
  id: string;
  controller: string;
  name: string;
  oracleText: string;
  typeLine?: string;
  phasedOut?: boolean;
}) {
  return {
    id: options.id,
    controller: options.controller,
    phasedOut: options.phasedOut === true,
    card: {
      name: options.name,
      type_line: options.typeLine || 'Artifact',
      oracle_text: options.oracleText,
    },
  };
}

describe('cost adjustment engine', () => {
  it('applies global battlefield taxes to every player', () => {
    const state = {
      battlefield: [permanent({
        id: 'sphere',
        controller: 'p1',
        name: 'Sphere of Resistance',
        oracleText: 'Spells cost {1} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', redSpell).genericAdjustment).toBe(1);
    expect(buildCostAdjustmentPlan(state, 'p2', redSpell).genericAdjustment).toBe(1);
  });

  it('keeps controller-scoped reductions on the controller only', () => {
    const state = {
      battlefield: [permanent({
        id: 'ruby',
        controller: 'p1',
        name: 'Ruby Medallion',
        oracleText: 'Red spells you cast cost {1} less to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', redSpell).genericAdjustment).toBe(-1);
    expect(buildCostAdjustmentPlan(state, 'p2', redSpell).genericAdjustment).toBe(0);
  });

  it('keeps opponent-scoped taxes off the source controller', () => {
    const state = {
      battlefield: [permanent({
        id: 'aura',
        controller: 'p1',
        name: 'Aura of Silence',
        oracleText: 'Artifact and enchantment spells your opponents cast cost {2} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', artifactSpell).genericAdjustment).toBe(0);
    expect(buildCostAdjustmentPlan(state, 'p2', artifactSpell).genericAdjustment).toBe(2);
  });

  it('ignores phased-out battlefield sources', () => {
    const state = {
      battlefield: [permanent({
        id: 'phased_sphere',
        controller: 'p1',
        name: 'Sphere of Resistance',
        oracleText: 'Spells cost {1} more to cast.',
        phasedOut: true,
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', redSpell).genericAdjustment).toBe(0);
  });

  it('can filter static source types while applying colored reductions', () => {
    const state = {
      battlefield: [permanent({
        id: 'sphere',
        controller: 'p1',
        name: 'Sphere of Resistance',
        oracleText: 'Spells cost {1} more to cast.',
      })],
      activePlane: {
        id: 'feeding_grounds',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast. Green spells cost {G} less to cast.',
      },
    };

    const plan = buildCostAdjustmentPlan(state, 'p1', redSpell, { sourceTypes: ['plane'] });
    const live = buildLiveSpellCostAdjustment(plan);

    expect(plan.totalAdjustment).toBe(-1);
    expect(live.coloredReductions.red).toBe(1);
    expect(live.taxMessages).toEqual([]);
  });

  it('applies noncreature taxes only to noncreature spells', () => {
    const state = {
      battlefield: [permanent({
        id: 'thorn',
        controller: 'p1',
        name: 'Thorn of Amethyst',
        oracleText: 'Noncreature spells cost {1} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', blueSpell).genericAdjustment).toBe(1);
    expect(buildCostAdjustmentPlan(state, 'p1', creatureSpell).genericAdjustment).toBe(0);
  });

  it('applies nonartifact taxes only to nonartifact spells', () => {
    const state = {
      battlefield: [permanent({
        id: 'lodestone',
        controller: 'p1',
        name: 'Lodestone Golem',
        oracleText: 'Nonartifact spells cost {1} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', creatureSpell).genericAdjustment).toBe(1);
    expect(buildCostAdjustmentPlan(state, 'p1', artifactSpell).genericAdjustment).toBe(0);
  });

  it('treats no-controller affects-all opponent-scoped sources as global effects', () => {
    const state = {
      activeSchemes: [{
        id: 'scheme_opponent_tax',
        name: 'Every Hope Shall Vanish',
        oracle_text: 'Spells your opponents cast cost {1} more to cast.',
      }],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', blueSpell).genericAdjustment).toBe(1);
    expect(buildCostAdjustmentPlan(state, 'p2', blueSpell).genericAdjustment).toBe(1);
  });

  it('applies controlled opponent-scoped generic taxes only to opponents', () => {
    const state = {
      battlefield: [permanent({
        id: 'opponent_tax_source',
        controller: 'p1',
        name: 'Opponent Tax Source',
        oracleText: 'Spells your opponents cast cost {1} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', blueSpell).genericAdjustment).toBe(0);
    expect(buildCostAdjustmentPlan(state, 'p2', blueSpell).genericAdjustment).toBe(1);
  });

  it('combines opponent scope with type restrictions on controlled taxes', () => {
    const state = {
      battlefield: [permanent({
        id: 'opponent_noncreature_tax_source',
        controller: 'p1',
        name: 'Opponent Noncreature Tax Source',
        oracleText: 'Noncreature spells your opponents cast cost {1} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', blueSpell).genericAdjustment).toBe(0);
    expect(buildCostAdjustmentPlan(state, 'p2', blueSpell).genericAdjustment).toBe(1);
    expect(buildCostAdjustmentPlan(state, 'p2', creatureSpell).genericAdjustment).toBe(0);
  });

  it('keeps controlled you-cast taxes on the source controller', () => {
    const state = {
      battlefield: [permanent({
        id: 'self_tax_source',
        controller: 'p1',
        name: 'Self Tax Source',
        oracleText: 'Spells you cast cost {1} more to cast.',
      })],
    };

    expect(buildCostAdjustmentPlan(state, 'p1', blueSpell).genericAdjustment).toBe(1);
    expect(buildCostAdjustmentPlan(state, 'p2', blueSpell).genericAdjustment).toBe(0);
  });

  it('keeps mixed colored reductions and generic taxes structured separately', () => {
    const state = {
      battlefield: [permanent({
        id: 'sphere',
        controller: 'p1',
        name: 'Sphere of Resistance',
        oracleText: 'Spells cost {1} more to cast.',
      })],
      activePlane: {
        id: 'blue_discount',
        name: 'Blue Discount',
        oracle_text: 'Blue spells cost {U} less to cast.',
      },
    };

    const plan = buildCostAdjustmentPlan(state, 'p1', blueSpell);
    const live = buildLiveSpellCostAdjustment(plan);
    const adjusted = applyCostAdjustmentToParsedCost({ generic: 1, colors: { U: 1 }, hasX: false }, plan);

    expect(plan.totalAdjustment).toBe(0);
    expect(live.genericTax).toBe(1);
    expect(live.coloredReductions.blue).toBe(1);
    expect(adjusted).toMatchObject({ generic: 2, colors: { U: 0 }, hasX: false });
  });

  it('preserves parseManaCost-compatible shape when applying structured adjustments', () => {
    const parsedCost = {
      generic: 1,
      colors: { R: 1 },
      hasX: true,
      hybrid: [['R', 'G']],
    };
    const plan = buildCostAdjustmentPlan({
      activePlane: {
        id: 'feeding_grounds',
        name: 'Feeding Grounds',
        oracle_text: 'Red spells cost {R} less to cast.',
      },
    }, 'p1', redSpell);

    const adjusted = applyCostAdjustmentToParsedCost(parsedCost, plan);

    expect(adjusted).toMatchObject({ generic: 1, colors: { R: 0 }, hasX: true });
    expect(adjusted.hybrid).toEqual([['R', 'G']]);
    expect(adjusted.hybrid).not.toBe(parsedCost.hybrid);
  });
});