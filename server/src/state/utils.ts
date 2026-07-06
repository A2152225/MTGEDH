import type { BattlefieldPermanent } from "../../../shared/src/types.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { permanentHasCreatureTypeNow } from './creatureTypeNow.js';
import { evaluateLifeGainReplacementEvent } from './modules/replacement-effects.js';
import { getContinuousPTBonusForPermanent, getContinuousPTBonusSourcesForPermanent } from './modules/staticEffectSpec.js';
import { getLibraryTopCardFromState } from './modules/game-state-effects.js';

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Word-to-number mapping for parsing oracle text.
 * Used for devotion thresholds, tap counts, and other numeric references.
 */
export const WORD_TO_NUMBER: Record<string, number> = {
  'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
  'a': 1, 'an': 1,
};

/**
 * Convert a word or digit string to a number.
 * Handles both digit strings ("5") and word numbers ("five").
 * 
 * @param str - The string to parse
 * @param defaultValue - Value to return if parsing fails (default: 1)
 * @returns The parsed number
 */
export function parseWordNumber(str: string | undefined, defaultValue: number = 1): number {
  if (!str) return defaultValue;
  const lowerStr = str.toLowerCase().trim();
  
  // Try word-to-number mapping first
  if (WORD_TO_NUMBER[lowerStr] !== undefined) {
    return WORD_TO_NUMBER[lowerStr];
  }
  
  // Try parsing as digit
  const parsed = parseInt(lowerStr, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Validate if a player can pay a specific amount of life.
 * Rule 119.4: A player can't pay more life than they have.
 * 
 * @param currentLife - Player's current life total
 * @param amount - Amount of life to pay
 * @returns true if the player can pay, false otherwise
 */
export function canPayLife(currentLife: number, amount: number): boolean {
  // You can pay life as long as you have at least that much life
  // Note: You CAN pay life that would put you at 0 (you'll lose to SBA, but the payment is legal)
  return currentLife >= amount;
}

/**
 * Compute a card's mana value, optionally incorporating a chosen X value.
 */
export function cardManaValue(card: any, chosenX?: number): number {
  if (!card) return 0;
  const manaCost: string | undefined = (card as any).mana_cost;
  let mv = typeof (card as any).cmc === 'number' ? (card as any).cmc : 0;
  
  if (mv === 0 && manaCost) {
    const symbols = manaCost.match(/\{[^}]+\}/g) || [];
    for (const sym of symbols) {
      const inner = sym.slice(1, -1).toUpperCase();
      if (inner === 'X') continue;
      if (/^\d+$/.test(inner)) {
        mv += parseInt(inner, 10);
      } else {
        mv += 1;
      }
    }
  }
  
  if (chosenX !== undefined && manaCost) {
    const xCount = (manaCost.match(/\{X\}/gi) || []).length;
    if (xCount > 0) {
      mv += chosenX * xCount;
    }
  }
  
  return mv;
}

/**
 * Get the maximum life a player can pay.
 * Useful for "pay X life" effects where X can be chosen.
 * 
 * @param currentLife - Player's current life total
 * @returns Maximum life that can be paid (their current life total)
 */
export function getMaxPayableLife(currentLife: number): number {
  return Math.max(0, currentLife);
}

/**
 * Validate life payment for a spell or ability.
 * Returns an error message if invalid, or null if valid.
 * 
 * @param currentLife - Player's current life total
 * @param amount - Amount of life to pay
 * @param cardName - Name of the card for error messages
 * @returns Error message or null if valid
 */
export function validateLifePayment(currentLife: number, amount: number, cardName?: string): string | null {
  if (amount < 0) {
    return `Cannot pay negative life`;
  }
  if (amount > currentLife) {
    return `Cannot pay ${amount} life (only have ${currentLife} life)${cardName ? ` for ${cardName}` : ''}`;
  }
  return null;
}

/**
 * Known cards with "pay X life" effects where X is chosen by the player.
 * Maps card name (lowercase) to effect details.
 */
export const PAY_X_LIFE_CARDS: Record<string, {
  effect: string;
  affectsAll?: boolean; // True for cards like Toxic Deluge that affect all creatures
  minX?: number;
  targetType?: 'creatures' | 'players' | 'any';
}> = {
  "toxic deluge": {
    effect: "All creatures get -X/-X until end of turn",
    affectsAll: true,
    minX: 0,
    targetType: 'creatures',
  },
  "aetherflux reservoir": {
    effect: "Pay 50 life: Deal 50 damage to target",
    minX: 50,
    targetType: 'any',
  },
  "bolas's citadel": {
    effect: "Pay 10 life, sacrifice 10 permanents: Each opponent loses 10 life",
    minX: 10,
    targetType: 'players',
  },
  "hatred": {
    effect: "Pay X life: Target creature gets +X/+0 until end of turn",
    minX: 0,
    targetType: 'creatures',
  },
  "unspeakable symbol": {
    effect: "Pay 3 life: Put a +1/+1 counter on target creature",
    minX: 3,
    targetType: 'creatures',
  },
  "necropotence": {
    effect: "Pay 1 life: Exile top card, put into hand at end step",
    minX: 1,
  },
  "greed": {
    effect: "Pay 2 life: Draw a card",
    minX: 2,
  },
  "erebos, god of the dead": {
    effect: "Pay 2 life: Draw a card",
    minX: 2,
  },
  "arguel's blood fast": {
    effect: "Pay 2 life: Draw a card",
    minX: 2,
  },
  "sylvan library": {
    effect: "Pay 4 life per extra card kept",
    minX: 4,
  },
  "ad nauseam": {
    effect: "Reveal cards, lose life equal to CMC, repeat",
    minX: 0,
  },
  "fire covenant": {
    effect: "Pay X life: Deal X damage divided among creatures",
    minX: 1,
    targetType: 'creatures',
  },
  "font of agonies": {
    effect: "Triggers when you pay life",
    minX: 0,
  },
  "treasonous ogre": {
    effect: "Pay 3 life: Add {R}",
    minX: 3,
  },
  "channel": {
    effect: "Pay 1 life: Add {C}{C}",
    minX: 1,
  },
  "sword of war and peace": {
    effect: "Damage equal to cards in hand, gain life equal to cards in opponent's hand",
    minX: 0,
  },
  "minion of the wastes": {
    effect: "Pay any amount of life as it enters",
    minX: 0,
  },
  "wall of blood": {
    effect: "Pay 1 life: +1/+1 until end of turn",
    minX: 1,
  },
  "immolating souleater": {
    effect: "Pay 2 life: +1/+0 until end of turn",
    minX: 2,
  },
  "moltensteel dragon": {
    effect: "Pay 2 life: +1/+0 until end of turn",
    minX: 2,
  },
};

/**
 * Check if a player's life gain is prevented by any effect on the battlefield.
 * 
 * @param gameState - The current game state
 * @param playerId - The player who would gain life
 * @returns { prevented: boolean, source?: string } - Whether life gain is prevented and by what
 */
export function checkLifeGainPrevention(
  gameState: any,
  playerId: string
): { prevented: boolean; source?: string; reversedToLoss?: boolean } {
  const result = evaluateLifeGainReplacementEvent({
    state: gameState,
    playerId,
    amount: 1,
  });

  if (result.effectId === 'life-gain-prevented') {
    return { prevented: true, source: result.sourceName };
  }

  if (result.effectId === 'life-gain-reversed-to-loss') {
    return { prevented: false, reversedToLoss: true, source: result.sourceName };
  }
  
  return { prevented: false };
}

/**
 * Apply life gain to a player, considering prevention and reversal effects.
 * Also handles "gain that much life plus X" replacement effects like Leyline of Hope.
 * 
 * @param gameState - The current game state (will be modified)
 * @param playerId - The player gaining life
 * @param amount - The amount of life to gain
 * @param source - The source of the life gain (for logging)
 * @returns { actualChange: number, message: string } - The actual life change and explanation
 */
export function applyLifeGain(
  gameState: any,
  playerId: string,
  amount: number,
  source?: string
): { actualChange: number; message: string } {
  if (amount <= 0) {
    return { actualChange: 0, message: 'No life to gain' };
  }
  
  const check = checkLifeGainPrevention(gameState, playerId);
  
  if (check.prevented) {
    return { 
      actualChange: 0, 
      message: `Life gain prevented by ${check.source}` 
    };
  }
  
  if (check.reversedToLoss) {
    // Reverse the life gain to life loss
    const startingLife = gameState?.startingLife || 40;
    const currentLife = gameState?.life?.[playerId] ?? startingLife;
    
    if (!gameState.life) gameState.life = {};
    gameState.life[playerId] = currentLife - amount;
    
    // Sync to player object
    const player = (gameState.players || []).find((p: any) => p.id === playerId);
    if (player) {
      player.life = gameState.life[playerId];
    }

    // Track life lost this turn.
    try {
      gameState.lifeLostThisTurn = gameState.lifeLostThisTurn || {};
      gameState.lifeLostThisTurn[playerId] = (gameState.lifeLostThisTurn[playerId] || 0) + amount;
    } catch {}
    
    return { 
      actualChange: -amount, 
      message: `Life gain reversed to ${amount} life loss by ${check.source}` 
    };
  }
  
  // Check for replacement effects that modify the amount of life gained
  // Uses optimal ordering: +1 effects first, then doublers
  // This maximizes life gained: (X + 1) * 2 > (X * 2) + 1
  let modifiedAmount = amount;
  const appliedReplacements: string[] = [];
  
  // Get +1 modifiers (Leyline of Hope, Angel of Vitality)
  const lifeGainModifiers = checkLifeGainModifiers(gameState, playerId);
  if (lifeGainModifiers.extraLife > 0) {
    modifiedAmount += lifeGainModifiers.extraLife;
    appliedReplacements.push(...lifeGainModifiers.sources.map(s => `${s}: +${lifeGainModifiers.extraLife}`));
  }
  
  // Check for doublers (Boon Reflection, Rhox Faithmender, Alhammarret's Archive)
  // Apply AFTER +1 effects to maximize life gained
  const lifeGainDoublers = checkLifeGainDoublers(gameState, playerId);
  if (lifeGainDoublers.multiplier > 1) {
    modifiedAmount *= lifeGainDoublers.multiplier;
    appliedReplacements.push(...lifeGainDoublers.sources.map(s => `${s}: x${lifeGainDoublers.multiplier}`));
  }
  
  if (appliedReplacements.length > 0) {
    debug(1, `[applyLifeGain] Life gain modified by replacements: ${amount} -> ${modifiedAmount} (${appliedReplacements.join(', ')})`);
  }
  
  // Normal life gain (with modifiers applied)
  const startingLife = gameState?.startingLife || 40;
  const currentLife = gameState?.life?.[playerId] ?? startingLife;
  
  if (!gameState.life) gameState.life = {};
  gameState.life[playerId] = currentLife + modifiedAmount;

  // Track life gained this turn.
  try {
    gameState.lifeGainedThisTurn = gameState.lifeGainedThisTurn || {};
    gameState.lifeGainedThisTurn[playerId] = (gameState.lifeGainedThisTurn[playerId] || 0) + modifiedAmount;
  } catch {}
  
  // Sync to player object
  const player = (gameState.players || []).find((p: any) => p.id === playerId);
  if (player) {
    player.life = gameState.life[playerId];
  }
  
  // Trigger "whenever you gain life" effects (Ajani's Pridemate, Sanguine Bond, etc.)
  try {
    const lifeGainTriggers = triggerLifeGainEffects(gameState, playerId, modifiedAmount);
    if (lifeGainTriggers.length > 0) {
      debug(2, `[applyLifeGain] Triggered ${lifeGainTriggers.length} life gain effect(s)`);
    }
  } catch (err) {
    debugWarn(1, '[applyLifeGain] Error triggering life gain effects:', err);
  }
  
  if (appliedReplacements.length > 0) {
    return { 
      actualChange: modifiedAmount, 
      message: source 
        ? `Gained ${modifiedAmount} life from ${source} (${amount} modified by ${appliedReplacements.join(', ')})`
        : `Gained ${modifiedAmount} life (${amount} modified by ${appliedReplacements.join(', ')})` 
    };
  }
  
  return { 
    actualChange: modifiedAmount, 
    message: source ? `Gained ${modifiedAmount} life from ${source}` : `Gained ${modifiedAmount} life` 
  };
}

/**
 * Check for life gain modifier effects on the battlefield.
 * These are replacement effects that increase the amount of life gained.
 * 
 * @param gameState - The current game state
 * @param playerId - The player who would gain life
 * @returns { extraLife: number, sources: string[] } - Extra life to gain and sources
 */
function checkLifeGainModifiers(
  gameState: any,
  playerId: string
): { extraLife: number; sources: string[] } {
  const battlefield = gameState?.battlefield || [];
  let extraLife = 0;
  const sources: string[] = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== playerId) continue; // Most of these only affect controller
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Leyline of Hope: "If you would gain life, you gain that much life plus 1 instead."
    if (cardName.includes('leyline of hope') || 
        (oracleText.includes('would gain life') && oracleText.includes('that much life plus 1'))) {
      extraLife += 1;
      sources.push(perm.card.name || 'Leyline of Hope');
    }
    
    // Rhox Faithmender: "If you would gain life, you gain twice that much life instead."
    // (This is a doubling effect, handled differently - need separate logic)
    // For now, skip doubling effects as they require different handling
    
    // Boon Reflection: "If you would gain life, you gain twice that much life instead."
    // (Same as Rhox Faithmender - doubling effect)
    
    // Trostani Discordant: Doesn't modify life gain amount
    
    // Angel of Vitality: "If you would gain life, you gain that much life plus 1 instead."
    // Only if you have 25 or more life
    if (cardName.includes('angel of vitality') ||
        (oracleText.includes('would gain life') && oracleText.includes('25 or more life'))) {
      const currentLife = gameState?.life?.[playerId] ?? (gameState?.startingLife || 40);
      if (currentLife >= 25) {
        extraLife += 1;
        sources.push(perm.card.name || 'Angel of Vitality');
      }
    }
  }
  
  return { extraLife, sources };
}

