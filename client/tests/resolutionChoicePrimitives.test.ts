import { describe, expect, it } from 'vitest';

import {
  buildGenericOptionChoiceRequestFromStep,
  buildLibrarySearchModalStateFromStep,
  buildPendingSpellXSelectionFromStep,
  isGenericNumberChoiceStep,
  isGenericOptionChoiceFallbackStep,
  isGraveyardSourceLibrarySearchStep,
  isHandSourceLibrarySearchStep,
  isNamedGenericOptionChoiceStep,
  resolveLibrarySearchMoveTo,
} from '../src/utils/resolutionChoicePrimitives';

describe('resolutionChoicePrimitives', () => {
  it('treats number_choice and x_value_selection as number primitives', () => {
    expect(isGenericNumberChoiceStep({ type: 'number_choice' })).toBe(true);
    expect(isGenericNumberChoiceStep({ type: 'x_value_selection' })).toBe(true);
    expect(isGenericNumberChoiceStep({ type: 'option_choice' })).toBe(false);
  });

  it('recognizes named generic option step types', () => {
    expect(isNamedGenericOptionChoiceStep({ type: 'modal_choice' })).toBe(true);
    expect(isNamedGenericOptionChoiceStep({ type: 'choose_replacement' })).toBe(true);
    expect(isNamedGenericOptionChoiceStep({ type: 'order_triggers' })).toBe(true);
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

  it('reads X bounds from minX and maxX when minValue and maxValue are absent', () => {
    expect(
      buildPendingSpellXSelectionFromStep({
        id: 'step-x',
        sourceName: 'Well of Lost Dreams',
        description: 'Pay X',
        minX: 0,
        maxX: 3,
      }),
    ).toEqual(expect.objectContaining({
      minValue: 0,
      maxValue: 3,
    }));
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
          causeName: 'Reckless Blaze',
          causeLabel: 'You cast',
          causeImage: 'https://example.test/reckless.jpg',
        },
        'game-1',
        false,
      ),
    ).toMatchObject({
      gameId: 'game-1',
      stepId: 'step-2',
      minSelections: 0,
      maxSelections: 1,
      mandatory: false,
      causeName: 'Reckless Blaze',
      causeLabel: 'You cast',
      causeImage: 'https://example.test/reckless.jpg',
    });
  });

  it('maps library_search exile destination and graveyard-origin prompts', () => {
    const step = {
      id: 'gift-step',
      sourceName: "God-Pharaoh's Gift",
      description: "God-Pharaoh's Gift: exile target creature card from your graveyard",
      searchCriteria: 'exile target creature card from your graveyard',
      destination: 'exile',
      mandatory: false,
      minSelections: 0,
      maxSelections: 1,
      availableCards: [{ id: 'gy_bear', name: 'Grizzly Bears' }],
    };

    expect(resolveLibrarySearchMoveTo(step)).toBe('exile');
    expect(isGraveyardSourceLibrarySearchStep(step)).toBe(true);
    expect(buildLibrarySearchModalStateFromStep(step)).toMatchObject({
      moveTo: 'exile',
      mandatory: false,
      minSelections: 0,
      maxSelections: 1,
      title: "God-Pharaoh's Gift: Choose from graveyard",
      stepId: 'gift-step',
    });
  });

  it('maps from-hand battlefield prompts to a hand-origin library search', () => {
    const step = {
      id: 'ghalta-step',
      sourceName: 'Ghalta, Stampede Tyrant',
      description: 'Ghalta, Stampede Tyrant: put any number of creature cards from your hand onto the battlefield',
      searchCriteria: 'put any number of creature cards from your hand onto the battlefield',
      searchZone: 'hand',
      destination: 'battlefield',
      mandatory: true,
      minSelections: 0,
      maxSelections: 2,
      availableCards: [{ id: 'bear-1', name: 'Grizzly Bears' }],
    };

    expect(resolveLibrarySearchMoveTo(step)).toBe('battlefield');
    expect(isHandSourceLibrarySearchStep(step)).toBe(true);
    expect(buildLibrarySearchModalStateFromStep(step)).toMatchObject({
      moveTo: 'battlefield',
      mandatory: true,
      minSelections: 0,
      maxSelections: 2,
      title: 'Ghalta, Stampede Tyrant: Choose from hand',
      stepId: 'ghalta-step',
    });
  });
});
