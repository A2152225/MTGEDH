/**
 * Tests for Keyword Abilities Part 3 (Rules 702.38-702.55)
 * 
 * Tests for advanced keyword abilities from the MTG Comprehensive Rules
 */

import { describe, it, expect } from 'vitest';
import {
  // Amplify
  amplify,
  resolveAmplify,
  getAmplifyCounters,
  canRevealForAmplify,
  isAmplifyRedundant,
  // Provoke
  provoke,
  triggerProvoke,
  mustBlockIfAble,
  isProvokeRedundant,
  // Storm
  storm,
  triggerStorm,
  getStormCopies,
  isStormRedundant,
  // Affinity
  affinity,
  calculateAffinityReduction,
  getAffinityReduction,
  isAffinityRedundant,
  // Entwine
  entwine,
  payEntwine,
  wasEntwined,
  // Modular
  modular,
  triggerModular,
  getModularCounters,
  isModularRedundant,
  // Sunburst
  sunburst,
  resolveSunburst,
  isSunburstRedundant,
  // Bushido
  bushido,
  triggerBushido,
  getBushidoBonus,
  isBushidoRedundant,
  // Soulshift
  soulshift,
  triggerSoulshift,
  canReturnWithSoulshift,
  isSoulshiftRedundant,
  // Splice
  splice,
  paySplice,
  wasSpliced,
  // Offering
  offering,
  payOffering,
  getOfferingReduction,
  // Ninjutsu
  ninjutsu,
  activateNinjutsu,
  canActivateNinjutsu,
  // Epic
  epic,
  resolveEpic,
  createEpicCopy,
  // Convoke
  convoke,
  payConvoke,
  getConvokeReduction,
  // Dredge
  dredge,
  useDredge,
  canDredge,
  // Transmute
  transmute,
  activateTransmute,
  canTransmute,
  // Bloodthirst
  bloodthirst,
  resolveBloodthirst,
  isBloodthirstRedundant,
  // Haunt
  haunt,
  hauntCard,
  triggerHauntLeave,
} from '../src/keywordAbilities';

describe('Amplify (Rule 702.38)', () => {
  it('should create amplify ability', () => {
    const ability = amplify('creature-1', 2);
    expect(ability.type).toBe('amplify');
    expect(ability.value).toBe(2);
    expect(ability.source).toBe('creature-1');
  });

  it('should resolve amplify with revealed cards', () => {
    const ability = amplify('creature-1', 2);
    const resolved = resolveAmplify(ability, ['card-1', 'card-2'], ['Goblin']);
    expect(resolved.revealedCards).toHaveLength(2);
    expect(getAmplifyCounters(resolved)).toBe(4); // 2 cards * 2 value
  });

  it('should check if card can be revealed for amplify', () => {
    expect(canRevealForAmplify(['Goblin', 'Warrior'], ['Goblin'])).toBe(true);
    expect(canRevealForAmplify(['Elf'], ['Goblin'])).toBe(false);
  });

  it('should not be redundant (Rule 702.38b)', () => {
    expect(isAmplifyRedundant()).toBe(false);
  });
});

describe('Provoke (Rule 702.39)', () => {
  it('should create provoke ability', () => {
    const ability = provoke('creature-1');
    expect(ability.type).toBe('provoke');
    expect(ability.wasTriggered).toBe(false);
  });

  it('should trigger provoke on attack', () => {
    const ability = provoke('creature-1');
    const triggered = triggerProvoke(ability, 'blocker-1');
    expect(triggered.targetCreature).toBe('blocker-1');
    expect(triggered.wasTriggered).toBe(true);
  });

  it('should check if creature must block', () => {
    const ability = triggerProvoke(provoke('creature-1'), 'blocker-1');
    expect(mustBlockIfAble(ability, 'blocker-1')).toBe(true);
    expect(mustBlockIfAble(ability, 'blocker-2')).toBe(false);
  });

  it('should not be redundant (Rule 702.39b)', () => {
    expect(isProvokeRedundant()).toBe(false);
  });
});

describe('Storm (Rule 702.40)', () => {
  it('should create storm ability', () => {
    const ability = storm('spell-1');
    expect(ability.type).toBe('storm');
    expect(ability.copies).toHaveLength(0);
  });

  it('should create copies based on spells cast before', () => {
    const ability = storm('spell-1');
    const triggered = triggerStorm(ability, 3);
    expect(getStormCopies(triggered)).toBe(3);
    expect(triggered.spellsCastThisTurn).toBe(3);
  });

  it('should not create copies if no spells cast before', () => {
    const ability = storm('spell-1');
    const triggered = triggerStorm(ability, 0);
    expect(getStormCopies(triggered)).toBe(0);
  });

  it('should not be redundant (Rule 702.40b)', () => {
    expect(isStormRedundant()).toBe(false);
  });
});