/**
 * Check for life gain doubling effects on the battlefield.
 * These are replacement effects that double the amount of life gained.
 * Applied AFTER +1 effects to maximize life gained per MTG optimization rules.
 * 
 * @param gameState - The current game state
 * @param playerId - The player who would gain life
 * @returns { multiplier: number, sources: string[] } - Multiplier and sources
 */
function checkLifeGainDoublers(
  gameState: any,
  playerId: string
): { multiplier: number; sources: string[] } {
  const battlefield = gameState?.battlefield || [];
  let multiplier = 1;
  const sources: string[] = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== playerId) continue; // Most of these only affect controller
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Boon Reflection: "If you would gain life, you gain twice that much life instead."
    if (cardName.includes('boon reflection') ||
        (oracleText.includes('would gain life') && oracleText.includes('twice that much'))) {
      multiplier *= 2;
      sources.push(perm.card.name || 'Boon Reflection');
    }
    
    // Rhox Faithmender: "If you would gain life, you gain twice that much life instead."
    if (cardName.includes('rhox faithmender')) {
      multiplier *= 2;
      sources.push(perm.card.name || 'Rhox Faithmender');
    }
    
    // Alhammarret's Archive: "If you would gain life, you gain twice that much life instead."
    if (cardName.includes("alhammarret's archive") ||
        cardName.includes('alhammarrets archive')) {
      multiplier *= 2;
      sources.push(perm.card.name || "Alhammarret's Archive");
    }
    
    // Nykthos Paragon: "Whenever you gain life, ... with that many +1/+1 counters" (not a doubler)
    
    // Celestial Mantle: "Whenever enchanted creature deals combat damage, double your life total"
    // (This doubles your total, not the gain amount - different effect)
  }
  
  return { multiplier, sources };
}

/**
 * Check for and trigger "whenever you gain life" triggers on the battlefield.
 * This handles cards like:
 * - Ajani's Pridemate: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate."
 * - Aerith Gainsborough: "Whenever you gain life, put that many +1/+1 counters on Aerith Gainsborough."
 * - Heliod, Sun-Crowned: "Whenever you gain life, put a +1/+1 counter on target creature or enchantment you control."
 * - Bloodbond Vampire: "Whenever you gain life, put a +1/+1 counter on Bloodbond Vampire."
 * - Archangel of Thune: "Whenever you gain life, put a +1/+1 counter on each creature you control."
 * - Epicure of Blood: "Whenever you gain life, each opponent loses 1 life."
 * - Marauding Blight-Priest: "Whenever you gain life, each opponent loses 1 life."
 * - Sanguine Bond: "Whenever you gain life, target opponent loses that much life."
 * - Defiant Bloodlord: "Whenever you gain life, target opponent loses that much life."
 * - Vito, Thorn of the Dusk Rose: "Whenever you gain life, target opponent loses that much life."
 * 
 * @param gameState - The current game state (will be modified for counter additions)
 * @param playerId - The player who gained life
 * @param amountGained - The amount of life gained
 * @returns Array of triggered effects that occurred
 */
