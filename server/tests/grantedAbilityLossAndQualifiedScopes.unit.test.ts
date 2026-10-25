import { describe, it, expect } from 'vitest';
import { parseStaticEffectSpecsFromOraclePermanent } from '../src/state/modules/staticEffectSpecOracleParsing';
import { getContinuousGrantedAbilitiesForPermanent } from '../src/state/modules/staticEffectSpec';
import { listGrantedActivatedAbilityLinesForPermanent } from '../src/state/modules/grantedActivatedAbilityResolution';
import { collectBattlefieldAbilityBadgesForView } from '../src/state/modules/battlefieldAbilityBadges';
import { mergeDetectorOracleWithContinuousGrants } from '../src/state/modules/triggers/detectorGrantedOracle';
import { TIMESTAMP_BASE } from '../../rules-engine/src/permanentTimestamps';
import { permanentLosesAllAbilities, permanentLosesKeyword } from '../../rules-engine/src/permanentKeywordAbilities';

const T = TIMESTAMP_BASE + 1000;
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text = '', ts?: number, extra: any = {}) =>
  ({ id, controller, owner: controller, counters: {}, timestamp: ts === undefined ? undefined : T + ts, ...extra, card: { id, name, type_line, oracle_text, power: '2', toughness: '2' } }) as any;
const humility = (id: string, ts: number) => perm(id, 'p2', 'Humility', 'Enchantment', 'All creatures lose all abilities and have base power and toughness 1/1.', ts);
const tapper = (ts: number) => perm('lord', 'p1', 'Tapper Lord', 'Enchantment', 'Creatures you control have "{T}: Tap target creature."', ts);
const bear = (extra: any = {}) => perm('bear', 'p1', 'Bear', 'Creature \u2014 Bear', '', 3, extra);
const TAP = '{t}: tap target creature.';

describe('round 4: Cryptolith Rite dedupe', () => {
  it('one any-color line for token + quoted text', () => {
    const rite = perm('cr', 'p1', 'Cryptolith Rite', 'Enchantment', 'Creatures you control have "{T}: Add one mana of any color."', 1);
    const b = bear();
    const lines = listGrantedActivatedAbilityLinesForPermanent(b, { battlefield: [rite, b] });
    expect(lines.filter((l) => /any color/i.test(l))).toHaveLength(1);
  });
});

describe('round 4: persisted grants obey ability loss timestamps', () => {
  const persisted = (grantTs: number) => bear({ grantedAbilities: ['Whenever this creature attacks, draw a card.', 'flying'], abilityGrantTimestamps: { 'whenever this creature attacks, draw a card.': T + grantTs } });
  it('Humility newer than the grant removes the quoted grant but not the keyword entry', () => {
    const b = persisted(4);
    const badges = collectBattlefieldAbilityBadgesForView(b, [], [b, humility('h', 9)]);
    expect(badges).not.toContain('whenever this creature attacks, draw a card.');
    expect(badges).toContain('flying');
    expect(mergeDetectorOracleWithContinuousGrants('', b, { battlefield: [b, humility('h', 9)] }).oracleText).not.toMatch(/draw a card/i);
  });
  it('grant newer than Humility survives', () => {
    const b = persisted(12);
    expect(collectBattlefieldAbilityBadgesForView(b, [], [b, humility('h', 9)])).toContain('whenever this creature attacks, draw a card.');
    expect(mergeDetectorOracleWithContinuousGrants('', b, { battlefield: [b, humility('h', 9)] }).oracleText).toMatch(/draw a card/i);
  });
  it('without a battlefield the badges are unchanged', () => {
    expect(collectBattlefieldAbilityBadgesForView(persisted(4), [])).toContain('whenever this creature attacks, draw a card.');
  });
});

