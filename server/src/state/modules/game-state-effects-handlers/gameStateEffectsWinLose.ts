// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: WinCondition / LifeModifier / CantLoseEffect, WIN_CONDITIONS,
// LIFE_MODIFIERS, CANT_LOSE_CARDS, processLifeChange, lose/can't-lose checks,
// empty-library draw consequences, and ascend City's Blessing.
// Public entry symbols: detectWinConditions, checkUpkeepWinConditions,
// checkEndStepWinConditions, tryResolveThassasOracleWin, hasDrawWinReplacement,
// processLifeChange, checkLoseConditions, hasCantLoseEffect,
// applyEmptyLibraryDrawConsequences, applyAscendCitysBlessing.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/index.js";
import { checkThassasOracleWin } from "../../../../../rules-engine/src/winEffectCards.js";
import {
  getActivePermanents,
  getActiveControlledPermanents,
  countCreatures,
  calculateDevotion,
} from "./gameStateEffectsBattlefieldQueries.js";
import { isTreasureToken } from "./gameStateEffectsTokenSubtype.js";
import {
  getReplacementEffectMode,
  getReplacementEffectPreference,
  applyLifeGainReplacements,
} from "./gameStateEffectsReplacementApply.js";

export interface WinCondition {
  permanentId: string;
  cardName: string;
  type: 'upkeep' | 'etb' | 'end_step' | 'replacement' | 'immediate' | 'cast';
  checkFunction: (ctx: GameContext, playerId: string) => boolean;
  description: string;
}

export interface LifeModifier {
  permanentId: string;
  cardName: string;
  type: 'cant_change' | 'cant_gain' | 'gain_becomes_loss' | 'cant_lose' | 'damage_doubled';
  affectsController: boolean;
  affectsOpponents: boolean;
  expiresAtCleanup?: boolean;
}

/**
 * Interface for "can't lose the game" effects (Platinum Angel, Angel's Grace, etc.)
 */
export interface CantLoseEffect {
  permanentId: string;
  cardName: string;
  affectsController: boolean;
  affectsOpponents: boolean;
  opponentsCantWin?: boolean; // Platinum Angel also prevents opponents from winning
  expiresAtCleanup?: boolean;
}

/**
 * Known "can't lose the game" cards
 */
const CANT_LOSE_CARDS: Record<string, Omit<CantLoseEffect, 'permanentId' | 'cardName'>> = {
  "platinum angel": {
    affectsController: true,
    affectsOpponents: false,
    opponentsCantWin: true, // "You can't lose the game and your opponents can't win the game"
  },
  "angel's grace": {
    affectsController: true,
    affectsOpponents: false,
    expiresAtCleanup: true, // Split second, but "until end of turn"
  },
  "lich's mastery": {
    affectsController: true,
    affectsOpponents: false,
    // Note: Has other effects like losing if it leaves battlefield
  },
  "gideon of the trials": {
    // Emblem: "As long as you control a Gideon planeswalker, you can't lose the game and your opponents can't win the game"
    affectsController: true,
    affectsOpponents: false,
    opponentsCantWin: true,
  },
  "abyssal persecutor": {
    // "You can't win the game and your opponents can't lose the game"
    // This is the opposite - prevents controller from winning and opponents from losing
    affectsController: false,
    affectsOpponents: true, // Opponents can't lose
  },
  "transcendence": {
    // "You don't lose the game for having 0 or less life"
    affectsController: true,
    affectsOpponents: false,
  },
  "phyrexian unlife": {
    // "You don't lose the game for having 0 or less life"
    affectsController: true,
    affectsOpponents: false,
  },
  "worship": {
    // "If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead"
    // Not exactly "can't lose" but prevents death from damage when you have creatures
    affectsController: true,
    affectsOpponents: false,
  },
};

// Battlefield queries: game-state-effects-handlers/gameStateEffectsBattlefieldQueries.ts


// Ability state conditions: game-state-effects-handlers/gameStateEffectsAbilityConditions.ts


/**
 * Known win condition cards
 */