export function triggerLifeGainEffects(
  gameState: any,
  playerId: string,
  amountGained: number
): { permanent: string; effect: string }[] {
  if (amountGained <= 0) return [];
  
  const triggered: { permanent: string; effect: string }[] = [];
  const battlefield = gameState?.battlefield || [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== playerId) continue; // Life gain triggers usually affect controller's permanents
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Check for "whenever you gain life" patterns
    if (!oracleText.includes('whenever you gain life')) continue;
    
    // Extract just the lifegain trigger sentence to avoid confusion with other abilities
    // Match "Whenever you gain life, [effect]" up to the period or newline
    const lifegainMatch = oracleText.match(/whenever you gain life,?\s*([^.\n]+)/i);
    const lifegainEffect = lifegainMatch ? lifegainMatch[1].toLowerCase() : '';
    
    // Ajani's Pridemate, Bloodbond Vampire, MJ Rising Star, Voice of the Blessed, etc.: Put a +1/+1 counter on this creature
    // Pattern: "Whenever you gain life, put a +1/+1 counter on ~" or "...on this creature"
    // This should match any card with "whenever you gain life" + "put a +1/+1 counter" where the counter goes on itself
    // Common patterns:
    // - "put a +1/+1 counter on ~" (using ~ to reference card name)
    // - "put a +1/+1 counter on [card name]" or "[card nickname]" (e.g., "on MJ" for "MJ, Rising Star")
    // - "put a +1/+1 counter on this creature"
    // We detect this by checking if the LIFEGAIN EFFECT mentions putting a counter but NOT "on each" (that's Archangel of Thune)
    // and NOT "that many" (that's Aerith/Sunbond style) - check only the lifegain effect, not the whole oracle text
    const putsSingleCounter = lifegainEffect.includes('put a +1/+1 counter on') && 
                              !lifegainEffect.includes('on each') && 
                              !lifegainEffect.includes('that many');
    
    // Check if the oracle text references the card's name or nickname
    // Cards often use their first name/word as a reference (e.g., "MJ" for "MJ, Rising Star")
    // or the full name, or "~" symbol
    const cardNameParts = cardName.split(/[,\s]+/).filter(p => p.length > 0);
    const firstName = cardNameParts[0] || '';
    const oracleReferencesCardName = 
      lifegainEffect.includes(`on ${cardName}`) ||  // Full name match
      (firstName.length > 1 && lifegainEffect.includes(`on ${firstName}`)) ||  // First name/nickname match (e.g., "on mj")
      lifegainEffect.includes('on ~');  // Tilde symbol reference
    
    // Check if the counter goes on this permanent (not another target)
    // It goes on self if:
    // - Text contains "on ~" (card name reference)
    // - Text contains the card's own name (or nickname) after "counter on"
    // - Text doesn't require choosing a target (no "target creature")
    // - OR it's a known card name (pridemate patterns)
    const counterGoesOnSelf = putsSingleCounter && (
      oracleReferencesCardName ||
      lifegainEffect.includes('on this') ||
      cardName.includes('pridemate') ||
      cardName.includes('bloodbond') ||
      cardName.includes('rising star') ||  // MJ, Rising Star
      cardName.includes('voice of the blessed') ||
      cardName.includes('celestial unicorn') ||
      cardName.includes('trelasarra') ||
      cardName.includes('aerith gainsborough') ||  // Aerith Gainsborough
      // Generic check: if it says "put a +1/+1 counter on" without saying "target", it likely goes on itself
      (!lifegainEffect.includes('target creature') && !lifegainEffect.includes('target enchantment'))
    );
    
    if (counterGoesOnSelf) {
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      triggered.push({ 
        permanent: perm.card.name || perm.id, 
        effect: `Added +1/+1 counter (${perm.counters['+1/+1']} total)` 
      });
      debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} gained a +1/+1 counter from life gain`);
      continue; // Don't double-trigger
    }
    
    // Aerith Gainsborough, Light of Promise/Sunbond: Put THAT MANY +1/+1 counters
    // Pattern: "put that many +1/+1 counters on ~"
    if (oracleText.includes('that many +1/+1 counters') || 
        oracleText.includes('that many') && oracleText.includes('+1/+1')) {
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + amountGained;
      triggered.push({ 
        permanent: perm.card.name || perm.id, 
        effect: `Added ${amountGained} +1/+1 counter(s) (${perm.counters['+1/+1']} total)` 
      });
      debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} gained ${amountGained} +1/+1 counter(s) from life gain`);
      continue;
    }
    
    // Archangel of Thune: Put a +1/+1 counter on EACH creature you control
    if (oracleText.includes('put a +1/+1 counter on each creature you control') ||
        cardName.includes('archangel of thune')) {
      for (const otherPerm of battlefield) {
        if (!otherPerm || otherPerm.controller !== playerId) continue;
        const typeLine = (otherPerm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        
        otherPerm.counters = otherPerm.counters || {};
        otherPerm.counters['+1/+1'] = (otherPerm.counters['+1/+1'] || 0) + 1;
      }
      triggered.push({ 
        permanent: perm.card.name || perm.id, 
        effect: 'Added +1/+1 counter to each creature you control' 
      });
      debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} added +1/+1 counters to all creatures`);
      continue;
    }
    
    // Epicure of Blood, Marauding Blight-Priest: Each opponent loses 1 life
    if ((oracleText.includes('each opponent loses 1 life') || 
         oracleText.includes('each opponent loses one life')) &&
        !oracleText.includes('that much')) {
      const players = gameState.players || [];
      for (const player of players) {
        if (player.id === playerId || player.hasLost) continue;
        const currentLife = gameState.life?.[player.id] ?? (gameState.startingLife || 40);
        gameState.life = gameState.life || {};
        gameState.life[player.id] = currentLife - 1;
        player.life = gameState.life[player.id];

        // Track life lost this turn.
        try {
          gameState.lifeLostThisTurn = gameState.lifeLostThisTurn || {};
          gameState.lifeLostThisTurn[String(player.id)] = (gameState.lifeLostThisTurn[String(player.id)] || 0) + 1;
        } catch {}
      }
      triggered.push({ 
        permanent: perm.card.name || perm.id, 
        effect: 'Each opponent lost 1 life' 
      });
      debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} caused each opponent to lose 1 life`);
      continue;
    }
    
    // Sanguine Bond, Defiant Bloodlord, Vito: Target opponent loses THAT MUCH life
    // Note: This should really be a targeted effect, but for simplicity we'll hit a random opponent
    if (oracleText.includes('target opponent loses that much life') ||
        cardName.includes('sanguine bond') || cardName.includes('vito')) {
      const players = gameState.players || [];
      const opponents = players.filter((p: any) => p.id !== playerId && !p.hasLost);
      if (opponents.length > 0) {
        const targetOpponent = opponents[0]; // In a real implementation, this would be targeted
        const currentLife = gameState.life?.[targetOpponent.id] ?? (gameState.startingLife || 40);
        gameState.life = gameState.life || {};
        gameState.life[targetOpponent.id] = currentLife - amountGained;
        targetOpponent.life = gameState.life[targetOpponent.id];

        // Track life lost this turn.
        try {
          gameState.lifeLostThisTurn = gameState.lifeLostThisTurn || {};
          gameState.lifeLostThisTurn[String(targetOpponent.id)] =
            (gameState.lifeLostThisTurn[String(targetOpponent.id)] || 0) + Number(amountGained || 0);
        } catch {}
        triggered.push({ 
          permanent: perm.card.name || perm.id, 
          effect: `Target opponent lost ${amountGained} life` 
        });
        debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} caused opponent to lose ${amountGained} life`);
      }
      continue;
    }
    
    // Heliod, Sun-Crowned: Put a +1/+1 counter on target creature or enchantment
    // Note: This should be a targeted effect, for simplicity we put it on Heliod if it's a creature
    if (cardName.includes('heliod') && oracleText.includes('put a +1/+1 counter on target creature or enchantment')) {
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (typeLine.includes('creature')) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
        triggered.push({ 
          permanent: perm.card.name || perm.id, 
          effect: `Added +1/+1 counter to self` 
        });
        debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} gained a +1/+1 counter`);
      }
    }
  }
  
  // Also check for attached auras that have life gain triggers (Light of Promise, Sunbond)
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== playerId) continue;
    
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    // Check for attached auras
    const attachedAuras = battlefield.filter((a: any) => 
      a?.attachedTo === perm.id && 
      (a.card?.type_line || '').toLowerCase().includes('aura')
    );
    
    for (const aura of attachedAuras) {
      const auraOracle = (aura.card?.oracle_text || '').toLowerCase();
      const auraName = (aura.card?.name || '').toLowerCase();
      
      // Light of Promise / Sunbond: "Whenever you gain life, put that many +1/+1 counters on enchanted creature."
      if ((auraName.includes('light of promise') || auraName.includes('sunbond') ||
           (auraOracle.includes('whenever you gain life') && auraOracle.includes('that many +1/+1 counters')))) {
        perm.counters = perm.counters || {};
        perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + amountGained;
        triggered.push({ 
          permanent: `${perm.card.name || perm.id} (via ${aura.card.name || 'Aura'})`, 
          effect: `Added ${amountGained} +1/+1 counter(s)` 
        });
        debug(2, `[triggerLifeGainEffects] ${perm.card.name || perm.id} gained ${amountGained} +1/+1 counter(s) from ${aura.card.name || 'Aura'}`);
      }
    }
  }
  
  return triggered;
}

/**
 * Parse power/toughness values from card data.
 * Handles numeric values, "*", and expressions like "*+1" or "1+*".
 * For pure "*" values, returns undefined (caller should use calculateVariablePT).
 */
export function parsePT(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  
  // If already a number, return it
  if (typeof raw === 'number') return raw;
  
  const str = String(raw).trim();
  
  // Pure numeric
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  
  // Handle X (typically 0 unless otherwise specified)
  if (str.toLowerCase() === 'x') return 0;
  
  // Pure * - caller needs to use calculateVariablePT
  if (str === '*') return undefined;
  
  // Handle expressions like *+1, 1+*, etc. - return undefined for now
  if (str.includes('*')) return undefined;
  
  return undefined;
}

/**
 * Calculate the effective P/T for creatures with variable (star slash star) power/toughness.
 * This implements the characteristic-defining abilities from card text.
 * 
 * Note: This is only for true variable P/T creatures like Tarmogoyf or Nighthowler.
 * Cards with fixed P/T (like Morophon 6/6) should have their values parsed normally.
 * 
 * Examples:
 * - Tarmogoyf: Count card types in all graveyards
 * - Nighthowler: Count creatures in graveyards
 * - Consuming Aberration: Count cards in opponents' graveyards
 * 
 * @param card - The card data with oracle_text and type information
 * @param gameState - Optional game state for dynamic calculations
 * @returns { power, toughness } or undefined if not calculable
 */
