/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: checkShouldTapLandsForManaRetention, executeAITapLandsForMana.
 *
 * Public entry symbols: checkShouldTapLandsForManaRetention, executeAITapLandsForMana.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { isPowerScaledGreenManaAbilityText } from "../../../../rules-engine/src/aiEngineManaPoolSupport.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { ensureGame } from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import {
  getManaProduction,
  hasCreatureSummoningSickness,
  hasManaAbility,
} from "./aiManaCostHelpers.js";
import { selectAIManaRetentionActivationAction } from "./aiManaActivationHelpers.js";
import { permanentCannotActivateTapAbilities } from "../../state/modules/staticEffectSpecActivationLocks.js";

async function executeAIActivateAbility(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  action: any,
  continueAfterResolution = true,
): Promise<boolean> {
  return getAIHandlerDeps().executeAIActivateAbility(io, gameId, playerId, action, continueAfterResolution);
}

/**
 * Check if AI should tap lands for mana due to mana retention effects
 * Returns { shouldTap: boolean, reason: string }
 */
export function checkShouldTapLandsForManaRetention(game: any, playerId: PlayerID): { shouldTap: boolean; reason: string } {
  const battlefield = game.state?.battlefield || [];
  const turnNumber = game.state?.turnNumber || 0;
  
  // Check if we already tapped lands for mana retention this turn
  // This prevents infinite loops where AI keeps tapping lands repeatedly
  const aiManaRetentionTaps = game.state?.aiManaRetentionTaps || {};
  const lastTapTurn = aiManaRetentionTaps[playerId] || -1;
  
  if (lastTapTurn === turnNumber) {
    return { shouldTap: false, reason: 'Already tapped lands for mana retention this turn' };
  }
  
  // Check for mana retention effects
  let hasGreenRetention = false;
  let hasRedRetention = false;
  let hasAllRetention = false;
  let hasColorlessConversion = false;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || '').toLowerCase();
    const oracleText = (perm.card?.oracle_text || '').toLowerCase();
    
    // Omnath, Locus of Mana - Green mana doesn't empty
    // Oracle text: "You don't lose unspent green mana as steps and phases end."
    // Handle different apostrophe styles and text variations
    if (cardName.includes('omnath, locus of mana') || 
        (oracleText.includes('green mana') && 
         (oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty") ||
          oracleText.includes("don't lose") || oracleText.includes("don't lose")))) {
      hasGreenRetention = true;
    }
    
    // Leyline Tyrant - Red mana doesn't empty
    // Oracle text: "You don't lose unspent red mana as steps and phases end."
    // Handle different apostrophe styles and text variations
    if (cardName.includes('leyline tyrant') ||
        (oracleText.includes('red mana') && 
         (oracleText.includes("don't lose") || oracleText.includes("don't lose") ||
          oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty")))) {
      hasRedRetention = true;
    }
    
    // Kruphix, God of Horizons / Horizon Stone - Unspent mana becomes colorless
    if (cardName.includes('kruphix') || cardName.includes('horizon stone') ||
        oracleText.includes('mana becomes colorless instead')) {
      hasColorlessConversion = true;
    }
    
    // Upwelling - All mana doesn't empty
    // Handle different apostrophe styles (straight ' vs curly ')
    if (cardName.includes('upwelling') ||
        (oracleText.includes('mana pools') && 
         (oracleText.includes("don't empty") || oracleText.includes("don't empty")))) {
      hasAllRetention = true;
    }
  }
  
  // If no retention effects, don't tap lands
  if (!hasGreenRetention && !hasRedRetention && !hasColorlessConversion && !hasAllRetention) {
    return { shouldTap: false, reason: 'No mana retention effects' };
  }
  
  // Check if we have untapped lands that could produce the retained colors
  let hasUntappedRetainableLands = false;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId || perm.tapped) continue;
    
    // Check if this is a land or mana source
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('land') && !hasManaAbility(perm.card)) continue;
    
    // Skip creatures with summoning sickness
    if (typeLine.includes('creature') && hasCreatureSummoningSickness(perm)) continue;
    if (permanentCannotActivateTapAbilities(perm, game.state)) continue;
    
    // Check what colors this produces
    let producedColors = getManaProduction(perm.card);
    
    // Special handling for Exotic Orchard / Fellwar Stone
    if (producedColors.length === 0) {
      const cardName = (perm.card?.name || '').toLowerCase();
      const oracleText = (perm.card?.oracle_text || '').toLowerCase();
      
      if ((cardName.includes('exotic orchard') || cardName.includes('fellwar stone')) &&
          oracleText.includes('land an opponent controls')) {
        const opponentColors = new Set<string>();
        
        for (const opponentPerm of battlefield) {
          if (!opponentPerm || opponentPerm.controller === playerId) continue;
          
          const opponentTypeLine = (opponentPerm.card?.type_line || '').toLowerCase();
          if (!opponentTypeLine.includes('land')) continue;
          
          const opponentLandColors = getManaProduction(opponentPerm.card);
          if (opponentLandColors.length === 0) continue;
          
          opponentLandColors.forEach(c => opponentColors.add(c));
        }
        
        producedColors = Array.from(opponentColors);
      }
    }
    
    // Check if any produced color is retained
    for (const color of producedColors) {
      if (hasAllRetention) {
        hasUntappedRetainableLands = true;
        break;
      }
      if (hasGreenRetention && color === 'G') {
        hasUntappedRetainableLands = true;
        break;
      }
      if (hasRedRetention && color === 'R') {
        hasUntappedRetainableLands = true;
        break;
      }
      if (hasColorlessConversion) {
        // Any color can be converted to colorless
        hasUntappedRetainableLands = true;
        break;
      }
    }
    
    if (hasUntappedRetainableLands) break;
  }
  
  if (!hasUntappedRetainableLands) {
    return { shouldTap: false, reason: 'No untapped lands producing retained colors' };
  }
  
  // We have retention effects and untapped lands - tap them!
  let reason = 'Tapping lands for ';
  const reasons = [];
  if (hasGreenRetention) reasons.push('Omnath/green retention');
  if (hasRedRetention) reasons.push('Leyline Tyrant/red retention');
  if (hasColorlessConversion) reasons.push('Kruphix/colorless conversion');
  if (hasAllRetention) reasons.push('Upwelling/all retention');
  reason += reasons.join(', ');
  
  return { shouldTap: true, reason };
}

