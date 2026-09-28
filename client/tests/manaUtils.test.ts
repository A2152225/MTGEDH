import { describe, expect, it } from 'vitest';

import {
  applyXValueToParsedCost,
  buildRestrictedManaPurposeForSpell,
  calculateRemainingCostAfterFloatingMana,
  calculateSuggestedPayment,
  canUseRestrictedManaClient,
  manaSourceAllowsSpendPurpose,
  parseManaCost,
  parseManaSpendRestrictionFromOracleText,
  sourcePrefersUncounterableChosenTypeCast,
  typeLineIndicatesArtifactSpell,
  paymentToPool,
} from '../src/utils/manaUtils';
import { buildSuggestedPaymentItems } from '../src/utils/manaSourceBuilder';;

describe('calculateSuggestedPayment', () => {
  it('counts exact produced color bundles in selected payment pools', () => {
    expect(paymentToPool([
      {
        permanentId: 'signet_1',
        mana: 'B',
        count: 2,
        producedColors: ['B', 'R'],
      },
    ])).toEqual({
      W: 0,
      U: 0,
      B: 1,
      R: 1,
      G: 0,
      C: 0,
    });
  });

  it('uses boosted source amounts to assign exact payment counts', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [
        { id: 'forest_1', name: 'Forest', options: ['G'], amount: 2 },
        { id: 'forest_2', name: 'Forest', options: ['G'], amount: 2 },
      ],
      new Set(),
    );

    expect(suggestion.size).toBe(2);
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 2 });
    expect(suggestion.get('forest_2')).toEqual({ color: 'G', count: 1 });
  });

  it('prefers reusable sources over consumable mana sources when both can pay the same color', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [
        { id: 'petal_1', name: 'Lotus Petal', options: ['R'], consumable: true },
        { id: 'mountain_1', name: 'Mountain', options: ['R'] },
      ],
      new Set(),
    );

    expect(suggestion.size).toBe(1);
    expect(suggestion.get('mountain_1')).toEqual({ color: 'R', count: 1 });
    expect(suggestion.has('petal_1')).toBe(false);
  });

  it('falls back to consumable sources when reusable mana is not enough', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [
        { id: 'forest_1', name: 'Forest', options: ['G'] },
        { id: 'treasure_1', name: 'Treasure', options: ['W', 'U', 'B', 'R', 'G'], consumable: true },
      ],
      new Set(),
    );

    expect(suggestion.size).toBe(2);
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });
    expect(suggestion.get('treasure_1')).toEqual({ color: 'W', count: 1 });
  });

  it('uses Fertile Ground bonus mana as a different color from the enchanted land', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [
        {
          id: 'forest_fg',
          name: 'Forest',
          options: ['G'],
          manaBonuses: [{ options: ['W', 'U', 'B', 'R', 'G'], amount: 1 }],
        },
      ],
      new Set(),
    );

    expect(suggestion.get('forest_fg')?.count).toBe(2);
    expect(suggestion.get('forest_fg')?.producedColors?.slice().sort()).toEqual(['G', 'U']);
  });

  it('prefers a native Island over Fertile Ground bonus when paying blue', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [
        {
          id: 'forest_fg',
          name: 'Forest',
          options: ['G'],
          manaBonuses: [{ options: ['W', 'U', 'B', 'R', 'G'], amount: 1 }],
        },
        { id: 'island_1', name: 'Island', options: ['U'] },
      ],
      new Set(),
    );

    expect(suggestion.get('island_1')).toEqual({ color: 'U', count: 1 });
    expect(suggestion.has('forest_fg')).toBe(false);
  });
});

describe('applyXValueToParsedCost', () => {
  it('does not double-count X when the mana cost is already expanded', () => {
    const cost = applyXValueToParsedCost(parseManaCost('{10}{W}{W}'), 10);
    expect(cost.generic).toBe(10);
    expect(cost.colors.W).toBe(2);
  });

  it('expands unexpanded {X} by xCount', () => {
    expect(applyXValueToParsedCost(parseManaCost('{X}{W}{W}'), 10).generic).toBe(10);
    expect(applyXValueToParsedCost(parseManaCost('{X}{X}{G}'), 7).generic).toBe(14);
  });
});

