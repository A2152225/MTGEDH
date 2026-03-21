import { describe, expect, it } from 'vitest';
import {
  getTopTriggeredAbilityAutoPassReason,
  getSavedTriggerShortcutPreference,
  shouldSuppressMandatoryTriggeredAbilityPrompt,
} from '../src/socket/trigger-shortcuts.js';

describe('trigger shortcut helpers', () => {
  it('returns the saved shortcut preference for a matching card name', () => {
    const state = {
      triggerShortcuts: {
        p1: [
          { cardName: 'soul warden', playerId: 'p1', preference: 'always_resolve' },
        ],
      },
    };

    expect(getSavedTriggerShortcutPreference(state, 'p1', 'Soul Warden')).toBe('always_resolve');
  });

  it('suppresses prompts only for mandatory eligible triggers with always_resolve', () => {
    const state = {
      triggerShortcuts: {
        p1: [
          { cardName: 'soul warden', playerId: 'p1', preference: 'always_resolve' },
          { cardName: "soul's attendant", playerId: 'p1', preference: 'always_yes' },
        ],
      },
    };

    expect(shouldSuppressMandatoryTriggeredAbilityPrompt(state, 'p1', 'Soul Warden', true)).toBe(true);
    expect(shouldSuppressMandatoryTriggeredAbilityPrompt(state, 'p1', 'Soul Warden', false)).toBe(false);
    expect(shouldSuppressMandatoryTriggeredAbilityPrompt(state, 'p1', "Soul's Attendant", true)).toBe(false);
    expect(shouldSuppressMandatoryTriggeredAbilityPrompt(state, 'p1', 'Rhystic Study', true)).toBe(false);
  });

  it('returns false when there is no saved preference for the controller', () => {
    const state = {
      triggerShortcuts: {
        p2: [
          { cardName: 'soul warden', playerId: 'p2', preference: 'always_resolve' },
        ],
      },
    };

    expect(shouldSuppressMandatoryTriggeredAbilityPrompt(state, 'p1', 'Soul Warden', true)).toBe(false);
  });

  it('prefers per-game yielded trigger sources before saved preferences', () => {
    const state = {
      stack: [
        {
          id: 'trigger_1',
          type: 'triggered_ability',
          source: 'soul_warden_1',
          sourceName: 'Soul Warden',
          mandatory: true,
        },
      ],
      yieldToTriggerSourcesForAutoPass: {
        p1: {
          soul_warden_1: { enabled: true },
        },
      },
      triggerShortcuts: {
        p1: [
          { cardName: 'soul warden', playerId: 'p1', preference: 'always_resolve' },
        ],
      },
    };

    expect(getTopTriggeredAbilityAutoPassReason(state, 'p1')).toBe('yielded_source');
  });

  it('returns saved_always_resolve for eligible mandatory top-stack triggers', () => {
    const state = {
      stack: [
        {
          id: 'trigger_1',
          type: 'triggered_ability',
          source: 'soul_warden_1',
          sourceName: 'Soul Warden',
          mandatory: true,
        },
      ],
      triggerShortcuts: {
        p1: [
          { cardName: 'soul warden', playerId: 'p1', preference: 'always_resolve' },
        ],
      },
    };

    expect(getTopTriggeredAbilityAutoPassReason(state, 'p1')).toBe('saved_always_resolve');
  });
});