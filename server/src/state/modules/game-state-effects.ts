/**
 * game-state-effects.ts
 * 
 * Handles global game state effects:
 * 
 * WIN CONDITIONS:
 * - Felidar Sovereign: Win at upkeep if 40+ life
 * - Thassa's Oracle: Win when ETB if devotion >= cards in library
 * - Laboratory Maniac: Win instead of losing when drawing from empty library
 * - Jace, Wielder of Mysteries: Same as Lab Man
 * - Heliod, Sun-Crowned + Walking Ballista: Infinite combo
 * - Approach of the Second Sun: Win when cast second time from hand
 * - Mortal Combat: Win at upkeep if 20+ creatures in graveyard
 * - Epic Struggle: Win at upkeep if 20+ creatures on battlefield
 * - Biovisionary: Win at end step if you control 4+ Biovisionaries
 * - Revel in Riches: Win at upkeep if 10+ Treasures
 * - Mechanized Production: Win at upkeep if 8+ artifacts with same name
 * - Maze's End: Win when you control 10 different Gates
 * - Simic Ascendancy: Win at upkeep if 20+ growth counters
 * - Happily Ever After: Win at upkeep if 5 colors + 6 card types + 6+ life
 * - Barren Glory: Win at upkeep if no cards in hand and no other permanents
 * 
 * LOSE CONDITIONS:
 * - 0 or less life
 * - Drawing from empty library
 * - 10+ poison counters
 * - 21+ commander damage from single commander
 * - Card effects (Pacts, Door to Nothingness, etc.)
 * 
 * LIFE MODIFICATION:
 * - Platinum Emperion: Life total can't change
 * - Teferi's Protection: Life total can't change until end of turn
 * - Tainted Remedy: Life gain becomes life loss for opponents
 * - Erebos: Opponents can't gain life
 * - Sulfuric Vortex: Players can't gain life
 * - Leyline of Punishment: Damage can't be prevented, can't gain life
 * 
 * PHASED OUT RULES:
 * - Treated as though they don't exist
 * - Can't be targeted, attacked, affected by spells/abilities
 * - Don't count for devotion, creature counts, etc.
 * - Auras/Equipment stay attached but also phased out
 */

import type { GameContext } from "../context.js";

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

/**
 * Check if a permanent is phased out (and should be ignored)
 */
export function isPhasedOut(permanent: any): boolean {
  return !!permanent?.phasedOut;
}

/**
 * Get all non-phased-out permanents on the battlefield
 */
export function getActivePermanents(ctx: GameContext): any[] {
  const battlefield = ctx.state?.battlefield || [];
  return battlefield.filter((p: any) => p && !isPhasedOut(p));
}

/**
 * Get all non-phased-out permanents controlled by a player
 */
export function getActiveControlledPermanents(ctx: GameContext, playerId: string): any[] {
  return getActivePermanents(ctx).filter((p: any) => p.controller === playerId);
}

/**
 * Count creatures on battlefield (excluding phased out)
 */
export function countCreatures(ctx: GameContext, playerId?: string): number {
  const permanents = playerId 
    ? getActiveControlledPermanents(ctx, playerId)
    : getActivePermanents(ctx);
  
  return permanents.filter((p: any) => 
    (p.card?.type_line || "").toLowerCase().includes("creature")
  ).length;
}

/**
 * Calculate devotion to a color (excluding phased out permanents)
 */
