/**
 * castingRestrictions.ts
 * 
 * Implements temporary casting restrictions - effects that prevent players
 * from casting spells or activating abilities for a duration (usually until end of turn).
 * 
 * Common restriction cards:
 * - Silence: "Your opponents can't cast spells this turn"
 * - Orim's Chant: "Target player can't cast spells this turn" + optional kicker
 * - Grand Abolisher: "During your turn, your opponents can't cast spells or activate abilities"
 * - Teferi, Time Raveler: "Each opponent can only cast spells any time they could cast a sorcery"
 * - Drannith Magistrate: "Your opponents can't cast spells from anywhere other than their hands"
 * - Rule of Law: "Each player can't cast more than one spell each turn"
 * - Arcane Laboratory: Same as Rule of Law
 * - Deafening Silence: "Each player can't cast more than one noncreature spell each turn"
 * - Ethersworn Canonist: "Each player can't cast more than one nonartifact spell each turn"
 * - Lavinia, Azorius Renegade: "Each opponent can't cast noncreature spells with CMC > lands they control"
 * - Void Mirror: "Counter each spell that wasn't cast using mana of a color"
 * - Chalice of the Void: "Counter each spell with CMC = X"
 * - Trinisphere: "Each spell costs at least {3}"
 * 
 * Rule 101.2: When a rule or effect allows or directs something to happen, and another effect states
 * that it can't happen, the "can't" effect takes precedence.
 */

import type { GameState, BattlefieldPermanent } from '../../shared/src';

/**
 * Types of casting restrictions
 */
export enum CastingRestrictionType {
  // Complete spell blocks
  CANT_CAST_SPELLS = 'cant_cast_spells',           // Silence
  CANT_CAST_NONCREATURE = 'cant_cast_noncreature', // Deafening Silence
  CANT_CAST_NONARTIFACT = 'cant_cast_nonartifact', // Ethersworn Canonist
  
  // Spell limit per turn
  ONE_SPELL_PER_TURN = 'one_spell_per_turn',       // Rule of Law
  ONE_NONCREATURE_PER_TURN = 'one_noncreature_per_turn', // Deafening Silence
  ONE_NONARTIFACT_PER_TURN = 'one_nonartifact_per_turn', // Ethersworn Canonist
  
  // Timing restrictions
  SORCERY_SPEED_ONLY = 'sorcery_speed_only',       // Teferi, Time Raveler
  OPPONENTS_TURN_ONLY = 'opponents_turn_only',     // Delirium, etc.
  YOUR_TURN_ONLY = 'your_turn_only',               // Most sorceries
  
  // Source restrictions
  HAND_ONLY = 'hand_only',                         // Drannith Magistrate
  
  // Ability restrictions
  CANT_ACTIVATE_ABILITIES = 'cant_activate_abilities', // Grand Abolisher
  CANT_ACTIVATE_NONMANA = 'cant_activate_nonmana',     // Suppression Field (for free)
  
  // CMC-based restrictions
  CMC_RESTRICTION = 'cmc_restriction',             // Lavinia, Chalice of the Void
  
  // Custom
  CUSTOM = 'custom',
}

/**
 * Duration of the restriction
 */
export enum RestrictionDuration {
  END_OF_TURN = 'end_of_turn',       // "this turn"
  UNTIL_END_OF_PHASE = 'end_of_phase',
  WHILE_SOURCE_ON_BATTLEFIELD = 'while_on_battlefield', // Continuous effects
  UNTIL_LEAVES_BATTLEFIELD = 'until_leaves',
  PERMANENT = 'permanent',           // Static abilities
}

/**
 * Represents a casting restriction effect
 */
export interface CastingRestriction {
  readonly id: string;                // Unique ID for this restriction
  readonly sourceId: string;          // ID of the permanent/spell creating this
  readonly sourceName: string;        // Name of the source
  readonly sourceControllerId: string; // Who controls the source
  readonly type: CastingRestrictionType;
  readonly duration: RestrictionDuration;
  readonly affectedPlayers: 'opponents' | 'all' | 'target' | 'controller';
  readonly targetPlayerId?: string;   // For targeted effects like Orim's Chant
  readonly spellTypeRestriction?: string; // e.g., "noncreature", "nonartifact"
  readonly cmcRestriction?: {         // For CMC-based restrictions
    comparison: 'equals' | 'less_than' | 'greater_than' | 'less_equal' | 'greater_equal';
    value: number;
  };
  readonly onlyDuringYourTurn?: boolean; // Grand Abolisher
  readonly timestamp: number;         // When this restriction was created
  readonly expiresAtEndOfTurn?: boolean; // Silence-style "this turn" effects
}