export function calculateVariablePT(
  card: any,
  gameState?: any
): { power: number; toughness: number } | undefined {
  if (!card) return undefined;
  
  const name = (card.name || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const battlefield = gameState?.battlefield || [];
  const controllerId =
    (card as any).controller ??
    battlefield.find((p: any) => p?.card?.id === card.id)?.controller ??
    battlefield.find((p: any) => p?.card === card)?.controller ??
    (card as any).owner;
  const zones = gameState?.zones || {};
  // Battlefield sizes are small here, so linear lookup remains acceptable.
  
  // Marit Lage token - Defined as 20/20
  if (name.includes('marit lage')) {
    return { power: 20, toughness: 20 };
  }
  
  // ===== SPECIFIC CARD HANDLERS =====
  
  // Psychosis Crawler - P/T equal to number of cards in controller's hand
  // Oracle text: "Psychosis Crawler's power and toughness are each equal to the number of cards in your hand."
  if (name.includes('psychosis crawler')) {
    const playerZones = zones[controllerId];
    const handCount = playerZones?.handCount ?? (playerZones?.hand || []).length ?? 0;
    return { power: handCount, toughness: handCount };
  }
  
  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  if (name.includes('omnath, locus of mana') || name.includes('omnath locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.G || manaPool.green || 0;
    // Base is 1/1, plus green mana
    return { power: 1 + greenMana, toughness: 1 + greenMana };
  }
  
  // Tarmogoyf - */* where * is the number of card types among cards in all graveyards
  if (name.includes('tarmogoyf')) {
    const cardTypes = new Set<string>();
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        const cardTypeLine = (card.type_line || '').toLowerCase();
        if (cardTypeLine.includes('creature')) cardTypes.add('creature');
        if (cardTypeLine.includes('instant')) cardTypes.add('instant');
        if (cardTypeLine.includes('sorcery')) cardTypes.add('sorcery');
        if (cardTypeLine.includes('artifact')) cardTypes.add('artifact');
        if (cardTypeLine.includes('enchantment')) cardTypes.add('enchantment');
        if (cardTypeLine.includes('planeswalker')) cardTypes.add('planeswalker');
        if (cardTypeLine.includes('land')) cardTypes.add('land');
        if (cardTypeLine.includes('tribal')) cardTypes.add('tribal');
        if (cardTypeLine.includes('kindred')) cardTypes.add('kindred');
        if (cardTypeLine.includes('battle')) cardTypes.add('battle');
      }
    }
    // Tarmogoyf is */1+* 
    return { power: cardTypes.size, toughness: cardTypes.size + 1 };
  }
  
  // Lhurgoyf - */* where power is creatures in all graveyards, toughness is 1+that
  if (name.includes('lhurgoyf') && !name.includes('mortivore')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount + 1 };
  }
  
  // Mortivore - */* where * is creatures in all graveyards
  if (name.includes('mortivore')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount };
  }
  
  // Nighthowler - */* where * is creatures in all graveyards
  if (name.includes('nighthowler')) {
    let creatureCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('creature')) {
          creatureCount++;
        }
      }
    }
    return { power: creatureCount, toughness: creatureCount };
  }
  
  // Consuming Aberration - */* where * is cards in opponents' graveyards
  if (name.includes('consuming aberration')) {
    let cardCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      if (player.id === controllerId) continue; // Skip controller
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      cardCount += graveyard.length;
    }
    return { power: cardCount, toughness: cardCount };
  }
  
  // Sewer Nemesis - */* where * is cards in chosen player's graveyard
  if (name.includes('sewer nemesis')) {
    // Assumes chosen player is stored on the card
    const chosenPlayer = card.chosenPlayer || controllerId;
    const playerZones = zones[chosenPlayer];
    const cardCount = playerZones?.graveyard?.length || 0;
    return { power: cardCount, toughness: cardCount };
  }
  
  // Bonehoard - equipped creature gets +X/+X where X is creatures in all graveyards
  // (handled in equipment bonus calculation)
  
  // Cranial Plating - equipped creature gets +X/+0 where X is artifacts you control
  // (handled in equipment calculation)
  
  // Nettlecyst - equipped creature gets +1/+1 for each artifact and enchantment you control
  // (handled in equipment calculation)
  
  // Blackblade Reforged - equipped creature gets +1/+1 for each land you control
  // (handled in equipment calculation)
  
  // Multani, Yavimaya's Avatar - */* where * is lands you control + lands in graveyard
  if (name.includes('multani, yavimaya')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    const playerZones = zones[controllerId];
    const graveyardLands = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('land')
    );
    const total = lands.length + graveyardLands.length;
    return { power: total, toughness: total };
  }
  
  // Splinterfright - */* where * is creatures in your graveyard
  if (name.includes('splinterfright')) {
    const playerZones = zones[controllerId];
    const graveyardCreatures = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('creature')
    );
    return { power: graveyardCreatures.length, toughness: graveyardCreatures.length };
  }
  
  // Boneyard Wurm - */* where * is creatures in your graveyard
  if (name.includes('boneyard wurm')) {
    const playerZones = zones[controllerId];
    const graveyardCreatures = (playerZones?.graveyard || []).filter((c: any) =>
      (c.type_line || '').toLowerCase().includes('creature')
    );
    return { power: graveyardCreatures.length, toughness: graveyardCreatures.length };
  }
  
  // Cognivore - */* where * is instants in all graveyards
  if (name.includes('cognivore')) {
    let instantCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('instant')) {
          instantCount++;
        }
      }
    }
    return { power: instantCount, toughness: instantCount };
  }
  
  // Magnivore - */* where * is sorceries in all graveyards
  if (name.includes('magnivore')) {
    let sorceryCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('sorcery')) {
          sorceryCount++;
        }
      }
    }
    return { power: sorceryCount, toughness: sorceryCount };
  }
  
  // Terravore - */* where * is lands in all graveyards
  if (name.includes('terravore')) {
    let landCount = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      const playerZones = zones[player.id];
      const graveyard = playerZones?.graveyard || [];
      for (const card of graveyard) {
        if ((card.type_line || '').toLowerCase().includes('land')) {
          landCount++;
        }
      }
    }
    return { power: landCount, toughness: landCount };
  }
  
  // Masticore variants with hand-based P/T
  // Maro - */* where * is cards in your hand
  if (name === 'maro' || name.includes('maro,')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // Molimo, Maro-Sorcerer - */* where * is lands you control
  if (name.includes('molimo')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    return { power: lands.length, toughness: lands.length };
  }
  
  // Korlash, Heir to Blackblade - */* where * is Swamps you control
  if (name.includes('korlash')) {
    const swamps = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('swamp')
    );
    return { power: swamps.length, toughness: swamps.length };
  }
  
  // Dungrove Elder - */* where * is Forests you control
  if (name.includes('dungrove elder')) {
    const forests = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('forest')
    );
    return { power: forests.length, toughness: forests.length };
  }
  
  // Dakkon Blackblade - */* where * is lands you control
  if (name.includes('dakkon blackblade')) {
    const lands = battlefield.filter((p: any) => 
      p.controller === controllerId && 
      (p.card?.type_line || '').toLowerCase().includes('land')
    );
    return { power: lands.length, toughness: lands.length };
  }
  
  // Kavu Titan - 5/5 if kicked
  if (name.includes('kavu titan') && card.wasKicked) {
    return { power: 5, toughness: 5 };
  }
  
  // Serra Avatar - */* where * is your life total
  if (name.includes('serra avatar')) {
    const life = gameState?.life?.[controllerId] ?? 40;
    return { power: life, toughness: life };
  }
  
  // Soramaro, First to Dream - */* where * is cards in hand
  if (name.includes('soramaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // Masumaro, First to Live - */* where * is cards in hand
  if (name.includes('masumaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize * 2, toughness: handSize * 2 };
  }
  
  // Adamaro, First to Desire - */* where * is cards in opponent's hand with most cards
  if (name.includes('adamaro')) {
    let maxHandSize = 0;
    const allPlayers = gameState?.players || [];
    for (const player of allPlayers) {
      if (player.id === controllerId) continue;
      const playerZones = zones[player.id];
      const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
      maxHandSize = Math.max(maxHandSize, handSize);
    }
    return { power: maxHandSize, toughness: maxHandSize };
  }
  
  // Kagemaro, First to Suffer - */* where * is cards in your hand
  if (name.includes('kagemaro')) {
    const playerZones = zones[controllerId];
    const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
    return { power: handSize, toughness: handSize };
  }
  
  // ===== GENERIC PATTERN MATCHING =====
  
  // "power and toughness are each equal to" patterns
  if (oracleText.includes('power and toughness are each equal to')) {
    
    // "number of creatures you control"
    if (oracleText.includes('number of creatures you control')) {
      const creatures = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      return { power: creatures.length, toughness: creatures.length };
    }
    
    // "number of creatures on the battlefield" (all creatures)
    if (oracleText.includes('number of creatures on the battlefield') || 
        oracleText.includes('total number of creatures')) {
      const creatures = battlefield.filter((p: any) => 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      return { power: creatures.length, toughness: creatures.length };
    }
    
    // "cards in your hand"
    if (oracleText.includes('cards in your hand')) {
      const playerZones = zones[controllerId];
      const handSize = playerZones?.handCount ?? playerZones?.hand?.length ?? 0;
      return { power: handSize, toughness: handSize };
    }
    
    // "lands you control"
    if (oracleText.includes('lands you control') || oracleText.includes('number of lands you control')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      return { power: lands.length, toughness: lands.length };
    }
    
    // "your life total"
    if (oracleText.includes('your life total')) {
      const life = gameState?.life?.[controllerId] ?? 40;
      return { power: life, toughness: life };
    }
    
    // "creature cards in all graveyards"
    if (oracleText.includes('creature cards in all graveyards') || 
        oracleText.includes('creatures in all graveyards')) {
      let creatureCount = 0;
      const allPlayers = gameState?.players || [];
      for (const player of allPlayers) {
        const playerZones = zones[player.id];
        const graveyard = playerZones?.graveyard || [];
        for (const card of graveyard) {
          if ((card.type_line || '').toLowerCase().includes('creature')) {
            creatureCount++;
          }
        }
      }
      return { power: creatureCount, toughness: creatureCount };
    }
    
    // "cards in your graveyard"
    if (oracleText.includes('cards in your graveyard')) {
      const playerZones = zones[controllerId];
      const cardCount = playerZones?.graveyard?.length ?? 0;
      return { power: cardCount, toughness: cardCount };
    }
    
    // "creature cards in your graveyard"
    if (oracleText.includes('creature cards in your graveyard') ||
        oracleText.includes('creatures in your graveyard')) {
      const playerZones = zones[controllerId];
      const creatureCount = (playerZones?.graveyard || []).filter((c: any) =>
        (c.type_line || '').toLowerCase().includes('creature')
      ).length;
      return { power: creatureCount, toughness: creatureCount };
    }
    
    // "artifacts you control"
    if (oracleText.includes('artifacts you control')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      return { power: artifacts.length, toughness: artifacts.length };
    }
    
    // "enchantments you control"
    if (oracleText.includes('enchantments you control')) {
      const enchantments = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('enchantment')
      );
      return { power: enchantments.length, toughness: enchantments.length };
    }
  }
  
  // "gets +1/+1 for each" patterns (for base stats of 0/0 creatures)
  const getsPlusPattern = oracleText.match(/gets? \+1\/\+1 for each ([^.]+)/i);
  if (getsPlusPattern && (card.power === '*' || card.power === '0')) {
    const condition = getsPlusPattern[1].toLowerCase();
    
    if (condition.includes('creature you control') || condition.includes('other creature you control')) {
      const creatures = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      // Subtract 1 if "other" (don't count itself)
      const count = condition.includes('other') ? Math.max(0, creatures.length - 1) : creatures.length;
      return { power: count, toughness: count };
    }
    
    if (condition.includes('land you control')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      return { power: lands.length, toughness: lands.length };
    }
    
    if (condition.includes('artifact you control')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      return { power: artifacts.length, toughness: artifacts.length };
    }
  }
  
  // For cards we can't calculate, check if there's a defined base in reminder text
  const sizeMatch = oracleText.match(/base power and toughness (\d+)\/(\d+)/i);
  if (sizeMatch) {
    return { power: parseInt(sizeMatch[1], 10), toughness: parseInt(sizeMatch[2], 10) };
  }
  
  // Default fallback - return undefined so caller knows we couldn't calculate
  return undefined;
}

/**
 * Get the actual calculated power and toughness of a creature permanent,
 * including base P/T, variable P/T (like Omnath, Tarmogoyf), and counters.
 * 
 * This is the canonical function that should be used anywhere we need to know
 * a creature's current power/toughness for game calculations like:
 * - Traverse the Outlands (greatest power)
 * - Selvala, Heart of the Wilds (greatest power)  
 * - Bighorner Rancher (greatest power)
 * - Combat damage calculations
 * - Death triggers based on power/toughness
 * 
 * @param permanent - The battlefield permanent
 * @param gameState - Game state for variable P/T calculations
 * @returns { power, toughness } with all modifiers applied
 */
export function getActualPowerToughness(
  permanent: any,
  gameState?: any
): { power: number; toughness: number } {
  if (!permanent) {
    return { power: 0, toughness: 0 };
  }

  const card = permanent.card;
  
  // Start with base power/toughness
  let basePower = permanent.basePower ?? (typeof card?.power === 'string' ? parseInt(card.power, 10) : card?.power) ?? 0;
  let baseToughness = permanent.baseToughness ?? (typeof card?.toughness === 'string' ? parseInt(card.toughness, 10) : card?.toughness) ?? 0;
  
  // Handle special characters in printed P/T
  if (typeof card?.power === 'string' && card.power.includes('*')) {
    basePower = 0; // Will be overridden by variable P/T
  }
  if (typeof card?.toughness === 'string' && card.toughness.includes('*')) {
    baseToughness = 0; // Will be overridden by variable P/T
  }
  
  // Check for variable P/T (Omnath, Tarmogoyf, etc.)
  const variablePT = calculateVariablePT(card, gameState);
  if (variablePT) {
    basePower = variablePT.power;
    baseToughness = variablePT.toughness;
  }
  
  // Apply counters
  const counters = permanent.counters || {};
  const plusOneCounters = counters['+1/+1'] || counters['plus_one'] || counters['plusOne'] || counters['p1p1'] || 0;
  const minusOneCounters = counters['-1/-1'] || counters['minus_one'] || counters['minusOne'] || counters['m1m1'] || 0;
  
  const finalPower = basePower + plusOneCounters - minusOneCounters;
  const finalToughness = baseToughness + plusOneCounters - minusOneCounters;
  
  return {
    power: Math.max(0, finalPower), // Power is displayed as 0 minimum for UI purposes
    toughness: finalToughness, // Toughness can be 0 or negative (creature dies to SBA)
  };
}

/**
 * Legacy equipment P/T bonuses when attached card objects lack oracle_text.
 * Prefer resolveAttachedPTBonusFromOracle / parseStaticAttachedPTBonusFromOracle.
 */
const EQUIPMENT_BONUSES: Record<string, { power: number; toughness: number }> = {};

/**
 * Legacy aura P/T bonuses when attached card objects lack oracle_text.
 * Prefer resolveAttachedPTBonusFromOracle / parseStaticAttachedPTBonusFromOracle.
 */
const AURA_BONUSES: Record<string, { power: number; toughness: number }> = {};

/**
 * Calculate all P/T bonuses for a creature from ALL sources
 * 
 * @param creaturePerm - The creature permanent
 * @param gameState - Full game state including battlefield, zones, etc.
 * @returns { power, toughness } total bonus from all sources
 */
export function calculateAllPTBonuses(
  creaturePerm: any,
  gameState: any
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !gameState) {
    return { power: 0, toughness: 0 };
  }
  
  const battlefield = gameState.battlefield || [];
  const controllerId = creaturePerm.controller;
  const creatureName = (creaturePerm.card?.name || '').toLowerCase();
  
  // 0. Special creature-specific P/T bonuses (Omnath, Ulvenwald Channelers, etc.)
  const selfOracleText = String(creaturePerm.card?.oracle_text || '');
  const topCreatureBonusMatch = selfOracleText.match(
    /as long as the top card of your library is a creature card, this creature gets ([+-]?\d+)\/([+-]?\d+)/i,
  );
  if (topCreatureBonusMatch) {
    const topCard = getLibraryTopCardFromState(gameState, controllerId);
    const topTypeLine = String(topCard?.type_line || topCard?.typeLine || '').toLowerCase();
    if (topTypeLine.includes('creature')) {
      powerBonus += parseInt(topCreatureBonusMatch[1], 10);
      toughnessBonus += parseInt(topCreatureBonusMatch[2], 10);
    }
  }

  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  // Match various name formats: "Omnath, Locus of Mana" or "Omnath Locus of Mana"
  if (creatureName.includes('omnath') && creatureName.includes('locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.green || 0;
    if (greenMana > 0) {
      powerBonus += greenMana;
      toughnessBonus += greenMana;
    }
  }
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  // Pass gameState for variable equipment calculations
  const equipBonus = calculateEquipmentBonus(creaturePerm, battlefield, gameState);
  powerBonus += equipBonus.power;
  toughnessBonus += equipBonus.toughness;
  
  // 2. Continuous static effects (regex anthems/lords + overlay specs)
  const continuousBonus = getContinuousPTBonusForPermanent(creaturePerm, gameState);
  powerBonus += continuousBonus.power;
  toughnessBonus += continuousBonus.toughness;

  // 5. Temporary pump effects (from modifiers) - includes Giant Growth, battle cry, etc.
  // These are spells/abilities that give +X/+Y until end of turn
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH' ||
          mod.type === 'battle_cry' || mod.type === 'BATTLE_CRY') {
        powerBonus += mod.power || mod.powerBonus || 0;
        toughnessBonus += mod.toughness || mod.toughnessBonus || 0;
      }
    }
  }
  
  // 6. Pump effects array (alternative storage for temporary buffs)
  if (creaturePerm.pumpEffects && Array.isArray(creaturePerm.pumpEffects)) {
    for (const pump of creaturePerm.pumpEffects) {
      powerBonus += pump.power || pump.powerBonus || 0;
      toughnessBonus += pump.toughness || pump.toughnessBonus || 0;
    }
  }
  
  // 7. Temporary boost fields (used by some effects like Giant Growth)
  if (typeof creaturePerm.temporaryPowerBoost === 'number') {
    powerBonus += creaturePerm.temporaryPowerBoost;
  }
  if (typeof creaturePerm.temporaryToughnessBoost === 'number') {
    toughnessBonus += creaturePerm.temporaryToughnessBoost;
  }
  
  // 8. Power/toughness boosts stored directly
  if (typeof creaturePerm.powerBoost === 'number') {
    powerBonus += creaturePerm.powerBoost;
  }
  if (typeof creaturePerm.toughnessBoost === 'number') {
    toughnessBonus += creaturePerm.toughnessBoost;
  }
  
  // 9. Emblem effects
  const emblems = gameState.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== controllerId) continue;
    
    const text = (emblem.text || emblem.effect || '').toLowerCase();
    
    // Parse "creatures you control get +X/+Y"
    const emblemMatch = text.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (emblemMatch) {
      powerBonus += parseInt(emblemMatch[1], 10);
      toughnessBonus += parseInt(emblemMatch[2], 10);
    }
  }
  
  // 10. Plane card effects (Planechase format)
  // Active plane affects all players or specific conditions
  const activePlane = gameState.activePlane || gameState.currentPlane;
  if (activePlane) {
    const planeText = (activePlane.text || activePlane.oracle_text || activePlane.effect || '').toLowerCase();
    const planeName = (activePlane.name || '').toLowerCase();
    
    // Check for global creature pump effects on planes
    // "All creatures get +X/+Y"
    const allCreaturesMatch = planeText.match(/all creatures get \+(\d+)\/\+(\d+)/i);
    if (allCreaturesMatch) {
      powerBonus += parseInt(allCreaturesMatch[1], 10);
      toughnessBonus += parseInt(allCreaturesMatch[2], 10);
    }
    
    // "Creatures you control get +X/+Y"
    const yourCreaturesMatch = planeText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (yourCreaturesMatch && activePlane.controller === controllerId) {
      powerBonus += parseInt(yourCreaturesMatch[1], 10);
      toughnessBonus += parseInt(yourCreaturesMatch[2], 10);
    }
    
    // Specific plane effects
    // Llanowar - "All creatures have +X/+X for each basic land type among lands you control"
    if (planeName.includes('llanowar')) {
      // Count basic land types controlled by the creature's controller
      const controllerLands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      const landTypes = new Set<string>();
      for (const land of controllerLands) {
        const landTypeLine = (land.card?.type_line || '').toLowerCase();
        if (landTypeLine.includes('plains')) landTypes.add('plains');
        if (landTypeLine.includes('island')) landTypes.add('island');
        if (landTypeLine.includes('swamp')) landTypes.add('swamp');
        if (landTypeLine.includes('mountain')) landTypes.add('mountain');
        if (landTypeLine.includes('forest')) landTypes.add('forest');
      }
      const boost = landTypes.size;
      powerBonus += boost;
      toughnessBonus += boost;
    }
    
    // The Great Forest - Creatures with trample get +2/+2
    if (planeName.includes('great forest')) {
      const oracleText = (creaturePerm.card?.oracle_text || '').toLowerCase();
      const keywords = creaturePerm.card?.keywords || [];
      if (oracleText.includes('trample') || keywords.some((k: string) => k.toLowerCase() === 'trample')) {
        powerBonus += 2;
        toughnessBonus += 2;
      }
    }
  }
  
  // 11. Scheme card effects (Archenemy format)
  // Ongoing schemes that affect creatures
  const activeSchemes = gameState.activeSchemes || gameState.ongoingSchemes || [];
  for (const scheme of activeSchemes) {
    if (!scheme) continue;
    
    const schemeText = (scheme.text || scheme.oracle_text || scheme.effect || '').toLowerCase();
    
    // "Creatures you control get +X/+Y"
    const schemeCreaturesMatch = schemeText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (schemeCreaturesMatch && scheme.controller === controllerId) {
      powerBonus += parseInt(schemeCreaturesMatch[1], 10);
      toughnessBonus += parseInt(schemeCreaturesMatch[2], 10);
    }
    
    // "All creatures get +X/+Y" (affects everyone)
    const schemeAllMatch = schemeText.match(/all creatures get \+(\d+)\/\+(\d+)/i);
    if (schemeAllMatch) {
      powerBonus += parseInt(schemeAllMatch[1], 10);
      toughnessBonus += parseInt(schemeAllMatch[2], 10);
    }
  }
  
  // 12. Conspiracy cards (Conspiracy draft format) - affects creatures you control
  const conspiracies = gameState.conspiracies || [];
  for (const conspiracy of conspiracies) {
    if (!conspiracy || conspiracy.controller !== controllerId) continue;
    
    const conspText = (conspiracy.text || conspiracy.oracle_text || conspiracy.effect || '').toLowerCase();
    
    // Check for creature buff effects
    const conspBuffMatch = conspText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (conspBuffMatch) {
      powerBonus += parseInt(conspBuffMatch[1], 10);
      toughnessBonus += parseInt(conspBuffMatch[2], 10);
    }
  }
  
  // 13. Dungeon room effects (AFR/CLB dungeons)
  const activeDungeon = gameState.activeDungeon || gameState.currentDungeon;
  if (activeDungeon && activeDungeon.controller === controllerId) {
    const roomText = (activeDungeon.currentRoomEffect || activeDungeon.roomEffect || '').toLowerCase();
    
    // Some rooms give creature buffs
    const roomBuffMatch = roomText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (roomBuffMatch) {
      powerBonus += parseInt(roomBuffMatch[1], 10);
      toughnessBonus += parseInt(roomBuffMatch[2], 10);
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}

function countControlledPermanentsWithTypeIncludes(
  battlefield: any[],
  controllerId: string,
  typeSubstrings: string[],
): number {
  return battlefield.filter((perm) => {
    if (!perm || perm.controller !== controllerId) return false;
    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    return typeSubstrings.some((substring) => typeLine.includes(substring));
  }).length;
}

function countActiveOpponents(gameState: any | undefined, controllerId: string): number {
  const players = gameState?.players || [];
  return players.filter((player: any) => player && player.id !== controllerId && !player.hasLost).length;
}

function countCreaturesSharingTypeWith(
  battlefield: any[],
  controllerId: string,
  creaturePerm: any,
  excludeEquippedCreature: boolean,
): number {
  const creatureTypes = extractCreatureTypes(creaturePerm.card?.type_line || '');
  if (creatureTypes.length === 0) return 0;

  let matchCount = 0;
  for (const perm of battlefield) {
    if (!perm?.card) continue;
    if (excludeEquippedCreature && perm.id === creaturePerm.id) continue;
    if (perm.controller !== controllerId) continue;
    const typeLine = String(perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    if (creatureTypes.some((creatureType) => typeLine.includes(creatureType.toLowerCase()))) {
      matchCount++;
    }
  }
  return matchCount;
}

function countUniqueColorsAmongControlledPermanents(battlefield: any[], controllerId: string): number {
  const colors = new Set<string>();
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controllerId) continue;
    for (const color of perm.card?.colors || []) {
      colors.add(color);
    }
  }
  return colors.size;
}