const WIN_CONDITIONS: Record<string, Omit<WinCondition, 'permanentId' | 'cardName'>> = {
  "felidar sovereign": {
    type: 'upkeep',
    description: "Win if you have 40 or more life at the beginning of your upkeep",
    checkFunction: (ctx, playerId) => {
      const life = getPlayerLife(ctx, playerId);
      return life >= 40;
    },
  },
  
  "thassa's oracle": {
    type: 'etb',
    description: "Win if your devotion to blue >= cards in library when ETB",
    checkFunction: (ctx, playerId) => {
      const devotion = calculateDevotion(ctx, playerId, 'U');
      const libraryCount = getLibraryCount(ctx, playerId);
      return devotion >= libraryCount;
    },
  },
  
  "laboratory maniac": {
    type: 'replacement',
    description: "Win instead of losing when you would draw from empty library",
    checkFunction: (ctx, playerId) => {
      // This is a replacement effect, checked when drawing
      return true;
    },
  },
  
  "jace, wielder of mysteries": {
    type: 'replacement',
    description: "Win instead of losing when you would draw from empty library",
    checkFunction: (ctx, playerId) => true,
  },
  
  "mortal combat": {
    type: 'upkeep',
    description: "Win if you have 20+ creature cards in graveyard at upkeep",
    checkFunction: (ctx, playerId) => {
      const graveyard = getGraveyardCards(ctx, playerId);
      const creatureCount = graveyard.filter((c: any) => 
        (c?.type_line || "").toLowerCase().includes("creature")
      ).length;
      return creatureCount >= 20;
    },
  },
  
  "epic struggle": {
    type: 'upkeep',
    description: "Win if you control 20+ creatures at upkeep",
    checkFunction: (ctx, playerId) => {
      return countCreatures(ctx, playerId) >= 20;
    },
  },
  
  "biovisionary": {
    type: 'end_step',
    description: "Win if you control 4+ creatures named Biovisionary at end step",
    checkFunction: (ctx, playerId) => {
      const permanents = getActiveControlledPermanents(ctx, playerId);
      const count = permanents.filter((p: any) => 
        (p.card?.name || "").toLowerCase() === "biovisionary"
      ).length;
      return count >= 4;
    },
  },
  
  "revel in riches": {
    type: 'upkeep',
    description: "Win if you control 10+ Treasures at upkeep",
    checkFunction: (ctx, playerId) => {
      const permanents = getActiveControlledPermanents(ctx, playerId);
      // Use the isTreasureToken helper to properly identify actual Treasure tokens
      const treasureCount = permanents.filter((p: any) => isTreasureToken(p)).length;
      return treasureCount >= 10;
    },
  },
  
  "simic ascendancy": {
    type: 'upkeep',
    description: "Win if Simic Ascendancy has 20+ growth counters at upkeep",
    checkFunction: (ctx, playerId) => {
      const permanents = getActiveControlledPermanents(ctx, playerId);
      const ascendancy = permanents.find((p: any) => 
        (p.card?.name || "").toLowerCase() === "simic ascendancy"
      );
      const growthCounters = ascendancy?.counters?.growth || 0;
      return growthCounters >= 20;
    },
  },
  
  "maze's end": {
    type: 'immediate',
    description: "Win when you control 10 different Gates",
    checkFunction: (ctx, playerId) => {
      const permanents = getActiveControlledPermanents(ctx, playerId);
      const gates = permanents.filter((p: any) => 
        (p.card?.type_line || "").toLowerCase().includes("gate")
      );
      const uniqueGates = new Set(gates.map((g: any) => g.card?.name));
      return uniqueGates.size >= 10;
    },
  },
  
  "barren glory": {
    type: 'upkeep',
    description: "Win if you control no other permanents and have no cards in hand",
    checkFunction: (ctx, playerId) => {
      const permanents = getActiveControlledPermanents(ctx, playerId);
      const nonBarrenGlory = permanents.filter((p: any) => 
        (p.card?.name || "").toLowerCase() !== "barren glory"
      ).length;
      const handCount = getHandCount(ctx, playerId);
      return nonBarrenGlory === 0 && handCount === 0;
    },
  },
};

/**
 * Known life modifier cards
 */