describe('Affinity (Rule 702.41)', () => {
  it('should create affinity ability', () => {
    const ability = affinity('spell-1', 'artifacts');
    expect(ability.type).toBe('affinity');
    expect(ability.affinityFor).toBe('artifacts');
  });

  it('should calculate cost reduction', () => {
    const ability = affinity('spell-1', 'artifacts');
    const calculated = calculateAffinityReduction(ability, 4);
    expect(getAffinityReduction(calculated)).toBe(4);
  });

  it('should not be redundant (Rule 702.41b)', () => {
    expect(isAffinityRedundant()).toBe(false);
  });
});

describe('Entwine (Rule 702.42)', () => {
  it('should create entwine ability', () => {
    const ability = entwine('spell-1', '{2}');
    expect(ability.type).toBe('entwine');
    expect(ability.cost).toBe('{2}');
    expect(ability.wasEntwined).toBe(false);
  });

  it('should pay entwine cost', () => {
    const ability = entwine('spell-1', '{2}');
    const paid = payEntwine(ability);
    expect(wasEntwined(paid)).toBe(true);
  });
});

describe('Modular (Rule 702.43)', () => {
  it('should create modular ability', () => {
    const ability = modular('creature-1', 2);
    expect(ability.type).toBe('modular');
    expect(ability.value).toBe(2);
    expect(getModularCounters(ability)).toBe(2);
  });

  it('should trigger on death and transfer counters', () => {
    const ability = modular('creature-1', 2);
    const triggered = triggerModular(ability, 3, 'artifact-1');
    expect(triggered.triggeredOnDeath).toBe(true);
    expect(triggered.targetCreature).toBe('artifact-1');
    expect(getModularCounters(triggered)).toBe(3);
  });

  it('should not be redundant (Rule 702.43b)', () => {
    expect(isModularRedundant()).toBe(false);
  });
});

describe('Sunburst (Rule 702.44)', () => {
  it('should create sunburst ability', () => {
    const ability = sunburst('permanent-1');
    expect(ability.type).toBe('sunburst');
  });

  it('should add +1/+1 counters for creatures', () => {
    const ability = sunburst('permanent-1');
    const resolved = resolveSunburst(ability, ['W', 'U', 'B'], true);
    expect(resolved.counters).toBe(3);
    expect(resolved.counterType).toBe('+1/+1');
  });

  it('should add charge counters for non-creatures', () => {
    const ability = sunburst('permanent-1');
    const resolved = resolveSunburst(ability, ['R', 'G'], false);
    expect(resolved.counters).toBe(2);
    expect(resolved.counterType).toBe('charge');
  });

  it('should not be redundant (Rule 702.44b)', () => {
    expect(isSunburstRedundant()).toBe(false);
  });
});

describe('Bushido (Rule 702.45)', () => {
  it('should create bushido ability', () => {
    const ability = bushido('creature-1', 2);
    expect(ability.type).toBe('bushido');
    expect(ability.value).toBe(2);
  });

  it('should trigger and provide bonus', () => {
    const ability = bushido('creature-1', 2);
    const triggered = triggerBushido(ability);
    expect(getBushidoBonus(triggered)).toBe(2);
    expect(getBushidoBonus(ability)).toBe(0);
  });

  it('should not be redundant (Rule 702.45b)', () => {
    expect(isBushidoRedundant()).toBe(false);
  });
});

describe('Soulshift (Rule 702.46)', () => {
  it('should create soulshift ability', () => {
    const ability = soulshift('creature-1', 3);
    expect(ability.type).toBe('soulshift');
    expect(ability.value).toBe(3);
  });

  it('should trigger and target card', () => {
    const ability = soulshift('creature-1', 3);
    const triggered = triggerSoulshift(ability, 'card-1');
    expect(triggered.targetCard).toBe('card-1');
  });

  it('should check if card can be returned', () => {
    const ability = soulshift('creature-1', 3);
    expect(canReturnWithSoulshift(2, ability)).toBe(true);
    expect(canReturnWithSoulshift(3, ability)).toBe(true);
    expect(canReturnWithSoulshift(4, ability)).toBe(false);
  });

  it('should not be redundant (Rule 702.46b)', () => {
    expect(isSoulshiftRedundant()).toBe(false);
  });
});

describe('Splice (Rule 702.47)', () => {
  it('should create splice ability', () => {
    const ability = splice('spell-1', 'Arcane', '{2}{U}');
    expect(ability.type).toBe('splice');
    expect(ability.spliceOnto).toBe('Arcane');
  });

  it('should pay splice cost', () => {
    const ability = splice('spell-1', 'Arcane', '{2}{U}');
    const paid = paySplice(ability);
    expect(wasSpliced(paid)).toBe(true);
  });
});

describe('Offering (Rule 702.48)', () => {
  it('should create offering ability', () => {
    const ability = offering('spell-1', 'Snake');
    expect(ability.type).toBe('offering');
    expect(ability.offeringType).toBe('Snake');
  });

  it('should pay offering cost', () => {
    const ability = offering('spell-1', 'Snake');
    const paid = payOffering(ability, 'snake-1');
    expect(paid.sacrificedCreature).toBe('snake-1');
  });

  it('should calculate offering reduction', () => {
    expect(getOfferingReduction(4)).toBe(4);
  });
});