describe('calculateSuggestedPayment colored-before-generic', () => {
  it('reserves white sources for {W}{W} before spending them on X/generic', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 10,
        hybrids: [],
      },
      [
        { id: 'plains_1', name: 'Plains', options: ['W'] },
        { id: 'plains_2', name: 'Plains', options: ['W'] },
        { id: 'plains_3', name: 'Plains', options: ['W'] },
        { id: 'plains_4', name: 'Plains', options: ['W'] },
        { id: 'forest_1', name: 'Forest', options: ['G'] },
        { id: 'forest_2', name: 'Forest', options: ['G'] },
        { id: 'forest_3', name: 'Forest', options: ['G'] },
        { id: 'forest_4', name: 'Forest', options: ['G'] },
        { id: 'forest_5', name: 'Forest', options: ['G'] },
        { id: 'wastes_1', name: 'Wastes', options: ['C'] },
        { id: 'wastes_2', name: 'Wastes', options: ['C'] },
        { id: 'wastes_3', name: 'Wastes', options: ['C'] },
      ],
      new Set(),
    );

    const whiteAssignments = [...suggestion.entries()].filter(([, sel]) => sel.color === 'W');
    expect(whiteAssignments.length).toBeGreaterThanOrEqual(2);
    expect(whiteAssignments.slice(0, 2).every(([, sel]) => sel.count >= 1)).toBe(true);

    const pool = paymentToPool(
      [...suggestion.entries()].map(([id, sel]) => ({ permanentId: id, mana: sel.color, count: sel.count })),
    );
    expect(pool.W).toBeGreaterThanOrEqual(2);
    expect(pool.W + pool.U + pool.B + pool.R + pool.G + pool.C).toBeGreaterThanOrEqual(12);
  });
});

describe('restricted mana sources (Vibranium / Powerstone)', () => {
  const vibraniumOracle =
    "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell.";

  it('parses Vibranium nonartifact spend restriction from oracle text', () => {
    expect(parseManaSpendRestrictionFromOracleText(vibraniumOracle)).toEqual({
      restriction: 'no_nonartifact_spells',
    });
  });

  it('does not auto-assign Vibranium for generic mana on Generous Gift', () => {
    const purpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Instant',
    });
    const vibraniumSource = {
      id: 'vib_1',
      sourcePermanentId: 'vib_1',
      name: 'Vibranium',
      options: ['C'] as const,
      spendRestriction: { restriction: 'no_nonartifact_spells' },
    };
    expect(manaSourceAllowsSpendPurpose(vibraniumSource, purpose)).toBe(false);

    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 2,
        hybrids: [],
      },
      [
        vibraniumSource as any,
        { id: 'plains_1', name: 'Plains', options: ['W'] },
        { id: 'plains_2', name: 'Plains', options: ['W'] },
        { id: 'plains_3', name: 'Plains', options: ['W'] },
      ],
      new Set(),
      undefined,
      purpose,
    );

    expect(suggestion.has('vib_1')).toBe(false);
    expect(suggestion.size).toBe(3);
    expect(suggestion.get('plains_1')).toEqual({ color: 'W', count: 1 });
  });

  it('still allows Vibranium for artifact spells and activated abilities', () => {
    const artifactPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Artifact Creature - Construct',
    });
    const abilityPurpose = { isActivatedAbility: true, isAbility: true };
    const vibraniumSource = {
      id: 'vib_1',
      name: 'Vibranium',
      options: ['C'] as const,
      spendRestriction: { restriction: 'no_nonartifact_spells' },
    };

    expect(manaSourceAllowsSpendPurpose(vibraniumSource, artifactPurpose)).toBe(true);
    expect(manaSourceAllowsSpendPurpose(vibraniumSource, abilityPurpose)).toBe(true);

    const artifactSuggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [vibraniumSource as any],
      new Set(),
      undefined,
      artifactPurpose,
    );
    expect(artifactSuggestion.get('vib_1')).toEqual({ color: 'C', count: 1 });

    const abilitySuggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [vibraniumSource as any],
      new Set(),
      undefined,
      abilityPurpose,
    );
    expect(abilitySuggestion.get('vib_1')).toEqual({ color: 'C', count: 1 });
  });

  
  it('prefers Vibranium over unrestricted colorless for an artifact generic cost', () => {
    const purpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Artifact',
      mana_cost: '{1}',
    });
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [
        {
          id: 'wastes_1',
          name: 'Wastes',
          options: ['C'] as const,
        } as any,
        {
          id: 'vib_1',
          name: 'Vibranium',
          options: ['C'] as const,
          spendRestriction: { restriction: 'no_nonartifact_spells' },
        } as any,
      ],
      new Set(),
      undefined,
      purpose,
    );

    expect(suggestion.has('vib_1')).toBe(true);
    expect(suggestion.has('wastes_1')).toBe(false);
  });

  it('prefers restricted floating mana before regular floating mana for an artifact', () => {
    const purpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Artifact',
      mana_cost: '{1}',
    });
    const items = buildSuggestedPaymentItems(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [],
      new Set(),
      {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2,
        restricted: [{
          type: 'colorless',
          amount: 1,
          restriction: 'no_nonartifact_spells',
        }],
      },
      { includeExplicitPoolItems: true, purpose },
    );
    expect(items.some((item) => String(item.permanentId).startsWith('__pool__:restricted:'))).toBe(true);
    expect(items.some((item) => String(item.permanentId) === '__pool__:colorless')).toBe(false);
  });

