/**
 * Tests for Section 4: Zones (Rules 400-408)
 */

import { describe, it, expect } from 'vitest';
import {
  Zone,
  isPublicZone,
  isHiddenZone,
  createLibrary,
  getTopCard,
  getLibrarySize,
  putCardInLibrary,
  createHand,
  getMaximumHandSize,
  getHandSize,
  addCardToHand,
  removeCardFromHand,
  createBattlefield,
  isPermanentOnBattlefield,
  addPermanentToBattlefield,
  removePermanentFromBattlefield,
  createGraveyard,
  putCardInGraveyard,
  getGraveyardCards,
  getTopGraveyardCard,
  createStack,
  pushToStack,
  getTopStackObject,
  popFromStack,
  isStackEmpty,
  createExile,
  exileCard,
  canExamineExiledCard,
  createCommandZone,
  addToCommandZone,
  isInCommandZone,
  createSideboard,
  isSideboardCard,
  createZoneState,
  type StackObject,
} from '../src/types/zones';

describe('Rule 400 - General', () => {
  it('should identify public zones (Rule 400.2)', () => {
    expect(isPublicZone(Zone.BATTLEFIELD)).toBe(true);
    expect(isPublicZone(Zone.GRAVEYARD)).toBe(true);
    expect(isPublicZone(Zone.STACK)).toBe(true);
    expect(isPublicZone(Zone.EXILE)).toBe(true);
    expect(isPublicZone(Zone.COMMAND)).toBe(true);
  });

  it('should identify hidden zones (Rule 400.2)', () => {
    expect(isHiddenZone(Zone.LIBRARY)).toBe(true);
    expect(isHiddenZone(Zone.HAND)).toBe(true);
    expect(isHiddenZone(Zone.BATTLEFIELD)).toBe(false);
  });
});

describe('Rule 401 - Library', () => {
  it('should create a library (Rule 401.1)', () => {
    const library = createLibrary('player1', ['card1', 'card2', 'card3']);
    expect(library.ownerId).toBe('player1');
    expect(library.cards).toEqual(['card1', 'card2', 'card3']);
  });

  it('should get the top card (Rule 401.2)', () => {
    const library = createLibrary('player1', ['card1', 'card2', 'card3']);
    expect(getTopCard(library)).toBe('card3'); // Top of library
  });

  it('should count library size (Rule 401.3)', () => {
    const library = createLibrary('player1', ['card1', 'card2', 'card3']);
    expect(getLibrarySize(library)).toBe(3);
  });

  it('should put card on top of library', () => {
    let library = createLibrary('player1', ['card1', 'card2']);
    library = putCardInLibrary(library, 'card3', 'top');
    expect(getTopCard(library)).toBe('card3');
    expect(library.cards).toEqual(['card1', 'card2', 'card3']);
  });

  it('should put card on bottom of library', () => {
    let library = createLibrary('player1', ['card1', 'card2']);
    library = putCardInLibrary(library, 'card0', 'bottom');
    expect(library.cards).toEqual(['card0', 'card1', 'card2']);
  });

  it('should put card Nth from top (Rule 401.7)', () => {
    let library = createLibrary('player1', ['card1', 'card2', 'card3', 'card4']);
    library = putCardInLibrary(library, 'cardNew', 2); // 2nd from top
    expect(library.cards).toEqual(['card1', 'card2', 'cardNew', 'card3', 'card4']);
  });

  it('should put card on bottom if library has fewer than N cards (Rule 401.7)', () => {
    let library = createLibrary('player1', ['card1']);
    library = putCardInLibrary(library, 'cardNew', 5); // Library only has 1 card
    expect(library.cards).toEqual(['cardNew', 'card1']); // Goes to bottom
  });
});

