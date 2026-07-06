import { describe, expect, it } from 'vitest';
import {
  buildOptionalEffectKey,
  findMayAutoPreferenceEntry,
  normalizeOptionalEffectKeyPart,
} from '../../shared/src/optionalEffectKey.js';
import {
  buildOptionalEffectKey as buildStepOptionalEffectKey,
  resolveOptionalAutoChoice,
} from '../src/state/effects/effectProgramOptionalAutoResolveUtils.js';
import { ResolutionStepType, type ResolutionStep } from '../src/state/resolution/index.js';

describe('optional effect key normalization', () => {
  it('strips trailing punctuation from effect fragments', () => {
    expect(normalizeOptionalEffectKeyPart('gain 1 life.')).toBe('gain 1 life');
    expect(buildOptionalEffectKey('Auriok Champion', 'gain 1 life.')).toBe('auriok champion:gain 1 life');
  });

  it('matches stored prefs when punctuation differs', () => {
    const prefs = {
      'auriok champion:gain 1 life': 1,
    };
    const entry = findMayAutoPreferenceEntry(
      prefs,
      buildOptionalEffectKey('Auriok Champion', 'gain 1 life.'),
    );
    expect(entry).toEqual({ key: 'auriok champion:gain 1 life', value: 1 });
  });

  it('auto-resolves effect-program optional steps from countdown prefs', () => {
    const step = {
      id: 'step-1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName: 'Auriok Champion',
      description: 'Auriok Champion: you may gain 1 life.',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramId: 'prog-1',
      effectProgramStepId: 'may-choice',
      effectProgramBindingKey: 'prog-1:may',
      effectProgramCursor: 0,
    } as ResolutionStep;

    const state: any = {
      mayAutoPreferences: {
        p1: {
          'auriok champion:gain 1 life': 1,
        },
      },
    };

    expect(buildStepOptionalEffectKey(step)).toBe('auriok champion:gain 1 life');
    expect(resolveOptionalAutoChoice(state, 'p1', step)).toBe('yes');
    expect(state.mayAutoPreferences.p1['auriok champion:gain 1 life']).toBeUndefined();
  });

  it('auto-resolves from trigger shortcut always_yes', () => {
    const step = {
      id: 'step-2',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName: 'Auriok Champion',
      description: 'Auriok Champion: you may gain 1 life.',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramId: 'prog-2',
      effectProgramStepId: 'may-choice',
      effectProgramBindingKey: 'prog-2:may',
      effectProgramCursor: 0,
    } as ResolutionStep;

    const state: any = {
      triggerShortcuts: {
        p1: [{ cardName: 'Auriok Champion', preference: 'always_yes' }],
      },
    };

    expect(resolveOptionalAutoChoice(state, 'p1', step)).toBe('yes');
  });
});
