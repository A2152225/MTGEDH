/**
 * upkeep-triggers.ts
 * 
 * Handles upkeep-related triggered abilities and costs:
 * - "At the beginning of your upkeep" triggers (very common!)
 * - "At the beginning of each player's upkeep" triggers
 * - "At the beginning of each upkeep" triggers
 * - Cumulative upkeep
 * - Echo
 * - Fading / Vanishing
 * - Pacts (pay or lose)
 * - Phyrexian Arena, Sheoldred, Dark Confidant style effects
 */

import type { GameContext } from "../context.js";

export interface UpkeepTrigger {
  permanentId: string;
  cardName: string;
  triggerType: 
    | 'cumulative_upkeep' 
    | 'echo' 
    | 'fading' 
    | 'vanishing' 
    | 'pact' 
    | 'upkeep_cost' 
    | 'upkeep_effect'
    | 'each_upkeep'
    | 'each_player_upkeep'
    | 'opponent_upkeep'
    | 'upkeep_create_copy';  // Progenitor Mimic - create token copy at beginning of upkeep
  cost?: string;
  description: string;
  effect?: string;
  counters?: number;
  mandatory: boolean;
  consequence?: string;
  requiresChoice?: boolean;
  controllerTrigger: boolean; // True if triggers on controller's upkeep
  anyPlayerTrigger: boolean;  // True if triggers on any player's upkeep
  copySourceId?: string; // For copy effects - the permanent to copy
}

/**
 * Common upkeep trigger patterns and their effects
 */