const LIFE_MODIFIERS: Record<string, Omit<LifeModifier, 'permanentId' | 'cardName'>> = {
  "platinum emperion": {
    type: 'cant_change',
    affectsController: true,
    affectsOpponents: false,
  },
  
  "teferi's protection": {
    type: 'cant_change',
    affectsController: true,
    affectsOpponents: false,
    expiresAtCleanup: true,
  },
  
  "tainted remedy": {
    type: 'gain_becomes_loss',
    affectsController: false,
    affectsOpponents: true,
  },
  
  "erebos, god of the dead": {
    type: 'cant_gain',
    affectsController: false,
    affectsOpponents: true,
  },
  
  "sulfuric vortex": {
    type: 'cant_gain',
    affectsController: true,
    affectsOpponents: true,
  },
  
  "leyline of punishment": {
    type: 'cant_gain',
    affectsController: true,
    affectsOpponents: true,
  },
  
  "angel of jubilation": {
    type: 'cant_lose', // Specifically can't pay life
    affectsController: false,
    affectsOpponents: true,
  },
  
  "archfiend of despair": {
    type: 'cant_gain',
    affectsController: false,
    affectsOpponents: true,
  },
  
  "wound reflection": {
    type: 'damage_doubled',
    affectsController: false,
    affectsOpponents: true,
  },
};

/**
 * Get player life total
 */
export function getPlayerLife(ctx: GameContext, playerId: string): number {
  const players = ctx.state?.players || [];
  const player = players.find((p: any) => p?.id === playerId || p?.playerId === playerId);
  return player?.life ?? 40;
}

/**
 * Get library count
 */
export function getLibraryCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).zones?.[playerId];
  const fromZones = zones?.libraryCount ?? zones?.library?.length;
  if (typeof fromZones === 'number') return fromZones;

  const library = (ctx as any).libraries?.get?.(playerId);
  if (Array.isArray(library)) return library.length;

  const player = (ctx.state?.players || []).find((entry: any) => String(entry?.id || '') === String(playerId));
  if (Array.isArray(player?.library)) return player.library.length;

  return 0;
}

/**
 * Get hand count
 */
export function getHandCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).zones?.[playerId];
  return zones?.handCount ?? zones?.hand?.length ?? 0;
}

/**
 * Get graveyard cards
 */
export function getGraveyardCards(ctx: GameContext, playerId: string): any[] {
  const zones = (ctx as any).zones?.[playerId];
  return zones?.graveyard || [];
}

/**
 * Detect win conditions from battlefield
 */
export function detectWinConditions(ctx: GameContext, playerId: string): WinCondition[] {
  const conditions: WinCondition[] = [];
  const permanents = getActiveControlledPermanents(ctx, playerId);
  
  for (const perm of permanents) {
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, condition] of Object.entries(WIN_CONDITIONS)) {
      if (cardName.includes(knownName)) {
        conditions.push({
          permanentId: perm.id,
          cardName: perm.card?.name || knownName,
          ...condition,
        });
      }
    }
  }
  
  return conditions;
}

/**
 * Check upkeep win conditions
 */
export function checkUpkeepWinConditions(ctx: GameContext, playerId: string): WinCondition | null {
  const conditions = detectWinConditions(ctx, playerId);
  const upkeepConditions = conditions.filter(c => c.type === 'upkeep');
  
  for (const condition of upkeepConditions) {
    if (condition.checkFunction(ctx, playerId)) {
      return condition;
    }
  }
  
  return null;
}

/**
 * Check end step win conditions
 */
export function checkEndStepWinConditions(ctx: GameContext, playerId: string): WinCondition | null {
  const conditions = detectWinConditions(ctx, playerId);
  const endStepConditions = conditions.filter(c => c.type === 'end_step');
  
  for (const condition of endStepConditions) {
    if (condition.checkFunction(ctx, playerId)) {
      return condition;
    }
  }
  
  return null;
}

/**
 * Resolve Thassa's Oracle ETB win when devotion to blue >= library size.
 * Returns true when the game ends.
 */
