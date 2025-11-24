/**
 * Tests for Part 6 keyword abilities (Rules 702.93-702.111) - Batch 1
 * Covers: Undying, Miracle, Soulbond, Overload, Scavenge, Unleash, Cipher
 */

import { describe, it, expect } from 'vitest';
import {
  undying,
  returnWithCounter,
  hasUndying,
} from '../src/keywordAbilities/undying';
import {
  miracle,
  markAsFirstCardDrawn,
  payMiracleCost,
  canUseMiracle,
} from '../src/keywordAbilities/miracle';
import {
  soulbond,
  pairCreatures,
  unpairCreatures,
  canPair,
} from '../src/keywordAbilities/soulbond';
import {
  overload,
  payOverloadCost,
  isOverloaded,
} from '../src/keywordAbilities/overload';
import {
  scavenge,
  activateScavenge,
  getScavengeCounters,
} from '../src/keywordAbilities/scavenge';
import {
  unleash,
  chooseToUnleash,
  isUnleashed,
  canBlock,
} from '../src/keywordAbilities/unleash';
import {
  cipher,
  encodeOnCreature,
  triggerCipher,
  isEncoded,
} from '../src/keywordAbilities/cipher';

describe('Undying (702.93)', () => {
  it('should create undying ability', () => {
    const ability = undying('Strangleroot Geist');
    expect(ability.type).toBe('undying');
    expect(ability.source).toBe('Strangleroot Geist');
    expect(ability.hasReturned).toBe(false);
  });

  it('should return creature with +1/+1 counter', () => {
    const ability = undying('Young Wolf');
    const returned = returnWithCounter(ability);
    expect(returned.hasReturned).toBe(true);
  });

  it('should prevent returning if already used', () => {
    const ability = undying('Vorapede');
    const returned = returnWithCounter(ability);
    expect(() => returnWithCounter(returned)).toThrow();
  });

  it('should check if creature has undying', () => {
    const ability = undying('Flayer of the Hatebound');
    expect(hasUndying(ability)).toBe(true);
  });
});

describe('Miracle (702.94)', () => {
  it('should create miracle ability', () => {
    const ability = miracle('Temporal Mastery', '{1}{U}');
    expect(ability.type).toBe('miracle');
    expect(ability.source).toBe('Temporal Mastery');
    expect(ability.miracleCost).toBe('{1}{U}');
    expect(ability.canPayMiracle).toBe(false);
  });

  it('should enable miracle when first card drawn', () => {
    const ability = miracle('Bonfire of the Damned', '{X}{R}');
    const enabled = markAsFirstCardDrawn(ability);
    expect(enabled.wasFirstCardDrawn).toBe(true);
    expect(enabled.canPayMiracle).toBe(true);
  });

  it('should pay miracle cost', () => {
    let ability = miracle('Terminus', '{W}');
    ability = markAsFirstCardDrawn(ability);
    const paid = payMiracleCost(ability);
    expect(paid.canPayMiracle).toBe(false);
  });

  it('should not allow paying miracle if not first card drawn', () => {
    const ability = miracle('Entreat the Angels', '{X}{X}{W}{W}{W}');
    expect(() => payMiracleCost(ability)).toThrow();
  });

  it('should check if miracle can be used', () => {
    let ability = miracle('Thunderous Wrath', '{R}');
    expect(canUseMiracle(ability)).toBe(false);
    ability = markAsFirstCardDrawn(ability);
    expect(canUseMiracle(ability)).toBe(true);
  });
});

describe('Soulbond (702.95)', () => {
  it('should create soulbond ability', () => {
    const ability = soulbond('Silverblade Paladin');
    expect(ability.type).toBe('soulbond');
    expect(ability.source).toBe('Silverblade Paladin');
    expect(ability.isPaired).toBe(false);
  });

  it('should pair creatures', () => {
    const ability = soulbond('Wolfir Silverheart');
    const paired = pairCreatures(ability, 'Another Creature');
    expect(paired.isPaired).toBe(true);
    expect(paired.pairedWith).toBe('Another Creature');
  });

  it('should not allow pairing if already paired', () => {
    let ability = soulbond('Deadeye Navigator');
    ability = pairCreatures(ability, 'Cloud of Faeries');
    expect(() => pairCreatures(ability, 'Another Creature')).toThrow();
  });

  it('should unpair creatures', () => {
    let ability = soulbond('Trusted Forcemage');
    ability = pairCreatures(ability, 'Target Creature');
    const unpaired = unpairCreatures(ability);
    expect(unpaired.isPaired).toBe(false);
    expect(unpaired.pairedWith).toBeUndefined();
  });

  it('should check if can pair', () => {
    let ability = soulbond('Nightshade Peddler');
    expect(canPair(ability)).toBe(true);
    ability = pairCreatures(ability, 'Another Creature');
    expect(canPair(ability)).toBe(false);
  });
});