function countAurasYouControlAttachedToCreatures(battlefield: any[], controllerId: string): number {
  return battlefield.filter((perm) => {
    if (!perm || perm.controller !== controllerId) return false;
    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('enchantment')) return false;
    const attachedToId = String(perm.attachedTo || '').trim();
    if (!attachedToId) return false;
    const host = battlefield.find((candidate) => candidate?.id === attachedToId);
    if (!host?.card) return false;
    return String(host.card.type_line || '').toLowerCase().includes('creature');
  }).length;
}

function countCardsInGraveyardsMatching(
  gameState: any | undefined,
  predicate: (card: any) => boolean,
  scope: 'all' | 'controller',
  controllerId: string,
): number {
  if (!gameState) return 0;
  const zones = gameState.zones || {};
  const playerIds = scope === 'all'
    ? (gameState.players || []).map((player: any) => player?.id).filter(Boolean)
    : [controllerId];
  let count = 0;
  for (const playerId of playerIds) {
    const graveyard = zones[playerId]?.graveyard || [];
    for (const card of graveyard) {
      if (predicate(card)) count++;
    }
  }
  return count;
}

function cardTypeLineIncludes(card: any, substring: string): boolean {
  return String(card?.type_line || card?.typeLine || '').toLowerCase().includes(substring);
}

