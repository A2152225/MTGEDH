/**
 * playerProtection.ts
 * 
 * Implements player protection effects including:
 * - Player hexproof (e.g., Leyline of Sanctity, Ivory Mask, Witchbane Orb)
 * - Player shroud (e.g., Imperial Mask)
 * - Protection from colors/card types
 * 
 * Rule 702.11c: "Hexproof" on a player means "You can't be the target of spells or
 * abilities your opponents control."
 * 
 * Rule 702.18d: A player with shroud can't be the target of spells or abilities.
 * 
 * Common player protection cards:
 * - Leyline of Sanctity: "You have hexproof"
 * - Ivory Mask: "You have shroud"
 * - Witchbane Orb: "You have hexproof"
 * - Aegis of the Gods: Creature that gives controller hexproof
 * - Orbs of Warding: "You have hexproof"
 * - Shalai, Voice of Plenty: "You and permanents you control have hexproof"
 * - True Believer: "You have shroud"
 * - Imperial Mask: "You have hexproof" (originally shroud, errata'd)
 * - Sigarda, Heron's Grace: "You and Humans you control have hexproof"
 */

import type { GameState, BattlefieldPermanent } from '../../shared/src';

/**
 * Types of player protection
 */
export enum PlayerProtectionType {
  HEXPROOF = 'hexproof',           // Can't be targeted by opponents
  SHROUD = 'shroud',               // Can't be targeted by anyone
  HEXPROOF_FROM = 'hexproof_from', // Hexproof from specific quality (color, type)
  PROTECTION_FROM = 'protection',  // Protection from a quality
  CANT_BE_TARGETED = 'cant_be_targeted', // Generic "can't be targeted"
  CANT_LOSE_LIFE = 'cant_lose_life', // Platinum Emperion
  CANT_BE_ATTACKED = 'cant_be_attacked', // Blazing Archon
}

/**
 * Represents a player protection effect
 */
export interface PlayerProtectionEffect {
  readonly sourceId: string;       // ID of the permanent granting protection
  readonly sourceName: string;     // Name of the source
  readonly type: PlayerProtectionType;
  readonly quality?: string;       // For "hexproof from X" or "protection from X"
  readonly affectsController: boolean; // Whether it affects the controller
  readonly affectsTeammates?: boolean; // For Two-Headed Giant / team formats
}

/**
 * Result of checking if a player can be targeted
 */
export interface PlayerTargetingResult {
  readonly canTarget: boolean;
  readonly reason?: string;
  readonly blockingEffects: PlayerProtectionEffect[];
}

/**
 * Known patterns for player protection in oracle text
 * Note: Patterns are checked in order, and we track matched types to avoid duplicates
 */