it('falls back to unrestricted mana when Vibranium cannot pay a nonartifact spell', () => {
    const purpose = buildRestrictedManaPurposeForSpell({ type_line: 'Instant' });
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [
        {
          id: 'vib_1',
          name: 'Vibranium',
          options: ['C'] as const,
          spendRestriction: { restriction: 'no_nonartifact_spells' },
        } as any,
        { id: 'wastes_1', name: 'Wastes', options: ['C'] as const },
      ],
      new Set(),
      undefined,
      purpose,
    );

    expect(suggestion.has('vib_1')).toBe(false);
    expect(suggestion.get('wastes_1')).toEqual({ color: 'C', count: 1 });
  });

  it('allows Vibranium for Artifact Vehicle / Equipment (not only Artifact Creature)', () => {
    expect(typeLineIndicatesArtifactSpell('Artifact - Vehicle')).toBe(true);
    expect(typeLineIndicatesArtifactSpell('Artifact - Equipment')).toBe(true);
    expect(typeLineIndicatesArtifactSpell('Instant')).toBe(false);

    const vehiclePurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Artifact - Vehicle',
    });
    const equipmentPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Artifact - Equipment',
    });
    const instantPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Instant',
    });
    expect(vehiclePurpose.isArtifact).toBe(true);
    expect(equipmentPurpose.isArtifact).toBe(true);
    expect(instantPurpose.isArtifact).toBeUndefined();
    expect(instantPurpose.isInstantOrSorcery).toBe(true);

    const vibraniumSource = {
      id: 'vib_1',
      name: 'Vibranium',
      options: ['C'] as const,
      spendRestriction: { restriction: 'no_nonartifact_spells' },
    };

    expect(manaSourceAllowsSpendPurpose(vibraniumSource, vehiclePurpose)).toBe(true);
    expect(manaSourceAllowsSpendPurpose(vibraniumSource, equipmentPurpose)).toBe(true);
    expect(manaSourceAllowsSpendPurpose(vibraniumSource, instantPurpose)).toBe(false);

    const vehicleSuggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [vibraniumSource as any],
      new Set(),
      undefined,
      vehiclePurpose,
    );
    expect(vehicleSuggestion.get('vib_1')).toEqual({ color: 'C', count: 1 });
  });

  it('allows Secluded Courtyard restricted mana for matching creature spells and commanders', () => {
    const dinosaurPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Legendary Creature — Dinosaur',
      name: 'Pantlaza, Sun-Favored',
    }, { isCommander: true });
    const handDinosaurPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Creature — Dinosaur',
      name: 'Hunting Velociraptor',
    });
    const enchantmentPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Enchantment',
      name: 'Propaganda',
    });
    const courtyardEntry = {
      type: 'green' as const,
      amount: 1,
      restriction: 'chosen_type_creature_source',
      restrictedTo: 'dinosaur',
    };
    const courtyardSource = {
      id: 'courtyard_1',
      name: 'Secluded Courtyard',
      options: ['G'] as const,
      spendRestriction: { restriction: 'chosen_type_creature_source', restrictedTo: 'dinosaur' },
    };

    expect(canUseRestrictedManaClient(courtyardEntry, dinosaurPurpose)).toBe(true);
    expect(canUseRestrictedManaClient(courtyardEntry, handDinosaurPurpose)).toBe(true);
    expect(canUseRestrictedManaClient(courtyardEntry, enchantmentPurpose)).toBe(false);
    expect(manaSourceAllowsSpendPurpose(courtyardSource, dinosaurPurpose)).toBe(true);
    expect(manaSourceAllowsSpendPurpose(courtyardSource, enchantmentPurpose)).toBe(false);

    const remaining = calculateRemainingCostAfterFloatingMana(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 2,
        hybrids: [],
      },
      {
        white: 0,
        blue: 0,
        black: 0,
        red: 1,
        green: 1,
        colorless: 0,
        restricted: [courtyardEntry],
      },
      handDinosaurPurpose,
    );
    expect(remaining.generic).toBe(0);
    expect(remaining.colors.G).toBe(0);
    expect(remaining.usedFromPool.green).toBe(2);
    expect(remaining.usedFromPool.red).toBe(1);
  });
});