/**
 * Parse variable +X/+Y equipment/aura bonuses from oracle text (e.g. "for each land you control").
 * Returns null when the text does not match a supported variable pattern.
 */
function parseVariableAttachedPTBonus(
  oracleText: string,
  controllerId: string,
  battlefield: any[],
  gameState: any | undefined,
  attachedPerm: any,
  equippedCreature: any,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();
  const parsePair = (powerText: string, toughnessText?: string) => ({
    powerPer: parseInt(powerText, 10),
    toughnessPer: toughnessText === undefined ? 0 : parseInt(toughnessText, 10),
  });

  let match = text.match(
    /(?:equipped|enchanted) creature gets \+(\d+)\/\+(\d+) for each artifact and enchantment you control/,
  );
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['artifact', 'enchantment']);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+0 for each artifact you control/);
  if (match) {
    const { powerPer } = parsePair(match[1]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['artifact']);
    return { power: powerPer * count, toughness: 0 };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+(\d+) for each land you control/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['land']);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/enchanted creature gets \+(\d+)\/\+(\d+) for each aura you control attached to a creature/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countAurasYouControlAttachedToCreatures(battlefield, controllerId);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/enchanted creature gets \+(\d+)\/\+(\d+) for each enchantment you control/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['enchantment']);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/enchanted creature gets \+(\d+)\/\+(\d+) for each other enchantment on the battlefield/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = battlefield.filter((perm) => {
      if (!perm || perm.id === attachedPerm?.id) return false;
      return String(perm.card?.type_line || '').toLowerCase().includes('enchantment');
    }).length;
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+0 for each opponent(?: you have)?/);
  if (match) {
    const { powerPer } = parsePair(match[1]);
    const count = countActiveOpponents(gameState, controllerId);
    return { power: powerPer * count, toughness: 0 };
  }

  match = text.match(
    /equipped creature gets \+(\d+)\/\+(\d+) for each creature(?: you control)?(?: on the battlefield)? that shares a creature type with equipped creature/,
  );
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countCreaturesSharingTypeWith(battlefield, controllerId, equippedCreature, true);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+(\d+) for each color among permanents you control/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countUniqueColorsAmongControlledPermanents(battlefield, controllerId);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(
    /equipped creature gets \+x\/\+x, where x is the number of creature cards in all graveyards/,
  );
  if (match) {
    const count = countCardsInGraveyardsMatching(
      gameState,
      (card) => cardTypeLineIncludes(card, 'creature'),
      'all',
      controllerId,
    );
    return { power: count, toughness: count };
  }

  match = text.match(
    /gets \+x\/\+0, where x is the number of instant and sorcery cards in your graveyard/,
  );
  if (match) {
    const count = countCardsInGraveyardsMatching(
      gameState,
      (card) => cardTypeLineIncludes(card, 'instant') || cardTypeLineIncludes(card, 'sorcery'),
      'controller',
      controllerId,
    );
    return { power: count, toughness: 0 };
  }

  return null;
}

function shouldUseAttachedBonusNameTable(oracleText: string): boolean {
  return String(oracleText || '').trim().length === 0;
}

/**
 * Attack-triggered equipment pump stored on the permanent (e.g. Trepanation Blade reveal count).
 */
export function isEquippedAttackRevealUntilLandPump(oracleText: string): boolean {
  const text = String(oracleText || '').toLowerCase();
  return text.includes('whenever equipped creature attacks')
    && text.includes('until they reveal a land card')
    && text.includes('for each card revealed this way');
}

export function getEquippedAttackRevealPumpPowerPerCard(oracleText: string): number {
  const text = String(oracleText || '').toLowerCase();
  const match = text.match(/gets \+(\d+)\/\+0(?: until end of turn)? for each card revealed this way/);
  return match ? parseInt(match[1], 10) : 1;
}

function parseStoredRevealAttachedPTBonus(
  oracleText: string,
  attachedPerm: any,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();
  if (!text.includes('for each card revealed this way')) return null;
  const storedBonus = attachedPerm.trepanationBonus || attachedPerm.lastTrepanationBonus || 0;
  if (storedBonus <= 0) return null;
  return { power: storedBonus, toughness: 0 };
}

/**
 * Compound static equipment bonuses with type-conditional riders (e.g. Tenza, Godo's Maul).
 */
