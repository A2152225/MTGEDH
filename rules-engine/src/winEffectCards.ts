/**
 * winEffectCards.ts
 * 
 * Implements Rule 104.2b: Win condition cards that replace losing the game
 * or provide alternate win conditions.
 * 
 * Cards covered:
 * - Laboratory Maniac: "If you would draw a card while your library has no cards in it, you win the game instead."
 * - Thassa's Oracle: "When Thassa's Oracle enters the battlefield, look at the top X cards of your library... If X is greater than or equal to the number of cards in your library, you win the game."
 * - Jace, Wielder of Mysteries: "If you would draw a card while your library has no cards in it, you win the game instead."
 * - Platinum Angel: "You can't lose the game and your opponents can't win the game."
 * - Angel's Grace: "You can't lose the game this turn and your opponents can't win the game this turn."
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 104
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Types of win effects
 */
export enum WinEffectType {
  /** Empty library draw becomes a win (Lab Man, Jace) */
  EMPTY_LIBRARY_DRAW_WIN = 'empty_library_draw_win',
  /** Devotion-based win condition (Thassa's Oracle) */
  DEVOTION_WIN = 'devotion_win',
  /** Damage to opponents wins (Triskaidekaphile at 13 cards) */
  CARD_COUNT_WIN = 'card_count_win',
  /** Combat damage from specific sources (Phage) */
  COMBAT_DAMAGE_WIN = 'combat_damage_win',
  /** Prevent losing the game (Platinum Angel) */
  CANT_LOSE = 'cant_lose',
  /** Opponents can't win (Platinum Angel) */
  OPPONENTS_CANT_WIN = 'opponents_cant_win',
  /** Poison counter win (already in SBAs, but tracked here) */
  POISON_WIN = 'poison_win',
  /** Mortal combat / Battle of Wits style */
  THRESHOLD_WIN = 'threshold_win',
}

/**
 * Parsed win effect from a permanent
 */
export interface WinEffect {
  readonly type: WinEffectType;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly condition?: string;
  readonly description: string;
  /** Whether this is a replacement effect (rule 614) or a triggered ability */
  readonly isReplacement: boolean;
  /** Whether this effect is currently active */
  readonly active: boolean;
}

/**
 * Result of checking win effects
 */
export interface WinEffectCheckResult {
  /** Does a player win the game? */
  readonly playerWins: boolean;
  /** Which player wins? */
  readonly winningPlayerId?: PlayerID;
  /** What caused the win? */
  readonly winReason?: string;
  /** Source of the win effect */
  readonly sourceId?: string;
  readonly sourceName?: string;
  /** Is this win blocked by an effect like Platinum Angel? */
  readonly blockedBy?: string;
  /** Log messages */
  readonly log: readonly string[];
}

/**
 * Known win effect cards with their detection patterns
 */
export const WIN_EFFECT_CARDS: Record<string, {
  type: WinEffectType;
  pattern: RegExp;
  description: string;
  isReplacement: boolean;
}> = {
  'laboratory maniac': {
    type: WinEffectType.EMPTY_LIBRARY_DRAW_WIN,
    pattern: /if you would draw a card while your library has no cards in it.*you win the game instead/i,
    description: 'Win the game when drawing from empty library',
    isReplacement: true,
  },
  'jace, wielder of mysteries': {
    type: WinEffectType.EMPTY_LIBRARY_DRAW_WIN,
    pattern: /if you would draw a card while your library has no cards in it.*you win the game instead/i,
    description: 'Win the game when drawing from empty library',
    isReplacement: true,
  },
  "thassa's oracle": {
    type: WinEffectType.DEVOTION_WIN,
    pattern: /if x is greater than or equal to the number of cards in your library.*you win the game/i,
    description: 'Win the game if devotion to blue >= library size',
    isReplacement: false,
  },
  'platinum angel': {
    type: WinEffectType.CANT_LOSE,
    pattern: /you can't lose the game/i,
    description: "You can't lose the game",
    isReplacement: false,
  },
  'angel of destiny': {
    type: WinEffectType.THRESHOLD_WIN,
    pattern: /at the beginning of your end step.*if your life total is 15 or more life greater than your starting life total.*each player.*you attacked this turn loses the game/i,
    description: 'Opponents you attacked lose if you have 15+ life above starting',
    isReplacement: false,
  },
  'triskaidekaphile': {
    type: WinEffectType.CARD_COUNT_WIN,
    pattern: /at the beginning of your upkeep.*if you have exactly thirteen cards in your hand.*you win the game/i,
    description: 'Win with exactly 13 cards in hand at upkeep',
    isReplacement: false,
  },
  'approach of the second sun': {
    type: WinEffectType.THRESHOLD_WIN,
    pattern: /if you've cast a spell named approach of the second sun this game.*you win the game/i,
    description: 'Win on second casting',
    isReplacement: false,
  },
  'battle of wits': {
    type: WinEffectType.THRESHOLD_WIN,
    pattern: /at the beginning of your upkeep.*if you have 200 or more cards in your library.*you win the game/i,
    description: 'Win with 200+ cards in library at upkeep',
    isReplacement: false,
  },
  'mortal combat': {
    type: WinEffectType.THRESHOLD_WIN,
    pattern: /at the beginning of your upkeep.*if you have twenty or more creature cards in your graveyard.*you win the game/i,
    description: 'Win with 20+ creatures in graveyard at upkeep',
    isReplacement: false,
  },
  'heliod, sun-crowned': {
    type: WinEffectType.COMBAT_DAMAGE_WIN,
    pattern: /whenever you gain life.*put a \+1\/\+1 counter on target creature or enchantment you control/i,
    description: 'Infinite combo enabler (not direct win)',
    isReplacement: false,
  },
};

