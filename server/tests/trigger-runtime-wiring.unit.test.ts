import { describe, expect, it } from 'vitest';

import {
  collectOracleEffectSteps,
  getTriggerRuntimeWiringGaps,
  isSupportedCopyPermanentTriggerPattern,
  isSupportedGainControlTriggerPattern,
  isTriggerStepRuntimeWired,
  normalizeTriggerEffectDescriptionForExecution,
  parseTriggerEffectSteps,
} from '../src/state/modules/trigger-runtime-wiring.js';

describe('trigger runtime wiring assessment', () => {
  it('treats Cryptoplasm upkeep copy as wired', () => {
    const effect =
      'you may have this creature become a copy of another target creature, except it has this ability';
    const steps = parseTriggerEffectSteps(effect, 'Cryptoplasm');

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'copy_permanent',
        retainAbilityText: 'it has this ability',
      }),
    ]);
    expect(isSupportedCopyPermanentTriggerPattern(steps[0]!)).toBe(true);
    expect(isTriggerStepRuntimeWired(steps[0]!)).toBe(true);
    expect(getTriggerRuntimeWiringGaps(effect, 'Cryptoplasm')).toEqual([]);
    expect(collectOracleEffectSteps(effect, 'Cryptoplasm')).toEqual(steps);
  });

  it('does not flag wired lose-life trigger fragments', () => {
    expect(getTriggerRuntimeWiringGaps('that player loses 3 life', 'Shrieking Affliction')).toEqual([]);
  });

  it('treats optional draw triggers as wired when draw is in the fallback set', () => {
    const effect = 'you may draw a card';
    const steps = parseTriggerEffectSteps(effect, 'Sample Card');

    expect(steps.some(step => step.kind === 'draw')).toBe(true);
    expect(getTriggerRuntimeWiringGaps(effect, 'Sample Card')).toEqual([]);
  });

  it('parses Draw X where-X trigger fragments with preserved whereX', () => {
    const effect = 'Draw X cards, where X is the number of cards in your hand.';
    const steps = parseTriggerEffectSteps(effect, 'Draw WhereX Probe');
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'draw',
        amount: { kind: 'x' },
        whereX: { kind: 'where', raw: 'the number of cards in your hand' },
      }),
    ]);
    expect(collectOracleEffectSteps(effect, 'Draw WhereX Probe')).toEqual(steps);
    expect(getTriggerRuntimeWiringGaps(effect, 'Draw WhereX Probe')).toEqual([]);
  });

  it("parses Outlaws' Merriment random choose_mode from a trigger fragment", () => {
    const effect =
      'choose one at random. Create a red and white creature token with those characteristics.\n' +
      '\u2022 3/1 Human Warrior with trample and haste.\n' +
      '\u2022 2/1 Human Cleric with lifelink and haste.\n' +
      '\u2022 1/2 Human Rogue with haste and "When this token enters, it deals 1 damage to any target."';
    const steps = parseTriggerEffectSteps(effect, "Outlaws' Merriment");
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
      }),
    ]);
    expect((steps[0] as any).modes).toHaveLength(3);
    expect(getTriggerRuntimeWiringGaps(effect, "Outlaws' Merriment")).toEqual([]);
  });

  it('does not flag effects outside the oracle IR fallback surface area', () => {
    const effect = "put the cards exiled with it into their owner's hand";
    expect(getTriggerRuntimeWiringGaps(effect, 'Solemn Simulacrum')).toEqual([]);
  });

  it('strips keyword suffixes and room DFC boilerplate before execution parsing', () => {
    const effect =
      'When you unlock this door, destroy target creature. You may cast either half. That door unlocks on the battlefield. Escape—{3}{R}{R}, exile four other cards from your graveyard.';
    expect(normalizeTriggerEffectDescriptionForExecution(effect).toLowerCase()).toBe(
      'when you unlock this door, destroy target creature',
    );
  });

  it('treats Fierce Empath optional search plus shuffle as fully IR wired', () => {
    const effect =
      'you may search your library for a creature card with mana value 6 or greater, reveal it, put it into your hand, then shuffle';
    expect(getTriggerRuntimeWiringGaps(effect, 'Fierce Empath')).toEqual([]);
  });

  it('treats each-player owned-creature gain_control as wired', () => {
    const effect = 'Each player gains control of all creatures they own.';
    const steps = collectOracleEffectSteps(effect, 'Test');
    expect(steps).toEqual([expect.objectContaining({ kind: 'gain_control' })]);
    expect(isSupportedGainControlTriggerPattern(steps[0]!)).toBe(true);
    expect(isTriggerStepRuntimeWired(steps[0]!)).toBe(true);
    expect(getTriggerRuntimeWiringGaps(effect, 'Test')).toEqual([]);
  });

  it('treats attacking-player artifact gain_control as wired', () => {
    const effect = 'the attacking player gains control of this artifact and untaps it';
    const steps = collectOracleEffectSteps(effect, 'Test Artifact');
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'gain_control',
        what: expect.objectContaining({ text: 'this artifact' }),
        newController: { kind: 'target_player' },
      }),
    ]);
    expect(isSupportedGainControlTriggerPattern(steps[0]!)).toBe(true);
    expect(isTriggerStepRuntimeWired(steps[0]!)).toBe(true);
    expect(getTriggerRuntimeWiringGaps(effect, 'Test Artifact')).toEqual([]);
  });

  it('treats combat-damage opponent draw counts as wired', () => {
    const effect = 'draw cards equal to the number of opponents who were dealt combat damage this turn';
    expect(getTriggerRuntimeWiringGaps(effect, 'Moonshae Pixie')).toEqual([]);
  });

  it('treats subtype bulk untap as wired', () => {
    const effect = 'untap all elves you control';
    expect(getTriggerRuntimeWiringGaps(effect, 'Source')).toEqual([]);
  });
});