function parseCompoundAttachedPTBonus(
  oracleText: string,
  equippedCreature: any,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();
  const baseMatch = text.match(/equipped creature gets \+(\d+)\/\+(\d+)\./);
  const legendaryExtra = text.match(/as long as it's legendary, it gets an additional \+(\d+)\/\+(\d+)/);
  if (!baseMatch || !legendaryExtra) return null;

  let power = parseInt(baseMatch[1], 10);
  let toughness = parseInt(baseMatch[2], 10);
  const typeLine = String(equippedCreature?.card?.type_line || '').toLowerCase();
  if (typeLine.includes('legendary')) {
    power += parseInt(legendaryExtra[1], 10);
    toughness += parseInt(legendaryExtra[2], 10);
  }
  return { power, toughness };
}

function parseStaticAttachedPTBonusFromOracle(
  oracleText: string,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();

  let match = text.match(/equipped creature gets? \+(\d+)\/\+(\d+)(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(/equipped creature gets? \+(\d+)\/\+0(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: 0 };
  }

  match = text.match(/equipped creature gets? \+(\d+)\/(-\d+)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(/enchanted creature gets? \+(\d+)\/\+(\d+)(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(/enchanted creature gets? \+(\d+)\/\+0(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: 0 };
  }

  return null;
}

function resolveAttachedPTBonusFromOracle(
  oracleText: string,
  controllerId: string,
  battlefield: any[],
  gameState: any | undefined,
  attachedPerm: any,
  equippedCreature: any,
): { power: number; toughness: number } | null {
  return (
    parseVariableAttachedPTBonus(
      oracleText,
      controllerId,
      battlefield,
      gameState,
      attachedPerm,
      equippedCreature,
    )
    ?? parseStoredRevealAttachedPTBonus(oracleText, attachedPerm)
    ?? parseCompoundAttachedPTBonus(oracleText, equippedCreature)
  );
}

/**
 * Source of a P/T bonus for display in tooltips
 */
export interface PTBonusSource {
  name: string;           // Name of the source (card name, "Counters", etc.)
  power: number;          // Power bonus from this source
  toughness: number;      // Toughness bonus from this source
  type: 'equipment' | 'aura' | 'enchantment' | 'creature' | 'artifact' | 'counter' | 'modifier' | 'emblem' | 'ability' | 'other';
}

/**
 * Extended result from P/T calculation that includes source tracking
 */
export interface PTBonusResult {
  power: number;
  toughness: number;
  sources: PTBonusSource[];
}

/**
 * Calculate all P/T bonuses for a creature with source tracking for tooltips.
 * This extended version returns information about what is contributing to the P/T calculation.
 * 
 * @param creaturePerm - The creature permanent
 * @param gameState - Full game state including battlefield, zones, etc.
 * @returns { power, toughness, sources } total bonus from all sources with details
 */
export function calculateAllPTBonusesWithSources(
  creaturePerm: any,
  gameState: any
): PTBonusResult {
  const sources: PTBonusSource[] = [];
  
  if (!creaturePerm || !gameState) {
    return { power: 0, toughness: 0, sources: [] };
  }
  
  const battlefield = gameState.battlefield || [];
  const controllerId = creaturePerm.controller;
  const creatureName = (creaturePerm.card?.name || '').toLowerCase();
  
  // 0. Special creature-specific P/T bonuses (Omnath, Ulvenwald Channelers, etc.)
  const selfOracleText = String(creaturePerm.card?.oracle_text || '');
  const topCreatureBonusMatch = selfOracleText.match(
    /as long as the top card of your library is a creature card, this creature gets ([+-]?\d+)\/([+-]?\d+)/i,
  );
  if (topCreatureBonusMatch) {
    const topCard = getLibraryTopCardFromState(gameState, controllerId);
    const topTypeLine = String(topCard?.type_line || topCard?.typeLine || '').toLowerCase();
    if (topTypeLine.includes('creature')) {
      const p = parseInt(topCreatureBonusMatch[1], 10);
      const t = parseInt(topCreatureBonusMatch[2], 10);
      if (p !== 0 || t !== 0) {
        sources.push({
          name: creaturePerm.card?.name || 'Creature',
          power: p,
          toughness: t,
          type: 'ability',
        });
      }
    }
  }

  // Omnath, Locus of Mana - gets +1/+1 for each green mana in your mana pool
  // Match various name formats: "Omnath, Locus of Mana" or "Omnath Locus of Mana"
  if (creatureName.includes('omnath') && creatureName.includes('locus of mana')) {
    const manaPool = gameState?.manaPool?.[controllerId] || {};
    const greenMana = manaPool.green || 0;
    if (greenMana > 0) {
      sources.push({
        name: 'Green mana in pool',
        power: greenMana,
        toughness: greenMana,
        type: 'ability',
      });
    }
  }
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  const equipSources = calculateEquipmentBonusWithSources(creaturePerm, battlefield, gameState);
  sources.push(...equipSources.sources);
  
  // 2. Continuous static effects (regex anthems/lords + overlay specs)
  const continuousSources = getContinuousPTBonusSourcesForPermanent(creaturePerm, gameState);
  for (const continuousSource of continuousSources.sources) {
    if (continuousSource.power === 0 && continuousSource.toughness === 0) continue;
    sources.push({
      name: continuousSource.name,
      power: continuousSource.power,
      toughness: continuousSource.toughness,
      type: 'other',
    });
  }

  // 5. Temporary pump effects (modifiers) including battle cry
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH' ||
          mod.type === 'battle_cry' || mod.type === 'BATTLE_CRY') {
        const p = mod.power || mod.powerBonus || 0;
        const t = mod.toughness || mod.toughnessBonus || 0;
        if (p !== 0 || t !== 0) {
          sources.push({
            name: mod.sourceName || (mod.type === 'battle_cry' ? 'Battle Cry' : 'Pump effect'),
            power: p,
            toughness: t,
            type: 'modifier',
          });
        }
      }
    }
  }
  
  // 6. Pump effects array
  if (creaturePerm.pumpEffects && Array.isArray(creaturePerm.pumpEffects)) {
    for (const pump of creaturePerm.pumpEffects) {
      const p = pump.power || pump.powerBonus || 0;
      const t = pump.toughness || pump.toughnessBonus || 0;
      if (p !== 0 || t !== 0) {
        sources.push({
          name: pump.sourceName || 'Pump effect',
          power: p,
          toughness: t,
          type: 'modifier',
        });
      }
    }
  }
  
  // 7/8. Temporary and direct boost fields
  const tempPower = (creaturePerm.temporaryPowerBoost || 0) + (creaturePerm.powerBoost || 0);
  const tempToughness = (creaturePerm.temporaryToughnessBoost || 0) + (creaturePerm.toughnessBoost || 0);
  if (tempPower !== 0 || tempToughness !== 0) {
    sources.push({
      name: 'Temporary boost',
      power: tempPower,
      toughness: tempToughness,
      type: 'modifier',
    });
  }
  
  // 9. Emblem effects
  const emblems = gameState.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== controllerId) continue;
    
    const text = (emblem.text || emblem.effect || '').toLowerCase();
    const emblemMatch = text.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (emblemMatch) {
      const p = parseInt(emblemMatch[1], 10);
      const t = parseInt(emblemMatch[2], 10);
      sources.push({
        name: emblem.name || 'Emblem',
        power: p,
        toughness: t,
        type: 'emblem',
      });
    }
  }
  
  // Calculate totals
  let totalPower = 0;
  let totalToughness = 0;
  for (const source of sources) {
    totalPower += source.power;
    totalToughness += source.toughness;
  }
  
  return { power: totalPower, toughness: totalToughness, sources };
}

/**
 * Calculate equipment/aura bonus with source tracking.
 */
export function calculateEquipmentBonusWithSources(
  creaturePerm: any,
  battlefield: any[],
  gameState?: any
): PTBonusResult {
  const sources: PTBonusSource[] = [];
  
  if (!creaturePerm || !Array.isArray(battlefield)) {
    return { power: 0, toughness: 0, sources: [] };
  }
  
  const controllerId = creaturePerm.controller;
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura') && typeLine.includes('enchantment');
    
    if (!isEquipment && !isAura) continue;
    
    const isAttached = 
      perm.attachedTo === creaturePerm.id || 
      (creaturePerm.attachedEquipment && creaturePerm.attachedEquipment.includes(perm.id));
    
    if (!isAttached) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const sourceType: 'equipment' | 'aura' = isEquipment ? 'equipment' : 'aura';

    const variableBonus = resolveAttachedPTBonusFromOracle(
      oracleText,
      controllerId,
      battlefield,
      gameState,
      perm,
      creaturePerm,
    );
    if (variableBonus) {
      if (variableBonus.power !== 0 || variableBonus.toughness !== 0) {
        sources.push({
          name: perm.card.name,
          power: variableBonus.power,
          toughness: variableBonus.toughness,
          type: sourceType,
        });
      }
      continue;
    }

    const staticBonus = parseStaticAttachedPTBonusFromOracle(oracleText);
    if (staticBonus) {
      if (staticBonus.power !== 0 || staticBonus.toughness !== 0) {
        sources.push({
          name: perm.card.name,
          power: staticBonus.power,
          toughness: staticBonus.toughness,
          type: sourceType,
        });
      }
      continue;
    }
    
    // Name-table fallback when oracle text is unavailable on the card object
    if (shouldUseAttachedBonusNameTable(oracleText) && EQUIPMENT_BONUSES[cardName]) {
      const bonus = EQUIPMENT_BONUSES[cardName];
      if (bonus.power !== 0 || bonus.toughness !== 0) {
        sources.push({ name: perm.card.name, power: bonus.power, toughness: bonus.toughness, type: sourceType });
      }
      continue;
    }
    
    if (shouldUseAttachedBonusNameTable(oracleText) && AURA_BONUSES[cardName]) {
      const bonus = AURA_BONUSES[cardName];
      if (bonus.power !== 0 || bonus.toughness !== 0) {
        sources.push({ name: perm.card.name, power: bonus.power, toughness: bonus.toughness, type: sourceType });
      }
      continue;
    }
  }
  
  let totalPower = 0;
  let totalToughness = 0;
  for (const source of sources) {
    totalPower += source.power;
    totalToughness += source.toughness;
  }
  
  return { power: totalPower, toughness: totalToughness, sources };
}

/**
 * Calculate total equipment/aura bonus for a creature
 * Looks at all attached equipment and auras and sums their P/T bonuses
 * Includes variable equipment like Cranial Plating, Blackblade Reforged, Trepanation Blade
 * 
 * @param creaturePerm - The creature permanent
 * @param battlefield - All permanents on the battlefield
 * @param gameState - Optional game state for variable equipment calculations
 * @returns { power, toughness } total bonus
 */