describe('Overload (702.96)', () => {
  it('should create overload ability', () => {
    const ability = overload('Cyclonic Rift', '{6}{U}');
    expect(ability.type).toBe('overload');
    expect(ability.source).toBe('Cyclonic Rift');
    expect(ability.overloadCost).toBe('{6}{U}');
    expect(ability.wasOverloaded).toBe(false);
  });

  it('should pay overload cost', () => {
    const ability = overload('Mizzium Mortars', '{3}{R}{R}');
    const overloaded = payOverloadCost(ability);
    expect(overloaded.wasOverloaded).toBe(true);
  });

  it('should check if spell was overloaded', () => {
    let ability = overload('Vandalblast', '{3}{R}');
    expect(isOverloaded(ability)).toBe(false);
    ability = payOverloadCost(ability);
    expect(isOverloaded(ability)).toBe(true);
  });
});

describe('Scavenge (702.97)', () => {
  it('should create scavenge ability', () => {
    const ability = scavenge('Deadbridge Goliath', '{4}{G}{G}', [5, 4]);
    expect(ability.type).toBe('scavenge');
    expect(ability.source).toBe('Deadbridge Goliath');
    expect(ability.scavengeCost).toBe('{4}{G}{G}');
    expect(ability.powerToughness).toEqual([5, 4]);
    expect(ability.wasScavenged).toBe(false);
  });

  it('should activate scavenge', () => {
    const ability = scavenge('Varolz, the Scar-Striped', '{1}{B}{G}', [2, 2]);
    const scavenged = activateScavenge(ability, 'Target Creature');
    expect(scavenged.wasScavenged).toBe(true);
  });

  it('should not allow scavenging twice', () => {
    let ability = scavenge('Dreg Mangler', '{1}{B}{G}', [3, 3]);
    ability = activateScavenge(ability, 'Target Creature');
    expect(() => activateScavenge(ability, 'Another Target')).toThrow();
  });

  it('should get correct number of counters', () => {
    const ability = scavenge('Sluiceway Scorpion', '{2}{B}{G}', [2, 2]);
    expect(getScavengeCounters(ability)).toBe(2);
  });

  it('should use power for counter count', () => {
    const ability = scavenge('Jarad, Golgari Lich Lord', '{B}{B}{G}{G}', [2, 2]);
    expect(getScavengeCounters(ability)).toBe(2);
  });
});

describe('Unleash (702.98)', () => {
  it('should create unleash ability', () => {
    const ability = unleash('Rakdos Cackler');
    expect(ability.type).toBe('unleash');
    expect(ability.source).toBe('Rakdos Cackler');
    expect(ability.wasUnleashed).toBe(false);
  });

  it('should unleash creature', () => {
    const ability = unleash('Gore-House Chainwalker');
    const unleashed = chooseToUnleash(ability);
    expect(unleashed.wasUnleashed).toBe(true);
  });

  it('should check if unleashed', () => {
    let ability = unleash('Thrill-Kill Assassin');
    expect(isUnleashed(ability)).toBe(false);
    ability = chooseToUnleash(ability);
    expect(isUnleashed(ability)).toBe(true);
  });

  it('should prevent blocking if unleashed', () => {
    let ability = unleash('Spawn of Rix Maadi');
    expect(canBlock(ability)).toBe(true);
    ability = chooseToUnleash(ability);
    expect(canBlock(ability)).toBe(false);
  });

  it('should allow blocking if not unleashed', () => {
    const ability = unleash('Exava, Rakdos Blood Witch');
    expect(canBlock(ability)).toBe(true);
  });
});

describe('Cipher (702.99)', () => {
  it('should create cipher ability', () => {
    const ability = cipher('Hands of Binding');
    expect(ability.type).toBe('cipher');
    expect(ability.source).toBe('Hands of Binding');
    expect(ability.isEncoded).toBe(false);
  });

  it('should encode on creature', () => {
    const ability = cipher('Stolen Identity');
    const encoded = encodeOnCreature(ability, 'Invisible Stalker');
    expect(encoded.isEncoded).toBe(true);
    expect(encoded.encodedOn).toBe('Invisible Stalker');
  });

  it('should trigger cipher', () => {
    let ability = cipher('Call of the Nightwing');
    ability = encodeOnCreature(ability, 'Flying Creature');
    const triggered = triggerCipher(ability);
    expect(triggered).toBeDefined();
  });

  it('should not trigger if not encoded', () => {
    const ability = cipher('Whispering Madness');
    expect(() => triggerCipher(ability)).toThrow();
  });

  it('should check if encoded', () => {
    let ability = cipher('Last Thoughts');
    expect(isEncoded(ability)).toBe(false);
    ability = encodeOnCreature(ability, 'Unblockable Creature');
    expect(isEncoded(ability)).toBe(true);
  });
});
