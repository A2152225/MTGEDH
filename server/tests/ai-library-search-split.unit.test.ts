import { describe, expect, it } from 'vitest';

import { chooseAILibrarySearchResponse } from '../src/socket/ai.js';

describe('chooseAILibrarySearchResponse split destination', () => {
  const availableCards = [
    { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    { id: 'f2', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    { id: 'p1', name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
  ];

  it('selects two cards with split assignments for Cultivate-style effects', () => {
    const result = chooseAILibrarySearchResponse(
      { state: { players: [{ id: 'p1' }] } },
      'p1' as any,
      availableCards,
      {
        minSelections: 0,
        maxSelections: 2,
        destination: 'split',
        splitDestination: true,
      },
    );

    expect(result.selections).toHaveLength(2);
    expect(result.splitAssignments).toEqual({
      toBattlefield: [result.selections[0]],
      toHand: [result.selections[1]],
    });
  });

  it('assigns a single find to the battlefield when only one card is taken', () => {
    const result = chooseAILibrarySearchResponse(
      { state: { players: [{ id: 'p1' }] } },
      'p1' as any,
      [availableCards[0]!],
      {
        minSelections: 0,
        maxSelections: 2,
        destination: 'split',
        splitDestination: true,
      },
    );

    expect(result.selections).toEqual(['f1']);
    expect(result.splitAssignments).toEqual({
      toBattlefield: ['f1'],
      toHand: [],
    });
  });

  it('assigns one card to the battlefield and the rest to hand', () => {
    const result = chooseAILibrarySearchResponse(
      { state: { players: [{ id: 'p1' }] } },
      'p1' as any,
      availableCards,
      {
        minSelections: 0,
        maxSelections: 3,
        destination: 'split',
        splitDestination: true,
        toBattlefield: 1,
        toHand: 'rest',
      },
    );

    expect(result.selections).toHaveLength(3);
    expect(result.splitAssignments).toEqual({
      toBattlefield: [result.selections[0]],
      toHand: result.selections.slice(1),
    });
  });
});
