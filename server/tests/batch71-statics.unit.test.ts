import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { calculateVariablePT } from '../src/state/utils-handlers/variablePTCalculator.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch71 statics', () => {
  it('Living Conundrum empty library base P/T', () => {
    const line = 'As long as there are no cards in your library, this creature has base power and toughness 10/10 and has flying and vigilance.';
    const conundrum = P('Living Conundrum', line, 'Creature — Elemental', {}, { power: '2', toughness: '5' });
    expect(parseStaticEffectSpecsFromOraclePermanent(conundrum).some(
      (s) => s.condition?.kind === 'controller_library_empty' && s.grant.setPower === 10,
    )).toBe(true);
    const state: any = {
      battlefield: [conundrum],
      zones: { p1: { library: [], libraryCount: 0 } },
      players: [{ id: 'p1' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(conundrum, state)?.power).toBe(10);
    expect(getContinuousGrantedAbilitiesForPermanent(conundrum, state)).toContain('flying');
    expect(classifyStaticCensusLine(line, 'Living Conundrum')?.system).toMatch(/empty library|batch71/i);
  });

  it('Magmatic Channeler instant/sorcery GY pump', () => {
    const line = 'As long as there are four or more instant and/or sorcery cards in your graveyard, this creature gets +3/+1.';
    const channeler = P('Magmatic Channeler', line, 'Creature — Human Wizard', {}, { power: '1', toughness: '3' });
    expect(parseStaticEffectSpecsFromOraclePermanent(channeler).some(
      (s) => (s.condition as any)?.cardType === 'instant_or_sorcery' && s.grant.power === 3,
    )).toBe(true);
    const state: any = {
      battlefield: [channeler],
      zones: {
        p1: {
          graveyard: [
            { type_line: 'Instant' }, { type_line: 'Sorcery' },
            { type_line: 'Instant' }, { type_line: 'Sorcery' },
          ],
        },
      },
      players: [{ id: 'p1' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(channeler, state)?.power).toBe(4);
    expect(classifyStaticCensusLine(line, 'Magmatic Channeler')?.system).toMatch(/instant|sorcery|batch71/i);
  });

  it('Mirror Box legendary creature anthem', () => {
    const line = 'Each legendary creature you control gets +1/+1.';
    const box = P('Mirror Box', line, 'Artifact');
    const legend = {
      id: 'leg', controller: 'p1',
      card: { name: 'Atraxa', type_line: 'Legendary Creature — Phyrexian Angel', power: '4', toughness: '4' },
    };
    const bear = {
      id: 'bear', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(box).some(
      (s) => s.condition?.kind === 'target_is_legendary_creature' && s.grant.power === 1,
    )).toBe(true);
    const state: any = { battlefield: [box, legend, bear], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(legend as any, state)?.power).toBe(5);
    expect(getCurrentPowerToughness(bear as any, state)?.power).toBe(2);
    expect(classifyStaticCensusLine(line, 'Mirror Box')?.system).toMatch(/legendary|batch71/i);
  });

  it('On Wings of Gold zombie or token anthem', () => {
    const line = 'Creatures you control that are Zombies and/or tokens get +1/+1 and have flying.';
    const enchant = P('On Wings of Gold', line, 'Enchantment');
    const zombie = {
      id: 'z', controller: 'p1',
      card: { name: 'Walking Corpse', type_line: 'Creature — Zombie', power: '2', toughness: '2' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(enchant).some(
      (s) => s.condition?.kind === 'target_is_zombie_or_token' && (s.grant.abilities || []).includes('flying'),
    )).toBe(true);
    const state: any = { battlefield: [enchant, zombie], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(zombie as any, state)?.power).toBe(3);
    expect(getContinuousGrantedAbilitiesForPermanent(zombie as any, state)).toContain('flying');
  });

  it('Boarded Window creatures attacking you', () => {
    const line = 'Creatures attacking you get -1/-0.';
    const window = P('Boarded Window', line, 'Artifact');
    const attacker = {
      id: 'atk', controller: 'p2', isAttacking: true, attacking: 'p1',
      card: { name: 'Goblin', type_line: 'Creature — Goblin', power: '2', toughness: '1' },
    };
    const state: any = {
      battlefield: [window, attacker],
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    syncDerivedContinuousEffects(state);
    expect(getCurrentPowerToughness(attacker as any, state)?.power).toBe(1);
    expect(classifyStaticCensusLine(line, 'Boarded Window')?.system).toMatch(/attacking you|batch71/i);
  });

  it('Thran Power Suit aura+equipment count with ward', () => {
    const line = 'Equipped creature gets +1/+1 for each Aura and Equipment attached to it and has ward {2}.';
    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const suit = P('Thran Power Suit', line, 'Artifact — Equipment', { attachedTo: 'host' });
    const aura = {
      id: 'aura', controller: 'p1', attachedTo: 'host',
      card: { name: 'Holy Strength', type_line: 'Enchantment — Aura' },
    };
    expect(parseStaticEffectSpecsFromOraclePermanent(suit).some(
      (s) => s.grant.countBasis === 'attachments_on_source'
        && (s.grant.abilities || []).some((a) => /^ward/.test(a)),
    )).toBe(true);
    const state: any = { battlefield: [suit, host, aura], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    // suit + aura attached = at least +2 (legacy attached reader may also contribute a flat bonus)
    expect(getCurrentPowerToughness(host as any, state)?.power).toBeGreaterThanOrEqual(4);
    expect(getContinuousGrantedAbilitiesForPermanent(host as any, state).some((a) => /^ward/.test(a))).toBe(true);
  });

  it('Nighthawk Scavenger power plus opponent GY types', () => {
    const card = {
      name: 'Nighthawk Scavenger',
      type_line: 'Creature — Vampire Rogue',
      power: '1+*',
      toughness: '3',
      oracle_text: "Nighthawk Scavenger's power is equal to 1 plus the number of card types among cards in your opponents' graveyards.",
      controller: 'p1',
    };
    const state: any = {
      battlefield: [],
      zones: {
        p1: { graveyard: [{ type_line: 'Creature — Bear' }] },
        p2: {
          graveyard: [
            { type_line: 'Instant' },
            { type_line: 'Land' },
            { type_line: 'Creature — Elf' },
          ],
        },
      },
      players: [{ id: 'p1' }, { id: 'p2' }],
    };
    expect(calculateVariablePT(card, state)).toEqual({ power: 4, toughness: 3 });
    expect(classifyStaticCensusLine(
      "Nighthawk Scavenger's power is equal to 1 plus the number of card types among cards in your opponents' graveyards.",
      'Nighthawk Scavenger',
    )?.system).toMatch(/card types|opponents|CDA|batch71|variable/i);
  });

  it('Empty-Shrine protection from colors among permanents', () => {
    const line = 'This creature has protection from the colors of permanents you control.';
    const kannushi = P('Empty-Shrine Kannushi', line);
    const plains = {
      id: 'pl', controller: 'p1',
      card: { name: 'Plains', type_line: 'Basic Land — Plains', colors: ['W'] },
    };
    const state: any = { battlefield: [kannushi, plains], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(state);
    expect(getContinuousGrantedAbilitiesForPermanent(kannushi, state)).toContain('protection from white');
    expect(classifyStaticCensusLine(line, 'Empty-Shrine Kannushi')?.system).toMatch(/protection|colors|batch71/i);
  });

  it('B71 classifiers', () => {
    expect(classifyStaticCensusLine(
      'Each player may attack only the nearest opponent in the chosen direction and planeswalkers controlled by that opponent.',
      'Pramikon, Sky Rampart',
    )?.system).toMatch(/nearest opponent|chosen direction|mysticBarrier/i);
    expect(classifyStaticCensusLine(
      "Players can't pay life or sacrifice creatures to cast spells or activate abilities.",
      'Angel of Jubilation',
    )?.system).toMatch(/pay life|sacrifice|Angel/i);
    expect(classifyStaticCensusLine(
      'Permanents with ice counters on them are snow.',
      'Rimefeather Owl',
    )?.system).toMatch(/ice|snow|batch71/i);
  });
});
