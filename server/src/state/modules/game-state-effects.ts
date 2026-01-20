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
import type { PlayerID } from "../../../../shared/src/index.js";
import { grantTelepathyForPlayer, revokeTelepathyForPlayer } from "./telepathy.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";

/**
 * Check if a permanent is an actual Treasure token/artifact (not just a card that creates treasures)
 * A Treasure has "Treasure" as a subtype in type_line (e.g., "Token Artifact — Treasure")
 * Cards like "Dockside Extortionist" have "treasure" in oracle text but are NOT treasures
 */
export function isTreasureToken(permanent: any): boolean {
  const typeLine = (permanent?.card?.type_line || "").toLowerCase();
  const oracleText = (permanent?.card?.oracle_text || "").toLowerCase();
  const cardName = (permanent?.card?.name || "").toLowerCase();
  
  // Check if type_line contains "treasure" as a subtype (after the em-dash or hyphen)
  // Valid: "Token Artifact — Treasure", "Artifact — Treasure"
  // Invalid: Cards that just mention "treasure" in name/text
  const hasEmDash = typeLine.includes("—") || typeLine.includes("-");
  if (hasEmDash) {
    // Get the subtype portion (after the dash)
    const subtypePortion = typeLine.split(/[—-]/)[1] || "";
    // Must have "treasure" as a subtype, not in the main type
    if (subtypePortion.includes("treasure")) {
      return true;
    }
  }
  
  // For tokens without type_line parsing, check if it's explicitly a treasure token
  if (permanent?.isToken && cardName === "treasure") {
    return true;
  }
  
  // Check for the standard Treasure token oracle text pattern
  // Treasure tokens have: "{T}, Sacrifice this artifact: Add one mana of any color."
  if (typeLine.includes("artifact") && 
      oracleText.includes("sacrifice") && 
      oracleText.includes("add one mana of any color") &&
      // Must NOT have other complex abilities (real cards have more text)
      oracleText.length < 100) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent is a Food, Clue, Blood, or other artifact token type
 * Similar logic to isTreasureToken - checks actual subtype, not oracle text mentions
 */
export function isArtifactTokenSubtype(permanent: any, subtype: string): boolean {
  const typeLine = (permanent?.card?.type_line || "").toLowerCase();
  const subtypeLower = subtype.toLowerCase();
  
  const hasEmDash = typeLine.includes("—") || typeLine.includes("-");
  if (hasEmDash) {
    const subtypePortion = typeLine.split(/[—-]/)[1] || "";
    if (subtypePortion.includes(subtypeLower)) {
      return true;
    }
  }
  
  // For tokens without type_line parsing
  if (permanent?.isToken && (permanent?.card?.name || "").toLowerCase() === subtypeLower) {
    return true;
  }
  
  return false;
}

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

// =============================================================================
// ABILITY STATE CONDITIONS
// =============================================================================
// These are non-consumed conditions that enable abilities when met.
// They are checked but not spent - similar to threshold, metalcraft, delirium, etc.

/**
 * Interface for ability state conditions
 */
export interface AbilityStateCondition {
  readonly name: string;
  readonly description: string;
  readonly checkFunction: (ctx: GameContext, playerId: string) => boolean;
  readonly getValue?: (ctx: GameContext, playerId: string) => number;
}

/**
 * Check if metalcraft is active for a player (controls 3+ artifacts).
 * Rule 702.80 - Metalcraft abilities only function if controller has 3+ artifacts.
 * 
 * Examples:
 * - Mox Opal: Only taps for mana if metalcraft active
 * - Dispatch: Exiles instead of taps if metalcraft active
 * - Puresteel Paladin: Equip costs {0} if metalcraft active
 * - Galvanic Blast: Deals 5 damage instead of 2 if metalcraft active
 */
export function hasMetalcraft(ctx: GameContext, playerId: string): boolean {
  const artifactCount = countArtifacts(ctx, playerId);
  return artifactCount >= 3;
}

/**
 * Count artifacts a player controls (excluding phased out)
 */
export function countArtifacts(ctx: GameContext, playerId: string): number {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  return permanents.filter((p: any) => 
    (p.card?.type_line || "").toLowerCase().includes("artifact")
  ).length;
}

/**
 * Check if threshold is active for a player (7+ cards in graveyard).
 * Rule 702.41 - Threshold abilities only function if controller has 7+ cards in graveyard.
 * 
 * Examples:
 * - Werebear: Gets +3/+3 if threshold active
 * - Cabal Ritual: Adds {B}{B}{B}{B}{B} instead of {B}{B}{B} if threshold active
 */
export function hasThreshold(ctx: GameContext, playerId: string): boolean {
  const graveyardCount = getGraveyardCount(ctx, playerId);
  return graveyardCount >= 7;
}

/**
 * Get the number of cards in a player's graveyard
 */
export function getGraveyardCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).state?.zones?.[playerId];
  if (!zones) return 0;
  return (zones.graveyard || []).length;
}

/**
 * Check if delirium is active for a player (4+ card types in graveyard).
 * Rule 702.115 - Delirium abilities only function if controller has 4+ card types in graveyard.
 * 
 * Examples:
 * - Traverse the Ulvenwald: Can search for creature/land instead of just basic land
 * - Ishkanah, Grafwidow: Can use ability, spiders get reach
 */
export function hasDelirium(ctx: GameContext, playerId: string): boolean {
  const cardTypesInGraveyard = countCardTypesInGraveyard(ctx, playerId);
  return cardTypesInGraveyard >= 4;
}

/**
 * Count unique card types in a player's graveyard
 * Card types: artifact, creature, enchantment, instant, land, planeswalker, sorcery, tribal
 */
export function countCardTypesInGraveyard(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).state?.zones?.[playerId];
  if (!zones || !zones.graveyard) return 0;
  
  const cardTypes = new Set<string>();
  const typeKeywords = ['artifact', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery', 'tribal'];
  
  for (const card of zones.graveyard) {
    const typeLine = (card?.type_line || '').toLowerCase();
    for (const type of typeKeywords) {
      if (typeLine.includes(type)) {
        cardTypes.add(type);
      }
    }
  }
  
  return cardTypes.size;
}

/**
 * Check if a player has spell mastery (2+ instant/sorcery cards in graveyard).
 * Spell mastery abilities only function if controller has 2+ instant/sorcery in graveyard.
 * 
 * Examples:
 * - Fiery Impulse: Deals 3 damage instead of 2
 * - Exquisite Firecraft: Can't be countered
 */
export function hasSpellMastery(ctx: GameContext, playerId: string): boolean {
  const zones = (ctx as any).state?.zones?.[playerId];
  if (!zones || !zones.graveyard) return false;
  
  let instantSorceryCount = 0;
  for (const card of zones.graveyard) {
    const typeLine = (card?.type_line || '').toLowerCase();
    if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
      instantSorceryCount++;
      if (instantSorceryCount >= 2) return true;
    }
  }
  
  return false;
}

/**
 * Check if a player has ferocious (controls creature with power 4+).
 * Ferocious abilities only function if controller has a creature with power 4+.
 * 
 * Examples:
 * - Crater's Claws: Deals X+2 damage instead of X
 * - Stubborn Denial: Becomes hard counter
 */