export function tryResolveThassasOracleWin(
  ctx: GameContext,
  playerId: string,
  sourceName?: string,
): boolean {
  const normalizedSource = String(sourceName || '').trim().toLowerCase();
  if (normalizedSource && !normalizedSource.includes("thassa's oracle")) {
    return false;
  }

  const librarySize = getLibraryCount(ctx, playerId);
  const result = checkThassasOracleWin(
    playerId as PlayerID,
    librarySize,
    (ctx.state?.battlefield || []) as any,
    ctx.state?.players as any,
    ((ctx.state as any)?.winLossEffects || []) as any,
  );

  if (!result.playerWins || !result.winningPlayerId || !(ctx.state as any)) {
    return false;
  }

  (ctx.state as any).winner = result.winningPlayerId;
  (ctx.state as any).gameOver = true;
  (ctx.state as any).winCondition = result.winReason || `${sourceName || "Thassa's Oracle"}: devotion win`;
  return true;
}

/**
 * Check if a player has Lab Man/Jace effect (win instead of draw-loss)
 */
export function hasDrawWinReplacement(ctx: GameContext, playerId: string): boolean {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  
  return permanents.some((p: any) => {
    const name = (p.card?.name || "").toLowerCase();
    return name.includes("laboratory maniac") || 
           name.includes("jace, wielder of mysteries");
  });
}

/**
 * Detect life modifiers from battlefield
 */
export function detectLifeModifiers(ctx: GameContext, playerId: string): LifeModifier[] {
  const modifiers: LifeModifier[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, modifier] of Object.entries(LIFE_MODIFIERS)) {
      if (cardName.includes(knownName)) {
        const isController = perm.controller === playerId;
        const shouldApply = 
          (modifier.affectsController && isController) ||
          (modifier.affectsOpponents && !isController);
        
        if (shouldApply) {
          modifiers.push({
            permanentId: perm.id,
            cardName: perm.card?.name || knownName,
            ...modifier,
          });
        }
      }
    }
  }
  
  // Check for Teferi's Protection effect
  const protection = ctx.state?.playerProtection?.[playerId];
  if (protection?.lifeCannotChange) {
    modifiers.push({
      permanentId: 'teferis_protection',
      cardName: "Teferi's Protection",
      type: 'cant_change',
      affectsController: true,
      affectsOpponents: false,
      expiresAtCleanup: true,
    });
  }
  
  return modifiers;
}

/**
 * Check if player's life can change
 */
export function canLifeChange(ctx: GameContext, playerId: string): boolean {
  const modifiers = detectLifeModifiers(ctx, playerId);
  return !modifiers.some(m => m.type === 'cant_change');
}

/**
 * Check if player can gain life
 */
export function canGainLife(ctx: GameContext, playerId: string): boolean {
  const modifiers = detectLifeModifiers(ctx, playerId);
  return !modifiers.some(m => m.type === 'cant_gain' || m.type === 'cant_change');
}

/**
 * Check if life gain becomes life loss (Tainted Remedy)
 */
export function lifeGainBecomesLoss(ctx: GameContext, playerId: string): boolean {
  const modifiers = detectLifeModifiers(ctx, playerId);
  return modifiers.some(m => m.type === 'gain_becomes_loss');
}

/**
 * Process life change with modifiers
 */
export function processLifeChange(
  ctx: GameContext, 
  playerId: string, 
  amount: number,
  isGain: boolean
): { finalAmount: number; prevented: boolean; reason?: string } {
  // Check if life can change at all
  if (!canLifeChange(ctx, playerId)) {
    return { finalAmount: 0, prevented: true, reason: "Life total can't change" };
  }
  
  if (isGain) {
    // Check if can gain life
    if (!canGainLife(ctx, playerId)) {
      return { finalAmount: 0, prevented: true, reason: "Can't gain life" };
    }

    // MTG 616.1: if multiple replacement effects apply to a life gain event,
    // the affected player chooses the order.
    // Default behavior: maximize beneficial outcomes, minimize harmful ones.
    const pref = getReplacementEffectPreference(ctx, playerId, 'life_gain');
    const mode = getReplacementEffectMode(pref, 'life_gain');

    // Check for Tainted Remedy effect (life gain becomes life loss)
    if (lifeGainBecomesLoss(ctx, playerId)) {
      // Default/auto should minimize harm by converting first.
      // Allow override (maximize/custom) to apply gain modifiers first.
      if (mode === 'maximize') {
        const { finalAmount } = applyLifeGainReplacements(ctx, amount, playerId);
        return { finalAmount: -finalAmount, prevented: false, reason: "Life gain becomes life loss" };
      }

      if (mode === 'custom' && Array.isArray(pref?.customOrder) && pref.customOrder.length > 0) {
        const idx = pref.customOrder.findIndex(s => String(s).toLowerCase().includes('tainted remedy'));
        if (idx > 0) {
          const { finalAmount } = applyLifeGainReplacements(ctx, amount, playerId);
          return { finalAmount: -finalAmount, prevented: false, reason: "Life gain becomes life loss" };
        }
      }

      return { finalAmount: -amount, prevented: false, reason: "Life gain becomes life loss" };
    }

    const gainResult = applyLifeGainReplacements(ctx, amount, playerId);
    return { finalAmount: gainResult.finalAmount, prevented: false };
  }
  
  return { finalAmount: amount, prevented: false };
}

