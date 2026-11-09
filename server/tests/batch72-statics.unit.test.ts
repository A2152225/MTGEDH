import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { enterUntappedOverrideSourceName } from '../src/state/modules/landsEnterUntappedOverride.js';
import { canAttackDespiteDefender } from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';
import { applyStateBasedActions } from '../src/rules-engine/index.js';
import { parseAttachmentGrantedKeywordsFromOracle } from '../../shared/src/attachmentKeywordGrants.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch72 statics', () => {
  it('Kolodin mounts and vehicles have haste', () => {
    const line = 'Mounts and Vehicles you control have haste.';
    const kolodin = P('Kolodin, Triumph Caster', line, 'Legendary Creature — Human Pilot');
    expect(parseStaticEffectSpecsFromOraclePermanent(kolodin).some(
      (s) => (s.grant.abilities || []).includes('haste')
        && Array.isArray(s.conditions)
        && s.conditions!.some((c) => c.kind === 'target_has_any_subtype'),
    )).toBe(true);
    const mount = {
      id: 'm', controller: 'p1',
      card: { name: 'Horse', type_line: 'Creature — Horse Mount', power: '2', toughness: '2' },
    };
    const state: any = { battlefield: [kolodin, mount], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(mount as any, state)).toContain('haste');
    expect(classifyStaticCensusLine(line, 'Kolodin, Triumph Caster')?.system).toMatch(/mounts|vehicles|batch72/i);
  });

  it('Rohgahh named Kobolds anthem', () => {
    const line = 'Creatures you control named Kobolds of Kher Keep get +2/+2.';
    const roh = P('Rohgahh of Kher Keep', line, 'Legendary Creature — Kobold');
    expect(parseStaticEffectSpecsFromOraclePermanent(roh).some(
      (s) => s.condition?.kind === 'target_has_name' && s.grant.power === 2,
    )).toBe(true);
    const kobold = {
      id: 'k', controller: 'p1',
      card: { name: 'Kobolds of Kher Keep', type_line: 'Creature — Kobold', power: '0', toughness: '1' },
    };
    const bear = {
      id: 'b', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const state: any = { battlefield: [roh, kobold, bear], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(kobold as any, state)?.power).toBe(2);
    expect(getCurrentPowerToughness(bear as any, state)?.power).toBe(2);
    expect(classifyStaticCensusLine(line, 'Rohgahh of Kher Keep')?.system).toMatch(/named|batch72/i);
  });

  it('Evolved Spinoderm oil at-most keywords', () => {
    const line = 'This creature has trample as long as it has two or fewer oil counters on it. Otherwise, it has hexproof.';
    const spin = P('Evolved Spinoderm', line, 'Creature — Phyrexian Beast', { counters: { oil: 2 } });
    const specs = parseStaticEffectSpecsFromOraclePermanent(spin);
    expect(specs.some((s) => (s.condition as any)?.kind === 'source_counter_at_most' && (s.grant.abilities || []).includes('trample'))).toBe(true);
    expect(specs.some((s) => s.conditionNegated && (s.grant.abilities || []).includes('hexproof'))).toBe(true);
    const state: any = { battlefield: [spin], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(spin, state)).toContain('trample');
    spin.counters = { oil: 3 };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(spin, state)).toContain('hexproof');
    expect(classifyStaticCensusLine(line, 'Evolved Spinoderm')?.system).toMatch(/oil|counter|fewer|selfCounter/i);
  });

  it('Ruric Thar Magecrusher hexproof until combat damage', () => {
    const line = "Ruric Thar has hexproof as long as they haven't dealt combat damage yet.";
    const ruric = P('Ruric Thar, Magecrusher', line, 'Legendary Creature — Ogre Warrior');
    expect(parseStaticEffectSpecsFromOraclePermanent(ruric).some(
      (s) => s.condition?.kind === 'target_has_not_dealt_damage' && (s.grant.abilities || []).includes('hexproof'),
    )).toBe(true);
    const state: any = { battlefield: [ruric], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(ruric, state)).toContain('hexproof');
    (ruric as any).hasDealtDamage = true;
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(ruric, state)).not.toContain('hexproof');
  });

  it('Lyse Hext noncreature spell count double strike', () => {
    const line = "As long as you've cast two or more noncreature spells this turn, Lyse Hext has double strike.";
    const lyse = P('Lyse Hext', line, 'Legendary Creature — Human Rebel Monk');
    expect(parseStaticEffectSpecsFromOraclePermanent(lyse).some(
      (s) => s.condition?.kind === 'controller_noncreature_spells_cast_at_least'
        && (s.grant.abilities || []).includes('double strike'),
    )).toBe(true);
    const state: any = {
      battlefield: [lyse],
      players: [{ id: 'p1' }],
      noncreatureSpellsCastThisTurn: { p1: 2 },
    };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(lyse, state)).toContain('double strike');
    expect(classifyStaticCensusLine(line, 'Lyse Hext')?.system).toMatch(/noncreature|batch72|conditional/i);
  });

  it('Aeve token is not legendary', () => {
    const line = "Aeve isn't legendary if it's a token.";
    const token = P('Aeve, Progenitor Ooze', line, 'Legendary Creature — Ooze', { isToken: true, id: 't1' });
    const twin = P('Aeve, Progenitor Ooze', line, 'Legendary Creature — Ooze', { isToken: true, id: 't2' });
    expect(parseStaticEffectSpecsFromOraclePermanent(token).some(
      (s) => s.grant.notLegendary === true && s.condition?.kind === 'target_is_token',
    )).toBe(true);
    const state: any = {
      battlefield: [token, twin],
      players: [{ id: 'p1', life: 40 }],
      life: { p1: 40 },
    };
    syncDerivedContinuousEffects(state);
    expect((token as any).continuousNotLegendary).toBe(true);
    expect(applyStateBasedActions(state).legendRuleViolations || []).toHaveLength(0);
    expect(classifyStaticCensusLine(line, 'Aeve, Progenitor Ooze')?.system).toMatch(/legendary|batch72|token/i);
  });

  it('Consecrate Land enchanted land indestructible', () => {
    const line = "Enchanted land has indestructible and can't be enchanted by other Auras.";
    expect(parseAttachmentGrantedKeywordsFromOracle(line)).toContain('indestructible');
    const host = {
      id: 'land', controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    };
    const aura = P('Consecrate Land', `Enchant land\n${line}`, 'Enchantment — Aura', { attachedTo: 'land' });
    expect(parseStaticEffectSpecsFromOraclePermanent(aura).some(
      (s) => (s.grant.abilities || []).includes('indestructible'),
    )).toBe(true);
    const state: any = { battlefield: [aura, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, state)).toContain('indestructible');
    expect(classifyStaticCensusLine(line, 'Consecrate Land')?.system).toMatch(/enchanted land|attachment|indestructible/i);
  });

  it('Glacial Crasher mountain battlefield attack lock', () => {
    const line = "This creature can't attack unless there is a Mountain on the battlefield.";
    const crash = P('Glacial Crasher', line, 'Creature — Elemental');
    expect(parseStaticEffectSpecsFromOraclePermanent(crash).some(
      (s) => (s.grant.abilities || []).includes("can't attack")
        && (s.condition as any)?.kind === 'battlefield_has_matching'
        && s.conditionNegated === true,
    )).toBe(true);
    expect(classifyStaticCensusLine(line, 'Glacial Crasher')?.system).toMatch(/battlefield|combat|mountain|batch72/i);
  });

  it('Dauthi Warlord / Wilderness Elemental CDAs', () => {
    const dauthiLine = "Dauthi Warlord's power is equal to the number of creatures on the battlefield with shadow.";
    const dauthi = {
      name: 'Dauthi Warlord', oracle_text: dauthiLine, type_line: 'Creature — Dauthi Soldier', power: '*', toughness: '1',
      keywords: ['shadow'],
    };
    const shadowBuddy = {
      id: 's', controller: 'p2',
      card: { name: 'Dauthi Horror', type_line: 'Creature — Dauthi Horror', oracle_text: 'Shadow', keywords: ['shadow'], power: '2', toughness: '1' },
    };
    const state: any = {
      battlefield: [{ id: 'd', controller: 'p1', card: dauthi }, shadowBuddy],
      zones: { p1: { hand: [], graveyard: [] } },
      players: [{ id: 'p1' }],
      life: { p1: 40 },
    };
    expect(calculateVariablePT(dauthi, state)?.power).toBe(2);
    expect(classifyStaticCensusLine(dauthiLine, 'Dauthi Warlord')?.system).toMatch(/shadow|variable|CDA|batch72/i);

    const wildLine = "Wilderness Elemental's power is equal to the number of nonbasic lands your opponents control.";
    const wild = { name: 'Wilderness Elemental', oracle_text: wildLine, type_line: 'Creature — Elemental', power: '*', toughness: '3' };
    const nonbasic = {
      id: 'nb', controller: 'p2',
      card: { name: 'Breeding Pool', type_line: 'Land — Forest Island', oracle_text: '' },
    };
    const basic = {
      id: 'b', controller: 'p2',
      card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
    };
    const wState: any = {
      battlefield: [{ id: 'w', controller: 'p1', card: wild }, nonbasic, basic],
      zones: { p1: { hand: [], graveyard: [] } },
      players: [{ id: 'p1' }],
      life: { p1: 40 },
    };
    expect(calculateVariablePT(wild, wState)?.power).toBe(1);
  });

  it('Gond Gate gates enter untapped', () => {
    const gate = {
      id: 'g', controller: 'p1',
      card: { name: 'Gond Gate', type_line: 'Land — Gate', oracle_text: 'Gates you control enter untapped.\n{T}: Add {C}.' },
    };
    expect(enterUntappedOverrideSourceName([gate], 'p1', { type_line: 'Land — Gate', name: 'Basilica Gardens' })).toBe('Gond Gate');
    expect(classifyStaticCensusLine('Gates you control enter untapped.', 'Gond Gate')?.system).toMatch(/enter untapped|landsEnterUntapped/i);
  });

  it('Guardians of Oboro modified as-though no defender', () => {
    const line = "Modified creatures you control can attack as though they didn't have defender.";
    const guardians = P('Guardians of Oboro', `Defender\n${line}`, 'Creature — Moonfolk Samurai');
    const wall = {
      id: 'wall', controller: 'p1',
      counters: { '+1/+1': 1 },
      card: { name: 'Wall of Omens', type_line: 'Creature — Wall', oracle_text: 'Defender', keywords: ['defender'], power: '0', toughness: '4' },
    };
    expect(canAttackDespiteDefender(wall, [guardians, wall], 'p1')).toBe(true);
    expect(classifyStaticCensusLine(line, 'Guardians of Oboro')?.system).toMatch(/modified|defender|combatDefender/i);
  });
});