export function hasFerocious(ctx: GameContext, playerId: string): boolean {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  
  for (const perm of permanents) {
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const power = parseInt(perm.card?.power || '0', 10) || 0;
    // TODO: Add counter modifications to power calculation
    const counterBonus = (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    
    if (power + counterBonus >= 4) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if formidable is active (creatures with total power 8+).
 * Formidable abilities only function if controller's creatures have total power 8+.
 */
export function hasFormidable(ctx: GameContext, playerId: string): boolean {
  const totalPower = getTotalCreaturePower(ctx, playerId);
  return totalPower >= 8;
}

/**
 * Get total power of all creatures a player controls
 */
export function getTotalCreaturePower(ctx: GameContext, playerId: string): number {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  let totalPower = 0;
  
  for (const perm of permanents) {
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const basePower = parseInt(perm.card?.power || '0', 10) || 0;
    const counterBonus = (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    totalPower += basePower + counterBonus;
  }
  
  return totalPower;
}

/**
 * Check if coven is active for a player (controls 3+ creatures with different powers).
 * Coven abilities only function if controller has 3+ creatures with different powers.
 * 
 * Examples:
 * - Augur of Autumn: Can cast creature spells from top of library if coven active
 * - Sigarda's Summons: Gives creatures +1/+1 and flying if coven active
 */
export function hasCoven(ctx: GameContext, playerId: string): boolean {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  const uniquePowers = new Set<number>();
  
  for (const perm of permanents) {
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const basePower = parseInt(perm.card?.power || '0', 10) || 0;
    const counterBonus = (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    const effectivePower = basePower + counterBonus;
    
    uniquePowers.add(effectivePower);
    
    // Early exit if we already have 3 different powers
    if (uniquePowers.size >= 3) {
      return true;
    }
  }
  
  return uniquePowers.size >= 3;
}

/**
 * Check all ability state conditions for a player and return active ones
 */
export function getActiveAbilityConditions(ctx: GameContext, playerId: string): Record<string, boolean> {
  return {
    metalcraft: hasMetalcraft(ctx, playerId),
    threshold: hasThreshold(ctx, playerId),
    delirium: hasDelirium(ctx, playerId),
    spellMastery: hasSpellMastery(ctx, playerId),
    ferocious: hasFerocious(ctx, playerId),
    formidable: hasFormidable(ctx, playerId),
    coven: hasCoven(ctx, playerId),
  };
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
  // New additions for Loot and similar effects
  "loot, exuberant explorer": { lands: 1 },
  "loot": { lands: 1 }, // Partial match for alternate names
  "exuberant explorer": { lands: 1 }, // Partial match
  "ancient greenwarden": { lands: 0 }, // Play from graveyard, not extra
  "budoka gardener": { lands: 1 }, // When flipped, lets you play extra
  "cultivate": { lands: 0 }, // One-shot spell, not continuous
  "herald of the pantheon": { lands: 0 }, // Enchantment cost reduction, not lands
  "storm the festival": { lands: 0 }, // One-shot spell
  "the gitrog monster": { lands: 1 }, // You may play an additional land on each of your turns
  "patron of the moon": { lands: 0 }, // Activated ability to put lands onto battlefield
  "summer bloom": { lands: 3 }, // Play 3 additional lands this turn (sorcery, handled differently)
  "journey of discovery": { lands: 2 }, // Entwined: search + play 2 extra lands (sorcery)
  "future sight": { lands: 0 }, // Play from top, not extra land drops
  "garruk's horde": { lands: 0 }, // Play creatures from top, not lands
  "karametra, god of harvests": { lands: 0 }, // Search and put on battlefield, not extra land drop
  "tatyova, benthic druid": { lands: 0 }, // Landfall trigger, not extra land drops
  "moraug, fury of akoum": { lands: 0 }, // Landfall for extra combat, not extra land drops
  "radha, heart of keld": { lands: 0 }, // Look at/play from top, not extra land drops
  "yasharn, implacable earth": { lands: 0 }, // Search on ETB, not extra land drops
  "aesi, tyrant of gyre strait": { lands: 1 }, // You may play an additional land on each of your turns
  "kynaios and tiro of meletis": { lands: 0 }, // End step ability, not extra land drops during turn
  "case of the locked hothouse": { lands: 1 }, // You may play an additional land on each of your turns
};

/**
 * Parse oracle text to detect additional land play effects dynamically
 * This handles cards not in the known list
 * 
 * Key distinction:
 * - "You may play" - affects only the controller of the permanent
 * - "Each player may play" / "player may play" - affects ALL players (Ghirapur Orrery, Rites of Flourishing)
 * 
 * Detects patterns like:
 * - "You may play an additional land on each of your turns" (Exploration, Azusa)
 * - "You may play two additional lands on each of your turns" (Azusa)
 * - "Each player may play an additional land on each of their turns" (Ghirapur Orrery)
 * - "Each player may play an additional land during each of their turns" (Rites of Flourishing)
 */
function detectAdditionalLandPlayFromOracle(oracleText: string): { lands: number; affectsAll: boolean } {
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check for "each player" or "player may play" patterns (Ghirapur Orrery, Rites of Flourishing)
  // These affect ALL players, not just the controller
  const affectsAll = lowerText.includes("each player may play") || 
                     lowerText.includes("each player can play") ||
                     lowerText.includes("player may play an additional land") ||
                     lowerText.includes("players may play an additional land");
  
  // Check for additional land patterns
  // "play an additional land" / "play one additional land"
  // This matches cards like "You may play an additional land on each of your turns" (Case of the Locked Hothouse)
  if (lowerText.includes("play an additional land") || 
      lowerText.includes("play one additional land")) {
    // Check if it's "two additional lands"
    if (lowerText.includes("two additional land")) {
      return { lands: 2, affectsAll };
    }
    // Check if it's "three additional lands"
    if (lowerText.includes("three additional land")) {
      return { lands: 3, affectsAll };
    }
    debug(2, `[detectAdditionalLandPlayFromOracle] Found "play an additional land" pattern, granting +1 land (affectsAll: ${affectsAll})`);
    return { lands: 1, affectsAll };
  }
  
  // "You may play X additional lands each turn"
  const multiLandMatch = lowerText.match(/play\s+(\w+)\s+additional\s+land/i);
  if (multiLandMatch) {
    const countWord = multiLandMatch[1].toLowerCase();
    const wordToNum: Record<string, number> = {
      'one': 1, 'two': 2, 'three': 3, 'four': 4, 'an': 1, 'a': 1
    };
    const lands = wordToNum[countWord] || 1;
    debug(2, `[detectAdditionalLandPlayFromOracle] Found multi-land pattern: "${countWord}" -> ${lands} lands (affectsAll: ${affectsAll})`);
    return { lands, affectsAll };
  }
  
  return { lands: 0, affectsAll: false };
}

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
 * based on battlefield permanents AND temporary spell effects
 * 
 * This handles:
 * - Cards that affect only their controller ("You may play")
 * - Cards that affect all players ("Each player may play") like Ghirapur Orrery
 */
export function calculateMaxLandsPerTurn(ctx: GameContext, playerId: string): number {
  let maxLands = 1; // Base: 1 land per turn
  
  const battlefield = getActivePermanents(ctx);
  const checkedPermanentIds = new Set<string>(); // Avoid double-counting
  
  debug(2, `[calculateMaxLandsPerTurn] Calculating for player ${playerId}, battlefield has ${battlefield.length} permanents`);
  
  for (const perm of battlefield) {
    if (checkedPermanentIds.has(perm.id)) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "");
    const isController = perm.controller === playerId;
    let foundInKnownList = false;
    
    // First check known cards list
    for (const [knownName, effect] of Object.entries(ADDITIONAL_LAND_PLAY_CARDS)) {
      if (cardName.includes(knownName) && effect.lands > 0) {
        // Check if this effect applies to this player
        // Effect applies if: player controls it OR effect affects all players
        if (isController || effect.affectsAll) {
          maxLands += effect.lands;
          checkedPermanentIds.add(perm.id);
          foundInKnownList = true;
          debug(2, `[calculateMaxLandsPerTurn] ${perm.card?.name} grants +${effect.lands} lands to ${playerId} (controller: ${perm.controller}, affectsAll: ${effect.affectsAll})`);
          break; // Only count once per permanent
        }
      }
    }
    
    // If not in known list, try dynamic oracle text parsing
    // This handles both controller-only and all-player effects dynamically
    if (!foundInKnownList) {
      const dynamicResult = detectAdditionalLandPlayFromOracle(oracleText);
      if (dynamicResult.lands > 0) {
        // Apply if: player controls it OR effect affects all players
        if (isController || dynamicResult.affectsAll) {
          maxLands += dynamicResult.lands;
          checkedPermanentIds.add(perm.id);
          debug(2, `[calculateMaxLandsPerTurn] Detected +${dynamicResult.lands} lands from ${perm.card?.name} via oracle text (controller: ${perm.controller}, affectsAll: ${dynamicResult.affectsAll})`);
        }
      }
    }
  }
  
  // Add temporary bonus from spells like Summer Bloom
  // These are stored in game state as additionalLandsThisTurn[playerId]
  const temporaryBonus = (ctx.state as any)?.additionalLandsThisTurn?.[playerId] || 0;
  if (temporaryBonus > 0) {
    maxLands += temporaryBonus;
    debug(2, `[calculateMaxLandsPerTurn] Added +${temporaryBonus} temporary lands for ${playerId} (spell effect)`);
  }
  
  debug(2, `[calculateMaxLandsPerTurn] Final result for ${playerId}: ${maxLands} lands per turn`);
  return maxLands;
}

/**
 * Known spells that grant temporary additional land plays for the turn
 */
const TEMPORARY_LAND_PLAY_SPELLS: Record<string, { lands: number }> = {
  "summer bloom": { lands: 3 },
  "journey of discovery": { lands: 2 }, // When entwined
  "explore": { lands: 1 }, // Draw a card, play an additional land
  "growth spiral": { lands: 1 }, // Actually puts land from hand, but similar
  "urban evolution": { lands: 1 },
  "wayward swordtooth": { lands: 1 }, // Actually a permanent, but included for reference
};

/**
 * Apply temporary additional land plays from a spell effect
 * Called when spells like Summer Bloom resolve
 */
export function applyTemporaryLandBonus(ctx: GameContext, playerId: string, additionalLands: number): void {
  (ctx.state as any).additionalLandsThisTurn = (ctx.state as any).additionalLandsThisTurn || {};
  const current = (ctx.state as any).additionalLandsThisTurn[playerId] || 0;
  (ctx.state as any).additionalLandsThisTurn[playerId] = current + additionalLands;
  
  debug(2, `[applyTemporaryLandBonus] ${playerId} can now play ${additionalLands} additional lands this turn (total bonus: ${current + additionalLands})`);
  
  // Also update maxLandsPerTurn immediately for the game state
  const newMax = calculateMaxLandsPerTurn(ctx, playerId);
  (ctx as any).maxLandsPerTurn = (ctx as any).maxLandsPerTurn || {};
  (ctx as any).maxLandsPerTurn[playerId] = newMax;
  
  if (ctx.state) {
    (ctx.state as any).maxLandsPerTurn = (ctx.state as any).maxLandsPerTurn || {};
    (ctx.state as any).maxLandsPerTurn[playerId] = newMax;
  }
}

/**
 * Clear temporary land bonuses at end of turn
 * Called during cleanup step
 */
export function clearTemporaryLandBonuses(ctx: GameContext): void {
  if ((ctx.state as any)?.additionalLandsThisTurn) {
    (ctx.state as any).additionalLandsThisTurn = {};
    debug(2, `[clearTemporaryLandBonuses] Cleared all temporary land bonuses`);
  }
}

/**
 * Check if a spell grants temporary additional land plays
 * Returns the number of additional lands, or 0 if not applicable
 */
export function detectSpellLandBonus(cardName: string, oracleText: string): number {
  const lowerName = (cardName || "").toLowerCase();
  const lowerText = (oracleText || "").toLowerCase();
  
  // Check known spells
  for (const [knownName, effect] of Object.entries(TEMPORARY_LAND_PLAY_SPELLS)) {
    if (lowerName.includes(knownName)) {
      debug(2, `[detectSpellLandBonus] Found known spell "${cardName}" matching "${knownName}": ${effect.lands} land(s)`);
      return effect.lands;
    }
  }
  
  // Dynamic detection patterns for various additional land play effects
  // Word to number mapping for parsing text numbers
  const wordToNum: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'an': 1, 'a': 1
  };
  
  // Pattern 1: "You may play up to X additional lands this turn"
  // Examples: Summer Bloom (up to three), Journey of Discovery (up to two)
  const upToThisTurnMatch = lowerText.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?\s+this\s+turn/i);
  if (upToThisTurnMatch) {
    const countWord = upToThisTurnMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || parseInt(countWord, 10) || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play up to ${countWord} additional lands this turn": ${lands} land(s)`);
    return lands;
  }
  
  // Pattern 2: "You may play X additional land(s) this turn"
  // Examples: Urban Evolution (an additional land), Explore (an additional land)
  const thisTurnMatch = lowerText.match(/play\s+(\w+)\s+additional\s+lands?\s+this\s+turn/i);
  if (thisTurnMatch) {
    const countWord = thisTurnMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play ${countWord} additional land(s) this turn": ${lands} land(s)`);
    return lands;
  }
  
  // Pattern 3: "You may play up to X additional lands" (without "this turn")
  // Fallback for variations
  const upToMatch = lowerText.match(/play\s+up\s+to\s+(\w+)\s+additional\s+lands?/i);
  if (upToMatch) {
    const countWord = upToMatch[1].toLowerCase();
    const lands = wordToNum[countWord] || parseInt(countWord, 10) || 1;
    debug(2, `[detectSpellLandBonus] Dynamically detected "${cardName}" with oracle text matching "play up to ${countWord} additional land(s)": ${lands} land(s)`);
    return lands;
  }
  
  // If we didn't find a match but the oracle text mentions "additional land", log it for debugging
  if (lowerText.includes('additional land')) {
    debugWarn(1, `[detectSpellLandBonus] Card "${cardName}" has "additional land" in oracle text but didn't match patterns. Oracle text: "${lowerText.substring(0, 200)}"`);
  }
  
  return 0;
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

// =============================================================================
// TOP OF LIBRARY EFFECTS
// =============================================================================
// Cards that let you look at and/or play cards from the top of your library

/**
 * Configuration for cards that reveal/play from top of library
 */
interface TopOfLibraryEffect {
  lookAtTop: boolean;           // Can look at top card at any time
  playLandsFromTop?: boolean;   // Can play lands from top of library
  castFromTop?: boolean;        // Can cast spells from top of library
  castTypes?: string[];         // Only these types can be cast (e.g., ['creature'])
  creatureTypeFilter?: string;  // Only creatures of this type (e.g., 'Goblin')
  conditionCheck?: string;      // Condition to cast (e.g., 'coven' for Augur of Autumn)
}

/**
 * Cards that grant top of library effects
 * Key: lowercase card name (partial match)
 */
const TOP_OF_LIBRARY_CARDS: Record<string, TopOfLibraryEffect> = {
  // Oracle of Mul Daya - "You may play lands from the top of your library" + reveal top
  "oracle of mul daya": {
    lookAtTop: true,
    playLandsFromTop: true,
  },
  // Courser of Kruphix - "Play lands from the top of your library" + reveal top
  "courser of kruphix": {
    lookAtTop: true,
    playLandsFromTop: true,
  },
  // Future Sight - "You may play the top card of your library"
  "future sight": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Experimental Frenzy - "You may play the top card of your library" (can't play from hand)
  "experimental frenzy": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Augur of Autumn - "You may look at the top card of your library" + "You may play lands from the top"
  // With coven: "You may cast creature spells from the top of your library"
  "augur of autumn": {
    lookAtTop: true,
    playLandsFromTop: true,
    castFromTop: true,
    castTypes: ['creature'],
    conditionCheck: 'coven',
  },
  // Conspicuous Snoop - "You may look at the top card of your library any time"
  // + "You may cast Goblin spells from the top of your library"
  "conspicuous snoop": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
    creatureTypeFilter: 'goblin',
  },
  // Eladamri, Korvecdal - "Look at the top card of your library any time"
  // + "You may cast creature spells from the top of your library"
  "eladamri, korvecdal": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Radha, Heart of Keld - "You may look at the top card of your library any time"
  // + "You may play lands from the top of your library"
  "radha, heart of keld": {
    lookAtTop: true,
    playLandsFromTop: true,
  },
  // Vizier of the Menagerie - "You may look at the top card of your library any time"
  // + "You may cast creature spells from the top of your library"
  "vizier of the menagerie": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Garruk's Horde - "You may look at the top card of your library any time"
  // + "You may cast creature spells from the top of your library"
  "garruk's horde": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['creature'],
  },
  // Melek, Izzet Paragon - "You may look at the top card of your library any time"
  // + "You may cast instant and sorcery spells from the top of your library"
  "melek, izzet paragon": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['instant', 'sorcery'],
  },
  // Bolas's Citadel - "You may look at the top card of your library any time"
  // + "You may play the top card of your library" (pay life equal to CMC)
  "bolas's citadel": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Mystic Forge - "You may look at the top card of your library any time"
  // + "You may cast the top card of your library if it's an artifact card or a colorless nonland card"
  "mystic forge": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['artifact'],
  },
  // Magus of the Future - Same as Future Sight
  "magus of the future": {
    lookAtTop: true,
    castFromTop: true,
    playLandsFromTop: true,
  },
  // Vance's Blasting Cannons - "At the beginning of your upkeep, exile the top card of your library. If it's a nonland card, you may cast it this turn"
  // Different mechanic - not continuous, so not included
  
  // The Gitrog Monster - Doesn't reveal top, but can play lands from graveyard
  // Different mechanic - not included
  
  // Elsha of the Infinite - "You may look at the top card of your library any time"
  // + "You may cast noncreature spells from the top of your library"
  "elsha of the infinite": {
    lookAtTop: true,
    castFromTop: true,
    castTypes: ['instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker'],
  },
};

