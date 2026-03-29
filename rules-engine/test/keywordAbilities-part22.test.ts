import { describe, expect, it } from 'vitest';
import {
  amplify,
  resolveAmplify,
  canRevealForAmplify,
  getAmplifyCounters,
  getSharedAmplifyTypes,
  createAmplifyEntryResult,
  provoke,
  triggerProvoke,
  mustBlockIfAble,
  canProvokeTarget,
  createProvokeRequirement,
  modular,
  triggerModular,
  getModularCounters,
  canMoveModularCounters,
  createModularTransferResult,
  sunburst,
  resolveSunburst,
  getDistinctSunburstColors,
  getSunburstColorCount,
  createSunburstEntryResult,
  graft,
  moveGraftCounter,
  canGraft,
  canMoveGraftCounterTo,
  createGraftTransferResult,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 22 (premodern counter and combat helpers)', () => {
  describe('Amplify (702.38)', () => {
    it('should derive shared creature types without duplicate matches', () => {
      expect(getSharedAmplifyTypes(['Elf', 'Wizard', 'elf'], ['elf', 'Warrior', 'wizard'])).toEqual(['Elf', 'Wizard']);
      expect(canRevealForAmplify(['Goblin', 'Scout'], ['Wizard', 'Goblin'])).toBe(true);
    });

    it('should create an amplify entry result from the resolved reveal set', () => {
      const sharedTypes = getSharedAmplifyTypes(['Goblin', 'Warrior'], ['Goblin', 'Shaman']);
      const resolved = resolveAmplify(amplify('skirk-ridge-exhumer', 2), ['card-1'], sharedTypes);

      expect(getAmplifyCounters(resolved)).toBe(2);
      expect(createAmplifyEntryResult(resolved)).toEqual({
        source: 'skirk-ridge-exhumer',
        revealedCards: ['card-1'],
        sharedTypes: ['Goblin'],
        countersAdded: 2,
      });
    });
  });

  describe('Provoke (702.39)', () => {
    it('should only allow legal provoke targets and generate a combat requirement', () => {
      expect(canProvokeTarget('attacker-1', 'attacker-1', true, true)).toBe(false);
      expect(canProvokeTarget('attacker-1', 'blocker-1', false, true)).toBe(false);
      expect(canProvokeTarget('attacker-1', 'blocker-1', true, false)).toBe(false);
      expect(canProvokeTarget('attacker-1', 'blocker-1', true, true)).toBe(true);

      const triggered = triggerProvoke(provoke('attacker-1'), 'blocker-1');
      expect(mustBlockIfAble(triggered, 'blocker-1')).toBe(true);
      expect(createProvokeRequirement(triggered)).toEqual({
        source: 'attacker-1',
        targetCreature: 'blocker-1',
        mustBlock: true,
        untapTarget: true,
      });
    });

    it('should not create a provoke requirement before the ability has triggered', () => {
      expect(createProvokeRequirement(provoke('attacker-1'))).toBeNull();
    });
  });

  describe('Modular (702.43)', () => {
    it('should distinguish entry counters from death-trigger transfer counters', () => {
      const ability = modular('arcbound-worker', 2);
      const triggered = triggerModular(ability, 5, 'artifact-creature-1');

      expect(getModularCounters(ability)).toBe(2);
      expect(getModularCounters(triggered)).toBe(5);
    });

    it('should only move modular counters to another legal artifact creature', () => {
      const validTrigger = triggerModular(modular('arcbound-ravager', 1), 4, 'artifact-creature-1');
      const sameSourceTrigger = triggerModular(modular('arcbound-ravager', 1), 4, 'arcbound-ravager');
      const zeroCounterTrigger = triggerModular(modular('arcbound-ravager', 1), 0, 'artifact-creature-1');

      expect(canMoveModularCounters(validTrigger, true)).toBe(true);
      expect(canMoveModularCounters(validTrigger, false)).toBe(false);
      expect(canMoveModularCounters(sameSourceTrigger, true)).toBe(false);
      expect(canMoveModularCounters(zeroCounterTrigger, true)).toBe(false);
      expect(createModularTransferResult(validTrigger, true)).toEqual({
        source: 'arcbound-ravager',
        targetCreature: 'artifact-creature-1',
        countersMoved: 4,
      });
    });
  });

  describe('Sunburst (702.44)', () => {
    it('should count only distinct valid colors of mana spent', () => {
      expect(getDistinctSunburstColors(['w', 'U', 'u', 'C', ' g ', ''])).toEqual(['W', 'U', 'G']);
      expect(getSunburstColorCount(['W', 'W', 'B', 'colorless', 'b'])).toBe(2);
    });

    it('should resolve sunburst using distinct colors and the correct counter type', () => {
      const creatureResolution = resolveSunburst(sunburst('etched-oracle'), ['w', 'U', 'u', 'g'], true);
      const nonCreatureResolution = resolveSunburst(sunburst('pentad-prism'), ['R', 'r', 'G'], false);

      expect(creatureResolution).toEqual({
        type: 'sunburst',
        source: 'etched-oracle',
        colorsSpent: ['W', 'U', 'G'],
        counters: 3,
        counterType: '+1/+1',
      });
      expect(createSunburstEntryResult(nonCreatureResolution)).toEqual({
        source: 'pentad-prism',
        colorsSpent: ['R', 'G'],
        countersAdded: 2,
        counterType: 'charge',
      });
    });
  });

  describe('Graft (702.58)', () => {
    it('should only move graft counters to another creature while counters remain', () => {
      const ability = graft('simic-initiate', 1);

      expect(canGraft(ability)).toBe(true);
      expect(canMoveGraftCounterTo(ability, 'simic-initiate')).toBe(false);
      expect(canMoveGraftCounterTo(ability, 'other-creature')).toBe(true);
      expect(createGraftTransferResult(ability, 'other-creature')).toEqual({
        source: 'simic-initiate',
        targetCreature: 'other-creature',
        countersMoved: 1,
        countersRemaining: 0,
      });
    });

    it('should stop allowing graft transfers once all counters are gone', () => {
      const exhausted = moveGraftCounter(graft('cytoplast-root-kin', 1));

      expect(canGraft(exhausted)).toBe(false);
      expect(createGraftTransferResult(exhausted, 'ally-creature')).toBeNull();
    });
  });
});