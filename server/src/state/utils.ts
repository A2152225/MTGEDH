export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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
 * Known cards that PREVENT life gain.
 * These effects can be global, affect only opponents, or affect specific players.
 */
export const LIFE_GAIN_PREVENTION_CARDS: Record<string, {
  effect: string;
  affectsOpponents: boolean; // True if only affects opponents
  affectsAll: boolean; // True if affects all players including controller
  isStatic: boolean; // True if it's a static ability (always active while on battlefield)
  isEmblem?: boolean; // True if it creates an emblem with this effect
}> = {
  "erebos, god of the dead": {
    effect: "Your opponents can't gain life",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: true,
  },
  "sulfuric vortex": {
    effect: "Players can't gain life",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "leyline of punishment": {
    effect: "Players can't gain life",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "tibalt, rakish instigator": {
    effect: "Your opponents can't gain life",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: true,
  },
  "stigma lasher": {
    effect: "Player dealt damage by ~ can't gain life for the rest of the game",
    affectsOpponents: false,
    affectsAll: false,
    isStatic: false, // Triggered, creates lasting effect
  },
  "everlasting torment": {
    effect: "Players can't gain life. Damage causes -1/-1 counters.",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "havoc festival": {
    effect: "Players can't gain life",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "rain of gore": {
    effect: "If a spell or ability would cause its controller to gain life, that player loses that much life instead",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "witch hunt": {
    effect: "Players can't gain life",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "forsaken wastes": {
    effect: "Players can't gain life",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "rampaging ferocidon": {
    effect: "Players can't gain life",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "archfiend of ifnir": {
    effect: "Your opponents can't gain life (during your turn)",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: true,
  },
  "kederekt parasite": {
    effect: "Whenever an opponent draws a card, if you control a red permanent, damage dealt",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: false,
  },
  "roiling vortex": {
    effect: "At the beginning of each player's upkeep, that player loses 1 life. Whenever a player casts a spell, if no mana was spent to cast that spell, that player loses 5 life. Players can't gain life.",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "quakebringer": {
    effect: "Your opponents can't gain life (while in graveyard too)",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: true,
  },
};

/**
 * Known cards that REVERSE life gain to life loss.
 * These cause the player who would gain life to lose that much life instead.
 */
export const LIFE_GAIN_REVERSAL_CARDS: Record<string, {
  effect: string;
  affectsOpponents: boolean; // True if only affects opponents
  affectsAll: boolean; // True if affects all players
  isStatic: boolean;
}> = {
  "tainted remedy": {
    effect: "If an opponent would gain life, that player loses that much life instead",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: true,
  },
  "rain of gore": {
    effect: "If a spell or ability would cause its controller to gain life, that player loses that much life instead",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: true,
  },
  "archfiend of despair": {
    effect: "Your opponents can't gain life. At end of each end step, each opponent who lost life this turn loses that much life again.",
    affectsOpponents: true,
    affectsAll: false,
    isStatic: true,
  },
  "false cure": {
    effect: "Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life gained",
    affectsOpponents: false,
    affectsAll: true,
    isStatic: false, // Temporary effect
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
  const battlefield = gameState?.battlefield || [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const controller = perm.controller;
    
    // Check prevention effects
    const prevention = LIFE_GAIN_PREVENTION_CARDS[cardName];
    if (prevention && prevention.isStatic) {
      // Check if this affects the player
      if (prevention.affectsAll) {
        return { prevented: true, source: perm.card.name };
      }
      if (prevention.affectsOpponents && controller !== playerId) {
        return { prevented: true, source: perm.card.name };
      }
    }
    
    // Check reversal effects
    const reversal = LIFE_GAIN_REVERSAL_CARDS[cardName];
    if (reversal && reversal.isStatic) {
      if (reversal.affectsAll) {
        return { prevented: false, reversedToLoss: true, source: perm.card.name };
      }
      if (reversal.affectsOpponents && controller !== playerId) {
        return { prevented: false, reversedToLoss: true, source: perm.card.name };
      }
    }
  }
  
  // Also check for lasting effects (like Stigma Lasher's "can't gain life for rest of game")
  const lastingEffects = gameState?.lastingEffects || [];
  for (const effect of lastingEffects) {
    if (effect.type === 'preventLifeGain' && effect.targetPlayer === playerId) {
      return { prevented: true, source: effect.source };
    }
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
    console.log(`[applyLifeGain] Life gain modified by replacements: ${amount} -> ${modifiedAmount} (${appliedReplacements.join(', ')})`);
  }
  
  // Normal life gain (with modifiers applied)
  const startingLife = gameState?.startingLife || 40;
  const currentLife = gameState?.life?.[playerId] ?? startingLife;
  
  if (!gameState.life) gameState.life = {};
  gameState.life[playerId] = currentLife + modifiedAmount;
  
  // Sync to player object
  const player = (gameState.players || []).find((p: any) => p.id === playerId);
  if (player) {
    player.life = gameState.life[playerId];
  }
  
  // Trigger "whenever you gain life" effects (Ajani's Pridemate, Sanguine Bond, etc.)
  try {
    const lifeGainTriggers = triggerLifeGainEffects(gameState, playerId, modifiedAmount);
    if (lifeGainTriggers.length > 0) {
      console.log(`[applyLifeGain] Triggered ${lifeGainTriggers.length} life gain effect(s)`);
    }
  } catch (err) {
    console.warn('[applyLifeGain] Error triggering life gain effects:', err);
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
    
    // Ajani's Pridemate, Bloodbond Vampire, MJ Rising Star, Voice of the Blessed, etc.: Put a +1/+1 counter on this creature
    // Pattern: "Whenever you gain life, put a +1/+1 counter on ~" or "...on this creature"
    // This should match any card with "whenever you gain life" + "put a +1/+1 counter" where the counter goes on itself
    // Common patterns:
    // - "put a +1/+1 counter on ~" (using ~ to reference card name)
    // - "put a +1/+1 counter on [card name]"
    // - "put a +1/+1 counter on this creature"
    // We detect this by checking if the text mentions putting a counter but NOT "on each" (that's Archangel of Thune)
    // and NOT "that many" (that's Aerith/Sunbond style)
    const putsSingleCounter = oracleText.includes('put a +1/+1 counter on') && 
                              !oracleText.includes('on each') && 
                              !oracleText.includes('that many');
    
    // Check if the counter goes on this permanent (not another target)
    // It goes on self if:
    // - Text contains "on ~" (card name reference)
    // - Text contains the card's own name after "counter on"
    // - Text doesn't require choosing a target (no "target creature")
    // - OR it's a known card name (pridemate patterns)
    const counterGoesOnSelf = putsSingleCounter && (
      oracleText.includes('on ~') ||
      oracleText.includes('on this') ||
      oracleText.includes(`on ${cardName}`) ||
      cardName.includes('pridemate') ||
      cardName.includes('bloodbond') ||
      cardName.includes('rising star') ||  // MJ, Rising Star
      cardName.includes('voice of the blessed') ||
      cardName.includes('celestial unicorn') ||
      cardName.includes('trelasarra') ||
      // Generic check: if it says "put a +1/+1 counter on" without saying "target", it likely goes on itself
      (!oracleText.includes('target creature') && !oracleText.includes('target enchantment'))
    );
    
    if (counterGoesOnSelf) {
      perm.counters = perm.counters || {};
      perm.counters['+1/+1'] = (perm.counters['+1/+1'] || 0) + 1;
      triggered.push({ 
        permanent: perm.card.name || perm.id, 
        effect: `Added +1/+1 counter (${perm.counters['+1/+1']} total)` 
      });
      console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} gained a +1/+1 counter from life gain`);
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
      console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} gained ${amountGained} +1/+1 counter(s) from life gain`);
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
      console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} added +1/+1 counters to all creatures`);
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
      }
      triggered.push({ 
        permanent: perm.card.name || perm.id, 
        effect: 'Each opponent lost 1 life' 
      });
      console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} caused each opponent to lose 1 life`);
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
        triggered.push({ 
          permanent: perm.card.name || perm.id, 
          effect: `Target opponent lost ${amountGained} life` 
        });
        console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} caused opponent to lose ${amountGained} life`);
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
        console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} gained a +1/+1 counter`);
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
        console.log(`[triggerLifeGainEffects] ${perm.card.name || perm.id} gained ${amountGained} +1/+1 counter(s) from ${aura.card.name || 'Aura'}`);
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
  const controllerId = card.controller;
  const battlefield = gameState?.battlefield || [];
  const zones = gameState?.zones || {};
  
  // Marit Lage token - Defined as 20/20
  if (name.includes('marit lage')) {
    return { power: 20, toughness: 20 };
  }
  
  // ===== SPECIFIC CARD HANDLERS =====
  
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
 * Known equipment and aura power/toughness bonuses
 * Maps card name (lowercase) to { power, toughness } bonus
 */
const EQUIPMENT_BONUSES: Record<string, { power: number; toughness: number }> = {
  // Swords of X and Y - all give +2/+2
  "sword of fire and ice": { power: 2, toughness: 2 },
  "sword of feast and famine": { power: 2, toughness: 2 },
  "sword of light and shadow": { power: 2, toughness: 2 },
  "sword of war and peace": { power: 2, toughness: 2 },
  "sword of body and mind": { power: 2, toughness: 2 },
  "sword of truth and justice": { power: 2, toughness: 2 },
  "sword of sinew and steel": { power: 2, toughness: 2 },
  "sword of hearth and home": { power: 2, toughness: 2 },
  "sword of once and future": { power: 2, toughness: 2 },
  "sword of forge and frontier": { power: 2, toughness: 2 },
  
  // Common equipments
  "loxodon warhammer": { power: 3, toughness: 0 },
  "umezawa's jitte": { power: 0, toughness: 0 }, // Counters-based, handled separately
  "skullclamp": { power: 1, toughness: -1 },
  "lightning greaves": { power: 0, toughness: 0 },
  "swiftfoot boots": { power: 0, toughness: 0 },
  "whispersilk cloak": { power: 0, toughness: 0 },
  "champion's helm": { power: 2, toughness: 2 },
  "batterskull": { power: 4, toughness: 4 },
  "colossus hammer": { power: 10, toughness: 10 },
  "embercleave": { power: 1, toughness: 1 }, // Also gives double strike
  "shadowspear": { power: 1, toughness: 1 },
  "mask of memory": { power: 0, toughness: 0 },
  "bonesplitter": { power: 2, toughness: 0 },
  "basilisk collar": { power: 0, toughness: 0 },
  "grafted exoskeleton": { power: 2, toughness: 2 },
  "nim deathmantle": { power: 2, toughness: 2 },
  "sword of vengeance": { power: 2, toughness: 0 },
  "argentum armor": { power: 6, toughness: 6 },
  "kaldra compleat": { power: 5, toughness: 5 },
  "vorpal sword": { power: 2, toughness: 0 },
  "manriki-gusari": { power: 1, toughness: 2 },
  "plate armor": { power: 3, toughness: 3 },
  "o-naginata": { power: 3, toughness: 0 },
  "gorgon flail": { power: 1, toughness: 1 },
  "behemoth sledge": { power: 2, toughness: 2 },
  "hexplate wallbreaker": { power: 2, toughness: 2 },
  "bloodforged battle-axe": { power: 2, toughness: 0 },
  "dowsing dagger": { power: 2, toughness: 1 },
  "hammer of nazahn": { power: 2, toughness: 0 },
  "dead-iron sledge": { power: 2, toughness: 0 },
  "commander's plate": { power: 3, toughness: 3 },
  "kaldra's shield": { power: 0, toughness: 4 },
  "heartseeker": { power: 2, toughness: 0 },
  "maul of the skyclaves": { power: 2, toughness: 2 },
  "lizard blades": { power: 1, toughness: 1 },
  "simian sling": { power: 1, toughness: 1 },
  "rabbit battery": { power: 1, toughness: 1 },
};

/**
 * Known aura enchantments that give power/toughness bonuses
 * Maps card name (lowercase) to { power, toughness } bonus
 */
const AURA_BONUSES: Record<string, { power: number; toughness: number }> = {
  // Common auras
  "rancor": { power: 2, toughness: 0 },
  "ethereal armor": { power: 0, toughness: 0 }, // Variable +1/+1 per enchantment
  "ancestral mask": { power: 0, toughness: 0 }, // Variable +2/+2 per enchantment
  "holy strength": { power: 1, toughness: 2 },
  "unholy strength": { power: 2, toughness: 1 },
  "armadillo cloak": { power: 2, toughness: 2 },
  "unflinching courage": { power: 2, toughness: 2 },
  "eldrazi conscription": { power: 10, toughness: 10 },
  "daybreak coronet": { power: 3, toughness: 3 },
  "bear umbra": { power: 2, toughness: 2 },
  "snake umbra": { power: 1, toughness: 1 },
  "spider umbra": { power: 1, toughness: 1 },
  "hyena umbra": { power: 1, toughness: 1 },
  "mammoth umbra": { power: 3, toughness: 3 },
  "eel umbra": { power: 1, toughness: 1 },
  "boar umbra": { power: 3, toughness: 3 },
  "griffin guide": { power: 2, toughness: 2 },
  "spirit link": { power: 0, toughness: 0 },
  "spirit mantle": { power: 1, toughness: 1 },
  "gift of orzhova": { power: 1, toughness: 1 },
  "angelic destiny": { power: 4, toughness: 4 },
  "battle mastery": { power: 0, toughness: 0 }, // Double strike only
  "aqueous form": { power: 0, toughness: 0 },
  "curiosity": { power: 0, toughness: 0 },
  "keen sense": { power: 0, toughness: 0 },
  "shielded by faith": { power: 0, toughness: 0 },
  "spectra ward": { power: 2, toughness: 2 },
  "all that glitters": { power: 0, toughness: 0 }, // Variable
  "on serra's wings": { power: 1, toughness: 1 },
  "cartouche of strength": { power: 1, toughness: 1 },
  "cartouche of solidarity": { power: 1, toughness: 1 },
  "cartouche of knowledge": { power: 1, toughness: 1 },
  "cartouche of zeal": { power: 1, toughness: 1 },
  "cartouche of ambition": { power: 1, toughness: 1 },
  "sage's reverie": { power: 0, toughness: 0 }, // Variable
  "sigarda's aid": { power: 0, toughness: 0 },
  "flickering ward": { power: 0, toughness: 0 },
  "conviction": { power: 1, toughness: 3 },
  "sentinel's eyes": { power: 1, toughness: 1 },
  "setessan training": { power: 1, toughness: 0 },
  "solid footing": { power: 1, toughness: 1 },
  "warbriar blessing": { power: 0, toughness: 2 },
  "hydra's growth": { power: 0, toughness: 0 }, // Doubles +1/+1 counters
  "phyresis": { power: 0, toughness: 0 },
  "felidar umbra": { power: 1, toughness: 1 },
  "dueling rapier": { power: 2, toughness: 0 },
  "mirror shield": { power: 0, toughness: 2 },
  "mantle of the wolf": { power: 4, toughness: 4 },
  "kenrith's transformation": { power: 0, toughness: 0 }, // Sets to 3/3
  "frogify": { power: 0, toughness: 0 }, // Sets to 1/1
  "kasmina's transmutation": { power: 0, toughness: 0 }, // Sets to 1/1
  "lignify": { power: 0, toughness: 0 }, // Sets to 0/4
  "darksteel mutation": { power: 0, toughness: 0 }, // Sets to 0/1
  "imprisoned in the moon": { power: 0, toughness: 0 }, // Removes creature type
  "song of the dryads": { power: 0, toughness: 0 }, // Removes creature type
};

/**
 * Known global enchantments that give bonuses to creatures
 * Maps card name (lowercase) to a function that calculates the bonus
 */
const GLOBAL_ENCHANTMENT_BONUSES: Record<string, {
  power: number;
  toughness: number;
  condition?: (creature: any, controller: string, gameState?: any) => boolean;
}> = {
  "glorious anthem": { power: 1, toughness: 1 },
  "honor of the pure": { power: 1, toughness: 1, condition: (c) => (c.card?.colors || []).includes('W') || (c.card?.type_line || '').toLowerCase().includes('white') },
  "crusade": { power: 1, toughness: 1, condition: (c) => (c.card?.colors || []).includes('W') },
  "bad moon": { power: 1, toughness: 1, condition: (c) => (c.card?.colors || []).includes('B') },
  "gaea's anthem": { power: 1, toughness: 1 },
  "dictate of heliod": { power: 2, toughness: 2 },
  "intangible virtue": { power: 1, toughness: 1, condition: (c) => (c.card?.type_line || '').toLowerCase().includes('token') || c.isToken },
  "force of virtue": { power: 1, toughness: 1 },
  "always watching": { power: 1, toughness: 1, condition: (c) => !(c.card?.type_line || '').toLowerCase().includes('token') && !c.isToken },
  "spear of heliod": { power: 1, toughness: 1 },
  "marshal's anthem": { power: 1, toughness: 1 },
  "collective blessing": { power: 3, toughness: 3 },
  "cathars' crusade": { power: 0, toughness: 0 }, // Handled via counters
  "shared animosity": { power: 0, toughness: 0 }, // Variable
  "true conviction": { power: 0, toughness: 0 }, // No P/T bonus, just keywords
  // Leyline of Hope: "If you have at least 7 life more than your starting life total, 
  // creatures you control get +2/+2."
  // In Commander, starting life is typically 40, so you need 47+ life for the bonus.
  "leyline of hope": { 
    power: 2, 
    toughness: 2, 
    condition: (_c, controllerId, gameState) => {
      if (!gameState) return false;
      const startingLife = gameState.startingLife || 40;
      const currentLife = gameState.life?.[controllerId] ?? startingLife;
      // Condition: current life >= starting life + 7
      return currentLife >= startingLife + 7;
    }
  },
};

/**
 * Known lord creatures that give bonuses to other creatures
 * Maps card name (lowercase) to bonus info
 */
const LORD_BONUSES: Record<string, {
  power: number;
  toughness: number;
  creatureType?: string;
  condition?: (creature: any, lord: any) => boolean;
}> = {
  "lord of atlantis": { power: 1, toughness: 1, creatureType: "merfolk" },
  "goblin king": { power: 1, toughness: 1, creatureType: "goblin" },
  "zombie master": { power: 0, toughness: 0, creatureType: "zombie" }, // Grants abilities, no P/T
  "elvish archdruid": { power: 1, toughness: 1, creatureType: "elf" },
  "elvish champion": { power: 1, toughness: 1, creatureType: "elf" },
  "lord of the unreal": { power: 1, toughness: 1, creatureType: "illusion" },
  "death baron": { power: 1, toughness: 1, condition: (c) => {
    const typeLine = (c.card?.type_line || '').toLowerCase();
    return typeLine.includes('skeleton') || typeLine.includes('zombie');
  }},
  "captivating vampire": { power: 1, toughness: 1, creatureType: "vampire" },
  "lord of the accursed": { power: 1, toughness: 1, creatureType: "zombie" },
  "merrow reejerey": { power: 1, toughness: 1, creatureType: "merfolk" },
  "goblin chieftain": { power: 1, toughness: 1, creatureType: "goblin" },
  "imperious perfect": { power: 1, toughness: 1, creatureType: "elf" },
  "drogskol captain": { power: 1, toughness: 1, creatureType: "spirit" },
  "stromkirk captain": { power: 1, toughness: 1, creatureType: "vampire" },
  "diregraf captain": { power: 1, toughness: 1, creatureType: "zombie" },
  "immerwolf": { power: 1, toughness: 1, creatureType: "wolf" },
  "mayor of avabruck": { power: 1, toughness: 1, creatureType: "human" },
  "angel of jubilation": { power: 1, toughness: 1, condition: (c) => !(c.card?.colors || []).includes('B') },
  "mikaeus, the unhallowed": { power: 1, toughness: 1, condition: (c) => !(c.card?.type_line || '').toLowerCase().includes('human') },
  "oona's blackguard": { power: 1, toughness: 1, creatureType: "rogue" },
  "sliver legion": { power: 0, toughness: 0, creatureType: "sliver" }, // Variable per sliver
  "coat of arms": { power: 0, toughness: 0 }, // Variable
};

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
  const creatureTypeLine = (creaturePerm.card?.type_line || '').toLowerCase();
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  // Pass gameState for variable equipment calculations
  const equipBonus = calculateEquipmentBonus(creaturePerm, battlefield, gameState);
  powerBonus += equipBonus.power;
  toughnessBonus += equipBonus.toughness;
  
  // 2. Global enchantment bonuses
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    const typeLine = (perm.card.type_line || '').toLowerCase();
    
    // Only check enchantments controlled by the same player (most anthem effects)
    if (!typeLine.includes('enchantment')) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const enchantBonus = GLOBAL_ENCHANTMENT_BONUSES[cardName];
    
    if (enchantBonus && perm.controller === controllerId) {
      // Check condition if any (pass gameState for conditions that need it like Leyline of Hope)
      if (!enchantBonus.condition || enchantBonus.condition(creaturePerm, controllerId, gameState)) {
        powerBonus += enchantBonus.power;
        toughnessBonus += enchantBonus.toughness;
      }
    }
    
    // Parse generic "creatures you control get +X/+Y" from oracle text
    if (perm.controller === controllerId) {
      const oracleText = perm.card.oracle_text || '';
      const anthemMatch = oracleText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
      if (anthemMatch && !enchantBonus) { // Don't double count known enchantments
        powerBonus += parseInt(anthemMatch[1], 10);
        toughnessBonus += parseInt(anthemMatch[2], 10);
      }
    }
  }
  
  // 3. Lord/tribal bonuses from other creatures
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.id === creaturePerm.id) continue; // Can't buff itself (usually)
    if (perm.controller !== controllerId) continue; // Lords usually only buff your creatures
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const lordBonus = LORD_BONUSES[cardName];
    
    if (lordBonus) {
      // Check if creature matches the lord's creature type requirement
      if (lordBonus.creatureType) {
        if (creatureTypeLine.includes(lordBonus.creatureType)) {
          powerBonus += lordBonus.power;
          toughnessBonus += lordBonus.toughness;
        }
      } else if (lordBonus.condition) {
        if (lordBonus.condition(creaturePerm, perm)) {
          powerBonus += lordBonus.power;
          toughnessBonus += lordBonus.toughness;
        }
      }
    }
    
    // Parse generic "other [type] creatures you control get +X/+Y" from oracle text
    const oracleText = perm.card.oracle_text || '';
    const lordMatch = oracleText.match(/other (\w+) creatures you control get \+(\d+)\/\+(\d+)/i);
    if (lordMatch && !lordBonus) { // Don't double count known lords
      const targetType = lordMatch[1].toLowerCase();
      if (creatureTypeLine.includes(targetType)) {
        powerBonus += parseInt(lordMatch[2], 10);
        toughnessBonus += parseInt(lordMatch[3], 10);
      }
    }
    
    // "Other creatures you control get +X/+Y" (no type restriction)
    const genericLordMatch = oracleText.match(/other creatures you control get \+(\d+)\/\+(\d+)/i);
    if (genericLordMatch && !lordBonus) {
      powerBonus += parseInt(genericLordMatch[1], 10);
      toughnessBonus += parseInt(genericLordMatch[2], 10);
    }
  }
  
  // 4. Artifact bonuses (non-equipment)
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== controllerId) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('artifact') || typeLine.includes('equipment')) continue;
    
    const oracleText = perm.card.oracle_text || '';
    
    // Artifacts that give creatures bonuses
    const artifactAnthemMatch = oracleText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (artifactAnthemMatch) {
      powerBonus += parseInt(artifactAnthemMatch[1], 10);
      toughnessBonus += parseInt(artifactAnthemMatch[2], 10);
    }
  }
  
  // 5. Temporary pump effects (from modifiers) - includes Giant Growth, etc.
  // These are spells/abilities that give +X/+Y until end of turn
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH') {
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

/**
 * Source of a P/T bonus for display in tooltips
 */
export interface PTBonusSource {
  name: string;           // Name of the source (card name, "Counters", etc.)
  power: number;          // Power bonus from this source
  toughness: number;      // Toughness bonus from this source
  type: 'equipment' | 'aura' | 'enchantment' | 'creature' | 'artifact' | 'counter' | 'modifier' | 'emblem' | 'other';
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
  const creatureTypeLine = (creaturePerm.card?.type_line || '').toLowerCase();
  
  // 1. Equipment and Aura bonuses (attached to this creature)
  const equipSources = calculateEquipmentBonusWithSources(creaturePerm, battlefield, gameState);
  sources.push(...equipSources.sources);
  
  // 2. Global enchantment bonuses
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    const typeLine = (perm.card.type_line || '').toLowerCase();
    
    if (!typeLine.includes('enchantment')) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const enchantBonus = GLOBAL_ENCHANTMENT_BONUSES[cardName];
    
    if (enchantBonus && perm.controller === controllerId) {
      if (!enchantBonus.condition || enchantBonus.condition(creaturePerm, controllerId, gameState)) {
        if (enchantBonus.power !== 0 || enchantBonus.toughness !== 0) {
          sources.push({
            name: perm.card.name || 'Enchantment',
            power: enchantBonus.power,
            toughness: enchantBonus.toughness,
            type: 'enchantment',
          });
        }
      }
    }
    
    // Parse generic "creatures you control get +X/+Y" or "-X/-Y" from oracle text
    if (perm.controller === controllerId && !enchantBonus) {
      const oracleText = perm.card.oracle_text || '';
      const anthemMatch = oracleText.match(/creatures you control get ([+-]?\d+)\/([+-]?\d+)/i);
      if (anthemMatch) {
        const p = parseInt(anthemMatch[1], 10);
        const t = parseInt(anthemMatch[2], 10);
        if (p !== 0 || t !== 0) {
          sources.push({
            name: perm.card.name || 'Enchantment',
            power: p,
            toughness: t,
            type: 'enchantment',
          });
        }
      }
    }
  }
  
  // 3. Lord/tribal bonuses from other creatures
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.id === creaturePerm.id) continue;
    if (perm.controller !== controllerId) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const lordBonus = LORD_BONUSES[cardName];
    
    if (lordBonus) {
      let applies = false;
      if (lordBonus.creatureType && creatureTypeLine.includes(lordBonus.creatureType)) {
        applies = true;
      } else if (lordBonus.condition && lordBonus.condition(creaturePerm, perm)) {
        applies = true;
      }
      
      if (applies && (lordBonus.power !== 0 || lordBonus.toughness !== 0)) {
        sources.push({
          name: perm.card.name || 'Lord',
          power: lordBonus.power,
          toughness: lordBonus.toughness,
          type: 'creature',
        });
      }
    }
    
    // Parse generic lord patterns
    const oracleText = perm.card.oracle_text || '';
    if (!lordBonus) {
      const lordMatch = oracleText.match(/other (\w+) creatures you control get \+(\d+)\/\+(\d+)/i);
      if (lordMatch) {
        const targetType = lordMatch[1].toLowerCase();
        if (creatureTypeLine.includes(targetType)) {
          const p = parseInt(lordMatch[2], 10);
          const t = parseInt(lordMatch[3], 10);
          sources.push({
            name: perm.card.name || 'Lord',
            power: p,
            toughness: t,
            type: 'creature',
          });
        }
      }
      
      const genericLordMatch = oracleText.match(/other creatures you control get \+(\d+)\/\+(\d+)/i);
      if (genericLordMatch) {
        const p = parseInt(genericLordMatch[1], 10);
        const t = parseInt(genericLordMatch[2], 10);
        sources.push({
          name: perm.card.name || 'Lord',
          power: p,
          toughness: t,
          type: 'creature',
        });
      }
    }
  }
  
  // 4. Artifact bonuses (non-equipment)
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.controller !== controllerId) continue;
    
    const typeLine = (perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('artifact') || typeLine.includes('equipment')) continue;
    
    const oracleText = perm.card.oracle_text || '';
    const artifactAnthemMatch = oracleText.match(/creatures you control get \+(\d+)\/\+(\d+)/i);
    if (artifactAnthemMatch) {
      const p = parseInt(artifactAnthemMatch[1], 10);
      const t = parseInt(artifactAnthemMatch[2], 10);
      sources.push({
        name: perm.card.name || 'Artifact',
        power: p,
        toughness: t,
        type: 'artifact',
      });
    }
  }
  
  // 5. Temporary pump effects (modifiers)
  if (creaturePerm.modifiers && Array.isArray(creaturePerm.modifiers)) {
    for (const mod of creaturePerm.modifiers) {
      if (mod.type === 'pump' || mod.type === 'PUMP' || 
          mod.type === 'ptBoost' || mod.type === 'PT_BOOST' ||
          mod.type === 'temporary_pump' || mod.type === 'TEMPORARY_PUMP' ||
          mod.type === 'giantGrowth' || mod.type === 'GIANT_GROWTH') {
        const p = mod.power || mod.powerBonus || 0;
        const t = mod.toughness || mod.toughnessBonus || 0;
        if (p !== 0 || t !== 0) {
          sources.push({
            name: mod.sourceName || 'Pump effect',
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
  const zones = gameState?.zones || {};
  
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
    
    // Variable equipment
    if (cardName.includes('cranial plating')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      sources.push({ name: perm.card.name, power: artifacts.length, toughness: 0, type: sourceType });
      continue;
    }
    
    if (cardName.includes('nettlecyst')) {
      const count = battlefield.filter((p: any) => {
        if (p.controller !== controllerId) return false;
        const tl = (p.card?.type_line || '').toLowerCase();
        return tl.includes('artifact') || tl.includes('enchantment');
      }).length;
      sources.push({ name: perm.card.name, power: count, toughness: count, type: sourceType });
      continue;
    }
    
    if (cardName.includes('blackblade reforged')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      sources.push({ name: perm.card.name, power: lands.length, toughness: lands.length, type: sourceType });
      continue;
    }
    
    // Known static equipment/aura bonuses
    if (EQUIPMENT_BONUSES[cardName]) {
      const bonus = EQUIPMENT_BONUSES[cardName];
      if (bonus.power !== 0 || bonus.toughness !== 0) {
        sources.push({ name: perm.card.name, power: bonus.power, toughness: bonus.toughness, type: sourceType });
      }
      continue;
    }
    
    if (AURA_BONUSES[cardName]) {
      const bonus = AURA_BONUSES[cardName];
      if (bonus.power !== 0 || bonus.toughness !== 0) {
        sources.push({ name: perm.card.name, power: bonus.power, toughness: bonus.toughness, type: sourceType });
      }
      continue;
    }
    
    // Parse from oracle text
    const bonusMatch = oracleText.match(/equipped creature gets? \+(\d+)\/\+(\d+)/i);
    if (bonusMatch) {
      sources.push({ name: perm.card.name, power: parseInt(bonusMatch[1], 10), toughness: parseInt(bonusMatch[2], 10), type: sourceType });
      continue;
    }
    
    const negativeToughnessMatch = oracleText.match(/equipped creature gets? \+(\d+)\/(-\d+)/i);
    if (negativeToughnessMatch) {
      sources.push({ name: perm.card.name, power: parseInt(negativeToughnessMatch[1], 10), toughness: parseInt(negativeToughnessMatch[2], 10), type: sourceType });
      continue;
    }
    
    const auraMatch = oracleText.match(/enchanted creature gets? \+(\d+)\/\+(\d+)/i);
    if (auraMatch) {
      sources.push({ name: perm.card.name, power: parseInt(auraMatch[1], 10), toughness: parseInt(auraMatch[2], 10), type: sourceType });
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
  const zones = gameState?.zones || {};
  
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
    
    // ===== VARIABLE EQUIPMENT BONUSES =====
    
    // Cranial Plating - +1/+0 for each artifact you control
    if (cardName.includes('cranial plating')) {
      const artifacts = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('artifact')
      );
      powerBonus += artifacts.length;
      continue;
    }
    
    // Nettlecyst - +1/+1 for each artifact and enchantment you control
    if (cardName.includes('nettlecyst')) {
      const artifactsAndEnchantments = battlefield.filter((p: any) => {
        if (p.controller !== controllerId) return false;
        const tl = (p.card?.type_line || '').toLowerCase();
        return tl.includes('artifact') || tl.includes('enchantment');
      });
      const bonus = artifactsAndEnchantments.length;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // Blackblade Reforged - +1/+1 for each land you control
    if (cardName.includes('blackblade reforged')) {
      const lands = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('land')
      );
      const bonus = lands.length;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // Bonehoard - +X/+X where X is creatures in all graveyards
    if (cardName.includes('bonehoard')) {
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
      powerBonus += creatureCount;
      toughnessBonus += creatureCount;
      continue;
    }
    
    // Runechanter's Pike - +X/+0 where X is instants and sorceries in your graveyard
    if (cardName.includes("runechanter's pike")) {
      const playerZones = zones[controllerId];
      const graveyard = playerZones?.graveyard || [];
      let count = 0;
      for (const card of graveyard) {
        const tl = (card.type_line || '').toLowerCase();
        if (tl.includes('instant') || tl.includes('sorcery')) {
          count++;
        }
      }
      powerBonus += count;
      continue;
    }
    
    // Trepanation Blade - variable based on last attack (stored on equipment)
    if (cardName.includes('trepanation blade')) {
      // The bonus is determined when attacking and stored on the equipment
      const storedBonus = perm.trepanationBonus || perm.lastTrepanationBonus || 0;
      powerBonus += storedBonus;
      continue;
    }
    
    // Stoneforge Masterwork - +1/+1 for each creature sharing a type with equipped creature
    if (cardName.includes('stoneforge masterwork')) {
      const creatureTypes = extractCreatureTypes(creaturePerm.card?.type_line || '');
      let matchCount = 0;
      for (const p of battlefield) {
        if (!p || !p.card || p.id === creaturePerm.id) continue;
        if (p.controller !== controllerId) continue;
        const pTypeLine = (p.card.type_line || '').toLowerCase();
        if (!pTypeLine.includes('creature')) continue;
        
        for (const cType of creatureTypes) {
          if (pTypeLine.includes(cType.toLowerCase())) {
            matchCount++;
            break;
          }
        }
      }
      powerBonus += matchCount;
      toughnessBonus += matchCount;
      continue;
    }
    
    // Conqueror's Flail - +1/+1 for each color among permanents you control
    if (cardName.includes("conqueror's flail")) {
      const colors = new Set<string>();
      for (const p of battlefield) {
        if (p.controller !== controllerId) continue;
        const cardColors = p.card?.colors || [];
        for (const c of cardColors) {
          colors.add(c);
        }
      }
      const bonus = colors.size;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // All That Glitters - +1/+1 for each artifact and enchantment you control
    if (cardName.includes('all that glitters')) {
      const count = battlefield.filter((p: any) => {
        if (p.controller !== controllerId) return false;
        const tl = (p.card?.type_line || '').toLowerCase();
        return tl.includes('artifact') || tl.includes('enchantment');
      }).length;
      powerBonus += count;
      toughnessBonus += count;
      continue;
    }
    
    // Ethereal Armor - +1/+1 for each enchantment you control
    if (cardName.includes('ethereal armor')) {
      const enchantments = battlefield.filter((p: any) => 
        p.controller === controllerId && 
        (p.card?.type_line || '').toLowerCase().includes('enchantment')
      );
      const bonus = enchantments.length;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // Ancestral Mask - +2/+2 for each other enchantment on the battlefield
    if (cardName.includes('ancestral mask')) {
      const enchantments = battlefield.filter((p: any) => {
        if (p.id === perm.id) return false; // Don't count itself
        return (p.card?.type_line || '').toLowerCase().includes('enchantment');
      });
      const bonus = enchantments.length * 2;
      powerBonus += bonus;
      toughnessBonus += bonus;
      continue;
    }
    
    // ===== CHECK KNOWN STATIC EQUIPMENT BONUSES =====
    if (EQUIPMENT_BONUSES[cardName]) {
      powerBonus += EQUIPMENT_BONUSES[cardName].power;
      toughnessBonus += EQUIPMENT_BONUSES[cardName].toughness;
      continue;
    }
    
    // Check known aura bonuses
    if (AURA_BONUSES[cardName]) {
      powerBonus += AURA_BONUSES[cardName].power;
      toughnessBonus += AURA_BONUSES[cardName].toughness;
      continue;
    }
    
    // Try to parse bonus from oracle text for unknown equipment
    const bonusMatch = oracleText.match(/equipped creature gets? \+(\d+)\/\+(\d+)/i);
    if (bonusMatch) {
      powerBonus += parseInt(bonusMatch[1], 10);
      toughnessBonus += parseInt(bonusMatch[2], 10);
      continue;
    }
    
    // Handle negative toughness (like Skullclamp's -1)
    const negativeToughnessMatch = oracleText.match(/equipped creature gets? \+(\d+)\/(-\d+)/i);
    if (negativeToughnessMatch) {
      powerBonus += parseInt(negativeToughnessMatch[1], 10);
      toughnessBonus += parseInt(negativeToughnessMatch[2], 10);
      continue;
    }
    
    // Try aura pattern
    const auraMatch = oracleText.match(/enchanted creature gets? \+(\d+)\/\+(\d+)/i);
    if (auraMatch) {
      powerBonus += parseInt(auraMatch[1], 10);
      toughnessBonus += parseInt(auraMatch[2], 10);
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
  
  console.log(`[addEnergyCounters] ${playerId} gained ${amount} energy${source ? ` from ${source}` : ''} (total: ${energy[playerId]})`);
  
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
    console.log(`[spendEnergyCounters] ${playerId} cannot spend ${amount} energy (only has ${currentEnergy})`);
    return false;
  }
  
  energy[playerId] = currentEnergy - amount;
  console.log(`[spendEnergyCounters] ${playerId} spent ${amount} energy (remaining: ${energy[playerId]})`);
  
  return true;
}

/**
 * Get the current energy count for a player.
 */
export function getEnergyCount(gameState: any, playerId: string): number {
  if (!gameState || !playerId) return 0;
  return gameState.energy?.[playerId] || 0;
}