/**
 * Check if a player can look at the top card of their library
 * Returns the source permanent if they can
 */
export function canLookAtTopOfLibrary(ctx: GameContext, playerId: string): { canLook: boolean; sources: string[] } {
  const sources: string[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(TOP_OF_LIBRARY_CARDS)) {
      if (cardName.includes(knownName) && effect.lookAtTop) {
        sources.push(perm.card?.name || knownName);
        break;
      }
    }
  }
  
  return { canLook: sources.length > 0, sources };
}

/**
 * Check if a player can play lands from the top of their library
 */
export function canPlayLandsFromTop(ctx: GameContext, playerId: string): { canPlay: boolean; sources: string[] } {
  const sources: string[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(TOP_OF_LIBRARY_CARDS)) {
      if (cardName.includes(knownName) && effect.playLandsFromTop) {
        sources.push(perm.card?.name || knownName);
        break;
      }
    }
  }
  
  return { canPlay: sources.length > 0, sources };
}

/**
 * Check if a player can cast a specific card type from the top of their library
 */
export function canCastFromTop(
  ctx: GameContext, 
  playerId: string, 
  cardTypeLine?: string
): { canCast: boolean; sources: string[]; restrictions: string[] } {
  const sources: string[] = [];
  const restrictions: string[] = [];
  const battlefield = getActivePermanents(ctx);
  
  const typeLine = (cardTypeLine || '').toLowerCase();
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    
    for (const [knownName, effect] of Object.entries(TOP_OF_LIBRARY_CARDS)) {
      if (cardName.includes(knownName) && effect.castFromTop) {
        // Check type restrictions
        if (effect.castTypes && effect.castTypes.length > 0) {
          const typeMatches = effect.castTypes.some(t => typeLine.includes(t));
          if (!typeMatches) {
            restrictions.push(`${perm.card?.name || knownName} only allows: ${effect.castTypes.join(', ')}`);
            continue;
          }
        }
        
        // Check creature type filter (e.g., Conspicuous Snoop for Goblins)
        if (effect.creatureTypeFilter && typeLine.includes('creature')) {
          if (!typeLine.includes(effect.creatureTypeFilter)) {
            restrictions.push(`${perm.card?.name || knownName} only allows ${effect.creatureTypeFilter} creatures`);
            continue;
          }
        }
        
        // Check condition (e.g., coven for Augur of Autumn)
        if (effect.conditionCheck === 'coven') {
          if (!hasCoven(ctx, playerId)) {
            restrictions.push(`${perm.card?.name || knownName} requires coven (3 creatures with different powers)`);
            continue;
          }
        }
        
        sources.push(perm.card?.name || knownName);
        break;
      }
    }
  }
  
  return { canCast: sources.length > 0, sources, restrictions };
}

