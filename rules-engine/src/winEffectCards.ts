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

import type { BattlefieldPermanent, GameState, PlayerID, KnownCardRef } from '../../shared/src';

type WinEffectPlayer = {
  readonly id?: PlayerID;
  readonly emblems?: readonly unknown[];
};

function getPlayerEmblems(players: readonly WinEffectPlayer[] | undefined, playerId: PlayerID): readonly any[] {
  const player = players?.find(entry => entry?.id === playerId) as any;
  return Array.isArray(player?.emblems) ? player.emblems : [];
}

function getEmblemAbilities(emblem: any): string[] {
  if (Array.isArray(emblem?.abilities)) {
    return emblem.abilities.map((ability: unknown) => String(ability || ''));
  }

  if (typeof emblem?.ability === 'string') {
    return [emblem.ability];
  }

  return [];
}

function permanentIsGideonPlaneswalker(perm: BattlefieldPermanent, controllerId: PlayerID): boolean {
  if (perm.controller !== controllerId) {
    return false;
  }

  const typeLine = String((perm.card as KnownCardRef)?.type_line || (perm as any)?.type_line || '').toLowerCase();
  const effectiveTypes = Array.isArray((perm as any)?.effectiveTypes)
    ? (perm as any).effectiveTypes.map((entry: unknown) => String(entry).toLowerCase())
    : [];
  const isPlaneswalker = typeLine.includes('planeswalker') || effectiveTypes.includes('planeswalker');
  if (!isPlaneswalker) {
    return false;
  }

  const name = String((perm.card as KnownCardRef)?.name || '').toLowerCase();
  return name.includes('gideon') || typeLine.includes('gideon');
}

function emblemRequiresGideonPlaneswalker(abilityText: string, emblem: any): boolean {
  const lowerAbility = abilityText.toLowerCase();
  return lowerAbility.includes('as long as you control a gideon planeswalker') ||
    String(emblem?.createdBy || '').toLowerCase() === 'gideon of the trials';
}

function emblemConditionIsActive(
  emblem: any,
  abilityText: string,
  playerId: PlayerID,
  battlefield: readonly BattlefieldPermanent[]
): boolean {
  if (!emblemRequiresGideonPlaneswalker(abilityText, emblem)) {
    return true;
  }

  return battlefield.some(perm => permanentIsGideonPlaneswalker(perm, playerId));
}

function getTemporaryWinLossEffects(effects: readonly TemporaryWinLossEffect[] | undefined): readonly TemporaryWinLossEffect[] {
  return Array.isArray(effects) ? effects : [];
}

function setPermanentCounter(
  battlefield: readonly BattlefieldPermanent[],
  permanentId: string,
  counterName: string,
  nextValue: number
): BattlefieldPermanent[] {
  return battlefield.map(perm => {
    if (perm.id !== permanentId) {
      return perm;
    }

    return {
      ...perm,
      counters: {
        ...(perm.counters || {}),
        [counterName]: Math.max(0, nextValue),
      },
    } as BattlefieldPermanent;
  });
}

function finishGameAsDraw(state: GameState, reason: string): GameState {
  const nextState: any = {
    ...state,
    status: 'finished',
    winReason: reason,
    isDraw: true,
  };
  delete nextState.winner;
  return nextState as GameState;
}

function finishGameWithWinner(state: GameState, winnerId: PlayerID, reason: string): GameState {
  return {
    ...state,
    winner: winnerId,
    status: 'finished' as any,
    winReason: reason as any,
  } as GameState;
}

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

export interface TemporaryWinLossEffect {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceControllerId: PlayerID;
  readonly affectedPlayerId: PlayerID;
  readonly grantsCantLose: boolean;
  readonly grantsOpponentsCantWin: boolean;
  readonly expiresAtEndOfTurn: boolean;
  readonly timestamp: number;
}

export interface UpkeepOutcomeResult {
  readonly state: GameState;
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
  