describe('uncounterable chosen-type mana auto-pay', () => {
  const cavernAnyColor = {
    id: 'cavern_1::native_any',
    sourcePermanentId: 'cavern_1',
    abilityId: 'native_any',
    name: 'Cavern of Souls',
    options: ['W', 'U', 'B', 'R', 'G'] as const,
    spendRestriction: { restriction: 'chosen_type_creature_spell', restrictedTo: 'elf' },
    grantsUncounterableOnSpend: true,
  };
  const cavernColorless = {
    id: 'cavern_1::native_c',
    sourcePermanentId: 'cavern_1',
    abilityId: 'native_c',
    name: 'Cavern of Souls',
    options: ['C'] as const,
  };
  const forest = { id: 'forest_1', sourcePermanentId: 'forest_1', name: 'Forest', options: ['G'] as const };
  const unclaimedAnyColor = {
    id: 'ut_1::native_any',
    sourcePermanentId: 'ut_1',
    abilityId: 'native_any',
    name: 'Unclaimed Territory',
    options: ['W', 'U', 'B', 'R', 'G'] as const,
    spendRestriction: { restriction: 'chosen_type_creature_spell', restrictedTo: 'elf' },
  };
  const elfPurpose = buildRestrictedManaPurposeForSpell({
    name: 'Llanowar Elves',
    type_line: 'Creature — Elf Druid',
    mana_cost: '{G}',
  });
  const goblinPurpose = buildRestrictedManaPurposeForSpell({
    name: 'Goblin Guide',
    type_line: 'Creature — Goblin Scout',
    mana_cost: '{R}',
  });
  const instantPurpose = buildRestrictedManaPurposeForSpell({
    name: 'Giant Growth',
    type_line: 'Instant',
    mana_cost: '{G}',
  });
  const changelingPurpose = buildRestrictedManaPurposeForSpell({
    name: 'Chameleon Colossus',
    type_line: 'Creature — Shapeshifter',
    oracle_text: 'Changeling (This card is every creature type.)',
    mana_cost: '{2}{G}{G}',
  });

  it('prefers matching Cavern any-color over a Forest for a colored pip', () => {
    expect(sourcePrefersUncounterableChosenTypeCast(cavernAnyColor, elfPurpose)).toBe(true);
    expect(manaSourceAllowsSpendPurpose(cavernAnyColor, elfPurpose)).toBe(true);

    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, cavernColorless as any, cavernAnyColor as any],
      new Set(),
      undefined,
      elfPurpose,
    );

    expect(suggestion.has('cavern_1::native_any')).toBe(true);
    expect(suggestion.get('cavern_1::native_any')).toEqual({ color: 'G', count: 1 });
    expect(suggestion.has('forest_1')).toBe(false);
    expect(suggestion.has('cavern_1::native_c')).toBe(false);
  });

  it('uses Cavern any-color for the colored pip before Forest generic on {1}{G}', () => {
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [forest as any, cavernColorless as any, cavernAnyColor as any],
      new Set(),
      undefined,
      elfPurpose,
    );

    expect(suggestion.get('cavern_1::native_any')).toEqual({ color: 'G', count: 1 });
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });
    expect(suggestion.has('cavern_1::native_c')).toBe(false);
  });

  it('prefers matching Cavern any-color over {C} and Forest for generic', () => {
    const wastes = { id: 'wastes_1', sourcePermanentId: 'wastes_1', name: 'Wastes', options: ['C'] as const };
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        generic: 1,
        hybrids: [],
      },
      [wastes as any, forest as any, cavernColorless as any, cavernAnyColor as any],
      new Set(),
      undefined,
      elfPurpose,
    );

    expect(suggestion.has('cavern_1::native_any')).toBe(true);
    expect(suggestion.has('cavern_1::native_c')).toBe(false);
    expect(suggestion.has('wastes_1')).toBe(false);
    expect(suggestion.has('forest_1')).toBe(false);
  });

  it('does not spend matching Cavern any-color on a different creature type', () => {
    expect(manaSourceAllowsSpendPurpose(cavernAnyColor, goblinPurpose)).toBe(false);
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, cavernAnyColor as any, cavernColorless as any],
      new Set(),
      undefined,
      goblinPurpose,
    );
    expect(suggestion.has('cavern_1::native_any')).toBe(false);
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });
  });

  it('does not spend Cavern any-color on a non-creature spell', () => {
    expect(manaSourceAllowsSpendPurpose(cavernAnyColor, instantPurpose)).toBe(false);
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, cavernAnyColor as any],
      new Set(),
      undefined,
      instantPurpose,
    );
    expect(suggestion.has('cavern_1::native_any')).toBe(false);
    expect(suggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });
  });

  it('prefers Unclaimed Territory any-color over a Forest for a matching creature spell', () => {
    // Updated: any legally usable restricted source is preferred so flexible mana is kept.
    expect(sourcePrefersUncounterableChosenTypeCast(unclaimedAnyColor, elfPurpose)).toBe(false);
    expect(manaSourceAllowsSpendPurpose(unclaimedAnyColor, elfPurpose)).toBe(true);
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, unclaimedAnyColor as any],
      new Set(),
      undefined,
      elfPurpose,
    );
    expect(suggestion.get('ut_1::native_any')).toEqual({ color: 'G', count: 1 });
    expect(suggestion.has('forest_1')).toBe(false);
  });

  it('does not use Unclaimed Territory for a nonmatching creature or a noncreature spell', () => {
    const goblinSuggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, unclaimedAnyColor as any],
      new Set(),
      undefined,
      goblinPurpose,
    );
    expect(goblinSuggestion.has('ut_1::native_any')).toBe(false);
    expect(goblinSuggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });

    const instantPurpose = buildRestrictedManaPurposeForSpell({
      type_line: 'Instant',
      mana_cost: '{G}',
    });
    const instantSuggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, unclaimedAnyColor as any],
      new Set(),
      undefined,
      instantPurpose,
    );
    expect(instantSuggestion.has('ut_1::native_any')).toBe(false);
    expect(instantSuggestion.get('forest_1')).toEqual({ color: 'G', count: 1 });
  });

  it('treats changeling as matching the chosen creature type', () => {
    expect(manaSourceAllowsSpendPurpose(cavernAnyColor, changelingPurpose)).toBe(true);
    expect(sourcePrefersUncounterableChosenTypeCast(cavernAnyColor, changelingPurpose)).toBe(true);
    const suggestion = calculateSuggestedPayment(
      {
        colors: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        generic: 0,
        hybrids: [],
      },
      [forest as any, cavernAnyColor as any],
      new Set(),
      undefined,
      changelingPurpose,
    );
    expect(suggestion.get('cavern_1::native_any')).toEqual({ color: 'G', count: 1 });
  });
});