/**
 * Get the top card of a player's library (if they can see it)
 */
export function getTopCardForPlayer(ctx: GameContext, playerId: string): { 
  card: any | null; 
  canSee: boolean; 
  sources: string[];
} {
  const { canLook, sources } = canLookAtTopOfLibrary(ctx, playerId);
  
  if (!canLook) {
    return { card: null, canSee: false, sources: [] };
  }
  
  // Get the top card from player's library
  const zones = ctx.state?.zones as any;
  const playerZone = zones?.[playerId];
  const library = playerZone?.library || [];
  
  if (library.length === 0) {
    return { card: null, canSee: true, sources };
  }
  
  // Library is typically stored bottom-to-top, so last element is top
  const topCard = library[library.length - 1];
  
  return { card: topCard, canSee: true, sources };
}

/**
 * Known cards that reveal opponents' hands (static effects only)
 * Key: lowercase card name (partial match)
 * These cards have permanent effects like "Your opponents play with their hands revealed"
 * 
 * NOTE: One-shot effects (Thoughtseize, Duress, etc.) are NOT included here
 * as they don't provide ongoing hand visibility.
 */
const HAND_REVEAL_CARDS: string[] = [
  "telepathy",                    // "Your opponents play with their hands revealed."
  "glasses of urza",             // "Target player plays with their hand revealed"
  "revelation",                  // "Each player plays with their hand revealed."
  "zur's weirding",              // "Players play with their hands revealed."
  "wandering eye",               // "Each player plays with their hand revealed."
  "seer's vision",               // "Enchanted player plays with their hand revealed."
];

/**
 * Detect if a permanent grants hand visibility to its controller (sees opponents' hands)
 * Returns true if the permanent has a static effect that reveals opponents' hands
 */
function detectHandRevealEffect(oracleText: string): { revealsOpponentsHands: boolean; revealsAllHands: boolean } {
  const lowerText = (oracleText || "").toLowerCase();
  
  // "Your opponents play with their hands revealed" - Telepathy
  if (lowerText.includes("your opponents play with their hands revealed") ||
      lowerText.includes("opponents play with their hands revealed")) {
    return { revealsOpponentsHands: true, revealsAllHands: false };
  }
  
  // "Each player plays with their hand revealed" - Revelation, Wandering Eye
  if (lowerText.includes("each player plays with their hand revealed") ||
      lowerText.includes("players play with their hands revealed")) {
    return { revealsOpponentsHands: true, revealsAllHands: true };
  }
  
  return { revealsOpponentsHands: false, revealsAllHands: false };
}

/**
 * Recalculate hand visibility grants based on battlefield permanents
 * This handles Telepathy and similar static effects that reveal hands
 * 
 * Note: This function clears and rebuilds all grants on each call.
 * This is simpler and more reliable than diff-based approaches, and
 * the performance impact is minimal since battlefield sizes are typically small.
 */
function recalculateHandVisibility(ctx: GameContext): void {
  const battlefield = getActivePermanents(ctx);
  
  // Track which players have hand reveal effects active
  const playersWithHandReveal = new Set<PlayerID>();
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "");
    const controller = perm.controller as PlayerID;
    
    // Check known cards first
    let hasRevealEffect = false;
    for (const knownName of HAND_REVEAL_CARDS) {
      if (cardName.includes(knownName)) {
        // Check if this is a static effect (not one-shot spells)
        const reveal = detectHandRevealEffect(oracleText);
        if (reveal.revealsOpponentsHands) {
          playersWithHandReveal.add(controller);
          hasRevealEffect = true;
          break;
        }
      }
    }
    
    // If not in known list, try dynamic detection
    if (!hasRevealEffect) {
      const reveal = detectHandRevealEffect(oracleText);
      if (reveal.revealsOpponentsHands) {
        playersWithHandReveal.add(controller);
      }
    }
  }
  
  // Initialize handVisibilityGrants if it doesn't exist
  if (!ctx.handVisibilityGrants) {
    ctx.handVisibilityGrants = new Map();
  }
  
  // Clear all existing hand visibility grants and rebuild from scratch
  // This ensures we don't have stale grants when permanents leave the battlefield
  ctx.handVisibilityGrants.clear();
  
  // Grant hand visibility for each player with a reveal effect
  for (const telepath of playersWithHandReveal) {
    grantTelepathyForPlayer(ctx, telepath);
  }
  
  debug(1, `[recalculateHandVisibility] Players with hand reveal effects: ${Array.from(playersWithHandReveal).join(', ') || 'none'}`);
}

/**
 * Update player's top-of-library effects based on battlefield state
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
    
    // Also update ctx.state.maxLandsPerTurn for compatibility with game-actions.ts
    // which reads from game.state.maxLandsPerTurn
    if (ctx.state) {
      (ctx.state as any).maxLandsPerTurn = (ctx.state as any).maxLandsPerTurn || {};
      (ctx.state as any).maxLandsPerTurn[pid] = maxLands;
    }
    
    // Calculate and set additional draws per turn
    const additionalDraws = calculateAdditionalDraws(ctx, pid);
    (ctx as any).additionalDrawsPerTurn = (ctx as any).additionalDrawsPerTurn || {};
    (ctx as any).additionalDrawsPerTurn[pid] = additionalDraws;
    
    // Also update ctx.state.additionalDrawsPerTurn for compatibility
    if (ctx.state) {
      (ctx.state as any).additionalDrawsPerTurn = (ctx.state as any).additionalDrawsPerTurn || {};
      (ctx.state as any).additionalDrawsPerTurn[pid] = additionalDraws;
    }
    
    // Calculate and set top-of-library effects
    const topOfLibraryLook = canLookAtTopOfLibrary(ctx, pid);
    const topOfLibraryPlayLands = canPlayLandsFromTop(ctx, pid);
    const topOfLibraryCast = canCastFromTop(ctx, pid);
    
    if (ctx.state) {
      (ctx.state as any).topOfLibraryEffects = (ctx.state as any).topOfLibraryEffects || {};
      (ctx.state as any).topOfLibraryEffects[pid] = {
        canLook: topOfLibraryLook.canLook,
        lookSources: topOfLibraryLook.sources,
        canPlayLands: topOfLibraryPlayLands.canPlay,
        playLandSources: topOfLibraryPlayLands.sources,
        canCast: topOfLibraryCast.canCast,
        castSources: topOfLibraryCast.sources,
      };
    }
  }
  
  // After all per-player effects are calculated, update hand visibility grants
  // This handles Telepathy and similar effects that reveal opponents' hands
  recalculateHandVisibility(ctx);
}


/**
 * Damage modifiers for creatures like Gisela, Blade of Goldnight
 * Key: lowercase card name, Value: modifier configuration
 */
