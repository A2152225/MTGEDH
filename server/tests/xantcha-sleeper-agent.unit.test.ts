import { describe, expect, it } from 'vitest';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { detectETBPlayerSelection } from '../src/socket/player-selection.js';
import { abilityAllowsAnyPlayerActivation } from '../../shared/src/anyPlayerActivatedAbility.js';

const XANTCHA_ORACLE =
  "Xantcha enters under the control of an opponent of your choice.\n" +
  "Xantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.\n" +
  "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.";

const xantchaCard = {
  name: 'Xantcha, Sleeper Agent',
  oracle_text: XANTCHA_ORACLE,
  type_line: 'Legendary Creature — Phyrexian Minion',
};

describe('Xantcha, Sleeper Agent control-change detection', () => {
  it('treats the enter replacement as a one-shot opponent control change', () => {
    const asEnters = getAsEntersChoiceRequirements(xantchaCard);
    expect(asEnters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'opponent',
          appliesControlChange: true,
        }),
      ]),
    );

    const detection = detectETBPlayerSelection(xantchaCard);
    expect(detection.required).toBe(true);
    expect(detection.effectData?.type).toBe('control_change');
    expect(detection.allowOpponentsOnly).toBe(true);
  });
});

describe('Xantcha, Sleeper Agent any-player activation text', () => {
  it('allows the {3} ability even when scoped extract dropped the reminder', () => {
    expect(abilityAllowsAnyPlayerActivation({
      scopedAbilityText: "{3}: Xantcha's controller loses 2 life and you draw a card.",
      cardOracleText: XANTCHA_ORACLE,
    })).toBe(true);
  });

  it('does not treat an unrelated cost as any-player when the reminder is on another ability', () => {
    const oracle =
      "{T}: Add {C}.\n" +
      "{3}: Draw a card. Any player may activate this ability.";
    expect(abilityAllowsAnyPlayerActivation({
      scopedAbilityText: '{T}: Add {C}.',
      cardOracleText: oracle,
    })).toBe(false);
    expect(abilityAllowsAnyPlayerActivation({
      scopedAbilityText: '{3}: Draw a card.',
      cardOracleText: oracle,
    })).toBe(true);
  });
});
