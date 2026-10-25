import { describe, expect, it } from 'vitest';
import { permanentHasKeywordAbility } from '../../rules-engine/src/permanentKeywordAbilities.js';
import { findMaximumBlockersViolation } from '../src/socket/combat-handlers/combatBatch30BlockLimits.js';
import { graveyardCountAttackRestrictionReason } from '../src/socket/combat-handlers/combatBatch30AttackRestrictions.js';
import { getOwnerAttackRestrictionReason } from '../src/socket/combat-handlers/combatDeclareAttackersSupport.js';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { isCastingLimitedToSorceryTiming } from '../src/state/modules/opponentSorceryTimingLock.js';
import { computeEffectiveLandTypeLine } from '../src/state/modules/viewPermanentCharacteristics.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1', extra: any = {}): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, keywords: extra.keywords || [] } };
}

describe('batch30 maximum blockers', () => {
  const b1 = perm('b1', 'Bear', 'Creature', '', 'p2');
  const b2 = perm('b2', 'Wolf', 'Creature', '', 'p2');
  const two = [{ attackerId: 'a', blockerId: 'b1' }, { attackerId: 'a', blockerId: 'b2' }];
  it('self cap (Charging Rhino)', () => {
    const a = perm('a', 'Charging Rhino', 'Creature', "Charging Rhino can't be blocked by more than one creature.");
    expect(findMaximumBlockersViolation([a, b1, b2], two)?.max).toBe(1);
    expect(findMaximumBlockersViolation([a, b1, b2], two.slice(0, 1))).toBeNull();
  });
  it('team cap (Familiar Ground) applies only to its controller', () => {
    const fg = perm('fg', 'Familiar Ground', 'Enchantment', "Each creature you control can't be blocked by more than one creature.");
    const a = perm('a', 'Grizzly', 'Creature', '');
    expect(findMaximumBlockersViolation([fg, a, b1, b2], two)).not.toBeNull();
    const theirs = perm('a', 'Grizzly', 'Creature', '', 'p3');
    expect(findMaximumBlockersViolation([fg, theirs, b1, b2], two)).toBeNull();
  });
});

describe('batch30 graveyard-count attack restriction', () => {
  const dst = perm('d', 'Deep-Sea Terror', 'Creature', "Deep-Sea Terror can't attack unless there are seven or more cards in your graveyard.");
  it('blocks with six, allows with seven', () => {
    const st = (n: number): any => ({ zones: { p1: { graveyard: Array.from({ length: n }, (_, i) => ({ id: 'g' + i })) } } });
    expect(graveyardCountAttackRestrictionReason(dst, st(6))).toMatch(/seven or more/);
    expect(graveyardCountAttackRestrictionReason(dst, st(7))).toBeNull();
    expect(getOwnerAttackRestrictionReason(dst, 'p2', { battlefield: [dst], gameState: st(6) })).toMatch(/graveyard/);
  });
});

describe('batch30 attached block-only-flying', () => {
  const blocker = perm('b', 'Bear', 'Creature', '', 'p2');
  const aura = perm('ab', 'Air Bladder', 'Enchantment', 'Enchant creature\nEnchanted creature has flying.\nEnchanted creature can block only creatures with flying.', 'p2', { attachedTo: 'b' });
  it('can block a flier but not a ground creature', () => {
    const ground = perm('g', 'Grizzly', 'Creature', '');
    const flier = perm('f', 'Bird', 'Creature', 'Flying', 'p1', { keywords: ['Flying'] });
    const bf = [blocker, aura, ground, flier];
    expect(canBlockAttacker(blocker, ground, bf, 'p2', { battlefield: bf }).canBlock).toBe(false);
    expect(canBlockAttacker(blocker, flier, bf, 'p2', { battlefield: bf }).canBlock).toBe(true);
  });
});

describe('batch30 Teferi sorcery-timing lock', () => {
  const teferi = perm('t', 'Teferi, Time Raveler', 'Legendary Planeswalker', 'Each opponent can cast spells only any time they could cast a sorcery.', 'p1');
  it('locks opponents, not the controller', () => {
    expect(isCastingLimitedToSorceryTiming({ battlefield: [teferi] }, 'p2')).toBe(true);
    expect(isCastingLimitedToSorceryTiming({ battlefield: [teferi] }, 'p1')).toBe(false);
  });
});

describe('batch30 verified existing statics', () => {
  it('equipped creature loses flying (Colossus Hammer)', () => {
    const c = perm('c', 'Bird', 'Creature', 'Flying', 'p1', { keywords: ['Flying'], attachments: ['h'] });
    const h = perm('h', 'Colossus Hammer', 'Artifact', 'Equipped creature gets +10/+10 and loses flying.\nEquip {8}', 'p1', { attachedTo: 'c' });
    expect(permanentHasKeywordAbility(c, 'flying', [c, h])).toBe(false);
  });
  it('enchanted land is an island (Spreading Seas)', () => {
    const land = perm('l', 'Mountain', 'Basic Land', '{T}: Add {R}.', 'p2', { attachments: ['s'] });
    const seas = perm('s', 'Spreading Seas', 'Enchantment', 'Enchant land\nWhen Spreading Seas enters, draw a card.\nEnchanted land is an Island.', 'p1', { attachedTo: 'l' });
    expect(String(computeEffectiveLandTypeLine(land, { battlefield: [land, seas] }) || '')).toMatch(/Island/);
  });
});
