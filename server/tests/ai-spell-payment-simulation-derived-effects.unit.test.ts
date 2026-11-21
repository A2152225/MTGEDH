import { beforeEach, describe, expect, it, vi } from 'vitest';

// Counts full continuous-effects recomputes: buildContinuousEffectsBase calls
// stampLayer4TypeSetting exactly once per recomputeContinuousEffects.
const recomputes = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/state/modules/layer4TypeSetting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/state/modules/layer4TypeSetting.js')>();
  return {
    ...actual,
    stampLayer4TypeSetting: (state: any) => {
      recomputes.count += 1;
      return actual.stampLayer4TypeSetting(state);
    },
  };
});

import { canAIAssembleSpellPaymentPlan } from '../src/socket/ai.js';
import {
  buildAISpellPaymentPlan,
  cloneAISpellPaymentSimulationGame,
} from '../src/socket/ai-handlers/aiSpellPaymentPlanHelpers.js';
import { refreshAISpellPaymentSimulationDerivedEffects } from '../src/socket/ai-handlers/aiSpellPaymentSimulationDerivedEffects.js';
import { calculateManaProduction } from '../src/socket/util.js';
import { parseManaCost } from '../src/state/modules/mana-check.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  readDerivedContinuousEffects,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';

const RIKU = 'riku';

const land = (id: string, name: string, color: string) => ({
  id,
  controller: RIKU,
  owner: RIKU,
  tapped: false,
  card: { id: `${id}_card`, name, type_line: `Basic Land — ${name}`, oracle_text: `{T}: Add {${color}}.` },
});

// Oracle (oracle-cards.jsonl): "{T}, Sacrifice this token: Add one mana of any color."
const treasure = (n: number) => ({
  id: `treasure_${n}`,
  controller: RIKU,
  owner: RIKU,
  tapped: false,
  isToken: true,
  card: {
    id: `treasure_card_${n}`,
    name: 'Treasure',
    type_line: 'Token Artifact — Treasure',
    oracle_text: '{T}, Sacrifice this token: Add one mana of any color.',
  },
});

// Oracle (oracle-cards.jsonl): Creatures you control have "{T}: Add one mana of any color."
const CRYPTOLITH_RITE = {
  id: 'rite_1',
  controller: RIKU,
  owner: RIKU,
  tapped: false,
  card: {
    id: 'rite_card',
    name: 'Cryptolith Rite',
    type_line: 'Enchantment',
    mana_cost: '{1}{G}',
    oracle_text: 'Creatures you control have "{T}: Add one mana of any color."',
  },
};

// Oracle (oracle-cards.jsonl), reminder text dropped.
const EVERFLOWING_CHALICE = {
  id: 'chalice_1',
  controller: RIKU,
  owner: RIKU,
  tapped: false,
  counters: { charge: 1 },
  card: {
    id: 'chalice_card',
    name: 'Everflowing Chalice',
    type_line: 'Artifact',
    mana_cost: '{0}',
    oracle_text: 'Multikicker {2}\nThis artifact enters with a charge counter on it for each time it was kicked.\n{T}: Add {C} for each charge counter on this artifact.',
  },
};

