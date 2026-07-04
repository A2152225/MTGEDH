import { describe, expect, it } from 'vitest';

import {
  buildGenericOptionChoiceRequestFromStep,
  buildPendingSpellXSelectionFromStep,
  isGenericNumberChoiceStep,
  isGenericOptionChoiceFallbackStep,
  isNamedGenericOptionChoiceStep,
} from '../src/utils/resolutionChoicePrimitives';

describe('resolutionChoicePrimitives', () => {
  it('treats number_choice and x_value_selection as number primitives', () => {
    expect(isGenericNumberChoiceStep({ type: 'number_choice' })).toBe(true);
    expect(isGenericNumberChoiceStep({ type: 'x_value_selection' })).toBe(true);
    expect(isGenericNumberChoiceStep({ type: 'option_choice' })).toBe(false);
  });

  it('recognizes named generic option step types', () => {
    expect(isNamedGenericOptionChoiceStep({ type: 'modal_choice' })).toBe(true);
    expect(isNamedGenericOptionChoiceStep({ type: 'discard_selection' })).toBe(false);
  });

  it('falls back to option modal for novel types with options payload', () => {
    expect(
      isGenericOptionChoiceFallbackStep({
        type: 'oracle_ir_player_pick',
        options: [{ id: 'a', label: 'A' }],
      }),
    ).toBe(true);
    expect(
      isGenericOptionChoiceFallbackStep({
        type: 'discard_selection',
        options: [{ id: 'a', label: 'A' }],
      }),
    ).toBe(false);
    expect(
      isGenericOptionChoiceFallbackStep({
        type: 'oracle_ir_player_pick',
        mayAbilityPrompt: true,
        options: [{ id: 'a', label: 'A' }],
      }),
    ).toBe(false);
  });

  it('builds pending X selection state from step payload', () => {
    expect(
      buildPendingSpellXSelectionFromStep({
        id: 'step-1',
        sourceName: 'Blue Sun',
        description: 'Choose X',
        minValue: 1,
        maxValue: 10,
        xCount: 2,
      }),
    ).toEqual({
      stepId: 'step-1',
      cardName: 'Blue Sun',
      description: 'Choose X',
      minValue: 1,
      maxValue: 10,
      xCount: 2,
      affordableXHint: undefined,
    });
  });

  it('builds generic option choice request from step payload', () => {
    expect(
      buildGenericOptionChoiceRequestFromStep(
        {
          id: 'step-2',
          sourceName: 'Source',
          description: 'Pick one',
          options: [{ id: 'a', label: 'A' }],
          minSelections: 0,
          maxSelections: 1,
        },
        'game-1',
        false,
      ),
    ).toMatchObject({
      gameId: 'game-1',
      stepId: 'step-2',
      sourceName: 'Source',
      mandatory: false,
      options: [{ id: 'a', label: 'A' }],
    });
  });
});