describe('Ninjutsu (Rule 702.49)', () => {
  it('should create ninjutsu ability', () => {
    const ability = ninjutsu('creature-1', '{U}{B}');
    expect(ability.type).toBe('ninjutsu');
    expect(ability.cost).toBe('{U}{B}');
  });

  it('should activate ninjutsu', () => {
    const ability = ninjutsu('creature-1', '{U}{B}');
    const activated = activateNinjutsu(ability, 'attacker-1');
    expect(activated.returnedCreature).toBe('attacker-1');
  });

  it('should check if can activate ninjutsu', () => {
    expect(canActivateNinjutsu(true, true)).toBe(true);
    expect(canActivateNinjutsu(false, true)).toBe(false);
    expect(canActivateNinjutsu(true, false)).toBe(false);
  });
});

describe('Epic (Rule 702.50)', () => {
  it('should create epic ability', () => {
    const ability = epic('spell-1');
    expect(ability.type).toBe('epic');
    expect(ability.isActive).toBe(false);
  });

  it('should resolve and activate epic', () => {
    const ability = epic('spell-1');
    const resolved = resolveEpic(ability);
    expect(resolved.isActive).toBe(true);
  });

  it('should create copies each turn', () => {
    const ability = resolveEpic(epic('spell-1'));
    const copy1 = createEpicCopy(ability);
    expect(copy1.copiesCreated).toBe(1);
    const copy2 = createEpicCopy(copy1);
    expect(copy2.copiesCreated).toBe(2);
  });
});

describe('Convoke (Rule 702.51)', () => {
  it('should create convoke ability', () => {
    const ability = convoke('spell-1');
    expect(ability.type).toBe('convoke');
    expect(ability.tappedCreatures).toHaveLength(0);
  });

  it('should pay with creatures', () => {
    const ability = convoke('spell-1');
    const paid = payConvoke(ability, ['creature-1', 'creature-2', 'creature-3']);
    expect(getConvokeReduction(paid)).toBe(3);
  });
});

describe('Dredge (Rule 702.52)', () => {
  it('should create dredge ability', () => {
    const ability = dredge('card-1', 3);
    expect(ability.type).toBe('dredge');
    expect(ability.value).toBe(3);
  });

  it('should use dredge', () => {
    const ability = dredge('card-1', 3);
    const used = useDredge(ability);
    expect(used.wasDredged).toBe(true);
  });

  it('should check if can dredge', () => {
    const ability = dredge('card-1', 3);
    expect(canDredge(5, ability)).toBe(true);
    expect(canDredge(3, ability)).toBe(true);
    expect(canDredge(2, ability)).toBe(false);
  });
});

describe('Transmute (Rule 702.53)', () => {
  it('should create transmute ability', () => {
    const ability = transmute('card-1', '{1}{U}{U}');
    expect(ability.type).toBe('transmute');
    expect(ability.cost).toBe('{1}{U}{U}');
  });

  it('should activate transmute', () => {
    const ability = transmute('card-1', '{1}{U}{U}');
    const activated = activateTransmute(ability);
    expect(activated.wasActivated).toBe(true);
  });

  it('should check if can transmute', () => {
    expect(canTransmute(true, true)).toBe(true);
    expect(canTransmute(false, true)).toBe(false);
    expect(canTransmute(true, false)).toBe(false);
  });
});

describe('Bloodthirst (Rule 702.54)', () => {
  it('should create bloodthirst ability', () => {
    const ability = bloodthirst('creature-1', 2);
    expect(ability.type).toBe('bloodthirst');
    expect(ability.value).toBe(2);
  });

  it('should resolve with opponent dealt damage', () => {
    const ability = bloodthirst('creature-1', 2);
    const resolved = resolveBloodthirst(ability, true);
    expect(resolved.countersAdded).toBe(2);
  });

  it('should not add counters if opponent not dealt damage', () => {
    const ability = bloodthirst('creature-1', 2);
    const resolved = resolveBloodthirst(ability, false);
    expect(resolved.countersAdded).toBe(0);
  });

  it('should not be redundant (Rule 702.54b)', () => {
    expect(isBloodthirstRedundant()).toBe(false);
  });
});

describe('Haunt (Rule 702.55)', () => {
  it('should create haunt ability', () => {
    const ability = haunt('card-1');
    expect(ability.type).toBe('haunt');
    expect(ability.triggeredOnEntry).toBe(false);
  });

  it('should haunt a card', () => {
    const ability = haunt('card-1');
    const haunted = hauntCard(ability, 'creature-1');
    expect(haunted.hauntedCard).toBe('creature-1');
    expect(haunted.triggeredOnEntry).toBe(true);
  });

  it('should trigger on haunted card leaving', () => {
    const ability = hauntCard(haunt('card-1'), 'creature-1');
    const triggered = triggerHauntLeave(ability);
    expect(triggered.triggeredOnLeave).toBe(true);
  });
});