describe('Rule 402 - Hand', () => {
  it('should create an empty hand (Rule 402.1)', () => {
    const hand = createHand('player1');
    expect(hand.ownerId).toBe('player1');
    expect(hand.cards).toEqual([]);
  });

  it('should have maximum hand size of 7 (Rule 402.2)', () => {
    expect(getMaximumHandSize()).toBe(7);
  });

  it('should get hand size (Rule 402.3)', () => {
    let hand = createHand('player1');
    hand = addCardToHand(hand, 'card1');
    hand = addCardToHand(hand, 'card2');
    expect(getHandSize(hand)).toBe(2);
  });

  it('should add and remove cards from hand', () => {
    let hand = createHand('player1');
    hand = addCardToHand(hand, 'card1');
    hand = addCardToHand(hand, 'card2');
    expect(hand.cards).toEqual(['card1', 'card2']);
    
    hand = removeCardFromHand(hand, 'card1');
    expect(hand.cards).toEqual(['card2']);
  });
});

describe('Rule 403 - Battlefield', () => {
  it('should create an empty battlefield (Rule 403.1)', () => {
    const battlefield = createBattlefield();
    expect(battlefield.permanents).toEqual([]);
  });

  it('should check if permanent is on battlefield (Rule 403.3)', () => {
    let battlefield = createBattlefield();
    expect(isPermanentOnBattlefield(battlefield, 'permanent1')).toBe(false);
    
    battlefield = addPermanentToBattlefield(battlefield, 'permanent1');
    expect(isPermanentOnBattlefield(battlefield, 'permanent1')).toBe(true);
  });

  it('should add permanents to battlefield (Rule 403.4)', () => {
    let battlefield = createBattlefield();
    battlefield = addPermanentToBattlefield(battlefield, 'permanent1');
    battlefield = addPermanentToBattlefield(battlefield, 'permanent2');
    expect(battlefield.permanents).toEqual(['permanent1', 'permanent2']);
  });

  it('should remove permanents from battlefield', () => {
    let battlefield = createBattlefield();
    battlefield = addPermanentToBattlefield(battlefield, 'permanent1');
    battlefield = addPermanentToBattlefield(battlefield, 'permanent2');
    battlefield = removePermanentFromBattlefield(battlefield, 'permanent1');
    expect(battlefield.permanents).toEqual(['permanent2']);
  });
});

describe('Rule 404 - Graveyard', () => {
  it('should create an empty graveyard (Rule 404.1)', () => {
    const graveyard = createGraveyard('player1');
    expect(graveyard.ownerId).toBe('player1');
    expect(graveyard.cards).toEqual([]);
  });

  it('should put cards on top of graveyard (Rule 404.1)', () => {
    let graveyard = createGraveyard('player1');
    graveyard = putCardInGraveyard(graveyard, 'card1');
    graveyard = putCardInGraveyard(graveyard, 'card2');
    expect(getTopGraveyardCard(graveyard)).toBe('card2');
  });

  it('should examine graveyard cards (Rule 404.2)', () => {
    let graveyard = createGraveyard('player1');
    graveyard = putCardInGraveyard(graveyard, 'card1');
    graveyard = putCardInGraveyard(graveyard, 'card2');
    expect(getGraveyardCards(graveyard)).toEqual(['card1', 'card2']);
  });
});

describe('Rule 405 - Stack', () => {
  it('should create an empty stack (Rule 405.1)', () => {
    const stack = createStack();
    expect(stack.objects).toEqual([]);
    expect(isStackEmpty(stack)).toBe(true);
  });

  it('should put objects on top of stack (Rule 405.2)', () => {
    let stack = createStack();
    const spell1: StackObject = { id: 'spell1', type: 'spell', controllerId: 'player1' };
    const spell2: StackObject = { id: 'spell2', type: 'spell', controllerId: 'player2' };
    
    stack = pushToStack(stack, spell1);
    stack = pushToStack(stack, spell2);
    
    expect(getTopStackObject(stack)).toEqual(spell2);
    expect(stack.objects).toEqual([spell1, spell2]);
  });

  it('should resolve top object when popping (Rule 405.5)', () => {
    let stack = createStack();
    const spell1: StackObject = { id: 'spell1', type: 'spell', controllerId: 'player1' };
    const spell2: StackObject = { id: 'spell2', type: 'spell', controllerId: 'player2' };
    
    stack = pushToStack(stack, spell1);
    stack = pushToStack(stack, spell2);
    
    const { stack: newStack, object } = popFromStack(stack);
    expect(object).toEqual(spell2);
    expect(getTopStackObject(newStack)).toEqual(spell1);
  });

  it('should handle empty stack when popping', () => {
    const stack = createStack();
    const { stack: newStack, object } = popFromStack(stack);
    expect(object).toBeUndefined();
    expect(newStack.objects).toEqual([]);
  });
});