export function calculateEquipmentBonus(
  creaturePerm: any,
  battlefield: any[],
  gameState?: any
): { power: number; toughness: number } {
  let powerBonus = 0;
  let toughnessBonus = 0;
  
  if (!creaturePerm || !Array.isArray(battlefield)) {
    return { power: 0, toughness: 0 };
  }
  
  const controllerId = creaturePerm.controller;
  
  // Find all equipment/auras attached to this creature
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura') && typeLine.includes('enchantment');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if this equipment/aura is attached to the creature
    const isAttached = 
      perm.attachedTo === creaturePerm.id || 
      (creaturePerm.attachedEquipment && creaturePerm.attachedEquipment.includes(perm.id));
    
    if (!isAttached) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();

    const variableBonus = resolveAttachedPTBonusFromOracle(
      oracleText,
      controllerId,
      battlefield,
      gameState,
      perm,
      creaturePerm,
    );
    if (variableBonus) {
      powerBonus += variableBonus.power;
      toughnessBonus += variableBonus.toughness;
      continue;
    }

    const staticBonus = parseStaticAttachedPTBonusFromOracle(oracleText);
    if (staticBonus) {
      powerBonus += staticBonus.power;
      toughnessBonus += staticBonus.toughness;
      continue;
    }
    
    // Name-table fallback when oracle text is unavailable on the card object
    if (shouldUseAttachedBonusNameTable(oracleText) && EQUIPMENT_BONUSES[cardName]) {
      powerBonus += EQUIPMENT_BONUSES[cardName].power;
      toughnessBonus += EQUIPMENT_BONUSES[cardName].toughness;
      continue;
    }
    
    if (shouldUseAttachedBonusNameTable(oracleText) && AURA_BONUSES[cardName]) {
      powerBonus += AURA_BONUSES[cardName].power;
      toughnessBonus += AURA_BONUSES[cardName].toughness;
      continue;
    }
  }
  
  return { power: powerBonus, toughness: toughnessBonus };
}

/**
 * Extract creature types from a type line
 * e.g., "Legendary Creature — Human Soldier" -> ["Human", "Soldier"]
 */
function extractCreatureTypes(typeLine: string): string[] {
  if (!typeLine) return [];
  const dashIndex = typeLine.indexOf('—');
  if (dashIndex === -1) return [];
  const subtypes = typeLine.substring(dashIndex + 1).trim();
  return subtypes.split(/\s+/).filter(t => t.length > 0);
}

/**
 * Exchange the oracle text between two permanents on the battlefield.
 * Used for text-changing effects like Exchange of Words or custom cards that swap text boxes.
 *
 * @returns true if the exchange was completed, false if either permanent was missing
 */
export function exchangePermanentOracleText(
  battlefield: BattlefieldPermanent[],
  sourceId: string,
  targetId: string
): boolean {
  const source = battlefield.find(p => p?.id === sourceId);
  const target = battlefield.find(p => p?.id === targetId);
  if (!source || !target || !source.card || !target.card) return false;

  const sourceText = source.card.oracle_text || '';
  const targetText = target.card.oracle_text || '';

  const applyText = (perm: BattlefieldPermanent, text: string) => {
    // Keep both the card reference and the per-permanent override in sync,
    // as different modules may read from either location for text-changing effects.
    if (perm.card) {
      perm.card.oracle_text = text;
    }
    perm.oracle_text = text;
  };

  applyText(source, targetText);
  applyText(target, sourceText);
  return true;
}

/**
 * Add energy counters to a player.
 * Energy counters are a resource introduced in Kaladesh block.
 * 
 * @param gameState - The game state object
 * @param playerId - The player gaining energy
 * @param amount - The number of energy counters to add
 * @param source - Optional source of the energy gain
 * @returns The new energy total for the player
 */
export function addEnergyCounters(
  gameState: any,
  playerId: string,
  amount: number,
  source?: string
): number {
  if (!gameState || !playerId || amount <= 0) return 0;
  
  // Initialize energy if it doesn't exist
  const energy = gameState.energy = gameState.energy || {};
  energy[playerId] = (energy[playerId] || 0) + amount;

  // Legacy alias map used by some intervening-if fallbacks.
  try {
    const energyCount = (gameState.energyCount = gameState.energyCount || {});
    energyCount[playerId] = energy[playerId] || 0;
  } catch {
    // best-effort only
  }
  
  debug(2, `[addEnergyCounters] ${playerId} gained ${amount} energy${source ? ` from ${source}` : ''} (total: ${energy[playerId]})`);
  
  return energy[playerId];
}

/**
 * Remove energy counters from a player (for paying costs).
 * 
 * @param gameState - The game state object
 * @param playerId - The player spending energy
 * @param amount - The number of energy counters to remove
 * @returns true if the energy was successfully spent, false if not enough
 */
export function spendEnergyCounters(
  gameState: any,
  playerId: string,
  amount: number
): boolean {
  if (!gameState || !playerId || amount <= 0) return false;
  
  const energy = gameState.energy || {};
  const currentEnergy = energy[playerId] || 0;
  
  if (currentEnergy < amount) {
    debug(2, `[spendEnergyCounters] ${playerId} cannot spend ${amount} energy (only has ${currentEnergy})`);
    return false;
  }
  
  energy[playerId] = currentEnergy - amount;

  // Legacy alias map used by some intervening-if fallbacks.
  try {
    const energyCount = (gameState.energyCount = gameState.energyCount || {});
    energyCount[playerId] = energy[playerId] || 0;
  } catch {
    // best-effort only
  }
  debug(2, `[spendEnergyCounters] ${playerId} spent ${amount} energy (remaining: ${energy[playerId]})`);
  
  return true;
}

/**
 * Get the current energy count for a player.
 */
export function getEnergyCount(gameState: any, playerId: string): number {
  if (!gameState || !playerId) return 0;
  return gameState.energy?.[playerId] || 0;
}

/**
 * Add token counters to a player.
 * Token counters are a player resource used by some cards (e.g., "you get two token counters").
 *
 * We keep a couple of alias maps in sync because intervening-if supports multiple field names.
 */
export function addTokenCounters(
  gameState: any,
  playerId: string,
  amount: number,
  source?: string
): number {
  if (!gameState || !playerId || amount <= 0) return 0;

  const tokenCounters = (gameState.tokenCounters = gameState.tokenCounters || {});
  tokenCounters[playerId] = (tokenCounters[playerId] || 0) + amount;

  // Alias used by some best-effort consumers.
  const tokenCounterCount = (gameState.tokenCounterCount = gameState.tokenCounterCount || {});
  tokenCounterCount[playerId] = tokenCounters[playerId];

  debug(
    2,
    `[addTokenCounters] ${playerId} gained ${amount} token counter(s)${source ? ` from ${source}` : ''} (total: ${tokenCounters[playerId]})`
  );

  return tokenCounters[playerId];
}

/**
 * Normalize a card name for oracle text matching.
 * 
 * Modern MTG oracle text uses shortened names for cards with titles:
 * - "Abdel Adrian, Gorion's Ward" becomes "Abdel Adrian" in oracle text
 * - "Kenrith, the Returned King" becomes "Kenrith" in oracle text
 * - "Edgar Markov" stays "Edgar Markov" (no title to remove)
 * 
 * The pattern is: if a card has a comma followed by a title, 
 * the oracle text uses just the name part before the comma.
 * 
 * @param fullName - The full card name (e.g., "Abdel Adrian, Gorion's Ward")
 * @returns The normalized name for oracle text matching (e.g., "Abdel Adrian")
 */
export function normalizeCardNameForOracleText(fullName: string): string {
  if (!fullName) return '';

  const slashMatch = fullName.match(/^([^/]+?)\s*\/\/\s*/);
  if (slashMatch) {
    return normalizeCardNameForOracleText(slashMatch[1].trim());
  }

  // If the name contains a comma, use only the part before the comma
  // This handles "Abdel Adrian, Gorion's Ward" -> "Abdel Adrian"
  // But we need to be careful about names like "Sisters of the Undying" which has no comma
  const commaIndex = fullName.indexOf(',');
  if (commaIndex > 0) {
    return fullName.substring(0, commaIndex).trim();
  }

  return fullName;
}

/**
 * Check if oracle text references a card by name.
 * Handles both full names and normalized (shortened) names.
 * 
 * Modern MTG oracle text uses shortened names, so we check both:
 * - "When Abdel Adrian enters" matches card "Abdel Adrian, Gorion's Ward"
 * - "When ~ enters" matches any card (tilde is a self-reference)
 * 
 * @param oracleText - The oracle text to search in
 * @param cardName - The full card name to match
 * @returns true if the oracle text references this card by name
 */
export function oracleTextReferencesCard(oracleText: string, cardName: string): boolean {
  if (!oracleText || !cardName) return false;
  
  const lowerOracle = oracleText.toLowerCase();
  const lowerFullName = cardName.toLowerCase();
  const lowerShortName = normalizeCardNameForOracleText(cardName).toLowerCase();
  
  // Check for tilde (self-reference) first
  if (lowerOracle.includes('~')) {
    return true;
  }
  
  // Check for "this creature", "this permanent", etc.
  if (lowerOracle.includes('this creature') || 
      lowerOracle.includes('this permanent') || 
      lowerOracle.includes('this card')) {
    return true;
  }
  
  // Check for full name match
  if (lowerOracle.includes(lowerFullName)) {
    return true;
  }
  
  // Check for shortened name match (for cards with titles)
  if (lowerShortName !== lowerFullName && lowerOracle.includes(lowerShortName)) {
    return true;
  }
  
  return false;
}

/**
 * Create a regex pattern that matches either the full card name or the shortened version.
 * This is useful for detecting card-specific effects in oracle text.
 * 
 * @param cardName - The full card name
 * @returns A regex pattern that matches the card name in oracle text
 */
export function createCardNameRegex(cardName: string): RegExp {
  if (!cardName) return /(?!)/; // Never matches
  
  const fullName = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shortName = normalizeCardNameForOracleText(cardName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  if (shortName !== fullName) {
    // Card has a title - match either full or short name, or tilde/this
    return new RegExp(`(?:~|this creature|this permanent|${fullName}|${shortName})`, 'i');
  }
  
  // No title - match full name or tilde/this
  return new RegExp(`(?:~|this creature|this permanent|${fullName})`, 'i');
}

