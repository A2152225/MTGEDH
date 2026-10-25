import { describe, expect, it } from 'vitest';
import { getQualifierBlockRestrictionReason, parseQualifierBlockRestrictions } from '../src/socket/combat-handlers/combatQualifierBlockRestriction.js';
import { findBlockerCapacityViolation, getServerBlockerCapacity } from '../src/socket/combat-handlers/combatBlockerCapacity.js';

const atk = (name: string, oracle: string) => ({ id: 'a', card: { name, oracle_text: oracle } });
const blk = (type_line: string, extra: any = {}) => ({ id: 'b', card: { name: 'B', type_line, oracle_text: extra.oracle || '' }, ...extra });

describe('qualifier block restrictions', () => {
  it('power N or greater', () => {
    const a = atk('Bully Target', 'Bully Target can\u2019t be blocked by creatures with power 2 or greater.');
    expect(getQualifierBlockRestrictionReason(a, blk('Creature'), [], { blockerPower: 3, blockerToughness: 3 })).toBeTruthy();
    expect(getQualifierBlockRestrictionReason(a, blk('Creature'), [], { blockerPower: 1, blockerToughness: 3 })).toBeNull();
  });
  it('artifact creatures and Walls', () => {
    const a = atk('X', "X can't be blocked by artifact creatures.");
    expect(getQualifierBlockRestrictionReason(a, blk('Artifact Creature \u2014 Golem'), [], { blockerPower: 1, blockerToughness: 1 })).toBeTruthy();
    expect(getQualifierBlockRestrictionReason(a, blk('Creature \u2014 Elf'), [], { blockerPower: 1, blockerToughness: 1 })).toBeNull();
    const w = atk('Y', "Y can't be blocked by Walls.");
    expect(getQualifierBlockRestrictionReason(w, blk('Creature \u2014 Wall'), [], { blockerPower: 0, blockerToughness: 4 })).toBeTruthy();
    expect(getQualifierBlockRestrictionReason(w, blk('Creature \u2014 Elf'), [], { blockerPower: 0, blockerToughness: 4 })).toBeNull();
  });
  it('ignores team-wide and "more than one" wording', () => {
    expect(parseQualifierBlockRestrictions(["Creatures you control can't be blocked by Walls."])).toHaveLength(0);
    expect(parseQualifierBlockRestrictions(["~ can't be blocked by more than one creature."])).toHaveLength(0);
  });
});

describe('blocker capacity', () => {
  it('computes capacity and flags violations', () => {
    expect(getServerBlockerCapacity({ card: { oracle_text: 'Flying' } })).toBe(1);
    expect(getServerBlockerCapacity({ card: { oracle_text: 'This creature can block an additional creature each combat.' } })).toBe(2);
    expect(getServerBlockerCapacity({ card: { oracle_text: 'can block any number of creatures.' } })).toBe(Infinity);
    const bf = [{ id: 'b1', card: { name: 'Plain', oracle_text: '' } }, { id: 'b2', card: { name: 'Two', oracle_text: 'can block an additional creature each combat.' } }];
    expect(findBlockerCapacityViolation(bf, [{ blockerId: 'b2', attackerId: 'x' }, { blockerId: 'b2', attackerId: 'y' }])).toBeNull();
    expect(findBlockerCapacityViolation(bf, [{ blockerId: 'b1', attackerId: 'x' }, { blockerId: 'b1', attackerId: 'y' }])?.blockerId).toBe('b1');
  });
});