/**
 * Cards that prevent losing the game
 */
export const CANT_LOSE_CARDS: Record<string, {
  permanent: boolean;
  duration?: string;
}> = {
  'platinum angel': { permanent: true },
  "angel's grace": { permanent: false, duration: 'this turn' },
  'gideon of the trials': { permanent: true },
  'lich': { permanent: true },
  "lich's mastery": { permanent: true },
};

/**
 * Detect win effect from a permanent's oracle text
 */
export function detectWinEffect(
  card: KnownCardRef,
  permanentId: string,
  controllerId: PlayerID
): WinEffect | null {
  const cardName = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check known cards first
  for (const [knownName, info] of Object.entries(WIN_EFFECT_CARDS)) {
    if (cardName.includes(knownName) || info.pattern.test(oracleText)) {
      return {
        type: info.type,
        sourceId: permanentId,
        sourceName: card.name || 'Unknown',
        controllerId,
        description: info.description,
        isReplacement: info.isReplacement,
        active: true,
      };
    }
  }
  
  // Generic detection for "you win the game"
  if (oracleText.includes('you win the game')) {
    // Try to determine the type
    let type = WinEffectType.THRESHOLD_WIN;
    let isReplacement = false;
    
    if (oracleText.includes('would draw') && oracleText.includes('instead')) {
      type = WinEffectType.EMPTY_LIBRARY_DRAW_WIN;
      isReplacement = true;
    } else if (oracleText.includes('devotion')) {
      type = WinEffectType.DEVOTION_WIN;
    } else if (oracleText.includes('cards in your hand')) {
      type = WinEffectType.CARD_COUNT_WIN;
    }
    
    return {
      type,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      description: 'Win condition effect',
      isReplacement,
      active: true,
    };
  }
  
  // Generic detection for "can't lose the game"
  if (oracleText.includes("you can't lose the game")) {
    return {
      type: WinEffectType.CANT_LOSE,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      description: "You can't lose the game",
      isReplacement: false,
      active: true,
    };
  }
  
  // Generic detection for "opponents can't win"
  if (oracleText.includes("your opponents can't win the game") || 
      oracleText.includes("opponents can't win the game")) {
    return {
      type: WinEffectType.OPPONENTS_CANT_WIN,
      sourceId: permanentId,
      sourceName: card.name || 'Unknown',
      controllerId,
      description: "Your opponents can't win the game",
      isReplacement: false,
      active: true,
    };
  }
  
  return null;
}

/**
 * Collect all win effects from battlefield
 */
export function collectWinEffects(
  battlefield: readonly BattlefieldPermanent[]
): WinEffect[] {
  const effects: WinEffect[] = [];
  
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card?.oracle_text) continue;
    
    const effect = detectWinEffect(card, perm.id, perm.controller);
    if (effect) {
      effects.push(effect);
    }
  }
  
  return effects;
}

/**
 * Check if a player has a "can't lose" effect active
 */
