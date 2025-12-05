/**
 * triggers/registry.ts
 * 
 * Trigger registration and management system.
 * Handles registering/unregistering triggers when permanents enter/leave the battlefield.
 */

import type { GameContext, RegisteredTrigger, TriggerTiming } from "./types.js";

/**
 * Determines if a trigger effect is mandatory based on its text.
 * Optional triggers contain phrases like "you may" or "may choose".
 */
function isMandatoryEffect(effectText: string): boolean {
  const lowerEffect = effectText.toLowerCase();
  return !lowerEffect.includes('you may') && !lowerEffect.includes('may choose');
}

/**
 * Analyze a card and return all triggers it has.
 * This is called when a permanent enters the battlefield to register its triggers.
 */
export function analyzeCardTriggers(card: any, permanentId: string, controllerId: string): RegisteredTrigger[] {
  const triggers: RegisteredTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  
  // Upkeep triggers (text is already lowercased, no need for /i flag)
  const upkeepMatch = oracleText.match(/at the beginning of (?:your )?upkeep,?\s*([^.]+)/);
  if (upkeepMatch) {
    const effect = upkeepMatch[1].trim();
    triggers.push({
      id: `${permanentId}_upkeep`,
      permanentId,
      controllerId,
      cardName,
      timing: 'upkeep',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // End step triggers
  const endStepMatch = oracleText.match(/at the beginning of (?:your |each )?end step,?\s*([^.]+)/);
  if (endStepMatch) {
    const effect = endStepMatch[1].trim();
    triggers.push({
      id: `${permanentId}_end_step`,
      permanentId,
      controllerId,
      cardName,
      timing: 'end_step',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // ETB triggers (self) - text is already lowercased
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  const etbSelfMatch = oracleText.match(/when (?:~|this creature|this permanent|this enchantment) enters(?: the battlefield)?,?\s*([^.]+)/);
  if (etbSelfMatch) {
    const effect = etbSelfMatch[1].trim();
    triggers.push({
      id: `${permanentId}_etb_self`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'self',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // ETB triggers (other creatures)
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles plural forms: "creatures enter" / "one or more creatures enter"
  // Handles: "a creature", "another creature", "one or more creatures", "other creatures"
  const etbCreatureMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/);
  if (etbCreatureMatch) {
    const effect = etbCreatureMatch[1].trim();
    triggers.push({
      id: `${permanentId}_etb_creature`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'creature',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // ETB triggers (artifacts)
  // Handles plural forms and "another"/"other" variants
  const etbArtifactMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?artifacts? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/);
  if (etbArtifactMatch) {
    const effect = etbArtifactMatch[1].trim();
    triggers.push({
      id: `${permanentId}_etb_artifact`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'artifact',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // ETB triggers (enchantments)
  // Handles plural forms and "another"/"other" variants
  const etbEnchantmentMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?enchantments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/);
  if (etbEnchantmentMatch) {
    const effect = etbEnchantmentMatch[1].trim();
    triggers.push({
      id: `${permanentId}_etb_enchantment`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'enchantment',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // ETB triggers (permanents - any type)
  // Handles plural forms and "another"/"other" variants
  const etbPermanentMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?permanents? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/);
  if (etbPermanentMatch) {
    const effect = etbPermanentMatch[1].trim();
    triggers.push({
      id: `${permanentId}_etb_permanent`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'permanent',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Attack triggers
  const attackMatch = oracleText.match(/whenever (?:~|this creature) attacks,?\s*([^.]+)/);
  if (attackMatch) {
    const effect = attackMatch[1].trim();
    triggers.push({
      id: `${permanentId}_attack`,
      permanentId,
      controllerId,
      cardName,
      timing: 'declare_attackers',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Combat damage triggers
  const combatDamageMatch = oracleText.match(/whenever (?:~|this creature) deals combat damage to (?:a player|an opponent),?\s*([^.]+)/);
  if (combatDamageMatch) {
    const effect = combatDamageMatch[1].trim();
    triggers.push({
      id: `${permanentId}_combat_damage`,
      permanentId,
      controllerId,
      cardName,
      timing: 'combat_damage',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Death triggers
  const deathMatch = oracleText.match(/when (?:~|this creature) dies,?\s*([^.]+)/);
  if (deathMatch) {
    const effect = deathMatch[1].trim();
    triggers.push({
      id: `${permanentId}_dies`,
      permanentId,
      controllerId,
      cardName,
      timing: 'dies',
      condition: 'self',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Whenever a creature you control dies
  const creatureDiesMatch = oracleText.match(/whenever (?:a|another) creature you control dies,?\s*([^.]+)/);
  if (creatureDiesMatch) {
    const effect = creatureDiesMatch[1].trim();
    triggers.push({
      id: `${permanentId}_creature_dies`,
      permanentId,
      controllerId,
      cardName,
      timing: 'dies',
      condition: 'controlled_creature',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Tap triggers
  const tapMatch = oracleText.match(/whenever (?:~|this creature) becomes tapped,?\s*([^.]+)/);
  if (tapMatch) {
    const effect = tapMatch[1].trim();
    triggers.push({
      id: `${permanentId}_tap`,
      permanentId,
      controllerId,
      cardName,
      timing: 'tap',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Draw triggers
  const drawMatch = oracleText.match(/whenever (?:you|a player|an opponent) draws? (?:a card|cards),?\s*([^.]+)/);
  if (drawMatch) {
    const effect = drawMatch[1].trim();
    triggers.push({
      id: `${permanentId}_draw`,
      permanentId,
      controllerId,
      cardName,
      timing: 'draw',
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  // Cast triggers - handle optional spell type
  const castMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell,?\s*([^.]+)/);
  if (castMatch) {
    const spellType = castMatch[1] || 'any';
    const effect = castMatch[2].trim();
    triggers.push({
      id: `${permanentId}_cast`,
      permanentId,
      controllerId,
      cardName,
      timing: 'cast',
      condition: spellType,
      effect,
      mandatory: isMandatoryEffect(effect),
    });
  }
  
  return triggers;
}

/**
 * Register all triggers for a permanent when it enters the battlefield
 */
export function registerPermanentTriggers(ctx: GameContext, permanent: any): void {
  const state = (ctx as any).state;
  if (!state) return;
  
  // Initialize trigger registry if needed
  state.triggerRegistry = state.triggerRegistry || {};
  
  const card = permanent?.card;
  const permanentId = permanent?.id;
  const controllerId = permanent?.controller;
  
  if (!card || !permanentId || !controllerId) return;
  
  const triggers = analyzeCardTriggers(card, permanentId, controllerId);
  
  for (const trigger of triggers) {
    // Register by timing for efficient lookup
    state.triggerRegistry[trigger.timing] = state.triggerRegistry[trigger.timing] || [];
    state.triggerRegistry[trigger.timing].push(trigger);
  }
  
  if (triggers.length > 0) {
    console.log(`[registerPermanentTriggers] Registered ${triggers.length} trigger(s) for ${card.name}`);
  }
}

/**
 * Unregister all triggers for a permanent when it leaves the battlefield
 */
export function unregisterPermanentTriggers(ctx: GameContext, permanentId: string): void {
  const state = (ctx as any).state;
  if (!state?.triggerRegistry) return;
  
  for (const timing of Object.keys(state.triggerRegistry)) {
    state.triggerRegistry[timing] = state.triggerRegistry[timing].filter(
      (t: RegisteredTrigger) => t.permanentId !== permanentId
    );
  }
}

/**
 * Get all triggers that should fire for a given timing
 */
export function getTriggersForTiming(ctx: GameContext, timing: TriggerTiming, activePlayerId?: string): RegisteredTrigger[] {
  const state = (ctx as any).state;
  if (!state?.triggerRegistry?.[timing]) return [];
  
  const triggers = state.triggerRegistry[timing] as RegisteredTrigger[];
  
  // Filter by active player if needed (for "your upkeep" vs "each upkeep" triggers)
  if (activePlayerId) {
    return triggers.filter((t: RegisteredTrigger) => {
      // Check if this is the controller's trigger
      if (t.controllerId === activePlayerId) return true;
      // Check if it's an "each player" type trigger
      if (t.effect.includes('each player') || t.effect.includes('all players')) return true;
      return false;
    });
  }
  
  return triggers;
}

/**
 * Group triggers by controller for APNAP ordering
 * Active Player, Non-Active Player ordering for simultaneous triggers
 */
export function groupTriggersByController(
  triggers: RegisteredTrigger[], 
  activePlayerId: string,
  playerOrder: string[]
): Map<string, RegisteredTrigger[]> {
  const grouped = new Map<string, RegisteredTrigger[]>();
  
  // Initialize in APNAP order
  const orderedPlayers = [activePlayerId, ...playerOrder.filter(p => p !== activePlayerId)];
  for (const playerId of orderedPlayers) {
    grouped.set(playerId, []);
  }
  
  for (const trigger of triggers) {
    const existing = grouped.get(trigger.controllerId) || [];
    existing.push(trigger);
    grouped.set(trigger.controllerId, existing);
  }
  
  return grouped;
}
