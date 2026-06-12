import { describe, expect, it } from 'vitest';

import { inferResolutionStepMandatory } from '../src/state/resolution/mandatoryInference.js';

describe('inferResolutionStepMandatory', () => {
  it('respects explicit mandatory false', () => {
    expect(inferResolutionStepMandatory({ mandatory: false })).toBe(false);
  });

  it('respects explicit mandatory true', () => {
    expect(inferResolutionStepMandatory({ mandatory: true, description: 'you may draw a card' })).toBe(true);
  });

  it('treats effect clauses starting with you may as optional', () => {
    expect(inferResolutionStepMandatory({
      description: 'Choose a target',
      effectText: 'you may draw a card',
    })).toBe(false);
  });

  it('treats may ability prompts as optional', () => {
    expect(inferResolutionStepMandatory({
      mandatory: true,
      mayAbilityPrompt: true,
      description: 'Draw a card',
    })).toBe(false);
  });

  it('treats optional triggered ability effect programs as optional', () => {
    expect(inferResolutionStepMandatory({
      mandatory: true,
      effectProgramPrompt: true,
      effectProgramFamily: 'optional_triggered_ability',
    })).toBe(false);
  });

  it('treats full ability text containing you may as optional when mandatory omitted', () => {
    expect(inferResolutionStepMandatory({
      description: 'Optional triggered ability',
      fullAbilityText: 'Whenever this creature attacks, you may draw a card.',
    })).toBe(false);
  });

  it('defaults mana selection prompts to mandatory', () => {
    expect(inferResolutionStepMandatory({
      type: 'mana_color_selection',
      description: "Choose a color for Gwenna, Eyes of Gaea's mana.",
    })).toBe(true);
  });
});
