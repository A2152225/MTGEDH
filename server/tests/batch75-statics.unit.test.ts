import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { computeStaticMaxHandSize } from '../src/state/modules/handSizeStaticModifiers.js';
import { canAttackDespiteDefender } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { calculatePowerOnlyCDA } from '../src/state/utils-handlers/variablePowerOnlyCalculator.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch75 statics', () => {
  it('March of the Machines animates noncreature artifacts to MV P/T', () => {
    const line = 'Each noncreature artifact is an artifact creature with power and toughness each equal to its mana value.';
    const march = P('March of the Machines', line, 'Enchantment');
    const specs = parseStaticEffectSpecsFromOraclePermanent(march);
    expect(specs.some((s) => Array.isArray(s.grant.typeAdditions) && s.grant.typeAdditions!.includes('Creature'))).toBe(true);
    expect(specs.some((s) => (s.grant as any).setPowerToughnessFromManaValue === true)).toBe(true);
    const sol = {
      id: 'sol', controller: 'p1',
      card: { name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, mana_value: 1 },
    };
    const state: any = { battlefield: [march, sol], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(sol as any, state)?.power).toBe(1);
    expect(classifyStaticCensusLine(line, 'March of the Machines')?.system).toMatch(/march|noncreature|batch75|mv/i);
  });

  it('Seven Dwarves other named-creature anthem', () => {
    const line = 'This creature gets +1/+1 for each other creature named Seven Dwarves you control.';
    const d1 = P('Seven Dwarves', line, 'Creature — Dwarf', { id: 'd1' }, { power: '2', toughness: '2' });
    const d2 = { ...P('Seven Dwarves', line, 'Creature — Dwarf', { id: 'd2' }, { power: '2', toughness: '2' }), id: 'd2' };
    const d3 = { ...P('Seven Dwarves', line, 'Creature — Dwarf', { id: 'd3' }, { power: '2', toughness: '2' }), id: 'd3' };
    expect(parseStaticEffectSpecsFromOraclePermanent(d1).some(
      (s) => (s.grant as any).countBasis === 'creatures_named'
        && (s.grant as any).countExcludeSource === true,
    )).toBe(true);
    const state: any = { battlefield: [d1, d2, d3], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(d1 as any, state)?.power).toBe(4);
    expect(classifyStaticCensusLine(line, 'Seven Dwarves')?.system).toMatch(/named|batch75/i);
  });

  it('Shield of Kaldra named equipment indestructible', () => {
    const line = 'Equipment named Sword of Kaldra, Shield of Kaldra, and Helm of Kaldra have indestructible.';
    const shield = P('Shield of Kaldra', `${line}\nEquipped creature has indestructible.\nEquip {4}`, 'Legendary Artifact — Equipment');
    expect(parseStaticEffectSpecsFromOraclePermanent(shield).filter(
      (s) => (s.grant.abilities || []).includes('indestructible') && s.condition?.kind === 'target_has_name',
    ).length).toBe(3);
    const sword = {
      id: 'sword', controller: 'p1',
      card: { name: 'Sword of Kaldra', type_line: 'Legendary Artifact — Equipment' },
    };
    const state: any = { battlefield: [shield, sword], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(sword as any, state)).toContain('indestructible');
    expect(classifyStaticCensusLine(line, 'Shield of Kaldra')?.system).toMatch(/equipment|indestructible|batch75/i);
  });

  it('Soul Swindler visited Attraction indestructible', () => {
    const line = "As long as you've visited an Attraction this turn, this creature has indestructible.";
    const soul = P('Soul Swindler', line, 'Creature — Demon Employee', {}, { power: '5', toughness: '3' });
    expect(parseStaticEffectSpecsFromOraclePermanent(soul).some(
      (s) => s.condition?.kind === 'source_controller_visited_attraction_this_turn'
        && (s.grant.abilities || []).includes('indestructible'),
    )).toBe(true);
    const state: any = {
      battlefield: [soul],
      players: [{ id: 'p1' }],
      attractionsVisitedThisTurnByController: { p1: 1 },
    };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(soul as any, state)).toContain('indestructible');
    expect(classifyStaticCensusLine(line, 'Soul Swindler')?.system).toMatch(/attraction|batch75/i);
  });

  it('Coram greatest graveyard power pump', () => {
    const line = 'Coram gets +X/+0, where X is the greatest power among creature cards in all graveyards.';
    const coram = P('Coram, the Undertaker', line, 'Legendary Creature — Human Warrior', {}, { power: '0', toughness: '5' });
    expect(parseStaticEffectSpecsFromOraclePermanent(coram).some(
      (s) => (s.grant as any).countBasis === 'greatest_power_among_creature_cards_in_all_graveyards',
    )).toBe(true);
    const state: any = {
      battlefield: [coram],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: {
        p1: { graveyard: [{ name: 'Bear', type_line: 'Creature — Bear', power: '2' }] },
        p2: { graveyard: [{ name: 'Giant', type_line: 'Creature — Giant', power: '5' }] },
      },
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(coram as any, state)?.power).toBe(5);
    expect(classifyStaticCensusLine(line, 'Coram, the Undertaker')?.system).toMatch(/greatest|graveyard|batch75/i);
  });

  it('Nyx Infusion attached otherwise + Avalanche CDA + Cursed Rack + Pillar + Technodrome', () => {
    const nyxLine = "Enchanted creature gets +2/+2 as long as it's an enchantment. Otherwise, it gets -2/-2.";
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const nyx = P('Nyx Infusion', nyxLine, 'Enchantment — Aura', { attachedTo: 'host', id: 'nyx' });
    const nyxSpecs = parseStaticEffectSpecsFromOraclePermanent(nyx);
    expect(nyxSpecs.some((s) => s.condition?.kind === 'target_has_type' && (s.condition as any).cardType === 'enchantment')).toBe(true);
    expect(nyxSpecs.some((s) => s.conditionNegated === true)).toBe(true);
    const nyxState: any = { battlefield: [nyx, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(nyxState);
    expect(getCurrentPowerToughness(host as any, nyxState)?.power).toBe(0);

    const avalancheOracle = "Avalanche of Sector 7's power is equal to the number of artifacts your opponents control.";
    const pt = calculatePowerOnlyCDA(
      { name: 'Avalanche of Sector 7', power: '*', toughness: '3' },
      avalancheOracle.toLowerCase(),
      [
        { controller: 'p2', card: { type_line: 'Artifact' } },
        { controller: 'p2', card: { type_line: 'Artifact Creature — Construct' } },
        { controller: 'p1', card: { type_line: 'Artifact' } },
      ],
      {},
      'p1',
    );
    expect(pt?.power).toBe(2);
    expect(classifyStaticCensusLine(
      "~'s power is equal to the number of artifacts your opponents control.",
      'Avalanche of Sector 7',
    )?.system).toMatch(/opponents|CDA|variablePower|batch75/i);

    const rack = P('Cursed Rack', "As this artifact enters, choose an opponent.\nThe chosen player's maximum hand size is four.", 'Artifact', {
      chosenPlayer: 'p2',
    });
    expect(computeStaticMaxHandSize([rack], 'p2')).toBe(4);
    expect(computeStaticMaxHandSize([rack], 'p1')).toBe(7);
    expect(classifyStaticCensusLine("The chosen player's maximum hand size is four.", 'Cursed Rack')?.system)
      .toMatch(/hand size|chosen|batch75/i);

    const pillar = P(
      'Pillar of War',
      "Defender\nAs long as this creature is enchanted, it can attack as though it didn't have defender.",
      'Artifact Creature — Golem',
      { id: 'pillar' },
      { power: '3', toughness: '3', keywords: ['defender'] },
    );
    const aura = {
      id: 'aura', controller: 'p1', attachedTo: 'pillar',
      card: { name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
    };
    expect(canAttackDespiteDefender(pillar, [pillar, aura], 'p1')).toBe(true);
    expect(canAttackDespiteDefender(pillar, [pillar], 'p1')).toBe(false);
    expect(classifyStaticCensusLine(
      "As long as this creature is enchanted, it can attack as though it didn't have defender.",
      'Pillar of War',
    )?.system).toMatch(/enchanted|defender|batch75/i);

    const technoLine = "This creature can't attack or block unless its power is 6 or greater.";
    const techno = P('Technodrome', technoLine, 'Artifact Creature — Construct', {}, { power: '2', toughness: '2' });
    expect(parseStaticEffectSpecsFromOraclePermanent(techno).some(
      (s) => s.condition?.kind === 'target_power_at_least'
        && s.conditionNegated === true
        && (s.grant.abilities || []).includes("can't attack"),
    )).toBe(true);
    expect(classifyStaticCensusLine(technoLine, 'Technodrome')?.system).toMatch(/power|combat|batch75/i);
  });
});