/**
 * Result of checking if a spell can be cast
 */
export interface CastingCheckResult {
  readonly canCast: boolean;
  readonly reason?: string;
  readonly blockingRestrictions: CastingRestriction[];
}

/**
 * Patterns to detect casting restrictions from oracle text
 */
const RESTRICTION_PATTERNS: {
  pattern: RegExp;
  type: CastingRestrictionType;
  affectedPlayers: CastingRestriction['affectedPlayers'];
  duration: RestrictionDuration;
  extractor?: (match: RegExpMatchArray, oracleText: string) => Partial<CastingRestriction>;
}[] = [
  // "Your opponents can't cast spells this turn" (Silence)
  {
    pattern: /your\s+opponents?\s+can't\s+cast\s+spells?\s+this\s+turn/i,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.END_OF_TURN,
    extractor: () => ({ expiresAtEndOfTurn: true }),
  },
  
  // "Target player can't cast spells this turn" (Orim's Chant)
  {
    pattern: /target\s+player\s+can't\s+cast\s+spells?\s+this\s+turn/i,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    affectedPlayers: 'target',
    duration: RestrictionDuration.END_OF_TURN,
    extractor: () => ({ expiresAtEndOfTurn: true }),
  },
  
  // "Each player can't cast more than one spell each turn" (Rule of Law)
  {
    pattern: /each\s+player\s+can't\s+cast\s+more\s+than\s+one\s+spell\s+each\s+turn/i,
    type: CastingRestrictionType.ONE_SPELL_PER_TURN,
    affectedPlayers: 'all',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
  },
  
  // "Each player can't cast more than one noncreature spell each turn" (Deafening Silence)
  {
    pattern: /each\s+player\s+can't\s+cast\s+more\s+than\s+one\s+noncreature\s+spell/i,
    type: CastingRestrictionType.ONE_NONCREATURE_PER_TURN,
    affectedPlayers: 'all',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
    extractor: () => ({ spellTypeRestriction: 'noncreature' }),
  },
  
  // "Each player can't cast more than one nonartifact spell each turn" (Ethersworn Canonist)
  {
    pattern: /each\s+player\s+can't\s+cast\s+more\s+than\s+one\s+nonartifact\s+spell/i,
    type: CastingRestrictionType.ONE_NONARTIFACT_PER_TURN,
    affectedPlayers: 'all',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
    extractor: () => ({ spellTypeRestriction: 'nonartifact' }),
  },
  
  // "During your turn, your opponents can't cast spells or activate abilities" (Grand Abolisher)
  {
    pattern: /during\s+your\s+turn.*opponents?\s+can't\s+cast\s+spells?\s+or\s+activate\s+abilities/i,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
    extractor: () => ({ onlyDuringYourTurn: true }),
  },
  
  // "Each opponent can only cast spells any time they could cast a sorcery" (Teferi)
  {
    pattern: /opponent.*can\s+only\s+cast\s+spells?\s+any\s+time.*could\s+cast\s+a\s+sorcery/i,
    type: CastingRestrictionType.SORCERY_SPEED_ONLY,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
  },
  
  // "Your opponents can't cast spells from anywhere other than their hands" (Drannith Magistrate)
  {
    pattern: /opponents?\s+can't\s+cast\s+spells?\s+from\s+anywhere\s+other\s+than\s+their\s+hands?/i,
    type: CastingRestrictionType.HAND_ONLY,
    affectedPlayers: 'opponents',
    duration: RestrictionDuration.WHILE_SOURCE_ON_BATTLEFIELD,
  },
];

/**
 * Detect casting restrictions from a permanent's oracle text
 * 
 * @param permanent - The permanent to check
 * @param controllerId - The controller of the permanent
 * @returns Array of casting restrictions, empty if none found
 */