const DAMAGE_MODIFIERS: Record<string, { 
  doubleDamageToOpponents?: boolean; 
  halveDamageToController?: boolean;
  doubleDamageFromSource?: boolean;
}> = {
  "gisela, blade of goldnight": {
    doubleDamageToOpponents: true,
    halveDamageToController: true,
  },
  "furnace of rath": {
    doubleDamageToOpponents: true,
    doubleDamageFromSource: true, // Doubles ALL damage
  },
  "dictate of the twin gods": {
    doubleDamageToOpponents: true,
    doubleDamageFromSource: true, // Doubles ALL damage
  },
  "fiery emancipation": {
    // Triples damage dealt by sources you control
    doubleDamageToOpponents: false, // Special handling needed for triple
  },
};

/**
 * Calculate modified damage amount based on battlefield effects
 * Handles Gisela, Furnace of Rath, etc.
 * 
 * @param ctx - Game context
 * @param damageAmount - Base damage amount
 * @param damageDealer - Player ID dealing the damage (controller of damage source)
 * @param damageReceiver - Player ID receiving the damage
 * @returns Modified damage amount
 */
export function calculateModifiedDamage(
  ctx: GameContext,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string
): { amount: number; modifiers: string[] } {
  const isToOpponent = damageDealer !== damageReceiver;
  
  // Detect all replacement effects that apply
  const effects = detectDamageReplacementEffects(ctx, damageDealer, damageReceiver, isToOpponent);
  
  if (effects.length === 0) {
    return { amount: damageAmount, modifiers: [] };
  }

  // MTG Rule 616.1: if multiple replacement effects apply to a damage event,
  // the affected player chooses the order to apply them.
  const pref = getReplacementEffectPreference(ctx, damageReceiver, 'damage');
  const mode = getReplacementEffectMode(pref, 'damage');

  if (mode === 'custom' && Array.isArray(pref?.customOrder) && pref.customOrder.length > 0) {
    const ordered = sortEffectsByCustomOrder(effects, pref.customOrder);
    const customResult = applyReplacementsCustomOrder(damageAmount, ordered);
    return { amount: Math.max(0, customResult.finalAmount), modifiers: customResult.appliedEffects };
  }

  if (mode === 'maximize') {
    const maxResult = applyDamageReplacementsMaximized(damageAmount, effects);
    return { amount: Math.max(0, maxResult.finalAmount), modifiers: maxResult.appliedEffects };
  }

  const minResult = applyDamageReplacementsMinimized(damageAmount, effects);
  return { amount: Math.max(0, minResult.finalAmount), modifiers: minResult.appliedEffects };
}

/**
 * Combat damage replacement effects
 * These effects prevent combat damage and apply a different effect instead
 * 
 * Key: lowercase card name (partial match)
 * Value: replacement effect configuration
 */
export interface CombatDamageReplacementEffect {
  /** Description of the effect */
  description: string;
  /** If true, prevents the combat damage from being dealt */
  preventsDamage: boolean;
  /** Mill effect: all opponents mill cards equal to damage amount */
  millAllOpponents?: boolean;
  /** Damage to player effect: deal damage to target player instead */
  damageToPlayer?: boolean;
  /** Only applies when damage would be dealt to a player (not creatures) */
  onlyToPlayers?: boolean;
}

const COMBAT_DAMAGE_REPLACEMENT_CARDS: Record<string, CombatDamageReplacementEffect> = {
  "the mindskinner": {
    description: "Prevent combat damage, each opponent mills that many cards",
    preventsDamage: true,
    millAllOpponents: true,
    onlyToPlayers: true,
  },
  // Szadek, Lord of Secrets - similar effect but only mills defending player
  "szadek, lord of secrets": {
    description: "Put +1/+1 counters instead of dealing damage, defending player mills that many",
    preventsDamage: true, // Damage is replaced with counters
    onlyToPlayers: true,
  },
  // Consuming Aberration - mills when dealing damage (but doesn't prevent)
  // Not a true replacement, so not included here
};

/**
 * Check if a creature has a combat damage replacement effect
 * Returns the replacement effect if found, null otherwise
 */
export function detectCombatDamageReplacement(
  ctx: GameContext,
  attackerCard: any,
  attackerPermanent: any
): CombatDamageReplacementEffect | null {
  const cardName = (attackerCard?.name || "").toLowerCase();
  const oracleText = (attackerCard?.oracle_text || "").toLowerCase();
  
  // Check known cards first
  for (const [knownName, effect] of Object.entries(COMBAT_DAMAGE_REPLACEMENT_CARDS)) {
    if (cardName.includes(knownName)) {
      return effect;
    }
  }
  
  // Dynamic detection via oracle text patterns
  // Pattern: "If ~ would deal combat damage to a player, prevent that damage"
  // followed by "mill" or "each opponent mills"
  if (oracleText.includes('would deal combat damage') && 
      oracleText.includes('prevent that damage')) {
    // Check for mill effect
    if (oracleText.includes('mills') || oracleText.includes('mill cards equal')) {
      const millsAllOpponents = oracleText.includes('each opponent mills') ||
                                 oracleText.includes('each opponent mills cards');
      return {
        description: 'Prevent combat damage, mill effect',
        preventsDamage: true,
        millAllOpponents: millsAllOpponents,
        onlyToPlayers: true,
      };
    }
    
    // Other replacement effects could be detected here
  }
  
  return null;
}

/**
 * Check if damage prevention is being blocked by an effect
 * Returns true if damage cannot be prevented
 */
export function canDamageBePrevented(
  ctx: GameContext,
  damageSource: any,
  damageTarget: string
): boolean {
  const battlefield = getActivePermanents(ctx);
  const oracleText = (damageSource?.oracle_text || "").toLowerCase();
  
  // Check if the source itself says damage can't be prevented
  if (oracleText.includes("damage can't be prevented") ||
      oracleText.includes("damage that would be dealt by") && oracleText.includes("can't be prevented")) {
    return false;
  }
  
  // Check for battlefield effects that prevent damage prevention
  for (const perm of battlefield) {
    const permOracle = (perm.card?.oracle_text || "").toLowerCase();
    const permName = (perm.card?.name || "").toLowerCase();
    
    // Leyline of Punishment: "Players can't gain life. Damage can't be prevented."
    if (permName.includes("leyline of punishment")) {
      return false;
    }
    
    // Skullcrack effect (instant) - check if there's a persistent effect
    // Everlasting Torment: "Players can't gain life. Damage can't be prevented."
    if (permName.includes("everlasting torment")) {
      return false;
    }
    
    // Stigma Lasher - "Damage can't be prevented" for players it damaged
    // This would need special tracking
    
    // Quakebringer - "Damage... can't be prevented"
    if (permOracle.includes("damage can't be prevented")) {
      return false;
    }
  }
  
  return true;
}

/**
 * Apply combat damage replacement effect for The Mindskinner and similar cards
 * 
 * @param ctx - Game context
 * @param attackerCard - The attacking creature's card data
 * @param attackerPermanent - The attacking creature permanent
 * @param attackerController - Player ID of the attacker's controller
 * @param damageAmount - Original damage amount
 * @param defendingPlayerId - Player who would receive the damage
 * @returns Object with prevented damage and applied effects
 */
export function applyCombatDamageReplacement(
  ctx: GameContext,
  attackerCard: any,
  attackerPermanent: any,
  attackerController: string,
  damageAmount: number,
  defendingPlayerId: string
): {
  damageDealt: number;
  prevented: boolean;
  effectsApplied: string[];
  millAmount?: number;
  millTargets?: string[];
} {
  const result = {
    damageDealt: damageAmount,
    prevented: false,
    effectsApplied: [] as string[],
    millAmount: undefined as number | undefined,
    millTargets: undefined as string[] | undefined,
  };
  
  const replacement = detectCombatDamageReplacement(ctx, attackerCard, attackerPermanent);
  if (!replacement) {
    return result;
  }
  
  // Check if damage can be prevented
  const canPrevent = canDamageBePrevented(ctx, attackerCard, defendingPlayerId);
  
  if (replacement.preventsDamage && canPrevent) {
    // Prevent the damage
    result.damageDealt = 0;
    result.prevented = true;
    result.effectsApplied.push(`${attackerCard.name || 'Effect'}: combat damage prevented`);
  } else if (replacement.preventsDamage && !canPrevent) {
    // Damage cannot be prevented - deal normal damage
    // But the mill effect should still happen!
    result.effectsApplied.push(`${attackerCard.name || 'Effect'}: damage could not be prevented`);
  }
  
  // Apply mill effect regardless of whether damage was prevented
  // (The Mindskinner mills based on damage "that would have been dealt")
  if (replacement.millAllOpponents && damageAmount > 0) {
    const players = (ctx.state?.players as any[]) || [];
    const opponents = players
      .filter((p: any) => p && p.id !== attackerController && !p.hasLost)
      .map((p: any) => p.id);
    
    result.millAmount = damageAmount;
    result.millTargets = opponents;
    result.effectsApplied.push(`Each opponent mills ${damageAmount} cards`);
  }
  
  return result;
}

