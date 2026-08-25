// server/src/socket/util-handlers/librarySearchHelpers.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: checkLibrarySearchRestrictions, parseSearchFilter.
// Public entry symbols: checkLibrarySearchRestrictions.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { evaluateLibrarySearchReplacementEvent } from "../../state/modules/replacement-effects.js";

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/**
 * Check for search restrictions affecting a player
 */
export function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const result = evaluateLibrarySearchReplacementEvent({ game, searchingPlayerId });
  const metadata = (result.metadata || {}) as any;
  
  return {
    canSearch: metadata.canSearch !== false,
    limitToTop: typeof metadata.limitToTop === 'number' ? metadata.limitToTop : undefined,
    triggerEffects: Array.isArray(metadata.triggerEffects) ? metadata.triggerEffects : [],
    controlledBy: metadata.controlledBy,
    reason: metadata.reason,
    paymentRequired: metadata.paymentRequired,
  };
}



/**
 * Parse search criteria string into a filter object for library search.
 * E.g., "basic land card" -> { types: ['land'], supertypes: ['basic'] }
 * E.g., "planeswalker card" -> { types: ['planeswalker'] }
 * 
 * The filter format must match LibrarySearchModalProps['filter']:
 * - types: string[] (e.g., ['creature', 'planeswalker'])
 * - subtypes: string[] (e.g., ['forest', 'equipment'])
 * - supertypes: string[] (e.g., ['basic', 'legendary'])
 * - maxCmc: number
 */
function parseSearchFilter(criteria: string): { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } {
  if (!criteria) return {};
  
  const filter: { types?: string[]; subtypes?: string[]; supertypes?: string[]; maxCmc?: number } = {};
  const text = criteria.toLowerCase();
  
  // Card types - must be in types array for client filter to work
  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('land')) types.push('land');
  if (text.includes('tribal') || text.includes('kindred')) types.push('tribal');
  if (text.includes('battle')) types.push('battle');
  
  // Special composite types (these are handled specially by client matchesFilter)
  if (text.includes('historic')) types.push('historic');
  if (text.includes('permanent')) types.push('permanent');
  if (text.includes('noncreature')) types.push('noncreature');
  if (text.includes('nonland')) types.push('nonland');
  if (text.includes('nonartifact')) types.push('nonartifact');
  
  if (types.length > 0) {
    filter.types = types;
  }
  
  // Supertypes (Basic, Legendary, Snow, World, Ongoing)
  // Note: 'host' is included for consistency with existing code, though per MTG rules it's a creature type
  const supertypes: string[] = [];
  if (text.includes('basic')) supertypes.push('basic');
  if (text.includes('legendary')) supertypes.push('legendary');
  if (text.includes('snow')) supertypes.push('snow');
  if (text.includes('world')) supertypes.push('world');
  if (text.includes('ongoing')) supertypes.push('ongoing');
  if (text.includes('host')) supertypes.push('host');
  
  if (supertypes.length > 0) {
    filter.supertypes = supertypes;
  }
  
  // Subtypes (land types, creature types, etc.)
  const subtypes: string[] = [];
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('equipment')) subtypes.push('equipment');
  if (text.includes('aura')) subtypes.push('aura');
  if (text.includes('vehicle')) subtypes.push('vehicle');
  
  if (subtypes.length > 0) {
    filter.subtypes = subtypes;
  }
  
  // CMC restrictions
  const cmcMatch = text.match(/mana value (\d+) or less/);
  if (cmcMatch) {
    filter.maxCmc = parseInt(cmcMatch[1], 10);
  }
  
  return filter;
}
