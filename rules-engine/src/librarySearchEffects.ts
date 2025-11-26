/**
 * librarySearchEffects.ts
 * 
 * Handles effects that modify or restrict library searching.
 * 
 * Key cards implemented:
 * - Aven Mindcensor: Search top 4 cards instead of entire library
 * - Leonin Arbiter: Players can't search libraries (can pay {2} to ignore)
 * - Stranglehold: Opponents can't search libraries
 * - Ob Nixilis, Unshackled: Opponent searches trigger sacrifice + life loss
 * - Opposition Agent: Control opponents while they search
 * - Ashiok, Dream Render: Opponents can't search libraries
 * - Shadow of Doubt: Players can't search libraries this turn
 * - Mindlock Orb: Players can't search libraries
 * - Maralen of the Mornsong: Players can't draw cards, search library at upkeep
 */

/**
 * Library search restriction types
 */
export type SearchRestrictionType = 
  | 'cannot_search'           // Leonin Arbiter, Stranglehold, Ashiok
  | 'limited_search'          // Aven Mindcensor (top N cards only)
  | 'search_triggers_effect'  // Ob Nixilis (triggers on search)
  | 'opponent_controls'       // Opposition Agent
  | 'pay_to_search';          // Leonin Arbiter ({2} to ignore)

/**
 * Library search restriction effect
 */
export interface LibrarySearchRestriction {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly type: SearchRestrictionType;
  readonly affectsOpponents: boolean;
  readonly affectsSelf: boolean;
  readonly limitedSearchCount?: number;  // For Aven Mindcensor: 4
  readonly paymentToIgnore?: string;     // For Leonin Arbiter: "{2}"
  readonly triggerEffect?: string;       // For Ob Nixilis: "sacrifice creature and lose 10 life"
  readonly duration?: 'permanent' | 'until_end_of_turn';
}

/**
 * Result of checking search restrictions
 */
export interface SearchRestrictionResult {
  readonly canSearch: boolean;
  readonly restrictions: readonly LibrarySearchRestriction[];
  readonly limitedToTopN?: number;
  readonly paymentRequired?: string;
  readonly triggerEffects: readonly LibrarySearchRestriction[];
  readonly controlledBy?: string;  // For Opposition Agent
  readonly reason?: string;
}

/**
 * Known cards with library search restrictions
 */
export const KNOWN_SEARCH_RESTRICTIONS: Record<string, Omit<LibrarySearchRestriction, 'id' | 'sourceId' | 'controllerId'>> = {
  "aven mindcensor": {
    sourceName: "Aven Mindcensor",
    type: 'limited_search',
    affectsOpponents: true,
    affectsSelf: false,
    limitedSearchCount: 4,
    duration: 'permanent',
  },
  "leonin arbiter": {
    sourceName: "Leonin Arbiter",
    type: 'pay_to_search',
    affectsOpponents: true,
    affectsSelf: true,
    paymentToIgnore: "{2}",
    duration: 'permanent',
  },
  "stranglehold": {
    sourceName: "Stranglehold",
    type: 'cannot_search',
    affectsOpponents: true,
    affectsSelf: false,
    duration: 'permanent',
  },
  "ob nixilis, unshackled": {
    sourceName: "Ob Nixilis, Unshackled",
    type: 'search_triggers_effect',
    affectsOpponents: true,
    affectsSelf: false,
    triggerEffect: "Sacrifice a creature and lose 10 life",
    duration: 'permanent',
  },
  "opposition agent": {
    sourceName: "Opposition Agent",
    type: 'opponent_controls',
    affectsOpponents: true,
    affectsSelf: false,
    duration: 'permanent',
  },
  "ashiok, dream render": {
    sourceName: "Ashiok, Dream Render",
    type: 'cannot_search',
    affectsOpponents: true,
    affectsSelf: false,
    duration: 'permanent',
  },
  "mindlock orb": {
    sourceName: "Mindlock Orb",
    type: 'cannot_search',
    affectsOpponents: true,
    affectsSelf: true,
    duration: 'permanent',
  },
  "shadow of doubt": {
    sourceName: "Shadow of Doubt",
    type: 'cannot_search',
    affectsOpponents: true,
    affectsSelf: true,
    duration: 'until_end_of_turn',
  },
};

/**
 * Detect library search restrictions from a permanent's oracle text
 */
