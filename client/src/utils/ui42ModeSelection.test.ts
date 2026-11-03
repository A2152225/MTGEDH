import { describe, it, expect } from 'vitest';
import { getSingleModePromptDescription } from './resolutionModePromptUi';

// Shape captured from the server's activated-ability resolution-time MODE_SELECTION (trigger round 38).
const step = { id: 's', type: 'mode_selection', sourceName: 'Modal Rock', minModes: 1, maxModes: 1, allowDuplicates: false,
  modes: [{ id: 'Mode 1', label: 'Mode 1', description: 'You gain 2 life.' }, { id: 'Mode 2', label: 'Mode 2', description: 'You gain 5 life.' }],
  effectProgramFamily: 'activated_ability_resolution', effectProgramPrompt: true };

describe('ui42 resolution-time mode_selection', () => {
  it('uses resolution wording for effect-program mode prompts', () => {
    expect(getSingleModePromptDescription(step)).toBe('Choose a mode.');
  });
  it('keeps cast-time wording otherwise', () => {
    expect(getSingleModePromptDescription({ type: 'mode_selection', modeSelectionPurpose: 'overload' })).toBe('Choose a mode before selecting targets.');
  });
});