export function playerHasCantLoseEffect(
  playerId: PlayerID,
  battlefield: readonly BattlefieldPermanent[]
): { hasCantLose: boolean; source?: string } {
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    if (oracleText.includes("you can't lose the game")) {
      return { hasCantLose: true, source: card?.name };
    }
  }
  
  return { hasCantLose: false };
}

/**
 * Check if a player's opponents have "can't win" effect
 */
export function opponentsHaveCantWinEffect(
  winningPlayerId: PlayerID,
  battlefield: readonly BattlefieldPermanent[]
): { hasCantWin: boolean; source?: string } {
  for (const perm of battlefield) {
    // Only check permanents controlled by opponents
    if (perm.controller === winningPlayerId) continue;
    
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    if (oracleText.includes("your opponents can't win the game") ||
        oracleText.includes("opponents can't win the game")) {
      return { hasCantWin: true, source: card?.name };
    }
  }
  
  return { hasCantWin: false };
}

/**
 * Check if empty library draw should be replaced with a win
 * (Laboratory Maniac / Jace, Wielder of Mysteries effect)
 */
export function checkEmptyLibraryDrawWin(
  playerId: PlayerID,
  librarySize: number,
  battlefield: readonly BattlefieldPermanent[]
): WinEffectCheckResult {
  const logs: string[] = [];
  
  // Only triggers if library is empty
  if (librarySize > 0) {
    return { playerWins: false, log: logs };
  }
  
  // Find empty library draw replacement effects
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const card = perm.card as KnownCardRef;
    const effect = detectWinEffect(card, perm.id, perm.controller);
    
    if (effect?.type === WinEffectType.EMPTY_LIBRARY_DRAW_WIN && effect.isReplacement) {
      logs.push(`${card.name} replaces empty library draw with win!`);
      
      // Check if blocked
      const cantWin = opponentsHaveCantWinEffect(playerId, battlefield);
      if (cantWin.hasCantWin) {
        logs.push(`Win blocked by ${cantWin.source}`);
        return {
          playerWins: false,
          winningPlayerId: playerId,
          winReason: 'Empty library draw replacement',
          sourceId: perm.id,
          sourceName: card.name,
          blockedBy: cantWin.source,
          log: logs,
        };
      }
      
      return {
        playerWins: true,
        winningPlayerId: playerId,
        winReason: 'Empty library draw replacement',
        sourceId: perm.id,
        sourceName: card.name,
        log: logs,
      };
    }
  }
  
  return { playerWins: false, log: logs };
}

/**
 * Calculate devotion to a color for a player
 */
export function calculateDevotion(
  playerId: PlayerID,
  color: string,
  battlefield: readonly BattlefieldPermanent[]
): number {
  let devotion = 0;
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const card = perm.card as KnownCardRef;
    const manaCost = card?.mana_cost || '';
    
    // Count mana symbols of the specified color
    const colorSymbol = `{${color.toUpperCase()}}`;
    const matches = manaCost.match(new RegExp(colorSymbol.replace(/[{}]/g, '\\$&'), 'gi')) || [];
    devotion += matches.length;
    
    // Also count hybrid symbols containing the color
    const hybridPattern = new RegExp(`\\{${color.toUpperCase()}\\/[WUBRGP]\\}|\\{[WUBRGP]\\/${color.toUpperCase()}\\}`, 'gi');
    const hybridMatches = manaCost.match(hybridPattern) || [];
    devotion += hybridMatches.length;
  }
  
  return devotion;
}

/**
 * Check Thassa's Oracle win condition on ETB
 */
export function checkThassasOracleWin(
  playerId: PlayerID,
  librarySize: number,
  battlefield: readonly BattlefieldPermanent[]
): WinEffectCheckResult {
  const logs: string[] = [];
  
  // Calculate devotion to blue
  const devotion = calculateDevotion(playerId, 'U', battlefield);
  logs.push(`Devotion to blue: ${devotion}`);
  logs.push(`Library size: ${librarySize}`);
  
  if (devotion >= librarySize) {
    logs.push(`Thassa's Oracle condition met! (${devotion} >= ${librarySize})`);
    
    // Check if blocked
    const cantWin = opponentsHaveCantWinEffect(playerId, battlefield);
    if (cantWin.hasCantWin) {
      logs.push(`Win blocked by ${cantWin.source}`);
      return {
        playerWins: false,
        winningPlayerId: playerId,
        winReason: "Thassa's Oracle devotion win",
        blockedBy: cantWin.source,
        log: logs,
      };
    }
    
    return {
      playerWins: true,
      winningPlayerId: playerId,
      winReason: "Thassa's Oracle devotion win",
      log: logs,
    };
  }
  
  logs.push(`Thassa's Oracle condition not met (${devotion} < ${librarySize})`);
  return { playerWins: false, log: logs };
}