const KNOWN_UPKEEP_CARDS: Record<string, { effect: string; mandatory: boolean; requiresChoice?: boolean; requiresSacrifice?: boolean; anyPlayerTrigger?: boolean; endStepTrigger?: boolean }> = {
  // Draw/Life effects
  "phyrexian arena": { effect: "Draw a card, you lose 1 life", mandatory: true },
  "dark confidant": { effect: "Reveal top card, put in hand, lose life equal to its mana value", mandatory: true },
  "bob": { effect: "Reveal top card, put in hand, lose life equal to its mana value", mandatory: true },
  "sheoldred, the apocalypse": { effect: "Opponents lose 2 life when they draw", mandatory: true },
  "greed": { effect: "You may pay {B} and 2 life to draw a card", mandatory: false, requiresChoice: true },
  "necropotence": { effect: "Skip draw step (passive)", mandatory: true },
  "sylvan library": { effect: "Draw 2 extra cards, then put 2 back or pay 4 life each", mandatory: true, requiresChoice: true },
  "venser's journal": { effect: "Gain life equal to cards in hand", mandatory: true },
  "ivory tower": { effect: "Gain 1 life for each card in hand above 4", mandatory: true },
  "well of lost dreams": { effect: "Whenever you gain life, you may pay {X} to draw X cards", mandatory: false, requiresChoice: true },
  
  // Resource generation
  "smothering tithe": { effect: "When opponent draws, they pay {2} or you create Treasure", mandatory: true },
  "rhystic study": { effect: "When opponent casts, they pay {1} or you draw", mandatory: true },
  "mystic remora": { effect: "When opponent casts noncreature, they pay {4} or you draw", mandatory: true },
  "black market": { effect: "Add {B} for each charge counter", mandatory: true },
  "bitterblossom": { effect: "You lose 1 life, create a 1/1 black Faerie Rogue creature token with flying", mandatory: true },
  
  // Mana production at upkeep
  "shizuko, caller of autumn": { effect: "That player adds {G}{G}{G}. This mana doesn't empty until end of turn.", mandatory: true, anyPlayerTrigger: true },
  "citanul hierophants": { effect: "Creatures you control have tap for {G}", mandatory: true },
  
  // Counter manipulation
  "atraxa, praetors' voice": { effect: "Proliferate (at end step, not upkeep)", mandatory: true },
  "ezuri, claw of progress": { effect: "Put +1/+1 counters equal to experience", mandatory: true },
  "meren of clan nel toth": { effect: "Return creature from graveyard (end step)", mandatory: true },
  
  // Damage/Life loss
  "sulfuric vortex": { effect: "Each player loses 2 life", mandatory: true },
  "havoc festival": { effect: "Each player loses half their life", mandatory: true },
  "wound reflection": { effect: "Opponents lose life equal to life lost this turn (end step)", mandatory: true },
  
  // Token creation - Creatures that create tokens at upkeep
  "master of the wild hunt": { effect: "Create a 2/2 green Wolf creature token", mandatory: true },
  "verdant force": { effect: "Create a 1/1 green Saproling creature token", mandatory: true },
  "tendershoot dryad": { effect: "Create a 1/1 green Saproling creature token", mandatory: true },
  "awakening zone": { effect: "Create a 0/1 colorless Eldrazi Spawn creature token with sacrifice for mana", mandatory: true },
  "from beyond": { effect: "Create a 1/1 colorless Eldrazi Scion creature token with sacrifice for mana", mandatory: true },
  "assemble the legion": { effect: "Put a muster counter, create that many 1/1 red and white Soldier creature tokens with haste", mandatory: true },
  "progenitor mimic": { effect: "If this creature isn't a token, create a token that's a copy of this creature", mandatory: true },
  "ghoulcaller gisa": { effect: "Create 2/2 black Zombie creature tokens", mandatory: false, requiresChoice: true },
  "sliver queen": { effect: "Create a 1/1 colorless Sliver creature token (activated)", mandatory: false, requiresChoice: true },
  "krenko, mob boss": { effect: "Create 1/1 red Goblin creature tokens (activated)", mandatory: false, requiresChoice: true },
  "avenger of zendikar": { effect: "Landfall: Put +1/+1 counter on each Plant", mandatory: true },
  "chasm skulker": { effect: "Draw trigger: Put +1/+1 counter", mandatory: true },
  "najeela, the blade-blossom": { effect: "Whenever a Warrior attacks, create 1/1 white Warrior creature token", mandatory: true },
  "ophiomancer": { effect: "If you control no Snakes, create a 1/1 black Snake creature token with deathtouch", mandatory: true },
  "dragonmaster outcast": { effect: "If you control 6+ lands, create a 5/5 red Dragon creature token with flying", mandatory: true },
  "outlaws' merriment": { effect: "Create a 1/2 Human Cleric, 3/1 Human Rogue, or 2/3 Human Warrior token", mandatory: true },
  "dragon broodmother": { effect: "Create a 1/1 red and green Dragon creature token with flying and devour 2", mandatory: true },
  "scute swarm": { effect: "Landfall: Create 1/1 Insect or copy", mandatory: true },
  "dockside extortionist": { effect: "Create Treasure tokens (ETB only)", mandatory: true },
  "pest infestation": { effect: "Create 1/1 Pest tokens (sorcery)", mandatory: true },
  "anointed procession": { effect: "Double tokens (passive)", mandatory: true },
  "parallel lives": { effect: "Double creature tokens (passive)", mandatory: true },
  "doubling season": { effect: "Double tokens and counters (passive)", mandatory: true },
  
  // Sheoldred variants
  "sheoldred, whispering one": { effect: "Return creature from your graveyard to the battlefield; each opponent sacrifices a creature", mandatory: true, requiresSacrifice: true },
  
  // End step triggers (tracked here for completeness)
  "the second doctor": { effect: "Draw a card for each different mana value among nonland permanents you control", mandatory: true, endStepTrigger: true },
  
  // Tutoring/Library manipulation
  "search for azcanta": { effect: "Surveil 1, may transform if 7+ cards in graveyard", mandatory: true, requiresChoice: true },
  "sensei's divining top": { effect: "Look at top 3, rearrange (activated ability)", mandatory: false },
  
  // Restrictions/Stax
  "winter orb": { effect: "Lands don't untap (passive)", mandatory: true },
  "static orb": { effect: "Only untap 2 permanents (passive)", mandatory: true },
  "stasis": { effect: "Players skip untap step", mandatory: true },
  "tangle wire": { effect: "Remove fade counter, tap that many permanents", mandatory: true },
  
  // Sacrifice triggers
  "eldrazi monument": { effect: "Sacrifice a creature or sacrifice Eldrazi Monument", mandatory: true, requiresChoice: true, requiresSacrifice: true },
  "smokestack": { effect: "Each player sacrifices permanents equal to soot counters", mandatory: true, requiresSacrifice: true },
  "pox": { effect: "Sacrifice 1/3 of creatures, lands; lose 1/3 life", mandatory: true, requiresSacrifice: true },
  
  // Other common ones
  "luminarch ascension": { effect: "If no damage taken, add quest counter", mandatory: true },
  "court of": { effect: "Become monarch if not, trigger court effect", mandatory: true },
  "the gitrog monster": { effect: "Sacrifice a land", mandatory: true, requiresSacrifice: true },
  "luminous broodmoth": { effect: "When creature without flying dies, return with flying counter", mandatory: true },
  "hullbreacher": { effect: "If opponent would draw, they don't, you create Treasure instead", mandatory: true },
  "notion thief": { effect: "If opponent would draw, they don't, you draw instead", mandatory: true },
  "consecrated sphinx": { effect: "Whenever opponent draws, you may draw 2", mandatory: false, requiresChoice: true },
  "jin-gitaxias, core augur": { effect: "Draw 7 at end step; opponents max hand size 0", mandatory: true },
  "jin-gitaxias, progress tyrant": { effect: "Copy first artifact/instant/sorcery; counter first opponent spell", mandatory: true },
};

