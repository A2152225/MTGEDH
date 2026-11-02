import { describe, it, expect } from 'vitest';
import { isSpellCastingProhibitedByStaticRestriction } from '../src/state/modules/staticCastingRestrictions.js';
import { untapPermanentsForPlayer } from '../src/state/modules/turn-handlers/turnUntapPermanents.js';
import { getQualifierBlockRestrictionReason } from '../src/socket/combat-handlers/combatQualifierBlockRestriction.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

const perm = (id: string, controller: string, name: string, oracle: string, type = 'Enchantment', extra: any = {}) => ({
  id, controller, owner: controller, card: { id: id + 'c', name, oracle_text: oracle, type_line: type, ...extra.card }, ...extra.perm,
});
const players = [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }];

describe('batch 35 statics', () => {
  it("you can't cast creature spells blocks only creature spells", () => {
    const state: any = { players, battlefield: [perm('s', 'p1', 'Steel Golem', "You can't cast creature spells.", 'Artifact Creature \u2014 Golem')] };
    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p1', { name: 'Bear', type_line: 'Creature \u2014 Bear' }).prohibited).toBe(true);
    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p1', { name: 'Bolt', type_line: 'Instant' }).prohibited).toBe(false);
    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p2', { name: 'Bear', type_line: 'Creature \u2014 Bear' }).prohibited).toBe(false);
  });
  it('creatures with flying stay tapped under Blizzard; others untap', () => {
    const bird = perm('b', 'p1', 'Bird', 'Flying', 'Creature \u2014 Bird', { card: { power: '1', toughness: '1' }, perm: { tapped: true } });
    const bear = perm('r', 'p1', 'Bear', '', 'Creature \u2014 Bear', { card: { power: '2', toughness: '2' }, perm: { tapped: true } });
    const state: any = { players, battlefield: [perm('z', 'p2', 'Blizzard', "Cumulative upkeep {2}\nCreatures with flying don't untap during their controllers' untap steps.", 'Snow Enchantment'), bird, bear] };
    untapPermanentsForPlayer({ state } as any, 'p1');
    expect(bird.tapped).toBe(true);
    expect(bear.tapped).toBe(false);
  });
  it('creatures with power 3 or greater stay tapped under Meekstone', () => {
    const big = perm('g', 'p1', 'Giant', '', 'Creature \u2014 Giant', { card: { power: '4', toughness: '4' }, perm: { tapped: true } });
    const small = perm('s', 'p1', 'Elf', '', 'Creature \u2014 Elf', { card: { power: '1', toughness: '1' }, perm: { tapped: true } });
    const state: any = { players, battlefield: [perm('m', 'p2', 'Meekstone', "Creatures with power 3 or greater don't untap during their controllers' untap steps.", 'Artifact'), big, small] };
    untapPermanentsForPlayer({ state } as any, 'p1');
    expect(big.tapped).toBe(true);
    expect(small.tapped).toBe(false);
  });
  it("can't be blocked by creatures with horsemanship parses as keyword evasion", () => {
    const zuo = { id: 'z', controller: 'p1', card: { name: 'Zuo Ci, the Mocking Sage', oracle_text: "Horsemanship\nZuo Ci, the Mocking Sage can't be blocked by creatures with horsemanship." } };
    const rider = { id: 'h', controller: 'p2', card: { name: 'Rider', oracle_text: 'Horsemanship', keywords: ['Horsemanship'] } };
    const bear = { id: 'b', controller: 'p2', card: { name: 'Bear', oracle_text: '' } };
    const stats = { blockerPower: 2, blockerToughness: 2 };
    expect(getQualifierBlockRestrictionReason(zuo, rider, [], stats)).toBeTruthy();
    expect(getQualifierBlockRestrictionReason(zuo, bear, [], stats)).toBeFalsy();
  });
  it('equip pay life lines are classified', () => {
    expect(classifyStaticCensusLine('Equip\u2014Pay 3 life.', 'Nightmare Lash')?.system).toMatch(/equipNonManaCosts/);
  });
});