export function detectCastingRestrictions(
  permanent: BattlefieldPermanent | any,
  controllerId: string
): CastingRestriction[] {
  const restrictions: CastingRestriction[] = [];
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  const cardName = permanent.card?.name || permanent.name || 'Unknown';
  
  // Check for known patterns
  for (const { pattern, type, affectedPlayers, duration, extractor } of RESTRICTION_PATTERNS) {
    const match = oracleText.match(pattern);
    if (match) {
      const extracted = extractor ? extractor(match, oracleText) : {};
      restrictions.push({
        id: `restriction-${permanent.id}-${type}`,
        sourceId: permanent.id,
        sourceName: cardName,
        sourceControllerId: controllerId,
        type,
        duration,
        affectedPlayers,
        timestamp: Date.now(),
        ...extracted,
      });
    }
  }
  
  return restrictions;
}

/**
 * Collect all active casting restrictions in the game
 * 
 * @param state - The game state
 * @returns Map of player ID to their active restrictions
 */
export function collectCastingRestrictions(
  state: GameState
): Map<string, CastingRestriction[]> {
  const playerRestrictions = new Map<string, CastingRestriction[]>();
  
  // Initialize empty arrays for all players
  for (const player of state.players) {
    playerRestrictions.set(player.id, []);
  }
  
  // Check for temporary "this turn" restrictions stored in game state
  const turnRestrictions = (state as any).castingRestrictions || [];
  for (const restriction of turnRestrictions) {
    const affected = getAffectedPlayers(state, restriction);
    for (const playerId of affected) {
      const existing = playerRestrictions.get(playerId) || [];
      existing.push(restriction);
      playerRestrictions.set(playerId, existing);
    }
  }
  
  // Check all permanents for continuous restrictions
  for (const player of state.players) {
    const controllerId = player.id;
    
    for (const permanent of (player.battlefield || []) as any[]) {
      const restrictions = detectCastingRestrictions(permanent, controllerId);
      
      for (const restriction of restrictions) {
        // Skip restrictions that only apply during controller's turn
        if (restriction.onlyDuringYourTurn) {
          const activePlayerIndex = state.activePlayerIndex || 0;
          const activePlayer = state.players[activePlayerIndex];
          if (activePlayer?.id !== controllerId) {
            continue; // Not controller's turn, restriction doesn't apply
          }
        }
        
        // Add to affected players
        const affected = getAffectedPlayers(state, restriction);
        for (const playerId of affected) {
          const existing = playerRestrictions.get(playerId) || [];
          // Avoid duplicates
          if (!existing.some(r => r.id === restriction.id)) {
            existing.push(restriction);
            playerRestrictions.set(playerId, existing);
          }
        }
      }
    }
  }
  
  return playerRestrictions;
}

/**
 * Get the list of player IDs affected by a restriction
 */
function getAffectedPlayers(state: GameState, restriction: CastingRestriction): string[] {
  const affected: string[] = [];
  
  switch (restriction.affectedPlayers) {
    case 'all':
      affected.push(...state.players.map(p => p.id));
      break;
      
    case 'opponents':
      // Opponents of the source controller
      affected.push(...state.players
        .filter(p => p.id !== restriction.sourceControllerId)
        .map(p => p.id));
      break;
      
    case 'controller':
      affected.push(restriction.sourceControllerId);
      break;
      
    case 'target':
      if (restriction.targetPlayerId) {
        affected.push(restriction.targetPlayerId);
      }
      break;
  }
  
  return affected;
}

/**
 * Check if a player can cast a spell given all active restrictions
 * 
 * @param state - The game state
 * @param playerId - The player trying to cast
 * @param spell - The spell being cast
 * @param spellsCastThisTurn - Number of spells already cast this turn
 * @param castingZone - Where the spell is being cast from (default: 'hand')
 * @returns Result indicating if casting is allowed
 */
