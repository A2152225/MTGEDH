import type { PlayerID } from "../../../../shared/src/index.js";
import type { GameContext } from "../context.js";
import { uid, parsePT, addEnergyCounters, triggerLifeGainEffects, calculateAllPTBonuses } from "../utils.js";
import { recalculatePlayerEffects, hasMetalcraft, countArtifacts } from "./game-state-effects.js";
import { categorizeSpell, resolveSpell, type EngineEffect, type TargetRef } from "../../rules-engine/targeting.js";
import { getETBTriggersForPermanent, processLinkedExileReturns, registerLinkedExile, detectLinkedExileEffect, type TriggeredAbility, getLandfallTriggers } from "./triggered-abilities.js";
import { addExtraTurn, addExtraCombat } from "./turn.js";
import { drawCards as drawCardsFromZone } from "./zones.js";
import { runSBA, applyCounterModifications } from "./counters_tokens.js";
import { getTokenImageUrls } from "../../services/tokens.js";
import { detectETBTappedPattern, evaluateConditionalLandETB, getLandSubtypes } from "../../socket/land-helpers.js";

/**
 * Detect "enters with counters" patterns from a card's oracle text.
 * Handles patterns like:
 * - "~ enters the battlefield with N +1/+1 counter(s) on it"
 * - "~ enters with N +1/+1 counter(s)"
 * - Saga cards entering with lore counters
 * - Creatures with fabricate, modular, etc.
 * 
 * @param card - The card to analyze
 * @returns Object with counter types and amounts to add on ETB
 */
function detectEntersWithCounters(card: any): Record<string, number> {
  const counters: Record<string, number> = {};
  if (!card) return counters;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  
  // Pattern: "enters the battlefield with N +1/+1 counter(s) on it"
  // Also matches: "~ enters with N +1/+1 counters"
  // Also matches: "This creature enters with N +1/+1 counter(s)"
  // Combined pattern to avoid duplicate matches
  // Note: We already lowercased oracleText, so all text is lowercase
  const counterPattern = /(?:~|this creature)\s+(?:enters|comes into play)(?: the battlefield)? with (\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s*([+\-\d\/]+|\w+)\s*counters?\s*(?:on it)?/gi;
  
  // Track matched positions to avoid duplicates
  const matchedRanges = new Set<string>();
  let match;
  counterPattern.lastIndex = 0;
  while ((match = counterPattern.exec(oracleText)) !== null) {
    const matchKey = `${match.index}-${match[0].length}`;
    if (matchedRanges.has(matchKey)) continue;
    matchedRanges.add(matchKey);
    
    let countStr = match[1].toLowerCase();
    let counterType = match[2].trim();
    
    // Convert word numbers to digits
    const wordToNum: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
      'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
    };
    const count = wordToNum[countStr] !== undefined ? wordToNum[countStr] : parseInt(countStr, 10);
    
    if (!isNaN(count) && count > 0) {
      counters[counterType] = (counters[counterType] || 0) + count;
    }
  }
  
  // Saga cards enter with 1 lore counter (Rule 714.3a)
  // Check for Saga in type line
  if (typeLine.includes('saga')) {
    counters['lore'] = (counters['lore'] || 0) + 1;
  }
  
  // Modular N - enters with N +1/+1 counters (Rule 702.43a)
  const modularMatch = oracleText.match(/modular\s+(\d+)/i);
  if (modularMatch) {
    const n = parseInt(modularMatch[1], 10);
    if (!isNaN(n) && n > 0) {
      counters['+1/+1'] = (counters['+1/+1'] || 0) + n;
    }
  }
  
  // Fabricate N - may be distributed (simplified - puts on self if creature)
  const fabricateMatch = oracleText.match(/fabricate\s+(\d+)/i);
  if (fabricateMatch && typeLine.includes('creature')) {
    const n = parseInt(fabricateMatch[1], 10);
    if (!isNaN(n) && n > 0) {
      // For simplicity, default to +1/+1 counters on self
      // (Real implementation would ask player)
      counters['+1/+1'] = (counters['+1/+1'] || 0) + n;
    }
  }
  
  // Unleash - may enter with +1/+1 counter (simplified - always add)
  if (oracleText.includes('unleash')) {
    counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
  }
  
  // Undying creatures returning (handled by death trigger, not here)
  
  // Ravenous - if X >= 5 (handled separately with X value)
  
  // Devour (handled separately with sacrificed creatures count)
  
  // Tribute N - opponent may put counters (handled interactively)
  
  return counters;
}

/**
 * Handle Dispatch and similar metalcraft-conditional spells.
 * Dispatch: "Tap target creature. Metalcraft — If you control three or more artifacts, exile that creature instead."
 * 
 * @returns true if the spell was handled
 */
function handleDispatch(
  ctx: GameContext, 
  card: any, 
  controller: PlayerID, 
  targets: any[], 
  state: any
): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  
  // Check for Dispatch specifically or similar patterns
  // Pattern: "Tap target creature. Metalcraft — ... exile that creature instead"
  const isDispatchPattern = 
    cardName.includes('dispatch') ||
    (oracleText.includes('tap target creature') && 
     oracleText.includes('metalcraft') && 
     oracleText.includes('exile'));
  
  if (!isDispatchPattern || targets.length === 0) {
    return false;
  }
  
  const battlefield = state.battlefield || [];
  const targetPerm = battlefield.find((p: any) => p?.id === targets[0] || p?.id === targets[0]?.id);
  
  if (!targetPerm) {
    console.log(`[handleDispatch] Target not found on battlefield`);
    return false;
  }
  
  // Check metalcraft using the centralized function
  const metalcraftActive = hasMetalcraft(ctx, controller);
  
  if (metalcraftActive) {
    // Exile the creature instead of tapping
    const permIndex = battlefield.indexOf(targetPerm);
    if (permIndex !== -1) {
      battlefield.splice(permIndex, 1);
      
      // Tokens cease to exist when they leave the battlefield - don't add to exile zone
      if (targetPerm.isToken || targetPerm.card?.isToken) {
        console.log(`[handleDispatch] Metalcraft active - ${targetPerm.card?.name || targetPerm.id} token ceases to exist (not added to exile)`);
      } else {
        // Move non-token to exile zone
        const owner = targetPerm.owner || targetPerm.controller;
        const zones = state.zones || {};
        zones[owner] = zones[owner] || { hand: [], graveyard: [], exile: [] };
        zones[owner].exile = zones[owner].exile || [];
        zones[owner].exile.push({ ...targetPerm.card, zone: 'exile' });
        zones[owner].exileCount = zones[owner].exile.length;
        
        console.log(`[handleDispatch] Metalcraft active (${countArtifacts(ctx, controller)} artifacts) - exiled ${targetPerm.card?.name || targetPerm.id}`);
      }
    }
  } else {
    // Just tap the creature
    targetPerm.tapped = true;
    console.log(`[handleDispatch] Metalcraft inactive (${countArtifacts(ctx, controller)} artifacts) - tapped ${targetPerm.card?.name || targetPerm.id}`);
  }
  
  return true;
}

/**
 * Check if a card's metalcraft ability is active and apply appropriate effects.
 * This handles both spells and permanents with metalcraft.
 * Uses the centralized hasMetalcraft/countArtifacts from game-state-effects.
 * 
 * @param ctx - The game context
 * @param oracleText - The card's oracle text
 * @param controllerId - The controller's ID
 * @returns Object with metalcraft status and any special effects
 */
function evaluateMetalcraft(
  ctx: GameContext,
  oracleText: string, 
  controllerId: string
): { isActive: boolean; artifactCount: number; effects: string[] } {
  const text = oracleText.toLowerCase();
  
  // Check if the card even has metalcraft
  if (!text.includes('metalcraft')) {
    return { isActive: false, artifactCount: 0, effects: [] };
  }
  
  const artifactCount = countArtifacts(ctx, controllerId);
  const isActive = hasMetalcraft(ctx, controllerId);
  const effects: string[] = [];
  
  if (isActive) {
    // Parse metalcraft effects
    // Common patterns:
    // "Metalcraft — [effect]" or "Metalcraft — As long as you control three or more artifacts, [effect]"
    
    // Equipment equip cost reduction (Puresteel Paladin)
    if (text.includes('equip costs') && (text.includes('{0}') || text.includes('cost {0}'))) {
      effects.push('equip_cost_zero');
    }
    
    // Draw on artifact ETB (Puresteel Paladin)
    if (text.includes('whenever an equipment enters') && text.includes('draw a card')) {
      effects.push('draw_on_equipment_etb');
    }
    
    // Indestructible (Darksteel Juggernaut has no metalcraft but similar)
    if (text.includes('indestructible')) {
      effects.push('indestructible');
    }
    
    // +2/+2 bonus (Carapace Forger)
    if (text.match(/gets?\s+\+(\d+)\/\+(\d+)/)) {
      effects.push('power_toughness_bonus');
    }
    
    // Exile instead of other effect (Dispatch)
    if (text.includes('exile') && text.includes('instead')) {
      effects.push('exile_instead');
    }
  }
  
  return { isActive, artifactCount, effects };
}

/**
 * Helper function to check if any opponent controls more lands than the controller.
 * Used for conditional triggers like Knight of the White Orchid, Land Tax, Gift of Estates.
 * 
 * @param state - Game state
 * @param controller - Player ID to check lands for
 * @returns Object with myLandCount and anyOpponentHasMoreLands boolean
 */
function checkOpponentHasMoreLands(state: any, controller: PlayerID): { myLandCount: number; anyOpponentHasMoreLands: boolean } {
  const battlefield = state.battlefield || [];
  const players = state.players || [];
  
  const myLandCount = battlefield.filter((p: any) => 
    p.controller === controller && 
    (p.card?.type_line || '').toLowerCase().includes('land')
  ).length;
  
  const opponentIds = players
    .filter((p: any) => p.id !== controller && !p.hasLost)
    .map((p: any) => p.id);
  
  const anyOpponentHasMoreLands = opponentIds.some((oppId: string) => {
    const oppLandCount = battlefield.filter((p: any) => 
      p.controller === oppId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    ).length;
    return oppLandCount > myLandCount;
  });
  
  return { myLandCount, anyOpponentHasMoreLands };
}

/**
 * Stack / resolution helpers (extracted).
 *
 * Exports:
 * - pushStack
 * - resolveTopOfStack
 * - playLand
 * - castSpell
 * - exileEntireStack
 *
 * exileEntireStack moves all items from the stack into controller exile zones
 * (ctx.state.zones[controller].exile). It returns the number of items exiled and bumps seq.
 * It is conservative and defensive about shapes so it won't throw on unexpected input.
 */

/**
 * Check if a spell is a tutor (search library effect) and return search details.
 * This handles cards like Demonic Tutor, Vampiric Tutor, Diabolic Tutor, etc.
 */
function detectTutorSpell(oracleText: string): { 
  isTutor: boolean; 
  searchCriteria?: string; 
  destination?: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split';
  optional?: boolean;
  maxSelections?: number;
  /** For split-destination effects like Kodama's Reach/Cultivate */
  splitDestination?: boolean;
  /** Number of cards to put on battlefield for split effects */
  toBattlefield?: number;
  /** Number of cards to put in hand for split effects */
  toHand?: number;
  /** Whether cards enter battlefield tapped */
  entersTapped?: boolean;
} {
  if (!oracleText) return { isTutor: false };
  
  const text = oracleText.toLowerCase();
  
  // Must have "search your library" pattern
  if (!text.includes('search your library')) {
    return { isTutor: false };
  }
  
  let searchCriteria = '';
  let destination: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split' = 'hand';
  let optional = false;
  let maxSelections = 1;
  
  // Detect what type of card to search for and how many
  const forMatch = text.match(/search your library for (?:a|an|up to (\w+)) ([^,.]+)/i);
  if (forMatch) {
    // Check for "up to N" pattern
    if (forMatch[1]) {
      const num = forMatch[1].toLowerCase();
      if (num === 'two') maxSelections = 2;
      else if (num === 'three') maxSelections = 3;
      else if (num === 'four') maxSelections = 4;
      else {
        const parsed = parseInt(num, 10);
        if (!isNaN(parsed)) maxSelections = parsed;
      }
    }
    searchCriteria = forMatch[2].trim();
  }
  
  // Check for optional search (contains "may")
  if (text.includes('you may search')) {
    optional = true;
  }
  
  // SPECIAL CASE: Kodama's Reach / Cultivate pattern
  // "put one onto the battlefield tapped and the other into your hand"
  if (text.includes('put one onto the battlefield') && text.includes('the other into your hand')) {
    const entersTapped = text.includes('battlefield tapped');
    return {
      isTutor: true,
      searchCriteria,
      destination: 'split',
      optional,
      maxSelections: 2,
      splitDestination: true,
      toBattlefield: 1,
      toHand: 1,
      entersTapped,
    };
  }
  
  // Detect destination - order matters! More specific patterns first
  
  // Top of library patterns (Vampiric Tutor, Mystical Tutor, Worldly Tutor, Enlightened Tutor)
  if (text.includes('put it on top of your library') || 
      text.includes('put that card on top of your library') ||
      text.includes('put it on top') ||
      text.includes('put that card on top')) {
    destination = 'top';
  }
  // Battlefield patterns (Green Sun's Zenith, Chord of Calling, Natural Order)
  else if (text.includes('put it onto the battlefield') || 
           text.includes('put that card onto the battlefield') ||
           text.includes('put onto the battlefield') ||
           text.includes('enters the battlefield')) {
    destination = 'battlefield';
  }
  // Graveyard patterns (Entomb, Buried Alive)
  else if (text.includes('put it into your graveyard') || 
           text.includes('put that card into your graveyard') ||
           text.includes('put into your graveyard')) {
    destination = 'graveyard';
  }
  // Hand patterns (Demonic Tutor, Diabolic Tutor, Grim Tutor)
  // Default is hand
  
  return { isTutor: true, searchCriteria, destination, optional, maxSelections };
}

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lower = typeLine.toLowerCase();
  
  // Check for creature types after "—" or "-"
  const dashIndex = lower.indexOf("—") !== -1 ? lower.indexOf("—") : lower.indexOf("-");
  if (dashIndex !== -1) {
    const subtypes = lower.slice(dashIndex + 1).trim().split(/\s+/);
    types.push(...subtypes.filter(t => t.length > 0));
  }
  
  return types;
}

/**
 * Check if a creature entering the battlefield would have haste
 * from effects already on the battlefield.
 * 
 * This is used when determining if a creature should have summoning sickness.
 * Rule 702.10: Haste allows a creature to attack and use tap abilities immediately.
 */
function creatureWillHaveHaste(
  card: any,
  controller: string,
  battlefield: any[]
): boolean {
  try {
    const cardTypeLine = (card?.type_line || "").toLowerCase();
    const cardOracleText = (card?.oracle_text || "").toLowerCase();
    
    // 1. Check if the creature itself has haste
    if (cardOracleText.includes('haste')) {
      return true;
    }
    
    // 2. Check battlefield for permanents that grant haste
    for (const perm of battlefield) {
      if (!perm || !perm.card) continue;
      
      const grantorOracle = (perm.card.oracle_text || "").toLowerCase();
      const grantorController = perm.controller;
      
      // Check for "creatures you control have haste" effects
      if (grantorController === controller) {
        if (grantorOracle.includes('creatures you control have haste') ||
            grantorOracle.includes('other creatures you control have haste')) {
          return true;
        }
        
        // Check for "activate abilities... as though... had haste" effects
        // This covers Thousand-Year Elixir: "You may activate abilities of creatures 
        // you control as though those creatures had haste."
        if (grantorOracle.includes('as though') && 
            grantorOracle.includes('had haste') &&
            (grantorOracle.includes('creatures you control') || 
             grantorOracle.includes('activate abilities'))) {
          return true;
        }
        
        // Check for tribal haste grants (e.g., "Goblin creatures you control have haste")
        // Optimization: Use indexOf instead of creating RegExp for each creature type
        const creatureTypes = extractCreatureTypes(cardTypeLine);
        for (const creatureType of creatureTypes) {
          const typeIndex = grantorOracle.indexOf(creatureType);
          const hasteIndex = grantorOracle.indexOf('have haste');
          // Check if creature type appears before "have haste" with no period between them
          if (typeIndex !== -1 && hasteIndex !== -1 && typeIndex < hasteIndex) {
            const textBetween = grantorOracle.slice(typeIndex, hasteIndex);
            if (!textBetween.includes('.')) {
              return true;
            }
          }
        }
      }
      
      // Check for effects that grant haste to all creatures
      if (grantorOracle.includes('all creatures have haste') ||
          grantorOracle.includes('each creature has haste')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn('[creatureWillHaveHaste] Error checking haste:', err);
    return false;
  }
}

/**
 * Check if a creature should enter the battlefield tapped due to effects on the battlefield.
 * This handles cards like:
 * - Authority of the Consuls: "Creatures your opponents control enter the battlefield tapped."
 * - Blind Obedience: "Artifacts and creatures your opponents control enter the battlefield tapped."
 * - Urabrask the Hidden: "Creatures your opponents control enter the battlefield tapped."
 * - Imposing Sovereign: "Creatures your opponents control enter the battlefield tapped."
 * - Thalia, Heretic Cathar: "Creatures and nonbasic lands your opponents control enter the battlefield tapped."
 * - Frozen Aether: "Permanents your opponents control enter the battlefield tapped."
 * - Kismet: "Artifacts, creatures, and lands your opponents play come into play tapped."
 * 
 * @param battlefield - All permanents on the battlefield
 * @param creatureController - The player who controls the entering creature
 * @param creatureCard - The creature card entering
 * @returns true if the creature should enter tapped
 */
function checkCreatureEntersTapped(
  battlefield: any[],
  creatureController: string,
  creatureCard: any
): boolean {
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const permController = perm.controller;
    
    // Skip if this is controlled by the same player (these effects affect opponents)
    if (permController === creatureController) continue;
    
    // Authority of the Consuls: "Creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('authority of the consuls') ||
        (oracleText.includes('creatures your opponents control enter') && oracleText.includes('tapped'))) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Blind Obedience: "Artifacts and creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('blind obedience') ||
        (oracleText.includes('artifacts and creatures your opponents control enter') && oracleText.includes('tapped'))) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Urabrask the Hidden: "Creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('urabrask the hidden') ||
        cardName.includes('urabrask,')) {
      if (oracleText.includes('creatures your opponents control enter') && oracleText.includes('tapped')) {
        console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
        return true;
      }
    }
    
    // Imposing Sovereign: "Creatures your opponents control enter the battlefield tapped."
    if (cardName.includes('imposing sovereign')) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Thalia, Heretic Cathar: "Creatures and nonbasic lands your opponents control enter the battlefield tapped."
    if (cardName.includes('thalia, heretic cathar') ||
        (oracleText.includes('creatures') && oracleText.includes('your opponents control enter') && oracleText.includes('tapped'))) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Frozen Aether: "Permanents your opponents control enter the battlefield tapped."
    if (cardName.includes('frozen aether') ||
        (oracleText.includes('permanents your opponents control enter') && oracleText.includes('tapped'))) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Kismet: "Artifacts, creatures, and lands your opponents play come into play tapped."
    if (cardName.includes('kismet') ||
        (oracleText.includes('creatures') && oracleText.includes('your opponents') && oracleText.includes('play') && oracleText.includes('tapped'))) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'}`);
      return true;
    }
    
    // Generic pattern detection: "creatures your opponents control enter the battlefield tapped"
    // This catches future cards with similar text
    if (oracleText.includes('creatures') && 
        oracleText.includes('opponents') && 
        oracleText.includes('control') &&
        oracleText.includes('enter') && 
        oracleText.includes('battlefield') &&
        oracleText.includes('tapped')) {
      console.log(`[checkCreatureEntersTapped] ${creatureCard.name || 'Creature'} enters tapped due to ${perm.card.name || 'effect'} (generic pattern)`);
      return true;
    }
  }
  
  return false;
}

/* Push an item onto the stack */
export function pushStack(
  ctx: GameContext,
  item: {
    id: string;
    controller: PlayerID;
    card: any;
    targets?: string[];
  }
) {
  const { state } = ctx;
  state.stack = state.stack || [];
  state.stack.push(item as any);
  ctx.bumpSeq();
}

/* Pop and return the top stack item (internal helper) */
function popStackItem(ctx: GameContext) {
  const s = ctx.state;
  if (!s.stack || s.stack.length === 0) return null;
  return s.stack.pop()!;
}

/**
 * Check if a card type line represents a permanent (not instant/sorcery)
 */
/**
 * Check if a card's colors match a color restriction string.
 * Used for color-restricted ETB triggers (e.g., "whenever another white or black creature enters")
 * 
 * @param restriction - The color restriction text (e.g., "white or black", "red", "nonwhite")
 * @param cardColors - The entering card's colors array (e.g., ['W', 'B'] or ['white', 'black'])
 * @returns true if the card matches the color restriction
 */
