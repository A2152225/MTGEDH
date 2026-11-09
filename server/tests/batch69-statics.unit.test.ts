import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getCascadeInstancesForCast } from '../src/state/modules/cascadeCastGrants.js';
import { collectAttackYouProhibitionForAttacker } from '../src/state/modules/staticEffectSpecAttackYouTax.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch69 statics', () => {
  it('Ichorplate oil-counter anthem', () => {
    const line = 'Creatures you control with oil counters on them get +1/+1.';
    const golem = P('Ichorplate Golem', line, 'Artifact Creature — Golem');
    const oily = {
      id: 'myr', controller: 'p1', counters: { oil: 1 },
      card: { name: 'Myr', type_line: 'Artifact Creature — Myr', power: '1', toughness: '1' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(golem).some(
      (s) => (s.scope as any).qualifier?.counter === 'oil' && s.grant.power === 1,
    )).toBe(true);
    const state: any = { battlefield: [golem, oily], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(oily as any, state)?.power).toBe(2);
    expect(classifyStaticCensusLine(line, 'Ichorplate Golem')?.system).toMatch(/oil|batch69/i);
  });

  it('Kavu Runner haste when no opponent W/U creature', () => {
    const line = 'This creature has haste as long as no opponent controls a white or blue creature.';
    const runner = P('Kavu Runner', line);
    expect(parseStaticEffectSpecsFromOraclePermanent(runner).some(
      (s) => s.condition?.kind === 'no_opponent_controls_matching'
        && (s.condition as any).colors?.includes('white')
        && (s.grant.abilities || []).includes('haste'),
    )).toBe(true);
    const state: any = {
      battlefield: [runner],
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(runner, state)).toContain('haste');
    expect(classifyStaticCensusLine(line, 'Kavu Runner')?.system).toMatch(/haste|conditionalSelf|batch69/i);
  });

  it('Solitary Camel lifelink with Desert in graveyard', () => {
    const line = 'This creature has lifelink as long as you control a Desert or there is a Desert card in your graveyard.';
    const camel = P('Solitary Camel', line);
    expect(parseStaticEffectSpecsFromOraclePermanent(camel).some(
      (s) => s.condition?.kind === 'controller_desert_or_desert_in_graveyard',
    )).toBe(true);
    const state: any = {
      battlefield: [camel],
      zones: { p1: { graveyard: [{ name: 'Desert of the True', type_line: 'Land — Desert' }] } },
      players: [{ id: 'p1' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(camel, state)).toContain('lifelink');
    expect(classifyStaticCensusLine(line, 'Solitary Camel')?.system).toMatch(/desert|lifelink|conditionalSelf|batch69/i);
  });

  it('Windwright Mage flying with artifact in graveyard', () => {
    const line = 'This creature has flying as long as an artifact card is in your graveyard.';
    const mage = P('Windwright Mage', `${line}\nLifelink`);
    expect(parseStaticEffectSpecsFromOraclePermanent(mage).some(
      (s) => s.condition?.kind === 'controller_graveyard_type_at_least'
        && (s.condition as any).cardType === 'artifact'
        && (s.grant.abilities || []).includes('flying'),
    )).toBe(true);
    expect(classifyStaticCensusLine(line, 'Windwright Mage')?.system).toMatch(/flying|graveyard|conditionalSelf|batch69/i);
  });

  it('Blood Baron compound life thresholds', () => {
    const line = 'As long as you have 30 or more life and an opponent has 10 or less life, this creature gets +6/+6 and has flying.';
    const baron = P('Blood Baron of Vizkopa', line);
    const specs = parseStaticEffectSpecsFromOraclePermanent(baron);
    expect(specs.some((s) => s.condition?.kind === 'source_controller_life_at_least'
      && Array.isArray(s.conditions)
      && s.conditions!.some((c) => c.kind === 'opponent_life_at_most' && (c as any).amount === 10)
      && s.grant.power === 6)).toBe(true);
    const state: any = {
      battlefield: [baron],
      life: { p1: 30, p2: 10 },
      players: [{ id: 'p1', life: 30 }, { id: 'p2', life: 10 }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(baron, state)?.power).toBe(8);
    expect(getContinuousGrantedAbilitiesForPermanent(baron, state)).toContain('flying');
    expect(classifyStaticCensusLine(line, 'Blood Baron of Vizkopa')?.system).toMatch(/life|conditionalSelf|batch69/i);
  });

  it('Quandrix hand cascade grant', () => {
    const line = 'Instant and sorcery spells you cast from your hand have cascade.';
    const quandrix = P('Quandrix, the Proof', line, 'Legendary Creature — Elder Dragon');
    const bolt = { name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' };
    const state: any = { battlefield: [quandrix], players: [{ id: 'p1' }] };
    expect(getCascadeInstancesForCast(state, 'p1', bolt, { castSourceZone: 'hand' })).toBe(1);
    expect(getCascadeInstancesForCast(state, 'p1', bolt, { castSourceZone: 'graveyard' })).toBe(0);
    expect(classifyStaticCensusLine(line, 'Quandrix, the Proof')?.system).toMatch(/cascade|hand|batch69/i);
  });

  it('Bloodbraid Marauder delirium cascade', () => {
    const line = 'This spell has cascade as long as there are four or more card types among cards in your graveyard.';
    const marauder = {
      name: 'Bloodbraid Marauder',
      type_line: 'Creature — Human Berserker',
      oracle_text: `This creature can't block.\nDelirium — ${line}`,
    };
    const empty: any = { zones: { p1: { graveyard: [] } }, players: [{ id: 'p1' }] };
    expect(getCascadeInstancesForCast(empty, 'p1', marauder)).toBe(0);
    const delirium: any = {
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Creature — Bear' },
            { type_line: 'Instant' },
            { type_line: 'Sorcery' },
            { type_line: 'Land' },
          ],
        },
      },
      players: [{ id: 'p1' }],
    };
    expect(getCascadeInstancesForCast(delirium, 'p1', marauder)).toBe(1);
    expect(classifyStaticCensusLine(line, 'Bloodbraid Marauder')?.system).toMatch(/cascade|graveyard|batch69/i);
  });

  it('Yavimaya Kavu split color CDA', () => {
    const card = {
      name: 'Yavimaya Kavu',
      type_line: 'Creature — Kavu',
      power: '*',
      toughness: '*',
      oracle_text: "Yavimaya Kavu's power is equal to the number of red creatures on the battlefield.\nYavimaya Kavu's toughness is equal to the number of green creatures on the battlefield.",
    };
    const red = { id: 'r', controller: 'p2', card: { name: 'Goblin', type_line: 'Creature — Goblin', colors: ['R'] } };
    const green = { id: 'g', controller: 'p1', card: { name: 'Elf', type_line: 'Creature — Elf', colors: ['G'] } };
    const green2 = { id: 'g2', controller: 'p2', card: { name: 'Beast', type_line: 'Creature — Beast', colors: ['G'] } };
    const state: any = { battlefield: [red, green, green2], players: [{ id: 'p1' }, { id: 'p2' }] };
    const pt = calculateVariablePT({ ...card, controller: 'p1' }, state);
    expect(pt).toEqual({ power: 1, toughness: 2 });
    expect(classifyStaticCensusLine(
      "Yavimaya Kavu's power is equal to the number of red creatures on the battlefield.",
      'Yavimaya Kavu',
    )?.system).toMatch(/COLOR|variablePower|batch69|battlefield/i);
  });

  it('Caller of the Hunt chosen-type CDA', () => {
    const card = {
      name: 'Caller of the Hunt',
      type_line: 'Creature — Human Spellshaper',
      power: '*',
      toughness: '*',
      oracle_text: "As an additional cost to cast this spell, choose a creature type.\nCaller of the Hunt's power and toughness are each equal to the number of creatures of the chosen type on the battlefield.",
      chosenCreatureType: 'Elf',
    };
    const elf = { id: 'e1', controller: 'p1', card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' } };
    const elf2 = { id: 'e2', controller: 'p2', card: { name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' } };
    const bear = { id: 'b', controller: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear' } };
    const host = { id: 'caller', controller: 'p1', chosenCreatureType: 'Elf', card };
    const state: any = { battlefield: [host, elf, elf2, bear], players: [{ id: 'p1' }, { id: 'p2' }] };
    expect(calculateVariablePT({ ...card, controller: 'p1' }, state)).toEqual({ power: 2, toughness: 2 });
    expect(classifyStaticCensusLine(
      "Caller of the Hunt's power and toughness are each equal to the number of creatures of the chosen type on the battlefield.",
      'Caller of the Hunt',
    )?.system).toMatch(/chosen-type|variablePower|batch69/i);
  });

  it('Planar Nexus every nonbasic land type', () => {
    const line = 'This land is every nonbasic land type.';
    const nexus = P('Planar Nexus', `${line}\n{T}: Add {C}.`, 'Land');
    expect(parseStaticEffectSpecsFromOraclePermanent(nexus).some(
      (s) => Array.isArray(s.grant.typeAdditions) && (s.grant.typeAdditions as string[]).includes('Desert'),
    )).toBe(true);
    expect(classifyStaticCensusLine(line, 'Planar Nexus')?.system).toMatch(/nonbasic|batch69/i);
  });

  it('Varchild Survivors cant block / attack you', () => {
    const line = "Survivors your opponents control can't block, and they can't attack you or planeswalkers you control.";
    const varchild = P('Varchild, Betrayer of Kjeldor', line, 'Legendary Creature — Human Soldier');
    const survivor = {
      id: 'surv', controller: 'p2',
      card: { name: 'Survivor Token', type_line: 'Creature — Survivor', power: '1', toughness: '1' },
    };
    const specs = parseStaticEffectSpecsFromOraclePermanent(varchild);
    expect(specs.some((s) => s.scope.kind === 'opponent_creatures_of_type'
      && (s.scope as any).creatureType === 'survivor'
      && (s.grant.abilities || []).includes("can't block"))).toBe(true);
    expect(specs.some((s) => s.grant.attackYouProhibited === true)).toBe(true);

    const state: any = {
      battlefield: [varchild, survivor],
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(survivor as any, state)).toContain("can't block");
    expect(collectAttackYouProhibitionForAttacker(state, 'p1', survivor as any)).toBeTruthy();
    expect(classifyStaticCensusLine(line, 'Varchild, Betrayer of Kjeldor')?.system).toMatch(/Survivors|cant block|batch69|attack you/i);
  });

  it('Averna and cumulative-upkeep classifiers', () => {
    expect(classifyStaticCensusLine(
      'As you cascade, you may put a land card from among the exiled cards onto the battlefield tapped.',
      'Averna, the Chaos Bloom',
    )?.system).toMatch(/cascade|Averna|land/i);
    expect(classifyStaticCensusLine(
      'Cumulative upkeep—Put a -1/-1 counter on this creature.',
      'Aboroth',
    )?.system).toMatch(/cumulative|counter/i);
    expect(classifyStaticCensusLine(
      'Cumulative upkeep—Have an opponent create a 1/1 red Survivor creature token.',
      "Varchild's War-Riders",
    )?.system).toMatch(/cumulative|token|Survivor/i);
  });
});