export function detectSearchRestrictions(
  card: { name?: string; oracle_text?: string },
  permanentId: string,
  controllerId: string
): LibrarySearchRestriction[] {
  const restrictions: LibrarySearchRestriction[] = [];
  const cardName = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check known cards first
  for (const [knownName, info] of Object.entries(KNOWN_SEARCH_RESTRICTIONS)) {
    if (cardName.includes(knownName)) {
      restrictions.push({
        id: `${permanentId}-search-restriction`,
        sourceId: permanentId,
        controllerId,
        ...info,
      });
      return restrictions; // Known card found, no need for generic detection
    }
  }
  
  // Generic detection for "can't search" effects
  if (oracleText.includes("can't search") || oracleText.includes("cannot search")) {
    const affectsOpponents = oracleText.includes("opponent") || oracleText.includes("your opponents");
    const affectsSelf = !affectsOpponents || oracleText.includes("players can't search");
    
    restrictions.push({
      id: `${permanentId}-search-restriction`,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      type: 'cannot_search',
      affectsOpponents,
      affectsSelf,
      duration: 'permanent',
    });
  }
  
  // Generic detection for "searches the top N cards" effects
  const topNMatch = oracleText.match(/search(?:es)?\s+(?:the\s+)?top\s+(\d+|four|three|five|six|seven)\s+cards?/i);
  if (topNMatch) {
    const countStr = topNMatch[1].toLowerCase();
    const countMap: Record<string, number> = {
      'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7
    };
    const count = countMap[countStr] || parseInt(countStr, 10) || 4;
    
    restrictions.push({
      id: `${permanentId}-limited-search`,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      type: 'limited_search',
      affectsOpponents: oracleText.includes("opponent"),
      affectsSelf: !oracleText.includes("opponent"),
      limitedSearchCount: count,
      duration: 'permanent',
    });
  }
  
  // Generic detection for "whenever a player/opponent searches"
  if (oracleText.includes("whenever") && oracleText.includes("search")) {
    const affectsOpponents = oracleText.includes("opponent");
    
    // Extract the effect (text after the trigger condition)
    const effectMatch = oracleText.match(/whenever.*?search.*?(?:library|libraries),?\s*([^.]+)/i);
    const triggerEffect = effectMatch ? effectMatch[1].trim() : 'triggered effect';
    
    restrictions.push({
      id: `${permanentId}-search-trigger`,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      type: 'search_triggers_effect',
      affectsOpponents,
      affectsSelf: !affectsOpponents,
      triggerEffect,
      duration: 'permanent',
    });
  }
  
  return restrictions;
}

/**
 * Get all active search restrictions from the battlefield
 */
export function getActiveSearchRestrictions(
  battlefield: readonly { id: string; controller: string; card?: { name?: string; oracle_text?: string } }[]
): LibrarySearchRestriction[] {
  const restrictions: LibrarySearchRestriction[] = [];
  
  for (const permanent of battlefield) {
    if (!permanent.card) continue;
    
    const permRestrictions = detectSearchRestrictions(
      permanent.card,
      permanent.id,
      permanent.controller
    );
    
    restrictions.push(...permRestrictions);
  }
  
  return restrictions;
}

/**
 * Check if a player can search their library given current restrictions
 */
export function checkSearchRestrictions(
  searchingPlayerId: string,
  libraryOwnerId: string,
  allRestrictions: readonly LibrarySearchRestriction[],
  activePlayerId: string
): SearchRestrictionResult {
  const applicableRestrictions: LibrarySearchRestriction[] = [];
  const triggerEffects: LibrarySearchRestriction[] = [];
  let canSearch = true;
  let limitedToTopN: number | undefined;
  let paymentRequired: string | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  
  for (const restriction of allRestrictions) {
    // Determine if this restriction applies to the searching player
    const isOpponent = restriction.controllerId !== searchingPlayerId;
    const applies = (isOpponent && restriction.affectsOpponents) ||
                   (!isOpponent && restriction.affectsSelf);
    
    if (!applies) continue;
    
    applicableRestrictions.push(restriction);
    
    switch (restriction.type) {
      case 'cannot_search':
        canSearch = false;
        reason = `${restriction.sourceName} prevents searching`;
        break;
        
      case 'pay_to_search':
        // Can search but must pay
        paymentRequired = restriction.paymentToIgnore;
        break;
        
      case 'limited_search':
        // Can search but only top N cards
        if (limitedToTopN === undefined || 
            (restriction.limitedSearchCount && restriction.limitedSearchCount < limitedToTopN)) {
          limitedToTopN = restriction.limitedSearchCount;
        }
        break;
        
      case 'search_triggers_effect':
        // Can search but triggers an effect
        triggerEffects.push(restriction);
        break;
        
      case 'opponent_controls':
        // Opponent controls the search
        controlledBy = restriction.controllerId;
        break;
    }
  }
  
  return {
    canSearch,
    restrictions: applicableRestrictions,
    limitedToTopN,
    paymentRequired,
    triggerEffects,
    controlledBy,
    reason,
  };
}

/**
 * Get the cards available for search based on restrictions
 * Returns a subset of the library if limited search applies (e.g., Aven Mindcensor)
 */
export function getSearchableCards<T>(
  library: readonly T[],
  restrictions: SearchRestrictionResult
): T[] {
  if (!restrictions.canSearch) {
    return [];
  }
  
  if (restrictions.limitedToTopN !== undefined) {
    // Only return top N cards
    return library.slice(0, restrictions.limitedToTopN) as T[];
  }
  
  // Full library search allowed
  return [...library];
}

/**
 * Create a search restriction message for the UI
 */
export function createSearchRestrictionMessage(result: SearchRestrictionResult): string {
  const messages: string[] = [];
  
  if (!result.canSearch) {
    return result.reason || "You cannot search your library";
  }
  
  if (result.limitedToTopN !== undefined) {
    messages.push(`Search limited to top ${result.limitedToTopN} cards`);
  }
  
  if (result.paymentRequired) {
    messages.push(`Must pay ${result.paymentRequired} to search`);
  }
  
  if (result.triggerEffects.length > 0) {
    for (const trigger of result.triggerEffects) {
      messages.push(`${trigger.sourceName}: ${trigger.triggerEffect}`);
    }
  }
  
  if (result.controlledBy) {
    messages.push(`Search controlled by opponent`);
  }
  
  return messages.join('. ');
}

export default {
  KNOWN_SEARCH_RESTRICTIONS,
  detectSearchRestrictions,
  getActiveSearchRestrictions,
  checkSearchRestrictions,
  getSearchableCards,
  createSearchRestrictionMessage,
};
