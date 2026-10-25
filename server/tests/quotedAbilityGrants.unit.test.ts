import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { listGrantedActivatedAbilityLinesForPermanent, resolveGrantedActivatedAbilityLine } from '../src/state/modules/grantedActivatedAbilityResolution';
import { listGrantedActivatedAbilityLines, normalizeGrantedActivatedAbilityLine } from '../../shared/src/grantedActivatedAbilityList';
import { TIMESTAMP_BASE } from '../../rules-engine/src/permanentTimestamps';
import { mergeDetectorOracleWithContinuousGrants } from '../src/state/modules/triggers/detectorGrantedOracle';

const T = TIMESTAMP_BASE + 1000;
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text = '', timestamp?: number) =>
  ({ id, controller, owner: controller, counters: {}, timestamp: timestamp === undefined ? undefined : T + timestamp, card: { id, name, type_line, oracle_text, power: '2', toughness: '2' } }) as any;
const quotes = (specs: any[]) => specs.flatMap((s: any) => s.grant.abilities || []).map((a: string) => a.toLowerCase());

const opposition = () => perm('opp', 'p1', 'Tapper Lord', 'Enchantment', 'Creatures you control have "{T}: Tap target creature."', 5);
const hamza = () => perm('ham', 'p1', 'Trigger Lord', 'Enchantment', 'Creatures you control have "Whenever this creature attacks, you gain 1 life."', 5);

describe('quoted ability grants: parsing', () => {
  it('lords grant quoted activated / mana / trigger abilities', () => {
    expect(quotes(parseStaticEffectSpecsFromOraclePermanent(opposition()))).toContain('{t}: tap target creature.');
    const rite = perm('cr', 'p1', 'Cryptolith Rite', 'Enchantment', 'Creatures you control have "{T}: Add one mana of any color."');
    expect(quotes(parseStaticEffectSpecsFromOraclePermanent(rite)).some((a) => a.includes('{t}: add one mana of any color') || a === 'tap_for_any_color')).toBe(true);
    expect(quotes(parseStaticEffectSpecsFromOraclePermanent(hamza())).some((a) => a.startsWith('whenever this creature attacks'))).toBe(true);
  });
  it("Goddric's celebration grants its quoted activated ability", () => {
    const god = perm('god', 'p1', 'Goddric, Cloaked Reveler', 'Legendary Creature \u2014 Human Noble',
      'Haste\nCelebration \u2014 As long as two or more nonland permanents entered the battlefield under your control this turn, Goddric is a Dragon with base power and toughness 4/4, flying, and "{R}: Dragons you control get +1/+0 until end of turn."');
    expect(quotes(parseStaticEffectSpecsFromOraclePermanent(god))).toContain('{r}: dragons you control get +1/+0 until end of turn.');
  });
});

describe('quoted ability grants: ability list and activation index', () => {
  it('normalizes lowercased spec text and matches client/server indexes', () => {
    expect(normalizeGrantedActivatedAbilityLine('{r}: dragons you control get +1/+0 until end of turn.')).toBe('{R}: Dragons you control get +1/+0 until end of turn.');
    expect(normalizeGrantedActivatedAbilityLine('flying')).toBeNull();
    expect(normalizeGrantedActivatedAbilityLine('whenever this creature attacks, you gain 1 life.')).toBeNull();
    expect(listGrantedActivatedAbilityLines(['tap_for_green', 'haste', '{2}: draw a card.'])).toEqual(['{T}: Add {G}.', '{2}: Draw a card.']);
  });
  it('server resolves the continuous grant behind -granted-<n>', () => {
    const lord = opposition();
    const bear = perm('bear', 'p1', 'Bear', 'Creature \u2014 Bear', '', 3);
    const state = { battlefield: [lord, bear] } as any;
    const lines = listGrantedActivatedAbilityLinesForPermanent(bear, state);
    const idx = lines.indexOf('{T}: Tap target creature.');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(resolveGrantedActivatedAbilityLine(bear, state, idx)).toBe('{T}: Tap target creature.');
  });
});

const humility = (ts: number) => perm('hum', 'p2', 'Humility', 'Enchantment', 'All creatures lose all abilities and have base power and toughness 1/1.', ts);
describe('quoted ability grants: ability loss in timestamp order', () => {
  it('Humility newer than the grant removes it', () => {
    const lord = opposition();
    const bear = perm('bear', 'p1', 'Bear', 'Creature \u2014 Bear', '', 3);
    const granted = getContinuousGrantedAbilitiesForPermanent(bear, { battlefield: [lord, bear, humility(9)] } as any);
    expect(granted).not.toContain('{t}: tap target creature.');
  });
  it('grant newer than Humility survives', () => {
    const lord = opposition();
    const bear = perm('bear', 'p1', 'Bear', 'Creature \u2014 Bear', '', 3);
    const granted = getContinuousGrantedAbilitiesForPermanent(bear, { battlefield: [humility(1), lord, bear] } as any);
    expect(granted).toContain('{t}: tap target creature.');
  });
});

describe('quoted ability grants: triggers', () => {
  it('trigger detectors see granted quoted triggers on the recipient', () => {
    const lord = hamza();
    const bear = perm('bear', 'p1', 'Bear', 'Creature \u2014 Bear', '', 3);
    const merged = mergeDetectorOracleWithContinuousGrants('', bear, { battlefield: [lord, bear] });
    expect(merged.oracleText.toLowerCase()).toContain('whenever this creature attacks, you gain 1 life');
    const lost = mergeDetectorOracleWithContinuousGrants('', bear, { battlefield: [lord, bear, humility(9)] });
    expect(lost.oracleText.toLowerCase()).not.toContain('whenever this creature attacks');
  });
});
