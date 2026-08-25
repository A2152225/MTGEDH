/**
 * keyword-trigger-handlers/keywordTriggerTypes.ts
 * Origin parent: server/src/state/modules/keyword-handlers.ts
 * Cluster moved: KeywordTriggerResult, KeywordTriggerContext.
 * Public entry symbols: KeywordTriggerResult, KeywordTriggerContext.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Result of processing a keyword trigger
 */
export interface KeywordTriggerResult {
  keyword: string;
  processed: boolean;
  effect?: string;
  countersAdded?: { type: string; count: number };
  tokensCreated?: { count: number; type: string };
  lifeChange?: { player: string; amount: number };
  damage?: { target: string; amount: number };
  sacrifice?: { player: string; count: number; type?: string };
  ptModification?: { power: number; toughness: number; duration: 'permanent' | 'end_of_turn' | 'end_of_combat' };
  affectedPermanentIds?: string[];
  requiresPlayerChoice?: {
    type: string;
    options?: any[];
    playerId: string;
    permanentId: string;
    value?: number;
    hauntCardId?: string;
    ownerId?: string;
  };
  chatMessage?: string;
}

/**
 * Context for processing keyword triggers
 */
export interface KeywordTriggerContext {
  gameId: string;
  permanent: any;
  controller: string;
  state: any;
  battlefield: any[];
  players: any[];
  activePlayer: string;
  defendingPlayer?: string;
  attackingCreatures?: any[];
  blockingCreatures?: any[];
  blockingCreatureIds?: string[];
  spellCast?: any;
  damageDealingCreature?: any;
  damageAmount?: number;
  enteringCreature?: any; // For evolve
  dyingCreature?: any;    // For death triggers
}