/**
 * Check standard lose conditions
 */
export function checkLoseConditions(
  ctx: GameContext, 
  playerId: string
): { lost: boolean; reason?: string } {
  // Check if player has Teferi's Protection (can't lose)
  const protection = ctx.state?.playerProtection?.[playerId];
  if (protection?.protectionFromEverything) {
    return { lost: false };
  }
  
  const life = getPlayerLife(ctx, playerId);
  
  // 0 or less life
  if (life <= 0) {
    return { lost: true, reason: "Life total is 0 or less" };
  }
  
  // Poison counters
  const poisonCounters = ctx.state?.poisonCounters?.[playerId] || 0;
  if (poisonCounters >= 10) {
    return { lost: true, reason: "10 or more poison counters" };
  }
  
  // Commander damage
  const commanderDamage = ctx.state?.commanderDamage?.[playerId] || {};
  for (const [commanderId, damage] of Object.entries(commanderDamage)) {
    if ((damage as number) >= 21) {
      return { lost: true, reason: `21 or more combat damage from a commander` };
    }
  }
  
  return { lost: false };
}

/**
 * Check if a player has "can't lose the game" effect active
 */
export function hasCantLoseEffect(ctx: GameContext, playerId: string): { cantLose: boolean; reason?: string } {
  const permanents = getActivePermanents(ctx);
  
  for (const perm of permanents) {
    const cardName = (perm.card?.name || "").toLowerCase().trim();
    const oracleText = (perm.card?.oracle_text || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(CANT_LOSE_CARDS)) {
      // Use exact match or match at word boundary to avoid false positives
      // e.g., "platinum angel" should match "Platinum Angel" but not "Platinum Angel Token Creator"
      const nameMatches = cardName === knownName || 
                          cardName.startsWith(knownName + " ") ||
                          cardName.startsWith(knownName + ",");
      
      if (nameMatches) {
        const isController = perm.controller === playerId;
        
        // Check if this effect applies to this player
        if (effect.affectsController && isController) {
          return { cantLose: true, reason: perm.card?.name || knownName };
        }
        if (effect.affectsOpponents && !isController) {
          return { cantLose: true, reason: `${perm.card?.name || knownName} (controlled by opponent)` };
        }
      }
    }
    
    // Generic detection for "can't lose the game" text
    if (oracleText.includes("you can't lose the game") || 
        oracleText.includes("you don't lose the game")) {
      if (perm.controller === playerId) {
        return { cantLose: true, reason: perm.card?.name || "Unknown permanent" };
      }
    }
  }
  
  // Check for Angel's Grace effect (stored in state as temporary effect)
  const angelsGrace = (ctx.state as any)?.angelsGraceEffect?.[playerId];
  if (angelsGrace && angelsGrace.active) {
    return { cantLose: true, reason: "Angel's Grace" };
  }
  
  return { cantLose: false };
}

/**
 * Check if drawing from empty library should cause a loss or win
 * Considers:
 * - Laboratory Maniac / Jace, Wielder of Mysteries (win instead)
 * - Platinum Angel / Angel's Grace (can't lose)
 */
export function checkEmptyLibraryDraw(
  ctx: GameContext, 
  playerId: string
): { loses: boolean; wins: boolean; reason?: string } {
  // First check for "can't lose the game" effects
  const cantLoseCheck = hasCantLoseEffect(ctx, playerId);
  if (cantLoseCheck.cantLose) {
    return { loses: false, wins: false, reason: `Can't lose: ${cantLoseCheck.reason}` };
  }
  
  // Check for Lab Man / Jace effect (win instead of losing)
  if (hasDrawWinReplacement(ctx, playerId)) {
    return { loses: false, wins: true, reason: "Laboratory Maniac/Jace effect" };
  }
  
  return { loses: true, wins: false, reason: "Drew from empty library" };
}