function matchesColorRestriction(restriction: string, cardColors: string[]): boolean {
  const lowerRestriction = restriction.toLowerCase();
  const colors = cardColors || [];
  
  // Handle "nonX" restrictions first (e.g., "nonwhite", "nonblack")
  if (lowerRestriction.startsWith('non')) {
    const excludedColor = lowerRestriction.slice(3);
    const colorMap: Record<string, string> = { 'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G' };
    const excludedColorCode = colorMap[excludedColor];
    return excludedColorCode ? !colors.includes(excludedColorCode) : true;
  }
  
  // Parse color restriction (e.g., "white or black", "red")
  // Card matches if it has ANY of the mentioned colors
  let matchesColor = false;
  if (lowerRestriction.includes('white') && (colors.includes('W') || colors.includes('white'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('black') && (colors.includes('B') || colors.includes('black'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('blue') && (colors.includes('U') || colors.includes('blue'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('red') && (colors.includes('R') || colors.includes('red'))) {
    matchesColor = true;
  }
  if (lowerRestriction.includes('green') && (colors.includes('G') || colors.includes('green'))) {
    matchesColor = true;
  }
  
  return matchesColor;
}

function isPermanentTypeLine(typeLine?: string): boolean {
  if (!typeLine) return false;
  const tl = typeLine.toLowerCase();
  // Instants and sorceries are not permanents
  if (/\binstant\b/.test(tl) || /\bsorcery\b/.test(tl)) return false;
  // Everything else that can be cast is a permanent (creature, artifact, enchantment, planeswalker, battle)
  return /\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl);
}

/**
 * Check for ETB triggers from other permanents when a token enters the battlefield.
 * This handles effects like Cathars' Crusade, Soul Warden, etc. that trigger
 * when creatures enter the battlefield (including tokens).
 * 
 * @param ctx - Game context
 * @param token - The token permanent that just entered
 * @param controller - Controller of the token
 */
export function triggerETBEffectsForToken(
  ctx: GameContext,
  token: any,
  controller: PlayerID
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;
  
  const isCreature = (token.card?.type_line || '').toLowerCase().includes('creature');
  const isToken = true; // By definition, this is a token
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  for (const perm of state.battlefield) {
    if (!perm || perm.id === token.id) continue;
    
    const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue; // Skip - this trigger only fires for nontoken creatures
        }
        
        // Check if this trigger requires a specific creature type (e.g., Marwyn for Elves)
        // Extract creature type from trigger description like "Whenever another Elf enters"
        // Pattern captures multi-word types like "Artifact Creature" or "Cat Soldier"
        const creatureTypeMatch = trigger.description.match(/whenever another ([^,]+?) enters/i);
        if (creatureTypeMatch) {
          const requiredType = creatureTypeMatch[1].trim().toLowerCase();
          const enteringCreatureTypes = (token.card?.type_line || '').toLowerCase();
          if (!enteringCreatureTypes.includes(requiredType)) {
            // Entering creature doesn't have the required type
            continue;
          }
        }
        
        // Determine trigger controller
        const triggerController = perm.controller || controller;
        
        // Push trigger onto the stack
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        console.log(`[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // another_permanent_etb triggers
      if (trigger.triggerType === 'another_permanent_etb') {
        // Check if this trigger only fires on creatures (creatureOnly flag)
        if ((trigger as any).creatureOnly && !isCreature) {
          continue; // Skip - this trigger only fires on creatures
        }
        
        const triggerController = perm.controller || controller;
        
        // For another_permanent_etb, check if the entering permanent is controlled by the trigger's controller
        // This is the "under your control" restriction
        if (controller !== triggerController) {
          continue; // Skip - entering permanent is not controlled by trigger's controller
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        console.log(`[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style - triggers on ANY permanent)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        console.log(`[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // opponent_creature_etb triggers (Suture Priest, Authority of the Consuls)
      // These trigger when a creature enters under an OPPONENT's control
      if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
        const triggerController = perm.controller;
        // Only fire if the entering creature is controlled by an opponent of the trigger controller
        if (triggerController && triggerController !== controller) {
          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: perm.id,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            // Store the entering creature's controller for effects like "that player loses 1 life"
            targetPlayer: controller,
          } as any);
          
          console.log(`[triggerETBEffectsForToken] ⚡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }
    }
  }
}

/**
 * Trigger ETB effects when a permanent enters the battlefield.
 * This is used for flickered permanents returning, as well as other ETB scenarios.
 * Note: The permanent's own ETB trigger (if any) is handled separately when the 
 * permanent resolves from the stack.
 */
function triggerETBEffectsForPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;
  
  const isCreature = (permanent.card?.type_line || '').toLowerCase().includes('creature');
  const isToken = permanent.isToken === true;
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  for (const perm of state.battlefield) {
    if (!perm || perm.id === permanent.id) continue;
    
    const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue;
        }
        
        // Check if this trigger requires a specific creature type (e.g., Marwyn for Elves)
        // Extract creature type from trigger description like "Whenever another Elf enters"
        // Pattern captures multi-word types like "Artifact Creature" or "Cat Soldier"
        const creatureTypeMatch = trigger.description.match(/whenever another ([^,]+?) enters/i);
        if (creatureTypeMatch) {
          const requiredType = creatureTypeMatch[1].trim().toLowerCase();
          const enteringCreatureTypes = (permanent.card?.type_line || '').toLowerCase();
          if (!enteringCreatureTypes.includes(requiredType)) {
            // Entering creature doesn't have the required type
            continue;
          }
        }
        
        const triggerController = perm.controller || controller;
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        console.log(`[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // another_permanent_etb triggers
      if (trigger.triggerType === 'another_permanent_etb') {
        // Check if this trigger only fires on creatures (creatureOnly flag)
        if ((trigger as any).creatureOnly && !isCreature) {
          continue; // Skip - this trigger only fires on creatures
        }
        
        const triggerController = perm.controller || controller;
        
        // For another_permanent_etb, check if the entering permanent is controlled by the trigger's controller
        // This is the "under your control" restriction
        if (controller !== triggerController) {
          continue; // Skip - entering permanent is not controlled by trigger's controller
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        console.log(`[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
        } as any);
        
        console.log(`[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // opponent_creature_etb triggers (Suture Priest, Authority of the Consuls)
      // These trigger when a creature enters under an OPPONENT's control
      if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
        const triggerController = perm.controller;
        // Only fire if the entering creature is controlled by an opponent of the trigger controller
        if (triggerController && triggerController !== controller) {
          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: perm.id,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            // Store the entering creature's controller for effects like "that player loses 1 life"
            targetPlayer: controller,
          } as any);
          
          console.log(`[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }
    }
  }
  
  // Also check if the permanent itself has ETB triggers
  const selfTriggers = getETBTriggersForPermanent(permanent.card, permanent);
  for (const trigger of selfTriggers) {
    if (trigger.triggerType === 'etb') {
      const triggerController = controller;
      state.stack = state.stack || [];
      const triggerId = uid("trigger");
      
      state.stack.push({
        id: triggerId,
        type: 'triggered_ability',
        controller: triggerController,
        source: permanent.id,
        sourceName: trigger.cardName,
        description: trigger.description,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
      } as any);
      
      console.log(`[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s own ETB trigger: ${trigger.description}`);
    }
  }
}

/**
 * Execute a triggered ability effect based on its description.
 * Handles common trigger effects like life gain/loss, counters, draw, etc.
 */
function executeTriggerEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any
): void {
  const state = (ctx as any).state;
  if (!state) return;
  
  const desc = description.toLowerCase();
  const startingLife = state.startingLife || 40;
  
  // Ensure life dictionary exists
  if (!state.life) {
    state.life = {};
  }
  
  // Get all players for "each opponent" effects
  const players = state.players || [];
  const opponents = players.filter((p: any) => p.id !== controller && !p.hasLost);
  
  // Helper to modify life and sync to player object
  const modifyLife = (playerId: string, delta: number) => {
    const currentLife = state.life[playerId] ?? startingLife;
    state.life[playerId] = currentLife + delta;
    
    // Sync to player object
    const player = players.find((p: any) => p.id === playerId);
    if (player) {
      player.life = state.life[playerId];
    }
    
    const action = delta > 0 ? 'gained' : 'lost';
    const amount = Math.abs(delta);
    console.log(`[executeTriggerEffect] ${playerId} ${action} ${amount} life (${currentLife} -> ${state.life[playerId]})`);
  };
  
  // ===== SPECIAL HANDLERS =====
  // These need to be checked before general pattern matching
  
  // Handle Join Forces triggered abilities (Mana-Charged Dragon)
  // These require all players to contribute mana
  if (triggerItem.triggerType === 'join_forces_attack' || 
      (desc.includes('join forces') && desc.includes('each player may pay'))) {
    // Set up pending join forces - this signals to the socket layer to initiate the contribution phase
    (state as any).pendingJoinForces = (state as any).pendingJoinForces || [];
    (state as any).pendingJoinForces.push({
      id: uid("jf"),
      controller,
      cardName: sourceName || 'Join Forces Ability',
      effectDescription: description,
      imageUrl: triggerItem.value?.imageUrl,
    });
    console.log(`[executeTriggerEffect] Join Forces attack trigger from ${sourceName} - waiting for player contributions`);
    return;
  }
  
  // ===== COMBINED EFFECT HANDLERS =====
  // These handle triggers with multiple effects in one description (like Phyrexian Arena)
  // Process ALL matching effects, not just the first one
  
  let handled = false;
  
  // Pattern: "Draw a card" (standalone or as part of combined effect)
  if (desc.includes('draw a card') || desc.includes('draw 1 card') || desc.match(/draw \d+ cards?/i)) {
    const drawCountMatch = desc.match(/draw (\d+) cards?/i);
    const drawCount = drawCountMatch ? parseInt(drawCountMatch[1], 10) : 1;
    
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + drawCount;
    console.log(`[executeTriggerEffect] ${controller} will draw ${drawCount} card(s) from ${sourceName}`);
    handled = true;
  }
  
  // Pattern: "you lose X life" (combined effect)
  const youLoseLifeMatch = desc.match(/you lose (\d+) life/i);
  if (youLoseLifeMatch) {
    const amount = parseInt(youLoseLifeMatch[1], 10);
    modifyLife(controller, -amount);
    console.log(`[executeTriggerEffect] ${controller} loses ${amount} life from ${sourceName}`);
    handled = true;
  }
  
  // Pattern: "you gain X life" (combined effect)
  const youGainLifeMatch = desc.match(/you gain (\d+) life/i);
  if (youGainLifeMatch) {
    const amount = parseInt(youGainLifeMatch[1], 10);
    modifyLife(controller, amount);
    console.log(`[executeTriggerEffect] ${controller} gains ${amount} life from ${sourceName}`);
    handled = true;
  }
  
  // If we handled any combined effects, we're done
  if (handled) {
    return;
  }
  
  // ===== SINGLE EFFECT HANDLERS =====
  // These are for triggers that have only one effect
  
  // Pattern: "You gain X life"
  const gainLifeMatch = desc.match(/you gain (\d+) life/i);
  if (gainLifeMatch) {
    const amount = parseInt(gainLifeMatch[1], 10);
    modifyLife(controller, amount);
    return;
  }
  
  // Pattern: "You may gain X life" (for optional triggers that were accepted)
  const mayGainLifeMatch = desc.match(/you may gain (\d+) life/i);
  if (mayGainLifeMatch) {
    const amount = parseInt(mayGainLifeMatch[1], 10);
    modifyLife(controller, amount);
    return;
  }
  
  // Pattern: "Each opponent loses X life"
  const opponentsLoseMatch = desc.match(/each opponent loses (\d+) life/i);
  if (opponentsLoseMatch) {
    const amount = parseInt(opponentsLoseMatch[1], 10);
    for (const opp of opponents) {
      modifyLife(opp.id, -amount);
    }
    // Check for "you gain X life" in same trigger (like Zulaport Cutthroat)
    const alsoGainMatch = desc.match(/you gain (\d+) life/i);
    if (alsoGainMatch) {
      const gainAmount = parseInt(alsoGainMatch[1], 10);
      modifyLife(controller, gainAmount);
    }
    return;
  }
  
  // Pattern: "Target player loses X life, you gain X life" (Blood Artist)
  const targetLosesYouGainMatch = desc.match(/target player loses (\d+) life.*you gain (\d+) life/i);
  if (targetLosesYouGainMatch) {
    const loseAmount = parseInt(targetLosesYouGainMatch[1], 10);
    const gainAmount = parseInt(targetLosesYouGainMatch[2], 10);
    
    // If we have a target, use it; otherwise target a random opponent
    const targets = triggerItem.targets || [];
    const targetPlayer = targets[0] || (opponents[0]?.id);
    
    if (targetPlayer) {
      modifyLife(targetPlayer, -loseAmount);
    }
    modifyLife(controller, gainAmount);
    return;
  }
  
  // Pattern: "Creature's controller loses X life" (Blood Seeker)
  const creatureControllerLosesMatch = desc.match(/creature's controller loses (\d+) life/i);
  if (creatureControllerLosesMatch) {
    const amount = parseInt(creatureControllerLosesMatch[1], 10);
    // The triggering creature's controller - stored in triggerItem for ETB triggers
    const triggeringController = (triggerItem as any).triggeringController;
    if (triggeringController && triggeringController !== controller) {
      modifyLife(triggeringController, -amount);
    }
    return;
  }
  
  // Pattern: "you gain X life and get {E}" - Combined life gain + energy (Guide of Souls)
  // This must be checked BEFORE separate life/energy patterns
  const lifeAndEnergyMatch = desc.match(/you gain (\d+) life and get (?:(\d+|one|two|three|four|five) )?(?:\{e\}|energy)/i);
  if (lifeAndEnergyMatch) {
    const lifeAmount = parseInt(lifeAndEnergyMatch[1], 10);
    const wordToNum: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
    let energyAmount = 1;
    if (lifeAndEnergyMatch[2]) {
      energyAmount = wordToNum[lifeAndEnergyMatch[2].toLowerCase()] || parseInt(lifeAndEnergyMatch[2], 10) || 1;
    }
    
    // Apply life gain
    modifyLife(controller, lifeAmount);
    console.log(`[executeTriggerEffect] ${sourceName}: ${controller} gains ${lifeAmount} life`);
    
    // Apply energy gain
    addEnergyCounters(state, controller, energyAmount, sourceName);
    
    handled = true;
    // Don't return - Guide of Souls also has a second ability about paying energy
  }
  
  // Pattern: "you get {E}" or "you get X {E}" - Energy counters (Guide of Souls, etc.)
  // Matches: "you get {E}", "you get two {E}", "you get 2 {E}"
  // Skip if already handled by lifeAndEnergyMatch above
  if (!handled) {
    const energyMatch = desc.match(/you get (?:(\d+|one|two|three|four|five) )?(?:\{e\}|energy)/i);
    if (energyMatch) {
      const wordToNum: Record<string, number> = { 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5 };
      let amount = 1;
      if (energyMatch[1]) {
        amount = wordToNum[energyMatch[1].toLowerCase()] || parseInt(energyMatch[1], 10) || 1;
      }
      
      addEnergyCounters(state, controller, amount, sourceName);
      handled = true;
      // Don't return - there might be more effects after energy gain
    }
  }
  
  // Pattern: "+1/+1 counter on each creature you control" (Cathar's Crusade)
  if (desc.includes('+1/+1 counter') && desc.includes('each creature you control')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Add +1/+1 counter
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      console.log(`[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id}`);
    }
    return;
  }
  
  // Pattern: "+1/+1 counter on each other [creature type] you control" (Thalia's Lieutenant, Champion of the Parish, etc.)
  // Matches: "put a +1/+1 counter on each other Human you control"
  const counterOnEachOtherTypeMatch = desc.match(/\+1\/\+1 counter on each other (\w+) you control/i);
  if (counterOnEachOtherTypeMatch) {
    const creatureType = counterOnEachOtherTypeMatch[1].toLowerCase();
    const battlefield = state.battlefield || [];
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      // Skip the source permanent (it says "each OTHER")
      if (perm.id === sourcePermId) continue;
      
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      // Check if this creature has the required creature type
      if (!typeLine.includes('creature')) continue;
      if (!typeLine.includes(creatureType)) continue;
      
      // Add +1/+1 counter
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      console.log(`[executeTriggerEffect] Added +1/+1 counter to ${perm.card?.name || perm.id} (${creatureType})`);
    }
    return;
  }
  
  // Pattern: "+1/+1 counter on [creature type] you control" without "other" (Thalia's Lieutenant's second ability)
  // Matches: "put a +1/+1 counter on Thalia's Lieutenant" when another Human ETBs
  const counterOnSelfMatch = desc.match(/\+1\/\+1 counter on (?:~|this creature|it)/i);
  if (counterOnSelfMatch) {
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    const battlefield = state.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
    
    if (sourcePerm) {
      sourcePerm.counters = sourcePerm.counters || {};
      sourcePerm.counters['+1/+1'] = (sourcePerm.counters['+1/+1'] || 0) + 1;
      console.log(`[executeTriggerEffect] Added +1/+1 counter to ${sourcePerm.card?.name || sourcePerm.id}`);
    }
    return;
  }
  
  // Pattern: "double the number of +1/+1 counters on [this creature|it|~]" (Mossborn Hydra landfall)
  // Matches: "double the number of +1/+1 counters on this creature", "double the number of +1/+1 counters on Mossborn Hydra"
  if (desc.includes('double') && desc.includes('+1/+1 counter') && 
      (desc.includes('this creature') || desc.includes('on it') || desc.includes('on ~'))) {
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    const battlefield = state.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
    
    if (sourcePerm) {
      sourcePerm.counters = sourcePerm.counters || {};
      const currentCounters = sourcePerm.counters['+1/+1'] || 0;
      const newCounters = currentCounters * 2;
      sourcePerm.counters['+1/+1'] = newCounters;
      console.log(`[executeTriggerEffect] Doubled +1/+1 counters on ${sourcePerm.card?.name || sourcePerm.id}: ${currentCounters} -> ${newCounters}`);
    }
    return;
  }
  
  // Pattern: "put X +1/+1 counters on each creature you control" where X is based on source's power
  // Matches: "put X +1/+1 counters on each creature you control, where X is ~'s power"
  // Also matches: "put a number of +1/+1 counters equal to its power on each creature you control"
  if ((desc.includes('+1/+1 counter') && desc.includes('each creature you control')) && 
      (desc.includes('power') || desc.includes('equal to'))) {
    const sourcePermId = triggerItem?.source || triggerItem?.permanentId;
    const battlefield = state.battlefield || [];
    const sourcePerm = battlefield.find((p: any) => p.id === sourcePermId);
    
    if (sourcePerm) {
      // Calculate source's power including counters and modifiers
      // Use effectivePower if pre-calculated (most efficient)
      let sourcePower: number;
      if (typeof sourcePerm.effectivePower === 'number') {
        sourcePower = sourcePerm.effectivePower;
      } else {
        // Fall back to manual calculation using comprehensive P/T bonus calculation
        // This includes equipment, auras, anthems, lords, and special abilities like Omnath's mana pool bonus
        let basePower = sourcePerm.basePower || 0;
        if (!basePower && sourcePerm.card?.power) {
          basePower = parsePT(sourcePerm.card.power) ?? 0;
        }
        
        // Add +1/+1 counters
        const plusCounters = sourcePerm.counters?.['+1/+1'] || 0;
        const minusCounters = sourcePerm.counters?.['-1/-1'] || 0;
        const counterDelta = plusCounters - minusCounters;
        
        // Calculate ALL other bonuses (equipment, auras, anthems, lords, Omnath's mana pool, etc.)
        const allBonuses = calculateAllPTBonuses(sourcePerm, state);
        
        sourcePower = Math.max(0, basePower + counterDelta + allBonuses.power);
      }
      
      console.log(`[executeTriggerEffect] ${sourcePerm.card?.name || 'Unknown'} has power ${sourcePower}, adding counters to all creatures`);
      
      // Add counters to each creature controller controls
      for (const perm of battlefield) {
        if (!perm) continue;
        if (perm.controller !== controller) continue;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        
        // Add X +1/+1 counters
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + sourcePower;
        console.log(`[executeTriggerEffect] Added ${sourcePower} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "Draw a card" or "Draw X cards"
  const drawMatch = desc.match(/draw (?:a card|(\d+) cards?)/i);
  if (drawMatch && !desc.includes('each player may put a land')) {
    // Skip if this is a Kynaios-style effect (handled below)
    const count = drawMatch[1] ? parseInt(drawMatch[1], 10) : 1;
    // Set up pending draw - actual draw happens through zone management
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + count;
    console.log(`[executeTriggerEffect] ${controller} will draw ${count} card(s)`);
    return;
  }
  
  // Pattern: Kynaios and Tiro of Meletis style - "draw a card. Each player may put a land...then each opponent who didn't draws a card"
  // This is a complex multi-step effect that requires player choices
  if (desc.includes('each player may put a land') && desc.includes('opponent') && desc.includes('draws a card')) {
    // First, controller draws a card
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[controller] = (state.pendingDraws[controller] || 0) + 1;
    
    // Set up pending land play choice for all players, and pending conditional draw for opponents
    state.pendingKynaiosChoice = state.pendingKynaiosChoice || {};
    state.pendingKynaiosChoice[controller] = {
      sourceName,
      sourceController: controller,
      playersWhoMayPlayLand: players.map((p: any) => p.id),
      playersWhoPlayedLand: [],
      active: true,
    };
    
    console.log(`[executeTriggerEffect] ${sourceName}: ${controller} draws 1, all players may put a land, opponents who don't will draw`);
    return;
  }
  
  // Pattern: "Target player draws X cards" or "that player draws X cards"
  const targetDrawMatch = desc.match(/(?:target|that) player draws? (\d+|a|an|one|two|three) cards?/i);
  if (targetDrawMatch) {
    const wordToNum: Record<string, number> = { 'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3 };
    const count = wordToNum[targetDrawMatch[1].toLowerCase()] || parseInt(targetDrawMatch[1], 10) || 1;
    
    // Use target if available, otherwise controller
    const targets = triggerItem?.targets || [];
    const targetPlayer = targets[0]?.id || targets[0] || controller;
    
    state.pendingDraws = state.pendingDraws || {};
    state.pendingDraws[targetPlayer] = (state.pendingDraws[targetPlayer] || 0) + count;
    console.log(`[executeTriggerEffect] ${targetPlayer} will draw ${count} card(s)`);
    return;
  }
  
  // Pattern: "each opponent draws a card" 
  const eachOpponentDrawsMatch = desc.match(/each opponent draws? (\d+|a|an|one|two) cards?/i);
  if (eachOpponentDrawsMatch) {
    const wordToNum: Record<string, number> = { 'a': 1, 'an': 1, 'one': 1, 'two': 2 };
    const count = wordToNum[eachOpponentDrawsMatch[1].toLowerCase()] || parseInt(eachOpponentDrawsMatch[1], 10) || 1;
    
    state.pendingDraws = state.pendingDraws || {};
    for (const opp of opponents) {
      state.pendingDraws[opp.id] = (state.pendingDraws[opp.id] || 0) + count;
    }
    console.log(`[executeTriggerEffect] Each opponent will draw ${count} card(s)`);
    return;
  }
  
  // ============================================================================
  // DYNAMIC PATTERN RECOGNITION: Search library effects
  // This regex-based approach handles ALL cards with "search your library" patterns,
  // not just hardcoded card names. Works for any of the 27,000+ MTG cards.
  // ============================================================================
  const searchLibraryMatch = desc.match(/(?:you may )?search your library for (?:a|an|up to (?:one|two|three|\d+)) ([^,\.]+)/i);
  if (searchLibraryMatch) {
    const searchFor = searchLibraryMatch[1].trim();
    const isOptional = desc.includes('you may search');
    
    // Determine destination dynamically from text
    let destination = 'hand';
    let entersTapped = false;
    if (desc.includes('put it onto the battlefield') || desc.includes('put that card onto the battlefield') ||
        desc.includes('put it on the battlefield') || desc.includes('battlefield under your control')) {
      destination = 'battlefield';
      // Check if it enters tapped
      if (desc.includes('tapped')) {
        entersTapped = true;
      }
    } else if (desc.includes('put it on top of your library') || desc.includes('put that card on top')) {
      destination = 'top';
    }
    
    // Build filter dynamically based on what we're searching for
    const filter: { 
      types?: string[]; 
      subtypes?: string[]; 
      name?: string; 
      maxPower?: number; 
      maxToughness?: number; 
      maxCmc?: number; 
      minCmc?: number;
    } = {};
    const subtypes: string[] = [];
    
    // Dynamic basic land type detection
    const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
    for (const landType of basicLandTypes) {
      if (searchFor.toLowerCase().includes(landType)) {
        subtypes.push(landType.charAt(0).toUpperCase() + landType.slice(1));
      }
    }
    
    // Dynamic card type detection
    const cardTypes = ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'];
    const types: string[] = [];
    for (const cardType of cardTypes) {
      if (searchFor.toLowerCase().includes(cardType)) {
        types.push(cardType);
      }
    }
    
    // Dynamic power/toughness restriction detection
    // Matches: "power 2 or less", "power 3 or greater", "toughness 2 or less", etc.
    const powerMatch = searchFor.match(/power\s*(\d+)\s*or\s*(less|greater)/i);
    if (powerMatch) {
      const value = parseInt(powerMatch[1], 10);
      const direction = powerMatch[2].toLowerCase();
      if (direction === 'less') {
        filter.maxPower = value;
      }
      // For "or greater" we'd need minPower, but maxPower covers the common case
    }
    
    const toughnessMatch = searchFor.match(/toughness\s*(\d+)\s*or\s*(less|greater)/i);
    if (toughnessMatch) {
      const value = parseInt(toughnessMatch[1], 10);
      const direction = toughnessMatch[2].toLowerCase();
      if (direction === 'less') {
        filter.maxToughness = value;
      }
    }
    
    // Dynamic CMC restriction detection
    // Matches: "mana value 3 or less", "converted mana cost 2 or less"
    const cmcLessMatch = searchFor.match(/(?:mana value|converted mana cost|cmc)\s*(\d+)\s*or\s*(?:less|fewer)/i);
    if (cmcLessMatch) {
      filter.maxCmc = parseInt(cmcLessMatch[1], 10);
    }
    
    // Matches: "mana value 6 or greater", "converted mana cost 6 or more" (Fierce Empath, etc.)
    const cmcGreaterMatch = searchFor.match(/(?:mana value|converted mana cost|cmc)\s*(\d+)\s*or\s*(?:greater|more)/i);
    if (cmcGreaterMatch) {
      filter.minCmc = parseInt(cmcGreaterMatch[1], 10);
    }
    
    if (types.length > 0) filter.types = types;
    if (subtypes.length > 0) filter.subtypes = subtypes;
    
    // Check for conditional triggers: "if an opponent controls more lands than you"
    // (Knight of the White Orchid, etc.)
    const hasLandCondition = desc.match(/if (?:an|any) opponent controls more lands than you/i);
    if (hasLandCondition) {
      const { myLandCount, anyOpponentHasMoreLands } = checkOpponentHasMoreLands(state, controller);
      
      if (!anyOpponentHasMoreLands) {
        console.log(`[executeTriggerEffect] ${sourceName}: Condition NOT met - ${controller} has ${myLandCount} lands, no opponent has more`);
        return; // Don't set up library search if condition not met
      }
      
      console.log(`[executeTriggerEffect] ${sourceName}: Condition met - opponent has more lands than ${controller} (${myLandCount} lands)`);
    }
    
    // Set up pending library search
    state.pendingLibrarySearch = state.pendingLibrarySearch || {};
    state.pendingLibrarySearch[controller] = {
      type: 'etb-trigger',
      searchFor: searchFor,
      destination,
      tapped: entersTapped,
      optional: isOptional,
      source: sourceName,
      shuffleAfter: desc.includes('shuffle'),
      filter,
    };
    
    console.log(`[executeTriggerEffect] ${sourceName} trigger: ${controller} may search for ${searchFor} (destination: ${destination}, filter: ${JSON.stringify(filter)})`);
    return;
  }
  
  // Pattern: "Create a Food/Treasure/Clue/Map token" (predefined artifact tokens)
  // Food: "{2}, {T}, Sacrifice this artifact: You gain 3 life."
  // Treasure: "{T}, Sacrifice this artifact: Add one mana of any color."
  // Clue: "{2}, Sacrifice this artifact: Draw a card."
  // Map: "{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery."
  // Blood: "{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card."
  const predefinedTokenTypes: Record<string, { typeLine: string; oracleText: string }> = {
    'food': {
      typeLine: 'Token Artifact — Food',
      oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    },
    'treasure': {
      typeLine: 'Token Artifact — Treasure',
      oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
    },
    'clue': {
      typeLine: 'Token Artifact — Clue',
      oracleText: '{2}, Sacrifice this artifact: Draw a card.',
    },
    'map': {
      typeLine: 'Token Artifact — Map',
      oracleText: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.',
    },
    'blood': {
      typeLine: 'Token Artifact — Blood',
      oracleText: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    },
    'gold': {
      typeLine: 'Token Artifact — Gold',
      oracleText: 'Sacrifice this artifact: Add one mana of any color.',
    },
    'powerstone': {
      typeLine: 'Token Artifact — Powerstone',
      oracleText: '{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.',
    },
  };
  
  // Match patterns like "create a Food token", "create two Treasure tokens", "create 3 Clue tokens"
  const predefinedTokenMatch = desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (food|treasure|clue|map|blood|gold|powerstone) tokens?/i);
  if (predefinedTokenMatch) {
    const countWord = desc.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
    const wordToCount: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    const tokenCount = wordToCount[countWord] || (predefinedTokenMatch[1] ? parseInt(predefinedTokenMatch[1], 10) : 1);
    const tokenType = predefinedTokenMatch[2].toLowerCase();
    const tokenInfo = predefinedTokenTypes[tokenType];
    
    if (tokenInfo) {
      state.battlefield = state.battlefield || [];
      for (let i = 0; i < tokenCount; i++) {
        const tokenId = uid("token");
        const tokenName = tokenType.charAt(0).toUpperCase() + tokenType.slice(1);
        
        state.battlefield.push({
          id: tokenId,
          controller,
          owner: controller,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: tokenId,
            name: tokenName,
            type_line: tokenInfo.typeLine,
            oracle_text: tokenInfo.oracleText,
            zone: 'battlefield',
            colors: [],
          },
        } as any);
        
        console.log(`[executeTriggerEffect] Created ${tokenName} token for ${controller}`);
      }
      return;
    }
  }
  
  // Pattern: "Create a X/Y [creature type] creature token" (various patterns)
  // Matches: "create a 2/2 green Wolf creature token", "create a 1/1 white Soldier creature token with vigilance"
  // Also matches: "create a 0/1 colorless Eldrazi Spawn creature token"
  // Also matches: "create two 1/1 white Cat creature tokens that are tapped and attacking"
  const createTokenMatch = desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
  if (createTokenMatch) {
    // Parse count from word or number
    const countWord = desc.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
    const wordToCount: Record<string, number> = {
      'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
    };
    const tokenCount = wordToCount[countWord] || (createTokenMatch[1] ? parseInt(createTokenMatch[1], 10) : 1);
    const power = parseInt(createTokenMatch[2], 10);
    const toughness = parseInt(createTokenMatch[3], 10);
    const tokenDescription = createTokenMatch[4].trim();
    
    // Check for "tapped and attacking" pattern
    const isTappedAndAttacking = desc.includes('tapped and attacking');
    
    // Extract color and creature type from description
    // e.g., "white Soldier" -> color: white, type: Soldier
    const parts = tokenDescription.split(/\s+/);
    const colors: string[] = [];
    const creatureTypes: string[] = [];
    
    const colorMap: Record<string, string> = {
      'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G', 'colorless': ''
    };
    
    for (const part of parts) {
      const lowerPart = part.toLowerCase();
      if (colorMap[lowerPart] !== undefined) {
        if (colorMap[lowerPart]) colors.push(colorMap[lowerPart]);
      } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'and' && lowerPart !== 'with' && 
                 lowerPart !== 'that' && lowerPart !== 'are' && lowerPart !== 'tapped' && lowerPart !== 'attacking') {
        creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
      }
    }
    
    // Check for abilities in the description
    const abilities: string[] = [];
    if (desc.includes('vigilance')) abilities.push('Vigilance');
    if (desc.includes('haste')) abilities.push('Haste');
    if (desc.includes('lifelink')) abilities.push('Lifelink');
    if (desc.includes('deathtouch')) abilities.push('Deathtouch');
    if (desc.includes('flying')) abilities.push('Flying');
    if (desc.includes('first strike')) abilities.push('First strike');
    if (desc.includes('trample')) abilities.push('Trample');
    if (desc.includes('menace')) abilities.push('Menace');
    if (desc.includes('reach')) abilities.push('Reach');
    
    // Create the tokens
    state.battlefield = state.battlefield || [];
    for (let i = 0; i < tokenCount; i++) {
      const tokenId = uid("token");
      const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
      const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;
      
      // Get token image from Scryfall data
      const tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
      
      const token = {
        id: tokenId,
        controller,
        owner: controller,
        // Tokens that enter "tapped and attacking" are tapped, have no summoning sickness issue for attacking
        tapped: isTappedAndAttacking,
        counters: {},
        basePower: power,
        baseToughness: toughness,
        // Tokens that enter attacking don't have summoning sickness for the purpose of attacking
        summoningSickness: !abilities.includes('Haste') && !isTappedAndAttacking,
        isToken: true,
        // Mark as attacking if it enters attacking
        isAttacking: isTappedAndAttacking,
        card: {
          id: tokenId,
          name: tokenName,
          type_line: typeLine,
          power: String(power),
          toughness: String(toughness),
          colors,
          oracle_text: abilities.join(', '),
          keywords: abilities,
          zone: 'battlefield',
          image_uris: tokenImageUrls,
        },
      } as any;
      
      state.battlefield.push(token);
      console.log(`[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${controller}${isTappedAndAttacking ? ' (tapped and attacking)' : ''}`);
      
      // Trigger ETB effects from other permanents (Cathars' Crusade, Soul Warden, etc.)
      triggerETBEffectsForToken(ctx, token, controller);
    }
    return;
  }
  
  // Pattern: "create a token copy of equipped creature" or "create a token that's a copy of equipped creature"
  // Helm of the Host: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except it's not legendary"
  if (desc.includes('token') && desc.includes('copy') && 
      (desc.includes('equipped creature') || desc.includes('equipped permanent'))) {
    const sourceId = triggerItem.source || triggerItem.permanentId;
    const sourcePerm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
    
    if (sourcePerm) {
      // Find what this equipment is attached to
      const attachedTo = sourcePerm.attachedTo;
      if (attachedTo) {
        const equippedCreature = (state.battlefield || []).find((p: any) => p?.id === attachedTo);
        
        if (equippedCreature && equippedCreature.card) {
          // Create a token copy
          const tokenId = uid("token");
          const originalCard = equippedCreature.card;
          const originalTypeLine = (originalCard.type_line || '').toLowerCase();
          
          // Remove "Legendary" from the type line (handle all positions)
          let tokenTypeLine = originalCard.type_line || 'Token';
          tokenTypeLine = tokenTypeLine.replace(/\bLegendary\s+/i, '').replace(/\s+Legendary\b/i, '').trim();
          
          // If the copy would have haste, ensure it doesn't have summoning sickness
          const hasHaste = (originalCard.oracle_text || '').toLowerCase().includes('haste') ||
                          (Array.isArray(originalCard.keywords) && 
                           originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste')) ||
                          desc.includes('haste');
          
          const isCreature = originalTypeLine.includes('creature');
          
          const tokenCopy = {
            id: tokenId,
            controller,
            owner: controller,
            tapped: false,
            counters: { ...equippedCreature.counters },
            basePower: equippedCreature.basePower,
            baseToughness: equippedCreature.baseToughness,
            // Tokens that are copies with haste don't have summoning sickness
            summoningSickness: isCreature && !hasHaste,
            isToken: true,
            card: {
              ...originalCard,
              id: tokenId,
              type_line: tokenTypeLine,
              zone: 'battlefield',
              // Add haste if specified by the effect (Helm of the Host adds haste)
              oracle_text: hasHaste && !(originalCard.oracle_text || '').toLowerCase().includes('haste')
                ? (originalCard.oracle_text || '') + (originalCard.oracle_text ? '\n' : '') + 'Haste'
                : originalCard.oracle_text,
              keywords: hasHaste && Array.isArray(originalCard.keywords) && !originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste')
                ? [...originalCard.keywords, 'Haste']
                : originalCard.keywords,
            },
          } as any;
          
          state.battlefield = state.battlefield || [];
          state.battlefield.push(tokenCopy);
          
          console.log(`[executeTriggerEffect] Created token copy of ${originalCard.name || 'creature'} (not legendary${hasHaste ? ', with haste' : ''})`);
          
          // Trigger ETB effects for the copy token (Cathars' Crusade, Soul Warden, etc.)
          triggerETBEffectsForToken(ctx, tokenCopy, controller);
        } else {
          console.log(`[executeTriggerEffect] No equipped creature found for copy token creation`);
        }
      } else {
        console.log(`[executeTriggerEffect] Equipment ${sourcePerm.card?.name || 'equipment'} is not attached to anything`);
      }
    }
    return;
  }
  
  // Pattern: "each opponent mills X cards" or "each opponent mills a card" (Altar of the Brood)
  const millOpponentsMatch = desc.match(/each opponent mills? (?:a card|(\d+) cards?)/i);
  if (millOpponentsMatch) {
    const millCount = millOpponentsMatch[1] ? parseInt(millOpponentsMatch[1], 10) : 1;
    console.log(`[executeTriggerEffect] Each opponent mills ${millCount} card(s)`);
    
    // Set up pending mill for each opponent
    state.pendingMill = state.pendingMill || {};
    for (const opp of opponents) {
      state.pendingMill[opp.id] = (state.pendingMill[opp.id] || 0) + millCount;
      
      // Actually mill the cards by moving from library to graveyard
      const oppZones = (ctx as any).zones?.[opp.id] || state.zones?.[opp.id];
      if (oppZones?.library && Array.isArray(oppZones.library)) {
        for (let i = 0; i < millCount && oppZones.library.length > 0; i++) {
          const milledCard = oppZones.library.shift();
          if (milledCard) {
            oppZones.graveyard = oppZones.graveyard || [];
            milledCard.zone = 'graveyard';
            oppZones.graveyard.push(milledCard);
            console.log(`[executeTriggerEffect] Milled ${milledCard.name || 'card'} from ${opp.id}'s library`);
          }
        }
        // Update library count and graveyard count
        oppZones.libraryCount = oppZones.library.length;
        oppZones.graveyardCount = (oppZones.graveyard || []).length;
      }
    }
    return;
  }
  
  // Pattern: "scry X" or "scry 1"
  const scryMatch = desc.match(/scry (\d+)/i);
  if (scryMatch) {
    const scryCount = parseInt(scryMatch[1], 10);
    console.log(`[executeTriggerEffect] ${controller} scries ${scryCount}`);
    
    // Set up pending scry for the controller
    state.pendingScry = state.pendingScry || {};
    state.pendingScry[controller] = scryCount;
    return;
  }
  
  // Pattern: "each player draws X cards" or "each player draws a card"
  const eachDrawMatch = desc.match(/each player draws? (?:a card|(\d+) cards?)/i);
  if (eachDrawMatch) {
    const count = eachDrawMatch[1] ? parseInt(eachDrawMatch[1], 10) : 1;
    state.pendingDraws = state.pendingDraws || {};
    for (const player of players) {
      if (!player.hasLost) {
        state.pendingDraws[player.id] = (state.pendingDraws[player.id] || 0) + count;
        console.log(`[executeTriggerEffect] ${player.id} will draw ${count} card(s)`);
      }
    }
    return;
  }
  
  // Pattern: "each opponent discards a card" or "each opponent discards X cards"
  const discardOpponentsMatch = desc.match(/each opponent discards? (?:a card|(\d+) cards?)/i);
  if (discardOpponentsMatch) {
    const discardCount = discardOpponentsMatch[1] ? parseInt(discardOpponentsMatch[1], 10) : 1;
    console.log(`[executeTriggerEffect] Each opponent discards ${discardCount} card(s)`);
    
    state.pendingDiscard = state.pendingDiscard || {};
    for (const opp of opponents) {
      state.pendingDiscard[opp.id] = (state.pendingDiscard[opp.id] || 0) + discardCount;
    }
    return;
  }
  
  // Pattern: "put a +1/+1 counter on ~" or "put a +1/+1 counter on it"
  const putCounterOnSelfMatch = desc.match(/put (?:a|an|(\d+)) \+1\/\+1 counters? on (?:~|it|this creature)/i);
  if (putCounterOnSelfMatch) {
    const counterCount = putCounterOnSelfMatch[1] ? parseInt(putCounterOnSelfMatch[1], 10) : 1;
    const sourceId = triggerItem.source || triggerItem.permanentId;
    
    if (sourceId) {
      const perm = (state.battlefield || []).find((p: any) => p?.id === sourceId);
      if (perm) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + counterCount;
        console.log(`[executeTriggerEffect] Added ${counterCount} +1/+1 counter(s) to ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "target player loses X life" (without the you gain part)
  const targetLosesMatch = desc.match(/target (?:player|opponent) loses (\d+) life/i);
  if (targetLosesMatch && !desc.includes('you gain')) {
    const loseAmount = parseInt(targetLosesMatch[1], 10);
    const targets = triggerItem.targets || [];
    const targetPlayer = targets[0] || (opponents[0]?.id);
    
    if (targetPlayer) {
      modifyLife(targetPlayer, -loseAmount);
    }
    return;
  }
  
  // Pattern: "you lose X life" (Phyrexian Arena style) - LEGACY handler for single effects
  // NOTE: Combined effects are now handled earlier in the function
  const singleYouLoseLifeMatch = desc.match(/you lose (\d+) life/i);
  if (singleYouLoseLifeMatch && !desc.includes('draw')) {
    const amount = parseInt(singleYouLoseLifeMatch[1], 10);
    modifyLife(controller, -amount);
    return;
  }
  
  // Pattern: "deals X damage to target" or "deals X damage to any target"
  const dealsTargetDamageMatch = desc.match(/deals? (\d+) damage to (?:target|any target|that creature|it)/i);
  if (dealsTargetDamageMatch) {
    const damage = parseInt(dealsTargetDamageMatch[1], 10);
    const targets = triggerItem.targets || [];
    
    if (targets.length > 0) {
      const targetId = targets[0];
      // Check if target is a player
      const targetPlayer = players.find((p: any) => p.id === targetId);
      if (targetPlayer) {
        modifyLife(targetId, -damage);
      } else {
        // Target is a permanent - deal damage
        const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targetId);
        if (targetPerm) {
          targetPerm.damageMarked = (targetPerm.damageMarked || 0) + damage;
          console.log(`[executeTriggerEffect] Dealt ${damage} damage to ${targetPerm.card?.name || targetId}`);
        }
      }
    }
    return;
  }
  
  // Pattern: "untap all creatures you control" or "untap target creature"
  if (desc.includes('untap all creatures you control')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      if (perm.tapped) {
        perm.tapped = false;
        console.log(`[executeTriggerEffect] Untapped ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "tap target creature" or "tap all creatures"
  if (desc.includes('tap target creature')) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        targetPerm.tapped = true;
        console.log(`[executeTriggerEffect] Tapped ${targetPerm.card?.name || targetPerm.id}`);
      }
    }
    return;
  }
  
  // Pattern: "exile target creature/permanent ... until ~ leaves the battlefield" (Oblivion Ring-style)
  // This is a LINKED exile - the exiled card returns when the source permanent leaves
  const linkedExileMatch = desc.match(/exile (?:target |that )?([^.]+) until [^.]* leaves the battlefield/i);
  if (linkedExileMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const exiledPermanentId = targetPerm.id;
          const exiledCard = targetPerm.card;
          const exiledCardName = exiledCard?.name || targetPerm.id;
          const originalOwner = targetPerm.owner;
          const originalController = targetPerm.controller;
          
          // Remove from battlefield
          state.battlefield.splice(permIndex, 1);
          
          // Tokens cease to exist when they leave the battlefield
          if (targetPerm.isToken || exiledCard?.isToken) {
            console.log(`[executeTriggerEffect] ${exiledCardName} token ceases to exist (not added to exile, no return)`);
          } else {
            // Add to exile zone
            const ownerZones = state.zones?.[originalOwner];
            if (ownerZones) {
              ownerZones.exile = ownerZones.exile || [];
              exiledCard.zone = 'exile';
              ownerZones.exile.push(exiledCard);
              ownerZones.exileCount = (ownerZones.exile || []).length;
            }
            
            // Register the linked exile so the card returns when source leaves
            const sourceId = triggerItem.sourceId || triggerItem.permanentId;
            registerLinkedExile(
              ctx,
              sourceId,
              sourceName,
              exiledCard,
              originalOwner,
              originalController
            );
            
            console.log(`[executeTriggerEffect] ${sourceName} exiled ${exiledCardName} - will return when ${sourceName} leaves the battlefield`);
          }
          
          // Process linked exile returns for the removed permanent
          processLinkedExileReturns(ctx, exiledPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "exile target creature" or "exile it" (simple exile, no return)
  const exileMatch = desc.match(/exile (?:target (?:creature|permanent)|it|that creature)/i);
  if (exileMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        // Check if the source card has a linked exile effect
        const sourceCard = triggerItem.card;
        const linkedEffect = sourceCard ? detectLinkedExileEffect(sourceCard) : null;
        
        // Move to exile (tokens cease to exist)
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const exiledPermanentId = targetPerm.id;
          state.battlefield.splice(permIndex, 1);
          
          // Tokens cease to exist when they leave the battlefield
          if (targetPerm.isToken || targetPerm.card?.isToken) {
            console.log(`[executeTriggerEffect] ${targetPerm.card?.name || targetPerm.id} token ceases to exist (not added to exile)`);
          } else {
            // Add to exile zone
            const ownerZones = state.zones?.[targetPerm.owner];
            if (ownerZones) {
              ownerZones.exile = ownerZones.exile || [];
              targetPerm.card.zone = 'exile';
              ownerZones.exile.push(targetPerm.card);
              ownerZones.exileCount = (ownerZones.exile || []).length;
            }
            
            // If this is a linked exile effect, register the link
            if (linkedEffect?.hasLinkedExile) {
              const sourceId = triggerItem.sourceId || triggerItem.permanentId;
              registerLinkedExile(
                ctx,
                sourceId,
                sourceName,
                targetPerm.card,
                targetPerm.owner,
                targetPerm.controller
              );
              console.log(`[executeTriggerEffect] ${sourceName} exiled ${targetPerm.card?.name || targetPerm.id} (linked - returns when ${sourceName} leaves)`);
            } else {
              console.log(`[executeTriggerEffect] Exiled ${targetPerm.card?.name || targetPerm.id}`);
            }
          }
          
          // Process linked exile returns for the removed permanent (in case it was an Oblivion Ring)
          processLinkedExileReturns(ctx, exiledPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "destroy target creature" or "destroy it"  
  const destroyMatch = desc.match(/destroy (?:target (?:creature|permanent|artifact|enchantment)|it|that creature)/i);
  if (destroyMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const owner = targetPerm.owner;
        const card = targetPerm.card;
        
        // Check if this is a commander (Rule 903.9a)
        const commandZone = (ctx as any).commandZone || {};
        const commanderInfo = commandZone[owner];
        const commanderIds = commanderInfo?.commanderIds || [];
        const isCommander = (card?.id && commanderIds.includes(card.id)) || targetPerm.isCommander === true;
        
        // Move to graveyard
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const destroyedPermanentId = targetPerm.id;
          state.battlefield.splice(permIndex, 1);
          
          if (isCommander && card) {
            // Commander Replacement Effect (Rule 903.9a):
            // If a commander would be put into graveyard from anywhere,
            // its owner may put it into the command zone instead.
            state.pendingCommanderZoneChoice = state.pendingCommanderZoneChoice || {};
            state.pendingCommanderZoneChoice[owner] = state.pendingCommanderZoneChoice[owner] || [];
            state.pendingCommanderZoneChoice[owner].push({
              commanderId: card.id,
              commanderName: card.name,
              destinationZone: 'graveyard',
              card: {
                id: card.id,
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
              },
            });
            console.log(`[executeTriggerEffect] Commander ${card.name} destroyed - DEFERRING zone change for player choice`);
          } else {
            // Non-commander - move directly to graveyard
            const ownerZones = state.zones?.[targetPerm.owner];
            if (ownerZones) {
              ownerZones.graveyard = ownerZones.graveyard || [];
              targetPerm.card.zone = 'graveyard';
              ownerZones.graveyard.push(targetPerm.card);
              ownerZones.graveyardCount = (ownerZones.graveyard || []).length;
            }
            console.log(`[executeTriggerEffect] Destroyed ${targetPerm.card?.name || targetPerm.id}`);
          }
          
          // Process linked exile returns for the removed permanent
          processLinkedExileReturns(ctx, destroyedPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "return target creature to its owner's hand" (bounce)
  const bounceMatch = desc.match(/return (?:target|a) (?:creature|permanent) (?:card )?(?:from [^.]+ )?to its owner's hand/i);
  if (bounceMatch) {
    const targets = triggerItem.targets || [];
    if (targets.length > 0) {
      const targetPerm = (state.battlefield || []).find((p: any) => p?.id === targets[0]);
      if (targetPerm) {
        const owner = targetPerm.owner;
        const card = targetPerm.card;
        
        // Commander Replacement Effect (Rule 903.9a):
        // If a commander would be put into its owner's hand from anywhere, 
        // its owner may put it into the command zone instead.
        const commandZone = (ctx as any).commandZone || {};
        const commanderInfo = commandZone[owner];
        const commanderIds = commanderInfo?.commanderIds || [];
        const isCommander = (card?.id && commanderIds.includes(card.id)) || targetPerm.isCommander === true;
        
        // Move to owner's hand
        const permIndex = state.battlefield.indexOf(targetPerm);
        if (permIndex !== -1) {
          const bouncedPermanentId = targetPerm.id;
          state.battlefield.splice(permIndex, 1);
          
          if (isCommander && card) {
            // Defer zone change - let player choose command zone or hand
            state.pendingCommanderZoneChoice = state.pendingCommanderZoneChoice || {};
            state.pendingCommanderZoneChoice[owner] = state.pendingCommanderZoneChoice[owner] || [];
            state.pendingCommanderZoneChoice[owner].push({
              commanderId: card.id,
              commanderName: card.name,
              destinationZone: 'hand',
              card: {
                id: card.id,
                name: card.name,
                type_line: card.type_line,
                oracle_text: card.oracle_text,
                image_uris: card.image_uris,
                mana_cost: card.mana_cost,
                power: card.power,
                toughness: card.toughness,
              },
            });
            console.log(`[executeTriggerEffect] Commander ${card.name} would go to hand - DEFERRING zone change for player choice`);
          } else {
            // Non-commander - move directly to hand
            const ownerZones = state.zones?.[owner];
            if (ownerZones) {
              ownerZones.hand = ownerZones.hand || [];
              card.zone = 'hand';
              ownerZones.hand.push(card);
              ownerZones.handCount = ownerZones.hand.length;
            }
            console.log(`[executeTriggerEffect] Returned ${card?.name || targetPerm.id} to owner's hand`);
          }
          
          // Process linked exile returns for the removed permanent
          processLinkedExileReturns(ctx, bouncedPermanentId);
        }
      }
    }
    return;
  }
  
  // Pattern: "exile the top card of your library" (Prosper, Theater of Horrors, etc.)
  // These cards let you play the exiled card until end of turn or end of next turn
  const exileTopCardMatch = desc.match(/exile the top card of your library/i);
  if (exileTopCardMatch) {
    // Get the controller's library
    const lib = (ctx as any).libraries?.get(controller);
    if (lib && lib.length > 0) {
      // Remove top card from library
      const topCard = lib.shift();
      (ctx as any).libraries?.set(controller, lib);
      
      // Update library count
      const zones = state.zones?.[controller];
      if (zones) {
        zones.libraryCount = lib.length;
      }
      
      // Add to exile zone with "can play" flag
      state.exile = state.exile || [];
      const exiledCard = {
        ...topCard,
        zone: 'exile',
        canBePlayedBy: controller,
        playableUntilTurn: (state.turnNumber || 0) + 1, // Until end of next turn
        exiledBy: sourceName,
      };
      state.exile.push(exiledCard);
      
      // Also track in a pending impulse draw state for the UI
      state.pendingImpulseDraws = state.pendingImpulseDraws || {};
      state.pendingImpulseDraws[controller] = state.pendingImpulseDraws[controller] || [];
      state.pendingImpulseDraws[controller].push({
        cardId: topCard.id,
        cardName: topCard.name,
        exiledBy: sourceName,
        playableUntilTurn: (state.turnNumber || 0) + 1,
      });
      
      console.log(`[executeTriggerEffect] ${sourceName}: Exiled ${topCard.name || 'card'} from ${controller}'s library (can play until end of next turn)`);
    }
    return;
  }
  
  // Pattern: add mana (Cryptolith Rite, etc.)
  const addManaMatch = desc.match(/add (\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (addManaMatch) {
    const manaString = addManaMatch[1];
    console.log(`[executeTriggerEffect] ${controller} adds ${manaString} to mana pool`);
    
    // Parse mana and add to pool
    state.manaPool = state.manaPool || {};
    state.manaPool[controller] = state.manaPool[controller] || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    
    const manaRegex = /\{([WUBRGC])\}/gi;
    let match;
    while ((match = manaRegex.exec(manaString)) !== null) {
      const color = match[1].toUpperCase();
      if (state.manaPool[controller][color] !== undefined) {
        state.manaPool[controller][color]++;
      }
    }
    return;
  }
  
  // Pattern: "whenever an opponent draws a card" - deals damage or other effect
  // Scrawling Crawler, Nekusar, Fate Unraveler, etc.
  const opponentDrawsDamageMatch = desc.match(/whenever (?:an )?opponent draws (?:a card|cards?),?\s*(?:[^,.]+ )?(?:deals? |loses? )(\d+) (?:damage|life)/i);
  if (opponentDrawsDamageMatch) {
    const damage = parseInt(opponentDrawsDamageMatch[1], 10);
    // This trigger should have been put on stack when opponent drew
    // The triggerItem should contain info about which opponent drew
    const drawingPlayer = triggerItem?.triggeringPlayer || triggerItem?.targets?.[0];
    if (drawingPlayer && drawingPlayer !== controller) {
      modifyLife(drawingPlayer, -damage);
      console.log(`[executeTriggerEffect] ${sourceName}: ${drawingPlayer} loses ${damage} life from drawing`);
    }
    return;
  }
  
  // Pattern: "whenever a player draws a card" - universal draw trigger
  const playerDrawsTriggerMatch = desc.match(/whenever (?:a )?player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (playerDrawsTriggerMatch) {
    const effectText = playerDrawsTriggerMatch[1].trim();
    // Check for damage/life loss patterns
    const damageMatch = effectText.match(/(?:deals? |loses? )(\d+) (?:damage|life)/i);
    if (damageMatch) {
      const damage = parseInt(damageMatch[1], 10);
      const drawingPlayer = triggerItem?.triggeringPlayer || triggerItem?.targets?.[0];
      if (drawingPlayer) {
        modifyLife(drawingPlayer, -damage);
        console.log(`[executeTriggerEffect] ${sourceName}: ${drawingPlayer} loses ${damage} life from drawing`);
      }
    }
    return;
  }
  
  // Pattern: "that player adds {X}{X}{X}" - mana production for specific player
  const thatPlayerAddsManaMatch = desc.match(/that player adds (\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (thatPlayerAddsManaMatch) {
    const manaString = thatPlayerAddsManaMatch[1];
    const targetPlayer = triggerItem?.triggeringPlayer || controller;
    console.log(`[executeTriggerEffect] ${targetPlayer} adds ${manaString} to mana pool`);
    
    state.manaPool = state.manaPool || {};
    state.manaPool[targetPlayer] = state.manaPool[targetPlayer] || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    
    const manaRegex2 = /\{([WUBRGC])\}/gi;
    let manaMatch;
    while ((manaMatch = manaRegex2.exec(manaString)) !== null) {
      const color = manaMatch[1].toUpperCase();
      if (state.manaPool[targetPlayer][color] !== undefined) {
        state.manaPool[targetPlayer][color]++;
      }
    }
    return;
  }
  
  // Pattern: "Additional combat phase" or "extra combat phase" (Aurelia, Combat Celebrant, etc.)
  if (desc.includes('additional combat phase') || desc.includes('extra combat phase')) {
    const sourceNameLower = sourceName.toLowerCase();
    
    // Check if this is a "first attack each turn" condition (Aurelia)
    const isFirstAttackOnly = desc.includes('first attack') || desc.includes('first combat');
    
    // Check if we should untap creatures (Aurelia does this)
    const shouldUntap = desc.includes('untap all creatures') || sourceNameLower.includes('aurelia');
    
    // Check if this trigger has already fired this turn (for "once per turn" effects)
    const extraCombatKey = `extraCombat_${sourceName}_${state.turnNumber || 0}`;
    if (isFirstAttackOnly && state.usedOncePerTurn?.[extraCombatKey]) {
      console.log(`[executeTriggerEffect] ${sourceName} extra combat already used this turn, skipping`);
      return;
    }
    
    // Mark as used for "once per turn" effects
    if (isFirstAttackOnly) {
      state.usedOncePerTurn = state.usedOncePerTurn || {};
      state.usedOncePerTurn[extraCombatKey] = true;
    }
    
    // Add the extra combat phase
    addExtraCombat(ctx, sourceName, shouldUntap);
    console.log(`[executeTriggerEffect] ${sourceName}: Added extra combat phase (untap: ${shouldUntap})`);
    return;
  }
  
  // Pattern: "untap all creatures you control" without extra combat
  if (desc.includes('untap all creatures you control') && !desc.includes('combat phase')) {
    const battlefield = state.battlefield || [];
    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      const permTypeLine = (perm.card?.type_line || '').toLowerCase();
      if (!permTypeLine.includes('creature')) continue;
      
      if (perm.tapped) {
        perm.tapped = false;
        console.log(`[executeTriggerEffect] Untapped ${perm.card?.name || perm.id}`);
      }
    }
    return;
  }
  
  // Log unhandled triggers for future implementation
  console.log(`[executeTriggerEffect] Unhandled trigger effect: "${description}" from ${sourceName}`);
}

/* Resolve the top item - moves permanent spells to battlefield */
export function resolveTopOfStack(ctx: GameContext) {
  const item = popStackItem(ctx);
  if (!item) return;
  
  const { state, bumpSeq } = ctx;
  const card = item.card;
  const controller = item.controller as PlayerID;
  const targets = (item as any).targets || [];
  
  // For adventure cards, determine which face was cast
  // If castAsAdventure is false, we're casting the permanent side (face 0)
  // If castAsAdventure is true, we're casting the adventure side (face 1, which is sorcery/instant)
  // Only process adventure card logic if card exists (abilities and triggered abilities don't have card property)
  const castAsAdventure = (item as any).castAsAdventure;
  let effectiveTypeLine = card?.type_line;
  let effectiveCard = card; // Use this for all card property accesses
  
  // For adventure cards, use the properties of the specific face that was cast
  if (card && (card as any).layout === 'adventure' && Array.isArray((card as any).card_faces)) {
    const faces = (card as any).card_faces;
    let faceIndex = 0; // Default to permanent side
    
    if (castAsAdventure === true && faces[1]) {
      // Casting adventure side (face 1) - sorcery/instant
      faceIndex = 1;
    } else if (castAsAdventure === false && faces[0]) {
      // Casting permanent side (face 0) - creature/enchantment/artifact/etc.
      faceIndex = 0;
    }
    
    const face = faces[faceIndex];
    if (face) {
      effectiveTypeLine = face.type_line;
      // Create an effective card object that merges the main card with the face-specific properties
      effectiveCard = {
        ...card,
        type_line: face.type_line,
        oracle_text: face.oracle_text,
        mana_cost: face.mana_cost,
        power: face.power,
        toughness: face.toughness,
        loyalty: face.loyalty,
        // Keep the original name and image_uris from the main card for display
        // but override the name if we need face-specific name
        name: face.name || card.name,
      };
    }
  }
  
  // Handle activated abilities (like fetch lands)
  if ((item as any).type === 'ability') {
    const abilityType = (item as any).abilityType;
    const sourceName = (item as any).sourceName || 'Unknown';
    
    // Handle fetch land ability resolution
    if (abilityType === 'fetch-land') {
      console.log(`[resolveTopOfStack] Resolving fetch land ability from ${sourceName} for ${controller}`);
      
      // Set up pending library search - the socket layer will send the search prompt
      const searchParams = (item as any).searchParams || {};
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'fetch-land',
        searchFor: searchParams.searchDescription || 'a land card',
        destination: 'battlefield',
        // Standard fetch lands (Polluted Delta, Flooded Strand, etc.) put lands onto battlefield untapped.
        // Only lands like Terramorphic Expanse or Evolving Wilds specify "enters the battlefield tapped".
        // The search prompt handler can override this based on the specific card's oracle text.
        tapped: false,
        optional: false,
        source: sourceName,
        shuffleAfter: true,
        filter: searchParams.filter || { types: ['land'] },
        maxSelections: searchParams.maxSelections || 1,
        cardImageUrl: searchParams.cardImageUrl,
      };
      
      console.log(`[resolveTopOfStack] Fetch land ${sourceName}: ${controller} may search for ${searchParams.searchDescription || 'a land card'}${searchParams.maxSelections > 1 ? ` (up to ${searchParams.maxSelections})` : ''}`);
      bumpSeq();
      return;
    }
    
    // Handle creature upgrade ability resolution (Figure of Destiny, Warden of the First Tree, etc.)
    // IMPORTANT: These are PERMANENT characteristic-changing effects, NOT temporary "until end of turn" effects!
    // The creature permanently becomes the new type/stats until it leaves the battlefield.
    // This enables the progression system where each upgrade builds on the previous one.
    if (abilityType === 'creature-upgrade') {
      console.log(`[resolveTopOfStack] Resolving creature upgrade ability from ${sourceName} for ${controller}`);
      
      const source = (item as any).source;
      const upgradeData = (item as any).upgradeData || {};
      
      // Find the source permanent on the battlefield
      const battlefield = state.battlefield || [];
      const sourcePerm = battlefield.find((p: any) => p.id === source);
      
      if (!sourcePerm) {
        console.log(`[resolveTopOfStack] Creature upgrade: source permanent ${source} no longer on battlefield`);
        bumpSeq();
        return;
      }
      
      const changes: string[] = [];
      
      // Apply new creature types - these PERMANENTLY replace the creature's types
      // (until the creature leaves the battlefield)
      if (upgradeData.newTypes && upgradeData.newTypes.length > 0) {
        (sourcePerm as any).upgradedCreatureTypes = [...upgradeData.newTypes];
        
        // Update the type line for display
        const typeLine = (sourcePerm as any).card?.type_line || 'Creature';
        const dashIndex = typeLine.indexOf('—');
        const mainTypes = dashIndex !== -1 ? typeLine.slice(0, dashIndex).trim() : typeLine.trim();
        (sourcePerm as any).card = (sourcePerm as any).card || {};
        (sourcePerm as any).card.type_line = `${mainTypes} — ${upgradeData.newTypes.join(' ')}`;
        
        changes.push(`became a ${upgradeData.newTypes.join(' ')}`);
      }
      
      // Apply new base power/toughness
      if (upgradeData.newPower !== undefined) {
        (sourcePerm as any).basePower = upgradeData.newPower;
        changes.push(`base power is now ${upgradeData.newPower}`);
      }
      if (upgradeData.newToughness !== undefined) {
        (sourcePerm as any).baseToughness = upgradeData.newToughness;
        changes.push(`base toughness is now ${upgradeData.newToughness}`);
      }
      
      // Add keywords
      if (upgradeData.keywords && upgradeData.keywords.length > 0) {
        (sourcePerm as any).grantedKeywords = (sourcePerm as any).grantedKeywords || [];
        for (const keyword of upgradeData.keywords) {
          if (!(sourcePerm as any).grantedKeywords.includes(keyword)) {
            (sourcePerm as any).grantedKeywords.push(keyword);
            changes.push(`gained ${keyword}`);
          }
        }
      }
      
      // Add counters
      if (upgradeData.counterCount && upgradeData.counterType) {
        (sourcePerm as any).counters = (sourcePerm as any).counters || {};
        (sourcePerm as any).counters[upgradeData.counterType] = 
          ((sourcePerm as any).counters[upgradeData.counterType] || 0) + upgradeData.counterCount;
        changes.push(`got ${upgradeData.counterCount} ${upgradeData.counterType} counter(s)`);
      }
      
      console.log(`[resolveTopOfStack] Creature upgrade applied to ${sourceName}: ${changes.join(', ')}`);
      bumpSeq();
      return;
    }
    
    // Handle equip ability resolution
    // CRITICAL: Equipment attachments must go through the stack and can be responded to
    if (abilityType === 'equip') {
      console.log(`[resolveTopOfStack] Resolving equip ability from ${sourceName} for ${controller}`);
      
      const equipParams = (item as any).equipParams || {};
      const { equipmentId, targetCreatureId, equipmentName, targetCreatureName } = equipParams;
      
      if (!equipmentId || !targetCreatureId) {
        console.warn(`[resolveTopOfStack] Equip ability missing parameters`);
        bumpSeq();
        return;
      }
      
      // Find the equipment and target creature on the battlefield
      const battlefield = state.battlefield || [];
      const equipment = battlefield.find((p: any) => p.id === equipmentId);
      const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
      
      if (!equipment) {
        console.log(`[resolveTopOfStack] Equipment ${equipmentName || equipmentId} no longer on battlefield`);
        bumpSeq();
        return;
      }
      
      if (!targetCreature) {
        console.log(`[resolveTopOfStack] Target creature ${targetCreatureName || targetCreatureId} no longer on battlefield`);
        bumpSeq();
        return;
      }
      
      // Verify target is still a legal creature
      const targetTypeLine = (targetCreature.card?.type_line || "").toLowerCase();
      if (!targetTypeLine.includes("creature")) {
        console.log(`[resolveTopOfStack] Target ${targetCreatureName || targetCreatureId} is no longer a creature`);
        bumpSeq();
        return;
      }
      
      // Remove equipment from previous target (if any)
      if (equipment.attachedTo) {
        const previousTarget = battlefield.find((p: any) => p?.id === equipment.attachedTo);
        if (previousTarget && previousTarget.attachedEquipment) {
          previousTarget.attachedEquipment = (previousTarget.attachedEquipment as string[]).filter(
            (id: string) => id !== equipmentId
          );
          // Remove equipped badge if no equipment remains
          if (previousTarget.attachedEquipment.length === 0) {
            previousTarget.isEquipped = false;
          }
        }
      }
      
      // Attach equipment to new target
      equipment.attachedTo = targetCreatureId;
      
      // Add equipment to creature's attachedEquipment array
      if (!targetCreature.attachedEquipment) {
        targetCreature.attachedEquipment = [];
      }
      if (!targetCreature.attachedEquipment.includes(equipmentId)) {
        targetCreature.attachedEquipment.push(equipmentId);
      }
      
      // Add equipped badge/marker
      targetCreature.isEquipped = true;
      
      console.log(`[resolveTopOfStack] ${equipmentName || 'Equipment'} equipped to ${targetCreatureName || 'creature'}`);
      bumpSeq();
      return;
    }
    
    // Handle other activated abilities - execute their effects
    // Use the same effect execution logic as triggered abilities
    const description = (item as any).description || '';
    console.log(`[resolveTopOfStack] Executing activated ability from ${sourceName} for ${controller}: ${description}`);
    
    // Execute the ability effect (handles life gain, draw, damage, etc.)
    executeTriggerEffect(ctx, controller, sourceName, description, item);
    
    bumpSeq();
    return;
  }
  
  // Handle triggered abilities
  if ((item as any).type === 'triggered_ability') {
    const sourceName = (item as any).sourceName || 'Unknown';
    const description = (item as any).description || '';
    const triggerController = (item as any).controller || controller;
    
    console.log(`[resolveTopOfStack] Triggered ability from ${sourceName} resolved: ${description}`);
    
    // Execute the triggered ability effect based on description
    executeTriggerEffect(ctx, triggerController, sourceName, description, item);
    
    bumpSeq();
    return;
  }
  
  if (effectiveCard && isPermanentTypeLine(effectiveTypeLine)) {
    // Permanent spell resolves - move to battlefield
    const tl = (effectiveTypeLine || "").toLowerCase();
    const isCreature = /\bcreature\b/.test(tl);
    const isPlaneswalker = /\bplaneswalker\b/.test(tl);
    const baseP = isCreature ? parsePT((effectiveCard as any).power) : undefined;
    const baseT = isCreature ? parsePT((effectiveCard as any).toughness) : undefined;
    
    // Check if the creature has haste from any source (own text or battlefield effects)
    // Rule 702.10: Haste allows ignoring summoning sickness
    const battlefield = state.battlefield || [];
    const hasHaste = isCreature && creatureWillHaveHaste(effectiveCard, controller, battlefield);
    
    // Creatures have summoning sickness when they enter (unless they have haste)
    // Rule 302.6: A creature's activated ability with tap/untap symbol can't be
    // activated unless the creature has been under controller's control since 
    // their most recent turn began.
    const hasSummoningSickness = isCreature && !hasHaste;
    
    // Initialize counters - planeswalkers enter with loyalty counters equal to their printed loyalty
    const initialCounters: Record<string, number> = {};
    if (isPlaneswalker && effectiveCard.loyalty) {
      const startingLoyalty = typeof effectiveCard.loyalty === 'number' ? effectiveCard.loyalty : parseInt(effectiveCard.loyalty, 10);
      if (!isNaN(startingLoyalty)) {
        initialCounters.loyalty = startingLoyalty;
        console.log(`[resolveTopOfStack] Planeswalker ${effectiveCard.name} enters with ${startingLoyalty} loyalty`);
      }
    }
    
    // Check for "enters with counters" patterns (Zack Fair, modular creatures, sagas, etc.)
    const etbCounters = detectEntersWithCounters(effectiveCard);
    for (const [counterType, count] of Object.entries(etbCounters)) {
      initialCounters[counterType] = (initialCounters[counterType] || 0) + count;
      console.log(`[resolveTopOfStack] ${effectiveCard.name} enters with ${count} ${counterType} counter(s)`);
    }
    
    // Yuna, Grand Summoner: "When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
    if (isCreature && (state as any).yunaNextCreatureFlags?.[controller]) {
      initialCounters['+1/+1'] = (initialCounters['+1/+1'] || 0) + 2;
      console.log(`[resolveTopOfStack] Yuna's Grand Summon: ${effectiveCard.name} enters with 2 additional +1/+1 counters`);
      // Clear the flag
      delete (state as any).yunaNextCreatureFlags[controller];
    }
    
    // Check if this creature should enter tapped due to effects like Authority of the Consuls, Blind Obedience, etc.
    let shouldEnterTapped = false;
    if (isCreature) {
      shouldEnterTapped = checkCreatureEntersTapped(state.battlefield || [], controller, effectiveCard);
    }
    
    state.battlefield = state.battlefield || [];
    const newPermId = uid("perm");
    
    // Apply counter modifiers (Doubling Season, Vorinclex, etc.) to ETB counters
    // Need to create a temporary permanent to apply modifiers
    const tempPerm = { id: newPermId, controller, counters: {} };
    state.battlefield.push(tempPerm as any);
    const modifiedCounters = applyCounterModifications(state, newPermId, initialCounters);
    state.battlefield.pop(); // Remove temp permanent
    
    const newPermanent = {
      id: newPermId,
      controller,
      owner: controller,
      tapped: shouldEnterTapped,
      counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
      basePower: baseP,
      baseToughness: baseT,
      summoningSickness: hasSummoningSickness,
      card: { ...effectiveCard, zone: "battlefield" },
    } as any;
    
    state.battlefield.push(newPermanent);
    
    // Handle aura and equipment attachments
    // Auras are enchantments with "Aura" subtype that target when cast
    // When they resolve, attach them to their target
    // IMPORTANT: This must be done AFTER pushing to battlefield so the permanent exists
    const isAura = tl.includes('enchantment') && tl.includes('aura');
    const isEquipment = tl.includes('equipment');
    if ((isAura || isEquipment) && targets && targets.length > 0) {
      const targetId = targets[0];
      const targetPerm = state.battlefield.find((p: any) => p?.id === targetId);
      
      if (targetPerm) {
        // Set attachedTo on the aura/equipment
        newPermanent.attachedTo = targetId;
        
        // Track attachment on the target permanent
        // Use attachedEquipment for equipment (existing pattern) and attachments for auras
        if (isEquipment) {
          (targetPerm as any).attachedEquipment = (targetPerm as any).attachedEquipment || [];
          (targetPerm as any).attachedEquipment.push(newPermId);
          console.log(`[resolveTopOfStack] Equipment ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
        } else {
          // For auras, use the standard attachments field
          (targetPerm as any).attachments = (targetPerm as any).attachments || [];
          (targetPerm as any).attachments.push(newPermId);
          console.log(`[resolveTopOfStack] Aura ${effectiveCard.name} attached to ${targetPerm.card?.name || targetId}`);
        }
      } else {
        console.warn(`[resolveTopOfStack] ${isAura ? 'Aura' : 'Equipment'} ${effectiveCard.name} target ${targetId} not found on battlefield`);
      }
    }
    
    // Build a readable status message for logging
    let statusNote = '';
    if (shouldEnterTapped) {
      statusNote = ' (enters tapped)';
    } else if (hasSummoningSickness) {
      statusNote = ' (summoning sickness)';
    } else if (hasHaste) {
      statusNote = ' (haste)';
    }
    console.log(`[resolveTopOfStack] Permanent ${effectiveCard.name || 'unnamed'} entered battlefield under ${controller}${statusNote}`);
    
    // Check for ETB triggers on this permanent and other permanents
    try {
      const allTriggers = getETBTriggersForPermanent(effectiveCard, newPermanent);
      
      // Filter out triggers that fire when OTHER permanents enter (not when self enters)
      // These trigger types should only fire for OTHER permanents, not the permanent itself:
      // - permanent_etb: "Whenever another creature/permanent enters" (Soul Warden, Altar of the Brood)
      // - creature_etb: "Whenever a creature enters under your control" (Cathars' Crusade)
      // - another_permanent_etb: "Whenever another permanent enters under your control"
      // 
      // Only include triggers that fire when THIS permanent enters:
      // - etb: "When ~ enters the battlefield" (self ETB)
      // - etb_modal_choice: "As ~ enters the battlefield, choose"
      // - job_select, living_weapon: equipment ETB effects
      // - etb_sacrifice_unless_pay: "When ~ enters, sacrifice unless you pay"
      const selfETBTriggerTypes = new Set([
        'etb',                      // Self ETB: "When ~ enters the battlefield"
        'etb_modal_choice',         // Modal ETB: "As ~ enters, choose"
        'job_select',               // Equipment: create Hero token and attach
        'living_weapon',            // Equipment: create Germ token and attach
        'etb_sacrifice_unless_pay', // ETB sacrifice unless pay
        'etb_gain_life',            // Self ETB life gain
        'etb_draw',                 // Self ETB draw
        'etb_search',               // Self ETB search library
        'etb_create_token',         // Self ETB token creation
        'etb_counter',              // Self ETB counter placement
      ]);
      
      const etbTriggers = allTriggers.filter(trigger => {
        // Keep triggers that fire when THIS permanent enters
        if (selfETBTriggerTypes.has(trigger.triggerType)) {
          return true;
        }
        // Filter out triggers that fire when OTHER permanents enter
        // (these will be added from other permanents in the loop below)
        if (trigger.triggerType === 'permanent_etb' ||
            trigger.triggerType === 'creature_etb' ||
            trigger.triggerType === 'another_permanent_etb') {
          return false;
        }
        // Default: keep the trigger (unknown types treated as self-ETB)
        return true;
      });
      
      // Also check other permanents for "whenever a creature/permanent enters" triggers
      // Check if the entering permanent is a token
      const isToken = !!(newPermanent as any).isToken || !!(card as any).isToken;
      
      for (const perm of state.battlefield) {
        if (perm.id === newPermId) continue; // Skip the entering permanent
        const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
        for (const trigger of otherTriggers) {
          // Only add triggers that fire on other permanents entering
          if (trigger.triggerType === 'creature_etb' && isCreature) {
            // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
            if ((trigger as any).nontokenOnly && isToken) {
              continue; // Skip - this trigger only fires for nontoken creatures
            }
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'another_permanent_etb') {
            // Check color restriction if any (e.g., "white or black creature")
            if ((trigger as any).colorRestriction) {
              if (!matchesColorRestriction((trigger as any).colorRestriction, (card as any).colors || [])) {
                continue; // Skip - entering creature doesn't match color restriction
              }
            }
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'permanent_etb') {
            // Altar of the Brood style - triggers on ANY permanent entering (not just yours)
            // Check color restriction if any
            if ((trigger as any).colorRestriction) {
              if (!matchesColorRestriction((trigger as any).colorRestriction, (card as any).colors || [])) {
                continue; // Skip - entering creature doesn't match color restriction
              }
            }
            etbTriggers.push({ ...trigger, permanentId: perm.id });
          } else if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
            // Suture Priest, Authority of the Consuls style - triggers when OPPONENT's creature enters
            const triggerController = perm.controller;
            // Only fire if the entering creature is controlled by an opponent of the trigger controller
            if (triggerController && triggerController !== controller) {
              etbTriggers.push({ ...trigger, permanentId: perm.id, targetPlayer: controller } as any);
            }
          }
        }
      }
      
      if (etbTriggers.length > 0) {
        console.log(`[resolveTopOfStack] Found ${etbTriggers.length} ETB trigger(s) for ${effectiveCard.name || 'permanent'}`);
        
        for (const trigger of etbTriggers) {
          // Handle Job Select and Living Weapon immediately (they don't go on stack - they're part of ETB)
          // These create tokens and attach the equipment as a single action
          if (trigger.triggerType === 'job_select' || trigger.triggerType === 'living_weapon') {
            const tokenInfo = (trigger as any).tokenInfo;
            if (tokenInfo) {
              // Create the token
              const tokenId = uid("token");
              const tokenCard = {
                id: `card_${tokenId}`,
                name: tokenInfo.name || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ'),
                type_line: `Token Creature — ${tokenInfo.subtypes?.join(' ') || (trigger.triggerType === 'job_select' ? 'Hero' : 'Phyrexian Germ')}`,
                colors: tokenInfo.colors || [],
                isToken: true,
              };
              
              const tokenPermanent = {
                id: tokenId,
                controller,
                owner: controller,
                tapped: false,
                counters: {},
                basePower: tokenInfo.power ?? (trigger.triggerType === 'job_select' ? 1 : 0),
                baseToughness: tokenInfo.toughness ?? (trigger.triggerType === 'job_select' ? 1 : 0),
                summoningSickness: true,
                isToken: true,
                card: { ...tokenCard, zone: 'battlefield' },
              } as any;
              
              state.battlefield.push(tokenPermanent);
              
              // Attach the equipment to the token (validate it's actually an equipment)
              const equipment = state.battlefield.find((p: any) => p.id === newPermId);
              const isEquipment = equipment && (equipment.card?.type_line || '').toLowerCase().includes('equipment');
              if (equipment && isEquipment) {
                (equipment as any).attachedTo = tokenId;
                (tokenPermanent as any).attachedEquipment = (tokenPermanent as any).attachedEquipment || [];
                (tokenPermanent as any).attachedEquipment.push(newPermId);
                
                console.log(`[resolveTopOfStack] ${trigger.triggerType === 'job_select' ? 'Job Select' : 'Living Weapon'}: Created ${tokenCard.name} token and attached ${card.name}`);
              }
              
              // Trigger ETB effects for the token
              triggerETBEffectsForToken(ctx, tokenPermanent, controller);
            }
            continue; // Don't push to stack, already handled
          }
          
          // Push trigger onto the stack
          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          // Determine the controller of the triggered ability
          // For ETB triggers from other permanents (like Soul Warden), the controller
          // is the controller of the permanent with the trigger, NOT the entering creature
          let triggerController = controller;
          if (trigger.permanentId && trigger.permanentId !== newPermId) {
            const triggerSource = state.battlefield?.find((p: any) => p.id === trigger.permanentId);
            if (triggerSource?.controller) {
              triggerController = triggerSource.controller;
            }
          }
          
          state.stack.push({
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: trigger.permanentId,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
          } as any);
          
          console.log(`[resolveTopOfStack] ⚡ ${trigger.cardName}'s triggered ability (controlled by ${triggerController}): ${trigger.description}`);
        }
      }
    } catch (err) {
      console.warn('[resolveTopOfStack] Failed to detect ETB triggers:', err);
    }
    
    // Handle Squad token creation (Rule 702.157)
    // Squad: "As an additional cost to cast this spell, you may pay {cost} any number of times. 
    // When this permanent enters the battlefield, create that many tokens that are copies of it."
    try {
      const squadTimesPaid = (card as any).squadTimesPaid;
      if (squadTimesPaid && squadTimesPaid > 0 && isCreature) {
        console.log(`[resolveTopOfStack] Squad: Creating ${squadTimesPaid} token copies of ${effectiveCard.name || 'creature'}`);
        
        for (let i = 0; i < squadTimesPaid; i++) {
          const tokenId = uid("squad_token");
          const tokenCard = {
            id: `card_${tokenId}`,
            name: effectiveCard.name || 'Token',
            type_line: effectiveCard.type_line || 'Creature',
            oracle_text: effectiveCard.oracle_text || '',
            colors: (card as any).colors || [],
            power: effectiveCard.power,
            toughness: effectiveCard.toughness,
            image_uris: effectiveCard.image_uris,
            isToken: true,
          };
          
          const tokenPermanent = {
            id: tokenId,
            controller,
            owner: controller,
            tapped: false,
            counters: {},
            basePower: baseP,
            baseToughness: baseT,
            summoningSickness: true,
            isToken: true,
            card: { ...tokenCard, zone: 'battlefield' },
          } as any;
          
          state.battlefield.push(tokenPermanent);
          
          // Trigger ETB effects for each squad token
          triggerETBEffectsForToken(ctx, tokenPermanent, controller);
          
          console.log(`[resolveTopOfStack] Squad: Created token copy #${i + 1} of ${effectiveCard.name}`);
        }
      }
    } catch (err) {
      console.warn('[resolveTopOfStack] Failed to create squad tokens:', err);
    }
    
    // Recalculate player effects when permanents ETB (for Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      console.warn('[resolveTopOfStack] Failed to recalculate player effects:', err);
    }
  } else if (effectiveCard) {
    // Non-permanent spell (instant/sorcery) - execute effects before moving to graveyard
    const oracleText = effectiveCard.oracle_text || '';
    const oracleTextLower = oracleText.toLowerCase();
    const spellSpec = categorizeSpell(effectiveCard.name || '', oracleText);
    
    // IMPORTANT: Capture target permanent info BEFORE destruction/exile for effects that need it
    // This MUST be done before any effects are executed as the target will be removed
    // - Beast Within, Rapid Hybridization, Pongify: "its controller creates" token effects
    // - Path to Exile: target's controller may search for basic land
    // - Swords to Plowshares: target's controller gains life equal to power
    // - Fateful Absence: target's controller investigates
    // - Get Lost: target's controller creates Map tokens
    let targetControllerForTokenCreation: PlayerID | null = null;
    let targetControllerForRemovalEffects: PlayerID | null = null;
    let targetPowerBeforeRemoval: number = 0;
    
    // Capture target info for removal spells that have "its controller" effects
    if (targets.length > 0 && targets[0] !== undefined) {
      const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
      const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
      if (targetPerm) {
        // For token creation after destroy (Beast Within, etc.)
        if (oracleTextLower.includes('its controller creates')) {
          targetControllerForTokenCreation = targetPerm.controller as PlayerID;
          console.log(`[resolveTopOfStack] Captured target controller ${targetControllerForTokenCreation} for token creation`);
        }
        
        // For effects that affect target's controller after exile/destroy
        // Path to Exile, Swords to Plowshares, Fateful Absence, Get Lost
        const isPathToExile = effectiveCard.name?.toLowerCase().includes('path to exile') || 
            (oracleTextLower.includes('exile target creature') && 
             oracleTextLower.includes('search') && 
             oracleTextLower.includes('basic land'));
        const isSwordsToPlowshares = effectiveCard.name?.toLowerCase().includes('swords to plowshares') || 
            (oracleTextLower.includes('exile target creature') && 
             oracleTextLower.includes('gains life equal to'));
        const isFatefulAbsence = effectiveCard.name?.toLowerCase().includes('fateful absence') ||
            (oracleTextLower.includes('destroy target creature') && 
             oracleTextLower.includes('investigates'));
        const isGetLost = effectiveCard.name?.toLowerCase().includes('get lost') ||
            (oracleTextLower.includes('destroy target creature') && 
             oracleTextLower.includes('map token'));
             
        if (isPathToExile || isSwordsToPlowshares || isFatefulAbsence || isGetLost) {
          targetControllerForRemovalEffects = targetPerm.controller as PlayerID;
          
          // Capture power for Swords to Plowshares
          if (isSwordsToPlowshares) {
            if (typeof targetPerm.effectivePower === 'number') {
              targetPowerBeforeRemoval = targetPerm.effectivePower;
            } else if (typeof targetPerm.basePower === 'number') {
              targetPowerBeforeRemoval = targetPerm.basePower;
            } else if (targetPerm.card?.power) {
              const parsed = parseInt(String(targetPerm.card.power), 10);
              if (!isNaN(parsed)) {
                targetPowerBeforeRemoval = parsed;
              }
            }
            // Add +1/+1 and -1/-1 counter adjustments
            if (targetPerm.counters) {
              const plusCounters = targetPerm.counters['+1/+1'] || 0;
              const minusCounters = targetPerm.counters['-1/-1'] || 0;
              targetPowerBeforeRemoval += plusCounters - minusCounters;
            }
          }
          
          console.log(`[resolveTopOfStack] Captured target controller ${targetControllerForRemovalEffects} for removal spell effects (power: ${targetPowerBeforeRemoval})`);
        }
      }
    }
    
    if (spellSpec) {
      // Convert targets array to TargetRef format if needed
      const targetRefs: TargetRef[] = targets.map((t: any) => {
        if (typeof t === 'string') {
          return { kind: 'permanent' as const, id: t };
        }
        return t;
      });
      
      // Generate effects based on spell type and targets
      const effects = resolveSpell(spellSpec, targetRefs, state as any);
      
      // Execute each effect
      for (const effect of effects) {
        executeSpellEffect(ctx, effect, controller, effectiveCard.name || 'spell');
      }
      
      // Handle special spell effects not covered by the base system
      // Beast Within: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token."
      // Rapid Hybridization: "Destroy target creature. Its controller creates a 3/3 green Frog Lizard creature token."
      // Pongify: "Destroy target creature. Its controller creates a 3/3 green Ape creature token."
      if (targetControllerForTokenCreation) {
        // Check for token creation patterns
        // Pattern: "creates a X/Y [color] [type] creature token"
        const tokenMatch = oracleText.match(/creates?\s+(?:a\s+)?(\d+)\/(\d+)\s+(\w+)\s+(?:(\w+)\s+)?(?:(\w+)\s+)?creature\s+token/i);
        if (tokenMatch) {
          const power = parseInt(tokenMatch[1], 10);
          const toughness = parseInt(tokenMatch[2], 10);
          // Determine token type - the last non-null match before "creature token"
          const color = tokenMatch[3]?.toLowerCase() || 'green';
          const type1 = tokenMatch[4] || '';
          const type2 = tokenMatch[5] || '';
          const tokenType = type2 || type1 || 'Beast';
          const tokenName = `${tokenType} Token`;
          
          createBeastToken(ctx, targetControllerForTokenCreation, tokenName, power, toughness, color);
          console.log(`[resolveTopOfStack] ${effectiveCard.name} created ${power}/${toughness} ${tokenName} for ${targetControllerForTokenCreation}`);
        }
      }
    }
    
    // Handle Dispatch and similar metalcraft spells
    // Dispatch: "Tap target creature. Metalcraft — If you control three or more artifacts, exile that creature instead."
    const dispatchHandled = handleDispatch(ctx, card, controller, targets, state);
    
    // Handle Fractured Identity: "Exile target nonland permanent. Each player other than its controller creates a token that's a copy of it."
    // This requires special handling because we need to:
    // 1. Capture the target permanent's info before exiling
    // 2. Create token copies for each opponent of the target's controller
    const isFracturedIdentity = effectiveCard.name?.toLowerCase().includes('fractured identity') ||
        (oracleTextLower.includes('exile target') && 
         oracleTextLower.includes('each player other than its controller') && 
         oracleTextLower.includes('creates a token') && 
         oracleTextLower.includes('copy'));
    
    if (isFracturedIdentity && targets.length > 0) {
      const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
      const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
      
      if (targetPerm && targetPerm.card) {
        const targetController = targetPerm.controller as PlayerID;
        const targetCard = targetPerm.card as any;
        const players = (state as any).players || [];
        
        // Get all players EXCEPT the target's controller
        const copyRecipients = players.filter((p: any) => p && p.id && p.id !== targetController);
        
        console.log(`[resolveTopOfStack] Fractured Identity: Creating token copies for ${copyRecipients.length} players (excluding target controller ${targetController})`);
        
        // Create token copy for each player other than target's controller
        for (const recipient of copyRecipients) {
          try {
            // Use uid() for robust ID generation instead of Date.now() + Math.random()
            const tokenId = uid('fi_token');
            const typeLine = targetCard.type_line || '';
            const isCreature = typeLine.toLowerCase().includes('creature');
            
            const tokenPerm = {
              id: tokenId,
              controller: recipient.id as PlayerID,
              owner: recipient.id as PlayerID,
              tapped: false,
              counters: {},
              basePower: isCreature ? parseInt(String(targetCard.power || '0'), 10) : undefined,
              baseToughness: isCreature ? parseInt(String(targetCard.toughness || '0'), 10) : undefined,
              summoningSickness: isCreature,
              isToken: true,
              card: {
                id: tokenId,
                name: targetCard.name || 'Copy',
                type_line: typeLine,
                oracle_text: targetCard.oracle_text || '',
                mana_cost: targetCard.mana_cost || '',
                power: targetCard.power,
                toughness: targetCard.toughness,
                image_uris: targetCard.image_uris,
                zone: 'battlefield',
              },
            };
            
            state.battlefield = state.battlefield || [];
            state.battlefield.push(tokenPerm as any);
            
            console.log(`[resolveTopOfStack] Fractured Identity: Created token copy of ${targetCard.name} for ${recipient.name || recipient.id}`);
          } catch (err) {
            console.warn(`[resolveTopOfStack] Failed to create Fractured Identity token for ${recipient.id}:`, err);
          }
        }
        
        // Note: The exile effect is handled by the spellSpec resolution above (EXILE_TARGET)
      }
    }
    
    // Handle token creation spells (where the caster creates tokens)
    // Patterns: "create X 1/1 tokens", "create two 1/1 tokens", etc.
    const spellXValue = (item as any).xValue;
    const tokenCreationResult = parseTokenCreation(effectiveCard.name, oracleTextLower, controller, state, spellXValue);
    if (tokenCreationResult) {
      for (let i = 0; i < tokenCreationResult.count; i++) {
        createTokenFromSpec(ctx, controller, tokenCreationResult);
      }
      console.log(`[resolveTopOfStack] ${effectiveCard.name} created ${tokenCreationResult.count} ${tokenCreationResult.name} token(s) for ${controller} (xValue: ${spellXValue ?? 'N/A'})`);
    }
    
    // Handle extra turn spells (Time Warp, Time Walk, Temporal Mastery, etc.)
    if (isExtraTurnSpell(effectiveCard.name, oracleTextLower)) {
      // Determine who gets the extra turn
      // Most extra turn spells give the caster an extra turn
      // "Target player takes an extra turn" would need target handling
      let extraTurnPlayer = controller;
      
      // Check for "target player takes an extra turn" pattern
      if (oracleTextLower.includes('target player') && oracleTextLower.includes('extra turn')) {
        // Use target if provided
        if (targets.length > 0 && targets[0]?.kind === 'player') {
          extraTurnPlayer = targets[0].id as PlayerID;
        }
      }
      
      addExtraTurn(ctx, extraTurnPlayer, effectiveCard.name || 'Extra turn spell');
      console.log(`[resolveTopOfStack] Extra turn granted to ${extraTurnPlayer} by ${effectiveCard.name}`);
    }
    
    // Handle "each player draws" spells (Vision Skeins, Prosperity, Howling Mine effects, etc.)
    const eachPlayerDrawsMatch = oracleTextLower.match(/each player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    if (eachPlayerDrawsMatch) {
      const drawCountStr = eachPlayerDrawsMatch[1].toLowerCase();
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      const drawCount = wordToNumber[drawCountStr] || parseInt(drawCountStr, 10) || 1;
      
      // Draw cards for each player
      const players = (state as any).players || [];
      for (const player of players) {
        if (player && player.id) {
          try {
            const drawn = drawCardsFromZone(ctx, player.id as PlayerID, drawCount);
            console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s)`);
          } catch (err) {
            console.warn(`[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
          }
        }
      }
    }
    
    // Handle "You draw X. Each other player draws Y" patterns (Words of Wisdom style)
    // Words of Wisdom: "You draw two cards. Each other player draws a card."
    const youDrawMatch = oracleTextLower.match(/you draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    const eachOtherDrawMatch = oracleTextLower.match(/each other player draws?\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
    
    if (youDrawMatch && !eachPlayerDrawsMatch) {
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
      };
      const controllerDrawCount = wordToNumber[youDrawMatch[1].toLowerCase()] || parseInt(youDrawMatch[1], 10) || 1;
      
      try {
        const drawn = drawCardsFromZone(ctx, controller, controllerDrawCount);
        console.log(`[resolveTopOfStack] ${effectiveCard.name}: Controller ${controller} drew ${drawn.length} card(s)`);
      } catch (err) {
        console.warn(`[resolveTopOfStack] Failed to draw cards for controller ${controller}:`, err);
      }
      
      // Handle "each other player draws" if present
      if (eachOtherDrawMatch) {
        const otherDrawCount = wordToNumber[eachOtherDrawMatch[1].toLowerCase()] || parseInt(eachOtherDrawMatch[1], 10) || 1;
        const players = (state as any).players || [];
        for (const player of players) {
          if (player && player.id && player.id !== controller) {
            try {
              const drawn = drawCardsFromZone(ctx, player.id as PlayerID, otherDrawCount);
              console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s)`);
            } catch (err) {
              console.warn(`[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
            }
          }
        }
      }
    }
    
    // Handle Windfall-style effects: "Each player discards their hand, then draws cards equal to..."
    if (oracleTextLower.includes('each player discards') && oracleTextLower.includes('hand') && 
        (oracleTextLower.includes('then draws') || oracleTextLower.includes('draws cards equal'))) {
      const players = (state as any).players || [];
      const zones = state.zones || {};
      let greatestDiscarded = 0;
      
      // First pass: discard all hands and track the greatest number discarded
      for (const player of players) {
        if (player && player.id) {
          const playerZones = zones[player.id];
          if (playerZones && Array.isArray(playerZones.hand)) {
            const handSize = playerZones.hand.length;
            greatestDiscarded = Math.max(greatestDiscarded, handSize);
            
            // Move hand to graveyard
            playerZones.graveyard = playerZones.graveyard || [];
            for (const handCard of playerZones.hand) {
              if (handCard && typeof handCard === 'object') {
                (playerZones.graveyard as any[]).push({ ...handCard, zone: 'graveyard' });
              }
            }
            playerZones.hand = [];
            playerZones.handCount = 0;
            playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
            
            console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} discarded ${handSize} card(s)`);
          }
        }
      }
      
      // Second pass: each player draws cards equal to the greatest number discarded
      for (const player of players) {
        if (player && player.id && greatestDiscarded > 0) {
          try {
            const drawn = drawCardsFromZone(ctx, player.id as PlayerID, greatestDiscarded);
            console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${player.name || player.id} drew ${drawn.length} card(s) (greatest discarded: ${greatestDiscarded})`);
          } catch (err) {
            console.warn(`[resolveTopOfStack] Failed to draw cards for ${player.id}:`, err);
          }
        }
      }
    }
    
    // Handle "draw X, then discard Y" spells (Faithless Looting, Cathartic Reunion, Tormenting Voice, etc.)
    // Pattern: "Draw two cards, then discard two cards" or "Draw two cards. Then discard two cards."
    const drawThenDiscardMatch = oracleTextLower.match(/draw\s+(\d+|a|an|one|two|three|four|five)\s+cards?(?:\.|,)?\s*(?:then\s+)?discard\s+(\d+|a|an|one|two|three|four|five)\s+cards?/i);
    if (drawThenDiscardMatch && !oracleTextLower.includes('each player')) {
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      const drawCount = wordToNumber[drawThenDiscardMatch[1].toLowerCase()] || parseInt(drawThenDiscardMatch[1], 10) || 1;
      const discardCount = wordToNumber[drawThenDiscardMatch[2].toLowerCase()] || parseInt(drawThenDiscardMatch[2], 10) || 1;
      
      try {
        // Draw first
        const drawn = drawCardsFromZone(ctx, controller, drawCount);
        console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s)`);
        
        // Set up pending discard - the socket layer will prompt for discard selection
        (state as any).pendingDiscard = (state as any).pendingDiscard || {};
        (state as any).pendingDiscard[controller] = {
          count: discardCount,
          source: effectiveCard.name || 'Spell',
          reason: 'spell_effect',
        };
        console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${controller} must discard ${discardCount} card(s)`);
      } catch (err) {
        console.warn(`[resolveTopOfStack] Failed to process draw/discard for ${controller}:`, err);
      }
    }
    
    // Handle "draw cards and create treasure" spells (Seize the Spoils, Unexpected Windfall, etc.)
    // Pattern: "Draw two cards and create a Treasure token"
    const drawAndTreasureMatch = oracleTextLower.match(/draw\s+(\d+|a|an|one|two|three|four|five)\s+cards?.*(?:create|creates?)\s+(?:a|an|one|two|three|\d+)?\s*treasure\s+tokens?/i);
    console.log(`[resolveTopOfStack] ${effectiveCard.name}: Checking draw+treasure pattern. Match: ${!!drawAndTreasureMatch}, drawThenDiscardMatch: ${!!drawThenDiscardMatch}, eachPlayer: ${oracleTextLower.includes('each player')}`);
    if (drawAndTreasureMatch && !oracleTextLower.includes('each player') && !drawThenDiscardMatch) {
      const wordToNumber: Record<string, number> = { 
        'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5
      };
      const drawCount = wordToNumber[drawAndTreasureMatch[1].toLowerCase()] || parseInt(drawAndTreasureMatch[1], 10) || 1;
      
      // Check how many treasures to create
      const treasureCountMatch = oracleTextLower.match(/create\s+(?:a|an|(\d+)|one|two|three)\s*treasure\s+tokens?/i);
      const treasureCount = treasureCountMatch && treasureCountMatch[1] ? 
        parseInt(treasureCountMatch[1], 10) : 1;
      
      console.log(`[resolveTopOfStack] ${effectiveCard.name}: Executing draw ${drawCount} + create ${treasureCount} treasure(s)`);
      try {
        const drawn = drawCardsFromZone(ctx, controller, drawCount);
        console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s)`);
        
        // Create treasure tokens
        for (let i = 0; i < treasureCount; i++) {
          createTreasureToken(ctx, controller);
        }
        console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${controller} created ${treasureCount} Treasure token(s)`);
      } catch (err) {
        console.warn(`[resolveTopOfStack] Failed to process draw/treasure for ${controller}:`, err);
      }
    }
    
    // Handle simple "Draw X cards" spells (Harmonize, Concentrate, Jace's Ingenuity, etc.)
    // Pattern: "Draw three cards." or "Draw four cards." 
    // This is the imperative form without "you" and catches cards like Harmonize
    // Must NOT match other patterns we've already handled
    if (!eachPlayerDrawsMatch && !youDrawMatch && !drawThenDiscardMatch && !drawAndTreasureMatch) {
      // First try exact match for simple draw spells (e.g., "Draw three cards.")
      // Then try to find "draw X cards" anywhere in the text if it's the main effect
      const simpleDrawMatch = oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\.?$/i) ||
                              oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s*$/i);
      
      // Also handle cards where "Draw X cards" is at the start but may have a period
      const altDrawMatch = !simpleDrawMatch && oracleTextLower.startsWith('draw ') ?
        oracleTextLower.match(/^draw\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i) : null;
      
      const matchToUse = simpleDrawMatch || altDrawMatch;
      
      if (matchToUse) {
        const wordToNumber: Record<string, number> = { 
          'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
          'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10
        };
        const drawCount = wordToNumber[matchToUse[1].toLowerCase()] || parseInt(matchToUse[1], 10) || 1;
        
        try {
          const drawn = drawCardsFromZone(ctx, controller, drawCount);
          console.log(`[resolveTopOfStack] ${effectiveCard.name}: ${controller} drew ${drawn.length} card(s) (simple draw spell)`);
        } catch (err) {
          console.warn(`[resolveTopOfStack] Failed to draw cards for ${controller}:`, err);
        }
      }
    }
    
    // Handle tutor spells (Demonic Tutor, Vampiric Tutor, Diabolic Tutor, Kodama's Reach, Cultivate, etc.)
    // These need to trigger a library search prompt for the player
    const tutorInfo = detectTutorSpell(oracleText);
    if (tutorInfo.isTutor) {
      // Set up pending library search - the socket layer will send the search prompt
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'tutor',
        searchFor: tutorInfo.searchCriteria || 'card',
        destination: tutorInfo.destination || 'hand',
        tapped: tutorInfo.entersTapped ?? (tutorInfo.destination === 'battlefield'), // Cards put onto battlefield from tutors are usually tapped
        optional: tutorInfo.optional || false,
        source: effectiveCard.name || 'Tutor',
        shuffleAfter: true,
        maxSelections: tutorInfo.maxSelections || 1,
        // For split-destination effects (Kodama's Reach, Cultivate)
        splitDestination: tutorInfo.splitDestination || false,
        toBattlefield: tutorInfo.toBattlefield,
        toHand: tutorInfo.toHand,
        entersTapped: tutorInfo.entersTapped,
      };
      console.log(`[resolveTopOfStack] Tutor spell ${effectiveCard.name}: ${controller} may search for ${tutorInfo.searchCriteria || 'a card'} (destination: ${tutorInfo.destination}, split: ${tutorInfo.splitDestination || false})`);
    }
    
    // Handle Gamble - special tutor with random discard
    // "Search your library for a card, put it into your hand, then shuffle. Then discard a card at random."
    const isGamble = effectiveCard.name?.toLowerCase().trim() === 'gamble';
    
    if (isGamble) {
      // Set up pending library search with special flag for random discard
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'tutor',
        searchFor: 'a card', // Gamble can search for any card
        destination: 'hand',
        source: 'Gamble',
        shuffleAfter: true,
        maxSelections: 1,
        // Special flag for Gamble: after the tutor, discard random
        discardRandomAfter: true,
      };
      console.log(`[resolveTopOfStack] Gamble: ${controller} will search for a card and then discard a random card`);
    }
    
    // Handle Gift of Estates - "If an opponent controls more lands than you, 
    // search your library for up to three Plains cards, reveal them, put them into your hand, then shuffle."
    const isGiftOfEstates = effectiveCard.name?.toLowerCase().includes('gift of estates') ||
        (oracleTextLower.includes('opponent controls more lands') && 
         oracleTextLower.includes('search') && 
         oracleTextLower.includes('plains'));
    
    if (isGiftOfEstates) {
      // Check condition: does an opponent control more lands?
      const { myLandCount, anyOpponentHasMoreLands } = checkOpponentHasMoreLands(state, controller);
      
      if (anyOpponentHasMoreLands) {
        // Condition met - set up library search for up to 3 Plains
        (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
        (state as any).pendingLibrarySearch[controller] = {
          type: 'gift_of_estates',
          searchFor: 'Plains cards',
          destination: 'hand',
          tapped: false,
          optional: true,
          source: effectiveCard.name || 'Gift of Estates',
          shuffleAfter: true,
          maxSelections: 3,
          filter: { subtypes: ['Plains'] },
        };
        console.log(`[resolveTopOfStack] Gift of Estates: Condition met (opponent has more lands) - ${controller} may search for up to 3 Plains`);
      } else {
        console.log(`[resolveTopOfStack] Gift of Estates: Condition NOT met - ${controller} has ${myLandCount} lands, no opponent has more`);
      }
    }
    
    // Handle Traverse the Outlands - "Search your library for up to X basic land cards, 
    // where X is the greatest power among creatures you control"
    const isTraverseOutlands = effectiveCard.name?.toLowerCase().includes('traverse the outlands') ||
        (oracleTextLower.includes('search your library') && 
         oracleTextLower.includes('greatest power') && 
         oracleTextLower.includes('basic land'));
    
    if (isTraverseOutlands) {
      const battlefield = state.battlefield || [];
      
      // Find greatest power among creatures controlled by the caster
      let greatestPower = 0;
      for (const perm of battlefield) {
        if (perm.controller === controller) {
          const typeLine = (perm.card?.type_line || '').toLowerCase();
          if (typeLine.includes('creature')) {
            // Calculate effective power including counters, modifiers, and base power
            let basePower = perm.basePower ?? (parseInt(String(perm.card?.power ?? '0'), 10) || 0);
            
            // Handle star (*) power - use basePower if set
            if (typeof perm.card?.power === 'string' && perm.card.power.includes('*')) {
              if (typeof perm.basePower === 'number') {
                basePower = perm.basePower;
              }
            }
            
            // Add +1/+1 counters
            const plusCounters = perm.counters?.['+1/+1'] || 0;
            const minusCounters = perm.counters?.['-1/-1'] || 0;
            const counterDelta = plusCounters - minusCounters;
            
            // Check for other counter types that affect power
            let otherCounterPower = 0;
            if (perm.counters) {
              for (const [counterType, count] of Object.entries(perm.counters)) {
                if (counterType === '+1/+1' || counterType === '-1/-1') continue;
                const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
                if (counterMatch) {
                  const pMod = parseInt(counterMatch[1], 10);
                  otherCounterPower += pMod * (count as number);
                }
              }
            }
            
            // Add modifiers from equipment, auras, anthems, lords, etc.
            let modifierPower = 0;
            if (perm.modifiers && Array.isArray(perm.modifiers)) {
              for (const mod of perm.modifiers) {
                if (mod.type === 'powerToughness' || mod.type === 'POWER_TOUGHNESS') {
                  modifierPower += mod.power || 0;
                }
              }
            }
            
            const effectivePower = Math.max(0, basePower + counterDelta + otherCounterPower + modifierPower);
            
            if (effectivePower > greatestPower) {
              greatestPower = effectivePower;
            }
          }
        }
      }
      
      // Set up library search for up to X basic lands
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'traverse_outlands',
        searchFor: 'basic land cards',
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: effectiveCard.name || 'Traverse the Outlands',
        shuffleAfter: true,
        maxSelections: greatestPower,
        filter: { types: ['land'], supertypes: ['basic'] },
      };
      console.log(`[resolveTopOfStack] Traverse the Outlands: ${controller} may search for up to ${greatestPower} basic lands (greatest power with counters/modifiers)`);
    }
    
    // Handle Boundless Realms - "Search your library for up to X basic land cards, 
    // where X is the number of lands you control"
    const isBoundlessRealms = effectiveCard.name?.toLowerCase().includes('boundless realms') ||
        (oracleTextLower.includes('search your library') && 
         oracleTextLower.includes('number of lands you control') && 
         oracleTextLower.includes('basic land'));
    
    if (isBoundlessRealms) {
      const battlefield = state.battlefield || [];
      
      // Count lands controlled by the caster
      const landCount = battlefield.filter((p: any) => 
        p.controller === controller && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      
      // Set up library search for up to X basic lands
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'boundless_realms',
        searchFor: 'basic land cards',
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: effectiveCard.name || 'Boundless Realms',
        shuffleAfter: true,
        maxSelections: landCount,
        filter: { types: ['land'], supertypes: ['basic'] },
      };
      console.log(`[resolveTopOfStack] Boundless Realms: ${controller} may search for up to ${landCount} basic lands (lands controlled)`);
    }
    
    // Handle Jaheira's Respite - "Search your library for up to X basic land cards, 
    // where X is the number of creatures attacking you"
    const isJaheirasRespite = effectiveCard.name?.toLowerCase().includes("jaheira's respite") ||
        (oracleTextLower.includes('search your library') && 
         oracleTextLower.includes('number of creatures attacking you') && 
         oracleTextLower.includes('basic land'));
    
    if (isJaheirasRespite) {
      // Count creatures currently attacking the controller
      // Note: This should be resolved during combat, so we check the combat state
      const attackers = (state as any).combat?.attackers || [];
      const attackingController = attackers.filter((atk: any) => 
        atk.defendingPlayer === controller
      ).length;
      
      // Set up library search for up to X basic lands
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[controller] = {
        type: 'jaheiras_respite',
        searchFor: 'basic land cards',
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: effectiveCard.name || "Jaheira's Respite",
        shuffleAfter: true,
        maxSelections: attackingController,
        filter: { types: ['land'], supertypes: ['basic'] },
      };
      console.log(`[resolveTopOfStack] Jaheira's Respite: ${controller} may search for up to ${attackingController} basic lands (creatures attacking)`);
    }
    
    // Handle Path to Exile - exile target creature, controller may search for basic land
    // Use captured target info from BEFORE the exile happened
    const isPathToExile = effectiveCard.name?.toLowerCase().includes('path to exile') || 
        (oracleTextLower.includes('exile target creature') && 
         oracleTextLower.includes('search') && 
         oracleTextLower.includes('basic land'));
    
    if (isPathToExile && targetControllerForRemovalEffects) {
      // Set up pending search - the creature's controller may search for a basic land
      (state as any).pendingLibrarySearch = (state as any).pendingLibrarySearch || {};
      (state as any).pendingLibrarySearch[targetControllerForRemovalEffects] = {
        type: 'path_to_exile',
        searchFor: 'basic land',
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: effectiveCard.name || 'Path to Exile',
      };
      console.log(`[resolveTopOfStack] Path to Exile: ${targetControllerForRemovalEffects} may search for a basic land (tapped)`);
    }
    
    // Handle Swords to Plowshares - "Exile target creature. Its controller gains life equal to its power."
    // Use captured target info from BEFORE the exile happened
    const isSwordsToPlowshares = effectiveCard.name?.toLowerCase().includes('swords to plowshares') || 
        (oracleTextLower.includes('exile target creature') && 
         oracleTextLower.includes('gains life equal to'));
    
    if (isSwordsToPlowshares && targetControllerForRemovalEffects) {
      // Gain the life using pre-captured power value
      if (targetPowerBeforeRemoval > 0) {
        const players = (state as any).players || [];
        const player = players.find((p: any) => p?.id === targetControllerForRemovalEffects);
        
        // Update both player.life and state.life to ensure consistency
        const startingLife = (state as any).startingLife || 40;
        state.life = state.life || {};
        const currentLife = state.life[targetControllerForRemovalEffects] ?? player?.life ?? startingLife;
        state.life[targetControllerForRemovalEffects] = currentLife + targetPowerBeforeRemoval;
        
        if (player) {
          player.life = state.life[targetControllerForRemovalEffects];
          console.log(`[resolveTopOfStack] Swords to Plowshares: ${targetControllerForRemovalEffects} gains ${targetPowerBeforeRemoval} life (${currentLife} -> ${state.life[targetControllerForRemovalEffects]})`);
        }
        
        // Trigger life gain effects (Ajani's Pridemate, etc.)
        triggerLifeGainEffects(ctx, targetControllerForRemovalEffects, targetPowerBeforeRemoval);
      }
    }
    
    // Handle Fateful Absence - "Destroy target creature or planeswalker. Its controller investigates."
    // Use captured target info from BEFORE the destroy happened
    const isFatefulAbsence = effectiveCard.name?.toLowerCase().includes('fateful absence') ||
        (oracleTextLower.includes('destroy target creature') && 
         oracleTextLower.includes('investigates'));
    
    if (isFatefulAbsence && targetControllerForRemovalEffects) {
      // Create a Clue token for the creature's controller
      state.battlefield = state.battlefield || [];
      const clueId = uid("clue");
      state.battlefield.push({
        id: clueId,
        controller: targetControllerForRemovalEffects,
        owner: targetControllerForRemovalEffects,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: clueId,
          name: "Clue",
          type_line: "Token Artifact — Clue",
          oracle_text: "{2}, Sacrifice this artifact: Draw a card.",
          zone: "battlefield",
          colors: [],
        },
      } as any);
      
      console.log(`[resolveTopOfStack] Fateful Absence: Created Clue token for ${targetControllerForRemovalEffects}`);
    }
    
    // Handle Get Lost - "Destroy target creature, enchantment, or planeswalker. Its controller creates two Map tokens."
    // Use captured target info from BEFORE the destroy happened
    const isGetLost = effectiveCard.name?.toLowerCase().includes('get lost') ||
        (oracleTextLower.includes('destroy target creature') && 
         oracleTextLower.includes('map token'));
    
    if (isGetLost && targetControllerForRemovalEffects) {
      // Create two Map tokens for the creature's controller
      state.battlefield = state.battlefield || [];
      for (let i = 0; i < 2; i++) {
        const mapId = uid("map");
        state.battlefield.push({
          id: mapId,
          controller: targetControllerForRemovalEffects,
          owner: targetControllerForRemovalEffects,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: mapId,
            name: "Map",
            type_line: "Token Artifact — Map",
            oracle_text: "{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.",
            zone: "battlefield",
            colors: [],
          },
        } as any);
      }
      
      console.log(`[resolveTopOfStack] Get Lost: Created 2 Map tokens for ${targetControllerForRemovalEffects}`);
    }
    
    // Handle Entrapment Maneuver - "Target player sacrifices an attacking creature. 
    // You create X 1/1 white Soldier creature tokens, where X is that creature's toughness."
    const isEntrapmentManeuver = effectiveCard.name?.toLowerCase().includes('entrapment maneuver') ||
      (oracleTextLower.includes('sacrifices an attacking creature') && 
       oracleTextLower.includes('create') && 
       oracleTextLower.includes('soldier') &&
       oracleTextLower.includes('toughness'));
    
    if (isEntrapmentManeuver && targets.length > 0) {
      // Find the target player (they must sacrifice an attacking creature)
      const targetPlayerId = targets[0]?.id || targets[0];
      
      // Get all attacking creatures controlled by the target player
      const battlefield = state.battlefield || [];
      const attackingCreatures = battlefield.filter((p: any) => 
        p?.controller === targetPlayerId && 
        (p?.card?.type_line || "").toLowerCase().includes("creature") &&
        p?.attacking // Only creatures that are currently attacking
      );
      
      if (attackingCreatures.length > 0) {
        // Set up pending sacrifice selection for Entrapment Maneuver
        // The target player chooses which attacking creature to sacrifice
        (state as any).pendingEntrapmentManeuver = (state as any).pendingEntrapmentManeuver || {};
        (state as any).pendingEntrapmentManeuver[targetPlayerId] = {
          source: effectiveCard.name || 'Entrapment Maneuver',
          caster: controller,
          attackingCreatures: attackingCreatures.map((c: any) => ({
            id: c.id,
            name: c.card?.name || "Unknown",
            power: c.card?.power || c.basePower || "0",
            toughness: c.card?.toughness || c.baseToughness || "0",
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
            typeLine: c.card?.type_line,
          })),
        };
        console.log(`[resolveTopOfStack] Entrapment Maneuver: ${targetPlayerId} must sacrifice one of ${attackingCreatures.length} attacking creature(s)`);
      } else {
        console.log(`[resolveTopOfStack] Entrapment Maneuver: ${targetPlayerId} has no attacking creatures to sacrifice`);
      }
    }
    
    // Handle Chaos Warp - "The owner of target permanent shuffles it into their library, 
    // then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield."
    const isChaosWarp = effectiveCard.name?.toLowerCase().includes('chaos warp') ||
      (oracleTextLower.includes('shuffles it into their library') && 
       oracleTextLower.includes('reveals the top card') &&
       oracleTextLower.includes('permanent'));
    
    if (isChaosWarp && targets.length > 0) {
      const targetPermId = targets[0]?.id || targets[0];
      const battlefield = state.battlefield || [];
      const targetPerm = battlefield.find((p: any) => p.id === targetPermId);
      
      if (targetPerm) {
        const owner = targetPerm.owner as PlayerID;
        const targetCard = targetPerm.card;
        
        // Commander Replacement Effect (Rule 903.9a):
        // If a commander would be put into its owner's library from anywhere,
        // its owner may put it into the command zone instead.
        const commandZone = ctx.commandZone || {};
        const commanderInfo = commandZone[owner];
        const commanderIds = commanderInfo?.commanderIds || [];
        const isCommander = (targetCard?.id && commanderIds.includes(targetCard.id)) || targetPerm.isCommander === true;
        
        // Remove permanent from battlefield
        const idx = battlefield.findIndex((p: any) => p.id === targetPermId);
        if (idx !== -1) {
          battlefield.splice(idx, 1);
        }
        
        if (isCommander && targetCard) {
          // Defer zone change - let player choose command zone or library
          // Use object keyed by player ID for consistency with rest of codebase
          (state as any).pendingCommanderZoneChoice = (state as any).pendingCommanderZoneChoice || {};
          (state as any).pendingCommanderZoneChoice[owner] = (state as any).pendingCommanderZoneChoice[owner] || [];
          (state as any).pendingCommanderZoneChoice[owner].push({
            commanderId: targetCard.id,
            commanderName: targetCard.name,
            destinationZone: 'library',
            card: {
              id: targetCard.id,
              name: targetCard.name,
              type_line: targetCard.type_line,
              oracle_text: targetCard.oracle_text,
              image_uris: targetCard.image_uris,
              mana_cost: targetCard.mana_cost,
              power: targetCard.power,
              toughness: targetCard.toughness,
            },
          });
          console.log(`[resolveTopOfStack] Chaos Warp: Commander ${targetCard.name} would go to library - DEFERRING zone change for player choice`);
          
          // Still reveal and potentially put a card onto battlefield
          // (but the commander choice happens separately)
          const lib = ctx.libraries?.get(owner) || [];
          if (lib.length > 0) {
            const topCard = lib[0];
            const topTypeLine = (topCard?.type_line || '').toLowerCase();
            const isPermanent = topTypeLine.includes('creature') || 
                                topTypeLine.includes('artifact') || 
                                topTypeLine.includes('enchantment') || 
                                topTypeLine.includes('land') || 
                                topTypeLine.includes('planeswalker') ||
                                topTypeLine.includes('battle');
            if (isPermanent) {
              lib.shift();
              ctx.libraries?.set(owner, lib);
              const newPerm = {
                id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                card: topCard,
                controller: owner,
                owner: owner,
                tapped: false,
                counters: {},
              };
              battlefield.push(newPerm);
              console.log(`[resolveTopOfStack] Chaos Warp: Revealed and put ${topCard.name} onto battlefield for ${owner}`);
            }
          }
          
          bumpSeq();
          return;
        }
        
        // Non-commander - shuffle into owner's library
        const lib = ctx.libraries?.get(owner) || [];
        (lib as any[]).push({ ...targetCard, zone: 'library' });
        
        // Shuffle library
        for (let i = lib.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [lib[i], lib[j]] = [lib[j], lib[i]];
        }
        ctx.libraries?.set(owner, lib);
        
        console.log(`[resolveTopOfStack] Chaos Warp: ${targetCard?.name || 'Permanent'} shuffled into ${owner}'s library`);
        
        // Reveal top card of library
        if (lib.length > 0) {
          const topCard = lib[0];
          const topTypeLine = (topCard?.type_line || '').toLowerCase();
          
          // Check if it's a permanent card (creature, artifact, enchantment, land, planeswalker, battle)
          const isPermanent = topTypeLine.includes('creature') || 
                              topTypeLine.includes('artifact') || 
                              topTypeLine.includes('enchantment') || 
                              topTypeLine.includes('land') || 
                              topTypeLine.includes('planeswalker') ||
                              topTypeLine.includes('battle');
          
          if (isPermanent) {
            // Remove from library
            lib.shift();
            ctx.libraries?.set(owner, lib);
            
            // Put onto battlefield
            const isCreature = topTypeLine.includes('creature');
            const newPermanent = {
              id: uid("perm"),
              controller: owner,
              owner: owner,
              tapped: false,
              counters: {},
              basePower: isCreature ? parsePT((topCard as any).power) : undefined,
              baseToughness: isCreature ? parsePT((topCard as any).toughness) : undefined,
              summoningSickness: isCreature,
              card: { ...topCard, zone: "battlefield" },
            } as any;
            
            battlefield.push(newPermanent);
            console.log(`[resolveTopOfStack] Chaos Warp: ${owner} revealed ${topCard?.name || 'card'} (permanent) - put onto battlefield`);
          } else {
            console.log(`[resolveTopOfStack] Chaos Warp: ${owner} revealed ${topCard?.name || 'card'} (${topTypeLine}) - not a permanent, stays on top`);
          }
        }
        
        // Update library count
        const zones = state.zones || {};
        const z = zones[owner];
        if (z) {
          z.libraryCount = lib.length;
        }
      }
    }
    
    // Handle Join Forces spells (Mind's Aglow, Collective Voyage, etc.)
    // These require all players to have the option to contribute mana
    const cardNameLower = (effectiveCard.name || '').toLowerCase();
    console.log(`[resolveTopOfStack] Checking if ${effectiveCard.name} is a Join Forces spell...`);
    if (isJoinForcesSpell(effectiveCard.name, oracleTextLower)) {
      // Set up pending join forces - this signals to the socket layer to initiate the contribution phase
      (state as any).pendingJoinForces = (state as any).pendingJoinForces || [];
      (state as any).pendingJoinForces.push({
        id: uid("jf"),
        controller,
        cardName: effectiveCard.name || 'Join Forces Spell',
        effectDescription: oracleText,
        imageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      });
      console.log(`[resolveTopOfStack] Join Forces spell ${effectiveCard.name} waiting for player contributions (pendingJoinForces count: ${(state as any).pendingJoinForces.length})`);
    } else {
      console.log(`[resolveTopOfStack] ${effectiveCard.name} is NOT a Join Forces spell (name: "${cardNameLower}", has 'join forces': ${oracleTextLower.includes('join forces')})`);
    }
    
    // Handle Tempting Offer spells (Tempt with Discovery, Tempt with Glory, etc.)
    // These require each opponent to choose whether to accept the offer
    console.log(`[resolveTopOfStack] Checking if ${effectiveCard.name} is a Tempting Offer spell...`);
    if (isTemptingOfferSpell(effectiveCard.name, oracleTextLower)) {
      // Set up pending tempting offer - this signals to the socket layer to initiate the offer phase
      (state as any).pendingTemptingOffer = (state as any).pendingTemptingOffer || [];
      (state as any).pendingTemptingOffer.push({
        id: uid("tempt"),
        controller,
        cardName: effectiveCard.name || 'Tempting Offer Spell',
        effectDescription: oracleText,
        imageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      });
      console.log(`[resolveTopOfStack] Tempting Offer spell ${effectiveCard.name} waiting for opponent responses (pendingTemptingOffer count: ${(state as any).pendingTemptingOffer.length})`);
    } else {
      console.log(`[resolveTopOfStack] ${effectiveCard.name} is NOT a Tempting Offer spell`);
    }
    
    // Handle Ponder-style effects (look at top N, reorder, optionally shuffle, then draw)
    // Pattern: "Look at the top N cards of your library, then put them back in any order"
    if (isPonderStyleSpell(effectiveCard.name, oracleTextLower)) {
      const ponderConfig = getPonderConfig(effectiveCard.name, oracleTextLower);
      
      // Set up pending ponder - the socket layer will send the peek prompt
      (state as any).pendingPonder = (state as any).pendingPonder || {};
      (state as any).pendingPonder[controller] = {
        effectId: uid("ponder"),
        cardCount: ponderConfig.cardCount,
        cardName: effectiveCard.name || 'Ponder',
        variant: ponderConfig.variant,
        canShuffle: ponderConfig.canShuffle,
        drawAfter: ponderConfig.drawAfter,
        pickToHand: ponderConfig.pickToHand,
        targetPlayerId: controller,
        imageUrl: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      };
      console.log(`[resolveTopOfStack] Ponder-style spell ${effectiveCard.name} set up pending effect (variant: ${ponderConfig.variant}, cards: ${ponderConfig.cardCount})`);
    }
    
    // Handle Approach of the Second Sun - goes 7th from top of library, not graveyard
    // Also track that it was cast for win condition checking
    const isApproach = (effectiveCard.name || '').toLowerCase().includes('approach of the second sun') ||
                       (oracleTextLower.includes('put it into its owner\'s library seventh from the top') &&
                        oracleTextLower.includes('you win the game'));
    
    if (isApproach) {
      // Track that Approach was cast (for win condition)
      (state as any).approachCastHistory = (state as any).approachCastHistory || {};
      (state as any).approachCastHistory[controller] = (state as any).approachCastHistory[controller] || [];
      (state as any).approachCastHistory[controller].push({
        timestamp: Date.now(),
        castFromHand: true, // Assuming cast from hand for now
      });
      
      // Check if this is the second time casting from hand
      const castCount = (state as any).approachCastHistory[controller].length;
      if (castCount >= 2) {
        // Win the game!
        console.log(`[resolveTopOfStack] ${controller} wins! Approach of the Second Sun cast for the second time!`);
        
        // Set winner
        (state as any).winner = controller;
        (state as any).gameOver = true;
        (state as any).winCondition = 'Approach of the Second Sun';
      } else {
        // Put 7th from top of library (position 6 in 0-indexed)
        // If library has fewer than 7 cards, put at the bottom (lib.length position)
        const lib = ctx.libraries?.get(controller) || [];
        const insertPosition = Math.min(6, lib.length); // 7th from top, or bottom if library is small
        (lib as any[]).splice(insertPosition, 0, { ...card, zone: 'library' });
        ctx.libraries?.set(controller, lib);
        
        // Update library count
        const zones = ctx.state.zones || {};
        const z = zones[controller];
        if (z) {
          z.libraryCount = lib.length;
        }
        
        // Gain 7 life
        state.life = state.life || {};
        state.life[controller] = (state.life[controller] || 40) + 7;
        const player = (state.players || []).find((p: any) => p.id === controller);
        if (player) player.life = state.life[controller];
        
        console.log(`[resolveTopOfStack] Approach of the Second Sun: ${controller} gained 7 life, card put 7th from top (cast #${castCount})`);
      }
      
      bumpSeq();
      return; // Skip normal graveyard movement
    }
    
    // Move spell to graveyard or exile (for adventure) after resolution
    const zones = ctx.state.zones || {};
    const z = zones[controller];
    if (z) {
      // Check if this is an adventure spell (layout === 'adventure' and was cast as adventure)
      const layout = (card as any).layout;
      const wasAdventure = (item as any).castAsAdventure === true;
      
      if (layout === 'adventure' && wasAdventure) {
        // Adventure spells go to exile instead of graveyard (Rule 715.3d)
        z.exile = z.exile || [];
        (z.exile as any[]).push({ 
          ...card, 
          zone: "exile",
          onAdventure: true, // Mark that this was sent on an adventure
          adventureCaster: controller, // Track who sent it on adventure
        });
        z.exileCount = (z.exile as any[]).length;
        
        console.log(`[resolveTopOfStack] Adventure spell ${effectiveCard.name || 'unnamed'} resolved and exiled for ${controller}`);
      } else {
        // Regular instant/sorcery - goes to graveyard
        z.graveyard = z.graveyard || [];
        (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
        z.graveyardCount = (z.graveyard as any[]).length;
        console.log(`[resolveTopOfStack] Spell ${card.name || 'unnamed'} resolved and moved to graveyard for ${controller}`);
      }
    }
  }
  
  // Run state-based actions after spell resolution
  // This catches creatures that should die from damage (Blasphemous Act, etc.)
  // or from 0 toughness from -1/-1 effects
  try {
    runSBA(ctx);
  } catch (err) {
    console.warn('[resolveTopOfStack] Error running SBA:', err);
  }
  
  bumpSeq();
}

/**
 * Execute a single spell effect
 */
function executeSpellEffect(ctx: GameContext, effect: EngineEffect, caster: PlayerID, spellName: string): void {
  const { state } = ctx;
  
  switch (effect.kind) {
    case 'DestroyPermanent': {
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const destroyedPermanentId = (battlefield[idx] as any).id;
        const destroyed = battlefield.splice(idx, 1)[0];
        const owner = (destroyed as any).owner || (destroyed as any).controller;
        const zones = ctx.state.zones || {};
        const z = zones[owner];
        if (z) {
          z.graveyard = z.graveyard || [];
          const card = (destroyed as any).card;
          if (card) {
            (z.graveyard as any[]).push({ ...card, zone: "graveyard" });
            z.graveyardCount = (z.graveyard as any[]).length;
          }
        }
        console.log(`[resolveSpell] ${spellName} destroyed ${(destroyed as any).card?.name || effect.id}`);
        
        // Process linked exile returns - if this was an Oblivion Ring-style card,
        // return any cards it had exiled
        processLinkedExileReturns(ctx, destroyedPermanentId);
      }
      break;
    }
    case 'MoveToExile': {
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const exiledPermanentId = (battlefield[idx] as any).id;
        const exiled = battlefield.splice(idx, 1)[0];
        const owner = (exiled as any).owner || (exiled as any).controller;
        const zones = ctx.state.zones || {};
        const z = zones[owner];
        if (z) {
          z.exile = z.exile || [];
          const card = (exiled as any).card;
          if (card) {
            (z.exile as any[]).push({ ...card, zone: "exile" });
          }
        }
        console.log(`[resolveSpell] ${spellName} exiled ${(exiled as any).card?.name || effect.id}`);
        
        // Process linked exile returns - if this was an Oblivion Ring-style card,
        // return any cards it had exiled
        processLinkedExileReturns(ctx, exiledPermanentId);
      }
      break;
    }
    case 'FlickerPermanent': {
      // Flicker effect: Exile a permanent and return it to the battlefield
      // For tokens, they cease to exist when exiled and don't return
      const battlefield = state.battlefield || [];
      const idx = battlefield.findIndex((p: any) => p.id === effect.id);
      if (idx !== -1) {
        const flickeredPermanentId = (battlefield[idx] as any).id;
        const flickered = battlefield.splice(idx, 1)[0];
        const flickeredCard = (flickered as any).card;
        const flickeredName = flickeredCard?.name || effect.id;
        const owner = (flickered as any).owner || (flickered as any).controller;
        const isToken = (flickered as any).isToken === true;
        
        // Process linked exile returns first - if this was an Oblivion Ring-style card,
        // return any cards it had exiled before the flicker effect
        processLinkedExileReturns(ctx, flickeredPermanentId);
        
        // Tokens cease to exist when exiled (Rule 111.7) - they don't return
        if (isToken) {
          console.log(`[resolveSpell] ${spellName} exiled token ${flickeredName} - token ceased to exist`);
          break;
        }
        
        // Determine when to return the permanent
        const returnDelay = (effect as any).returnDelay || 'immediate';
        
        if (returnDelay === 'immediate') {
          // Return immediately to the battlefield under owner's control
          // Create a new permanent (new object, no connection to old one)
          // Detect enters-with-counters
          const entersWithCounters = detectEntersWithCounters(flickeredCard);
          
          const newPermanent = {
            id: uid('perm'),
            card: flickeredCard,
            controller: owner,
            owner: owner,
            tapped: false,
            summoning_sickness: flickeredCard?.type_line?.toLowerCase()?.includes('creature') || false,
            counters: entersWithCounters && Object.keys(entersWithCounters).length > 0 ? entersWithCounters : {},
            attachedTo: undefined, // Equipment/Auras are removed
          };
          
          battlefield.push(newPermanent);
          console.log(`[resolveSpell] ${spellName} flickered ${flickeredName} - returned immediately as new permanent ${newPermanent.id}`);
          
          // Trigger ETB effects for the returned permanent
          triggerETBEffectsForPermanent(ctx, newPermanent, owner);
          
        } else {
          // Set up delayed trigger for end of turn or end of combat
          const delayedReturns = (state as any).delayedReturns = (state as any).delayedReturns || [];
          delayedReturns.push({
            id: uid('delayed'),
            card: flickeredCard,
            owner: owner,
            returnTime: returnDelay, // 'end_of_turn' or 'end_of_combat'
            source: spellName,
          });
          console.log(`[resolveSpell] ${spellName} exiled ${flickeredName} - will return at ${returnDelay}`);
        }
      }
      break;
    }
    case 'DamagePermanent': {
      const battlefield = state.battlefield || [];
      const perm = battlefield.find((p: any) => p.id === effect.id);
      if (perm) {
        (perm as any).damage = ((perm as any).damage || 0) + effect.amount;
        console.log(`[resolveSpell] ${spellName} dealt ${effect.amount} damage to ${(perm as any).card?.name || effect.id}`);
      }
      break;
    }
    case 'DamagePlayer': {
      const players = state.players || [];
      const player = players.find((p: any) => p.id === effect.playerId);
      if (player) {
        (player as any).life = ((player as any).life || 40) - effect.amount;
        console.log(`[resolveSpell] ${spellName} dealt ${effect.amount} damage to player ${effect.playerId}`);
      }
      break;
    }
    case 'CounterSpell': {
      // Counter a spell on the stack and move it to its controller's graveyard
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const controller = (countered as any).controller;
        const counteredCardName = (countered as any).card?.name || 'spell';
        
        // Move the countered spell's card to the controller's graveyard
        if ((countered as any).card && controller) {
          const zones = ctx.state.zones = ctx.state.zones || {};
          zones[controller] = zones[controller] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 };
          const gy = (zones[controller] as any).graveyard = (zones[controller] as any).graveyard || [];
          gy.push({ ...(countered as any).card, zone: 'graveyard' });
          (zones[controller] as any).graveyardCount = gy.length;
        }
        
        console.log(`[resolveSpell] ${spellName} countered ${counteredCardName}`);
      }
      break;
    }
    case 'CounterAbility': {
      // Counter an ability on the stack (activated or triggered)
      const stack = state.stack || [];
      const stackIdx = stack.findIndex((s: any) => s.id === effect.stackItemId);
      if (stackIdx >= 0) {
        const countered = stack.splice(stackIdx, 1)[0];
        const abilityDesc = (countered as any).description || (countered as any).ability?.text || 'ability';
        console.log(`[resolveSpell] ${spellName} countered ${abilityDesc}`);
        // Abilities don't go anywhere when countered - they just cease to exist
      }
      break;
    }
    case 'Broadcast': {
      console.log(`[resolveSpell] ${effect.message}`);
      break;
    }
  }
}

