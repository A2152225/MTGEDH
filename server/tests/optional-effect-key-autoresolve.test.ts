import { describe, expect, it } from 'vitest';
import {
  buildOptionalEffectKey,
  findMayAutoPreferenceEntry,
  normalizeOptionalEffectKeyPart,
} from '../../shared/src/optionalEffectKey.js';
import {
  buildOptionalEffectKey as buildStepOptionalEffectKey,
  optionalEffectTextHasConsequentialFollowUp,
  resolveOptionalAutoChoice,
  shouldSuppressGlobalAutoYesOptional,
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

  it('does not globally auto-yes Baral-style if-you-do loot', () => {
    const step = {
      id: 'step-baral',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName: 'Baral, Chief of Compliance',
      description: 'You may: you may draw a card. If you do, discard a card.',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramId: 'optional-trigger:baral',
      effectProgramStepId: 'optional-trigger:baral:choice',
      effectProgramBindingKey: 'optional-trigger:baral:decision',
      effectProgramCursor: 0,
      effectText: 'you may draw a card. If you do, discard a card.',
    } as ResolutionStep;

    const state: any = {
      autoYesOptional: { p1: true },
    };

    expect(optionalEffectTextHasConsequentialFollowUp(step.effectText as string)).toBe(true);
    expect(shouldSuppressGlobalAutoYesOptional(step)).toBe(true);
    expect(resolveOptionalAutoChoice(state, 'p1', step)).toBeUndefined();
  });

  it('does not globally auto-yes Aura Shards may-destroy (even with one legal target)', () => {
    const step = {
      id: 'step-aura-shards',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName: 'Aura Shards',
      description: 'You may: you may destroy target artifact or enchantment.',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramId: 'optional-trigger:aura-shards',
      effectProgramStepId: 'optional-trigger:aura-shards:choice',
      effectProgramBindingKey: 'optional-trigger:aura-shards:decision',
      effectProgramCursor: 0,
      effectText: 'you may destroy target artifact or enchantment.',
    } as ResolutionStep;

    const state: any = {
      autoYesOptional: { p1: true },
    };

    expect(optionalEffectTextHasConsequentialFollowUp(step.effectText as string)).toBe(true);
    expect(shouldSuppressGlobalAutoYesOptional(step)).toBe(true);
    expect(resolveOptionalAutoChoice(state, 'p1', step)).toBeUndefined();
  });

  it('still globally auto-yeses free optional life gain', () => {
    const step = {
      id: 'step-life',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName: 'Auriok Champion',
      description: 'Auriok Champion: you may gain 1 life.',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramId: 'prog-life',
      effectProgramStepId: 'may-choice',
      effectProgramBindingKey: 'prog-life:may',
      effectProgramCursor: 0,
    } as ResolutionStep;

    const state: any = {
      autoYesOptional: { p1: true },
    };

    expect(resolveOptionalAutoChoice(state, 'p1', step)).toBe('yes');
  });

  it('still honors explicit Always Yes for consequential mays', () => {
    const step = {
      id: 'step-baral-always',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1',
      sourceName: 'Baral, Chief of Compliance',
      description: 'You may: you may draw a card. If you do, discard a card.',
      mandatory: false,
      effectProgramPrompt: true,
      effectProgramId: 'optional-trigger:baral-always',
      effectProgramStepId: 'optional-trigger:baral-always:choice',
      effectProgramBindingKey: 'optional-trigger:baral-always:decision',
      effectProgramCursor: 0,
      effectText: 'you may draw a card. If you do, discard a card.',
    } as ResolutionStep;

    const state: any = {
      autoYesOptional: { p1: true },
      mayAutoPreferences: {
        p1: {
          'baral, chief of compliance:you may draw a card. if you do, discard a card': 'yes',
        },
      },
    };

    expect(resolveOptionalAutoChoice(state, 'p1', step)).toBe('yes');
  });
});