describe('round 4: several lose-all-abilities effects', () => {
  it('grant between two loss effects is removed', () => {
    const b = bear();
    expect(getContinuousGrantedAbilitiesForPermanent(b, { battlefield: [humility('h1', 1), tapper(5), b, humility('h2', 9)] } as any)).not.toContain(TAP);
  });
  it('grant after both loss effects survives', () => {
    const b = bear();
    expect(getContinuousGrantedAbilitiesForPermanent(b, { battlefield: [humility('h1', 1), humility('h2', 2), tapper(5), b] } as any)).toContain(TAP);
  });
  it('an effect that removes and grants keeps its own grant (Imprisoned in the Moon)', () => {
    const MOON = 'Enchant creature, land, or planeswalker\nEnchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.';
    const b = bear({ card: { id: 'bear', name: 'Bear', type_line: 'Creature \u2014 Bear', oracle_text: 'Flying', power: '2', toughness: '2' } });
    const src = perm('moon', 'p1', 'Imprisoned in the Moon', 'Enchantment \u2014 Aura', MOON, 5, { attachedTo: 'bear' });
    b.attachments = ['moon'];
    const specs = parseStaticEffectSpecsFromOraclePermanent(src) as any[];
    expect(specs.some((s) => s.sourcePermanentId === 'bear' && s.effectSourcePermanentId === 'moon' && s.grant.abilities?.includes('{t}: add {c}'))).toBe(true);
    expect(permanentLosesAllAbilities(b, [b, src])).toBe(true);
    expect(permanentLosesKeyword(b, 'flying', [b, src])).toBe(true);
    expect(getContinuousGrantedAbilitiesForPermanent(b, { battlefield: [src, b] } as any)).toContain('{t}: add {c}');
    expect(getContinuousGrantedAbilitiesForPermanent(b, { battlefield: [src, b, humility('h', 9)] } as any)).not.toContain('{t}: add {c}');
  });
});

describe('round 4: qualified scope census families', () => {
  const specOf = (o: string, t = 'Enchantment') => parseStaticEffectSpecsFromOraclePermanent(perm('s', 'p1', 'Src', t, o, 1)) as any[];
  it('parses sliver, token, flying and +1/+1-counter groups', () => {
    expect(specOf('All Sliver creatures get +1/+0.', 'Creature \u2014 Sliver').some((s) => s.scope.kind === 'all_creatures_of_type' && s.scope.creatureType === 'sliver' && s.grant.power === 1)).toBe(true);
    expect(specOf('Creature tokens get -1/-1.').some((s) => s.scope.kind === 'all_creatures' && s.scope.qualifier?.token === true && s.grant.toughness === -1)).toBe(true);
    expect(specOf('Creatures with flying get -1/-0.').some((s) => s.condition?.kind === 'target_has_keyword' && s.condition.keyword === 'flying' && !s.scope.qualifier && s.grant.power === -1)).toBe(true);
    expect(specOf('Each creature you control with a +1/+1 counter on it has trample.', 'Creature \u2014 Elf').some((s) => s.scope.qualifier?.counter === '+1/+1' && s.grant.abilities?.includes('trample'))).toBe(true);
    expect(specOf('Creatures you control get +1/+1 until end of turn.').some((s) => s.scope.qualifier)).toBe(false);
  });
  it('applies qualifiers to recipients', () => {
    const z = perm('z', 'p1', 'Zegana', 'Creature \u2014 Merfolk', 'Each creature you control with a +1/+1 counter on it has trample.', 1);
    const withCounter = perm('a', 'p1', 'A', 'Creature \u2014 Bear', '', 2, { counters: { '+1/+1': 1 } });
    const without = perm('b', 'p1', 'B', 'Creature \u2014 Bear', '', 2);
    const state = { battlefield: [z, withCounter, without] } as any;
    expect(getContinuousGrantedAbilitiesForPermanent(withCounter, state)).toContain('trample');
    expect(getContinuousGrantedAbilitiesForPermanent(without, state)).not.toContain('trample');
    const lute = perm('t', 'p1', 'Haste Totem', 'Enchantment', 'Creature tokens have haste.', 1);
    const token = perm('tok', 'p1', 'Soldier', 'Creature \u2014 Soldier', '', 2, { isToken: true });
    const s2 = { battlefield: [lute, token, without] } as any;
    expect(getContinuousGrantedAbilitiesForPermanent(token, s2)).toContain('haste');
    expect(getContinuousGrantedAbilitiesForPermanent(without, s2)).not.toContain('haste');
  });
});
