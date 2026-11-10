import { describe, expect, it } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  syncDerivedContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { getCurrentPowerToughness } from '../src/state/modules/currentPowerToughness.js';
import { isLegendRuleExempt } from '../src/state/modules/legendRuleExemptions.js';
import { collectAttackYouMaxAttackersForDefender } from '../src/state/modules/staticEffectSpecAttackYouTax.js';
import { getBatch25BlockRestrictionReason } from '../src/socket/combat-handlers/combatBatch25BlockRestrictions.js';
import { oracleGrantsAuraControl } from '../src/state/modules/staticEffectSpecAuraControl.js';

const P = (name: string, oracle: string, type = 'Creature', extra: Record<string, unknown> = {}, cardExtra: Record<string, unknown> = {}) => ({
  id: 'src', controller: 'p1', owner: 'p1', tapped: false,
  ...extra,
  card: { name, oracle_text: oracle, type_line: type, power: '2', toughness: '2', ...cardExtra },
}) as any;

describe('batch78 statics', () => {
  it('Hexgold equipped anthem + Bloodfire + Leapfrog + Swimmer', () => {
    const hex = P('Hexgold Hoverwings', 'Creatures you control that are equipped get +1/+0.', 'Artifact — Equipment');
    const bear = {
      id: 'b', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    const sword = {
      id: 'eq', controller: 'p1', attachedTo: 'b',
      card: { name: 'Sword', type_line: 'Artifact — Equipment' },
    };
    const hState: any = { battlefield: [hex, bear, sword], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(hState);
    expect(getCurrentPowerToughness(bear as any, hState)?.power).toBeGreaterThanOrEqual(3);

    const blood = P(
      'Bloodfire Enforcers',
      'This creature has first strike and trample as long as an instant card and a sorcery card are in your graveyard.',
    );
    const bState: any = {
      battlefield: [blood],
      players: [{ id: 'p1' }],
      zones: { p1: { graveyard: [{ type_line: 'Instant' }, { type_line: 'Sorcery' }] } },
    };
    syncDerivedContinuousEffects(bState);
    expect(getContinuousGrantedAbilitiesForPermanent(blood as any, bState)).toEqual(
      expect.arrayContaining(['first strike', 'trample']),
    );

    const frog = P(
      'Leapfrog',
      "This creature has flying as long as you've cast an instant or sorcery spell this turn.",
    );
    const fState: any = {
      battlefield: [frog],
      players: [{ id: 'p1' }],
      spellsCastThisTurn: [{ casterId: 'p1', type_line: 'Instant' }],
    };
    syncDerivedContinuousEffects(fState);
    expect(getContinuousGrantedAbilitiesForPermanent(frog as any, fState)).toContain('flying');

    const swim = P(
      'Swimmer in Nightmares',
      'This creature gets +3/+0 as long as there are ten or more cards in a single graveyard.',
      'Creature — Nightmare Merfolk',
      {},
      { power: '1', toughness: '4' },
    );
    const gy = Array.from({ length: 10 }, (_, i) => ({ name: `C${i}`, type_line: 'Instant' }));
    const sState: any = {
      battlefield: [swim],
      players: [{ id: 'p1' }, { id: 'p2' }],
      zones: { p2: { graveyard: gy } },
    };
    syncDerivedContinuousEffects(sState);
    expect(getCurrentPowerToughness(swim as any, sState)?.power).toBe(4);
  });

  it('Warden off-turn animate + Arcus outlast + Fire Nation lesson', () => {
    const warden = P(
      'Warden of the Wall',
      'During turns other than yours, this artifact is a 2/3 Gargoyle artifact creature with flying.',
      'Artifact',
    );
    const wState: any = { battlefield: [warden], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p2' };
    syncDerivedContinuousEffects(wState);
    expect(getCurrentPowerToughness(warden as any, wState)?.power).toBe(2);
    expect(getContinuousGrantedAbilitiesForPermanent(warden as any, wState)).toContain('flying');

    const arcus = P(
      'Arcus Acolyte',
      'Each other creature you control without a +1/+1 counter on it has outlast {G/W}.',
    );
    const other = {
      id: 'o', controller: 'p1', counters: {},
      card: { name: 'Soldier', type_line: 'Creature — Soldier', power: '1', toughness: '1' },
    };
    const aState: any = { battlefield: [arcus, other], players: [{ id: 'p1' }] };
    syncDerivedContinuousEffects(aState);
    expect(getContinuousGrantedAbilitiesForPermanent(other as any, aState).some(
      (a) => /outlast/.test(String(a)),
    )).toBe(true);

    const cadets = P(
      'Fire Nation Cadets',
      "This creature has firebending 2 as long as there's a Lesson card in your graveyard.",
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(cadets).some(
      (s) => (s.grant.abilities || []).includes('firebending 2'),
    )).toBe(true);
  });

  it('Mirri tapped cap + Steal Enchantment + Prowler + Brothers legend + classifiers', () => {
    const mirri = P(
      'Mirri, Weatherlight Duelist',
      'As long as Mirri is tapped, no more than one creature can attack you each combat.',
      'Legendary Creature — Cat Warrior',
      { tapped: true },
    );
    expect(parseStaticEffectSpecsFromOraclePermanent(mirri).some(
      (s) => Number((s.grant as any).attackYouMaxAttackers) === 1
        && s.condition?.kind === 'source_is_tapped',
    )).toBe(true);
    const mState: any = { battlefield: [mirri], players: [{ id: 'p1' }] };
    expect(collectAttackYouMaxAttackersForDefender(mState, 'p1').max).toBe(1);

    expect(oracleGrantsAuraControl('You control enchanted enchantment.')).toBe(true);

    const host = {
      id: 'host', controller: 'p1',
      card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      grantedAbilities: ["can't be blocked except by Walls"],
    };
    expect(getBatch25BlockRestrictionReason(
      host,
      { card: { type_line: 'Creature — Bear' } },
      [host],
      ["can't be blocked except by Walls"],
      () => false,
    )).toMatch(/Wall/i);
    expect(getBatch25BlockRestrictionReason(
      host,
      { card: { type_line: 'Creature — Wall' } },
      [host],
      ["can't be blocked except by Walls"],
      () => false,
    )).toBeNull();

    const a = { id: 'a', card: { name: 'Brothers Yamazaki', type_line: 'Legendary Creature — Human Samurai', oracle_text: 'If there are exactly two permanents named Brothers Yamazaki on the battlefield, the "legend rule" doesn\'t apply to them.' } };
    const b = { id: 'b', card: { name: 'Brothers Yamazaki', type_line: 'Legendary Creature — Human Samurai', oracle_text: a.card.oracle_text } };
    expect(isLegendRuleExempt(a, [a, b])).toBe(true);
    expect(isLegendRuleExempt(a, [a])).toBe(false);

    expect(classifyStaticCensusLine(
      'Creatures you control that are equipped get +1/+0.',
      'Hexgold Hoverwings',
    )?.system).toMatch(/equipped|batch78/i);
    expect(classifyStaticCensusLine(
      'Each player may play an additional land during each of their turns.',
      'Storm Cauldron',
    )?.system).toMatch(/land|batch78/i);
    expect(classifyStaticCensusLine(
      'You control enchanted enchantment.',
      'Steal Enchantment',
    )?.system).toMatch(/enchantment|auraControl|batch78/i);
  });
});