  // Check known cards first - use exact name matching to avoid false positives
  for (const [knownName, info] of Object.entries(WIN_EFFECT_CARDS)) {
    if (cardName === knownName || info.pattern.test(oracleText)) {
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
  battlefield: readonly BattlefieldPermanent[],
  players?: readonly WinEffectPlayer[],
  temporaryEffects?: readonly TemporaryWinLossEffect[]
): { hasCantLose: boolean; source?: string } {
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const card = perm.card as KnownCardRef;
    const oracleText = (card?.oracle_text || '').toLowerCase();
    
    if (oracleText.includes("you can't lose the game")) {
      return { hasCantLose: true, source: card?.name };
    }
  }

  for (const emblem of getPlayerEmblems(players, playerId)) {
    for (const ability of getEmblemAbilities(emblem)) {
      const lowerAbility = ability.toLowerCase();
      if (!lowerAbility.includes("you can't lose the game")) {
        continue;
      }

      if (!emblemConditionIsActive(emblem, ability, playerId, battlefield)) {
        continue;
      }

      return { hasCantLose: true, source: emblem?.name || 'Emblem' };
    }
  }

  for (const effect of getTemporaryWinLossEffects(temporaryEffects)) {
    if (!effect.grantsCantLose || effect.affectedPlayerId !== playerId) {
      continue;
    }

    return { hasCantLose: true, source: effect.sourceName };
  }
  
  return { hasCantLose: false };
}

/**
 * Check if a player's opponents have "can't win" effect
 */
export function opponentsHaveCantWinEffect(
  winningPlayerId: PlayerID,
  battlefield: readonly BattlefieldPermanent[],
  players?: readonly WinEffectPlayer[],
  temporaryEffects?: readonly TemporaryWinLossEffect[]
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

  for (const player of players || []) {
    if (!player?.id || player.id === winningPlayerId) {
      continue;
    }

    for (const emblem of getPlayerEmblems(players, player.id)) {
      for (const ability of getEmblemAbilities(emblem)) {
        const lowerAbility = ability.toLowerCase();
        if (!lowerAbility.includes("opponents can't win the game")) {
          continue;
        }

        if (!emblemConditionIsActive(emblem, ability, player.id, battlefield)) {
          continue;
        }

        return { hasCantWin: true, source: emblem?.name || 'Emblem' };
      }
    }
  }

  for (const effect of getTemporaryWinLossEffects(temporaryEffects)) {
    if (!effect.grantsOpponentsCantWin || effect.affectedPlayerId === winningPlayerId) {
      continue;
    }

    return { hasCantWin: true, source: effect.sourceName };
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
  battlefield: readonly BattlefieldPermanent[],
  players?: readonly WinEffectPlayer[],
  temporaryEffects?: readonly TemporaryWinLossEffect[]
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
      const cantWin = opponentsHaveCantWinEffect(playerId, battlefield, players, temporaryEffects);
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
 * Pre-compiled regex patterns for devotion calculation
 */
const DEVOTION_PATTERNS: Record<string, { basic: RegExp; hybrid: RegExp }> = {
  W: { 
    basic: /\{W\}/gi, 
    hybrid: /\{W\/[UBRGP]\}|\{[UBRGP]\/W\}/gi 
  },
  U: { 
    basic: /\{U\}/gi, 
    hybrid: /\{U\/[WBRGP]\}|\{[WBRGP]\/U\}/gi 
  },
  B: { 
    basic: /\{B\}/gi, 
    hybrid: /\{B\/[WURGP]\}|\{[WURGP]\/B\}/gi 
  },
  R: { 
    basic: /\{R\}/gi, 
    hybrid: /\{R\/[WUBGP]\}|\{[WUBGP]\/R\}/gi 
  },
  G: { 
    basic: /\{G\}/gi, 
    hybrid: /\{G\/[WUBRP]\}|\{[WUBRP]\/G\}/gi 
  },
};

/**
 * Calculate devotion to a color for a player
 */
export function calculateDevotion(
  playerId: PlayerID,
  color: string,
  battlefield: readonly BattlefieldPermanent[]
): number {
  let devotion = 0;
  const colorUpper = color.toUpperCase();
  const patterns = DEVOTION_PATTERNS[colorUpper];
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const card = perm.card as KnownCardRef;
    const manaCost = card?.mana_cost || '';
    
    if (patterns) {
      // Use pre-compiled patterns for standard colors
      const basicMatches = manaCost.match(patterns.basic) || [];
      devotion += basicMatches.length;
      
      const hybridMatches = manaCost.match(patterns.hybrid) || [];
      devotion += hybridMatches.length;
    } else {
      // Fallback for non-standard colors (shouldn't happen in normal MTG)
      // Use string matching instead of dynamic regex to avoid security issues
      const colorSymbol = `{${colorUpper}}`;
      let count = 0;
      let idx = 0;
      while ((idx = manaCost.toUpperCase().indexOf(colorSymbol, idx)) !== -1) {
        count++;
        idx += colorSymbol.length;
      }
      devotion += count;
    }
  }
  
  return devotion;
}

/**
 * Check Thassa's Oracle win condition on ETB
 */
export function checkThassasOracleWin(
  playerId: PlayerID,
  librarySize: number,
  battlefield: readonly BattlefieldPermanent[],
  players?: readonly WinEffectPlayer[],
  temporaryEffects?: readonly TemporaryWinLossEffect[]
): WinEffectCheckResult {
  const logs: string[] = [];
  
  // Calculate devotion to blue
  const devotion = calculateDevotion(playerId, 'U', battlefield);
  logs.push(`Devotion to blue: ${devotion}`);
  logs.push(`Library size: ${librarySize}`);
  
  if (devotion >= librarySize) {
    logs.push(`Thassa's Oracle condition met! (${devotion} >= ${librarySize})`);
    
    // Check if blocked
    const cantWin = opponentsHaveCantWinEffect(playerId, battlefield, players, temporaryEffects);
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
  battlefield: readonly BattlefieldPermanent[],
  players?: readonly WinEffectPlayer[],
  temporaryEffects?: readonly TemporaryWinLossEffect[]
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
        
        const cantWin = opponentsHaveCantWinEffect(playerId, battlefield, players, temporaryEffects);
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
        
        const cantWin = opponentsHaveCantWinEffect(playerId, battlefield, players, temporaryEffects);
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
        
        const cantWin = opponentsHaveCantWinEffect(playerId, battlefield, players, temporaryEffects);
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

export function resolveSpecialUpkeepOutcomes(
  state: GameState,
  activePlayerId: PlayerID
): UpkeepOutcomeResult {
  const logs: string[] = [];
  let updatedState = state;
  let battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const players = state.players || [];
  const temporaryEffects = ((state as any).winLossEffects || []) as TemporaryWinLossEffect[];

  for (const perm of battlefield) {
    if (perm.controller !== activePlayerId) {
      continue;
    }

    const card = perm.card as KnownCardRef;
    const cardName = String(card?.name || '').toLowerCase();

    if (cardName.includes('divine intervention')) {
      const currentCounters = Math.max(0, Number((perm.counters as any)?.intervention ?? 0) || 0);
      if (currentCounters > 0) {
        const nextCounters = currentCounters - 1;
        battlefield = setPermanentCounter(battlefield, perm.id, 'intervention', nextCounters);
        updatedState = { ...updatedState, battlefield } as GameState;
        logs.push(`Removed an intervention counter from ${card.name}`);

        if (nextCounters === 0) {
          logs.push(`${card.name} causes the game to be a draw`);
          updatedState = finishGameAsDraw(updatedState, 'Divine Intervention');
          return { state: updatedState, log: logs };
        }
      }
    }

    if (cardName.includes('celestial convergence')) {
      const currentCounters = Math.max(0, Number((perm.counters as any)?.omen ?? 0) || 0);
      if (currentCounters > 0) {
        const nextCounters = currentCounters - 1;
        battlefield = setPermanentCounter(battlefield, perm.id, 'omen', nextCounters);
        updatedState = { ...updatedState, battlefield } as GameState;
        logs.push(`Removed an omen counter from ${card.name}`);
      }

      const currentPermanent = ((updatedState.battlefield || []) as BattlefieldPermanent[]).find(entry => entry.id === perm.id);
      const nextCounters = Math.max(0, Number((currentPermanent?.counters as any)?.omen ?? 0) || 0);
      if (nextCounters === 0) {
        const activePlayers = players.filter(player => !(player as any).hasLost);
        const highestLife = Math.max(...activePlayers.map(player => Number((player as any).life || 0)));
        const highestLifePlayers = activePlayers.filter(player => Number((player as any).life || 0) === highestLife);

        if (highestLifePlayers.length !== 1) {
          logs.push(`${card.name} causes the game to be a draw due to tied life totals`);
          updatedState = finishGameAsDraw(updatedState, 'Celestial Convergence');
          return { state: updatedState, log: logs };
        }

        const winner = highestLifePlayers[0];
        const cantWin = opponentsHaveCantWinEffect(
          winner.id,
          battlefield,
          players as any,
          temporaryEffects,
        );
        if (cantWin.hasCantWin) {
          logs.push(`${card.name} would make ${winner.id} win, but ${cantWin.source} prevents it`);
          continue;
        }

        logs.push(`${winner.id} wins the game due to ${card.name}`);
        updatedState = finishGameWithWinner(updatedState, winner.id, 'Celestial Convergence');
        return { state: updatedState, log: logs };
      }
    }
  }

  return { state: updatedState, log: logs };
}

export function applyTemporaryCantLoseAndOpponentsCantWinEffect(
  state: GameState,
  sourceId: string,
  sourceName: string,
  sourceControllerId: PlayerID,
  affectedPlayerId: PlayerID = sourceControllerId,
  oracleText?: string
): { state: GameState; applied: boolean; log: readonly string[] } {
  const lowerText = String(oracleText || '').toLowerCase();
  const grantsCantLose = lowerText.includes("can't lose the game this turn");
  const grantsOpponentsCantWin = lowerText.includes("opponents can't win the game this turn") || lowerText.includes("your opponents can't win the game this turn");

  if (!grantsCantLose && !grantsOpponentsCantWin) {
    return { state, applied: false, log: [] };
  }

  const effect: TemporaryWinLossEffect = {
    id: `win-loss-${sourceId}-${affectedPlayerId}-${Date.now()}`,
    sourceId,
    sourceName,
    sourceControllerId,
    affectedPlayerId,
    grantsCantLose,
    grantsOpponentsCantWin,
    expiresAtEndOfTurn: true,
    timestamp: Date.now(),
  };

  const existingEffects = getTemporaryWinLossEffects((state as any).winLossEffects);
  return {
    state: {
      ...state,
      winLossEffects: [...existingEffects, effect],
    } as GameState,
    applied: true,
    log: [`${sourceName} creates a win/loss prevention effect until end of turn`],
  };
}

export function clearEndOfTurnWinLossEffects(state: GameState): GameState {
  const effects = getTemporaryWinLossEffects((state as any).winLossEffects);
  const remaining = effects.filter(effect => !effect.expiresAtEndOfTurn);
  return {
    ...state,
    winLossEffects: remaining,
  } as GameState;
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
  resolveSpecialUpkeepOutcomes,
  applyTemporaryCantLoseAndOpponentsCantWinEffect,
  clearEndOfTurnWinLossEffects,
  createWinEffectChoiceEvent,
};