/**
 * Check if a spell grants an extra turn
 * Handles cards like: Time Warp, Time Walk, Temporal Mastery, Nexus of Fate,
 * Alrund's Epiphany, Karn's Temporal Sundering, etc.
 */
function isExtraTurnSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known extra turn spell names
  const extraTurnSpells = new Set([
    'time warp',
    'time walk',
    'temporal mastery',
    'nexus of fate',
    'expropriate',
    "alrund's epiphany",
    "karn's temporal sundering",
    'temporal manipulation',
    'time stretch',
    'beacon of tomorrows',
    'capture of jingzhou',
    'temporal trespass',
    'walk the aeons',
    'savor the moment',
    'final fortune',
    "warrior's oath",
    'last chance',
    'chance for glory',
    'medomai the ageless',
    'magistrate\'s scepter',
    'part the waterveil',
    'lighthouse chronologist',
    'wanderwine prophets',
    'emrakul, the promised end',
    'ugin\'s nexus',
    'sage of hours',
    'notorious throng',
  ]);
  
  if (extraTurnSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Take an extra turn" or "takes an extra turn" are the common patterns
  if (oracleTextLower.includes('take an extra turn') ||
      oracleTextLower.includes('takes an extra turn') ||
      oracleTextLower.includes('extra turn after this one')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Join Forces spell
 * 
 * Join Forces cards (as of current sets):
 * - Alliance of Arms
 * - Collective Voyage  
 * - Mana-Charged Dragon (triggered ability when attacking, not a spell)
 * - Minds Aglow
 * - Shared Trauma
 * 
 * Join Forces spells have "Join forces — Starting with you, each player may pay any amount of mana"
 */
function isJoinForcesSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Join Forces spell names (excluding Mana-Charged Dragon which is a triggered ability, not a spell effect)
  const joinForcesSpells = new Set([
    "minds aglow",
    "collective voyage",
    "alliance of arms",
    "shared trauma",
  ]);
  
  if (joinForcesSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Join forces" is the keyword ability
  // Pattern: "Join forces — Starting with you, each player may pay any amount of mana"
  if (oracleTextLower.includes('join forces') &&
      oracleTextLower.includes('starting with you') && 
      oracleTextLower.includes('each player may pay')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Tempting Offer spell
 * 
 * Tempting Offer cards (as of current sets):
 * - Tempt with Discovery (search for land)
 * - Tempt with Glory (+1/+1 counters)
 * - Tempt with Immortality (reanimate)
 * - Tempt with Reflections (clone)
 * - Tempt with Vengeance (create tokens)
 * 
 * Tempting Offer pattern: "Tempting offer — [effect]. Each opponent may [accept]. 
 * For each opponent who does, [bonus for caster]"
 */
function isTemptingOfferSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Tempting Offer spell names (all 7 cards)
  const temptingOfferSpells = new Set([
    "tempt with bunnies",      // Create rabbit tokens
    "tempt with discovery",    // Search for land
    "tempt with glory",        // +1/+1 counters
    "tempt with immortality",  // Reanimate
    "tempt with mayhem",       // Deal damage / goad
    "tempt with reflections",  // Clone
    "tempt with vengeance",    // Create elemental tokens
  ]);
  
  if (temptingOfferSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text
  // "Tempting offer" is the keyword ability
  if (oracleTextLower.includes('tempting offer')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a spell is a Ponder-style spell
 * 
 * Ponder-style cards (look at top N, reorder, optionally shuffle, then draw):
 * - Ponder: Look at top 3, put back in any order, may shuffle, draw 1
 * - Preordain: Scry 2, then draw (different mechanic, not Ponder-style)
 * - Index: Look at top 5, put back in any order (no shuffle, no draw)
 * - Sage Owl: ETB look at top 4, put back in any order
 * - Mystic Speculation: Look at top 3, put back in any order (buyback)
 * - Telling Time: Look at top 3, put 1 in hand, rest back in any order
 * - Serum Visions: Draw 1, scry 2 (not Ponder-style)
 * 
 * Pattern: "Look at the top N cards of your library" + "put them back in any order"
 */
function isPonderStyleSpell(cardName: string, oracleTextLower: string): boolean {
  const nameLower = (cardName || '').toLowerCase();
  
  // Known Ponder-style spell names
  const ponderStyleSpells = new Set([
    "ponder",
    "index",
    "mystic speculation",
    "telling time",
    "sage of epityr",
    "halimar depths",
  ]);
  
  if (ponderStyleSpells.has(nameLower)) {
    return true;
  }
  
  // Generic detection via oracle text pattern
  // Must have both "look at the top" and "put them back in any order"
  if (oracleTextLower.includes('look at the top') && 
      oracleTextLower.includes('put them back in any order')) {
    return true;
  }
  
  return false;
}

/**
 * Get configuration for a Ponder-style effect
 */
function getPonderConfig(cardName: string, oracleTextLower: string): {
  cardCount: number;
  variant: 'ponder' | 'index' | 'telling_time' | 'brainstorm' | 'architects';
  canShuffle: boolean;
  drawAfter: boolean;
  pickToHand: number;
} {
  const nameLower = (cardName || '').toLowerCase();
  
  // Type alias for variant
  type PonderVariant = 'ponder' | 'index' | 'telling_time' | 'brainstorm' | 'architects';
  
  // Default config
  let config: {
    cardCount: number;
    variant: PonderVariant;
    canShuffle: boolean;
    drawAfter: boolean;
    pickToHand: number;
  } = {
    cardCount: 3,
    variant: 'ponder',
    canShuffle: false,
    drawAfter: false,
    pickToHand: 0,
  };
  
  // Ponder: Look at top 3, may shuffle, draw 1
  if (nameLower === 'ponder') {
    config = {
      cardCount: 3,
      variant: 'ponder',
      canShuffle: true,
      drawAfter: true,
      pickToHand: 0,
    };
  }
  // Index: Look at top 5, put back in any order (no shuffle, no draw)
  else if (nameLower === 'index') {
    config = {
      cardCount: 5,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  }
  // Telling Time: Look at top 3, put 1 in hand, rest on top
  else if (nameLower === 'telling time') {
    config = {
      cardCount: 3,
      variant: 'telling_time',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 1,
    };
  }
  // Mystic Speculation: Look at top 3, put back in any order
  else if (nameLower === 'mystic speculation') {
    config = {
      cardCount: 3,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  }
  // Halimar Depths: Look at top 3, put back in any order
  else if (nameLower === 'halimar depths') {
    config = {
      cardCount: 3,
      variant: 'index',
      canShuffle: false,
      drawAfter: false,
      pickToHand: 0,
    };
  }
  // Generic detection
  else {
    // Try to extract card count from oracle text
    const topMatch = oracleTextLower.match(/look at the top (\d+|three|four|five|six|seven)/i);
    if (topMatch) {
      const numWords: Record<string, number> = { 
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10 
      };
      config.cardCount = numWords[topMatch[1].toLowerCase()] || parseInt(topMatch[1], 10) || 3;
    }
    
    // Check for shuffle option
    if (oracleTextLower.includes('may shuffle')) {
      config.canShuffle = true;
    }
    
    // Check for draw after
    if (oracleTextLower.includes('draw a card') || oracleTextLower.includes('draw 1 card')) {
      config.drawAfter = true;
    }
  }
  
  return config;
}

/**
 * Create a token creature (helper for Beast Within and similar)
 */
function createBeastToken(ctx: GameContext, controller: PlayerID, name: string, power: number, toughness: number, color?: string): void {
  const { state, bumpSeq } = ctx;
  
  state.battlefield = state.battlefield || [];
  const tokenId = uid("token");
  
  // Determine creature type from name (e.g., "Beast Token" -> "Beast")
  const creatureType = name.replace(/\s*Token\s*/i, '').trim() || 'Beast';
  const typeLine = `Token Creature — ${creatureType}`;
  
  // Map color names to MTG color letters
  const colorMap: Record<string, string> = {
    'white': 'W', 'w': 'W',
    'blue': 'U', 'u': 'U',  // Blue is U, not B!
    'black': 'B', 'b': 'B',
    'red': 'R', 'r': 'R',
    'green': 'G', 'g': 'G',
    'colorless': 'C', 'c': 'C',
  };
  const lowerColor = (color || 'green').toLowerCase();
  const colorLetter = colorMap[lowerColor] || colorMap[lowerColor.charAt(0)] || 'G';
  const colorLetters = [colorLetter];
  
  // Get token image URLs from the token service
  const imageUrls = getTokenImageUrls(creatureType, power, toughness, colorLetters);
  
  state.battlefield.push({
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: power,
    baseToughness: toughness,
    summoningSickness: true,
    isToken: true,
    card: {
      id: tokenId,
      name,
      type_line: typeLine,
      power: String(power),
      toughness: String(toughness),
      zone: "battlefield",
      colors: colorLetters,
      image_uris: imageUrls,
    },
  } as any);
  
  console.log(`[resolveSpell] Created ${power}/${toughness} ${color || 'green'} ${name} token for ${controller}`);
}

/**
 * Token creation specification parsed from oracle text
 */
interface TokenSpec {
  count: number;
  power: number;
  toughness: number;
  name: string;
  typeLine: string;
  colors?: string[];
}

/**
 * Calculate token doubling multiplier from battlefield effects
 * Checks for effects like Anointed Procession, Doubling Season, Parallel Lives, etc.
 */
function getTokenDoublerMultiplier(controller: PlayerID, state: any): number {
  let multiplier = 1;
  const battlefield = state.battlefield || [];
  
  for (const perm of battlefield) {
    if (perm.controller !== controller) continue;
    const permName = (perm.card?.name || '').toLowerCase();
    const permOracle = (perm.card?.oracle_text || '').toLowerCase();
    
    // Anointed Procession: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
    // Parallel Lives: "If an effect would create one or more creature tokens under your control, it creates twice that many of those tokens instead."
    // Doubling Season: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead."
    // Mondrak, Glory Dominus: Same effect
    // Primal Vigor: Affects all players but still doubles tokens
    if (permName.includes('anointed procession') ||
        permName.includes('parallel lives') ||
        permName.includes('doubling season') ||
        permName.includes('mondrak, glory dominus') ||
        permName.includes('primal vigor') ||
        (permOracle.includes('twice that many') && permOracle.includes('token'))) {
      multiplier *= 2;
    }
  }
  
  return multiplier;
}

/**
 * Parse token creation from spell oracle text
 * Handles patterns like:
 * - "Create two 1/1 blue Merfolk Wizard creature tokens"
 * - "Create X 2/2 green Wolf creature tokens"
 * - "Create a 3/3 green Beast creature token"
 * 
 * For cards like Summon the School that have conditions (e.g., "equal to the number of Merfolk you control"),
 * we count the relevant permanents on the battlefield.
 * 
 * @param xValue - Optional value of X for X spells like Secure the Wastes
 */
function parseTokenCreation(cardName: string, oracleTextLower: string, controller: PlayerID, state: any, xValue?: number): TokenSpec | null {
  // Skip if this doesn't create tokens for the caster
  if (!oracleTextLower.includes('create') || !oracleTextLower.includes('token')) {
    return null;
  }
  
  // Skip "its controller creates" patterns (handled separately for spells like Beast Within)
  if (oracleTextLower.includes('its controller creates')) {
    return null;
  }
  
  const nameLower = (cardName || '').toLowerCase();
  
  // Special handling for known cards
  // Summon the School: "Create two 1/1 blue Merfolk Wizard creature tokens."
  // (The tap four Merfolk ability is a separate activated ability to return it from graveyard)
  if (nameLower.includes('summon the school')) {
    // Base count is 2 tokens, multiplied by token doublers
    const count = 2 * getTokenDoublerMultiplier(controller, state);
    
    return {
      count,
      power: 1,
      toughness: 1,
      name: 'Merfolk Wizard',
      typeLine: 'Token Creature — Merfolk Wizard',
      colors: ['blue'],
    };
  }
  
  // Generic token creation parsing
  // Pattern: "create (a|one|two|three|four|five|X|number) P/T [color] [type] creature token(s)"
  const tokenPatterns = [
    // "create two 1/1 blue Merfolk Wizard creature tokens"
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+(?:\s+\w+)*)\s+creature\s+tokens?/i,
    // "create a 3/3 green Beast creature token"
    /create\s+(a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+(\d+)\/(\d+)\s+(\w+)\s+(\w+)\s+creature\s+tokens?/i,
  ];
  
  for (const pattern of tokenPatterns) {
    const match = oracleTextLower.match(pattern);
    if (match) {
      const countWord = match[1].toLowerCase();
      let count = 1;
      
      // Parse count word
      const wordToNumber: Record<string, number> = {
        'a': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
        'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
      };
      
      if (wordToNumber[countWord]) {
        count = wordToNumber[countWord];
      } else if (/^\d+$/.test(countWord)) {
        count = parseInt(countWord, 10);
      } else if (countWord === 'x') {
        // Use the provided xValue from the spell cast, default to 1 if not provided
        count = xValue !== undefined && xValue >= 0 ? xValue : 1;
      }
      
      // Apply token doublers
      count *= getTokenDoublerMultiplier(controller, state);
      
      const power = parseInt(match[2], 10);
      const toughness = parseInt(match[3], 10);
      const typeInfo = match[4]; // Could be "blue Merfolk Wizard" or just "Beast"
      
      // Extract color and creature type from typeInfo
      const colors = ['white', 'blue', 'black', 'red', 'green'];
      const foundColors: string[] = [];
      let creatureType = typeInfo;
      
      for (const color of colors) {
        if (typeInfo.toLowerCase().includes(color)) {
          foundColors.push(color);
          creatureType = creatureType.replace(new RegExp(color, 'gi'), '').trim();
        }
      }
      
      // Also check for colorless
      if (typeInfo.toLowerCase().includes('colorless')) {
        creatureType = creatureType.replace(/colorless/gi, '').trim();
      }
      
      return {
        count,
        power,
        toughness,
        name: creatureType || 'Token',
        typeLine: `Token Creature — ${creatureType || 'Token'}`,
        colors: foundColors.length > 0 ? foundColors : undefined,
      };
    }
  }
  
  return null;
}

/**
 * Create a token from a TokenSpec
 */
function createTokenFromSpec(ctx: GameContext, controller: PlayerID, spec: TokenSpec): void {
  const { state, bumpSeq } = ctx;
  
  state.battlefield = state.battlefield || [];
  const tokenId = uid("token");
  
  // Get token image URLs from the token service
  const imageUrls = getTokenImageUrls(spec.name, spec.power, spec.toughness, spec.colors);
  
  state.battlefield.push({
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: spec.power,
    baseToughness: spec.toughness,
    summoningSickness: true,
    isToken: true,
    card: {
      id: tokenId,
      name: spec.name,
      type_line: spec.typeLine,
      power: String(spec.power),
      toughness: String(spec.toughness),
      zone: "battlefield",
      colors: spec.colors,
      image_uris: imageUrls,
    },
  } as any);
}

/**
 * Create a Treasure token on the battlefield
 * Treasure tokens have: "{T}, Sacrifice this artifact: Add one mana of any color."
 */
function createTreasureToken(ctx: GameContext, controller: PlayerID): void {
  const { state } = ctx;
  
  state.battlefield = state.battlefield || [];
  const tokenId = uid("treasure");
  
  // Get token image URLs from the token service
  const imageUrls = getTokenImageUrls("Treasure");
  
  state.battlefield.push({
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    isToken: true,
    card: {
      id: tokenId,
      name: "Treasure",
      type_line: "Token Artifact — Treasure",
      oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color.",
      zone: "battlefield",
      colors: [],
      image_uris: imageUrls,
    },
  } as any);
}

/* Place a land onto the battlefield for a player (simplified) */
export function playLand(ctx: GameContext, playerId: PlayerID, cardOrId: any) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the battlefield (idempotency for replay)
  if (cardId && Array.isArray(state.battlefield)) {
    const alreadyOnBattlefield = state.battlefield.some(
      (p: any) => p?.card?.id === cardId && p?.controller === playerId
    );
    if (alreadyOnBattlefield) {
      console.info(`playLand: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
      return;
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      console.warn(`playLand: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      console.warn(`playLand: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c.id === cardOrId);
    if (idx === -1) {
      // During replay, card might not be in hand anymore - this is okay
      console.info(`playLand: card ${cardOrId} not found in hand for player ${playerId} (may be replay)`);
      return;
    }
    // Remove card from hand
    card = handCards.splice(idx, 1)[0];
    z.handCount = handCards.length;
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      console.warn(`playLand: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }
  }
  
  const tl = (card.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const isLand = /\bland\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  
  // Check if the permanent has haste from any source (own text or battlefield effects)
  // Rule 702.10: Haste allows ignoring summoning sickness
  const battlefield = state.battlefield || [];
  const hasHaste = isCreature && creatureWillHaveHaste(card, playerId, battlefield);
  
  // Rule 302.6: Summoning sickness applies to CREATURES (including creature lands like Dryad Arbor)
  // - A pure land (not a creature) does NOT have summoning sickness
  // - A "Land Creature" like Dryad Arbor DOES have summoning sickness because it's a creature
  // - If a land becomes a creature later (via animation), it would need to be checked at that time
  const hasSummoningSickness = isCreature && !hasHaste;
  
  // Check if land enters tapped based on oracle text
  // This handles lands like Emeria, the Sky Ruin, Temples, Guildgates, etc.
  const oracleText = card.oracle_text || '';
  const etbTappedStatus = detectETBTappedPattern(oracleText);
  
  let shouldEnterTapped = false;
  
  if (isLand) {
    if (etbTappedStatus === 'always') {
      // Unconditional ETB tapped (temples, guildgates, etc.)
      shouldEnterTapped = true;
      console.log(`[playLand] ${card.name || 'Land'} enters tapped (ETB-tapped pattern detected)`);
    } else if (etbTappedStatus === 'conditional') {
      // Conditional ETB tapped - evaluate based on board state
      // Count other lands controlled by this player
      const otherLandCount = battlefield.filter((p: any) => {
        if (p.controller !== playerId) return false;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        return typeLine.includes('land');
      }).length;
      
      // Count BASIC lands specifically for battle lands (BFZ tango lands)
      // Also track land subtypes for check lands
      const controlledLandTypes: string[] = [];
      let basicLandCount = 0;
      for (const p of battlefield) {
        if (p.controller !== playerId) continue;
        const typeLine = (p.card?.type_line || '').toLowerCase();
        
        // Check if this is a basic land (has "basic" in the type line)
        if (typeLine.includes('basic')) {
          basicLandCount++;
        }
        
        const subtypes = getLandSubtypes(typeLine);
        controlledLandTypes.push(...subtypes);
      }
      
      // Check oracle text for the specific conditional pattern
      const oracleTextLower = oracleText.toLowerCase();
      const hasBattleLandPattern = oracleTextLower.includes('two or more basic lands');
      
      // Count opponents (other players in the game, excluding the current player)
      const allPlayers = state.players || [];
      const opponentCount = allPlayers.filter((p: any) => p.id !== playerId).length;
      
      if (hasBattleLandPattern) {
        // Battle land (BFZ tango land) - check basic land count
        shouldEnterTapped = basicLandCount < 2;
        console.log(`[playLand] ${card.name || 'Land'} battle land check: ${basicLandCount} basic lands - enters ${shouldEnterTapped ? 'tapped' : 'untapped'}`);
      } else {
        // Use general conditional evaluation for check lands, fast lands, slow lands, etc.
        const evaluation = evaluateConditionalLandETB(
          oracleText,
          otherLandCount,
          controlledLandTypes,
          undefined,  // cardsInHand - not needed for these land types
          basicLandCount,  // Pass basic land count for battle lands if they reach this code path
          opponentCount    // Pass opponent count for Luxury Suite and similar lands
        );
        shouldEnterTapped = evaluation.shouldEnterTapped;
        console.log(`[playLand] ${card.name || 'Land'} conditional ETB: ${evaluation.reason}`);
      }
    }
  }
  
  state.battlefield = state.battlefield || [];
  state.battlefield.push({
    id: uid("perm"),
    controller: playerId,
    owner: playerId,
    tapped: shouldEnterTapped,  // ETB tapped lands enter tapped
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: "battlefield" },
  } as any);
  state.landsPlayedThisTurn = state.landsPlayedThisTurn || {};
  state.landsPlayedThisTurn[playerId] = (state.landsPlayedThisTurn[playerId] ?? 0) + 1;
  
  // Check for ETB triggers on the land (e.g., Wind-Scarred Crag "you gain 1 life")
  // Get the newly created permanent from the battlefield
  const newPermanent = state.battlefield[state.battlefield.length - 1];
  try {
    const etbTriggers = getETBTriggersForPermanent(card, newPermanent);
    
    if (etbTriggers.length > 0) {
      console.log(`[playLand] Found ${etbTriggers.length} ETB trigger(s) for ${card.name || 'land'}`);
      
      // Put ETB triggers on the stack
      state.stack = state.stack || [];
      for (const trigger of etbTriggers) {
        // Skip "sacrifice unless pay" triggers - those are handled separately via prompts
        if (trigger.triggerType === 'etb_sacrifice_unless_pay') {
          continue;
        }
        
        // Push trigger onto the stack
        state.stack.push({
          id: uid("trigger"),
          type: 'etb-trigger',
          controller: playerId,
          card: { id: card.id, name: card.name || 'Land', oracle_text: card.oracle_text || '' },
          trigger: {
            type: trigger.triggerType,
            description: trigger.description || trigger.effect || '',
            sourcePermanentId: newPermanent.id,
            sourceCardName: card.name || 'Land',
          },
          targets: [],
        } as any);
        
        console.log(`[playLand] Pushed ETB trigger to stack: ${trigger.description || trigger.effect}`);
      }
    }
  } catch (err) {
    console.warn('[playLand] Failed to check ETB triggers:', err);
  }
  
  // ========================================================================
  // LANDFALL TRIGGERS: Check for and process landfall triggers
  // This is CRITICAL - landfall triggers should fire when a land ETBs
  // ========================================================================
  try {
    const landfallTriggers = getLandfallTriggers(ctx, playerId);
    if (landfallTriggers.length > 0) {
      console.log(`[playLand] Found ${landfallTriggers.length} landfall trigger(s) for player ${playerId}`);
      
      // Initialize stack if needed
      state.stack = state.stack || [];
      
      // Push each landfall trigger onto the stack
      for (const trigger of landfallTriggers) {
        const triggerId = uid("trigger");
        state.stack.push({
          id: triggerId,
          type: 'triggered_ability',
          controller: playerId,
          source: trigger.permanentId,
          permanentId: trigger.permanentId,
          sourceName: trigger.cardName,
          description: `Landfall - ${trigger.effect}`,
          triggerType: 'landfall',
          mandatory: trigger.mandatory,
          effect: trigger.effect,
          requiresChoice: trigger.requiresChoice,
        } as any);
        console.log(`[playLand] ⚡ Pushed landfall trigger onto stack: ${trigger.cardName} - ${trigger.effect}`);
      }
    }
  } catch (err) {
    console.warn('[playLand] Failed to process landfall triggers:', err);
  }
  
  // Recalculate player effects when lands ETB (some lands might have effects)
  try {
    recalculatePlayerEffects(ctx);
  } catch (err) {
    console.warn('[playLand] Failed to recalculate player effects:', err);
  }
  
  bumpSeq();
}

/**
 * Cast a spell from hand onto the stack.
 * 
 * @param ctx - Game context
 * @param playerId - Player casting the spell
 * @param cardOrId - Either a card ID string or a card object
 * @param targets - Optional array of target IDs
 */
export function castSpell(
  ctx: GameContext, 
  playerId: PlayerID, 
  cardOrId: any,
  targets?: any[]
) {
  const { state, bumpSeq } = ctx;
  const zones = state.zones = state.zones || {};
  
  // Handle both card object and cardId string
  let card: any;
  const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
  
  // Check if this card is already on the stack or battlefield (idempotency for replay)
  if (cardId) {
    if (Array.isArray(state.stack)) {
      const alreadyOnStack = state.stack.some(
        (s: any) => s?.card?.id === cardId && s?.controller === playerId
      );
      if (alreadyOnStack) {
        console.info(`castSpell: card ${cardId} already on stack for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
    if (Array.isArray(state.battlefield)) {
      const alreadyOnBattlefield = state.battlefield.some(
        (p: any) => p?.card?.id === cardId && p?.controller === playerId
      );
      if (alreadyOnBattlefield) {
        console.info(`castSpell: card ${cardId} already on battlefield for ${playerId}, skipping (replay idempotency)`);
        return;
      }
    }
  }
  
  if (typeof cardOrId === 'string') {
    // Find card in player's hand
    const z = zones[playerId];
    if (!z) {
      console.warn(`castSpell: no zone found for player ${playerId}`);
      return;
    }
    if (!Array.isArray(z.hand)) {
      console.warn(`castSpell: hand is not an array for player ${playerId} (type: ${typeof z.hand})`);
      return;
    }
    const handCards = z.hand as any[];
    const idx = handCards.findIndex((c: any) => c.id === cardOrId);
    if (idx === -1) {
      // During replay, card might not be in hand anymore - this is okay
      console.info(`castSpell: card ${cardOrId} not found in hand for player ${playerId} (may be replay)`);
      return;
    }
    // Remove card from hand
    card = handCards.splice(idx, 1)[0];
    z.handCount = handCards.length;
  } else {
    // Card object passed directly (legacy or event replay)
    card = cardOrId;
    if (!card) {
      console.warn(`castSpell: card is null or undefined for player ${playerId}`);
      return;
    }
    // Try to remove from hand if it exists there
    const z = zones[playerId];
    if (z && Array.isArray(z.hand)) {
      const handCards = z.hand as any[];
      const idx = handCards.findIndex((c: any) => c && c.id === card.id);
      if (idx !== -1) {
        handCards.splice(idx, 1);
        z.handCount = handCards.length;
      }
    }
  }
  
  // Build target details for display
  const targetDetails: Array<{ id: string; type: 'permanent' | 'player'; name?: string; controllerId?: string; controllerName?: string }> = [];
  if (targets && targets.length > 0) {
    for (const target of targets) {
      const targetId = typeof target === 'string' ? target : target.id;
      const targetKind = typeof target === 'object' ? target.kind : undefined;
      
      if (targetKind === 'player') {
        // Find player name
        const player = (state.players || []).find((p: any) => p.id === targetId);
        targetDetails.push({
          id: targetId,
          type: 'player',
          name: player?.name || targetId,
        });
      } else {
        // Find permanent name and controller
        const perm = (state.battlefield || []).find((p: any) => p.id === targetId);
        // Try to get name from multiple sources (card.name, card_faces[0].name for DFCs)
        let permName = perm?.card?.name;
        if (!permName && (perm?.card as any)?.card_faces?.[0]?.name) {
          permName = (perm.card as any).card_faces[0].name;
        }
        // Don't use ID as fallback name - leave it undefined so client can try to look up
        const controllerId = perm?.controller;
        const controllerPlayer = controllerId ? (state.players || []).find((p: any) => p.id === controllerId) : undefined;
        targetDetails.push({
          id: targetId,
          type: 'permanent',
          name: permName,
          controllerId: controllerId,
          controllerName: controllerPlayer?.name,
        });
      }
    }
  }
  
  // Add to stack
  const stackItem: any = {
    id: uid("stack"),
    controller: playerId,
    card: { ...card, zone: "stack" },
    targets: targets || [],
    targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
  };
  
  // Include selected modes if this is a modal spell (for stack display)
  // This allows players to see which mode was chosen (e.g., flicker vs destroy for Getaway Glamer)
  if (card.selectedModes && Array.isArray(card.selectedModes)) {
    stackItem.selectedModes = card.selectedModes;
    
    // Also extract mode descriptions for display
    const oracleText = card.oracle_text || '';
    const modeOptionsMatch = oracleText.toLowerCase().match(/(?:choose\s+(?:one|two|three|four|any number)\s*(?:—|[-]))\s*((?:•[^•]+)+)/i);
    if (modeOptionsMatch) {
      const bullets = modeOptionsMatch[1].split('•').filter((s: string) => s.trim().length > 0);
      stackItem.selectedModeDescriptions = card.selectedModes.map((modeId: string) => {
        const modeNum = parseInt(modeId.replace('mode_', ''), 10);
        if (bullets[modeNum - 1]) {
          return bullets[modeNum - 1].trim();
        }
        return `Mode ${modeNum}`;
      });
    }
  }
  
  // Include selected spree modes if this is a spree spell
  if (card.selectedSpreeModes && Array.isArray(card.selectedSpreeModes)) {
    stackItem.selectedSpreeModes = card.selectedSpreeModes;
  }
  
  state.stack = state.stack || [];
  state.stack.push(stackItem as any);
  bumpSeq();
}

/**
 * Exile the entire stack to players' exile zones.
 *
 * Behavior:
 * - Moves all items from state.stack into each item's controller exile array under ctx.state.zones[controller].exile.
 * - Ensures ctx.state.zones[controller] exists and has exile array.
 * - Returns the number of items exiled.
 * - Bumps seq on success.
 *
 * Notes:
 * - This is intended for effects like Sundial of the Infinite. Caller should ensure correct timing/permissions.
 * - If no stack present it returns 0.
 */
export function exileEntireStack(ctx: GameContext, invokedBy?: PlayerID): number {
  const s = ctx.state;
  if (!s || !Array.isArray(s.stack) || s.stack.length === 0) return 0;

  try {
    const zones = s.zones = s.zones || {};
    const moved = s.stack.splice(0, s.stack.length);
    let count = 0;
    for (const item of moved) {
      const controller = (item && (item.controller as PlayerID)) || invokedBy || "unknown";
      // Ensure zones shape exists
      (zones[controller] as any) = (zones[controller] as any) || {
        hand: [],
        handCount: 0,
        libraryCount: ctx.libraries.get(controller)?.length ?? 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      };
      const z = (zones[controller] as any);
      z.exile = z.exile || [];
      // Normalize card record pushed to exile
      if (item.card && typeof item.card === "object") {
        const cardObj = { ...(item.card as any), zone: "exile" };
        z.exile.push(cardObj);
      } else {
        z.exile.push({ id: item.id || uid("ex"), name: item.card?.name || "exiled_effect", zone: "exile" });
      }
      count++;
    }

    // Update counts for all affected players
    for (const pid of Object.keys(zones)) {
      const z = (zones as any)[pid];
      if (z) {
        z.graveyardCount = (z.graveyard || []).length;
        z.libraryCount = (ctx.libraries.get(pid) || []).length;
      }
    }

    ctx.bumpSeq();
    return count;
  } catch (err) {
    console.warn("exileEntireStack failed:", err);
    return 0;
  }
}