/**
 * Detect upkeep triggers from a card's oracle text
 */
export function detectUpkeepTriggers(card: any, permanent: any): UpkeepTrigger[] {
  const triggers: UpkeepTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  // Check known cards first for accurate descriptions
  for (const [knownName, info] of Object.entries(KNOWN_UPKEEP_CARDS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'upkeep_effect',
        description: info.effect,
        effect: info.effect,
        mandatory: info.mandatory,
        requiresChoice: info.requiresChoice,
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
      // Don't return early - card might have multiple triggers
    }
  }
  
  // Cumulative upkeep - adds age counter, pay cost for each
  const cumulativeMatch = oracleText.match(/cumulative upkeep[—\-\s]*(\{[^}]+\}(?:\s*\{[^}]+\})*|[^(.\n]+)/i);
  if (cumulativeMatch) {
    const ageCounters = (counters["age"] || 0) + 1;
    const cost = cumulativeMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'cumulative_upkeep',
      cost: cost,
      description: `Pay ${cost} for each age counter (will be ${ageCounters})`,
      counters: ageCounters,
      mandatory: false,
      consequence: `Sacrifice ${cardName}`,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Echo - pay echo cost on first upkeep after entering
  if (lowerOracle.includes("echo") && !permanent?.echoPaid) {
    const echoMatch = oracleText.match(/echo\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (echoMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'echo',
        cost: echoMatch[1],
        description: `Pay ${echoMatch[1]} or sacrifice`,
        mandatory: false,
        consequence: `Sacrifice ${cardName}`,
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
    }
  }
  
  // Fading - remove fade counter, sacrifice when none left
  if (lowerOracle.includes("fading")) {
    const fadeCounters = counters["fade"] || 0;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'fading',
      description: fadeCounters > 0 
        ? `Remove fade counter (${fadeCounters - 1} will remain)`
        : `No fade counters - sacrifice`,
      counters: fadeCounters,
      mandatory: true,
      consequence: fadeCounters <= 1 ? `Sacrifice ${cardName}` : undefined,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Vanishing - remove time counter, sacrifice when none left
  if (lowerOracle.includes("vanishing")) {
    const timeCounters = counters["time"] || 0;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vanishing',
      description: timeCounters > 0
        ? `Remove time counter (${timeCounters - 1} will remain)`
        : `No time counters - sacrifice`,
      counters: timeCounters,
      mandatory: true,
      consequence: timeCounters <= 1 ? `Sacrifice ${cardName}` : undefined,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Pacts - pay or lose the game
  if (lowerOracle.includes("pact") && lowerOracle.includes("lose the game")) {
    const pactMatch = oracleText.match(/pay\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (pactMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'pact',
        cost: pactMatch[1],
        description: `Pay ${pactMatch[1]} or lose the game`,
        mandatory: true,
        consequence: 'You lose the game',
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
    }
  }
  
  // "At the beginning of your upkeep" - most common pattern
  const yourUpkeepMatch = oracleText.match(/at the beginning of your upkeep,?\s*([^.]+)/i);
  if (yourUpkeepMatch && !triggers.some(t => t.triggerType === 'upkeep_effect')) {
    const effectText = yourUpkeepMatch[1].trim();
    const hasCost = effectText.toLowerCase().includes("pay") || effectText.toLowerCase().includes("sacrifice");
    const isOptional = effectText.toLowerCase().includes("you may") || effectText.toLowerCase().includes("may ");
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'upkeep_effect',
      description: effectText,
      effect: effectText,
      mandatory: !isOptional,
      requiresChoice: isOptional || hasCost,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // "At the beginning of each player's upkeep"
  const eachPlayerUpkeepMatch = oracleText.match(/at the beginning of each player's upkeep,?\s*([^.]+)/i);
  if (eachPlayerUpkeepMatch) {
    const effectText = eachPlayerUpkeepMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }
  
  // "At the beginning of each upkeep"
  const eachUpkeepMatch = oracleText.match(/at the beginning of each upkeep,?\s*([^.]+)/i);
  if (eachUpkeepMatch) {
    const effectText = eachUpkeepMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }
  
  // "At the beginning of each opponent's upkeep"
  const opponentUpkeepMatch = oracleText.match(/at the beginning of each opponent's upkeep,?\s*([^.]+)/i);
  if (opponentUpkeepMatch) {
    const effectText = opponentUpkeepMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: false,
      anyPlayerTrigger: false, // Only on opponent's turns
    });
  }
  
  return triggers;
}

/**
 * Get all upkeep triggers for the current player's upkeep
 */
export function getUpkeepTriggersForPlayer(ctx: GameContext, activePlayerId: string): UpkeepTrigger[] {
  const triggers: UpkeepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const players = Object.keys((ctx as any).zones || {});
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const controller = permanent.controller;
    const cardTriggers = detectUpkeepTriggers(permanent.card, permanent);
    
    for (const trigger of cardTriggers) {
      // Check if this trigger applies to the current upkeep
      const isControllerUpkeep = controller === activePlayerId;
      const isOpponentUpkeep = controller !== activePlayerId;
      
      if (trigger.anyPlayerTrigger) {
        // Triggers on any player's upkeep
        triggers.push(trigger);
      } else if (trigger.controllerTrigger && isControllerUpkeep) {
        // Triggers only on controller's upkeep
        triggers.push(trigger);
      } else if (trigger.triggerType === 'opponent_upkeep' && isOpponentUpkeep) {
        // Triggers on opponent's upkeep
        triggers.push(trigger);
      }
    }
  }
  
  // Sort by mandatory first, then by card name
  triggers.sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    return a.cardName.localeCompare(b.cardName);
  });
  
  return triggers;
}

/**
 * Process cumulative upkeep - add age counter
 */
export function addAgeCounter(ctx: GameContext, permanentId: string): number {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent) {
    const counters = { ...(permanent.counters || {}) };
    counters["age"] = (counters["age"] || 0) + 1;
    (permanent as any).counters = counters;
    ctx.bumpSeq();
    return counters["age"];
  }
  return 0;
}

/**
 * Process fading - remove fade counter
 */
export function removeFadeCounter(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && permanent.counters?.["fade"] > 0) {
    const counters = { ...(permanent.counters || {}) };
    counters["fade"] -= 1;
    (permanent as any).counters = counters;
    ctx.bumpSeq();
    return counters["fade"] > 0;
  }
  return false;
}

