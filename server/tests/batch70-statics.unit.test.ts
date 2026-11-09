import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
  collectSetBasePTEntriesFromStaticSpecs,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch70 statics', () => {
  it('Gargantuan Slabhorn other transformed keyword lord', () => {
    const line = 'Other transformed permanents you control have trample and ward {2}.';
    const slab = P('Gargantuan Slabhorn', line, 'Creature — Beast');
    expect(parseStaticEffectSpecsFromOraclePermanent(slab).some(
      (s) => s.scope.kind === 'other_permanents_you_control'
        && (s.scope as any).qualifier?.transformed === true
        && (s.grant.abilities || []).includes('trample'),
    )).toBe(true);

    const other = {
      id: 'dfc', controller: 'p1', transformed: true,
      card: { name: 'Other DFC', type_line: 'Creature — Beast', oracle_text: '', power: '2', toughness: '2' },
    };
    const state: any = { battlefield: [slab, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(other as any, state)).toContain('trample');
    expect(classifyStaticCensusLine(line, 'Gargantuan Slabhorn')?.system).toMatch(/transformed|batch70/i);
  });

  it('Koll enchanted or equipped token anthem', () => {
    const line = 'Creature tokens you control that are enchanted or equipped get +1/+1.';
    const koll = P('Koll, the Forgemaster', line, 'Legendary Creature — Dwarf Warrior');
    expect(parseStaticEffectSpecsFromOraclePermanent(koll).some(
      (s) => (s.scope as any).qualifier?.token === true
        && Array.isArray(s.conditions)
        && s.conditions!.some((c) => c.kind === 'target_is_enchanted_or_equipped')
        && s.grant.power === 1,
    )).toBe(true);

    const token = {
      id: 'tok', controller: 'p1', isToken: true,
      card: { name: 'Soldier', type_line: 'Creature — Soldier', oracle_text: '', power: '1', toughness: '1', isToken: true },
    };
    const aura = {
      id: 'aura', controller: 'p1', attachedTo: 'tok',
      card: { name: 'Holy Strength', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature' },
    };
    const state: any = { battlefield: [koll, token, aura], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(token as any, state)?.power).toBe(2);
    expect(classifyStaticCensusLine(line, 'Koll, the Forgemaster')?.system).toMatch(/enchanted|equipped|batch70|token/i);
  });

  it('Animate Artifact host becomes MV creature', () => {
    const line = "As long as enchanted artifact isn't a creature, it's an artifact creature with power and toughness each equal to its mana value.";
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', cmc: 1 },
    };
    const aura = P('Animate Artifact', `Enchant artifact\n${line}`, 'Enchantment — Aura', { attachedTo: 'host' });
    expect(parseStaticEffectSpecsFromOraclePermanent(aura).some(
      (s) => (s.grant as any).setPowerToughnessFromManaValue === true,
    )).toBe(true);
    expect(parseStaticEffectSpecsFromOraclePermanent(aura).some(
      (s) => Array.isArray(s.grant.typeAdditions) && s.grant.typeAdditions!.includes('Creature'),
    )).toBe(true);

    const state: any = { battlefield: [aura, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    const base = collectSetBasePTEntriesFromStaticSpecs(host as any, state);
    expect(base.some((e) => e.power === 1 && e.toughness === 1)).toBe(true);
    expect(classifyStaticCensusLine(line, 'Animate Artifact')?.system).toMatch(/mana value|Animate|batch70/i);
  });

  it('Toph power from +1/+1 counters on lands', () => {
    const card = {
      name: 'Toph, the Blind Bandit',
      type_line: 'Legendary Creature — Human Warrior Ally',
      power: '*',
      toughness: '3',
      oracle_text: "Toph's power is equal to the number of +1/+1 counters on lands you control.",
      controller: 'p1',
    };
    const land = {
      id: 'l1', controller: 'p1', counters: { '+1/+1': 2 },
      card: { name: 'Forest', type_line: 'Basic Land — Forest' },
    };
    const land2 = {
      id: 'l2', controller: 'p1', counters: { '+1/+1': 1 },
      card: { name: 'Mountain', type_line: 'Basic Land — Mountain' },
    };
    const state: any = { battlefield: [land, land2], zones: { p1: {} }, players: [{ id: 'p1' }] };
    expect(calculateVariablePT(card, state)).toEqual({ power: 3, toughness: 3 });
    expect(classifyStaticCensusLine(
      "Toph's power is equal to the number of +1/+1 counters on lands you control.",
      'Toph, the Blind Bandit',
    )?.system).toMatch(/counters on lands|variablePower|batch70|CDA/i);
  });

  it('Xande pump from noncreature nonland GY cards', () => {
    const line = 'Xande gets +1/+1 for each noncreature, nonland card in your graveyard.';
    const xande = P('Xande, Dark Mage', line, 'Legendary Creature — Human Wizard', {}, { power: '3', toughness: '3' });
    expect(parseStaticEffectSpecsFromOraclePermanent(xande).some(
      (s) => s.grant.countBasis === 'controller_graveyard_cards_of_type'
        && (s.grant as any).countCardType === 'noncreature_nonland'
        && s.grant.power === 1,
    )).toBe(true);

    const state: any = {
      battlefield: [xande],
      zones: {
        p1: {
          graveyard: [
            { name: 'Bolt', type_line: 'Instant' },
            { name: 'Wrath', type_line: 'Sorcery' },
            { name: 'Bear', type_line: 'Creature — Bear' },
            { name: 'Forest', type_line: 'Basic Land — Forest' },
          ],
        },
      },
      players: [{ id: 'p1' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(xande, state)?.power).toBe(5);
    expect(classifyStaticCensusLine(line, 'Xande, Dark Mage')?.system).toMatch(/noncreature|graveyard|counted|batch70/i);
  });

  it('B70 classifier-only lines', () => {
    expect(classifyStaticCensusLine(
      'Lethal damage dealt to creatures you control is determined by their power rather than their toughness.',
      'Zilortha, Strength Incarnate',
    )?.system).toMatch(/lethal|Zilortha|power/i);
    expect(classifyStaticCensusLine(
      "Wood Elemental's power and toughness are each equal to the number of Forests sacrificed as it entered.",
      'Wood Elemental',
    )?.system).toMatch(/Forest|sacrificed|Wood/i);
    expect(classifyStaticCensusLine(
      'Assassin spells you cast have freerunning {B}{B}.',
      'Ezio Auditore da Firenze',
    )?.system).toMatch(/freerunning/i);
    expect(classifyStaticCensusLine(
      'The first historic spell you cast each turn has convoke.',
      'Peri Brown',
    )?.system).toMatch(/historic|convoke/i);
    expect(classifyStaticCensusLine(
      'Science Teacher — Each Saga spell you cast has replicate. The replicate cost is equal to its mana cost.',
      'Ian Chesterton',
    )?.system).toMatch(/replicate|Saga/i);
    expect(classifyStaticCensusLine(
      'Madness—Pay six {C}.',
      'Emrakul, the World Anew',
    )?.system).toMatch(/madness/i);
    expect(classifyStaticCensusLine(
      "Creatures your opponents control without flying or reach can't block creatures with power 2 or less.",
      'Sidar Kondo of Jamuraa',
    )?.system).toMatch(/Sidar|flying|reach|block/i);
    expect(classifyStaticCensusLine(
      'If you tap a basic land for mana, it produces three times as much of that mana instead.',
      'Virtue of Strength',
    )?.system).toMatch(/basic land|mana|times/i);
    expect(classifyStaticCensusLine(
      'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.',
      'Roaming Throne',
    )?.system).toMatch(/trigger|doubl|chosen/i);
  });
});
