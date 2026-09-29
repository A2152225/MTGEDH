import type { BattlefieldPermanent } from "../../../shared/src/types.js";
import type { GameContext } from "./context.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { evaluateLifeGainReplacementEvent } from './modules/replacement-effects.js';
import { summarizeLifeGainAmountReplacements } from './modules/replacementEffectSpec.js';
import { canPlayerPayLife } from './modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js';
import { calculateVariablePT } from './utils-handlers/variablePTCalculator.js';
import { applyLayer7bSetBasePowerToughness } from './modules/setBasePtTimestampResolution.js';

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
 * Optional `ctx`/`playerId` also consult `canPlayerPayLife` (Angel of Jubilation /
 * life-total-can't-change). You CAN pay life that would put you at 0 when no
 * restriction applies (you'll lose to SBA, but the payment is legal).
 */
export function canPayLife(
  currentLife: number,
  amount: number,
  ctx?: GameContext,
  playerId?: string,
): boolean {
  if (currentLife < amount) return false;
  if (ctx && playerId && !canPlayerPayLife(ctx, playerId)) return false;
  return true;
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
 * When `ctx`/`playerId` are provided and the player cannot pay life, returns 0.
 */
export function getMaxPayableLife(
  currentLife: number,
  ctx?: GameContext,
  playerId?: string,
): number {
  if (ctx && playerId && !canPlayerPayLife(ctx, playerId)) return 0;
  return Math.max(0, currentLife);
}

/**
 * Validate life payment for a spell or ability.
 * Returns an error message if invalid, or null if valid.
 */
export function validateLifePayment(
  currentLife: number,
  amount: number,
  cardName?: string,
  ctx?: GameContext,
  playerId?: string,
): string | null {
  if (amount < 0) {
    return `Cannot pay negative life`;
  }
  if (ctx && playerId && !canPlayerPayLife(ctx, playerId)) {
    return `Cannot pay life${cardName ? ` for ${cardName}` : ''}: players can't pay life`;
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
  const amountMods = summarizeLifeGainAmountReplacements(gameState, playerId);
  if (amountMods.extraLife > 0) {
    modifiedAmount += amountMods.extraLife;
    appliedReplacements.push(
      ...amountMods.extraSources.map((sourceName) => `${sourceName}: +${amountMods.extraLife}`),
    );
  }
  if (amountMods.multiplier > 1) {
    modifiedAmount *= amountMods.multiplier;
    appliedReplacements.push(
      ...amountMods.doubleSources.map((sourceName) => `${sourceName}: x${amountMods.multiplier}`),
    );
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

export { calculateVariablePT } from './utils-handlers/variablePTCalculator.js';


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

  // Layer 7b set-base (Auras, static specs, rules-engine setters) by timestamp, before counters.
  const layer7b = applyLayer7bSetBasePowerToughness(permanent, gameState, { power: basePower, toughness: baseToughness });
  basePower = layer7b.power ?? basePower;
  baseToughness = layer7b.toughness ?? baseToughness;
  
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


export { calculateAllPTBonuses } from './utils-handlers/ptAllBonusesCalculator.js';


export {
  resolveSetBasePTFromAttachedAuras,
  isEquippedAttackRevealUntilLandPump,
  getEquippedAttackRevealPumpPowerPerCard,
} from './utils-handlers/ptAttachedBonusParseHelpers.js';


export {
  calculateAllPTBonusesWithSources,
  calculateEquipmentBonusWithSources,
} from './utils-handlers/ptAllBonusesWithSources.js';
export type { PTBonusSource, PTBonusResult } from './utils-handlers/ptAllBonusesWithSources.js';


export { calculateEquipmentBonus } from './utils-handlers/ptEquipmentBonusCalculator.js';



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