/**
 * Process vanishing - remove time counter
 */
export function removeTimeCounter(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && permanent.counters?.["time"] > 0) {
    const counters = { ...(permanent.counters || {}) };
    counters["time"] -= 1;
    (permanent as any).counters = counters;
    ctx.bumpSeq();
    return counters["time"] > 0;
  }
  return false;
}

/**
 * Mark echo as paid
 */
export function markEchoPaid(ctx: GameContext, permanentId: string): void {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent) {
    permanent.echoPaid = true;
    ctx.bumpSeq();
  }
}

/**
 * Sacrifice a permanent
 */
export function sacrificePermanent(ctx: GameContext, permanentId: string, playerId: string): string | null {
  const battlefield = ctx.state?.battlefield || [];
  const idx = battlefield.findIndex((p: any) => p?.id === permanentId);
  
  if (idx !== -1) {
    const permanent = battlefield.splice(idx, 1)[0];
    const cardName = permanent.card?.name || "Unknown";
    
    const zones = (ctx as any).zones?.[playerId];
    if (zones) {
      zones.graveyard = zones.graveyard || [];
      zones.graveyard.push({ ...permanent.card, zone: "graveyard" });
      zones.graveyardCount = zones.graveyard.length;
    }
    
    ctx.bumpSeq();
    return cardName;
  }
  return null;
}

