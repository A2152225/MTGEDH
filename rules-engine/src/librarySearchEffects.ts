/**
 * librarySearchEffects.ts
 *
 * Oracle-pattern library-search restrictions. Live play uses
 * evaluateLibrarySearchReplacementEvent; this helper is the same families
 * without card-name routing.
 *
 * Families: can't-search / pay-to-ignore, top-N instead, opponent-controls-search,
 * whenever-search triggers, this-turn duration.
 */

/**
 * Library search restriction types
 */
export type SearchRestrictionType = 
  | 'cannot_search'
  | 'limited_search'
  | 'search_triggers_effect'
  | 'opponent_controls'
  | 'pay_to_search';

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

function cannotSearchAudience(oracleText: string): { affectsOpponents: boolean; affectsSelf: boolean } {
  if (/players can(?:not|'t)\s+search/i.test(oracleText)) {
    return { affectsOpponents: true, affectsSelf: true };
  }
  const affectsOpponents = /\bopponents?\b/.test(oracleText);
  return { affectsOpponents, affectsSelf: !affectsOpponents };
}

function hasCannotSearchClause(oracleText: string): boolean {
  return /can(?:not|'t)\s+search/i.test(oracleText)
    || /can(?:not|'t)\s+cause\b[^.]*\bsearch/i.test(oracleText);
}

/**
 * Detect library search restrictions from a permanent's oracle text.
 * No card-name routing — live play uses evaluateLibrarySearchReplacementEvent.
 */
export function detectSearchRestrictions(
  card: { name?: string; oracle_text?: string },
  permanentId: string,
  controllerId: string
): LibrarySearchRestriction[] {
  const restrictions: LibrarySearchRestriction[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const sourceName = card.name || 'Unknown';

  const payMatch = oracleText.match(/pay\s+(\{[^}]+\})/i);
  if (
    payMatch
    && hasCannotSearchClause(oracleText)
    && /ignore this effect/i.test(oracleText)
  ) {
    restrictions.push({
      id: `${permanentId}-search-restriction`,
      sourceId: permanentId,
      sourceName,
      controllerId,
      type: 'pay_to_search',
      affectsOpponents: true,
      affectsSelf: true,
      paymentToIgnore: payMatch[1],
      duration: 'permanent',
    });
  } else if (hasCannotSearchClause(oracleText)) {
    const { affectsOpponents, affectsSelf } = cannotSearchAudience(oracleText);
    const duration =
      /\bthis turn\b/.test(oracleText) ? 'until_end_of_turn' : 'permanent';
    restrictions.push({
      id: `${permanentId}-search-restriction`,
      sourceId: permanentId,
      sourceName,
      controllerId,
      type: 'cannot_search',
      affectsOpponents,
      affectsSelf,
      duration,
    });
  }

  if (/you control (?:your )?opponents? while (?:they(?:'re| are)) searching/i.test(oracleText)) {
    restrictions.push({
      id: `${permanentId}-search-control`,
      sourceId: permanentId,
      sourceName,
      controllerId,
      type: 'opponent_controls',
      affectsOpponents: true,
      affectsSelf: false,
      duration: 'permanent',
    });
  }

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
      sourceName,
      controllerId,
      type: 'limited_search',
      affectsOpponents: oracleText.includes('opponent'),
      affectsSelf: !oracleText.includes('opponent'),
      limitedSearchCount: count,
      duration: 'permanent',
    });
  }

  if (oracleText.includes('whenever') && oracleText.includes('search')) {
    const affectsOpponents = oracleText.includes('opponent');
    const effectMatch = oracleText.match(/whenever.*?search.*?(?:library|libraries),?\s*([^.]+)/i);
    const triggerEffect = effectMatch ? effectMatch[1].trim() : 'triggered effect';

    restrictions.push({
      id: `${permanentId}-search-trigger`,
      sourceId: permanentId,
      sourceName,
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
  detectSearchRestrictions,
  getActiveSearchRestrictions,
  checkSearchRestrictions,
  getSearchableCards,
  createSearchRestrictionMessage,
};
