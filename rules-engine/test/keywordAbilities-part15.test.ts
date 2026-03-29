import { describe, expect, it } from 'vitest';
import {
  phasing,
  phaseOut,
  createPhasedOutState,
  getIndirectlyPhasingPermanents,
  shouldPhaseIn,
  shouldPhaseOut,
  processUntapStepPhasing,
  permanentExists,
  shouldPhasingTrigger,
  umbraArmor,
  canApplyUmbraArmor,
  resolveUmbraArmor,
  areUmbraArmorAbilitiesRedundant,
  fading,
  canRemoveFadeCounter,
  processFadingUpkeep,
  shouldSacrificeForFading,
  vanishing,
  canRemoveVanishingCounter,
  processVanishingUpkeep,
  shouldSacrificeVanishing,
  haunt,
  canHauntCard,
  hauntCard,
  isHauntingCard,
  shouldTriggerHauntLeave,
  triggerHauntLeave,
  clearHaunt,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 15 (state and transition helpers)', () => {
  describe('Phasing (Rule 702.26)', () => {
    it('should preserve phase-out metadata for effect-driven phasing', () => {
      const ability = phaseOut(phasing('teferi'), 'effect', 'player-a');

      expect(ability.phasedOut).toBe(true);
      expect(ability.phasedOutBy).toBe('effect');
      expect(ability.phasedOutControllerId).toBe('player-a');
    });

    it('should build phased-out state with attachments and counters intact', () => {
      const phasedOutState = createPhasedOutState(
        'permanent-1',
        'player-a',
        'phasing',
        ['aura-1', 'equipment-1'],
        { time: 2, shield: 1 },
        true
      );

      expect(phasedOutState.permanentId).toBe('permanent-1');
      expect(phasedOutState.controllerId).toBe('player-a');
      expect(phasedOutState.attachedPermanentIds).toEqual(['aura-1', 'equipment-1']);
      expect(phasedOutState.counters).toEqual({ time: 2, shield: 1 });
      expect(phasedOutState.wasTapped).toBe(true);
      expect(typeof phasedOutState.phasedOutAt).toBe('number');
      expect(shouldPhaseIn(phasedOutState, 'player-a')).toBe(true);
      expect(shouldPhaseIn(phasedOutState, 'player-b')).toBe(false);
    });

    it('should phase permanents in and out during the active players untap step', () => {
      const results = processUntapStepPhasing(
        [
          {
            id: 'shimmering-creature',
            controllerId: 'player-a',
            ability: phasing('shimmering-creature'),
            attachedPermanentIds: ['attached-aura'],
            counters: { fade: 1 },
            tapped: true,
          },
          {
            id: 'other-players-creature',
            controllerId: 'player-b',
            ability: phasing('other-players-creature'),
            attachedPermanentIds: [],
            counters: {},
            tapped: false,
          },
        ],
        [
          createPhasedOutState('returning-creature', 'player-a', 'effect', ['returning-aura']),
          createPhasedOutState('stays-phased-out', 'player-b', 'phasing', ['other-aura']),
        ],
        'player-a'
      );

      expect(results).toEqual([
        {
          permanentId: 'shimmering-creature',
          phasedIn: false,
          phasedOut: true,
          indirectlyPhased: ['attached-aura'],
          wasTriggered: true,
        },
        {
          permanentId: 'attached-aura',
          phasedIn: false,
          phasedOut: true,
          indirectlyPhased: [],
          wasTriggered: false,
        },
        {
          permanentId: 'returning-creature',
          phasedIn: true,
          phasedOut: false,
          indirectlyPhased: ['returning-aura'],
          wasTriggered: true,
        },
        {
          permanentId: 'returning-aura',
          phasedIn: true,
          phasedOut: false,
          indirectlyPhased: [],
          wasTriggered: false,
        },
      ]);
    });

    it('should expose phasing visibility and indirect-trigger helpers', () => {
      const ability = phasing('permanent-1');
      const phasedOutState = createPhasedOutState('permanent-1', 'player-a', 'phasing');

      expect(getIndirectlyPhasingPermanents('permanent-1', [
        { id: 'aura-1', attachedTo: 'permanent-1' },
        { id: 'equipment-1', attachedTo: 'permanent-2' },
      ])).toEqual(['aura-1']);
      expect(shouldPhaseOut(ability, 'player-a', 'player-a')).toBe(true);
      expect(shouldPhaseOut(ability, 'player-b', 'player-a')).toBe(false);
      expect(permanentExists(ability, undefined)).toBe(true);
      expect(permanentExists(phaseOut(ability), undefined)).toBe(false);
      expect(permanentExists(undefined, phasedOutState)).toBe(false);
      expect(shouldPhasingTrigger('phases_in', false)).toBe(true);
      expect(shouldPhasingTrigger('phases_out', true)).toBe(false);
    });
  });

  describe('Umbra Armor (Rule 702.89)', () => {
    it('should only apply while attached to a permanent facing destruction', () => {
      expect(canApplyUmbraArmor(true, true, true)).toBe(true);
      expect(canApplyUmbraArmor(false, true, true)).toBe(false);
      expect(canApplyUmbraArmor(true, false, true)).toBe(false);
      expect(canApplyUmbraArmor(true, true, false)).toBe(false);
    });

    it('should resolve by saving the enchanted permanent and clearing damage', () => {
      const resolution = resolveUmbraArmor(umbraArmor('hyena-umbra'), 'silvercoat-lion', 5);

      expect(resolution).toEqual({
        preventedDestruction: true,
        enchantedPermanentId: 'silvercoat-lion',
        auraDestroyed: true,
        damageRemoved: 5,
        auraSource: 'hyena-umbra',
      });
    });

    it('should treat multiple umbra armor instances as redundant', () => {
      expect(areUmbraArmorAbilitiesRedundant(umbraArmor('hyena-umbra'), umbraArmor('snake-umbra'))).toBe(true);
    });
  });

  describe('Fading (Rule 702.32)', () => {
    it('should remove the last fade counter without sacrificing immediately', () => {
      const result = processFadingUpkeep(fading('parallax-wave', 1));

      expect(result.removedCounter).toBe(true);
      expect(result.sacrificed).toBe(false);
      expect(result.countersRemaining).toBe(0);
      expect(result.ability?.fadeCounters).toBe(0);
    });

    it('should sacrifice only when upkeep begins with no fade counters to remove', () => {
      const result = processFadingUpkeep(fading('parallax-wave', 0));

      expect(canRemoveFadeCounter(fading('parallax-wave', 0))).toBe(false);
      expect(result.ability).toBeNull();
      expect(result.removedCounter).toBe(false);
      expect(result.sacrificed).toBe(true);
      expect(shouldSacrificeForFading(fading('parallax-wave', 0))).toBe(true);
    });

    it('should report fade-counter availability directly', () => {
      expect(canRemoveFadeCounter(fading('parallax-wave', 2))).toBe(true);
      expect(canRemoveFadeCounter(fading('parallax-wave', 0))).toBe(false);
    });
  });

  describe('Vanishing (Rule 702.63)', () => {
    it('should remove time counters until the last counter is removed', () => {
      const result = processVanishingUpkeep(vanishing('keldon-marauders', 2));

      expect(canRemoveVanishingCounter(vanishing('keldon-marauders', 2))).toBe(true);
      expect(result.removedCounter).toBe(true);
      expect(result.lastCounterRemoved).toBe(false);
      expect(result.shouldSacrifice).toBe(false);
      expect(result.ability.timeCounters).toBe(1);
    });

    it('should sacrifice when the last time counter is removed', () => {
      const result = processVanishingUpkeep(vanishing('keldon-marauders', 1));

      expect(result.removedCounter).toBe(true);
      expect(result.lastCounterRemoved).toBe(true);
      expect(result.shouldSacrifice).toBe(true);
      expect(result.ability.timeCounters).toBe(0);
      expect(shouldSacrificeVanishing(result.ability)).toBe(true);
    });

    it('should not fabricate a new sacrifice trigger if no counters remain already', () => {
      const result = processVanishingUpkeep(vanishing('reality-acid', 0));

      expect(canRemoveVanishingCounter(vanishing('reality-acid', 0))).toBe(false);
      expect(result.removedCounter).toBe(false);
      expect(result.lastCounterRemoved).toBe(false);
      expect(result.shouldSacrifice).toBe(false);
    });
  });

  describe('Haunt (Rule 702.55)', () => {
    it('should validate and track haunted cards', () => {
      const haunted = hauntCard(haunt('orzhov-pontiff'), 'target-creature');

      expect(canHauntCard('target-creature')).toBe(true);
      expect(canHauntCard(undefined)).toBe(false);
      expect(isHauntingCard(haunted)).toBe(true);
      expect(haunted.hauntedCard).toBe('target-creature');
      expect(haunted.triggeredOnEntry).toBe(true);
    });

    it('should only trigger the leave ability for the haunted card', () => {
      const haunted = hauntCard(haunt('orzhov-pontiff'), 'target-creature');
      const ignored = triggerHauntLeave(haunted, 'other-creature');
      const triggered = triggerHauntLeave(haunted, 'target-creature');

      expect(shouldTriggerHauntLeave(haunted, 'target-creature')).toBe(true);
      expect(shouldTriggerHauntLeave(haunted, 'other-creature')).toBe(false);
      expect(ignored.triggeredOnLeave).toBe(false);
      expect(triggered.triggeredOnLeave).toBe(true);
    });

    it('should clear the haunted target when the haunting link ends', () => {
      const cleared = clearHaunt(hauntCard(haunt('orzhov-pontiff'), 'target-creature'));

      expect(cleared.hauntedCard).toBeUndefined();
      expect(cleared.triggeredOnLeave).toBe(false);
    });
  });
});