/**
 * Execute AI tapping lands for mana (when mana retention effects are present)
 * Retained mana stays in the pool until spent, so tap every eligible source — holding
 * lands untapped only delays Omnath-style growth without preserving instant flexibility.
 * Returns true if lands were tapped, false if no lands were tapped or already tapped this turn.
 */
export async function executeAITapLandsForMana(
  io: Server,
  gameId: string,
  playerId: PlayerID
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;
  
  const battlefield = game.state?.battlefield || [];
  const turnNumber = game.state?.turnNumber || 0;
  
  // Detect which colors are retained
  let retainedColors = new Set<string>();
  let hasAllRetention = false;
  let hasColorlessConversion = false;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || '').toLowerCase();
    const oracleText = (perm.card?.oracle_text || '').toLowerCase();
    
    if (cardName.includes('omnath, locus of mana') || 
        (oracleText.includes('green mana') && 
         (oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty") ||
          oracleText.includes("don't lose") || oracleText.includes("don't lose")))) {
      retainedColors.add('G');
    }
    
    if (cardName.includes('leyline tyrant') ||
        (oracleText.includes('red mana') && 
         (oracleText.includes("don't lose") || oracleText.includes("don't lose") ||
          oracleText.includes("doesn't empty") || oracleText.includes("doesn't empty")))) {
      retainedColors.add('R');
    }
    
    if (cardName.includes('kruphix') || cardName.includes('horizon stone') ||
        oracleText.includes('mana becomes colorless instead')) {
      hasColorlessConversion = true;
    }
    
    if (cardName.includes('upwelling') ||
        (oracleText.includes('mana pools') && oracleText.includes("don't empty"))) {
      hasAllRetention = true;
    }
  }
  
  // Collect mana sources that produce retained colors (lands, dorks, Bighorner-style).
  const tappableLands: any[] = [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId || perm.tapped) continue;
    
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('land') && !hasManaAbility(perm.card)) continue;
    
    // Skip creatures with summoning sickness
    if (typeLine.includes('creature') && hasCreatureSummoningSickness(perm)) continue;
    if (permanentCannotActivateTapAbilities(perm, game.state)) continue;
    
    let producedColors = getManaProduction(perm.card);
    
    // Special handling for Exotic Orchard / Fellwar Stone
    if (producedColors.length === 0) {
      const cardName = (perm.card?.name || '').toLowerCase();
      const oracleText = (perm.card?.oracle_text || '').toLowerCase();
      
      if ((cardName.includes('exotic orchard') || cardName.includes('fellwar stone')) &&
          oracleText.includes('land an opponent controls')) {
        const opponentColors = new Set<string>();
        const battlefield = game.state?.battlefield || [];
        
        for (const opponentPerm of battlefield) {
          if (!opponentPerm || opponentPerm.controller === playerId) continue;
          
          const opponentTypeLine = (opponentPerm.card?.type_line || '').toLowerCase();
          if (!opponentTypeLine.includes('land')) continue;
          
          const opponentLandColors = getManaProduction(opponentPerm.card);
          if (opponentLandColors.length === 0) continue;
          
          opponentLandColors.forEach(c => opponentColors.add(c));
        }
        
        producedColors = Array.from(opponentColors);
      }
    }
    
    if (producedColors.length === 0) continue;
    
    // Check if this produces a retained color
    let shouldTap = false;
    if (hasAllRetention || hasColorlessConversion) {
      shouldTap = true;
    } else {
      for (const color of producedColors) {
        if (retainedColors.has(color)) {
          shouldTap = true;
          break;
        }
      }
    }
    
    if (shouldTap) {
      tappableLands.push({ perm, producedColors });
    }
  }
  
  // Tap fixed producers before power-scaled sources so Omnath grows first.
  tappableLands.sort((left, right) => {
    const leftOracle = String(left.perm?.card?.oracle_text || '').toLowerCase();
    const rightOracle = String(right.perm?.card?.oracle_text || '').toLowerCase();
    const leftScaled = isPowerScaledGreenManaAbilityText(leftOracle) ? 1 : 0;
    const rightScaled = isPowerScaledGreenManaAbilityText(rightOracle) ? 1 : 0;
    return leftScaled - rightScaled;
  });

  // Pool mana persists until spent — tap every land that produces a retained color.
  const landsToTap = tappableLands;

  debug(2, `[AI] Mana retention: tapping ${landsToTap.length} eligible sources (pool mana remains for instants)`);
  
  let tappedCount = 0;
  
  for (const { perm } of landsToTap) {
    const action = selectAIManaRetentionActivationAction(
      game,
      playerId,
      perm,
      retainedColors,
      hasAllRetention,
      hasColorlessConversion,
    );
    if (!action) {
      debugWarn(2, '[AI] Mana retention could not resolve a shared activation candidate:', {
        gameId,
        playerId,
        permanentId: String(perm?.id || ''),
        cardName: String(perm?.card?.name || ''),
      });
      continue;
    }

    if (await executeAIActivateAbility(io, gameId, playerId, action, false)) {
      tappedCount++;
    }
  }
  
  if (tappedCount > 0) {
    
    // Track that we tapped lands for mana retention this turn to prevent infinite loops
    if (!game.state.aiManaRetentionTaps) {
      game.state.aiManaRetentionTaps = {};
    }
    game.state.aiManaRetentionTaps[playerId] = turnNumber;

    debug(1, `[AI] Tapped ${tappedCount} lands for mana retention`);
    return true;
  }
  
  return false;
}
