// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: WinCondition / CantLoseEffect, lose/can't-lose checks
// (oracle-pattern ReplacementEffectSpec; no CANT_LOSE_CARDS / WIN_CONDITIONS /
// LIFE_MODIFIERS name tables), empty-library draw consequences, and ascend
// City's Blessing. Life modifiers live in gameStateEffectsLifeModifierOraclePatterns.ts.
// Public entry symbols: detectWinConditions, checkUpkeepWinConditions,
// checkImmediateWinConditions, checkEndStepWinConditions, tryResolveThassasOracleWin,
// hasDrawWinReplacement,
// processLifeChange (re-export), checkLoseConditions, hasCantLoseEffect,
// applyEmptyLibraryDrawConsequences, applyAscendCitysBlessing.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/index.js";
import { checkThassasOracleWin } from "../../../../../rules-engine/src/winEffectCards.js";
import { markPlayerOutOfPriority } from "../priorityEligibility.js";
import { removeLeavingPlayerGameObjects } from "../playerLeavingGame.js";
import { collectOraclePatternWinConditions, sourcePermanentHasDevotionLibraryWin } from "./gameStateEffectsWinConditionOraclePatterns.js";
import {
  collectOraclePatternLoseGameReplacementSpecsFromState,
  loseGameSpecExemptsEmptyLibraryDraw,
  loseGameSpecExemptsZeroOrLessLife,
  loseGameSpecPreventsLoss,
  loseGameSpecWinsOnEmptyLibraryDraw,
} from "../replacementEffectSpec-handlers/replacementEffectSpecLoseGameOracleTemplates.js";
import {
  detectLifeModifiers,
  canLifeChange,
  canGainLife,
  lifeGainBecomesLoss,
  canPlayerPayLife,
  processLifeChange,
} from "./gameStateEffectsLifeModifierOraclePatterns.js";
export type { LifeModifier } from "./gameStateEffectsLifeModifierOraclePatterns.js";
export {
  detectLifeModifiers,
  canLifeChange,
  canGainLife,
  lifeGainBecomesLoss,
  canPlayerPayLife,
  processLifeChange,
};

export interface WinCondition {
  permanentId: string;
  cardName: string;
  type: 'upkeep' | 'etb' | 'end_step' | 'replacement' | 'immediate' | 'cast';
  checkFunction: (ctx: GameContext, playerId: string) => boolean;
  description: string;
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

function loseGameSpecsFromCtx(ctx: GameContext) {
  return collectOraclePatternLoseGameReplacementSpecsFromState((ctx as { state?: unknown }).state || ctx);
}

// Battlefield queries: game-state-effects-handlers/gameStateEffectsBattlefieldQueries.ts


// Ability state conditions: game-state-effects-handlers/gameStateEffectsAbilityConditions.ts


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
 * Detect win conditions from battlefield (and emblems) via oracle patterns.
 * Empty-library-draw wins are ReplacementEffectSpec, not listed here.
 */
export function detectWinConditions(ctx: GameContext, playerId: string): WinCondition[] {
  return collectOraclePatternWinConditions(ctx, playerId);
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
 * Darksteel-style state-trigger wins (`When this has N or more X counters`).
 * These scan as type `immediate` and must not be folded into upkeep checks.
 */
export function checkImmediateWinConditions(ctx: GameContext, playerId: string): WinCondition | null {
  const conditions = detectWinConditions(ctx, playerId);
  const immediateConditions = conditions.filter(c => c.type === 'immediate');

  for (const condition of immediateConditions) {
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
  if (!sourcePermanentHasDevotionLibraryWin(ctx, playerId, sourceName)) {
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
  const specs = loseGameSpecsFromCtx(ctx);
  return specs.some((spec) => loseGameSpecWinsOnEmptyLibraryDraw(spec, playerId));
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
  const cantLose = hasCantLoseEffect(ctx, playerId);
  
  // 0 or less life
  if (life <= 0) {
    if (cantLose.cantLose || hasZeroOrLessLifeLoseExemption(ctx, playerId)) {
      return { lost: false };
    }
    return { lost: true, reason: "Life total is 0 or less" };
  }
  
  // Poison counters
  const poisonCounters = ctx.state?.poisonCounters?.[playerId] || 0;
  if (poisonCounters >= 10) {
    if (cantLose.cantLose) return { lost: false };
    return { lost: true, reason: "10 or more poison counters" };
  }
  
  // Commander damage
  const commanderDamage = ctx.state?.commanderDamage?.[playerId] || {};
  for (const [commanderId, damage] of Object.entries(commanderDamage)) {
    if ((damage as number) >= 21) {
      if (cantLose.cantLose) return { lost: false };
      return { lost: true, reason: `21 or more combat damage from a commander` };
    }
  }
  
  return { lost: false };
}

function hasZeroOrLessLifeLoseExemption(ctx: GameContext, playerId: string): boolean {
  const state = (ctx as { state?: unknown }).state || ctx;
  return loseGameSpecsFromCtx(ctx).some((spec) => loseGameSpecExemptsZeroOrLessLife(spec, playerId, state));
}

function hasEmptyLibraryLoseExemption(ctx: GameContext, playerId: string): boolean {
  const state = (ctx as { state?: unknown }).state || ctx;
  return loseGameSpecsFromCtx(ctx).some((spec) => loseGameSpecExemptsEmptyLibraryDraw(spec, playerId, state));
}

/**
 * Check if a player has "can't lose the game" effect active.
 * Oracle-pattern ReplacementEffectSpec only — no card-name table.
 */
export function hasCantLoseEffect(ctx: GameContext, playerId: string): { cantLose: boolean; reason?: string } {
  const state = (ctx as { state?: unknown }).state || ctx;
  for (const spec of loseGameSpecsFromCtx(ctx)) {
    if (!loseGameSpecPreventsLoss(spec, playerId, state)) continue;
    const source = String(spec.sourceName || spec.effectId || 'Replacement effect').trim();
    const sourceController = String(spec.sourceController || '');
    if (sourceController && sourceController !== playerId) {
      return { cantLose: true, reason: `${source} (controlled by opponent)` };
    }
    return { cantLose: true, reason: source };
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
  if (hasEmptyLibraryLoseExemption(ctx, playerId)) {
    return { loses: false, wins: false, reason: "Don't lose for drawing from an empty library" };
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
    markPlayerOutOfPriority(ctx as any, playerId);
    removeLeavingPlayerGameObjects(state, playerId, { gameId: String((ctx as any).gameId || '') });
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