describe('Rule 406 - Exile', () => {
  it('should create an empty exile zone (Rule 406.1)', () => {
    const exile = createExile();
    expect(exile.cards).toEqual([]);
  });

  it('should exile cards face up by default (Rule 406.3)', () => {
    let exile = createExile();
    exile = exileCard(exile, 'card1');
    expect(exile.cards[0].faceDown).toBe(false);
  });

  it('should exile cards face down (Rule 406.3)', () => {
    let exile = createExile();
    exile = exileCard(exile, 'card1', true, ['player1']);
    expect(exile.cards[0].faceDown).toBe(true);
    expect(exile.cards[0].canBeExaminedBy).toEqual(['player1']);
  });

  it('should allow anyone to examine face-up exiled cards (Rule 406.3)', () => {
    let exile = createExile();
    exile = exileCard(exile, 'card1', false);
    expect(canExamineExiledCard(exile.cards[0], 'player1')).toBe(true);
    expect(canExamineExiledCard(exile.cards[0], 'player2')).toBe(true);
  });

  it('should restrict examination of face-down exiled cards (Rule 406.3)', () => {
    let exile = createExile();
    exile = exileCard(exile, 'card1', true, ['player1']);
    expect(canExamineExiledCard(exile.cards[0], 'player1')).toBe(true);
    expect(canExamineExiledCard(exile.cards[0], 'player2')).toBe(false);
  });
});

describe('Rule 408 - Command Zone', () => {
  it('should create an empty command zone (Rule 408.1)', () => {
    const commandZone = createCommandZone();
    expect(commandZone.objects).toEqual([]);
  });

  it('should add objects to command zone (Rule 408.2-408.3)', () => {
    let commandZone = createCommandZone();
    commandZone = addToCommandZone(commandZone, 'emblem1');
    commandZone = addToCommandZone(commandZone, 'commander1');
    expect(isInCommandZone(commandZone, 'emblem1')).toBe(true);
    expect(isInCommandZone(commandZone, 'commander1')).toBe(true);
  });
});

describe('Rule 400.11 - Outside the Game', () => {
  it('should create a sideboard (Rule 400.11a)', () => {
    const sideboard = createSideboard('player1', ['card1', 'card2', 'card3']);
    expect(sideboard.ownerId).toBe('player1');
    expect(sideboard.cards).toEqual(['card1', 'card2', 'card3']);
  });

  it('should check if card is in sideboard', () => {
    const sideboard = createSideboard('player1', ['card1', 'card2']);
    expect(isSideboardCard(sideboard, 'card1')).toBe(true);
    expect(isSideboardCard(sideboard, 'card3')).toBe(false);
  });
});

describe('Zone State Integration', () => {
  it('should create complete zone state for a game', () => {
    const zoneState = createZoneState(['player1', 'player2']);
    
    expect(zoneState.libraries.size).toBe(2);
    expect(zoneState.hands.size).toBe(2);
    expect(zoneState.graveyards.size).toBe(2);
    expect(zoneState.sideboards.size).toBe(2);
    
    expect(zoneState.libraries.get('player1')).toBeDefined();
    expect(zoneState.hands.get('player1')).toBeDefined();
    expect(zoneState.graveyards.get('player1')).toBeDefined();
    
    expect(zoneState.battlefield).toBeDefined();
    expect(zoneState.stack).toBeDefined();
    expect(zoneState.exile).toBeDefined();
    expect(zoneState.commandZone).toBeDefined();
  });
});