/**
 * Check upkeep-based win conditions (Battle of Wits, Mortal Combat, etc.)
 */
export function checkUpkeepWinConditions(
  playerId: PlayerID,
  librarySize: number,
  handSize: number,
  graveyardCreatureCount: number,
  battlefield: readonly BattlefieldPermanent[]
): WinEffectCheckResult {
  const logs: string[] = [];
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const card = perm.card as KnownCardRef;
    const cardName = (card?.name || '').toLowerCase();
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    // Battle of Wits
    if (cardName.includes('battle of wits')) {
      if (librarySize >= 200) {
        logs.push(`Battle of Wits: ${librarySize} cards in library (>= 200)`);
        
        const cantWin = opponentsHaveCantWinEffect(playerId, battlefield);
        if (cantWin.hasCantWin) {
          return {
            playerWins: false,
            winningPlayerId: playerId,
            winReason: 'Battle of Wits',
            blockedBy: cantWin.source,
            log: logs,
          };
        }
        
        return {
          playerWins: true,
          winningPlayerId: playerId,
          winReason: 'Battle of Wits',
          sourceId: perm.id,
          sourceName: card.name,
          log: logs,
        };
      }
    }
    
    // Triskaidekaphile
    if (cardName.includes('triskaidekaphile')) {
      if (handSize === 13) {
        logs.push(`Triskaidekaphile: exactly 13 cards in hand`);
        
        const cantWin = opponentsHaveCantWinEffect(playerId, battlefield);
        if (cantWin.hasCantWin) {
          return {
            playerWins: false,
            winningPlayerId: playerId,
            winReason: 'Triskaidekaphile',
            blockedBy: cantWin.source,
            log: logs,
          };
        }
        
        return {
          playerWins: true,
          winningPlayerId: playerId,
          winReason: 'Triskaidekaphile',
          sourceId: perm.id,
          sourceName: card.name,
          log: logs,
        };
      }
    }
    
    // Mortal Combat
    if (cardName.includes('mortal combat')) {
      if (graveyardCreatureCount >= 20) {
        logs.push(`Mortal Combat: ${graveyardCreatureCount} creatures in graveyard (>= 20)`);
        
        const cantWin = opponentsHaveCantWinEffect(playerId, battlefield);
        if (cantWin.hasCantWin) {
          return {
            playerWins: false,
            winningPlayerId: playerId,
            winReason: 'Mortal Combat',
            blockedBy: cantWin.source,
            log: logs,
          };
        }
        
        return {
          playerWins: true,
          winningPlayerId: playerId,
          winReason: 'Mortal Combat',
          sourceId: perm.id,
          sourceName: card.name,
          log: logs,
        };
      }
    }
  }
  
  return { playerWins: false, log: logs };
}

/**
 * Create a choice event for win effect card interactions
 */
export interface WinEffectChoiceEvent {
  readonly type: 'win_effect_choice';
  readonly playerId: PlayerID;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly effectType: WinEffectType;
  readonly description: string;
  /** For may abilities - e.g., "you may pay 2 life" */
  readonly optional?: boolean;
  readonly timestamp: number;
}

/**
 * Create a win effect choice event for UI display
 */
export function createWinEffectChoiceEvent(
  effect: WinEffect,
  optional: boolean = false
): WinEffectChoiceEvent {
  return {
    type: 'win_effect_choice',
    playerId: effect.controllerId,
    sourceId: effect.sourceId,
    sourceName: effect.sourceName,
    effectType: effect.type,
    description: effect.description,
    optional,
    timestamp: Date.now(),
  };
}

export default {
  WinEffectType,
  WIN_EFFECT_CARDS,
  CANT_LOSE_CARDS,
  detectWinEffect,
  collectWinEffects,
  playerHasCantLoseEffect,
  opponentsHaveCantWinEffect,
  checkEmptyLibraryDrawWin,
  calculateDevotion,
  checkThassasOracleWin,
  checkUpkeepWinConditions,
  createWinEffectChoiceEvent,
};