/**
 * Replacement Effect Ordering System
 * 
 * MTG Rule 616.1: If two or more replacement effects would apply to a single event,
 * the affected object's controller (or its owner if it has no controller) or
 * the affected player chooses one to apply first.
 * 
 * OPTIMIZATION RULES FOR AUTOMATED ORDERING:
 * 
 * For BENEFICIAL effects (gaining life, counters, tokens, creature P/T):
 * - Apply +1 (singular increase) effects BEFORE doublers
 * - This maximizes the final value: (X + 1) * 2 > (X * 2) + 1
 * - Example: 3 life with Leyline of Hope (+1) and Boon Reflection (double)
 *   - Optimal: (3 + 1) * 2 = 8 life
 *   - Suboptimal: (3 * 2) + 1 = 7 life
 * 
 * For HARMFUL effects (receiving damage):
 * - The receiver chooses to MINIMIZE damage
 * - Apply doublers BEFORE +1 effects: (X * 2) + 1 < (X + 1) * 2
 * - Apply halving effects strategically:
 *   - If you can reduce to 0 with -1 effects, apply those first
 *   - Otherwise, halving should typically go first (Gisela)
 */

export type ReplacementEffectType = 
  | 'add_flat'      // +1, +2, etc.
  | 'double'        // *2
  | 'triple'        // *3
  | 'halve'         // /2 (rounded down)
  | 'halve_round_up' // /2 (rounded up, like Gisela's prevention)
  | 'prevent';      // Set to 0

export interface ReplacementEffect {
  type: ReplacementEffectType;
  value?: number;     // For 'add_flat' type
  source: string;     // Card name that provides this effect
  controllerId?: string; // Who controls the source
}

type ReplacementEffectPreferenceState = {
  /**
   * Stored on game state as player preference.
   * Currently used as a simple override toggle, and optionally with a custom order list.
   */
  mode?: 'minimize' | 'maximize' | 'custom' | 'auto';
  useCustomOrder?: boolean;
  /** Optional explicit custom order by source name. */
  customOrder?: string[];
};

function getReplacementEffectMode(
  pref: ReplacementEffectPreferenceState | null,
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens'
): 'minimize' | 'maximize' | 'custom' | 'auto' {
  if (pref?.mode) return pref.mode;

  // Back-compat: older state stored only a boolean toggle.
  if (effectType === 'damage') {
    return pref?.useCustomOrder ? 'maximize' : 'minimize';
  }
  return pref?.useCustomOrder ? 'custom' : 'auto';
}

function getReplacementEffectPreference(
  ctx: GameContext,
  playerId: string,
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens'
): ReplacementEffectPreferenceState | null {
  const prefs = (ctx.state as any)?.replacementEffectPreferences?.[playerId];
  const pref = prefs?.[effectType];
  return pref && typeof pref === 'object' ? (pref as ReplacementEffectPreferenceState) : null;
}

function sortEffectsByCustomOrder(
  effects: ReplacementEffect[],
  customOrder: string[]
): ReplacementEffect[] {
  const orderIndex = new Map<string, number>();
  for (let i = 0; i < customOrder.length; i++) {
    orderIndex.set(String(customOrder[i]), i);
  }

  // Stable-ish ordering: known entries first in the specified order, then the rest.
  return [...effects].sort((a, b) => {
    const ai = orderIndex.has(a.source) ? (orderIndex.get(a.source) as number) : Number.POSITIVE_INFINITY;
    const bi = orderIndex.has(b.source) ? (orderIndex.get(b.source) as number) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return String(a.source).localeCompare(String(b.source));
  });
}

/**
 * Apply replacement effects in optimal order for BENEFICIAL outcomes.
 * Used for: life gain, counter gain, token creation, power/toughness buffs.
 * 
 * Order: add_flat -> double -> triple
 * This maximizes the final value.
 * 
 * @param baseAmount - Starting amount before any replacements
 * @param effects - Array of replacement effects to apply
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyBeneficialReplacements(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  const appliedEffects: string[] = [];
  let amount = baseAmount;
  
  // Sort effects to maximize the final value.
  // Note: halving/prevention are generally harmful, so apply them last.
  const sortedEffects = [...effects].sort((a, b) => {
    const order: Record<ReplacementEffectType, number> = {
      'add_flat': 1,
      'double': 2,
      'triple': 3,
      'halve_round_up': 4,
      'halve': 5,
      'prevent': 6,
    };
    return (order[a.type] || 99) - (order[b.type] || 99);
  });
  
  for (const effect of sortedEffects) {
    const before = amount;
    switch (effect.type) {
      case 'add_flat':
        amount += effect.value || 1;
        appliedEffects.push(`${effect.source}: +${effect.value || 1} (${before} -> ${amount})`);
        break;
      case 'double':
        amount *= 2;
        appliedEffects.push(`${effect.source}: doubled (${before} -> ${amount})`);
        break;
      case 'triple':
        amount *= 3;
        appliedEffects.push(`${effect.source}: tripled (${before} -> ${amount})`);
        break;
      case 'halve':
        amount = Math.floor(amount / 2);
        appliedEffects.push(`${effect.source}: halved (${before} -> ${amount})`);
        break;
      case 'halve_round_up':
        amount = Math.ceil(amount / 2);
        appliedEffects.push(`${effect.source}: halved rounded up (${before} -> ${amount})`);
        break;
      case 'prevent':
        amount = 0;
        appliedEffects.push(`${effect.source}: prevented (${before} -> 0)`);
        break;
    }
  }
  
  return { finalAmount: Math.max(0, amount), appliedEffects };
}

/**
 * Apply replacement effects in optimal order for MINIMIZING HARMFUL outcomes.
 * Used for: damage received by a player.
 * 
 * Order strategy to minimize damage:
 * 1. Check if we can reduce to 0 with prevention or enough -1 effects
 * 2. Otherwise: halve first -> double -> add_flat -> triple
 * 
 * The receiver chooses order to minimize final damage.
 * 
 * @param baseAmount - Starting damage amount
 * @param effects - Array of replacement effects to apply
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyDamageReplacementsMinimized(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  const appliedEffects: string[] = [];
  let amount = baseAmount;
  
  // Check for prevention first
  const preventEffects = effects.filter(e => e.type === 'prevent');
  if (preventEffects.length > 0) {
    appliedEffects.push(`${preventEffects[0].source}: prevented (${amount} -> 0)`);
    return { finalAmount: 0, appliedEffects };
  }
  
  // Sort effects to minimize damage received:
  // Order: halve_round_up -> halve -> double -> triple -> add_flat
  // 
  // Mathematical reasoning for this order:
  // - Halving first applies to the base damage, then doublers multiply the halved amount
  //   Example: Base 10, halve then double: (10/2) * 2 = 10
  //            Base 10, double then halve: (10 * 2) / 2 = 10 (same result)
  // - Add_flat goes LAST so it's not multiplied by doublers/triplers
  //   Example: Base 10, +1 then double: (10 + 1) * 2 = 22
  //            Base 10, double then +1: (10 * 2) + 1 = 21 (better for receiver)
  // - Therefore: halve -> double/triple -> add_flat minimizes final damage
  const sortedEffects = [...effects].sort((a, b) => {
    const order: Record<ReplacementEffectType, number> = {
      'prevent': 0,        // Already handled above
      'halve_round_up': 1, // Halve first (Gisela's prevention style - rounded up means less damage)
      'halve': 2,          // Standard halving
      'double': 3,         // Doublers apply to halved amount
      'triple': 4,         // Triplers apply to halved amount
      'add_flat': 5,       // Add last so it's not multiplied
    };
    return (order[a.type] || 99) - (order[b.type] || 99);
  });
  
  for (const effect of sortedEffects) {
    const before = amount;
    switch (effect.type) {
      case 'add_flat':
        amount += effect.value || 1;
        appliedEffects.push(`${effect.source}: +${effect.value || 1} (${before} -> ${amount})`);
        break;
      case 'double':
        amount *= 2;
        appliedEffects.push(`${effect.source}: doubled (${before} -> ${amount})`);
        break;
      case 'triple':
        amount *= 3;
        appliedEffects.push(`${effect.source}: tripled (${before} -> ${amount})`);
        break;
      case 'halve':
        amount = Math.floor(amount / 2);
        appliedEffects.push(`${effect.source}: halved (${before} -> ${amount})`);
        break;
      case 'halve_round_up':
        amount = Math.ceil(amount / 2);
        appliedEffects.push(`${effect.source}: halved rounded up (${before} -> ${amount})`);
        break;
      case 'prevent':
        // Already handled above
        break;
    }
  }
  
  return { finalAmount: Math.max(0, amount), appliedEffects };
}

/**
 * Apply replacement effects in optimal order for MAXIMIZING DAMAGE TO OPPONENTS.
 * Used for: damage dealt by the attacker to opponents.
 * 
 * Order: add_flat -> double -> triple (maximize final damage)
 * 
 * @param baseAmount - Starting damage amount
 * @param effects - Array of replacement effects to apply
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyDamageReplacementsMaximized(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  // For maximizing damage, use the same logic as beneficial replacements
  return applyBeneficialReplacements(baseAmount, effects);
}

/**
 * Apply replacement effects in a CUSTOM order specified by the player.
 * This allows players to override the default ordering when they want to
 * maximize or minimize effects for strategic reasons.
 * 
 * Use cases:
 * - Selfless Squire: Player wants to maximize incoming damage to gain counters
 * - Redirect effects: Player wants damage redirected to maximize the redirect
 * - Damage to creatures that gain benefits (Stuffy Doll, Brash Taunter)
 * 
 * @param baseAmount - Starting amount before any replacements
 * @param effects - Array of replacement effects to apply (already in desired order)
 * @returns { finalAmount, appliedEffects } - Result and description of what was applied
 */