export function canCastSpell(
  state: GameState,
  playerId: string,
  spell: any,
  spellsCastThisTurn: number = 0,
  castingZone: string = 'hand'
): CastingCheckResult {
  const allRestrictions = collectCastingRestrictions(state);
  const playerRestrictions = allRestrictions.get(playerId) || [];
  
  if (playerRestrictions.length === 0) {
    return { canCast: true, blockingRestrictions: [] };
  }
  
  const blockingRestrictions: CastingRestriction[] = [];
  const typeLine = (spell.type_line || spell.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isArtifact = typeLine.includes('artifact');
  const isInstant = typeLine.includes('instant');
  
  for (const restriction of playerRestrictions) {
    let blocked = false;
    
    switch (restriction.type) {
      case CastingRestrictionType.CANT_CAST_SPELLS:
        blocked = true;
        break;
        
      case CastingRestrictionType.CANT_CAST_NONCREATURE:
        if (!isCreature) {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.CANT_CAST_NONARTIFACT:
        if (!isArtifact) {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.ONE_SPELL_PER_TURN:
        if (spellsCastThisTurn >= 1) {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.ONE_NONCREATURE_PER_TURN:
        // Check noncreature spells cast this turn
        const noncreaturesCast = (state as any).noncreatureSpellsCastThisTurn?.[playerId] || 0;
        if (!isCreature && noncreaturesCast >= 1) {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.ONE_NONARTIFACT_PER_TURN:
        const nonartifactsCast = (state as any).nonartifactSpellsCastThisTurn?.[playerId] || 0;
        if (!isArtifact && nonartifactsCast >= 1) {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.SORCERY_SPEED_ONLY:
        // Player can only cast at sorcery speed - ALL spells need valid sorcery timing
        // This affects both instants AND any spell being cast at non-sorcery timing
        // Support both enum values and string variants for phase comparison
        const phaseStr = String(state.phase || '').toLowerCase();
        const isMainPhase = phaseStr === 'precombatmain' || phaseStr === 'postcombatmain' ||
                            phaseStr === 'precombat_main' || phaseStr === 'postcombat_main' ||
                            phaseStr === 'first_main' || phaseStr === 'main1' || phaseStr === 'main2';
        const activePlayerIndex = state.activePlayerIndex || 0;
        const isOwnTurn = state.players[activePlayerIndex]?.id === playerId;
        const stackEmpty = !state.stack || state.stack.length === 0;
        
        // Block if not at valid sorcery timing (regardless of spell type)
        if (!isMainPhase || !isOwnTurn || !stackEmpty) {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.HAND_ONLY:
        if (castingZone !== 'hand') {
          blocked = true;
        }
        break;
        
      case CastingRestrictionType.CMC_RESTRICTION:
        if (restriction.cmcRestriction) {
          const cmc = spell.cmc || spell.mana_value || 0;
          const { comparison, value } = restriction.cmcRestriction;
          
          switch (comparison) {
            case 'equals':
              if (cmc === value) blocked = true;
              break;
            case 'less_than':
              if (cmc < value) blocked = true;
              break;
            case 'greater_than':
              if (cmc > value) blocked = true;
              break;
            case 'less_equal':
              if (cmc <= value) blocked = true;
              break;
            case 'greater_equal':
              if (cmc >= value) blocked = true;
              break;
          }
        }
        break;
    }
    
    if (blocked) {
      blockingRestrictions.push(restriction);
    }
  }
  
  if (blockingRestrictions.length > 0) {
    const reasons = blockingRestrictions.map(r => 
      `${r.sourceName}: ${getRestrictionDescription(r)}`
    );
    return {
      canCast: false,
      reason: reasons.join('; '),
      blockingRestrictions,
    };
  }
  
  return { canCast: true, blockingRestrictions: [] };
}

/**
 * Get a human-readable description of a restriction
 */
function getRestrictionDescription(restriction: CastingRestriction): string {
  switch (restriction.type) {
    case CastingRestrictionType.CANT_CAST_SPELLS:
      return "can't cast spells";
    case CastingRestrictionType.CANT_CAST_NONCREATURE:
      return "can't cast noncreature spells";
    case CastingRestrictionType.CANT_CAST_NONARTIFACT:
      return "can't cast nonartifact spells";
    case CastingRestrictionType.ONE_SPELL_PER_TURN:
      return "already cast a spell this turn";
    case CastingRestrictionType.ONE_NONCREATURE_PER_TURN:
      return "already cast a noncreature spell this turn";
    case CastingRestrictionType.ONE_NONARTIFACT_PER_TURN:
      return "already cast a nonartifact spell this turn";
    case CastingRestrictionType.SORCERY_SPEED_ONLY:
      return "can only cast spells at sorcery speed";
    case CastingRestrictionType.HAND_ONLY:
      return "can only cast spells from hand";
    case CastingRestrictionType.CANT_ACTIVATE_ABILITIES:
      return "can't activate abilities";
    default:
      return "casting restricted";
  }
}

/**
 * Apply a "Silence" effect - prevent opponents from casting spells this turn
 * 
 * @param state - The game state
 * @param sourceId - The source of the silence effect
 * @param sourceName - Name of the source (e.g., "Silence")
 * @param sourceControllerId - Who cast Silence
 * @param targetPlayerId - Optional target (for Orim's Chant)
 * @returns Updated game state with the restriction applied
 */
export function applySilenceEffect(
  state: GameState,
  sourceId: string,
  sourceName: string,
  sourceControllerId: string,
  targetPlayerId?: string
): GameState {
  const restriction: CastingRestriction = {
    id: `silence-${sourceId}-${Date.now()}`,
    sourceId,
    sourceName,
    sourceControllerId,
    type: CastingRestrictionType.CANT_CAST_SPELLS,
    duration: RestrictionDuration.END_OF_TURN,
    affectedPlayers: targetPlayerId ? 'target' : 'opponents',
    targetPlayerId,
    timestamp: Date.now(),
    expiresAtEndOfTurn: true,
  };
  
  const existingRestrictions = (state as any).castingRestrictions || [];
  
  return {
    ...state,
    castingRestrictions: [...existingRestrictions, restriction],
  } as any;
}

/**
 * Clear all end-of-turn restrictions (called during cleanup step)
 * 
 * @param state - The game state
 * @returns Updated game state with expired restrictions removed
 */
export function clearEndOfTurnRestrictions(state: GameState): GameState {
  const restrictions = (state as any).castingRestrictions || [];
  const remaining = restrictions.filter(
    (r: CastingRestriction) => !r.expiresAtEndOfTurn
  );
  
  return {
    ...state,
    castingRestrictions: remaining,
  } as any;
}

/**
 * Check if a player can activate abilities
 * 
 * @param state - The game state
 * @param playerId - The player trying to activate
 * @returns Whether abilities can be activated
 */
export function canActivateAbilities(
  state: GameState,
  playerId: string
): { canActivate: boolean; reason?: string } {
  const allRestrictions = collectCastingRestrictions(state);
  const playerRestrictions = allRestrictions.get(playerId) || [];
  
  for (const restriction of playerRestrictions) {
    if (restriction.type === CastingRestrictionType.CANT_ACTIVATE_ABILITIES ||
        (restriction.type === CastingRestrictionType.CANT_CAST_SPELLS && 
         restriction.sourceName.toLowerCase().includes('grand abolisher'))) {
      return {
        canActivate: false,
        reason: `${restriction.sourceName}: can't activate abilities`,
      };
    }
  }
  
  return { canActivate: true };
}

/**
 * Common restriction card names for reference
 */
export const COMMON_RESTRICTION_CARDS = [
  'Silence',
  "Orim's Chant",
  'Grand Abolisher',
  'Teferi, Time Raveler',
  'Drannith Magistrate',
  'Rule of Law',
  'Arcane Laboratory',
  'Deafening Silence',
  'Ethersworn Canonist',
  'Lavinia, Azorius Renegade',
  'Void Mirror',
  'Chalice of the Void',
  'Trinisphere',
  'Defense Grid',
  'City of Solitude',
  'Dosan the Falling Leaf',
  'Teferi, Mage of Zhalfir',
] as const;

export type RestrictionCardName = typeof COMMON_RESTRICTION_CARDS[number];

/**
 * Spell timing restriction result
 */
export interface SpellTimingRestriction {
  readonly canCast: boolean;
  readonly reason?: string;
  readonly requiresOpponentsTurn?: boolean;
  readonly requiresOwnTurn?: boolean;
  readonly requiresCreatureTarget?: string; // Controller requirement for creature targets
}

/**
 * Check timing restrictions from a card's oracle text
 * Handles patterns like:
 * - "Cast this spell only during an opponent's turn" (Delirium)
 * - "Cast this spell only during your turn"
 * - "Cast this spell only before attackers are declared"
 * 
 * @param oracleText - The spell's oracle text
 * @param currentPlayerId - The player attempting to cast
 * @param activePlayerId - The player whose turn it is
 * @param gameState - Optional game state for additional context
 * @returns Timing restriction check result
 */
export function checkSpellTimingRestriction(
  oracleText: string,
  currentPlayerId: string,
  activePlayerId: string,
  gameState?: GameState
): SpellTimingRestriction {
  const text = (oracleText || '').toLowerCase();
  
  // Pattern: "Cast this spell only during an opponent's turn"
  if (text.includes('cast this spell only during an opponent\'s turn') ||
      text.includes('cast only during an opponent\'s turn')) {
    const isOpponentsTurn = currentPlayerId !== activePlayerId;
    if (!isOpponentsTurn) {
      return {
        canCast: false,
        reason: 'This spell can only be cast during an opponent\'s turn',
        requiresOpponentsTurn: true,
      };
    }
    return { canCast: true, requiresOpponentsTurn: true };
  }
  
  // Pattern: "Cast this spell only during your turn"
  if (text.includes('cast this spell only during your turn') ||
      text.includes('cast only during your turn')) {
    const isOwnTurn = currentPlayerId === activePlayerId;
    if (!isOwnTurn) {
      return {
        canCast: false,
        reason: 'This spell can only be cast during your turn',
        requiresOwnTurn: true,
      };
    }
    return { canCast: true, requiresOwnTurn: true };
  }
  
  // Pattern: "Cast this spell only before attackers are declared"
  if (text.includes('cast this spell only before attackers are declared') ||
      text.includes('cast only before attackers')) {
    const phase = (gameState?.phase || '').toString().toLowerCase();
    const step = (gameState?.step || '').toString().toLowerCase();
    const isCombat = phase.includes('combat') || step.includes('attack') || step.includes('block');
    
    if (isCombat) {
      return {
        canCast: false,
        reason: 'This spell can only be cast before attackers are declared',
      };
    }
    return { canCast: true };
  }
  
  // No timing restrictions found
  return { canCast: true };
}

/**
 * Check if a spell requires specific targets and if those targets exist
 * Handles patterns like:
 * - "Tap target creature that player controls" (Delirium)
 * - Target restrictions based on the current turn
 * 
 * @param oracleText - The spell's oracle text
 * @param gameState - The game state
 * @param currentPlayerId - The player attempting to cast
 * @returns Whether valid targets exist for the spell
 */
export function hasValidTargetsForSpell(
  oracleText: string,
  gameState: GameState,
  currentPlayerId: string
): { hasTargets: boolean; reason?: string } {
  const text = (oracleText || '').toLowerCase();
  
  // Pattern for Delirium: needs creatures controlled by the opponent whose turn it is
  // "Tap target creature that player controls"
  if (text.includes('cast this spell only during an opponent\'s turn') &&
      text.includes('target creature that player controls')) {
    const activePlayerId = gameState.turnPlayer || gameState.players[gameState.activePlayerIndex || 0]?.id;
    
    // Find creatures controlled by the active player (the opponent whose turn it is)
    const opponentCreatures = gameState.battlefield.filter(perm => {
      const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
      return typeLine.includes('creature') && perm.controller === activePlayerId;
    });
    
    if (opponentCreatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'The opponent whose turn it is controls no creatures',
      };
    }
    
    return { hasTargets: true };
  }
  
  // Generic "target creature" check
  if (text.includes('target creature')) {
    const creatures = gameState.battlefield.filter(perm => {
      const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
      return typeLine.includes('creature');
    });
    
    if (creatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'No creatures on the battlefield',
      };
    }
  }
  
  // Pattern: "attacking creature" or "target player sacrifices an attacking creature"
  // These spells require an attacking creature to exist
  // Examples: Entrapment Maneuver ("Target player sacrifices an attacking creature")
  if (text.includes('attacking creature') || text.includes('sacrifices an attacking creature')) {
    // Check if we're in combat and if there are attacking creatures
    const phase = (gameState.phase || '').toString().toLowerCase();
    const step = (gameState.step || '').toString().toLowerCase();
    const isCombat = phase.includes('combat') || step.includes('attack') || step.includes('block') || step.includes('damage');
    
    if (!isCombat) {
      return {
        hasTargets: false,
        reason: 'Can only be cast during combat (requires attacking creatures)',
      };
    }
    
    // Check for attacking creatures on the battlefield
    const attackingCreatures = gameState.battlefield.filter(perm => {
      const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
      const isCreature = typeLine.includes('creature');
      const isAttacking = (perm as any).attacking === true;
      return isCreature && isAttacking;
    });
    
    if (attackingCreatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'No attacking creatures on the battlefield',
      };
    }
  }
  
  // Generic "target opponent" check
  if (text.includes('target opponent')) {
    const opponents = gameState.players.filter(p => p.id !== currentPlayerId);
    if (opponents.length === 0) {
      return {
        hasTargets: false,
        reason: 'No opponents',
      };
    }
  }
  
  return { hasTargets: true };
}