export function calculateDevotion(ctx: GameContext, playerId: string, color: string): number {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  let devotion = 0;
  
  const colorSymbol = color.toUpperCase();
  
  for (const perm of permanents) {
    const manaCost = perm.card?.mana_cost || "";
    // Count occurrences of the color symbol
    const matches = manaCost.match(new RegExp(`\\{${colorSymbol}\\}`, 'g'));
    if (matches) {
      devotion += matches.length;
    }
  }
  
  return devotion;
}

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
      const treasureCount = permanents.filter((p: any) => 
        (p.card?.type_line || "").toLowerCase().includes("treasure") ||
        (p.card?.name || "").toLowerCase().includes("treasure")
      ).length;
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
  return zones?.libraryCount ?? zones?.library?.length ?? 0;
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
    
    // Check for Tainted Remedy effect
    if (lifeGainBecomesLoss(ctx, playerId)) {
      return { finalAmount: -amount, prevented: false, reason: "Life gain becomes life loss" };
    }
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
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(CANT_LOSE_CARDS)) {
      if (cardName.includes(knownName)) {
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

/**
 * Cards that grant additional land plays per turn
 * Key: lowercase card name (partial match), Value: number of additional land drops
 */
const ADDITIONAL_LAND_PLAY_CARDS: Record<string, { lands: number; affectsAll?: boolean }> = {
  "exploration": { lands: 1 },
  "burgeoning": { lands: 0 }, // Special: play lands on opponents' turns, not extra per turn
  "azusa, lost but seeking": { lands: 2 },
  "oracle of mul daya": { lands: 1 },
  "dryad of the ilysian grove": { lands: 1 },
  "wayward swordtooth": { lands: 1 },
  "mina and denn, wildborn": { lands: 1 },
  "rites of flourishing": { lands: 1, affectsAll: true },
  "ghirapur orrery": { lands: 1, affectsAll: true },
  "horn of greed": { lands: 0 }, // Draws when playing lands, not extra land drops
  "walking atlas": { lands: 0 }, // Activated ability, not continuous
  "sakura-tribe scout": { lands: 0 }, // Activated ability
  "llanowar scout": { lands: 0 }, // Activated ability
  "skyshroud ranger": { lands: 0 }, // Activated ability
  "fastbond": { lands: 99 }, // Unlimited land drops (pay 1 life each)
  "courser of kruphix": { lands: 0 }, // Play from top of library, not extra
  "crucible of worlds": { lands: 0 }, // Play from graveyard, not extra
  "ramunap excavator": { lands: 0 }, // Play from graveyard, not extra
};

/**
 * Cards that grant additional draws per draw step
 * Key: lowercase card name (partial match), Value: number of additional cards to draw
 * Note: requiresUntapped means the permanent must be untapped to provide the effect (e.g., Howling Mine)
 */
const ADDITIONAL_DRAW_CARDS: Record<string, { draws: number; affectsAll?: boolean; affectsOpponents?: boolean; requiresUntapped?: boolean }> = {
  "rites of flourishing": { draws: 1, affectsAll: true },
  "font of mythos": { draws: 2, affectsAll: true },
  "howling mine": { draws: 1, affectsAll: true, requiresUntapped: true }, // Only works when untapped
  "temple bell": { draws: 0 }, // Activated ability, not automatic
  "dictate of kruphix": { draws: 1, affectsAll: true },
  "kami of the crescent moon": { draws: 1, affectsAll: true },
  "seizan, perverter of truth": { draws: 2, affectsOpponents: true }, // Opponents draw 2, lose 2 life
  "nekusar, the mindrazer": { draws: 0 }, // Deals damage on draw, doesn't grant extra
  "consecrated sphinx": { draws: 0 }, // Triggered ability on opponent draw
  "sylvan library": { draws: 2 }, // Controller draws 2 extra, may put back or pay life
  "rhystic study": { draws: 0 }, // Triggered ability when opponent casts
  "mystic remora": { draws: 0 }, // Triggered ability when opponent casts
  "braids, conjurer adept": { draws: 0 }, // ETB from hand effect
  "wedding ring": { draws: 0 }, // Triggered on opponent draw
  "anvil of bogardan": { draws: 1, affectsAll: true }, // +1 draw, discard a card
  "well of ideas": { draws: 2 }, // Controller draws 2 extra on draw step
  "master of the feast": { draws: 1, affectsOpponents: true }, // Each opponent draws 1
  "horn of greed": { draws: 0 }, // Triggered on land play, not draw step
  "jace beleren": { draws: 0 }, // Planeswalker ability, not automatic
};

/**
 * Calculate the maximum number of lands a player can play this turn
 * based on battlefield permanents
 */
export function calculateMaxLandsPerTurn(ctx: GameContext, playerId: string): number {
  let maxLands = 1; // Base: 1 land per turn
  
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(ADDITIONAL_LAND_PLAY_CARDS)) {
      if (cardName.includes(knownName) && effect.lands > 0) {
        // Check if this effect applies to this player
        const isController = perm.controller === playerId;
        if (isController || effect.affectsAll) {
          maxLands += effect.lands;
        }
      }
    }
  }
  
  return maxLands;
}

/**
 * Calculate the number of additional cards to draw during draw step
 * based on battlefield permanents
 */
export function calculateAdditionalDraws(ctx: GameContext, playerId: string): number {
  let additionalDraws = 0;
  
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(ADDITIONAL_DRAW_CARDS)) {
      if (cardName.includes(knownName) && effect.draws > 0) {
        // Check if this card requires being untapped (e.g., Howling Mine)
        // "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card."
        if (effect.requiresUntapped && perm.tapped) {
          continue; // Skip tapped permanents that require being untapped
        }
        
        const isController = perm.controller === playerId;
        const isOpponent = !isController;
        
        // Check if this effect applies to this player
        if (isController && !effect.affectsOpponents) {
          additionalDraws += effect.draws;
        } else if (effect.affectsAll) {
          additionalDraws += effect.draws;
        } else if (effect.affectsOpponents && isOpponent) {
          additionalDraws += effect.draws;
        }
      }
    }
  }
  
  return additionalDraws;
}

/**
 * Update player's maxLandsPerTurn and additionalDrawsPerTurn based on battlefield state
 * This should be called after permanents ETB or leave the battlefield
 */
export function recalculatePlayerEffects(ctx: GameContext, playerId?: string): void {
  const players = (ctx.state?.players as any[]) || [];
  const targetPlayers = playerId ? [{ id: playerId }] : players;
  
  for (const p of targetPlayers) {
    const pid = p.id;
    
    // Calculate and set max lands per turn
    const maxLands = calculateMaxLandsPerTurn(ctx, pid);
    (ctx as any).maxLandsPerTurn = (ctx as any).maxLandsPerTurn || {};
    (ctx as any).maxLandsPerTurn[pid] = maxLands;
    
    // Calculate and set additional draws per turn
    const additionalDraws = calculateAdditionalDraws(ctx, pid);
    (ctx as any).additionalDrawsPerTurn = (ctx as any).additionalDrawsPerTurn || {};
    (ctx as any).additionalDrawsPerTurn[pid] = additionalDraws;
  }
}