export function applyReplacementsCustomOrder(
  baseAmount: number,
  effects: ReplacementEffect[]
): { finalAmount: number; appliedEffects: string[] } {
  const appliedEffects: string[] = [];
  let amount = baseAmount;
  
  // Apply effects in the exact order provided (no sorting)
  for (const effect of effects) {
    const before = amount;
    switch (effect.type) {
      case 'add_flat':
        amount += effect.value || 1;
        appliedEffects.push(`${effect.source}: +${effect.value || 1} (${before} -> ${amount})`);
        break;
      case 'double':
        amount *= 2;
        appliedEffects.push(`${effect.source}: doubled (${before} -> ${amount})`);
        break;
      case 'triple':
        amount *= 3;
        appliedEffects.push(`${effect.source}: tripled (${before} -> ${amount})`);
        break;
      case 'halve':
        amount = Math.floor(amount / 2);
        appliedEffects.push(`${effect.source}: halved (${before} -> ${amount})`);
        break;
      case 'halve_round_up':
        amount = Math.ceil(amount / 2);
        appliedEffects.push(`${effect.source}: halved rounded up (${before} -> ${amount})`);
        break;
      case 'prevent':
        amount = 0;
        appliedEffects.push(`${effect.source}: prevented (${before} -> 0)`);
        break;
    }
  }
  
  return { finalAmount: Math.max(0, amount), appliedEffects };
}

/**
 * Helper structure for storing player's custom replacement effect ordering preference.
 * This can be stored in game state to persist ordering choices during a game.
 */
export interface ReplacementEffectOrderPreference {
  playerId: string;
  effectType: 'damage' | 'life_gain' | 'counters' | 'tokens';
  useCustomOrder: boolean;
  customOrder?: string[];  // Source names in desired order
}

/**
 * Detect all damage replacement effects from the battlefield that apply to a specific damage event.
 * 
 * @param ctx - Game context
 * @param damageDealer - Player ID dealing the damage (controller of source)
 * @param damageReceiver - Player ID receiving the damage
 * @param isToOpponent - True if damage is being dealt TO an opponent
 * @returns Array of replacement effects that apply
 */
export function detectDamageReplacementEffects(
  ctx: GameContext,
  damageDealer: string,
  damageReceiver: string,
  isToOpponent: boolean
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const controller = perm.controller;
    
    // Gisela, Blade of Goldnight
    if (cardName.includes("gisela, blade of goldnight")) {
      if (controller === damageDealer && isToOpponent) {
        // Double damage to opponents
        effects.push({
          type: 'double',
          source: "Gisela, Blade of Goldnight (double)",
          controllerId: controller,
        });
      }
      if (controller === damageReceiver && !isToOpponent) {
        // Halve damage to self (rounded up = damage rounded down)
        effects.push({
          type: 'halve',
          source: "Gisela, Blade of Goldnight (halve)",
          controllerId: controller,
        });
      }
    }
    
    // Furnace of Rath / Dictate of the Twin Gods - doubles ALL damage
    if (cardName.includes("furnace of rath") || cardName.includes("dictate of the twin gods")) {
      effects.push({
        type: 'double',
        source: perm.card?.name || "Damage Doubler",
        controllerId: controller,
      });
    }
    
    // Fiery Emancipation - triples damage dealt by sources you control
    if (cardName.includes("fiery emancipation") && controller === damageDealer) {
      effects.push({
        type: 'triple',
        source: "Fiery Emancipation",
        controllerId: controller,
      });
    }
    
    // Torbran, Thane of Red Fell - +2 damage from red sources you control
    if (cardName.includes("torbran, thane of red fell") && controller === damageDealer) {
      effects.push({
        type: 'add_flat',
        value: 2,
        source: "Torbran, Thane of Red Fell",
        controllerId: controller,
      });
    }
    
    // City on Fire - triples damage from sources you control
    if (cardName.includes("city on fire") && controller === damageDealer) {
      effects.push({
        type: 'triple',
        source: "City on Fire",
        controllerId: controller,
      });
    }
    
    // Embermaw Hellion - +1 damage from red sources you control
    if (cardName.includes("embermaw hellion") && controller === damageDealer) {
      effects.push({
        type: 'add_flat',
        value: 1,
        source: "Embermaw Hellion",
        controllerId: controller,
      });
    }
    
    // Angrath's Marauders - double damage from sources you control
    if (cardName.includes("angrath's marauders") && controller === damageDealer) {
      effects.push({
        type: 'double',
        source: "Angrath's Marauders",
        controllerId: controller,
      });
    }
    
    // The Sound of Drums - double combat damage from enchanted creature
    // Oracle text: "If enchanted creature would deal combat damage to a permanent or player, it deals double that damage instead."
    if (cardName.includes("sound of drums") && perm.attachedTo === damageDealer) {
      effects.push({
        type: 'double',
        source: "The Sound of Drums",
        controllerId: controller,
      });
    }
  }
  
  return effects;
}

/**
 * Detect counter modification effects for "whenever you put counters" replacements.
 * Used for Doubling Season, Hardened Scales, etc.
 * 
 * @param ctx - Game context
 * @param controllerId - Player putting counters
 * @param counterType - Type of counter ('+1/+1', 'loyalty', etc.)
 * @returns Array of replacement effects
 */
export function detectCounterReplacementEffects(
  ctx: GameContext,
  controllerId: string,
  counterType: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "").toLowerCase();
    const controller = perm.controller;
    
    // Doubling Season - doubles counters put on permanents you control
    if (cardName.includes("doubling season") && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Doubling Season",
        controllerId: controller,
      });
    }
    
    // Hardened Scales - +1 to +1/+1 counters
    if (cardName.includes("hardened scales") && controller === controllerId && counterType === '+1/+1') {
      effects.push({
        type: 'add_flat',
        value: 1,
        source: "Hardened Scales",
        controllerId: controller,
      });
    }
    
    // Branching Evolution - doubles +1/+1 counters on creatures
    if (cardName.includes("branching evolution") && controller === controllerId && counterType === '+1/+1') {
      effects.push({
        type: 'double',
        source: "Branching Evolution",
        controllerId: controller,
      });
    }
    
    // Vorinclex, Monstrous Raider - doubles counters on your permanents
    if (cardName.includes("vorinclex, monstrous raider") && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Vorinclex, Monstrous Raider",
        controllerId: controller,
      });
    }
    
    // Winding Constrictor - +1 to counters on permanents you control
    if (cardName.includes("winding constrictor") && controller === controllerId) {
      effects.push({
        type: 'add_flat',
        value: 1,
        source: "Winding Constrictor",
        controllerId: controller,
      });
    }
    
    // Corpsejack Menace - doubles +1/+1 counters
    if (cardName.includes("corpsejack menace") && controller === controllerId && counterType === '+1/+1') {
      effects.push({
        type: 'double',
        source: "Corpsejack Menace",
        controllerId: controller,
      });
    }
    
    // The Earth Crystal - doubles +1/+1 counters on creatures you control
    // "If one or more +1/+1 counters would be put on a creature you control, 
    // twice that many +1/+1 counters are put on that creature instead."
    if (cardName.includes("the earth crystal") && controller === controllerId && counterType === '+1/+1') {
      effects.push({
        type: 'double',
        source: "The Earth Crystal",
        controllerId: controller,
      });
    }
    
    // Pir, Imaginative Rascal - +1 to counters on permanents you control
    if (cardName.includes("pir, imaginative rascal") && controller === controllerId) {
      effects.push({
        type: 'add_flat',
        value: 1,
        source: "Pir, Imaginative Rascal",
        controllerId: controller,
      });
    }
  }
  
  return effects;
}

/**
 * Detect life gain modification effects.
 * Used for Boon Reflection, Rhox Faithmender, etc.
 * 
 * @param ctx - Game context  
 * @param playerId - Player gaining life
 * @returns Array of replacement effects
 */
