import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';
import { getEffectiveColors } from '../src/state/modules/effectiveColors.js';
import { zoneEnterProhibitionReason } from '../src/state/modules/batch31CastLocks.js';
import { findOracleCastingLimitViolation } from '../src/state/modules/staticCastingRestrictionsOracleExtras.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch73 statics', () => {
  it('Jodah legendary where-x anthem', () => {
    const line = 'Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.';
    const jodah = P('Jodah, the Unifier', line, 'Legendary Creature — Human Wizard', {}, { power: '5', toughness: '5' });
    expect(parseStaticEffectSpecsFromOraclePermanent(jodah).some(
      (s) => s.condition?.kind === 'target_is_legendary_creature'
        && (s.grant as any).countBasis === 'controller_permanents_of_type'
        && (s.grant as any).countQualifier?.legendary === true,
    )).toBe(true);
    const other = {
      id: 'leg', controller: 'p1',
      card: { name: 'Atraxa', type_line: 'Legendary Creature — Phyrexian Angel', power: '4', toughness: '4' },
    };
    const state: any = { battlefield: [jodah, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    // 2 legendary creatures → each gets +2/+2
    expect(getCurrentPowerToughness(other as any, state)?.power).toBe(6);
    expect(classifyStaticCensusLine(line, 'Jodah, the Unifier')?.system).toMatch(/legendary|where-x|batch73/i);
  });

  it('Sheltering Prayers basic land shroud', () => {
    const line = 'Basic lands each player controls have shroud as long as that player controls three or fewer lands.';
    const prayers = P('Sheltering Prayers', line, 'Enchantment');
    expect(parseStaticEffectSpecsFromOraclePermanent(prayers).some(
      (s) => (s.grant.abilities || []).includes('shroud')
        && (s.condition as any)?.kind === 'target_controller_controls_at_most',
    )).toBe(true);
    const plains = {
      id: 'pl', controller: 'p2',
      card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    };
    const mountain = {
      id: 'mt', controller: 'p2',
      card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' },
    };
    const state: any = { battlefield: [prayers, plains, mountain], players: [{ id: 'p1' }, { id: 'p2' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(plains as any, state)).toContain('shroud');
  });

  it('Rakdos Riteknife equipped for each blood counter', () => {
    const line = 'Equipped creature gets +1/+0 for each blood counter on this Equipment and has "{T}, Sacrifice a creature: Put a blood counter on Rakdos Riteknife."';
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Goblin', type_line: 'Creature — Goblin', power: '1', toughness: '1' },
    };
    const knife = P('Rakdos Riteknife', line, 'Artifact — Equipment', {
      attachedTo: 'host',
      counters: { blood: 3 },
    });
    expect(parseStaticEffectSpecsFromOraclePermanent(knife).some(
      (s) => (s.grant as any).countCounterType === 'blood' && s.grant.power === 1,
    )).toBe(true);
    const state: any = { battlefield: [knife, host], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(host as any, state)?.power).toBe(4);
    expect(classifyStaticCensusLine(line, 'Rakdos Riteknife')?.system).toMatch(/equipped|blood|batch73/i);
  });

  it('Rootpath Purifier lands are basic', () => {
    const line = 'Lands you control and land cards in your library are basic.';
    const purifier = P('Rootpath Purifier', line, 'Creature — Elf Druid');
    expect(parseStaticEffectSpecsFromOraclePermanent(purifier).some(
      (s) => Array.isArray(s.grant.typeAdditions) && s.grant.typeAdditions!.includes('Basic'),
    )).toBe(true);
    const nonbasic = {
      id: 'nb', controller: 'p1',
      card: { name: 'Breeding Pool', type_line: 'Land — Forest Island', oracle_text: '' },
    };
    const state: any = { battlefield: [purifier, nonbasic], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect((nonbasic as any).continuousTypeAdditions || []).toEqual(expect.arrayContaining(['Basic']));
  });

  it('Shifting Sky nonland chosen color set', () => {
    const line = 'All nonland permanents are the chosen color.';
    const sky = P('Shifting Sky', `As this enchantment enters, choose a color.\n${line}`, 'Enchantment', { chosenColor: 'blue' });
    expect(parseStaticEffectSpecsFromOraclePermanent(sky).some(
      (s) => Array.isArray(s.grant.colorAdditions) && s.grant.colorAdditions!.some((c) => String(c).includes('U')),
    )).toBe(true);
    const bear = {
      id: 'bear', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', colors: ['G'], power: '2', toughness: '2' },
    };
    const forest = {
      id: 'f', controller: 'p1',
      card: { name: 'Forest', type_line: 'Basic Land — Forest', colors: [], oracle_text: '' },
    };
    const state: any = { battlefield: [sky, bear, forest], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getEffectiveColors(bear as any, state)).toEqual(['U']);
    expect(getEffectiveColors(forest as any, state)).not.toEqual(['U']);
  });

  it('Keen-Eyed Curator exiled card types pump', () => {
    const line = 'As long as there are four or more card types among cards exiled with this creature, it gets +4/+4 and has trample.';
    const curator = P('Keen-Eyed Curator', line, 'Creature — Raccoon Scout', {
      exiledCards: [
        { type_line: 'Creature — Bear' },
        { type_line: 'Instant' },
        { type_line: 'Artifact' },
        { type_line: 'Land' },
      ],
    }, { power: '3', toughness: '3' });
    expect(parseStaticEffectSpecsFromOraclePermanent(curator).some(
      (s) => s.condition?.kind === 'source_exiled_card_types_at_least' && s.grant.power === 4,
    )).toBe(true);
    const state: any = { battlefield: [curator], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(curator, state)?.power).toBe(7);
    expect(getContinuousGrantedAbilitiesForPermanent(curator, state)).toContain('trample');
  });

  it('Goblin Brawler can\'t be equipped', () => {
    const line = "This creature can't be equipped.";
    const brawler = P('Goblin Brawler', line, 'Creature — Goblin Warrior');
    expect(parseStaticEffectSpecsFromOraclePermanent(brawler).some(
      (s) => (s.grant.abilities || []).includes("can't be equipped"),
    )).toBe(true);
    expect(classifyStaticCensusLine(line, 'Goblin Brawler')?.system).toMatch(/equipped|batch73/i);
  });

  it('Vile Aggregate / Katilda CDAs', () => {
    const vile = {
      name: 'Vile Aggregate',
      oracle_text: "Vile Aggregate's power is equal to the number of colorless creatures you control.",
      type_line: 'Creature — Eldrazi Drone',
      power: '*',
      toughness: '5',
      colors: [],
    };
    const colorless = {
      id: 'c', controller: 'p1',
      card: { name: 'Wastes Walker', type_line: 'Creature — Eldrazi', colors: [], power: '2', toughness: '2' },
    };
    const state: any = {
      battlefield: [{ id: 'v', controller: 'p1', card: vile }, colorless],
      zones: { p1: { hand: [], graveyard: [] } },
      players: [{ id: 'p1' }],
      life: { p1: 40 },
    };
    expect(calculateVariablePT(vile, state)?.power).toBe(2);

    const katilda = {
      name: 'Katilda, Dawnhart Martyr',
      oracle_text: "Katilda's power and toughness are each equal to the number of permanents you control that are Spirits and/or enchantments.",
      type_line: 'Legendary Creature — Spirit Warlock',
      power: '*',
      toughness: '*',
    };
    const spirit = {
      id: 's', controller: 'p1',
      card: { name: 'Spirit Token', type_line: 'Creature — Spirit', power: '1', toughness: '1' },
    };
    const enchant = {
      id: 'e', controller: 'p1',
      card: { name: 'Aura', type_line: 'Enchantment — Aura', oracle_text: '' },
    };
    const kState: any = {
      battlefield: [{ id: 'k', controller: 'p1', card: katilda }, spirit, enchant],
      zones: { p1: { hand: [], graveyard: [] } },
      players: [{ id: 'p1' }],
      life: { p1: 40 },
    };
    // Katilda herself is a Spirit, so she counts with the Spirit token and Aura.
    expect(calculateVariablePT(katilda, kState)).toEqual({ power: 3, toughness: 3 });
  });

  it('Basandra combat cast lock + Weathered enter lock', () => {
    const basandra = P('Basandra, Battle Seraph', "Players can't cast spells during combat.", 'Legendary Creature — Angel');
    const state: any = {
      battlefield: [basandra],
      players: [{ id: 'p1' }, { id: 'p2' }],
      phase: 'combat',
      step: 'declare_attackers',
      turnPlayer: 'p1',
    };
    expect(findOracleCastingLimitViolation(state, 'p2', { type_line: 'Instant' })?.prohibited).toBe(true);
    expect(classifyStaticCensusLine("Players can't cast spells during combat.", 'Basandra, Battle Seraph')?.system)
      .toMatch(/combat|cast/i);

    const runestone = P('Weathered Runestone', "Nonland permanent cards in graveyards and libraries can't enter the battlefield.", 'Artifact');
    const rState: any = { battlefield: [runestone] };
    expect(zoneEnterProhibitionReason(rState, 'graveyard', 'Creature — Bear')).toMatch(/Weathered Runestone/);
    expect(zoneEnterProhibitionReason(rState, 'graveyard', 'Basic Land — Forest')).toBeNull();
    expect(classifyStaticCensusLine(
      "Nonland permanent cards in graveyards and libraries can't enter the battlefield.",
      'Weathered Runestone',
    )?.system).toMatch(/enter|batch31|zone/i);
  });
});
