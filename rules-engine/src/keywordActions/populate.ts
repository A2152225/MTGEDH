/**
 * Rule 701.36: Populate
 * 
 * To populate means to choose a creature token you control and create a token
 * that's a copy of that creature token.
 * 
 * Reference: Rule 701.36
 */

import type { BattlefieldPermanent, PlayerID } from '../../../shared/src';

export interface PopulateAction {
  readonly type: 'populate';
  readonly playerId: string;
  readonly chosenTokenId?: string; // Token to copy
}

/**
 * Rule 701.36a: Populate
 * 
 * To populate means to choose a creature token you control and create a token
 * that's a copy of that creature token.
 */
export function populate(playerId: string, chosenTokenId?: string): PopulateAction {
  return {
    type: 'populate',
    playerId,
    chosenTokenId,
  };
}

/**
 * Rule 701.36b: No creature tokens
 * 
 * If you control no creature tokens when instructed to populate, you won't
 * create a token.
 */
export function canPopulate(creatureTokens: readonly string[]): boolean {
  return creatureTokens.length > 0;
}

/**
 * Get all creature tokens a player controls that can be populated
 */
export function getPopulateTargets(
  battlefield: readonly BattlefieldPermanent[],
  playerId: PlayerID
): BattlefieldPermanent[] {
  return battlefield.filter(perm => {
    // Must be controlled by the player
    if (perm.controller !== playerId) return false;
    
    // Must be a token
    if (!perm.isToken) return false;
    
    // Must be a creature
    const typeLine = (perm.card as any)?.type_line?.toLowerCase() || '';
    return typeLine.includes('creature');
  });
}

/**
 * Complete populate action with chosen token
 */
export function completePopulate(
  playerId: string,
  chosenTokenId: string
): PopulateAction {
  return {
    type: 'populate',
    playerId,
    chosenTokenId,
  };
}

/**
 * Populate result
 */
export interface PopulateResult {
  readonly populated: boolean;
  readonly originalTokenId: string | null;
  readonly newTokenId: string | null;
  readonly newToken?: BattlefieldPermanent;
}

export function createPopulateResult(
  originalTokenId: string | null,
  newTokenId: string | null,
  newToken?: BattlefieldPermanent
): PopulateResult {
  return {
    populated: originalTokenId !== null && newTokenId !== null,
    originalTokenId,
    newTokenId,
    newToken,
  };
}

/**
 * Simple UUID generator for token IDs
 */
function generateTokenId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Execute populate - create a token copy of the chosen creature token
 * 
 * Rule 701.36a: To populate means to choose a creature token you control
 * and create a token that's a copy of that creature token.
 */
export function executePopulate(
  battlefield: readonly BattlefieldPermanent[],
  playerId: PlayerID,
  chosenTokenId: string
): PopulateResult {
  // Find the chosen token
  const originalToken = battlefield.find(
    perm => perm.id === chosenTokenId && 
            perm.controller === playerId && 
            perm.isToken
  );
  
  if (!originalToken) {
    return createPopulateResult(null, null);
  }
  
  // Create a copy of the token
  const newTokenId = `token-${generateTokenId()}`;
  const originalCard = originalToken.card as any;
  
  const newToken: BattlefieldPermanent = {
    id: newTokenId,
    controller: playerId,
    owner: playerId,
    tapped: false,
    summoningSickness: true, // Creature tokens have summoning sickness
    counters: {}, // Counters are not copied when populating (Rule 701.36)
    attachedTo: undefined,
    attachments: [],
    modifiers: [],
    card: {
      id: newTokenId,
      name: originalCard?.name || 'Token',
      type_line: originalCard?.type_line || 'Token Creature',
      oracle_text: originalCard?.oracle_text || '',
      power: originalCard?.power,
      toughness: originalCard?.toughness,
      colors: originalCard?.colors ? [...originalCard.colors] : [],
      mana_cost: '',
      cmc: 0,
      image_uris: originalCard?.image_uris || {},
    } as any,
    basePower: originalToken.basePower,
    baseToughness: originalToken.baseToughness,
    isToken: true,
  };
  
  return createPopulateResult(chosenTokenId, newTokenId, newToken);
}