export function detectLifeGainReplacementEffects(
  ctx: GameContext,
  playerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const controller = perm.controller;
    
    // Boon Reflection - double life gained
    if (cardName.includes("boon reflection") && controller === playerId) {
      effects.push({
        type: 'double',
        source: "Boon Reflection",
        controllerId: controller,
      });
    }
    
    // Rhox Faithmender - double life gained  
    if (cardName.includes("rhox faithmender") && controller === playerId) {
      effects.push({
        type: 'double',
        source: "Rhox Faithmender",
        controllerId: controller,
      });
    }
    
    // Trostani, Selesnya's Voice - (actually just has life gain trigger, not replacement)
    
    // Alhammarret's Archive - double life gained
    if (cardName.includes("alhammarret's archive") && controller === playerId) {
      effects.push({
        type: 'double',
        source: "Alhammarret's Archive",
        controllerId: controller,
      });
    }
    
    // The Wind Crystal - double life gained
    // "If you would gain life, you gain twice that much life instead."
    if (cardName.includes("the wind crystal") && controller === playerId) {
      effects.push({
        type: 'double',
        source: "The Wind Crystal",
        controllerId: controller,
      });
    }
    
    // Leyline of Hope - +1 life gained
    if (cardName.includes("leyline of hope") && controller === playerId) {
      effects.push({
        type: 'add_flat',
        value: 1,
        source: "Leyline of Hope",
        controllerId: controller,
      });
    }
    
    // Angel of Vitality - +1 life gained if you have 25+ life
    if (cardName.includes("angel of vitality") && controller === playerId) {
      const startingLife = (ctx.state as any)?.startingLife || 40;
      const currentLife = (ctx.state as any)?.life?.[playerId] ?? startingLife;
      if (currentLife >= 25) {
        effects.push({
          type: 'add_flat',
          value: 1,
          source: "Angel of Vitality",
          controllerId: controller,
        });
      }
    }
  }
  
  return effects;
}

/**
 * Detect token creation modification effects.
 * Used for Doubling Season, Parallel Lives, etc.
 * 
 * @param ctx - Game context
 * @param controllerId - Player creating tokens
 * @returns Array of replacement effects
 */
export function detectTokenCreationReplacementEffects(
  ctx: GameContext,
  controllerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "").toLowerCase();
    const controller = perm.controller;
    
    // Doubling Season - doubles tokens created
    if (cardName.includes("doubling season") && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Doubling Season",
        controllerId: controller,
      });
    }
    
    // Parallel Lives - doubles tokens created
    if (cardName.includes("parallel lives") && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Parallel Lives",
        controllerId: controller,
      });
    }
    
    // Anointed Procession - doubles tokens created
    if (cardName.includes("anointed procession") && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Anointed Procession",
        controllerId: controller,
      });
    }
    
    // Primal Vigor - doubles tokens for ALL players (global effect)
    // Note: This affects whoever is creating tokens, not just the controller
    if (cardName.includes("primal vigor")) {
      effects.push({
        type: 'double',
        source: "Primal Vigor (global)",
        // No controllerId check since this affects all players
      });
    }
    
    // Mondrak, Glory Dominus - doubles tokens created
    if (cardName.includes("mondrak, glory dominus") && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Mondrak, Glory Dominus",
        controllerId: controller,
      });
    }

    // Adrix and Nev, Twincasters - doubles tokens created
    if (cardName.includes('adrix and nev') && controller === controllerId) {
      effects.push({
        type: 'double',
        source: "Adrix and Nev, Twincasters",
        controllerId: controller,
      });
    }
    
    // Ojer Taq, Deepest Foundation - triples tokens created
    if (cardName.includes("ojer taq, deepest foundation") && controller === controllerId) {
      effects.push({
        type: 'triple',
        source: "Ojer Taq, Deepest Foundation",
        controllerId: controller,
      });
    }

    // Generic token doublers (covers many Elspeth templates and similar):
    // "If one or more tokens would be created under your control, twice that many ... are created instead."
    if (
      controller === controllerId &&
      oracleText.includes('tokens would be created under your control') &&
      oracleText.includes('twice that many')
    ) {
      effects.push({
        type: 'double',
        source: perm.card?.name || 'Token doubler',
        controllerId: controller,
      });
    }
  }
  
  return effects;
}

/**
 * Apply counter replacement effects in optimal order (beneficial).
 * Order: +1 effects first, then doublers (maximizes counters).
 */
export function applyCounterReplacements(
  ctx: GameContext,
  baseCount: number,
  controllerId: string,
  counterType: string
): { finalCount: number; appliedEffects: string[] } {
  const effects = detectCounterReplacementEffects(ctx, controllerId, counterType);
  const pref = getReplacementEffectPreference(ctx, controllerId, 'counters');
  const result = pref?.useCustomOrder && Array.isArray(pref.customOrder) && pref.customOrder.length > 0
    ? applyReplacementsCustomOrder(baseCount, sortEffectsByCustomOrder(effects, pref.customOrder))
    : applyBeneficialReplacements(baseCount, effects);
  return { finalCount: result.finalAmount, appliedEffects: result.appliedEffects };
}

/**
 * Apply life gain replacement effects in optimal order (beneficial).
 * Order: +1 effects first, then doublers (maximizes life gained).
 */
export function applyLifeGainReplacements(
  ctx: GameContext,
  baseAmount: number,
  playerId: string
): { finalAmount: number; appliedEffects: string[] } {
  const effects = detectLifeGainReplacementEffects(ctx, playerId);
  const pref = getReplacementEffectPreference(ctx, playerId, 'life_gain');
  if (pref?.useCustomOrder && Array.isArray(pref.customOrder) && pref.customOrder.length > 0) {
    return applyReplacementsCustomOrder(baseAmount, sortEffectsByCustomOrder(effects, pref.customOrder));
  }
  return applyBeneficialReplacements(baseAmount, effects);
}

/**
 * Detect mill replacement effects.
 * Used for The Water Crystal, Bruvac the Grandiloquent, etc.
 * 
 * @param ctx - Game context
 * @param millingPlayerId - Player who controls the mill effect
 * @param targetPlayerId - Player being milled (opponent)
 * @returns Array of replacement effects
 */
export function detectMillReplacementEffects(
  ctx: GameContext,
  millingPlayerId: string,
  targetPlayerId: string
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const controller = perm.controller;
    
    // Bruvac the Grandiloquent - doubles mill for opponents
    // "If an opponent would mill one or more cards, they mill twice that many cards instead."
    if (cardName.includes("bruvac") && controller === millingPlayerId && targetPlayerId !== millingPlayerId) {
      effects.push({
        type: 'double',
        source: "Bruvac the Grandiloquent",
        controllerId: controller,
      });
    }
    
    // The Water Crystal - opponents mill +4 more
    // "If an opponent would mill one or more cards, they mill that many cards plus four instead."
    if (cardName.includes("the water crystal") && controller === millingPlayerId && targetPlayerId !== millingPlayerId) {
      effects.push({
        type: 'add_flat',
        value: 4,
        source: "The Water Crystal",
        controllerId: controller,
      });
    }
  }
  
  return effects;
}

/**
 * Apply mill replacement effects in optimal order (beneficial for the controller).
 * For mill effects that hurt opponents, we want to MAXIMIZE the mill amount.
 * Order: +N effects first, then doublers (maximizes mill).
 */
export function applyMillReplacements(
  ctx: GameContext,
  baseCount: number,
  millingPlayerId: string,
  targetPlayerId: string
): { finalCount: number; appliedEffects: string[] } {
  const effects = detectMillReplacementEffects(ctx, millingPlayerId, targetPlayerId);
  // For mill (hurting opponents), we want to maximize, so use beneficial ordering
  const result = applyBeneficialReplacements(baseCount, effects);
  return { finalCount: result.finalAmount, appliedEffects: result.appliedEffects };
}

/**
 * Apply token creation replacement effects in optimal order (beneficial).
 * Since there are no +1 token effects currently, this just applies doublers.
 */
export function applyTokenCreationReplacements(
  ctx: GameContext,
  baseCount: number,
  controllerId: string
): { finalCount: number; appliedEffects: string[] } {
  const effects = detectTokenCreationReplacementEffects(ctx, controllerId);
  const pref = getReplacementEffectPreference(ctx, controllerId, 'tokens');
  const result = pref?.useCustomOrder && Array.isArray(pref.customOrder) && pref.customOrder.length > 0
    ? applyReplacementsCustomOrder(baseCount, sortEffectsByCustomOrder(effects, pref.customOrder))
    : applyBeneficialReplacements(baseCount, effects);
  return { finalCount: result.finalAmount, appliedEffects: result.appliedEffects };
}