const PLAYER_PROTECTION_PATTERNS: {
  pattern: RegExp;
  type: PlayerProtectionType;
  quality?: string;
}[] = [
  // "You have hexproof" (including "hexproof from X")
  { pattern: /you\s+have\s+hexproof(?:\s+from\s+(\w+))?/i, type: PlayerProtectionType.HEXPROOF },
  
  // "You have shroud"
  { pattern: /you\s+have\s+shroud/i, type: PlayerProtectionType.SHROUD },
  
  // "You can't be the target"
  { pattern: /you\s+can't\s+be\s+the\s+target/i, type: PlayerProtectionType.CANT_BE_TARGETED },
  
  // "You have protection from"
  { pattern: /you\s+have\s+protection\s+from\s+(\w+)/i, type: PlayerProtectionType.PROTECTION_FROM },
  
  // "Your life total can't change" (Platinum Emperion)
  { pattern: /your\s+life\s+total\s+can't\s+change/i, type: PlayerProtectionType.CANT_LOSE_LIFE },
  
  // "Creatures can't attack you" (Blazing Archon - different from pillowfort)
  { pattern: /creatures\s+can't\s+attack\s+you(?!\s+unless)/i, type: PlayerProtectionType.CANT_BE_ATTACKED },
];

/**
 * Detect if a permanent grants player protection
 * 
 * @param permanent - The permanent to check
 * @param controllerId - The controller of the permanent
 * @returns Array of protection effects granted, or empty array if none
 */
export function detectPlayerProtection(
  permanent: BattlefieldPermanent | any,
  controllerId: string
): PlayerProtectionEffect[] {
  const effects: PlayerProtectionEffect[] = [];
  const matchedTypes = new Set<PlayerProtectionType>();
  const oracleText = permanent.card?.oracle_text?.toLowerCase() || 
                     permanent.oracle_text?.toLowerCase() || '';
  const cardName = permanent.card?.name || permanent.name || 'Unknown';
  
  // Check for known patterns (avoid duplicates by tracking matched types)
  for (const { pattern, type, quality } of PLAYER_PROTECTION_PATTERNS) {
    // Skip if we already matched this type
    if (matchedTypes.has(type)) continue;
    
    const match = oracleText.match(pattern);
    if (match) {
      matchedTypes.add(type);
      effects.push({
        sourceId: permanent.id,
        sourceName: cardName,
        type,
        quality: match[1] || quality,
        affectsController: true,
      });
    }
  }
  
  // Check for modifier-based protection
  if (permanent.modifiers && Array.isArray(permanent.modifiers)) {
    for (const mod of permanent.modifiers) {
      if (mod.type === 'playerProtection' || mod.type === 'grantHexproof' || mod.type === 'grantShroud') {
        const modType = mod.protectionType || PlayerProtectionType.HEXPROOF;
        // Avoid duplicates
        if (!matchedTypes.has(modType)) {
          matchedTypes.add(modType);
          effects.push({
            sourceId: permanent.id,
            sourceName: cardName,
            type: modType,
            quality: mod.quality,
            affectsController: mod.affectsController !== false,
            affectsTeammates: mod.affectsTeammates,
          });
        }
      }
    }
  }
  
  return effects;
}

/**
 * Collect all player protection effects for a specific player
 * 
 * @param state - The game state
 * @param playerId - The player to check protection for
 * @returns Array of all protection effects affecting that player
 */
export function collectPlayerProtection(
  state: GameState,
  playerId: string
): PlayerProtectionEffect[] {
  const effects: PlayerProtectionEffect[] = [];
  
  // Check the player's own battlefield
  const player = state.players.find(p => p.id === playerId);
  if (!player) return effects;
  
  const playerBattlefield = player.battlefield || [];
  for (const permanent of playerBattlefield as any[]) {
    const detected = detectPlayerProtection(permanent, playerId);
    effects.push(...detected);
  }
  
  // Check global battlefield
  if (state.battlefield) {
    for (const permanent of state.battlefield as any[]) {
      const controllerId = permanent.controller || permanent.controllerId;
      if (controllerId === playerId) {
        const detected = detectPlayerProtection(permanent, playerId);
        // Avoid duplicates
        for (const effect of detected) {
          if (!effects.some(e => e.sourceId === effect.sourceId)) {
            effects.push(effect);
          }
        }
      }
    }
  }
  
  // Check emblems (some emblems grant hexproof)
  if ((player as any).emblems) {
    for (const emblem of (player as any).emblems as any[]) {
      const oracleText = emblem.ability?.toLowerCase() || '';
      if (oracleText.includes('hexproof')) {
        effects.push({
          sourceId: emblem.id,
          sourceName: emblem.name || 'Emblem',
          type: PlayerProtectionType.HEXPROOF,
          affectsController: true,
        });
      }
    }
  }
  
  return effects;
}

/**
 * Check if a player can be targeted by an opponent's spell or ability
 * 
 * @param state - The game state
 * @param targetPlayerId - The player being targeted
 * @param sourceControllerId - The controller of the targeting spell/ability
 * @param spellColor - The color of the spell (for hexproof from X)
 * @param spellType - The type of the spell (instant, sorcery, etc.)
 * @returns Result indicating if targeting is allowed
 */
export function canTargetPlayer(
  state: GameState,
  targetPlayerId: string,
  sourceControllerId: string,
  spellColor?: string,
  spellType?: string
): PlayerTargetingResult {
  const protectionEffects = collectPlayerProtection(state, targetPlayerId);
  const blockingEffects: PlayerProtectionEffect[] = [];
  
  const isOpponent = targetPlayerId !== sourceControllerId;
  
  for (const effect of protectionEffects) {
    switch (effect.type) {
      case PlayerProtectionType.HEXPROOF:
        // Hexproof only blocks opponents
        if (isOpponent) {
          blockingEffects.push(effect);
        }
        break;
        
      case PlayerProtectionType.SHROUD:
        // Shroud blocks everyone including controller
        blockingEffects.push(effect);
        break;
        
      case PlayerProtectionType.HEXPROOF_FROM:
        // Only blocks if spell matches the quality
        if (isOpponent && effect.quality) {
          if (spellColor?.toLowerCase() === effect.quality.toLowerCase() ||
              spellType?.toLowerCase() === effect.quality.toLowerCase()) {
            blockingEffects.push(effect);
          }
        }
        break;
        
      case PlayerProtectionType.PROTECTION_FROM:
        // Protection blocks if spell matches the quality
        if (effect.quality) {
          if (spellColor?.toLowerCase() === effect.quality.toLowerCase() ||
              spellType?.toLowerCase() === effect.quality.toLowerCase()) {
            blockingEffects.push(effect);
          }
        }
        break;
        
      case PlayerProtectionType.CANT_BE_TARGETED:
        // Can't be targeted by anyone
        blockingEffects.push(effect);
        break;
    }
  }
  
  if (blockingEffects.length > 0) {
    const reasons = blockingEffects.map(e => 
      `${e.sourceName} grants ${e.type}${e.quality ? ` from ${e.quality}` : ''}`
    );
    return {
      canTarget: false,
      reason: reasons.join('; '),
      blockingEffects,
    };
  }
  
  return {
    canTarget: true,
    blockingEffects: [],
  };
}

/**
 * Check if a player has protection that prevents attacks
 * (Blazing Archon: "Creatures can't attack you")
 * 
 * @param state - The game state
 * @param targetPlayerId - The player being attacked
 * @returns Whether the player can be attacked and why not
 */
export function canAttackPlayer(
  state: GameState,
  targetPlayerId: string
): { canAttack: boolean; reason?: string } {
  const protectionEffects = collectPlayerProtection(state, targetPlayerId);
  
  const attackBlockers = protectionEffects.filter(
    e => e.type === PlayerProtectionType.CANT_BE_ATTACKED
  );
  
  if (attackBlockers.length > 0) {
    return {
      canAttack: false,
      reason: `${attackBlockers[0].sourceName}: Creatures can't attack this player`,
    };
  }
  
  return { canAttack: true };
}

/**
 * Check if a player's life total can change
 * (Platinum Emperion: "Your life total can't change")
 * 
 * @param state - The game state  
 * @param playerId - The player to check
 * @returns Whether the player's life can change
 */
export function canPlayerLifeChange(
  state: GameState,
  playerId: string
): { canChange: boolean; reason?: string } {
  const protectionEffects = collectPlayerProtection(state, playerId);
  
  const lifeLockers = protectionEffects.filter(
    e => e.type === PlayerProtectionType.CANT_LOSE_LIFE
  );
  
  if (lifeLockers.length > 0) {
    return {
      canChange: false,
      reason: `${lifeLockers[0].sourceName}: Life total can't change`,
    };
  }
  
  return { canChange: true };
}

/**
 * Check if a player has hexproof
 */
export function playerHasHexproof(state: GameState, playerId: string): boolean {
  const effects = collectPlayerProtection(state, playerId);
  return effects.some(e => e.type === PlayerProtectionType.HEXPROOF);
}

/**
 * Check if a player has shroud
 */
export function playerHasShroud(state: GameState, playerId: string): boolean {
  const effects = collectPlayerProtection(state, playerId);
  return effects.some(e => e.type === PlayerProtectionType.SHROUD);
}

/**
 * Common player protection card names for reference
 */
export const COMMON_PLAYER_PROTECTION_CARDS = [
  'Leyline of Sanctity',
  'Ivory Mask',
  'Witchbane Orb',
  'Aegis of the Gods',
  'Orbs of Warding',
  'Shalai, Voice of Plenty',
  'True Believer',
  'Imperial Mask',
  'Sigarda, Heron\'s Grace',
  'Teyo, the Shieldmage',
  'Platinum Emperion',
  'Blazing Archon',
  'Spirit of the Hearth',
] as const;

export type PlayerProtectionCardName = typeof COMMON_PLAYER_PROTECTION_CARDS[number];