function permanentHasAscend(permanent: any): boolean {
  const keywords = Array.isArray(permanent?.card?.keywords) ? permanent.card.keywords : [];
  if (keywords.some((k: unknown) => String(k || '').toLowerCase() === 'ascend')) return true;
  const oracle = String(permanent?.card?.oracle_text || '').toLowerCase();
  return /(?:^|\n)\s*ascend\b/m.test(oracle);
}

/**
 * Rule 702.131b: Ascend on a permanent is a static ability — any time you control
 * 10+ permanents and lack the city's blessing, you get it for the rest of the game.
 */
export function applyAscendCitysBlessing(ctx: GameContext): string[] {
  const state = ctx.state as any;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  state.cityBlessing = state.cityBlessing || {};
  const newlyGranted: string[] = [];

  for (const player of players) {
    const playerId = String(player?.id || '').trim();
    if (!playerId || state.cityBlessing[playerId]) continue;
    if (player.hasLost || player.eliminated || player.conceded) continue;

    const controlled = battlefield.filter((perm: any) => perm && String(perm.controller || '') === playerId);
    const hasAscend = controlled.some((perm: any) => permanentHasAscend(perm));
    if (!hasAscend) continue;

    // Server battlefield stores individual tokens (emit grouping is client-view only).
    if (controlled.length < 10) continue;

    state.cityBlessing[playerId] = true;
    newlyGranted.push(playerId);
  }

  return newlyGranted;
}

/**
 * Apply Rule 704.5b consequences for players who attempted a mandatory draw
 * from an empty library. Safe to call from drawCards (any forced draw) and from SBAs.
 * Optional/"may" draws only reach here if the player chose to draw.
 */
export function applyEmptyLibraryDrawConsequences(
  ctx: GameContext,
  playerIds: readonly string[],
): { applied: string[]; wins: string[]; ignored: string[] } {
  const applied: string[] = [];
  const wins: string[] = [];
  const ignored: string[] = [];
  const state = ctx.state as any;
  const players = Array.isArray(state?.players) ? state.players : [];

  for (const rawId of playerIds) {
    const playerId = String(rawId || '').trim();
    if (!playerId) continue;
    const player = players.find((p: any) => p && String(p.id || '') === playerId);
    if (!player || player.hasLost || player.eliminated || player.conceded) {
      ignored.push(playerId);
      continue;
    }

    const result = checkEmptyLibraryDraw(ctx, playerId);
    if (result.wins) {
      state.gameOver = true;
      state.winner = playerId;
      state.winReason = result.reason || 'Drew from empty library (win replacement)';
      wins.push(playerId);
      continue;
    }
    if (!result.loses) {
      ignored.push(playerId);
      continue;
    }

    player.hasLost = true;
    player.lostReason = result.reason || 'Attempted to draw from an empty library';
    player.lossReason = player.lostReason;
    applied.push(playerId);
    try {
      if (!(ctx as any).inactive || !((ctx as any).inactive instanceof Set)) {
        (ctx as any).inactive = new Set<string>();
      }
      (ctx as any).inactive.add(playerId);
    } catch {
      // best-effort
    }
  }

  return { applied, wins, ignored };
}

/**
 * Drain and apply any pending `attemptedEmptyLibraryDraw` flags (SBA path).
 */
export function processPendingEmptyLibraryDrawAttempts(ctx: GameContext): {
  applied: string[];
  wins: string[];
  ignored: string[];
} {
  const state = ctx.state as any;
  const attempted = state?.attemptedEmptyLibraryDraw;
  if (!attempted || typeof attempted !== 'object') {
    return { applied: [], wins: [], ignored: [] };
  }
  const playerIds = Object.keys(attempted).filter((pid) => attempted[pid]);
  state.attemptedEmptyLibraryDraw = {};
  return applyEmptyLibraryDrawConsequences(ctx, playerIds);
}