const BEARS = {
  id: 'bears_1',
  controller: RIKU,
  owner: RIKU,
  tapped: false,
  summoningSickness: false,
  card: { id: 'bears_card', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2' },
};

function makeGame(battlefield: any[]) {
  return {
    state: {
      players: [{ id: RIKU, name: 'Riku', isAI: true }],
      battlefield,
      manaPool: { [RIKU]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
      zones: { [RIKU]: { hand: [], graveyard: [], exile: [] } },
    },
  };
}

function hasGrantedManaAbility(permanent: any, state: any): boolean {
  return getContinuousGrantedAbilitiesForPermanent(permanent, state)
    .some((ability) => ability.includes('add one mana of any color'));
}

describe('AI spell-payment simulation clone: derived continuous effects', () => {
  beforeEach(() => {
    recomputes.count = 0;
  });

  it('computes continuous effects once for a clone instead of once per mana-production read', () => {
    const game = makeGame([land('forest_1', 'Forest', 'G'), land('island_1', 'Island', 'U'), CRYPTOLITH_RITE, BEARS]);
    const clone = cloneAISpellPaymentSimulationGame(game);
    const derived = readDerivedContinuousEffects(clone.state);
    expect(derived).not.toBeNull();
    expect(recomputes.count).toBe(1);

    for (let pass = 0; pass < 10; pass += 1) {
      for (const permanent of clone.state.battlefield) {
        calculateManaProduction(clone.state, permanent, RIKU);
      }
    }
    expect(recomputes.count).toBe(1);
    expect(readDerivedContinuousEffects(clone.state)).toBe(derived);
    expect(hasGrantedManaAbility(clone.state.battlefield[3], clone.state)).toBe(true);
  });

  it('does not mark or cache anything on the live game state', () => {
    const game = makeGame([land('forest_1', 'Forest', 'G'), CRYPTOLITH_RITE, BEARS]);
    cloneAISpellPaymentSimulationGame(game);
    refreshAISpellPaymentSimulationDerivedEffects(game);
    buildAISpellPaymentPlan(game, RIKU as any, parseManaCost('{G}'));
    expect(readDerivedContinuousEffects(game.state)).toBeNull();
    expect(Object.getOwnPropertyNames(game.state)).not.toContain('_aiSpellPaymentSimulationSignature');
  });

  it('recomputes for the clone after a simulated activation changes the battlefield', () => {
    const game = makeGame([land('forest_1', 'Forest', 'G'), CRYPTOLITH_RITE, BEARS]);
    const clone = cloneAISpellPaymentSimulationGame(game);
    const bears = clone.state.battlefield.find((permanent: any) => permanent.id === 'bears_1');
    expect(hasGrantedManaAbility(bears, clone.state)).toBe(true);
    const before = readDerivedContinuousEffects(clone.state);

    // Nothing changed: the next plan build keeps the same view.
    buildAISpellPaymentPlan(clone, RIKU as any, parseManaCost('{G}'));
    expect(readDerivedContinuousEffects(clone.state)).toBe(before);

    // Simulated sacrifice of the source of the grant.
    clone.state.battlefield = clone.state.battlefield.filter((permanent: any) => permanent.id !== 'rite_1');
    buildAISpellPaymentPlan(clone, RIKU as any, parseManaCost('{G}'));
    expect(readDerivedContinuousEffects(clone.state)).not.toBe(before);
    expect(hasGrantedManaAbility(bears, clone.state)).toBe(false);
  });

  it('keeps recomputes bounded when a charge-counter mana source makes the AI simulate an unpayable cost', () => {
    // Shape of self-play shard 28: many lands, Treasures and a charge-counter mana source, plus a
    // spell the seat cannot pay for. A charge-counter source is what makes
    // canAIAssembleSpellPaymentPlan JSON-clone the game. Before the clone was primed, every
    // mana-production read on it recomputed all continuous effects (88s per scan on 38 permanents).
    const battlefield = [
      ...Array.from({ length: 6 }, (_, index) => land(`forest_${index}`, 'Forest', 'G')),
      ...Array.from({ length: 4 }, (_, index) => land(`island_${index}`, 'Island', 'U')),
      treasure(1),
      treasure(2),
      treasure(3),
      EVERFLOWING_CHALICE,
      CRYPTOLITH_RITE,
      BEARS,
    ];
    const game = makeGame(battlefield);
    // The live game always has the view from its last SBA sync; only clones lacked it.
    syncDerivedContinuousEffects(game.state);
    recomputes.count = 0;
    const payable = canAIAssembleSpellPaymentPlan(game, RIKU as any, parseManaCost('{9}{B}{B}{B}{B}{B}{B}'));
    expect(payable).toBe(false);
    // One per clone plus one per simulated activation that changed the clone.
    expect(recomputes.count).toBeLessThanOrEqual(24);
    expect(game.state.battlefield).toHaveLength(battlefield.length);
  });
});
