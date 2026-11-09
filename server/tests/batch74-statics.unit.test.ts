import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch74 statics', () => {
  it('Song of Serenity enchanted can\'t attack or block', () => {
    const line = "Creatures that are enchanted can't attack or block.";
    const song = P('Song of Serenity', line, 'Enchantment');
    expect(parseStaticEffectSpecsFromOraclePermanent(song).some(
      (s) => s.condition?.kind === 'target_is_enchanted'
        && (s.grant.abilities || []).includes("can't attack"),
    )).toBe(true);
    const host = {
      id: 'h', controller: 'p2',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const aura = {
      id: 'a', controller: 'p1', attachedTo: 'h',
      card: { name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
    };
    const state: any = { battlefield: [song, host, aura], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, state)).toEqual(
      expect.arrayContaining(["can't attack", "can't block"]),
    );
    expect(classifyStaticCensusLine(line, 'Song of Serenity')?.system).toMatch(/enchanted|batch74/i);
  });

  it('Nut Collector threshold squirrels', () => {
    const line = 'Threshold — All Squirrels get +2/+2 as long as there are seven or more cards in your graveyard.';
    const nut = P('Nut Collector', line, 'Creature — Human Druid');
    expect(parseStaticEffectSpecsFromOraclePermanent(nut).some(
      (s) => s.condition?.kind === 'source_controller_has_threshold'
        && s.scope.kind === 'all_creatures_of_type'
        && (s.scope as any).creatureType === 'squirrel',
    )).toBe(true);
    const squirrel = {
      id: 'sq', controller: 'p2',
      card: { name: 'Squirrel Token', type_line: 'Creature — Squirrel', power: '1', toughness: '1' },
    };
    const gy = Array.from({ length: 7 }, (_, i) => ({ name: `Card${i}`, type_line: 'Instant' }));
    const state: any = {
      battlefield: [nut, squirrel],
      zones: { p1: { graveyard: gy } },
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(squirrel as any, state)?.power).toBe(3);
  });

  it('Light from Within chroma mana symbols', () => {
    const line = 'Chroma — Each creature you control gets +1/+1 for each white mana symbol in its mana cost.';
    const light = P('Light from Within', line, 'Enchantment');
    expect(parseStaticEffectSpecsFromOraclePermanent(light).some(
      (s) => (s.grant as any).countBasis === 'recipient_mana_symbols'
        && (s.grant as any).countColor === 'white',
    )).toBe(true);
    const knight = {
      id: 'k', controller: 'p1',
      card: {
        name: 'White Knight', type_line: 'Creature — Human Knight',
        mana_cost: '{W}{W}', power: '2', toughness: '2', colors: ['W'],
      },
    };
    const state: any = { battlefield: [light, knight], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(knight as any, state)?.power).toBe(4);
    expect(classifyStaticCensusLine(line, 'Light from Within')?.system).toMatch(/chroma|mana.symbol|batch74/i);
  });

  it('Eidolon self and enchanted dual count', () => {
    const line = 'This creature and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control.';
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Soldier', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
    };
    const eidolon = P('Eidolon of Countless Battles', line, 'Enchantment Creature — Spirit', {
      attachedTo: 'host',
    }, { power: '0', toughness: '0' });
    const aura = {
      id: 'aura', controller: 'p1', attachedTo: 'host',
      card: { name: 'Holy Strength', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(eidolon);
    expect(specs.filter((s) => (s.grant as any).countCardType === 'creature').length).toBeGreaterThanOrEqual(2);
    expect(specs.filter((s) => (s.grant as any).countCardType === 'aura').length).toBeGreaterThanOrEqual(2);
    const state: any = { battlefield: [eidolon, host, aura], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    // host: +1 from creature count (eidolon is creature type? Enchantment Creature while not bestowed - but attached so maybe still creature)
    // Count creatures: eidolon (if still creature) + host. Aura count: eidolon? no + holy strength = 1+
    expect(getCurrentPowerToughness(host as any, state)?.power).toBeGreaterThanOrEqual(3);
  });

  it('Twins of Discord other colorless bloodthirst', () => {
    const line = 'Each other colorless creature you control has bloodthirst 2.';
    const twins = P('Twins of Discord', line, 'Creature — Eldrazi', {}, { colors: [] });
    const other = {
      id: 'o', controller: 'p1',
      card: { name: 'Eldrazi Scion', type_line: 'Creature — Eldrazi', colors: [], power: '1', toughness: '1' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(twins).some(
      (s) => (s.grant.abilities || []).includes('bloodthirst 2') && s.condition?.kind === 'target_is_colorless',
    )).toBe(true);
    const state: any = { battlefield: [twins, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(other as any, state)).toContain('bloodthirst 2');
  });

  it('Awakened Skyclave also land + Daxos block evasion', () => {
    const landLine = "As long as this permanent is on the battlefield, it's a land in addition to its other types.";
    const skyclave = P('Awakened Skyclave', landLine, 'Creature — Elemental');
    expect(parseStaticEffectSpecsFromOraclePermanent(skyclave).some(
      (s) => Array.isArray(s.grant.typeAdditions) && s.grant.typeAdditions!.includes('Land'),
    )).toBe(true);

    const daxosLine = "Daxos can't be blocked by creatures with power 3 or greater.";
    const daxos = P('Daxos of Meletis', daxosLine, 'Legendary Creature — Human Soldier');
    expect(parseStaticEffectSpecsFromOraclePermanent(daxos).some(
      (s) => (s.grant.abilities || []).some((a) => /can't be blocked by creatures with power 3/.test(String(a))),
    )).toBe(true);
    expect(classifyStaticCensusLine(daxosLine, 'Daxos of Meletis')?.system).toMatch(/block|evasion|batch74|power/i);
  });

  it('classifiers for graveyard grants / Seeker / Phyrexian Censor', () => {
    expect(classifyStaticCensusLine(
      'Each creature card in your graveyard has unearth {2}{B}.',
      'Sedris, the Traitor King',
    )?.system).toMatch(/unearth|graveyard/i);
    expect(classifyStaticCensusLine(
      'Merfolk and Druid cards in your graveyard have retrace.',
      'Deeproot Historian',
    )?.system).toMatch(/retrace|graveyard/i);
    expect(classifyStaticCensusLine(
      "Each instant and sorcery card in your graveyard that's exactly two colors has jump-start.",
      'Niv-Mizzet, Supreme',
    )?.system).toMatch(/jump-start|graveyard/i);
    expect(classifyStaticCensusLine(
      'Each opponent must attack with at least one creature each combat if able.',
      'Seeker of Slaanesh',
    )?.system).toMatch(/attack|opponent/i);
    expect(classifyStaticCensusLine(
      "Each player can't cast more than one non-Phyrexian spell each turn.",
      'Phyrexian Censor',
    )?.system).toMatch(/phyrexian|cast/i);

    const censor = P('Phyrexian Censor', "Each player can't cast more than one non-Phyrexian spell each turn.\nNon-Phyrexian creatures enter tapped.", 'Creature — Phyrexian Wizard');
    const state: any = {
      battlefield: [censor],
      players: [{ id: 'p1' }],
      spellsCastThisTurn: [{ casterId: 'p1', type_line: 'Instant' }],
    };
    expect(findOracleCastingLimitViolation(state, 'p1', { type_line: 'Sorcery' })?.prohibited).toBe(true);
    expect(findOracleCastingLimitViolation(state, 'p1', { type_line: 'Creature — Phyrexian Horror' })?.prohibited).toBe(false);
  });
});
