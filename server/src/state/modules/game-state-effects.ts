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
  let modifiedAmount = damageAmount;
  const modifiers: string[] = [];
  
  const battlefield = getActivePermanents(ctx);
  
  for (const perm of battlefield) {
    const cardName = (perm.card?.name || "").toLowerCase();
    const controller = perm.controller;
    
    // Check for Gisela, Blade of Goldnight
    if (cardName.includes("gisela, blade of goldnight")) {
      // "If a source would deal damage to an opponent of Gisela's controller or to a permanent
      // an opponent controls, that source deals double that damage to that player or permanent instead."
      if (controller === damageDealer && controller !== damageReceiver) {
        modifiedAmount *= 2;
        modifiers.push("Gisela doubles damage to opponents");
      }
      
      // "If a source would deal damage to you or a permanent you control, 
      // prevent half that damage, rounded up."
      if (controller === damageReceiver) {
        modifiedAmount = Math.floor(modifiedAmount / 2);
        modifiers.push("Gisela halves damage to controller");
      }
    }
    
    // Check for Furnace of Rath / Dictate of the Twin Gods
    if (cardName.includes("furnace of rath") || cardName.includes("dictate of the twin gods")) {
      modifiedAmount *= 2;
      modifiers.push(`${perm.card?.name || "Effect"} doubles damage`);
    }
    
    // Check for Fiery Emancipation (triples damage)
    if (cardName.includes("fiery emancipation") && controller === damageDealer) {
      modifiedAmount *= 3;
      modifiers.push("Fiery Emancipation triples damage");
    }
  }
  
  return { amount: modifiedAmount, modifiers };
}

