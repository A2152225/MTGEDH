/**
 * triggered-abilities.ts
 * 
 * Handles various triggered abilities in Magic:
 * 
 * DEATH TRIGGERS:
 * - "When ~ dies" / "Whenever ~ dies"
 * - "Whenever a creature you control dies" (Grave Pact, Blood Artist)
 * - "Whenever a creature dies" (Massacre Wurm)
 * - Undying (return with +1/+1 counter)
 * - Persist (return with -1/-1 counter)
 * 
 * ATTACK TRIGGERS:
 * - "Whenever ~ attacks" (Annihilator, combat damage triggers)
 * - "Whenever a creature you control attacks"
 * - "Whenever one or more creatures attack"
 * 
 * ETB TRIGGERS:
 * - "When ~ enters the battlefield"
 * - "Whenever a creature enters the battlefield"
 * 
 * DAMAGE TRIGGERS:
 * - "Whenever ~ deals combat damage"
 * - "Whenever ~ deals damage to a player"
 * 
 * ACTIVATED ABILITIES (not triggers, but commonly referenced):
 * - Firebreathing: "{R}: +1/+0"
 * - Shade: "{B}: +1/+1"
 * - Flying/evasion abilities
 * 
 * NOTE: This file is being modularized. New code should be added to the 
 * appropriate submodule in the triggers/ directory instead.
 */

import type { GameContext } from "../context.js";
import { calculateVariablePT, getActualPowerToughness } from "../utils.js";

// Import card data tables from modularized submodule
import {
  KNOWN_DEATH_TRIGGERS,
  KNOWN_ATTACK_TRIGGERS,
  KNOWN_UNTAP_TRIGGERS,
  KNOWN_CAST_TYPE_TRIGGERS,
  KNOWN_TAP_UNTAP_ABILITIES,
  KNOWN_ETB_TRIGGERS,
  KNOWN_COMBAT_DAMAGE_TRIGGERS,
  KNOWN_BEGINNING_COMBAT_TRIGGERS,
  KNOWN_END_STEP_TRIGGERS,
  KNOWN_PRECOMBAT_MAIN_TRIGGERS,
} from "./triggers/card-data-tables.js";

// Re-export from modularized submodules
export { calculateDevotion, getDevotionManaAmount } from "./triggers/devotion.js";
export { 
  checkWinConditions, 
  checkUpkeepWinConditions,
  type WinCondition,
} from "./triggers/win-conditions.js";
export {
  detectLandfallTriggers,
  getLandfallTriggers,
  type LandfallTrigger,
} from "./triggers/landfall.js";
export {
  checkEndOfTurnTransforms,
  checkUpkeepTransforms,
  type TransformCheckResult,
} from "./triggers/transform.js";
export {
  detectCardDrawTriggers,
  getCardDrawTriggers,
  type CardDrawTrigger,
} from "./triggers/card-draw.js";
export {
  detectLinkedExileEffect,
  registerLinkedExile,
  processLinkedExileReturns,
  getLinkedExilesForPermanent,
  isCardLinkedExile,
  type LinkedExile,
} from "./triggers/linked-exile.js";
export {
  detectReanimateCard,
  type ReanimateCardInfo,
} from "./triggers/reanimate.js";
export {
  AURAS_THAT_RETURN_TO_HAND,
  checkAuraGraveyardReturn,
} from "./triggers/aura-graveyard.js";
export {
  // End step triggers
  detectEndStepTriggers,
  getEndStepTriggers,
  type EndStepTrigger,
  // Draw step triggers
  detectDrawStepTriggers,
  getDrawStepTriggers,
  type DrawStepTrigger,
  // Untap step effects
  detectUntapStepEffects,
  getUntapStepEffects,
  applyUntapStepEffect,
  type UntapStepEffect,
  // Doesn't untap effects
  detectDoesntUntapEffects,
  isPermanentPreventedFromUntapping,
  type DoesntUntapEffect,
} from "./triggers/turn-phases.js";
// Control change effects (ETB under opponent control, etc.)
export {
  detectControlChangeEffects,
  hasControlChangeEffect,
  shouldEnterUnderOpponentControl,
  hasOptionalGiveControlETB,
  shouldGoadOnControlChange,
  mustAttackEachCombat,
  cantAttackOwner,
  applyControlChange,
  getAttackRestrictions as getControlChangeAttackRestrictions,
  getControlChangeConfig,
  isKnownControlChangeCard,
  logControlChange,
  KNOWN_CONTROL_CHANGE_CARDS,
  type ControlChangeType,
  type ControlChangeEffect as ETBControlChangeEffect,
} from "./triggers/control-change.js";

/**
 * Trigger timing - when the trigger should fire
 */
export type TriggerTiming = 
  | 'upkeep'           // At the beginning of upkeep
  | 'draw_step'        // At the beginning of draw step
  | 'precombat_main'   // At the beginning of precombat main
  | 'begin_combat'     // At the beginning of combat
  | 'declare_attackers'// When attackers are declared
  | 'declare_blockers' // When blockers are declared
  | 'combat_damage'    // When combat damage is dealt
  | 'end_combat'       // At end of combat
  | 'postcombat_main'  // At the beginning of postcombat main
  | 'end_step'         // At the beginning of end step
  | 'cleanup'          // During cleanup step
  | 'etb'              // When something enters the battlefield
  | 'ltb'              // When something leaves the battlefield
  | 'dies'             // When something dies
  | 'cast'             // When a spell is cast
  | 'draw'             // When a card is drawn
  | 'discard'          // When a card is discarded
  | 'damage'           // When damage is dealt
  | 'life_change'      // When life total changes
  | 'counter'          // When counters are added/removed
  | 'tap'              // When something becomes tapped
  | 'untap';           // When something becomes untapped

/**
 * Registered trigger on a permanent - marks what triggers the permanent has
 */
export interface RegisteredTrigger {
  id: string;
  permanentId: string;
  controllerId: string;
  cardName: string;
  timing: TriggerTiming;
  condition?: string;      // Additional condition text
  effect: string;          // Effect description
  mandatory: boolean;
  requiresTarget?: boolean;
  requiresChoice?: boolean;
  triggerOnce?: boolean;   // Some triggers only fire once per turn
  hasFiredThisTurn?: boolean;
}

/**
 * Analyze a card and return all triggers it has
 * This is called when a permanent enters the battlefield to register its triggers
 */
export function analyzeCardTriggers(card: any, permanentId: string, controllerId: string): RegisteredTrigger[] {
  const triggers: RegisteredTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  
  // Upkeep triggers (text is already lowercased, no need for /i flag)
  const upkeepMatch = oracleText.match(/at the beginning of (?:your )?upkeep,?\s*([^.]+)/);
  if (upkeepMatch) {
    triggers.push({
      id: `${permanentId}_upkeep`,
      permanentId,
      controllerId,
      cardName,
      timing: 'upkeep',
      effect: upkeepMatch[1].trim(),
      mandatory: !upkeepMatch[1].includes('you may'),
    });
  }
  
  // Precombat main phase triggers
  // Pattern: "At the beginning of each player's precombat main phase" (Magus of the Vineyard)
  const precombatMatch = oracleText.match(/at the beginning of (?:each player's |your )?(?:pre-?combat )?main (?:phase|step),?\s*([^.]+)/i);
  if (precombatMatch) {
    triggers.push({
      id: `${permanentId}_precombat_main`,
      permanentId,
      controllerId,
      cardName,
      timing: 'precombat_main',
      effect: precombatMatch[1].trim(),
      mandatory: !precombatMatch[1].includes('you may'),
    });
  }
  
  // End step triggers
  const endStepMatch = oracleText.match(/at the beginning of (?:your |each )?end step,?\s*([^.]+)/);
  if (endStepMatch) {
    triggers.push({
      id: `${permanentId}_end_step`,
      permanentId,
      controllerId,
      cardName,
      timing: 'end_step',
      effect: endStepMatch[1].trim(),
      mandatory: !endStepMatch[1].includes('you may'),
    });
  }
  
  // ETB triggers (self) - text is already lowercased
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Matches: "When ~ enters the battlefield", "When this creature enters", etc.
  const etbSelfMatch = oracleText.match(/when (?:~|this creature|this permanent|this enchantment) enters(?: the battlefield)?,?\s*([^.]+)/);
  if (etbSelfMatch) {
    triggers.push({
      id: `${permanentId}_etb_self`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'self',
      effect: etbSelfMatch[1].trim(),
      mandatory: !etbSelfMatch[1].includes('you may'),
    });
  }
  
  // ETB triggers (other creatures)
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles plural forms: "creatures enter" (e.g., Satoru, the Infiltrator)
  // Handles: "a creature enters", "another creature enters", "one or more creatures enter", "other creatures enter"
  const etbCreatureMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/);
  if (etbCreatureMatch) {
    triggers.push({
      id: `${permanentId}_etb_creature`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'creature',
      effect: etbCreatureMatch[1].trim(),
      mandatory: !etbCreatureMatch[1].includes('you may'),
    });
  }
  
  // Attack triggers
  const attackMatch = oracleText.match(/whenever (?:~|this creature) attacks,?\s*([^.]+)/);
  if (attackMatch) {
    triggers.push({
      id: `${permanentId}_attack`,
      permanentId,
      controllerId,
      cardName,
      timing: 'declare_attackers',
      effect: attackMatch[1].trim(),
      mandatory: !attackMatch[1].includes('you may'),
    });
  }
  
  // Combat damage triggers
  const combatDamageMatch = oracleText.match(/whenever (?:~|this creature) deals combat damage to (?:a player|an opponent),?\s*([^.]+)/);
  if (combatDamageMatch) {
    triggers.push({
      id: `${permanentId}_combat_damage`,
      permanentId,
      controllerId,
      cardName,
      timing: 'combat_damage',
      effect: combatDamageMatch[1].trim(),
      mandatory: !combatDamageMatch[1].includes('you may'),
    });
  }
  
  // Death triggers
  const deathMatch = oracleText.match(/when (?:~|this creature) dies,?\s*([^.]+)/);
  if (deathMatch) {
    triggers.push({
      id: `${permanentId}_dies`,
      permanentId,
      controllerId,
      cardName,
      timing: 'dies',
      condition: 'self',
      effect: deathMatch[1].trim(),
      mandatory: !deathMatch[1].includes('you may'),
    });
  }
  
  // Whenever a creature you control dies
  const creatureDiesMatch = oracleText.match(/whenever (?:a|another) creature you control dies,?\s*([^.]+)/);
  if (creatureDiesMatch) {
    triggers.push({
      id: `${permanentId}_creature_dies`,
      permanentId,
      controllerId,
      cardName,
      timing: 'dies',
      condition: 'controlled_creature',
      effect: creatureDiesMatch[1].trim(),
      mandatory: !creatureDiesMatch[1].includes('you may'),
    });
  }
  
  // Tap triggers
  const tapMatch = oracleText.match(/whenever (?:~|this creature) becomes tapped,?\s*([^.]+)/);
  if (tapMatch) {
    triggers.push({
      id: `${permanentId}_tap`,
      permanentId,
      controllerId,
      cardName,
      timing: 'tap',
      effect: tapMatch[1].trim(),
      mandatory: !tapMatch[1].includes('you may'),
    });
  }
  
  // Draw triggers
  const drawMatch = oracleText.match(/whenever (?:you|a player|an opponent) draws? (?:a card|cards),?\s*([^.]+)/);
  if (drawMatch) {
    triggers.push({
      id: `${permanentId}_draw`,
      permanentId,
      controllerId,
      cardName,
      timing: 'draw',
      effect: drawMatch[1].trim(),
      mandatory: !drawMatch[1].includes('you may'),
    });
  }
  
  // Cast triggers
  const castMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell,?\s*([^.]+)/);
  if (castMatch) {
    triggers.push({
      id: `${permanentId}_cast`,
      permanentId,
      controllerId,
      cardName,
      timing: 'cast',
      condition: castMatch[1] || 'any',
      effect: castMatch[2].trim(),
      mandatory: !castMatch[2].includes('you may'),
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

export interface TriggeredAbility {
  permanentId: string;
  cardName: string;
  triggerType: 
    | 'dies' 
    | 'creature_dies' 
    | 'any_creature_dies'
    | 'undying'
    | 'persist'
    | 'attacks'
    | 'creature_attacks'
    | 'etb'
    | 'etb_sacrifice_unless_pay' // Transguild Promenade, Gateway Plaza, Rupture Spire
    | 'creature_etb'
    | 'opponent_creature_etb' // Suture Priest style - when opponent's creature enters
    | 'equipment_etb'     // Whenever an Equipment enters under your control (Puresteel Paladin)
    | 'artifact_etb'      // Whenever an Artifact enters under your control
    | 'enchantment_etb'   // Whenever an Enchantment enters under your control
    | 'land_etb'          // Whenever a Land enters under your control (landfall variant)
    | 'equipment_cast'    // Whenever you cast an Equipment spell (Barret)
    | 'equipment_attack'  // Whenever equipped creature attacks (Sword of the Animist)
    | 'aura_attack'       // Whenever enchanted creature attacks
    | 'equipment_combat_damage' // Whenever equipped creature deals combat damage
    | 'aura_combat_damage'      // Whenever enchanted creature deals combat damage
    | 'job_select'        // Final Fantasy - create 1/1 Hero token and attach equipment
    | 'living_weapon'     // Phyrexia - create 0/0 Phyrexian Germ token and attach equipment
    | 'permanent_etb'     // Altar of the Brood style - whenever ANY permanent enters
    | 'another_permanent_etb' // Whenever ANOTHER permanent enters under your control
    | 'deals_damage'
    | 'deals_combat_damage'
    | 'creatures_deal_combat_damage_batched' // Batched trigger for one or more creatures dealing combat damage
    | 'annihilator'
    | 'melee'
    | 'myriad'
    | 'exalted'
    | 'upkeep_create_copy'  // Progenitor Mimic style - create token copy at upkeep
    | 'end_step_resource'   // Kynaios & Tiro style - draw/land resource at end step
    | 'end_step_effect'     // Generic end step trigger
    | 'cast_creature_type'  // Merrow Reejerey style - trigger when casting a spell of a type
    | 'tap_untap_target'    // Tap or untap target permanent
    | 'join_forces_attack'; // Mana-Charged Dragon - Join Forces when attacking
  description: string;
  effect?: string;
  value?: number | Record<string, any>; // For Annihilator N, or complex effect data
  millAmount?: number; // For mill triggers like Altar of the Brood
  manaCost?: string; // For "sacrifice unless you pay" triggers
  mandatory: boolean;
  requiresTarget?: boolean;
  targetType?: string;
  targetConstraint?: 'opponent' | 'you' | undefined; // For targeting restrictions (e.g., "opponent controls" or "you control")
  requiresChoice?: boolean; // For triggers where player must choose
  creatureType?: string; // For "whenever you cast a [type] spell" triggers
  nontokenOnly?: boolean; // For triggers that only fire for nontoken creatures (Guardian Project)
  batched?: boolean; // For triggers that should only fire once per event even if multiple conditions met (Professional Face-Breaker)
}

// Note: KNOWN_DEATH_TRIGGERS, KNOWN_ATTACK_TRIGGERS, KNOWN_UNTAP_TRIGGERS, 
// KNOWN_CAST_TYPE_TRIGGERS, KNOWN_TAP_UNTAP_ABILITIES, KNOWN_ETB_TRIGGERS,
// KNOWN_COMBAT_DAMAGE_TRIGGERS are now imported from ./triggers/card-data-tables.js


/**
 * Detect combat damage triggers from a permanent's abilities
 */
export function detectCombatDamageTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_COMBAT_DAMAGE_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'deals_combat_damage',
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  // Generic "whenever ~ deals combat damage to a player" detection
  const combatDamagePlayerMatch = oracleText.match(/whenever\s+(?:~|this creature)\s+deals\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (combatDamagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage',
      description: combatDamagePlayerMatch[1].trim(),
      effect: combatDamagePlayerMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever one or more creatures you control deal combat damage to a player" (batched trigger)
  // Examples: Professional Face-Breaker, Idol of Oblivion, etc.
  const batchedCombatDamageMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (batchedCombatDamageMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_batched',
      description: batchedCombatDamageMatch[1].trim(),
      effect: batchedCombatDamageMatch[1].trim(),
      mandatory: true,
      batched: true,  // This trigger should only fire once per combat damage step if any creatures dealt damage
    });
  }
  
  // "Whenever ~ deals damage to a player" (includes combat and non-combat)
  const damagePlayerMatch = oracleText.match(/whenever\s+(?:~|this creature)\s+deals\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (damagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: damagePlayerMatch[1].trim(),
      effect: damagePlayerMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get combat damage triggers for creatures that dealt damage
 */
export function getCombatDamageTriggersForCreature(
  ctx: GameContext,
  attackingPermanent: any,
  damageDealt: number,
  damagedPlayerId: string
): TriggeredAbility[] {
  if (damageDealt <= 0) return [];
  
  return detectCombatDamageTriggers(attackingPermanent.card, attackingPermanent);
}

/**
 * Detect death triggers from a permanent's abilities
 */
export function detectDeathTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      const triggerType = info.triggerOn === 'controlled' ? 'creature_dies' 
        : info.triggerOn === 'any' ? 'any_creature_dies' 
        : 'dies';
      triggers.push({
        permanentId,
        cardName,
        triggerType,
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  // Undying - if no +1/+1 counter, return with one
  if (lowerOracle.includes("undying")) {
    const hasPlusCounter = (counters["+1/+1"] || counters["plus1plus1"] || 0) > 0;
    if (!hasPlusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'undying',
        description: "Return to battlefield with +1/+1 counter",
        mandatory: true,
      });
    }
  }
  
  // Persist - if no -1/-1 counter, return with one
  if (lowerOracle.includes("persist")) {
    const hasMinusCounter = (counters["-1/-1"] || counters["minus1minus1"] || 0) > 0;
    if (!hasMinusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'persist',
        description: "Return to battlefield with -1/-1 counter",
        mandatory: true,
      });
    }
  }
  
  // Generic "when ~ dies" triggers
  const diesMatch = oracleText.match(/when(?:ever)?\s+(?:~|this creature)\s+dies,?\s*([^.]+)/i);
  if (diesMatch && !triggers.some(t => t.triggerType === 'dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dies',
      description: diesMatch[1].trim(),
      effect: diesMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever a creature you control dies"
  const controlledDiesMatch = oracleText.match(/whenever a creature you control dies,?\s*([^.]+)/i);
  if (controlledDiesMatch && !triggers.some(t => t.triggerType === 'creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_dies',
      description: controlledDiesMatch[1].trim(),
      effect: controlledDiesMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever a creature dies"
  const anyDiesMatch = oracleText.match(/whenever a creature dies,?\s*([^.]+)/i);
  if (anyDiesMatch && !triggers.some(t => t.triggerType === 'any_creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_creature_dies',
      description: anyDiesMatch[1].trim(),
      effect: anyDiesMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Detect attack triggers from a permanent's abilities
 */
export function detectAttackTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_ATTACK_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: info.effect,
        effect: info.effect,
        value: info.value,
        mandatory: true,
      });
    }
  }
  
  // Annihilator N
  const annihilatorMatch = oracleText.match(/annihilator\s+(\d+)/i);
  if (annihilatorMatch) {
    const n = parseInt(annihilatorMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'annihilator',
      description: `Defending player sacrifices ${n} permanent${n > 1 ? 's' : ''}`,
      value: n,
      mandatory: true,
      requiresTarget: false,
    });
  }
  
  // Melee
  if (lowerOracle.includes("melee")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'melee',
      description: "+1/+1 for each opponent you attacked this combat",
      mandatory: true,
    });
  }
  
  // Myriad
  if (lowerOracle.includes("myriad")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'myriad',
      description: "Create token copies attacking each other opponent",
      mandatory: true,
    });
  }
  
  // Exalted (triggers when a creature attacks alone)
  if (lowerOracle.includes("exalted")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exalted',
      description: "+1/+1 to attacking creature (when attacking alone)",
      mandatory: true,
    });
  }
  
  // Generic "whenever ~ attacks"
  const attacksMatch = oracleText.match(/whenever\s+(?:~|this creature)\s+attacks,?\s*([^.]+)/i);
  if (attacksMatch && !triggers.some(t => t.triggerType === 'attacks')) {
    const effectText = attacksMatch[1].trim();
    
    // Check if this is an optional mana payment trigger (e.g., Casal)
    // Pattern: "you may pay {X}. If you do, ..."
    const mayPayMatch = effectText.match(/you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*if you do,?\s*(.+)/i);
    
    if (mayPayMatch) {
      // Optional mana payment trigger
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: mayPayMatch[2].trim(), // The effect after "If you do,"
        manaCost: mayPayMatch[1], // The mana cost to pay
        mandatory: false, // Optional because of "may"
      });
    } else {
      // Regular mandatory attack trigger
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }
  
  // "Whenever a creature you control attacks"
  const creatureAttacksMatch = oracleText.match(/whenever a creature you control attacks,?\s*([^.]+)/i);
  if (creatureAttacksMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_attacks',
      description: creatureAttacksMatch[1].trim(),
      effect: creatureAttacksMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Join Forces attack trigger (Mana-Charged Dragon)
  // "Whenever ~ attacks, starting with you, each player may pay any amount of mana"
  if (lowerOracle.includes('join forces') && 
      lowerOracle.includes('whenever') && 
      lowerOracle.includes('attacks')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'join_forces_attack',
      description: 'Join forces - each player may pay any amount of mana',
      effect: oracleText,
      mandatory: true,
      value: {
        isJoinForces: true,
      },
    });
  }
  
  return triggers;
}

/**
 * Detect ETB triggers from a card
 */
export function detectETBTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known ETB trigger cards first
  for (const [knownName, info] of Object.entries(KNOWN_ETB_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      let triggerType: TriggeredAbility['triggerType'];
      switch (info.triggerOn) {
        case 'another_permanent':
          triggerType = 'another_permanent_etb';
          break;
        case 'any_permanent':
          triggerType = 'permanent_etb';
          break;
        case 'creature':
          triggerType = 'creature_etb';
          break;
        default:
          triggerType = 'etb';
      }
      
      const trigger: TriggeredAbility = {
        permanentId,
        cardName,
        triggerType,
        description: info.effect,
        effect: info.effect,
        millAmount: info.millAmount,
        mandatory: true,
      };
      
      // Add search filter info if present
      if (info.searchFilter) {
        (trigger as any).searchFilter = info.searchFilter;
        (trigger as any).searchDestination = info.searchDestination || 'hand';
        (trigger as any).searchEntersTapped = info.searchEntersTapped || false;
      }
      
      triggers.push(trigger);
    }
  }
  
  // "When ~ enters the battlefield" or "When [CARDNAME] enters the battlefield"
  // The ~ is used in some oracle text, but the actual card name is also used
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  const cardNameEscaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const etbPattern = new RegExp(`when\\s+(?:~|this creature|this permanent|${cardNameEscaped})\\s+enters(?: the battlefield)?,?\\s*([^.]+)`, 'i');
  const etbMatch = oracleText.match(etbPattern);
  if (etbMatch && !triggers.some(t => t.triggerType === 'etb' || t.triggerType === 'etb_sacrifice_unless_pay')) {
    const effectText = etbMatch[1].trim();
    
    // Check for "sacrifice ~ unless you pay" pattern (Transguild Promenade, Gateway Plaza, Rupture Spire)
    const sacrificeUnlessPayMatch = effectText.match(/sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i);
    if (sacrificeUnlessPayMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb_sacrifice_unless_pay',
        description: effectText,
        effect: effectText,
        manaCost: sacrificeUnlessPayMatch[1],
        mandatory: true,
        requiresChoice: true,
      });
    } else {
      // Detect if this trigger requires targeting
      const targetType = detectTargetType(effectText);
      const requiresTarget = !!targetType;
      
      // Detect targeting constraint (e.g., "opponent controls" or "you control")
      let targetConstraint: 'opponent' | 'you' | undefined = undefined;
      if (requiresTarget) {
        const lowerEffect = effectText.toLowerCase();
        if (lowerEffect.includes('an opponent controls') || lowerEffect.includes('opponent controls')) {
          targetConstraint = 'opponent';
        } else if (lowerEffect.includes('you control')) {
          targetConstraint = 'you';
        }
      }
      
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb',
        description: effectText,
        effect: effectText,
        mandatory: true,
        requiresTarget,
        targetType,
        targetConstraint,
      });
    }
  }
  
  // "Whenever a creature enters the battlefield under your control" or "Whenever a nontoken creature enters..."
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles "creature you control enters" (new template with "you control" before "enters")
  // Also handles plural forms: "creatures enter" / "creatures you control enter" (e.g., Satoru)
  // Handles: "a creature", "another creature", "one or more creatures", "other creatures"
  const creatureETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (creatureETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    const isNontokenOnly = oracleText.includes('nontoken creature');
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb',
      description: creatureETBMatch[1].trim(),
      effect: creatureETBMatch[1].trim(),
      mandatory: true,
      nontokenOnly: isNontokenOnly,
    });
  }
  
  // "Whenever an Equipment enters the battlefield under your control" (Puresteel Paladin, Barret, etc.)
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles "equipment you control enters" (new template)
  // Also handles plural forms and "another"/"other" variants
  const equipmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) equipments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (equipmentETBMatch && !triggers.some(t => t.triggerType === 'equipment_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_etb',
      description: equipmentETBMatch[1].trim(),
      effect: equipmentETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever an Artifact enters the battlefield under your control"
  // Also handles plural forms and "another"/"other" variants
  const artifactETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?artifacts? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (artifactETBMatch && !triggers.some(t => t.triggerType === 'artifact_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'artifact_etb',
      description: artifactETBMatch[1].trim(),
      effect: artifactETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever an Enchantment enters the battlefield under your control"
  // Also handles plural forms and "another"/"other" variants
  const enchantmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?enchantments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (enchantmentETBMatch && !triggers.some(t => t.triggerType === 'enchantment_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_etb',
      description: enchantmentETBMatch[1].trim(),
      effect: enchantmentETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever you cast an Equipment spell" (for cast triggers vs ETB)
  const equipmentCastMatch = oracleText.match(/whenever you (?:cast|play) (?:a|an) equipment(?: spell)?,?\s*([^.]+)/i);
  if (equipmentCastMatch && !triggers.some(t => t.triggerType === 'equipment_cast')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_cast',
      description: equipmentCastMatch[1].trim(),
      effect: equipmentCastMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever a legendary creature enters the battlefield under your control" (Hero's Blade, etc.)
  // This triggers when any legendary creature you control ETBs - used for auto-attach equipment
  const legendaryCreatureETBMatch = oracleText.match(/whenever (?:a|an(?:other)?) legendary creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (legendaryCreatureETBMatch && !triggers.some(t => (t as any).triggerType === 'legendary_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_creature_etb' as any,
      description: legendaryCreatureETBMatch[1].trim(),
      effect: legendaryCreatureETBMatch[1].trim(),
      mandatory: !lowerOracle.includes('you may'),
      requiresChoice: lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever another creature enters the battlefield" (Soul Warden, Auriok Champion, etc.)
  // This is CREATURE-ONLY - does NOT trigger on non-creature permanents like artifacts
  // NOTE: Soul Warden says "Whenever another creature enters the battlefield, you gain 1 life."
  // This should NOT trigger on artifacts, enchantments, lands, etc.
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms: "creatures enter" and "one or more other creatures enter"
  const anotherCreatureAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? enters?(?: the battlefield)?(?!.*under your control),?\s*([^.]+)/i);
  if (anotherCreatureAnyETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    // Extract any color restriction for filtering at trigger evaluation time (e.g., "white or black creature")
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures? enters?/i);
    const colorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb', // Use creature_etb so it only fires on creatures
      description: anotherCreatureAnyETBMatch[1].trim(),
      effect: anotherCreatureAnyETBMatch[1].trim(),
      mandatory: true,
      // Store color restriction for filtering (e.g., "white or black" for Auriok Champion)
      colorRestriction: colorRestriction && colorRestriction !== 'another' && colorRestriction !== 'one or more' ? colorRestriction : undefined,
    } as any);
  }
  
  // "Whenever another permanent you control enters" - Altar of the Brood, etc.
  // This triggers on ANY permanent type (creature, artifact, enchantment, land, planeswalker) under YOUR control
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms
  // First check if there's a control restriction, then match the pattern
  const hasPermanentControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control|under your control)/.test(oracleText) ||
                                         /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control )?enters?(?: the battlefield)? under your control/.test(oracleText);
  if (hasPermanentControlRestriction) {
    const anotherPermanentControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
    if (anotherPermanentControlledETBMatch && !triggers.some(t => t.triggerType === 'another_permanent_etb')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'another_permanent_etb', // Triggers only on permanents you control
        description: anotherPermanentControlledETBMatch[1].trim(),
        effect: anotherPermanentControlledETBMatch[1].trim(),
        mandatory: true,
      } as any);
    }
  }
  
  // "Whenever another permanent enters the battlefield" - ANY permanent from ANY player
  // This would be for cards that trigger on ANY permanent entering, regardless of controller
  // (Currently no known cards have this pattern, but included for completeness)
  // Explicitly check that it does NOT have "you control" or "under your control"
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms
  const anotherPermanentAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? enters?(?: the battlefield)?,?\s*([^.]+)/i);
  const hasNoControlRestriction = !/you control|under your control|an opponent controls|under an opponent's control/.test(oracleText);
  if (anotherPermanentAnyETBMatch && hasNoControlRestriction && !triggers.some(t => t.triggerType === 'permanent_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_etb',
      description: anotherPermanentAnyETBMatch[1].trim(),
      effect: anotherPermanentAnyETBMatch[1].trim(),
      mandatory: true,
    } as any);
  }
  
  // "Whenever another creature enters the battlefield under your control" (Guide of Souls, etc.)
  // Also handles new Bloomburrow template: "another creature you control enters"
  // This is CREATURE-ONLY, triggers only on creatures YOU control
  // Also handles plural forms
  const anotherCreatureControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  // Ensure the pattern requires "under your control" or "you control" (oracleText is already lowercased)
  // oracleText is already lowercased - check for control restriction
  // Also handles plural forms
  const hasControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control|under your control)/.test(oracleText) ||
                                 /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control )?enters?(?: the battlefield)? under your control/.test(oracleText);
  if (anotherCreatureControlledETBMatch && hasControlRestriction && !triggers.some(t => t.triggerType === 'another_permanent_etb' || t.triggerType === 'creature_etb')) {
    // Extract any color restriction
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures?/i);
    const colorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_etb', // This is controlled creature, so another_permanent_etb is appropriate
      description: anotherCreatureControlledETBMatch[1].trim(),
      effect: anotherCreatureControlledETBMatch[1].trim(),
      mandatory: true,
      colorRestriction: colorRestriction && colorRestriction !== 'another' && colorRestriction !== 'one or more' ? colorRestriction : undefined,
      creatureOnly: true, // Flag to indicate this only triggers on creatures
    } as any);
  }
  
  // "Whenever a creature an opponent controls enters" (Suture Priest second ability)
  // This triggers when OPPONENTS' creatures enter the battlefield
  // Also handles plural forms
  const opponentCreatureETBMatch = oracleText.match(/whenever (?:a|another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:an opponent controls )?enters?(?: the battlefield)?(?: under (?:an opponent's|their) control)?,?\s*([^.]+)/i);
  // oracleText is already lowercased
  const hasOpponentRestriction = /creatures? (?:an opponent controls|under an opponent's control)/.test(oracleText) ||
                                  /creatures? enters?(?: the battlefield)? under (?:an opponent's|their) control/.test(oracleText);
  if (opponentCreatureETBMatch && hasOpponentRestriction && !triggers.some(t => t.triggerType === 'opponent_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_etb', // New type for opponent creature ETB
      description: opponentCreatureETBMatch[1].trim(),
      effect: opponentCreatureETBMatch[1].trim(),
      mandatory: !opponentCreatureETBMatch[1].toLowerCase().includes('you may'),
    } as any);
  }
  
  // "As [this] enters the battlefield, choose" - Modal permanents like Outpost Siege
  // Pattern: "As ~ enters the battlefield, choose Khans or Dragons."
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  const modalETBMatch = oracleText.match(/as (?:~|this (?:creature|permanent|enchantment)) enters(?: the battlefield)?,?\s*choose\s+([^.]+)/i);
  if (modalETBMatch) {
    const choiceText = modalETBMatch[1].trim();
    // Parse the options (usually "X or Y" pattern)
    const options = choiceText.split(/\s+or\s+/i).map(opt => opt.trim().replace(/[.,]$/, ''));
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'etb_modal_choice',
      description: `Choose: ${options.join(' or ')}`,
      effect: choiceText,
      mandatory: true,
      requiresChoice: true,
      modalOptions: options,
    } as any);
  }
  
  // Job Select (Final Fantasy set) - When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.
  // Pattern: "Job select" or "job select" (keyword)
  const hasJobSelect = lowerOracle.includes('job select') || 
    (lowerOracle.includes('create') && lowerOracle.includes('hero') && lowerOracle.includes('token') && lowerOracle.includes('attach'));
  if (hasJobSelect && !triggers.some(t => t.triggerType === 'job_select')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'job_select',
      description: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
      effect: 'create_hero_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Hero',
        power: 1,
        toughness: 1,
        types: ['Creature'],
        subtypes: ['Hero'],
        colors: [], // colorless
      },
    } as any);
  }
  
  // Living Weapon (Phyrexia) - When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.
  // Pattern: "Living weapon" (keyword)
  const hasLivingWeapon = lowerOracle.includes('living weapon') ||
    (lowerOracle.includes('create') && lowerOracle.includes('germ') && lowerOracle.includes('token') && lowerOracle.includes('attach'));
  if (hasLivingWeapon && !triggers.some(t => t.triggerType === 'living_weapon')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'living_weapon',
      description: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
      effect: 'create_germ_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Phyrexian Germ',
        power: 0,
        toughness: 0,
        types: ['Creature'],
        subtypes: ['Phyrexian', 'Germ'],
        colors: ['B'], // black
      },
    } as any);
  }
  
  return triggers;
}

/**
 * Check if a permanent has ETB triggers that should fire when a permanent enters
 */
export function getETBTriggersForPermanent(card: any, permanent: any): TriggeredAbility[] {
  return detectETBTriggers(card, permanent);
}

/**
 * Check if a creature has flying or other evasion
 */
export function hasEvasionAbility(card: any): { flying: boolean; menace: boolean; trample: boolean; unblockable: boolean; shadow: boolean; horsemanship: boolean; fear: boolean; intimidate: boolean; skulk: boolean } {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const rawKeywords = card?.keywords;
  // Defensive: ensure keywords is an array
  const keywords = Array.isArray(rawKeywords) 
    ? rawKeywords.filter((k: any) => typeof k === 'string')
    : [];
  
  const checkKeyword = (kw: string) => 
    keywords.some((k: string) => k.toLowerCase() === kw.toLowerCase()) || oracleText.includes(kw.toLowerCase());
  
  return {
    flying: checkKeyword("Flying"),
    menace: checkKeyword("Menace"),
    trample: checkKeyword("Trample"),
    unblockable: oracleText.includes("can't be blocked") || oracleText.includes("unblockable"),
    shadow: checkKeyword("Shadow"),
    horsemanship: checkKeyword("Horsemanship"),
    fear: checkKeyword("Fear"),
    intimidate: checkKeyword("Intimidate"),
    skulk: checkKeyword("Skulk"),
  };
}

/**
 * Detect untap triggers from permanents on the battlefield
 * Used for Bear Umbra, Nature's Will, Sword of Feast and Famine, etc.
 */
export interface UntapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerOn: 'attack' | 'combat_damage' | 'damage_to_player';
  untapType: 'lands' | 'all' | 'creatures';
  effect: string;
}

export function detectUntapTriggers(card: any, permanent: any): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known untap trigger cards
  for (const [knownName, info] of Object.entries(KNOWN_UNTAP_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerOn: info.triggerOn,
        untapType: info.untapType,
        effect: info.effect,
      });
    }
  }
  
  // Generic detection: "Whenever enchanted creature attacks, untap all lands you control"
  const attackUntapLandsMatch = oracleText.match(/whenever (?:enchanted creature|equipped creature|~) attacks,?\s*(?:[^.]*)?untap all lands you control/i);
  if (attackUntapLandsMatch && !triggers.some(t => t.triggerOn === 'attack' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'attack',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  // Generic detection: "Whenever ~ deals combat damage to a player, untap all lands you control"
  const combatDamageUntapMatch = oracleText.match(/whenever (?:~|enchanted creature|equipped creature) deals combat damage to (?:a player|an opponent),?\s*(?:[^.]*)?untap all lands you control/i);
  if (combatDamageUntapMatch && !triggers.some(t => t.triggerOn === 'combat_damage' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'combat_damage',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  return triggers;
}

/**
 * Interface for equipment/aura attack triggers
 */
export interface AttachmentAttackTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  attachedToId: string;
  triggerType: 'attack' | 'combat_damage' | 'damage_to_player';
  effect: string;
  mandatory: boolean;
  // Specific effects
  searchesLibrary?: boolean;
  searchType?: 'basic_land' | 'land' | 'creature' | 'any';
  causesDiscard?: boolean;
  untapsLands?: boolean;
  drawsCards?: boolean;
  exilesCards?: boolean;
  createsToken?: boolean;
  // For Spirit Loop-style effects that trigger on any damage (not just combat)
  anyDamage?: boolean;
}

/**
 * Detect attack/combat damage triggers from equipment and auras
 * This handles cards like Sword of the Animist, Sword of Feast and Famine, etc.
 */
export function detectAttachmentAttackTriggers(card: any, permanent: any): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedToId = permanent?.attachedTo || "";
  
  // Skip if not attached to anything
  if (!attachedToId) return triggers;
  
  // Pattern: "Whenever equipped creature attacks, ..."
  const equipAttackMatch = oracleText.match(/whenever equipped creature attacks,?\s*([^.]+)/i);
  if (equipAttackMatch) {
    const effectText = equipAttackMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'attack',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      searchesLibrary: effectText.includes('search') && effectText.includes('library'),
      searchType: effectText.includes('basic land') ? 'basic_land' : 
                  effectText.includes('land') ? 'land' : undefined,
      createsToken: effectText.includes('create') && effectText.includes('token'),
    });
  }
  
  // Pattern: "Whenever enchanted creature attacks, ..."
  const auraAttackMatch = oracleText.match(/whenever enchanted creature attacks,?\s*([^.]+)/i);
  if (auraAttackMatch) {
    const effectText = auraAttackMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'attack',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      searchesLibrary: effectText.includes('search') && effectText.includes('library'),
      createsToken: effectText.includes('create') && effectText.includes('token'),
    });
  }
  
  // Pattern: "Whenever equipped creature deals combat damage to a player, ..."
  const equipDamageMatch = oracleText.match(/whenever equipped creature deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i);
  if (equipDamageMatch) {
    const effectText = equipDamageMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'combat_damage',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      causesDiscard: effectText.includes('discard'),
      untapsLands: effectText.includes('untap') && effectText.includes('land'),
      drawsCards: effectText.includes('draw'),
      exilesCards: effectText.includes('exile'),
    });
  }
  
  // Pattern: "Whenever enchanted creature deals combat damage to a player, ..."
  // Also matches "Whenever enchanted creature deals damage to a player, ..." (Spirit Loop)
  const auraDamageMatch = oracleText.match(/whenever enchanted creature deals (?:combat )?damage to (?:a player|an opponent),?\s*([^.]+)/i);
  if (auraDamageMatch) {
    const effectText = auraDamageMatch[1].trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'combat_damage',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      causesDiscard: effectText.includes('discard'),
      drawsCards: effectText.includes('draw'),
      exilesCards: effectText.includes('exile'),
      // Track if this is specifically combat damage or any damage
      anyDamage: !oracleText.toLowerCase().includes('combat damage'),
    });
  }
  
  return triggers;
}

/**
 * Get all equipment/aura triggers that fire when an equipped/enchanted creature attacks
 */
export function getAttachmentAttackTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all equipment/auras attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if attached to the attacking creature
    if (permanent.attachedTo !== attackingCreature.id) continue;
    
    // Detect triggers from this equipment/aura
    const attachmentTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    for (const trigger of attachmentTriggers) {
      if (trigger.triggerType === 'attack') {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Get all equipment/aura triggers that fire when equipped creature deals combat damage
 */
export function getAttachmentCombatDamageTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all equipment/auras attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if attached to the attacking creature
    if (permanent.attachedTo !== attackingCreature.id) continue;
    
    // Detect triggers from this equipment/aura
    const attachmentTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    for (const trigger of attachmentTriggers) {
      if (trigger.triggerType === 'combat_damage' || trigger.triggerType === 'damage_to_player') {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Get all untap triggers that should fire when a creature attacks
 */
export function getAttackUntapTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the attacking creature itself
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature);
  for (const trigger of selfTriggers) {
    if (trigger.triggerOn === 'attack') {
      triggers.push(trigger);
    }
  }
  
  // Check auras/equipment attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingController) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('aura');
    const isEquipment = typeLine.includes('equipment');
    
    if (isAura || isEquipment) {
      // Check if this is attached to the attacking creature
      const attachedTo = permanent.attachedTo;
      if (attachedTo === attackingCreature.id) {
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent);
        for (const trigger of attachmentTriggers) {
          if (trigger.triggerOn === 'attack') {
            triggers.push(trigger);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Get all untap triggers that should fire when a creature deals combat damage to a player
 */
export function getCombatDamageUntapTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the attacking creature itself
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature);
  for (const trigger of selfTriggers) {
    if (trigger.triggerOn === 'combat_damage' || trigger.triggerOn === 'damage_to_player') {
      triggers.push(trigger);
    }
  }
  
  // Check auras/equipment attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingController) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('aura');
    const isEquipment = typeLine.includes('equipment');
    
    if (isAura || isEquipment) {
      const attachedTo = permanent.attachedTo;
      if (attachedTo === attackingCreature.id) {
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent);
        for (const trigger of attachmentTriggers) {
          if (trigger.triggerOn === 'combat_damage' || trigger.triggerOn === 'damage_to_player') {
            triggers.push(trigger);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Execute an untap trigger effect
 */
export function executeUntapTrigger(
  ctx: GameContext,
  trigger: UntapTrigger
): void {
  const battlefield = ctx.state?.battlefield || [];
  
  console.log(`[executeUntapTrigger] ${trigger.cardName}: ${trigger.effect}`);
  
  switch (trigger.untapType) {
    case 'lands':
      // Untap all lands the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('land') && permanent.tapped) {
          permanent.tapped = false;
          console.log(`[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'creatures':
      // Untap all creatures the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('creature') && permanent.tapped) {
          permanent.tapped = false;
          console.log(`[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'all':
      // Untap all permanents the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        if (permanent.tapped) {
          permanent.tapped = false;
          console.log(`[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
  }
  
  ctx.bumpSeq();
}

/**
 * Check if a creature has firebreathing or similar pump abilities
 */
export function detectPumpAbilities(card: any): { cost: string; effect: string }[] {
  const abilities: { cost: string; effect: string }[] = [];
  const oracleText = card?.oracle_text || "";
  
  // Firebreathing: {R}: +1/+0
  const firebreathingMatch = oracleText.match(/\{R\}:\s*(?:~|this creature)\s+gets?\s+\+1\/\+0/i);
  if (firebreathingMatch || oracleText.toLowerCase().includes("firebreathing")) {
    abilities.push({ cost: "{R}", effect: "+1/+0 until end of turn" });
  }
  
  // Shade: {B}: +1/+1
  const shadeMatch = oracleText.match(/\{B\}:\s*(?:~|this creature)\s+gets?\s+\+1\/\+1/i);
  if (shadeMatch) {
    abilities.push({ cost: "{B}", effect: "+1/+1 until end of turn" });
  }
  
  // Generic pump: {X}: +N/+M
  const pumpMatches = oracleText.matchAll(/(\{[^}]+\}):\s*(?:~|this creature)\s+gets?\s+(\+\d+\/\+\d+)/gi);
  for (const match of pumpMatches) {
    if (!abilities.some(a => a.cost === match[1])) {
      abilities.push({ cost: match[1], effect: `${match[2]} until end of turn` });
    }
  }
  
  return abilities;
}

/**
 * Process death triggers when a creature dies
 */
export function getDeathTriggersForCreature(
  ctx: GameContext, 
  dyingPermanent: any,
  dyingController: string
): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the dying creature itself for death triggers
  const selfTriggers = detectDeathTriggers(dyingPermanent.card, dyingPermanent);
  triggers.push(...selfTriggers);
  
  // Check all other permanents for "whenever a creature dies" triggers
  for (const permanent of battlefield) {
    if (!permanent || permanent.id === dyingPermanent.id) continue;
    
    const permTriggers = detectDeathTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      // "Whenever a creature you control dies" - only trigger for controller's creatures
      if (trigger.triggerType === 'creature_dies') {
        if (permanent.controller === dyingController) {
          triggers.push(trigger);
        }
      }
      // "Whenever a creature dies" - triggers for any creature
      else if (trigger.triggerType === 'any_creature_dies') {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Process attack triggers when creatures attack
 */
export function getAttackTriggersForCreatures(
  ctx: GameContext,
  attackingCreatures: any[],
  attackingPlayer: string,
  defendingPlayer: string
): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check each attacking creature for attack triggers
  for (const attacker of attackingCreatures) {
    const attackerTriggers = detectAttackTriggers(attacker.card, attacker);
    triggers.push(...attackerTriggers);
  }
  
  // Check all permanents for "whenever a creature you control attacks" triggers
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingPlayer) continue;
    
    const permTriggers = detectAttackTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      if (trigger.triggerType === 'creature_attacks') {
        // Trigger once for each attacking creature
        for (const _ of attackingCreatures) {
          triggers.push({ ...trigger });
        }
      }
      if (trigger.triggerType === 'exalted' && attackingCreatures.length === 1) {
        // Exalted only triggers when attacking alone
        triggers.push(trigger);
      }
    }
  }
  
  // Check for equipment/aura attack triggers on each attacking creature
  for (const attacker of attackingCreatures) {
    const attachmentTriggers = getAttachmentAttackTriggers(ctx, attacker, attackingPlayer);
    for (const attachTrigger of attachmentTriggers) {
      // Convert attachment trigger to TriggeredAbility format
      triggers.push({
        permanentId: attachTrigger.permanentId,
        cardName: attachTrigger.cardName,
        description: attachTrigger.effect,
        triggerType: 'equipment_attack',
        mandatory: attachTrigger.mandatory,
        value: {
          attachedToId: attachTrigger.attachedToId,
          searchesLibrary: attachTrigger.searchesLibrary,
          searchType: attachTrigger.searchType,
          createsToken: attachTrigger.createsToken,
        },
      });
    }
  }
  
  return triggers;
}

/**
 * Handle undying/persist return from graveyard
 */
export function processUndyingPersist(
  ctx: GameContext,
  card: any,
  owner: string,
  ability: 'undying' | 'persist'
): void {
  const battlefield = ctx.state?.battlefield || [];
  const counterType = ability === 'undying' ? '+1/+1' : '-1/-1';
  
  // Create permanent on battlefield with counter
  const newPermanent = {
    id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    controller: owner,
    owner: owner,
    tapped: false,
    counters: { [counterType]: 1 },
    card: { ...card, zone: "battlefield" },
    returnedWith: ability,
  };
  
  battlefield.push(newPermanent as any);
  ctx.bumpSeq();
}

/**
 * Beginning of combat trigger types
 */
export interface BeginningOfCombatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  requiresChoice?: boolean;
}


/**
 * Detect beginning of combat triggers from a permanent's abilities
 */
export function detectBeginningOfCombatTriggers(card: any, permanent: any): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_BEGINNING_COMBAT_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: info.effect,
        effect: info.effect,
        mandatory: true,
        requiresChoice: info.requiresChoice,
      });
    }
  }
  
  // Generic "at the beginning of combat on your turn" detection
  const beginCombatMatch = oracleText.match(/at the beginning of combat on your turn,?\s*([^.]+)/i);
  if (beginCombatMatch && !triggers.some(t => t.description === beginCombatMatch[1].trim())) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: beginCombatMatch[1].trim(),
      effect: beginCombatMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "At the beginning of each combat" - triggers on all players' combats
  const eachCombatMatch = oracleText.match(/at the beginning of each combat,?\s*([^.]+)/i);
  if (eachCombatMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: eachCombatMatch[1].trim(),
      effect: eachCombatMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all beginning of combat triggers for the active player's combat step
 */
export function getBeginningOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Safety: Track how many triggers we're adding to prevent infinite loops
  const MAX_TRIGGERS_PER_STEP = 100;
  let triggerCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    // Safety check: Don't process more than MAX_TRIGGERS to prevent infinite loops
    if (triggerCount >= MAX_TRIGGERS_PER_STEP) {
      console.error(`[getBeginningOfCombatTriggers] SAFETY LIMIT: Stopped after ${MAX_TRIGGERS_PER_STEP} triggers to prevent infinite loop`);
      break;
    }
    
    const permTriggers = detectBeginningOfCombatTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      const cardName = (permanent.card.name || '').toLowerCase();
      
      // CRITICAL FIX: Check "on your turn" more strictly
      // Cards like Hakbal should ONLY trigger on the controller's turn
      const hasOnYourTurn = lowerOracle.includes('on your turn') || 
                           lowerOracle.includes('on his or her turn') ||
                           lowerOracle.includes('on their turn');
      
      const hasEachCombat = lowerOracle.includes('each combat') ||
                           lowerOracle.includes('each player\'s combat') ||
                           lowerOracle.includes('every combat');
      
      // "At the beginning of combat on your turn" - only for controller on their turn
      if (hasOnYourTurn) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
          triggerCount++;
          console.log(`[getBeginningOfCombatTriggers] ${trigger.cardName}: triggers on YOUR turn (controller=${permanent.controller}, active=${activePlayerId})`);
        } else {
          console.log(`[getBeginningOfCombatTriggers] ${trigger.cardName}: SKIPPED - not controller's turn (controller=${permanent.controller}, active=${activePlayerId})`);
        }
      }
      // "At the beginning of each combat" - triggers regardless of whose combat
      else if (hasEachCombat) {
        triggers.push(trigger);
        triggerCount++;
        console.log(`[getBeginningOfCombatTriggers] ${trigger.cardName}: triggers on EACH combat`);
      }
      // Default: if no explicit timing is specified, assume "on your turn"
      else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
        triggerCount++;
        console.log(`[getBeginningOfCombatTriggers] ${trigger.cardName}: triggers (default - controller's turn)`);
      } else {
        console.log(`[getBeginningOfCombatTriggers] ${trigger.cardName}: SKIPPED - default assumes 'on your turn' (controller=${permanent.controller}, active=${activePlayerId})`);
      }
    }
  }
  
  console.log(`[getBeginningOfCombatTriggers] Total triggers for activePlayer=${activePlayerId}: ${triggers.length}`);
  return triggers;
}

// ============================================================================
// Death Trigger System
// ============================================================================

export interface DeathTriggerResult {
  source: {
    permanentId: string;
    cardName: string;
    controllerId: string;
  };
  effect: string;
  targets?: string[]; // Player IDs affected
  requiresSacrificeSelection?: boolean;
  sacrificeFrom?: string; // Player ID who must sacrifice
  returnsUnderControl?: boolean; // For Grave Betrayal - return under your control
  dyingCreatureCard?: any; // The card that died, for reanimation effects
}

/**
 * Find all death triggers that should fire when a creature dies
 * @param ctx Game context
 * @param dyingCreature The creature that died
 * @param dyingCreatureController The controller of the dying creature
 * @returns Array of triggered abilities that should fire
 */
export function getDeathTriggers(
  ctx: GameContext,
  dyingCreature: any,
  dyingCreatureController: string
): DeathTriggerResult[] {
  const results: DeathTriggerResult[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const dyingTypeLine = (dyingCreature?.card?.type_line || '').toLowerCase();
  const isCreature = dyingTypeLine.includes('creature');
  
  if (!isCreature) return results;
  
  // Check all permanents on the battlefield for death triggers
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const card = permanent.card;
    if (!card) continue;
    
    const cardName = (card.name || '').toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    const permanentController = permanent.controller;
    
    // Check known death trigger cards
    for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
      if (cardName.includes(knownName)) {
        let shouldTrigger = false;
        
        switch (info.triggerOn) {
          case 'controlled':
            // Triggers when a creature YOU control dies
            shouldTrigger = dyingCreatureController === permanentController;
            break;
          case 'any':
            // Triggers when ANY creature dies
            shouldTrigger = true;
            break;
          case 'own':
            // Triggers when THIS creature dies (shouldn't match here since it's not on battlefield)
            shouldTrigger = false;
            break;
          case 'opponent':
            // Triggers when an OPPONENT's creature dies (Grave Betrayal)
            shouldTrigger = dyingCreatureController !== permanentController;
            break;
        }
        
        if (shouldTrigger) {
          // Determine if this requires sacrifice selection
          const requiresSacrifice = info.effect.toLowerCase().includes('sacrifice');
          // Check if this is a "return under your control" effect (Grave Betrayal, etc.)
          const returnsUnderControl = info.effect.toLowerCase().includes('return') && 
                                      info.effect.toLowerCase().includes('under your control');
          
          results.push({
            source: {
              permanentId: permanent.id,
              cardName: card.name,
              controllerId: permanentController,
            },
            effect: info.effect,
            requiresSacrificeSelection: requiresSacrifice,
            returnsUnderControl,
            dyingCreatureCard: dyingCreature?.card, // Include the dying creature's card for reanimation effects
          });
        }
      }
    }
    
    // Generic detection: "Whenever a creature you control dies"
    if (oracleText.includes('whenever a creature you control dies') && 
        dyingCreatureController === permanentController) {
      const effectMatch = oracleText.match(/whenever a creature you control dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = effectMatch[1].trim();
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // Generic detection: "Whenever a creature dies"
    if (oracleText.includes('whenever a creature dies') && 
        !oracleText.includes('whenever a creature you control dies')) {
      const effectMatch = oracleText.match(/whenever a creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = effectMatch[1].trim();
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // Generic detection: "Whenever a creature you don't control dies" (Grave Betrayal style)
    if ((oracleText.includes('whenever a creature you don\'t control dies') || 
         oracleText.includes('whenever a creature an opponent controls dies')) && 
        dyingCreatureController !== permanentController) {
      const effectMatch = oracleText.match(/whenever a creature (?:you don't control|an opponent controls) dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = effectMatch[1].trim();
        const returnsUnderControl = effect.toLowerCase().includes('return') && 
                                    effect.toLowerCase().includes('under your control');
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          returnsUnderControl,
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }
  }
  
  return results;
}

/**
 * Get list of players who need to sacrifice a creature due to Grave Pact-style effects
 * @param ctx Game context
 * @param triggerController The controller of the trigger source
 * @returns Array of player IDs who must sacrifice
 */
export function getPlayersWhoMustSacrifice(
  ctx: GameContext,
  triggerController: string
): string[] {
  const players = ctx.state?.players || [];
  return players
    .map((p: any) => p.id)
    .filter((pid: string) => pid !== triggerController);
}

// NOTE: End Step Trigger System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// NOTE: Draw Step Trigger System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// ============================================================================
// End of Combat Trigger System
// ============================================================================

export interface EndOfCombatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
}

/**
 * Detect end of combat triggers from a card's oracle text
 * Pattern: "At end of combat" or "At the end of combat"
 */
export function detectEndOfCombatTriggers(card: any, permanent: any): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "At end of combat" or "At the end of combat"
  const endCombatMatch = oracleText.match(/at (?:the )?end of combat,?\s*([^.]+)/i);
  if (endCombatMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: endCombatMatch[1].trim(),
      effect: endCombatMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all end of combat triggers
 */
export function getEndOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectEndOfCombatTriggers(permanent.card, permanent);
    triggers.push(...permTriggers);
  }
  
  return triggers;
}

// NOTE: Untap Step Effects System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// ============================================================================
// ETB-Triggered Untap Effects (Intruder Alarm, Thornbite Staff, etc.)
// ============================================================================

export interface ETBUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'all_creatures' | 'equipped_creature' | 'controller_creatures' | 'all_permanents';
  triggerCondition: 'creature_etb' | 'any_etb' | 'nontoken_creature_etb';
}

/**
 * Detect ETB-triggered untap effects from a card's oracle text
 * Handles cards like:
 * - Intruder Alarm: "Whenever a creature enters the battlefield, untap all creatures"
 * - Thornbite Staff: "Whenever a creature dies, untap equipped creature" (death trigger, but similar pattern)
 * - Jeskai Ascendancy: "Whenever you cast a noncreature spell, creatures you control get +1/+1 and untap"
 */
export function detectETBUntapEffects(card: any, permanent: any): ETBUntapEffect[] {
  const effects: ETBUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a creature enters the battlefield, untap all creatures" (Intruder Alarm)
  if (oracleText.includes('whenever a creature enters') && oracleText.includes('untap all creatures')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a creature enters the battlefield, untap all creatures",
      untapType: 'all_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // "Whenever a creature enters the battlefield under your control, untap" patterns
  if (oracleText.includes('whenever a creature enters the battlefield under your control') && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a creature enters the battlefield under your control, untap target creature",
      untapType: 'controller_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // Generic pattern: "whenever a creature enters the battlefield" + "untap"
  const creatureETBUntapMatch = oracleText.match(/whenever a creature enters (?:the battlefield)?[^.]*untap ([^.]+)/i);
  if (creatureETBUntapMatch && !effects.length) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a creature enters the battlefield, untap ${creatureETBUntapMatch[1]}`,
      untapType: 'all_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // "Whenever a nontoken creature enters" patterns
  if (oracleText.includes('whenever a nontoken creature enters') && oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a nontoken creature enters the battlefield, untap",
      untapType: 'all_creatures',
      triggerCondition: 'nontoken_creature_etb',
    });
  }
  
  return effects;
}

/**
 * Get ETB untap effects that should trigger when a creature enters
 */
export function getETBUntapEffects(
  ctx: GameContext,
  enteringPermanent: any,
  isToken: boolean
): ETBUntapEffect[] {
  const effects: ETBUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check if the entering permanent is a creature
  const typeLine = (enteringPermanent?.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  
  if (!isCreature) {
    return effects; // Only creature ETBs trigger these effects
  }
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.id === enteringPermanent?.id) continue; // Skip the entering permanent itself
    
    const permEffects = detectETBUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      // Check trigger condition
      if (effect.triggerCondition === 'creature_etb') {
        effects.push(effect);
      } else if (effect.triggerCondition === 'nontoken_creature_etb' && !isToken) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply an ETB untap effect (actually untap the permanents)
 */
export function applyETBUntapEffect(ctx: GameContext, effect: ETBUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'all_creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'controller_creatures':
        shouldUntap = typeLine.includes('creature') && permanent.controller === effect.controllerId;
        break;
      case 'all_permanents':
        shouldUntap = true;
        break;
      case 'equipped_creature':
        // Would need to track equipment attachment
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// Spell-Cast Untap Triggers (Jeskai Ascendancy, Paradox Engine)
// ============================================================================

export interface SpellCastUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'nonland_permanents' | 'creatures' | 'all';
  spellCondition: 'noncreature' | 'any' | 'instant_sorcery';
}

/**
 * Detect spell-cast untap triggers
 * - Paradox Engine: "Whenever you cast a spell, untap all nonland permanents you control"
 * - Jeskai Ascendancy: "Whenever you cast a noncreature spell, creatures you control get +1/+1 until end of turn. Untap those creatures."
 */
export function detectSpellCastUntapEffects(card: any, permanent: any): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever you cast a spell, untap all nonland permanents you control" (Paradox Engine - banned but pattern useful)
  if (oracleText.includes('whenever you cast a spell') && 
      oracleText.includes('untap all nonland permanents')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a spell, untap all nonland permanents you control",
      untapType: 'nonland_permanents',
      spellCondition: 'any',
    });
  }
  
  // "Whenever you cast a noncreature spell" + "untap" (Jeskai Ascendancy pattern)
  if (oracleText.includes('whenever you cast a noncreature spell') && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a noncreature spell, untap creatures you control",
      untapType: 'creatures',
      spellCondition: 'noncreature',
    });
  }
  
  // Generic "whenever you cast" + "untap" pattern
  const castUntapMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell[^.]*untap/i);
  if (castUntapMatch && !effects.length) {
    const spellType = castUntapMatch[1]?.toLowerCase() || 'any';
    let spellCondition: SpellCastUntapEffect['spellCondition'] = 'any';
    if (spellType === 'noncreature') spellCondition = 'noncreature';
    else if (spellType === 'instant' || spellType === 'sorcery') spellCondition = 'instant_sorcery';
    
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a ${spellType} spell, untap`,
      untapType: 'nonland_permanents',
      spellCondition,
    });
  }
  
  return effects;
}

/**
 * Get spell-cast untap effects for a player casting a spell
 */
export function getSpellCastUntapEffects(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permEffects = detectSpellCastUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      let shouldTrigger = false;
      
      switch (effect.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
      }
      
      if (shouldTrigger) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply a spell-cast untap effect
 */
export function applySpellCastUntapEffect(ctx: GameContext, effect: SpellCastUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    if (permanent.controller !== effect.controllerId) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'nonland_permanents':
        shouldUntap = !typeLine.includes('land');
        break;
      case 'creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'all':
        shouldUntap = true;
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// General Spell-Cast Triggered Abilities
// (Merrow Reejerey, Deeproot Waters, Beast Whisperer, etc.)
// ============================================================================

export interface SpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  spellCondition: 'any' | 'creature' | 'noncreature' | 'instant_sorcery' | 'tribal_type';
  tribalType?: string; // For tribal triggers like "Merfolk spell"
  requiresTarget?: boolean;
  targetType?: string; // e.g., "permanent" for tap/untap effects
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
    abilities?: string[];
  };
  mandatory: boolean;
}

/**
 * Detect spell-cast triggered abilities from a card's oracle text
 * Handles cards like:
 * - Merrow Reejerey: "Whenever you cast a Merfolk spell, you may tap or untap target permanent"
 * - Deeproot Waters: "Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof"
 * - Beast Whisperer: "Whenever you cast a creature spell, draw a card"
 * - Archmage Emeritus: "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card"
 * - Harmonic Prodigy: "If an ability of a Shaman or Wizard you control triggers, that ability triggers an additional time"
 */
export function detectSpellCastTriggers(card: any, permanent: any): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Pattern: "Whenever you cast a [TYPE] spell, [EFFECT]"
  const spellCastPatterns = [
    // Tribal patterns: "Whenever you cast a Merfolk/Goblin/Elf spell"
    /whenever you cast (?:a |an )?(\w+) spell,?\s*([^.]+)/gi,
    // Generic creature/noncreature patterns
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery) spell,?\s*([^.]+)/gi,
  ];
  
  for (const pattern of spellCastPatterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = match[2].trim();
      
      // Determine spell condition
      let spellCondition: SpellCastTrigger['spellCondition'] = 'any';
      let tribalType: string | undefined;
      
      if (spellType === 'creature') {
        spellCondition = 'creature';
      } else if (spellType === 'noncreature') {
        spellCondition = 'noncreature';
      } else if (spellType === 'instant' || spellType === 'sorcery' || spellType === 'instant or sorcery') {
        spellCondition = 'instant_sorcery';
      } else if (!['a', 'an', 'spell'].includes(spellType)) {
        // Likely a tribal type like "Merfolk", "Goblin", "Elf"
        spellCondition = 'tribal_type';
        tribalType = spellType;
      }
      
      // Check for tap/untap effects (Merrow Reejerey pattern)
      const isTapUntap = lowerOracle.includes('tap or untap') || 
                         lowerOracle.includes('untap target') ||
                         lowerOracle.includes('tap target');
      
      // Check for token creation (Deeproot Waters pattern)
      const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)[^.]*token/i);
      let createsToken = false;
      let tokenDetails: SpellCastTrigger['tokenDetails'];
      
      if (tokenMatch || lowerOracle.includes('create a') && lowerOracle.includes('token')) {
        createsToken = true;
        // Try to parse token details
        const tokenPowerMatch = effectText.match(/(\d+)\/(\d+)/);
        if (tokenPowerMatch) {
          tokenDetails = {
            name: tribalType ? `${tribalType} Token` : 'Token',
            power: parseInt(tokenPowerMatch[1]),
            toughness: parseInt(tokenPowerMatch[2]),
            types: `Creature — ${tribalType || 'Token'}`,
          };
        }
      }
      
      // Check if it's a "may" ability
      const isOptional = effectText.toLowerCase().includes('you may');
      
      // Avoid duplicates
      if (!triggers.some(t => t.effect === effectText && t.spellCondition === spellCondition)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast a ${tribalType || spellType} spell, ${effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          mandatory: !isOptional,
        });
      }
    }
  }
  
  // Beast Whisperer pattern: "Whenever you cast a creature spell, draw a card"
  if (lowerOracle.includes('whenever you cast a creature spell') && 
      lowerOracle.includes('draw a card') &&
      !triggers.some(t => t.spellCondition === 'creature' && t.effect.includes('draw'))) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a creature spell, draw a card",
      effect: "draw a card",
      spellCondition: 'creature',
      mandatory: true,
    });
  }
  
  // Magecraft pattern (Archmage Emeritus)
  if (lowerOracle.includes('magecraft') || 
      (lowerOracle.includes('whenever you cast or copy') && lowerOracle.includes('instant or sorcery'))) {
    const effectMatch = oracleText.match(/(?:magecraft\s*[—-]\s*)?whenever you cast or copy an instant or sorcery spell,?\s*([^.]+)/i);
    if (effectMatch && !triggers.some(t => t.effect === effectMatch[1].trim())) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Magecraft — Whenever you cast or copy an instant or sorcery spell, ${effectMatch[1].trim()}`,
        effect: effectMatch[1].trim(),
        spellCondition: 'instant_sorcery',
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get all spell-cast triggers that should fire when a spell is cast
 */
export function getSpellCastTriggers(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  
  // Extract creature types from the spell (for tribal triggers)
  const spellCreatureTypes = extractCreatureTypes(spellTypeLine);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permTriggers = detectSpellCastTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
        case 'tribal_type':
          // Check if the spell has the tribal type
          if (trigger.tribalType) {
            shouldTrigger = spellCreatureTypes.includes(trigger.tribalType.toLowerCase()) ||
                           spellTypeLine.includes(trigger.tribalType.toLowerCase());
          }
          break;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lowerTypeLine = typeLine.toLowerCase();
  
  // Common creature types
  const knownTypes = [
    'merfolk', 'goblin', 'elf', 'wizard', 'shaman', 'warrior', 'soldier', 'zombie',
    'vampire', 'dragon', 'angel', 'demon', 'beast', 'elemental', 'spirit', 'human',
    'knight', 'cleric', 'rogue', 'druid', 'pirate', 'dinosaur', 'cat', 'bird',
    'snake', 'spider', 'sliver', 'ally', 'rebel', 'mercenary', 'horror', 'faerie',
  ];
  
  for (const type of knownTypes) {
    if (lowerTypeLine.includes(type)) {
      types.push(type);
    }
  }
  
  return types;
}

// ============================================================================
// Tap/Untap Triggered Abilities
// (Judge of Currents, Emmara Soul of the Accord, Glare of Subdual, etc.)
// ============================================================================

export interface TapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  triggerCondition: 'becomes_tapped' | 'becomes_untapped' | 'taps_for_mana';
  affectedType: 'any' | 'creature' | 'tribal_type' | 'self';
  tribalType?: string; // For "Whenever a Merfolk becomes tapped"
  mandatory: boolean;
  lifeGain?: number;
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
  };
}

/**
 * Detect tap/untap triggered abilities from a card's oracle text
 * Handles cards like:
 * - Judge of Currents: "Whenever a Merfolk you control becomes tapped, you may gain 1 life"
 * - Emmara, Soul of the Accord: "Whenever Emmara, Soul of the Accord becomes tapped, create a 1/1 white Soldier creature token with lifelink"
 * - Fallowsage: "Whenever Fallowsage becomes tapped, you may draw a card"
 * - Opposition: Tap creatures to tap opponent's permanents
 */
export function detectTapTriggers(card: any, permanent: any): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a [TYPE] you control becomes tapped" pattern
  const tribalTapMatch = oracleText.match(/whenever (?:a |an )?(\w+) you control becomes tapped,?\s*([^.]+)/i);
  if (tribalTapMatch) {
    const tribalType = tribalTapMatch[1].toLowerCase();
    const effectText = tribalTapMatch[2].trim();
    const isOptional = effectText.toLowerCase().includes('you may');
    
    // Check for life gain
    const lifeGainMatch = effectText.match(/gain (\d+) life/i);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a ${tribalType} you control becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: !isOptional,
      lifeGain: lifeGainMatch ? parseInt(lifeGainMatch[1]) : undefined,
    });
  }
  
  // "Whenever ~ becomes tapped" pattern (self-referential like Emmara)
  const selfTapMatch = oracleText.match(/whenever (?:~|this creature) becomes tapped,?\s*([^.]+)/i);
  if (selfTapMatch) {
    const effectText = selfTapMatch[1].trim();
    const isOptional = effectText.toLowerCase().includes('you may');
    
    // Check for token creation
    const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)/i);
    let createsToken = false;
    let tokenDetails: TapTrigger['tokenDetails'];
    
    if (tokenMatch || lowerOracle.includes('create') && lowerOracle.includes('token')) {
      createsToken = true;
      const powerMatch = effectText.match(/(\d+)\/(\d+)/);
      if (powerMatch) {
        tokenDetails = {
          name: 'Token',
          power: parseInt(powerMatch[1]),
          toughness: parseInt(powerMatch[2]),
          types: 'Creature',
        };
      }
    }
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever ${cardName} becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'self',
      mandatory: !isOptional,
      createsToken,
      tokenDetails,
    });
  }
  
  // "Whenever a creature you control becomes tapped" (generic creature tap)
  if (lowerOracle.includes('whenever a creature you control becomes tapped') && 
      !triggers.some(t => t.affectedType === 'creature')) {
    const effectMatch = oracleText.match(/whenever a creature you control becomes tapped,?\s*([^.]+)/i);
    if (effectMatch) {
      const effectText = effectMatch[1].trim();
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever a creature you control becomes tapped, ${effectText}`,
        effect: effectText,
        triggerCondition: 'becomes_tapped',
        affectedType: 'creature',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }
  
  // "Whenever you tap a [TYPE] for mana" pattern (like Elvish Archdruid's friends)
  const tapForManaMatch = oracleText.match(/whenever you tap (?:a |an )?(\w+) for mana,?\s*([^.]+)/i);
  if (tapForManaMatch) {
    const tribalType = tapForManaMatch[1].toLowerCase();
    const effectText = tapForManaMatch[2].trim();
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you tap a ${tribalType} for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'taps_for_mana',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all tap triggers that should fire when a permanent becomes tapped
 */
export function getTapTriggers(
  ctx: GameContext,
  tappedPermanent: any,
  tappedByPlayerId: string
): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const tappedTypeLine = (tappedPermanent?.card?.type_line || '').toLowerCase();
  const tappedCreatureTypes = extractCreatureTypes(tappedTypeLine);
  const isCreature = tappedTypeLine.includes('creature');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectTapTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      // Only trigger for the controller's permanents becoming tapped
      if (permanent.controller !== tappedByPlayerId) continue;
      
      let shouldTrigger = false;
      
      switch (trigger.affectedType) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreature;
          break;
        case 'tribal_type':
          if (trigger.tribalType) {
            shouldTrigger = tappedCreatureTypes.includes(trigger.tribalType.toLowerCase());
          }
          break;
        case 'self':
          // Self-referential triggers only fire when this specific permanent is tapped
          shouldTrigger = permanent.id === tappedPermanent.id;
          break;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// NOTE: "Doesn't Untap" Static Effects have been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// ============================================================================
// Card Draw Trigger System - MOVED to ./triggers/card-draw.ts
// ============================================================================

// ============================================================================
// Mimic Vat and Imprint Triggers
// ============================================================================

export interface MimicVatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  dyingCreatureId: string;
  dyingCreatureName: string;
  dyingCreatureCard: any;
}

/**
 * Known cards with imprint-on-death triggers like Mimic Vat
 */
const KNOWN_IMPRINT_ON_DEATH_CARDS: Record<string, { effect: string; canExile: boolean }> = {
  "mimic vat": { 
    effect: "You may exile the dying creature. If you do, exile any card imprinted on Mimic Vat. Then you may pay {3} and tap to create a token copy with haste.", 
    canExile: true 
  },
  "soul foundry": {
    effect: "Imprint a creature card from your hand",
    canExile: false // Soul Foundry imprints from hand, not from dying creatures
  },
  "prototype portal": {
    effect: "Imprint an artifact card from your hand",
    canExile: false
  },
};

/**
 * Detect Mimic Vat-style imprint triggers from a permanent's oracle text
 * Pattern: "Whenever a nontoken creature dies, you may exile that card"
 */
export function detectMimicVatTriggers(card: any, permanent: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_IMPRINT_ON_DEATH_CARDS)) {
    if (cardName.includes(knownName) && info.canExile) {
      return true;
    }
  }
  
  // Generic pattern: "Whenever a nontoken creature dies, you may exile that card"
  // or "Whenever a creature dies, you may exile it"
  if (oracleText.includes('whenever') && 
      oracleText.includes('creature dies') && 
      oracleText.includes('you may exile')) {
    return true;
  }
  
  return false;
}

/**
 * Get all Mimic Vat-style triggers when a creature dies
 * @param ctx Game context
 * @param dyingCreature The creature that died
 * @param isToken Whether the dying creature is a token
 * @returns Array of triggers that can exile the dying creature
 */
export function getMimicVatTriggers(
  ctx: GameContext,
  dyingCreature: any,
  isToken: boolean
): MimicVatTrigger[] {
  const triggers: MimicVatTrigger[] = [];
  
  // Mimic Vat only works on nontoken creatures
  if (isToken) return triggers;
  
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const hasMimicVatTrigger = detectMimicVatTriggers(permanent.card, permanent);
    
    if (hasMimicVatTrigger) {
      const cardName = (permanent.card.name || "").toLowerCase();
      const knownInfo = Object.entries(KNOWN_IMPRINT_ON_DEATH_CARDS)
        .find(([name]) => cardName.includes(name));
      
      triggers.push({
        permanentId: permanent.id,
        cardName: permanent.card.name,
        controllerId: permanent.controller,
        effect: knownInfo ? knownInfo[1].effect : "Exile the dying creature and imprint it",
        dyingCreatureId: dyingCreature.id,
        dyingCreatureName: dyingCreature.card?.name || "Unknown",
        dyingCreatureCard: dyingCreature.card,
      });
    }
  }
  
  return triggers;
}

// ============================================================================
// Kroxa-style ETB Auto-Sacrifice Triggers
// ============================================================================

/**
 * Known cards that sacrifice themselves on ETB unless cast with an alternate cost (Escape, etc.)
 */
const KNOWN_ETB_SACRIFICE_UNLESS: Record<string, { 
  effect: string; 
  alternateCostKeyword: string; 
  checkCondition: (permanent: any) => boolean;
}> = {
  "kroxa, titan of death's hunger": {
    effect: "When Kroxa enters the battlefield, sacrifice it unless it escaped.",
    alternateCostKeyword: "escape",
    checkCondition: (perm) => !perm.escapedFrom,
  },
  "uro, titan of nature's wrath": {
    effect: "When Uro enters the battlefield, sacrifice it unless it escaped.",
    alternateCostKeyword: "escape",
    checkCondition: (perm) => !perm.escapedFrom,
  },
  "ox of agonas": {
    effect: "When Ox of Agonas enters the battlefield, discard your hand, then draw three cards.",
    alternateCostKeyword: "escape",
    checkCondition: () => false, // Ox doesn't sacrifice, it has a different ETB
  },
  // Blitz creatures also have this pattern
  "jaxis, the troublemaker": {
    effect: "Sacrifice at end of turn if it entered with blitz",
    alternateCostKeyword: "blitz",
    checkCondition: (perm) => perm.blitzed === true,
  },
  // Ball Lightning style creatures
  "ball lightning": {
    effect: "At the beginning of the end step, sacrifice Ball Lightning.",
    alternateCostKeyword: "",
    checkCondition: () => true, // Always sacrifices at end step
  },
  "groundbreaker": {
    effect: "At the beginning of the end step, sacrifice Groundbreaker.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
  "spark elemental": {
    effect: "At the beginning of the end step, sacrifice Spark Elemental.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
};

/**
 * Check if a permanent should auto-sacrifice on ETB
 * Returns sacrifice info or null if it shouldn't sacrifice
 */
export function checkETBAutoSacrifice(card: any, permanent: any): { 
  shouldSacrifice: boolean; 
  reason: string;
  timing: 'immediate' | 'end_step';
} | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_ETB_SACRIFICE_UNLESS)) {
    if (cardName.includes(knownName)) {
      if (info.checkCondition(permanent)) {
        // Determine timing
        let timing: 'immediate' | 'end_step' = 'immediate';
        if (oracleText.includes('at the beginning of the end step') || 
            oracleText.includes('end of turn')) {
          timing = 'end_step';
        }
        
        return {
          shouldSacrifice: true,
          reason: info.effect,
          timing,
        };
      }
      return null; // Condition not met (e.g., escaped)
    }
  }
  
  // Generic pattern: "When ~ enters the battlefield, sacrifice it unless"
  const sacrificeUnlessMatch = oracleText.match(
    /when (?:~|this creature) enters the battlefield,?\s*sacrifice (?:~|it) unless ([^.]+)/i
  );
  if (sacrificeUnlessMatch) {
    // Check if the condition is met (e.g., "unless it escaped")
    const condition = sacrificeUnlessMatch[1].toLowerCase();
    
    if (condition.includes('escaped') && !permanent.escapedFrom) {
      return {
        shouldSacrifice: true,
        reason: `Sacrifice unless it escaped`,
        timing: 'immediate',
      };
    }
    
    // Other conditions would need specific checking
  }
  
  // Pattern: "At the beginning of the end step, sacrifice ~"
  const endStepSacrificeMatch = oracleText.match(
    /at the beginning of (?:the )?end step,?\s*sacrifice (?:~|this creature)/i
  );
  if (endStepSacrificeMatch) {
    return {
      shouldSacrifice: true,
      reason: "Sacrifice at end of turn",
      timing: 'end_step',
    };
  }
  
  return null;
}

// ============================================================================
// Modal Spell Support
// ============================================================================

export interface ModalSpellMode {
  index: number;
  text: string;
  effect: string;
  requiresTarget?: boolean;
  targetType?: string;
}

export interface ModalSpellInfo {
  isModal: boolean;
  modeCount: number | 'any'; // 1, 2, 3, 'any'
  modes: ModalSpellMode[];
  isSpree: boolean;
  spreeCosts?: { modeIndex: number; cost: string }[];
}

/**
 * Parse modal spell options from oracle text
 * Handles:
 * - "Choose one —" / "Choose two —" / "Choose three —"
 * - "Choose any number —"
 * - Spree cards: "Spree (Choose one or more additional costs.)"
 * - Entwine: "You may choose both if you pay entwine cost"
 */
export function parseModalSpellOptions(card: any): ModalSpellInfo {
  const oracleText = card?.oracle_text || "";
  const lowerOracle = oracleText.toLowerCase();
  
  const result: ModalSpellInfo = {
    isModal: false,
    modeCount: 1,
    modes: [],
    isSpree: false,
  };
  
  // Check for Spree keyword
  if (lowerOracle.includes('spree')) {
    result.isModal = true;
    result.isSpree = true;
    result.modeCount = 'any';
    
    // Parse spree costs: "+ {cost} — Effect"
    const spreePattern = /\+\s*(\{[^}]+\})\s*[—-]\s*([^+]+?)(?=\+\s*\{|$)/gi;
    let match;
    let index = 0;
    while ((match = spreePattern.exec(oracleText)) !== null) {
      const cost = match[1];
      const effect = match[2].trim();
      
      result.modes.push({
        index,
        text: `Pay ${cost}: ${effect}`,
        effect,
        requiresTarget: effect.toLowerCase().includes('target'),
        targetType: detectTargetType(effect),
      });
      
      result.spreeCosts = result.spreeCosts || [];
      result.spreeCosts.push({ modeIndex: index, cost });
      index++;
    }
    
    return result;
  }
  
  // Check for standard modal patterns
  const chooseMatch = lowerOracle.match(/choose\s+(one|two|three|four|any number)\s*[—-]/i);
  if (chooseMatch) {
    result.isModal = true;
    const countWord = chooseMatch[1].toLowerCase();
    
    switch (countWord) {
      case 'one': result.modeCount = 1; break;
      case 'two': result.modeCount = 2; break;
      case 'three': result.modeCount = 3; break;
      case 'four': result.modeCount = 4; break;
      case 'any number': result.modeCount = 'any'; break;
      default: result.modeCount = 1;
    }
    
    // Parse individual modes (marked by • or numbered)
    // Pattern: "• Effect text" or lines after "Choose X —"
    const modePattern = /[•·]\s*([^•·]+?)(?=[•·]|$)/g;
    let modeMatch;
    let index = 0;
    
    // Find the modes section (after "Choose X —")
    const dashIndex = oracleText.search(/[—-]/);
    const modesSection = dashIndex >= 0 ? oracleText.slice(dashIndex + 1) : oracleText;
    
    while ((modeMatch = modePattern.exec(modesSection)) !== null) {
      const modeText = modeMatch[1].trim();
      if (modeText.length > 0) {
        result.modes.push({
          index,
          text: modeText,
          effect: modeText,
          requiresTarget: modeText.toLowerCase().includes('target'),
          targetType: detectTargetType(modeText),
        });
        index++;
      }
    }
    
    // Fallback: if no bullet points found, try to parse by sentence structure
    if (result.modes.length === 0) {
      // Some cards use newlines or semicolons to separate modes
      const altModes = modesSection.split(/[;\n]/).filter(m => m.trim().length > 0);
      for (const modeText of altModes) {
        const cleanMode = modeText.trim();
        if (cleanMode.length > 5) { // Avoid tiny fragments
          result.modes.push({
            index,
            text: cleanMode,
            effect: cleanMode,
            requiresTarget: cleanMode.toLowerCase().includes('target'),
            targetType: detectTargetType(cleanMode),
          });
          index++;
        }
      }
    }
  }
  
  // Check for Entwine
  if (lowerOracle.includes('entwine')) {
    const entwineMatch = lowerOracle.match(/entwine\s+(\{[^}]+\})/i);
    if (entwineMatch) {
      // Mark that both modes can be chosen with entwine cost
      (result as any).hasEntwine = true;
      (result as any).entwineCost = entwineMatch[1];
    }
  }
  
  return result;
}

/**
 * Helper to detect target type from effect text
 */
function detectTargetType(effectText: string): string | undefined {
  const lower = effectText.toLowerCase();
  
  if (lower.includes('target creature')) return 'creature';
  if (lower.includes('target player')) return 'player';
  if (lower.includes('target permanent')) return 'permanent';
  if (lower.includes('target spell')) return 'spell';
  if (lower.includes('target artifact')) return 'artifact';
  if (lower.includes('target enchantment')) return 'enchantment';
  if (lower.includes('target land')) return 'land';
  if (lower.includes('any target')) return 'any';
  
  return undefined;
}

// ============================================================================
// Devotion Mana Calculation - MOVED to ./triggers/devotion.ts
// ============================================================================

// ============================================================================
// Win/Loss Condition Detection - MOVED to ./triggers/win-conditions.ts
// ============================================================================

// ============================================================================
// Transform/Flip Triggers - MOVED to ./triggers/transform.ts
// ============================================================================

// ============================================================================
// Landfall Triggers - MOVED to ./triggers/landfall.ts
// ============================================================================

// ============================================================================
// Static Abilities and Keywords
// ============================================================================

/**
 * Check if a permanent has Split Second (can't be responded to)
 */
export function hasSplitSecond(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  return keywords.some((k: string) => k.toLowerCase() === 'split second') ||
         oracleText.includes('split second');
}

/**
 * Check if a player has hexproof (Leyline of Sanctity, Shalai, etc.)
 */
export function playerHasHexproof(
  gameState: any,
  playerId: string
): boolean {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const cardName = (permanent.card.name || "").toLowerCase();
    
    // Leyline of Sanctity: "You have hexproof"
    if (cardName.includes('leyline of sanctity') && permanent.controller === playerId) {
      return true;
    }
    
    // Shalai, Voice of Plenty: "You and permanents you control have hexproof"
    if (cardName.includes('shalai') && oracleText.includes('you') && 
        oracleText.includes('hexproof') && permanent.controller === playerId) {
      return true;
    }
    
    // Aegis of the Gods: "You have hexproof"
    if (cardName.includes('aegis of the gods') && permanent.controller === playerId) {
      return true;
    }
    
    // Teyo, the Shieldmage: "You have hexproof"
    if (cardName.includes('teyo') && oracleText.includes('you have hexproof') && 
        permanent.controller === playerId) {
      return true;
    }
    
    // Orbs of Warding: "You have hexproof"
    if (cardName.includes('orbs of warding') && permanent.controller === playerId) {
      return true;
    }
    
    // Imperial Mask: "You have hexproof"
    if (cardName.includes('imperial mask') && permanent.controller === playerId) {
      return true;
    }
    
    // Generic pattern: "You have hexproof"
    if (oracleText.includes('you have hexproof') && permanent.controller === playerId) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get creatures with specific keywords in graveyard (Brawn, Anger, Wonder, Filth, Genesis)
 */
export function getGraveyardKeywordGranters(
  gameState: any,
  playerId: string
): { keyword: string; cardName: string; condition?: string }[] {
  const granters: { keyword: string; cardName: string; condition?: string }[] = [];
  const zones = gameState?.zones?.[playerId];
  const graveyard = zones?.graveyard || [];
  const battlefield = gameState?.battlefield || [];
  
  // Check if player controls a land of the required type
  const controlsForest = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('forest')
  );
  const controlsIsland = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('island')
  );
  const controlsMountain = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('mountain')
  );
  const controlsSwamp = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('swamp')
  );
  
  for (const card of graveyard) {
    const cardName = (card.name || "").toLowerCase();
    
    // Brawn: Creatures you control have trample (if you control a Forest)
    if (cardName.includes('brawn') && controlsForest) {
      granters.push({ keyword: 'trample', cardName: 'Brawn', condition: 'Control a Forest' });
    }
    
    // Anger: Creatures you control have haste (if you control a Mountain)
    if (cardName.includes('anger') && controlsMountain) {
      granters.push({ keyword: 'haste', cardName: 'Anger', condition: 'Control a Mountain' });
    }
    
    // Wonder: Creatures you control have flying (if you control an Island)
    if (cardName.includes('wonder') && controlsIsland) {
      granters.push({ keyword: 'flying', cardName: 'Wonder', condition: 'Control an Island' });
    }
    
    // Filth: Creatures you control have swampwalk (if you control a Swamp)
    if (cardName.includes('filth') && controlsSwamp) {
      granters.push({ keyword: 'swampwalk', cardName: 'Filth', condition: 'Control a Swamp' });
    }
    
    // Genesis: Return creature from graveyard at upkeep (if you control a Forest)
    if (cardName.includes('genesis') && controlsForest) {
      granters.push({ keyword: 'return_creature', cardName: 'Genesis', condition: 'Control a Forest' });
    }
  }
  
  return granters;
}

// ============================================================================
// Storm Mechanic Support
// ============================================================================

/**
 * Storm - When you cast this spell, copy it for each spell cast before it this turn.
 * Each copy goes on the stack with the same modes/targets (or new targets chosen)
 * 
 * Cards with Storm:
 * - Grapeshot
 * - Empty the Warrens
 * - Brain Freeze
 * - Tendrils of Agony
 * - Mind's Desire
 * - Temporal Fissure
 * - Hunting Pack
 * - Wing Shards
 * - Flusterstorm
 * - Crow Storm
 * - Dragonstorm
 * - Ignite Memories
 * - Sprouting Vines
 */
export interface StormTrigger {
  sourceCardId: string;
  sourceCardName: string;
  controllerId: string;
  stormCount: number;  // Number of copies to create
  originalSpellDetails: any;
}

export function detectStormAbility(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  // Check keywords array
  if (keywords.some((k: string) => k.toLowerCase() === 'storm')) {
    return true;
  }
  
  // Check oracle text for storm reminder text
  // "Storm (When you cast this spell, copy it for each spell cast before it this turn.)"
  if (oracleText.includes('storm') && 
      oracleText.includes('copy it for each spell cast before it')) {
    return true;
  }
  
  return false;
}

export function getStormCount(gameState: any): number {
  // Storm count is the number of spells cast this turn before this spell
  const spellsCastThisTurn = gameState?.spellsCastThisTurn || [];
  // Subtract 1 because we don't count the storm spell itself
  return Math.max(0, spellsCastThisTurn.length - 1);
}

// ============================================================================
// Hideaway Support
// ============================================================================

/**
 * Hideaway - When this land enters, look at the top X cards of your library,
 * exile one face down, then put the rest on the bottom. When condition is met,
 * you may play the exiled card without paying its mana cost.
 * 
 * Original hideaway lands (hideaway 4):
 * - Mosswort Bridge (creatures with total power 10+)
 * - Windbrisk Heights (attacked with 3+ creatures)
 * - Shelldock Isle (library has 20 or fewer cards)
 * - Howltooth Hollow (each player has no cards in hand)
 * - Spinerock Knoll (dealt 7+ damage this turn)
 * 
 * Newer hideaway cards:
 * - Watcher for Tomorrow (hideaway 4, when it leaves)
 * - Hideaway lands in Streets of New Capenna
 */
export interface HideawayAbility {
  hideawayCount: number;  // How many cards to look at
  condition: string;
  permanentId: string;
  exiledCardId?: string;
}

export function detectHideawayAbility(card: any): HideawayAbility | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  // Check for hideaway keyword
  const hasHideaway = keywords.some((k: string) => k.toLowerCase().includes('hideaway'));
  
  if (!hasHideaway && !oracleText.includes('hideaway')) {
    return null;
  }
  
  // Parse hideaway count - "hideaway 4" or "hideaway 5"
  const hideawayMatch = oracleText.match(/hideaway\s*(\d+)?/i);
  const hideawayCount = hideawayMatch && hideawayMatch[1] ? parseInt(hideawayMatch[1], 10) : 4;
  
  // Extract condition for playing the exiled card
  let condition = "unknown";
  
  // Mosswort Bridge pattern
  if (oracleText.includes('creatures with total power 10 or greater')) {
    condition = "Control creatures with total power 10+";
  }
  // Windbrisk Heights pattern
  else if (oracleText.includes('attacked with three or more creatures')) {
    condition = "Attacked with 3+ creatures this turn";
  }
  // Shelldock Isle pattern
  else if (oracleText.includes('library has twenty or fewer cards')) {
    condition = "A library has 20 or fewer cards";
  }
  // Howltooth Hollow pattern
  else if (oracleText.includes('each player has no cards in hand')) {
    condition = "Each player has no cards in hand";
  }
  // Spinerock Knoll pattern
  else if (oracleText.includes('opponent was dealt 7 or more damage')) {
    condition = "An opponent was dealt 7+ damage this turn";
  }
  
  return {
    hideawayCount,
    condition,
    permanentId: '',  // Will be set when the permanent enters
  };
}

// ============================================================================
// Pariah and Damage Redirection Support
// ============================================================================

/**
 * Pariah effects redirect damage from a player to another permanent/creature
 * 
 * Cards:
 * - Pariah - "All damage that would be dealt to you is dealt to enchanted creature instead"
 * - Pariah's Shield - Equipment version
 * - Palisade Giant - "All damage that would be dealt to you is dealt to Palisade Giant instead"
 * - Stuffy Doll - Choose a player, all damage dealt to it is dealt to that player
 */
export interface DamageRedirection {
  permanentId: string;
  cardName: string;
  from: 'controller' | 'chosen_player';
  to: 'this_creature' | 'enchanted_creature' | 'equipped_creature' | 'chosen_player';
  chosenPlayerId?: string;
}

export function detectDamageRedirection(card: any, permanent: any): DamageRedirection | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Pariah pattern
  if (cardName.includes('pariah') && !cardName.includes("pariah's shield")) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Pariah',
      from: 'controller',
      to: 'enchanted_creature',
    };
  }
  
  // Pariah's Shield pattern
  if (cardName.includes("pariah's shield")) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Pariah's Shield",
      from: 'controller',
      to: 'equipped_creature',
    };
  }
  
  // Palisade Giant pattern
  if (cardName.includes('palisade giant')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Palisade Giant',
      from: 'controller',
      to: 'this_creature',
    };
  }
  
  // Stuffy Doll pattern - damage to Stuffy Doll is dealt to chosen player
  if (cardName.includes('stuffy doll')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Stuffy Doll',
      from: 'controller',  // Actually "to this creature"
      to: 'chosen_player',
      chosenPlayerId: permanent?.chosenPlayer,  // Set when entering
    };
  }
  
  // Generic pattern detection
  if (oracleText.includes('all damage that would be dealt to you') && 
      oracleText.includes('is dealt to')) {
    if (oracleText.includes('enchanted creature')) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || 'Unknown',
        from: 'controller',
        to: 'enchanted_creature',
      };
    }
    if (oracleText.includes('equipped creature')) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || 'Unknown',
        from: 'controller',
        to: 'equipped_creature',
      };
    }
  }
  
  return null;
}

// ============================================================================
// Empire Artifacts Support (Crown, Scepter, Throne of Empires)
// ============================================================================

/**
 * The Empires artifact cycle from Magic 2012:
 * - Crown of Empires: {3}, {T}: Tap target creature. Gain control if you control Scepter and Throne.
 * - Scepter of Empires: {T}: Deal 1 damage to target player. Deal 3 if you control Crown and Throne.
 * - Throne of Empires: {1}, {T}: Create a 1/1 Soldier. Create 5 if you control Crown and Scepter.
 */
export interface EmpiresBonus {
  hasFullSet: boolean;
  controlsCrown: boolean;
  controlsScepter: boolean;
  controlsThrone: boolean;
}

export function checkEmpiresSet(gameState: any, playerId: string): EmpiresBonus {
  const battlefield = gameState?.battlefield || [];
  const controlledPermanents = battlefield.filter((p: any) => p?.controller === playerId);
  
  let controlsCrown = false;
  let controlsScepter = false;
  let controlsThrone = false;
  
  for (const perm of controlledPermanents) {
    const cardName = (perm?.card?.name || "").toLowerCase();
    if (cardName.includes('crown of empires')) controlsCrown = true;
    if (cardName.includes('scepter of empires')) controlsScepter = true;
    if (cardName.includes('throne of empires')) controlsThrone = true;
  }
  
  return {
    hasFullSet: controlsCrown && controlsScepter && controlsThrone,
    controlsCrown,
    controlsScepter,
    controlsThrone,
  };
}

/**
 * Get the bonus effect for an Empires artifact
 */
export function getEmpiresEffect(card: any, gameState: any, controllerId: string): {
  normalEffect: string;
  bonusEffect: string;
  bonusActive: boolean;
} | null {
  const cardName = (card?.name || "").toLowerCase();
  const empires = checkEmpiresSet(gameState, controllerId);
  
  if (cardName.includes('crown of empires')) {
    return {
      normalEffect: "Tap target creature",
      bonusEffect: "Gain control of target creature",
      bonusActive: empires.controlsScepter && empires.controlsThrone,
    };
  }
  
  if (cardName.includes('scepter of empires')) {
    return {
      normalEffect: "Deal 1 damage to target player or planeswalker",
      bonusEffect: "Deal 3 damage to target player or planeswalker",
      bonusActive: empires.controlsCrown && empires.controlsThrone,
    };
  }
  
  if (cardName.includes('throne of empires')) {
    return {
      normalEffect: "Create a 1/1 white Soldier creature token",
      bonusEffect: "Create five 1/1 white Soldier creature tokens",
      bonusActive: empires.controlsCrown && empires.controlsScepter,
    };
  }
  
  return null;
}

// ============================================================================
// Chromatic Lantern and Mana Fixing Support
// ============================================================================

/**
 * Cards that grant mana abilities to other permanents:
 * - Chromatic Lantern: Lands you control have "T: Add one mana of any color"
 * - Cryptolith Rite: Creatures you control have "T: Add one mana of any color"
 * - Elven Chorus: Creatures you control have "T: Add {G}"
 * - Song of Freyalise: Creatures you control have "T: Add one mana of any color"
 */
export interface ManaAbilityGranter {
  permanentId: string;
  cardName: string;
  grantsTo: 'lands' | 'creatures' | 'all_permanents';
  manaType: 'any_color' | 'specific_color';
  specificColor?: string;
}

export function detectManaAbilityGranter(card: any, permanent: any): ManaAbilityGranter | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Chromatic Lantern: Lands have "T: Add any color"
  if (cardName.includes('chromatic lantern')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Chromatic Lantern',
      grantsTo: 'lands',
      manaType: 'any_color',
    };
  }
  
  // Cryptolith Rite: Creatures have "T: Add any color"
  if (cardName.includes('cryptolith rite')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Cryptolith Rite',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Elven Chorus: Creatures have "T: Add {G}"
  if (cardName.includes('elven chorus')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Elven Chorus',
      grantsTo: 'creatures',
      manaType: 'specific_color',
      specificColor: 'G',
    };
  }
  
  // Song of Freyalise: Creatures have "T: Add any color"
  if (cardName.includes('song of freyalise')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Song of Freyalise',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Generic pattern: "Lands you control have" or "Creatures you control have"
  if (oracleText.includes('lands you control have') && 
      oracleText.includes('{t}: add')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      grantsTo: 'lands',
      manaType: oracleText.includes('any color') ? 'any_color' : 'specific_color',
    };
  }
  
  if (oracleText.includes('creatures you control have') && 
      oracleText.includes('{t}: add')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      grantsTo: 'creatures',
      manaType: oracleText.includes('any color') ? 'any_color' : 'specific_color',
    };
  }
  
  return null;
}

// ============================================================================
// Craterhoof Behemoth and Power/Toughness Boost Effects
// ============================================================================

/**
 * Cards that give +X/+X based on creature count:
 * - Craterhoof Behemoth: +X/+X where X is number of creatures you control
 * - Overwhelming Stampede: +X/+X where X is greatest power among creatures you control
 * - Thunderfoot Baloth: +2/+2 and trample while you control your commander
 * - End-Raze Forerunners: +2/+2, vigilance, trample until end of turn
 */
export interface MassBoostEffect {
  permanentId: string;
  cardName: string;
  boostType: 'creature_count' | 'greatest_power' | 'fixed' | 'conditional';
  fixedBoost?: { power: number; toughness: number };
  grantsKeywords?: string[];
  condition?: string;
  duration: 'until_eot' | 'static';
}

export function detectMassBoostEffect(card: any, permanent: any): MassBoostEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Craterhoof Behemoth: Creatures get +X/+X where X = creature count
  if (cardName.includes('craterhoof behemoth')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Craterhoof Behemoth',
      boostType: 'creature_count',
      grantsKeywords: ['trample'],
      duration: 'until_eot',
    };
  }
  
  // Overwhelming Stampede: +X/+X where X = greatest power
  if (cardName.includes('overwhelming stampede')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Overwhelming Stampede',
      boostType: 'greatest_power',
      grantsKeywords: ['trample'],
      duration: 'until_eot',
    };
  }
  
  // End-Raze Forerunners: +2/+2, vigilance, trample
  if (cardName.includes('end-raze forerunners')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'End-Raze Forerunners',
      boostType: 'fixed',
      fixedBoost: { power: 2, toughness: 2 },
      grantsKeywords: ['vigilance', 'trample'],
      duration: 'until_eot',
    };
  }
  
  // Thunderfoot Baloth: +2/+2 and trample while you control commander
  if (cardName.includes('thunderfoot baloth')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Thunderfoot Baloth',
      boostType: 'conditional',
      fixedBoost: { power: 2, toughness: 2 },
      grantsKeywords: ['trample'],
      condition: 'Control your commander',
      duration: 'static',
    };
  }
  
  return null;
}

/**
 * Calculate the boost amount for creature count or power-based effects
 */
export function calculateMassBoost(
  effect: MassBoostEffect,
  gameState: any,
  controllerId: string
): { power: number; toughness: number } {
  const battlefield = gameState?.battlefield || [];
  
  if (effect.boostType === 'fixed' && effect.fixedBoost) {
    return effect.fixedBoost;
  }
  
  if (effect.boostType === 'creature_count') {
    const creatureCount = battlefield.filter((p: any) => 
      p?.controller === controllerId &&
      (p.card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    return { power: creatureCount, toughness: creatureCount };
  }
  
  if (effect.boostType === 'greatest_power') {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== controllerId) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      const power = perm.basePower ?? perm.card?.power ?? 0;
      const numPower = typeof power === 'string' ? parseInt(power, 10) || 0 : power;
      if (numPower > greatestPower) greatestPower = numPower;
    }
    return { power: greatestPower, toughness: greatestPower };
  }
  
  if (effect.boostType === 'conditional' && effect.fixedBoost) {
    // Check condition
    if (effect.condition === 'Control your commander') {
      const hasCommander = battlefield.some((p: any) => 
        p?.controller === controllerId && p.isCommander
      );
      if (hasCommander) return effect.fixedBoost;
    }
  }
  
  return { power: 0, toughness: 0 };
}

// ============================================================================
// Lure and Combat Forcing Effects
// ============================================================================

/**
 * Cards that force creatures to block:
 * - Lure: All creatures able to block enchanted creature must do so
 * - Nemesis Mask: Same as Lure
 * - Shinen of Life's Roar: Same as Lure (on itself)
 * - Engulfing Slagwurm: Must be blocked if able (implicit via oracle text)
 */
export interface MustBlockEffect {
  permanentId: string;
  cardName: string;
  affects: 'enchanted' | 'equipped' | 'self';
  scope: 'all_creatures' | 'able_creatures';
}

export function detectMustBlockEffect(card: any, permanent: any): MustBlockEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Lure
  if (cardName === 'lure') {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Lure',
      affects: 'enchanted',
      scope: 'all_creatures',
    };
  }
  
  // Nemesis Mask
  if (cardName.includes('nemesis mask')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Nemesis Mask',
      affects: 'equipped',
      scope: 'all_creatures',
    };
  }
  
  // Generic "all creatures able to block" pattern
  if (oracleText.includes('all creatures able to block') && 
      oracleText.includes('do so')) {
    const affects = oracleText.includes('enchanted creature') ? 'enchanted' :
                   oracleText.includes('equipped creature') ? 'equipped' : 'self';
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      affects,
      scope: 'all_creatures',
    };
  }
  
  return null;
}

// ============================================================================
// Kira, Great Glass-Spinner and Spell/Ability Ward Effects
// ============================================================================

/**
 * Cards that counter the first spell/ability targeting creatures:
 * - Kira, Great Glass-Spinner: Counter the first spell or ability each turn
 * - Shalai, Voice of Plenty: Gives hexproof to you and your creatures
 * - Saryth, the Viper's Fang: Tapped creatures have deathtouch, untapped have hexproof
 */
export interface TargetingProtection {
  permanentId: string;
  cardName: string;
  protectionType: 'counter_first' | 'hexproof' | 'conditional_hexproof';
  affects: 'creatures_you_control' | 'you_and_creatures' | 'untapped_creatures' | 'tapped_creatures';
  counterPerTurn?: boolean;
}

export function detectTargetingProtection(card: any, permanent: any): TargetingProtection | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Kira, Great Glass-Spinner
  if (cardName.includes('kira') && cardName.includes('glass-spinner')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Kira, Great Glass-Spinner',
      protectionType: 'counter_first',
      affects: 'creatures_you_control',
      counterPerTurn: true,
    };
  }
  
  // Shalai, Voice of Plenty
  if (cardName.includes('shalai') && cardName.includes('voice of plenty')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Shalai, Voice of Plenty',
      protectionType: 'hexproof',
      affects: 'you_and_creatures',
    };
  }
  
  // Saryth, the Viper's Fang
  if (cardName.includes('saryth') && cardName.includes("viper's fang")) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Saryth, the Viper's Fang",
      protectionType: 'conditional_hexproof',
      affects: 'untapped_creatures',  // Also grants deathtouch to tapped
    };
  }
  
  return null;
}

// ============================================================================
// Serra Avatar and Power/Toughness Equal to Life Effects
// ============================================================================

/**
 * Cards with P/T equal to life total or other dynamic values:
 * - Serra Avatar: P/T equal to your life total
 * - Malignus: Power and toughness equal to half opponent's life (rounded up)
 * - Lord of Extinction: P/T equal to cards in all graveyards
 * - Multani, Yavimaya's Avatar: P/T equal to lands you control + lands in graveyard
 */
export interface DynamicPowerToughness {
  permanentId: string;
  cardName: string;
  baseOn: 'life_total' | 'half_opponent_life' | 'graveyard_cards' | 'lands_controlled_and_graveyard';
}

export function detectDynamicPT(card: any, permanent: any): DynamicPowerToughness | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Serra Avatar
  if (cardName.includes('serra avatar')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Serra Avatar',
      baseOn: 'life_total',
    };
  }
  
  // Malignus
  if (cardName.includes('malignus')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Malignus',
      baseOn: 'half_opponent_life',
    };
  }
  
  // Lord of Extinction
  if (cardName.includes('lord of extinction')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Lord of Extinction',
      baseOn: 'graveyard_cards',
    };
  }
  
  // Multani, Yavimaya's Avatar
  if (cardName.includes('multani') && cardName.includes('yavimaya')) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Multani, Yavimaya's Avatar",
      baseOn: 'lands_controlled_and_graveyard',
    };
  }
  
  // Generic pattern
  if (oracleText.includes("power and toughness are each equal to your life total")) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      baseOn: 'life_total',
    };
  }
  
  return null;
}

/**
 * Calculate dynamic P/T for cards like Serra Avatar
 */
export function calculateDynamicPT(
  effect: DynamicPowerToughness,
  gameState: any,
  controllerId: string
): { power: number; toughness: number } {
  const life = gameState?.life?.[controllerId] || 40;
  const battlefield = gameState?.battlefield || [];
  
  switch (effect.baseOn) {
    case 'life_total':
      return { power: life, toughness: life };
      
    case 'half_opponent_life': {
      const players = gameState?.players || [];
      const opponents = players.filter((p: any) => p.id !== controllerId);
      // Get highest life total among opponents
      let highestOpponentLife = 0;
      for (const opp of opponents) {
        const oppLife = gameState?.life?.[opp.id] || 40;
        if (oppLife > highestOpponentLife) highestOpponentLife = oppLife;
      }
      const halfLife = Math.ceil(highestOpponentLife / 2);
      return { power: halfLife, toughness: halfLife };
    }
    
    case 'graveyard_cards': {
      let totalCards = 0;
      const players = gameState?.players || [];
      for (const player of players) {
        const graveyard = gameState?.zones?.[player.id]?.graveyard || [];
        totalCards += graveyard.length;
      }
      return { power: totalCards, toughness: totalCards };
    }
    
    case 'lands_controlled_and_graveyard': {
      const landsControlled = battlefield.filter((p: any) => 
        p?.controller === controllerId &&
        (p.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      const graveyard = gameState?.zones?.[controllerId]?.graveyard || [];
      const landsInGraveyard = graveyard.filter((c: any) => 
        (c.type_line || '').toLowerCase().includes('land')
      ).length;
      const total = landsControlled + landsInGraveyard;
      return { power: total, toughness: total };
    }
  }
  
  return { power: 0, toughness: 0 };
}

// ============================================================================
// Traumatize and Mill Effects
// ============================================================================

/**
 * Cards that mill half library or large amounts:
 * - Traumatize: Mill half library (rounded down)
 * - Maddening Cacophony (kicked): Mill half library
 * - Fleet Swallower: Mill half library on combat damage
 */
export interface MassMillEffect {
  cardName: string;
  millType: 'half_library' | 'fixed_amount' | 'cards_in_hand';
  amount?: number;
  targetType: 'target_player' | 'all_opponents' | 'combat_damage_to_player';
}

export function detectMassMillEffect(card: any): MassMillEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Traumatize
  if (cardName.includes('traumatize')) {
    return {
      cardName: 'Traumatize',
      millType: 'half_library',
      targetType: 'target_player',
    };
  }
  
  // Maddening Cacophony
  if (cardName.includes('maddening cacophony')) {
    return {
      cardName: 'Maddening Cacophony',
      millType: 'half_library',  // When kicked
      targetType: 'all_opponents',
    };
  }
  
  // Fleet Swallower
  if (cardName.includes('fleet swallower')) {
    return {
      cardName: 'Fleet Swallower',
      millType: 'half_library',
      targetType: 'combat_damage_to_player',
    };
  }
  
  // Generic "mills half their library" pattern
  if (oracleText.includes('mills half') || 
      oracleText.includes('mill half') ||
      oracleText.includes('puts the top half')) {
    return {
      cardName: card?.name || 'Unknown',
      millType: 'half_library',
      targetType: oracleText.includes('target player') ? 'target_player' : 'all_opponents',
    };
  }
  
  return null;
}

// ============================================================================
// Archmage Ascension and Quest Counters
// ============================================================================

/**
 * Cards with quest/charge counter mechanics that trigger special effects:
 * - Archmage Ascension: 6 quest counters -> search library instead of draw
 * - Felidar Sovereign: Win at upkeep if 40+ life
 * - Quest for the Holy Relic: 5 quest counters -> search for Equipment
 */
export interface QuestCounter {
  permanentId: string;
  cardName: string;
  counterType: 'quest' | 'charge' | 'lore';
  threshold: number;
  thresholdEffect: string;
  triggerCondition: string;
}

export function detectQuestCounter(card: any, permanent: any): QuestCounter | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Archmage Ascension
  if (cardName.includes('archmage ascension')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Archmage Ascension',
      counterType: 'quest',
      threshold: 6,
      thresholdEffect: "Search your library for a card instead of drawing",
      triggerCondition: "Draw two or more cards in a turn",
    };
  }
  
  // Generic quest counter pattern
  if (oracleText.includes('quest counter')) {
    const thresholdMatch = oracleText.match(/(\d+) or more quest counters/);
    const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 5;
    
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      counterType: 'quest',
      threshold,
      thresholdEffect: "Special ability unlocked",
      triggerCondition: "Varies by card",
    };
  }
  
  return null;
}

// ============================================================================
// Utility Land Activated Abilities
// ============================================================================

/**
 * Lands with non-mana activated abilities:
 * - Ghost Quarter: Destroy target land. Its controller may search for a basic
 * - Homeward Path: Each player gains control of all creatures they own
 * - Rogue's Passage: Target creature can't be blocked this turn
 * - Nesting Grounds: Move a counter from one permanent to another
 * - Field of Ruin: Destroy target nonbasic land, each player searches for basic
 * - Detection Tower: Remove hexproof from opponent creatures
 * - Prahv, Spires of Order: Prevent all damage by target attacking/blocking creature
 */
export interface UtilityLandAbility {
  permanentId: string;
  cardName: string;
  cost: string;
  requiresTap: boolean;
  effect: string;
  targetType?: 'land' | 'nonbasic_land' | 'creature' | 'permanent' | 'counter';
  targetController?: 'any' | 'opponent' | 'you';
  additionalEffects?: string[];
}

const KNOWN_UTILITY_LANDS: Record<string, Omit<UtilityLandAbility, 'permanentId' | 'cardName'>> = {
  "ghost quarter": {
    cost: "{T}, Sacrifice ~",
    requiresTap: true,
    effect: "Destroy target land. Its controller may search for a basic land and put it onto the battlefield",
    targetType: 'land',
    targetController: 'any',
  },
  "homeward path": {
    cost: "{T}",
    requiresTap: true,
    effect: "Each player gains control of all creatures they own",
  },
  "rogue's passage": {
    cost: "{4}, {T}",
    requiresTap: true,
    effect: "Target creature can't be blocked this turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "nesting grounds": {
    cost: "{1}, {T}",
    requiresTap: true,
    effect: "Move a counter from target permanent you control onto another target permanent",
    targetType: 'counter',
    targetController: 'you',
    additionalEffects: ["Requires two targets", "Counter types must match"],
  },
  "field of ruin": {
    cost: "{2}, {T}, Sacrifice ~",
    requiresTap: true,
    effect: "Destroy target nonbasic land. Each player searches for a basic land and puts it onto the battlefield",
    targetType: 'nonbasic_land',
    targetController: 'any',
  },
  "detection tower": {
    cost: "{1}, {T}",
    requiresTap: true,
    effect: "Until end of turn, creatures your opponents control lose hexproof and shroud",
  },
  "prahv, spires of order": {
    cost: "{4}{W}{U}, {T}",
    requiresTap: true,
    effect: "Prevent all damage that would be dealt by target attacking or blocking creature this turn",
    targetType: 'creature',
    targetController: 'any',
  },
  "maze of ith": {
    cost: "{T}",
    requiresTap: true,
    effect: "Untap target attacking creature. Prevent all combat damage dealt to and dealt by that creature this turn",
    targetType: 'creature',
    targetController: 'any',
  },
  "mystifying maze": {
    cost: "{4}, {T}",
    requiresTap: true,
    effect: "Exile target attacking creature. At end of combat, return it tapped",
    targetType: 'creature',
    targetController: 'any',
  },
  "thespian's stage": {
    cost: "{2}, {T}",
    requiresTap: true,
    effect: "This land becomes a copy of target land, except it has this ability",
    targetType: 'land',
    targetController: 'any',
  },
  "kessig wolf run": {
    cost: "{X}{R}{G}, {T}",
    requiresTap: true,
    effect: "Target creature gets +X/+0 and gains trample until end of turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "alchemist's refuge": {
    cost: "{G}{U}, {T}",
    requiresTap: true,
    effect: "You may cast spells this turn as though they had flash",
  },
  "gavony township": {
    cost: "{2}{G}{W}, {T}",
    requiresTap: true,
    effect: "Put a +1/+1 counter on each creature you control",
  },
  "vault of the archangel": {
    cost: "{2}{W}{B}, {T}",
    requiresTap: true,
    effect: "Creatures you control gain deathtouch and lifelink until end of turn",
  },
  "slayers' stronghold": {
    cost: "{R}{W}, {T}",
    requiresTap: true,
    effect: "Target creature gets +2/+0 and gains vigilance and haste until end of turn",
    targetType: 'creature',
    targetController: 'you',
  },
};

export function detectUtilityLandAbility(card: any, permanent: any): UtilityLandAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_UTILITY_LANDS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...abilityInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Equipment Effects (Grafted Exoskeleton, Assault Suit, Umbral Mantle, Bear Umbra)
// ============================================================================

export interface EquipmentEffect {
  permanentId: string;
  cardName: string;
  equipCost: string;
  grantedKeywords?: string[];
  grantedPTBoost?: { power: number; toughness: number };
  grantedAbilities?: string[];
  specialEffect?: string;
  triggers?: string[];
  restrictions?: string[];
}

const KNOWN_EQUIPMENT_EFFECTS: Record<string, Omit<EquipmentEffect, 'permanentId' | 'cardName'>> = {
  "grafted exoskeleton": {
    equipCost: "{2}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['infect'],
    restrictions: ["When equipment becomes unattached, sacrifice creature"],
  },
  "assault suit": {
    equipCost: "{3}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['haste'],
    specialEffect: "At each opponent's upkeep, you may have them gain control of equipped creature until end of turn. It can't attack you or be sacrificed",
    restrictions: ["Equipped creature can't be sacrificed"],
  },
  "umbral mantle": {
    equipCost: "{0}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedAbilities: ["{3}, Untap: This creature gets +2/+2 until end of turn"],
    specialEffect: "Equipped creature has '{3}, {Q}: This creature gets +2/+2 until end of turn'",
  },
  "sword of the animist": {
    equipCost: "{2}",
    grantedPTBoost: { power: 1, toughness: 1 },
    triggers: ["Whenever equipped creature attacks, search for a basic land and put it onto the battlefield tapped"],
  },
  "sword of feast and famine": {
    equipCost: "{2}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['protection from black', 'protection from green'],
    triggers: ["Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control"],
  },
  "skullclamp": {
    equipCost: "{1}",
    grantedPTBoost: { power: 1, toughness: -1 },
    triggers: ["When equipped creature dies, draw two cards"],
  },
  "lightning greaves": {
    equipCost: "{0}",
    grantedKeywords: ['shroud', 'haste'],
  },
  "swiftfoot boots": {
    equipCost: "{1}",
    grantedKeywords: ['hexproof', 'haste'],
  },
  "helm of the host": {
    equipCost: "{5}",
    triggers: ["At the beginning of combat on your turn, create a token copy of equipped creature, except it's not legendary"],
  },
};

export function detectEquipmentEffect(card: any, permanent: any): EquipmentEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_EQUIPMENT_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Aura Umbra Effects (Totem Armor)
// ============================================================================

export interface TotemArmorEffect {
  permanentId: string;
  cardName: string;
  grantedKeywords?: string[];
  grantedPTBoost?: { power: number; toughness: number };
  triggers?: string[];
}

const KNOWN_UMBRA_EFFECTS: Record<string, Omit<TotemArmorEffect, 'permanentId' | 'cardName'>> = {
  "bear umbra": {
    grantedPTBoost: { power: 2, toughness: 2 },
    triggers: ["Whenever enchanted creature attacks, untap all lands you control"],
  },
  "snake umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    triggers: ["Whenever enchanted creature deals damage to a player, you may draw a card"],
  },
  "spider umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['reach'],
  },
  "boar umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
  },
  "mammoth umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
    grantedKeywords: ['vigilance'],
  },
  "hyena umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['first strike'],
  },
  "drake umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
    grantedKeywords: ['flying'],
  },
  "eel umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    // Also has flash
  },
  "felidar umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['lifelink'],
  },
};

export function detectUmbraEffect(card: any, permanent: any): TotemArmorEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check if it has totem armor
  const hasTotemArmor = oracleText.includes('totem armor') || 
                        card?.keywords?.some((k: string) => k.toLowerCase() === 'totem armor');
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_UMBRA_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  // Generic umbra detection
  if (hasTotemArmor || cardName.includes('umbra')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown Umbra',
    };
  }
  
  return null;
}

// ============================================================================
// Eldrazi Effects (Ulamog, Annihilator, etc.)
// ============================================================================

export interface EldraziEffect {
  permanentId: string;
  cardName: string;
  annihilator?: number;
  castTrigger?: string;
  attackTrigger?: string;
  specialAbility?: string;
  indestructible?: boolean;
}

const KNOWN_ELDRAZI_EFFECTS: Record<string, Omit<EldraziEffect, 'permanentId' | 'cardName'>> = {
  "ulamog, the defiler": {
    castTrigger: "When you cast this spell, target opponent exiles half their library",
    annihilator: 0, // Has special annihilator based on opponents exiled cards
    specialAbility: "Ward - Sacrifice two permanents",
    indestructible: true,
  },
  "ulamog, the ceaseless hunger": {
    castTrigger: "When you cast this spell, exile two target permanents",
    attackTrigger: "Whenever this creature attacks, defending player exiles the top 20 cards of their library",
    indestructible: true,
  },
  "ulamog, the infinite gyre": {
    castTrigger: "When you cast this spell, destroy target permanent",
    annihilator: 4,
    indestructible: true,
    specialAbility: "When put into graveyard from anywhere, shuffle graveyard into library",
  },
  "kozilek, butcher of truth": {
    castTrigger: "When you cast this spell, draw four cards",
    annihilator: 4,
    specialAbility: "When put into graveyard from anywhere, shuffle graveyard into library",
  },
  "emrakul, the aeons torn": {
    castTrigger: "This spell can't be countered. Take an extra turn after this one",
    annihilator: 6,
    specialAbility: "Flying, protection from spells that are one or more colors. When put into graveyard from anywhere, shuffle graveyard into library",
  },
  "emrakul, the promised end": {
    castTrigger: "When you cast this spell, you gain control of target opponent during that player's next turn",
    specialAbility: "Flying, trample, protection from instants",
  },
};

export function detectEldraziEffect(card: any, permanent: any): EldraziEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_ELDRAZI_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Control Change Effects (Reins of Power, Humble Defector, etc.)
// ============================================================================

export interface ControlChangeEffect {
  cardName: string;
  effectType: 'exchange_creatures' | 'give_control' | 'steal_control' | 'donate';
  duration: 'until_eot' | 'permanent' | 'until_condition';
  targets?: string;
  restrictions?: string[];
}

const KNOWN_CONTROL_CHANGE_EFFECTS: Record<string, ControlChangeEffect> = {
  "reins of power": {
    cardName: "Reins of Power",
    effectType: 'exchange_creatures',
    duration: 'until_eot',
    targets: "You and target opponent exchange control of all creatures",
    restrictions: ["Untap all creatures", "Creatures gain haste until end of turn"],
  },
  "humble defector": {
    cardName: "Humble Defector",
    effectType: 'give_control',
    duration: 'permanent',
    targets: "Target opponent gains control of Humble Defector",
    restrictions: ["Activate only as a sorcery", "Draw two cards first"],
  },
  "act of treason": {
    cardName: "Act of Treason",
    effectType: 'steal_control',
    duration: 'until_eot',
    targets: "Target creature",
    restrictions: ["Untap that creature", "It gains haste"],
  },
  "threaten": {
    cardName: "Threaten",
    effectType: 'steal_control',
    duration: 'until_eot',
    targets: "Target creature",
    restrictions: ["Untap that creature", "It gains haste"],
  },
  "dominate": {
    cardName: "Dominate",
    effectType: 'steal_control',
    duration: 'permanent',
    targets: "Target creature with mana value X or less",
  },
};

export function detectControlChangeEffect(card: any): ControlChangeEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_CONTROL_CHANGE_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// ============================================================================
// Infect and Poison Effects (Triumph of the Hordes, etc.)
// ============================================================================

export interface InfectGrantEffect {
  cardName: string;
  grantsTo: 'all_creatures' | 'target_creature' | 'equipped_creature';
  duration: 'until_eot' | 'permanent';
  additionalBoost?: { power: number; toughness: number };
  additionalKeywords?: string[];
}

const KNOWN_INFECT_GRANTS: Record<string, InfectGrantEffect> = {
  "triumph of the hordes": {
    cardName: "Triumph of the Hordes",
    grantsTo: 'all_creatures',
    duration: 'until_eot',
    additionalBoost: { power: 1, toughness: 1 },
    additionalKeywords: ['trample', 'infect'],
  },
  "tainted strike": {
    cardName: "Tainted Strike",
    grantsTo: 'target_creature',
    duration: 'until_eot',
    additionalBoost: { power: 1, toughness: 0 },
    additionalKeywords: ['infect'],
  },
  "grafted exoskeleton": {
    cardName: "Grafted Exoskeleton",
    grantsTo: 'equipped_creature',
    duration: 'permanent',
    additionalBoost: { power: 2, toughness: 2 },
    additionalKeywords: ['infect'],
  },
  "phyresis": {
    cardName: "Phyresis",
    grantsTo: 'equipped_creature', // Actually enchanted
    duration: 'permanent',
    additionalKeywords: ['infect'],
  },
};

export function detectInfectGrantEffect(card: any): InfectGrantEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_INFECT_GRANTS)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// ============================================================================
// Temple Bell and Group Draw Effects
// ============================================================================

export interface GroupDrawEffect {
  permanentId: string;
  cardName: string;
  cost: string;
  drawAmount: number;
  affectedPlayers: 'all' | 'each_opponent' | 'you' | 'target_player';
  additionalEffects?: string[];
}

const KNOWN_GROUP_DRAW_EFFECTS: Record<string, Omit<GroupDrawEffect, 'permanentId' | 'cardName'>> = {
  "temple bell": {
    cost: "{T}",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
  "howling mine": {
    cost: "Static (at draw step)",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
  "font of mythos": {
    cost: "Static (at draw step)",
    drawAmount: 2,
    affectedPlayers: 'all',
  },
  "seizan, perverter of truth": {
    cost: "Static (at upkeep)",
    drawAmount: 2,
    affectedPlayers: 'all',
    additionalEffects: ["Each player loses 2 life"],
  },
  "master of the feast": {
    cost: "Static (at your upkeep)",
    drawAmount: 1,
    affectedPlayers: 'each_opponent',
  },
  "kami of the crescent moon": {
    cost: "Static (at draw step)",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
};

export function detectGroupDrawEffect(card: any, permanent: any): GroupDrawEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_GROUP_DRAW_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Myriad Landscape and Multi-Target Land Search
// ============================================================================

/**
 * Lands that search for multiple lands with a shared type:
 * - Myriad Landscape: Search for 2 basic lands that share a land type
 * - Blighted Woodland: Search for 2 basic lands
 * - Krosan Verge: Search for a Forest and a Plains
 */
export interface MultiTargetLandSearch {
  permanentId: string;
  cardName: string;
  cost: string;
  searchCount: number;
  landTypeRestriction: 'share_type' | 'basic' | 'specific_types';
  specificTypes?: string[];
  putOntoTapped: boolean;
  requiresSacrifice: boolean;
}

const KNOWN_MULTI_TARGET_LAND_SEARCH: Record<string, Omit<MultiTargetLandSearch, 'permanentId' | 'cardName'>> = {
  "myriad landscape": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'share_type',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "blighted woodland": {
    cost: "{3}{G}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'basic',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "krosan verge": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'specific_types',
    specificTypes: ['forest', 'plains'],
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "terminal moraine": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 1,
    landTypeRestriction: 'basic',
    putOntoTapped: false,
    requiresSacrifice: true,
  },
  "warped landscape": {
    cost: "{1}, {T}, Sacrifice ~",
    searchCount: 1,
    landTypeRestriction: 'basic',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
};

export function detectMultiTargetLandSearch(card: any, permanent: any): MultiTargetLandSearch | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, searchInfo] of Object.entries(KNOWN_MULTI_TARGET_LAND_SEARCH)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...searchInfo,
      };
    }
  }
  
  return null;
}

/**
 * Validate that lands share a basic land type for Myriad Landscape
 */
export function validateSharedLandType(land1: any, land2: any): boolean {
  const typeLine1 = (land1?.card?.type_line || "").toLowerCase();
  const typeLine2 = (land2?.card?.type_line || "").toLowerCase();
  
  const basicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  
  for (const basicType of basicTypes) {
    if (typeLine1.includes(basicType) && typeLine2.includes(basicType)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Castle Garenbrig and Conditional ETB Tapped
// ============================================================================

/**
 * Lands that enter tapped unless a condition is met:
 * - Castle Garenbrig: Unless you control a Forest
 * - Castle Vantress: Unless you control an Island
 * - Castle Locthwain: Unless you control a Swamp
 * - Castle Embereth: Unless you control a Mountain
 * - Castle Ardenvale: Unless you control a Plains
 * - Checklands (Dragonskull Summit, etc.): Unless you control a [type]
 */
export interface ConditionalETBTapped {
  cardName: string;
  condition: string;
  requiredLandType?: string;
  requiredLandTypes?: string[];
  alternateCondition?: string;
}

const KNOWN_CONDITIONAL_ETB_TAPPED: Record<string, ConditionalETBTapped> = {
  // Castle lands (Eldraine)
  "castle garenbrig": {
    cardName: "Castle Garenbrig",
    condition: "Unless you control a Forest",
    requiredLandType: 'forest',
  },
  "castle vantress": {
    cardName: "Castle Vantress",
    condition: "Unless you control an Island",
    requiredLandType: 'island',
  },
  "castle locthwain": {
    cardName: "Castle Locthwain",
    condition: "Unless you control a Swamp",
    requiredLandType: 'swamp',
  },
  "castle embereth": {
    cardName: "Castle Embereth",
    condition: "Unless you control a Mountain",
    requiredLandType: 'mountain',
  },
  "castle ardenvale": {
    cardName: "Castle Ardenvale",
    condition: "Unless you control a Plains",
    requiredLandType: 'plains',
  },
  // Checklands (M10/Innistrad)
  "dragonskull summit": {
    cardName: "Dragonskull Summit",
    condition: "Unless you control a Swamp or a Mountain",
    requiredLandTypes: ['swamp', 'mountain'],
  },
  "drowned catacomb": {
    cardName: "Drowned Catacomb",
    condition: "Unless you control an Island or a Swamp",
    requiredLandTypes: ['island', 'swamp'],
  },
  "glacial fortress": {
    cardName: "Glacial Fortress",
    condition: "Unless you control a Plains or an Island",
    requiredLandTypes: ['plains', 'island'],
  },
  "rootbound crag": {
    cardName: "Rootbound Crag",
    condition: "Unless you control a Mountain or a Forest",
    requiredLandTypes: ['mountain', 'forest'],
  },
  "sunpetal grove": {
    cardName: "Sunpetal Grove",
    condition: "Unless you control a Forest or a Plains",
    requiredLandTypes: ['forest', 'plains'],
  },
  "clifftop retreat": {
    cardName: "Clifftop Retreat",
    condition: "Unless you control a Mountain or a Plains",
    requiredLandTypes: ['mountain', 'plains'],
  },
  "hinterland harbor": {
    cardName: "Hinterland Harbor",
    condition: "Unless you control a Forest or an Island",
    requiredLandTypes: ['forest', 'island'],
  },
  "isolated chapel": {
    cardName: "Isolated Chapel",
    condition: "Unless you control a Plains or a Swamp",
    requiredLandTypes: ['plains', 'swamp'],
  },
  "sulfur falls": {
    cardName: "Sulfur Falls",
    condition: "Unless you control an Island or a Mountain",
    requiredLandTypes: ['island', 'mountain'],
  },
  "woodland cemetery": {
    cardName: "Woodland Cemetery",
    condition: "Unless you control a Swamp or a Forest",
    requiredLandTypes: ['swamp', 'forest'],
  },
};

export function detectConditionalETBTapped(card: any): ConditionalETBTapped | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, condition] of Object.entries(KNOWN_CONDITIONAL_ETB_TAPPED)) {
    if (cardName.includes(knownName)) {
      return condition;
    }
  }
  
  // Dynamic detection from oracle text
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Pattern: "enters the battlefield tapped unless you control a [land type]"
  const unlessControlMatch = oracleText.match(
    /enters the battlefield tapped unless you control (?:a|an) (\w+)(?: or (?:a|an) (\w+))?/i
  );
  
  if (unlessControlMatch) {
    const type1 = unlessControlMatch[1];
    const type2 = unlessControlMatch[2];
    
    if (type2) {
      return {
        cardName: card?.name || 'Unknown',
        condition: `Unless you control a ${type1} or a ${type2}`,
        requiredLandTypes: [type1, type2],
      };
    } else {
      return {
        cardName: card?.name || 'Unknown',
        condition: `Unless you control a ${type1}`,
        requiredLandType: type1,
      };
    }
  }
  
  return null;
}

/**
 * Check if the conditional ETB tapped condition is met (enters untapped)
 */
export function checkConditionalETBMet(
  condition: ConditionalETBTapped,
  gameState: any,
  playerId: string
): boolean {
  const battlefield = gameState?.battlefield || [];
  
  // Check if player controls the required land type(s)
  const controlledLands = battlefield.filter((p: any) => 
    p?.controller === playerId &&
    (p.card?.type_line || '').toLowerCase().includes('land')
  );
  
  if (condition.requiredLandType) {
    return controlledLands.some((land: any) => 
      (land.card?.type_line || '').toLowerCase().includes(condition.requiredLandType!)
    );
  }
  
  if (condition.requiredLandTypes) {
    return controlledLands.some((land: any) => {
      const typeLine = (land.card?.type_line || '').toLowerCase();
      return condition.requiredLandTypes!.some(type => typeLine.includes(type));
    });
  }
  
  return false;
}

// ============================================================================
// Staff of Domination Multi-Mode Abilities
// ============================================================================

/**
 * Cards with multiple activated abilities (modal artifacts):
 * - Staff of Domination: Multiple tap abilities with different costs
 * - Birthing Pod: Multiple activation options
 * - Nevinyrral's Disk: Single but important activated ability
 */
export interface MultiModeActivatedAbility {
  permanentId: string;
  cardName: string;
  modes: {
    name: string;
    cost: string;
    effect: string;
    requiresTarget: boolean;
    targetType?: string;
  }[];
}

const KNOWN_MULTI_MODE_ABILITIES: Record<string, { modes: MultiModeActivatedAbility['modes'] }> = {
  "staff of domination": {
    modes: [
      { name: "Untap Staff", cost: "{1}", effect: "Untap Staff of Domination", requiresTarget: false },
      { name: "Draw Card", cost: "{5}, {T}", effect: "Draw a card", requiresTarget: false },
      { name: "Gain 1 Life", cost: "{3}, {T}", effect: "You gain 1 life", requiresTarget: false },
      { name: "Untap Creature", cost: "{4}, {T}", effect: "Untap target creature", requiresTarget: true, targetType: 'creature' },
      { name: "Tap Creature", cost: "{2}, {T}", effect: "Tap target creature", requiresTarget: true, targetType: 'creature' },
    ],
  },
  "trading post": {
    modes: [
      { name: "Discard, Gain Life", cost: "{1}, {T}, Discard a card", effect: "You gain 4 life", requiresTarget: false },
      { name: "Pay Life, Draw", cost: "{1}, {T}, Pay 1 life", effect: "Put the top card of your library into your graveyard, then draw a card", requiresTarget: false },
      { name: "Sacrifice Creature, Return Artifact", cost: "{1}, {T}, Sacrifice a creature", effect: "Return target artifact card from your graveyard to your hand", requiresTarget: true, targetType: 'artifact_in_graveyard' },
      { name: "Sacrifice Artifact, Create Goat", cost: "{1}, {T}, Sacrifice an artifact", effect: "Create a 0/1 white Goat creature token", requiresTarget: false },
    ],
  },
  "mind stone": {
    modes: [
      { name: "Tap for Mana", cost: "{T}", effect: "Add {C}", requiresTarget: false },
      { name: "Sacrifice for Card", cost: "{1}, {T}, Sacrifice ~", effect: "Draw a card", requiresTarget: false },
    ],
  },
  "commander's sphere": {
    modes: [
      { name: "Tap for Mana", cost: "{T}", effect: "Add one mana of any color in your commander's color identity", requiresTarget: false },
      { name: "Sacrifice for Card", cost: "Sacrifice ~", effect: "Draw a card", requiresTarget: false },
    ],
  },
  // Laser Screwdriver - Doctor Who Commander card with 4 distinct tap abilities
  // {T}: Add one mana of any color.
  // {1}, {T}: Tap target artifact.
  // {2}, {T}: Surveil 1.
  // {3}, {T}: Goad target creature.
  "laser screwdriver": {
    modes: [
      { name: "Add Mana", cost: "{T}", effect: "Add one mana of any color", requiresTarget: false },
      { name: "Tap Artifact", cost: "{1}, {T}", effect: "Tap target artifact", requiresTarget: true, targetType: 'artifact' },
      { name: "Surveil 1", cost: "{2}, {T}", effect: "Surveil 1. (Look at the top card of your library. You may put that card into your graveyard.)", requiresTarget: false },
      { name: "Goad Creature", cost: "{3}, {T}", effect: "Goad target creature. (Until your next turn, it attacks each combat if able and attacks a player other than you if able.)", requiresTarget: true, targetType: 'creature' },
    ],
  },
  // Sensei's Divining Top - commonly used artifact with multiple abilities
  "sensei's divining top": {
    modes: [
      { name: "Look at Top 3", cost: "{1}", effect: "Look at the top three cards of your library, then put them back in any order", requiresTarget: false },
      { name: "Draw and Put on Top", cost: "{T}", effect: "Draw a card, then put ~ on top of its owner's library", requiresTarget: false },
    ],
  },
  // Batterskull - Living Weapon equipment with vigilance/lifelink
  "batterskull": {
    modes: [
      { name: "Return to Hand", cost: "{3}", effect: "Return Batterskull to its owner's hand", requiresTarget: false },
      { name: "Equip", cost: "{5}", effect: "Attach to target creature you control. Equip only as a sorcery.", requiresTarget: true, targetType: 'creature' },
    ],
  },
};

export function detectMultiModeAbility(card: any, permanent: any): MultiModeActivatedAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = card?.oracle_text || "";
  
  // First check known cards for accurate data
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_MULTI_MODE_ABILITIES)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        modes: abilityInfo.modes,
      };
    }
  }
  
  // Dynamic parsing: Parse oracle text for multiple activated abilities
  // This handles any card with multiple activated abilities not in the known list
  const parsedModes = parseActivatedAbilitiesFromOracleText(oracleText, cardName);
  
  // Only return as multi-mode if there are 2+ distinct activated abilities
  if (parsedModes.length >= 2) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      modes: parsedModes,
    };
  }
  
  return null;
}

/**
 * Dynamically parse activated abilities from oracle text.
 * Activated abilities follow the pattern: [Cost]: [Effect]
 * 
 * This handles:
 * - Mana abilities: {T}: Add {C}
 * - Tap abilities: {1}, {T}: Draw a card
 * - Non-tap abilities: {2}: Gain 1 life
 * - Sacrifice abilities: {1}, Sacrifice ~: Effect
 * - Multiple abilities separated by newlines
 * 
 * @param oracleText The card's oracle text
 * @param cardName The card's name (for self-reference replacement)
 * @returns Array of parsed ability modes
 */
function parseActivatedAbilitiesFromOracleText(
  oracleText: string, 
  cardName: string
): MultiModeActivatedAbility['modes'] {
  const modes: MultiModeActivatedAbility['modes'] = [];
  
  if (!oracleText) return modes;
  
  // Split by newlines to separate different abilities
  const lines = oracleText.split('\n').filter(line => line.trim());
  
  // Pattern to match activated abilities: [Cost]: [Effect]
  // Cost part contains mana symbols, tap symbol, sacrifice, pay life, etc.
  // The colon separates cost from effect
  // Captures: (cost) : (effect)
  const activatedAbilityPattern = /^([^:]+(?:\{[^}]+\})[^:]*?):\s*(.+)$/i;
  
  // Alternative pattern for abilities that start with mana/tap symbols
  const manaOrTapStartPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*[^:]+)?):\s*(.+)$/i;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip reminder text (in parentheses)
    if (trimmedLine.startsWith('(') && trimmedLine.endsWith(')')) continue;
    
    // Skip keyword abilities and triggered abilities
    if (/^(when|whenever|at the beginning|at end)/i.test(trimmedLine)) continue;
    if (/^(flying|trample|haste|vigilance|lifelink|deathtouch|first strike|double strike|menace|reach|hexproof|indestructible|flash)/i.test(trimmedLine)) continue;
    
    // Try to match activated ability pattern
    let match = trimmedLine.match(manaOrTapStartPattern);
    if (!match) {
      match = trimmedLine.match(activatedAbilityPattern);
    }
    
    if (match) {
      const cost = match[1].trim();
      const effect = match[2].trim();
      
      // Validate this looks like a real cost (contains mana symbols, tap, sacrifice, etc.)
      const hasCostIndicator = /\{[^}]+\}|sacrifice|pay|discard|exile|tap|untap/i.test(cost);
      if (!hasCostIndicator) continue;
      
      // Detect if this ability requires a target
      const requiresTarget = /target/i.test(effect);
      let targetType: string | undefined;
      
      if (requiresTarget) {
        // Try to determine target type
        if (/target creature/i.test(effect)) targetType = 'creature';
        else if (/target artifact/i.test(effect)) targetType = 'artifact';
        else if (/target enchantment/i.test(effect)) targetType = 'enchantment';
        else if (/target player/i.test(effect)) targetType = 'player';
        else if (/target opponent/i.test(effect)) targetType = 'opponent';
        else if (/target permanent/i.test(effect)) targetType = 'permanent';
        else if (/any target/i.test(effect)) targetType = 'any';
        else targetType = 'unknown';
      }
      
      // Generate a readable name for the ability
      const name = generateAbilityName(cost, effect);
      
      modes.push({
        name,
        cost,
        effect,
        requiresTarget,
        targetType,
      });
    }
  }
  
  return modes;
}

/**
 * Generate a human-readable name for an activated ability based on its cost and effect
 */
function generateAbilityName(cost: string, effect: string): string {
  // Check for common ability patterns
  if (/add.*mana|add \{[wubrgc]\}/i.test(effect)) {
    return 'Tap for Mana';
  }
  if (/draw.*card/i.test(effect)) {
    return 'Draw Card';
  }
  if (/gain.*life/i.test(effect)) {
    return 'Gain Life';
  }
  if (/create.*token/i.test(effect)) {
    return 'Create Token';
  }
  if (/tap target/i.test(effect)) {
    return 'Tap Target';
  }
  if (/untap target/i.test(effect)) {
    return 'Untap Target';
  }
  if (/destroy target/i.test(effect)) {
    return 'Destroy Target';
  }
  if (/exile target/i.test(effect)) {
    return 'Exile Target';
  }
  if (/deal.*damage/i.test(effect)) {
    return 'Deal Damage';
  }
  if (/surveil/i.test(effect)) {
    return 'Surveil';
  }
  if (/scry/i.test(effect)) {
    return 'Scry';
  }
  if (/goad/i.test(effect)) {
    return 'Goad';
  }
  if (/counter target/i.test(effect)) {
    return 'Counter';
  }
  if (/search your library/i.test(effect)) {
    return 'Search Library';
  }
  if (/sacrifice/i.test(cost)) {
    return 'Sacrifice Ability';
  }
  
  // Default: truncate effect to first few words
  const words = effect.split(' ').slice(0, 3).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ============================================================================
// Genesis Wave and Library Reveal/Play Effects
// ============================================================================

/**
 * Cards that reveal cards from library and put them onto battlefield:
 * - Genesis Wave: Reveal X cards, put permanents with MV X or less onto battlefield
 * - Collected Company: Look at top 6, put 2 creatures (MV 3 or less) onto battlefield
 * - Finale of Devastation: Search for creature, put onto battlefield
 * - Chord of Calling: Search for creature with MV X or less
 * - Green Sun's Zenith: Search for green creature with MV X or less
 */
export interface LibraryRevealPlayEffect {
  cardName: string;
  revealCount: number | 'X';
  xMultiplier?: number;
  filterType: 'permanent_mv' | 'creature_mv' | 'land' | 'any';
  maxMV?: number | 'X';
  destination: 'battlefield' | 'hand' | 'graveyard' | 'bottom';
  additionalEffect?: string;
}

const KNOWN_LIBRARY_REVEAL_PLAY: Record<string, LibraryRevealPlayEffect> = {
  "genesis wave": {
    cardName: "Genesis Wave",
    revealCount: 'X',
    filterType: 'permanent_mv',
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "Put the rest on the bottom of your library in any order",
  },
  "collected company": {
    cardName: "Collected Company",
    revealCount: 6,
    filterType: 'creature_mv',
    maxMV: 3,
    destination: 'battlefield',
    additionalEffect: "Put up to 2 creatures onto the battlefield",
  },
  "finale of devastation": {
    cardName: "Finale of Devastation",
    revealCount: 'X',
    filterType: 'creature_mv',
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "If X is 10 or more, creatures get +X/+X and haste",
  },
  "chord of calling": {
    cardName: "Chord of Calling",
    revealCount: 0, // Searches directly, doesn't reveal
    filterType: 'creature_mv',
    maxMV: 'X',
    destination: 'battlefield',
  },
  "green sun's zenith": {
    cardName: "Green Sun's Zenith",
    revealCount: 0, // Searches directly
    filterType: 'creature_mv', // Green creature specifically
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "Shuffle this card into your library",
  },
  "natural order": {
    cardName: "Natural Order",
    revealCount: 0, // Searches directly
    filterType: 'creature_mv', // Green creature specifically
    destination: 'battlefield',
    additionalEffect: "Sacrifice a green creature as additional cost",
  },
  "see the unwritten": {
    cardName: "See the Unwritten",
    revealCount: 8,
    filterType: 'creature_mv',
    destination: 'battlefield',
    additionalEffect: "Ferocious: Put 2 creatures if you control creature with power 4+",
  },
};

export function detectLibraryRevealPlayEffect(card: any): LibraryRevealPlayEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_LIBRARY_REVEAL_PLAY)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// NOTE: Reanimate Effects have been moved to ./triggers/reanimate.ts
// Re-exports are at the top of this file

// ============================================================================
// Eladamri and Top Card Viewing Effects
// ============================================================================

/**
 * Cards that let you look at the top card(s) of your library:
 * - Eladamri, Lord of Leaves: Look at top card, may play forests
 * - Courser of Kruphix: Play lands from top
 * - Oracle of Mul Daya: Play lands from top, additional land drop
 * - Vizier of the Menagerie: Cast creatures from top
 * - Future Sight: Play cards from top
 */
export interface TopCardViewEffect {
  permanentId: string;
  cardName: string;
  viewCount: number;
  revealToAll: boolean;
  canPlayTypes?: string[];
  additionalLandDrop?: boolean;
}

const KNOWN_TOP_CARD_VIEW: Record<string, Omit<TopCardViewEffect, 'permanentId' | 'cardName'>> = {
  "courser of kruphix": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land'],
  },
  "oracle of mul daya": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land'],
    additionalLandDrop: true,
  },
  "vizier of the menagerie": {
    viewCount: 1,
    revealToAll: false, // Can look, but only revealed when you cast
    canPlayTypes: ['creature'],
  },
  "future sight": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
  },
  "precognition field": {
    viewCount: 1,
    revealToAll: false,
    canPlayTypes: ['instant', 'sorcery'],
  },
  "bolas's citadel": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
    // Note: Pays life equal to MV instead of mana cost
  },
  "experimental frenzy": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
    // Note: Can't play cards from hand
  },
  "radha, heart of keld": {
    viewCount: 1,
    revealToAll: false,
    canPlayTypes: ['land'],
  },
  "garruk's horde": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['creature'],
  },
};

export function detectTopCardViewEffect(card: any, permanent: any): TopCardViewEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_TOP_CARD_VIEW)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Traverse the Outlands and Power-Based Land Search
// ============================================================================

/**
 * Cards that search for lands based on creature power or other variable:
 * - Traverse the Outlands: Search for X basic lands where X = greatest power
 * - Boundless Realms: Search for basic lands up to number you control
 * - Reshape the Earth: Search for any 10 lands
 */
export interface PowerBasedLandSearch {
  cardName: string;
  searchBasis: 'greatest_power' | 'lands_controlled' | 'fixed';
  landType: 'basic' | 'any';
  fixedCount?: number;
  entersTapped: boolean;
}

const KNOWN_POWER_BASED_LAND_SEARCH: Record<string, PowerBasedLandSearch> = {
  "traverse the outlands": {
    cardName: "Traverse the Outlands",
    searchBasis: 'greatest_power',
    landType: 'basic',
    entersTapped: true,
  },
  "boundless realms": {
    cardName: "Boundless Realms",
    searchBasis: 'lands_controlled',
    landType: 'basic',
    entersTapped: true,
  },
  "reshape the earth": {
    cardName: "Reshape the Earth",
    searchBasis: 'fixed',
    landType: 'any',
    fixedCount: 10,
    entersTapped: true,
  },
  "scapeshift": {
    cardName: "Scapeshift",
    searchBasis: 'lands_controlled', // Sacrifice any number, search that many
    landType: 'any',
    entersTapped: false,
  },
};

export function detectPowerBasedLandSearch(card: any): PowerBasedLandSearch | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, searchInfo] of Object.entries(KNOWN_POWER_BASED_LAND_SEARCH)) {
    if (cardName.includes(knownName)) {
      return searchInfo;
    }
  }
  
  return null;
}

/**
 * Calculate the number of lands to search for based on game state
 */
export function calculateLandSearchCount(
  effect: PowerBasedLandSearch,
  gameState: any,
  playerId: string
): number {
  const battlefield = gameState?.battlefield || [];
  
  if (effect.searchBasis === 'fixed' && effect.fixedCount) {
    return effect.fixedCount;
  }
  
  if (effect.searchBasis === 'greatest_power') {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Use the canonical power calculation function
      const { power } = getActualPowerToughness(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    return greatestPower;
  }
  
  if (effect.searchBasis === 'lands_controlled') {
    return battlefield.filter((p: any) =>
      p?.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('land')
    ).length;
  }
  
  return 0;
}

// ============================================================================
// Charge Counter Support (Everflowing Chalice, Evendo, etc.)
// ============================================================================

/**
 * Permanents that use charge counters for effects:
 * - Everflowing Chalice: Add {C} for each charge counter
 * - Astral Cornucopia: Add mana equal to charge counters
 * - Lux Cannon: Remove 3 counters to destroy permanent
 * - Titan Forge: Remove 3 counters to create 9/9 Golem
 */
export interface ChargeCounterAbility {
  permanentId: string;
  cardName: string;
  addCounterCost?: string;
  useCountersCost?: string;
  useCountersAmount?: number;
  effect: string;
  effectType: 'mana_per_counter' | 'threshold_effect' | 'per_counter_effect';
}

const KNOWN_CHARGE_COUNTER_ABILITIES: Record<string, Omit<ChargeCounterAbility, 'permanentId' | 'cardName'>> = {
  "everflowing chalice": {
    effect: "Add {C} for each charge counter",
    effectType: 'mana_per_counter',
  },
  "astral cornucopia": {
    effect: "Add X mana of any one color where X is charge counters",
    effectType: 'mana_per_counter',
  },
  "lux cannon": {
    addCounterCost: "{T}",
    useCountersCost: "{T}, Remove 3 charge counters",
    useCountersAmount: 3,
    effect: "Destroy target permanent",
    effectType: 'threshold_effect',
  },
  "titan forge": {
    addCounterCost: "{3}, {T}",
    useCountersCost: "{T}, Remove 3 charge counters",
    useCountersAmount: 3,
    effect: "Create a 9/9 colorless Golem artifact creature token",
    effectType: 'threshold_effect',
  },
  "gemstone array": {
    addCounterCost: "{2}",
    useCountersCost: "Remove a charge counter",
    useCountersAmount: 1,
    effect: "Add one mana of any color",
    effectType: 'per_counter_effect',
  },
  "surge node": {
    addCounterCost: "{1}, {T}",
    useCountersCost: "{1}, {T}, Remove a charge counter",
    useCountersAmount: 1,
    effect: "Put a charge counter on target artifact",
    effectType: 'per_counter_effect',
  },
};

export function detectChargeCounterAbility(card: any, permanent: any): ChargeCounterAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_CHARGE_COUNTER_ABILITIES)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...abilityInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Special Cards: Chameleon Colossus, March of the World Ooze, etc.
// ============================================================================

/**
 * Cards with unique activated or triggered abilities that need special handling:
 * - Chameleon Colossus: Double power/toughness activated ability
 * - March of the Ooze: Token creation based on counters
 * - Tale of Katara and Toph: Saga with unique effects
 * - The Seriema: Transform conditions
 */
export interface SpecialCardEffect {
  permanentId: string;
  cardName: string;
  effectType: 'double_pt' | 'counter_based_tokens' | 'saga' | 'transform' | 'protection_from_all' | 'changeling';
  activatedAbilityCost?: string;
  effect: string;
  additionalInfo?: Record<string, any>;
}

const KNOWN_SPECIAL_CARDS: Record<string, Omit<SpecialCardEffect, 'permanentId' | 'cardName'>> = {
  "chameleon colossus": {
    effectType: 'double_pt',
    activatedAbilityCost: "{2}{G}{G}",
    effect: "Chameleon Colossus gets +X/+X until end of turn, where X is its power",
    additionalInfo: {
      hasChangeling: true,
      hasProtectionFromBlack: true,
    },
  },
  "progenitus": {
    effectType: 'protection_from_all',
    effect: "Protection from everything",
    additionalInfo: {
      shuffleWhenToGraveyard: true,
    },
  },
  "mistform ultimus": {
    effectType: 'changeling',
    effect: "Is every creature type",
  },
  "morophon, the boundless": {
    effectType: 'changeling',
    effect: "Is every creature type, chosen type spells cost WUBRG less",
  },
};

export function detectSpecialCardEffect(card: any, permanent: any): SpecialCardEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_SPECIAL_CARDS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  // Dynamic detection for changeling
  if (oracleText.includes('changeling') || 
      (card?.keywords || []).some((k: string) => k.toLowerCase() === 'changeling')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'changeling',
      effect: "Is every creature type",
    };
  }
  
  // Dynamic detection for protection from everything
  if (oracleText.includes('protection from everything')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'protection_from_all',
      effect: "Protection from everything",
    };
  }
  
  // Dynamic detection for double power/toughness
  if (oracleText.match(/gets?\s+\+x\/\+x.*where\s+x\s+is\s+its\s+power/i)) {
    const costMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:/);
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'double_pt',
      activatedAbilityCost: costMatch ? costMatch[1] : undefined,
      effect: "Gets +X/+X where X is its power",
    };
  }
  
  return null;
}

// ============================================================================
// Planeswalker Loyalty Ability Support
// ============================================================================

/**
 * Planeswalker loyalty abilities parsed from oracle text
 * 
 * Supports all standard planeswalker ability formats:
 * - [+N]: Add N loyalty (e.g., [+2]: Exile top three cards)
 * - [-N]: Remove N loyalty (e.g., [-3]: Return target creature)
 * - [0]: No loyalty change (e.g., [0]: Draw a card)
 * - [-X]: Variable loyalty cost (e.g., [-X]: Put a creature with MV X onto battlefield)
 * 
 * Examples from actual cards:
 * - Ashiok, Nightmare Weaver: [+2], [-X], [-10]
 * - Liliana of the Veil: [+1], [-2], [-6]
 * - Jace, the Mind Sculptor: [+2], [0], [-1], [-12]
 * - Nissa, Who Shakes the World: [+1], [-8]
 */
export interface LoyaltyAbility {
  cost: number | 'X'; // Positive = add loyalty, negative = remove, 0 = static, 'X' = variable
  costDisplay: string; // Original cost string for display ("+2", "-X", "0", etc.)
  effect: string;
  requiresTarget: boolean;
  targetType?: string;
  isUltimate?: boolean;
  isVariableCost?: boolean; // True for -X abilities
  xBasedEffect?: string; // Description of what X represents (e.g., "mana value")
}

export interface PlaneswalkerAbilities {
  permanentId: string;
  cardName: string;
  startingLoyalty: number;
  abilities: LoyaltyAbility[];
  hasStaticAbility?: boolean;
  staticAbilityText?: string;
}

/**
 * Parse planeswalker abilities from oracle text
 * 
 * Handles all 168+ planeswalkers including:
 * - Standard +N/-N abilities
 * - Variable -X abilities (Ashiok, Nissa Revane, etc.)
 * - Static abilities (Narset Transcendent, The Wanderer, etc.)
 * - Zero-cost abilities (Jace TMS, Teferi Hero of Dominaria, etc.)
 */
export function parsePlaneswalkerAbilities(card: any, permanent: any): PlaneswalkerAbilities | null {
  const oracleText = card?.oracle_text || "";
  const typeLine = (card?.type_line || "").toLowerCase();
  
  if (!typeLine.includes('planeswalker')) {
    return null;
  }
  
  const startingLoyalty = card?.loyalty ? parseInt(card.loyalty, 10) : 0;
  const abilities: LoyaltyAbility[] = [];
  
  // Check for static abilities (text before first loyalty ability)
  // Examples: "Your opponents can't cast noncreature spells during combat."
  // Static abilities don't have [+/-N]: format
  let hasStaticAbility = false;
  let staticAbilityText: string | undefined;
  
  // Find first loyalty ability marker
  const firstLoyaltyMatch = oracleText.match(/\[[+-]?(?:\d+|X)\]:/i);
  if (firstLoyaltyMatch && firstLoyaltyMatch.index && firstLoyaltyMatch.index > 0) {
    const textBeforeLoyalty = oracleText.substring(0, firstLoyaltyMatch.index).trim();
    // If there's substantial text before the first loyalty ability, it's likely a static ability
    if (textBeforeLoyalty.length > 10 && !textBeforeLoyalty.startsWith('—')) {
      hasStaticAbility = true;
      staticAbilityText = textBeforeLoyalty;
    }
  }
  
  // Parse loyalty abilities: [+N], [-N], [0], [-X], [+X]
  // Pattern handles both numeric costs and X costs
  // Examples: [+2]: Effect, [-3]: Effect, [0]: Effect, [-X]: Effect
  const loyaltyPattern = /\[([+-]?(?:\d+|X))\]:\s*([^[]+?)(?=\s*\[[+-]?(?:\d+|X)\]:|$)/gi;
  let match;
  
  while ((match = loyaltyPattern.exec(oracleText)) !== null) {
    const costString = match[1];
    const effect = match[2].trim();
    const isVariableCost = costString.toUpperCase().includes('X');
    
    // Parse the cost value
    let cost: number | 'X';
    if (isVariableCost) {
      cost = 'X';
    } else {
      cost = parseInt(costString, 10);
    }
    
    // Detect if this ability requires a target
    const effectLower = effect.toLowerCase();
    const requiresTarget = 
      effectLower.includes('target') ||
      effectLower.includes('choose');
    
    // Detect target type (expanded list)
    let targetType: string | undefined;
    if (requiresTarget) {
      if (effectLower.includes('target creature')) targetType = 'creature';
      else if (effectLower.includes('target player') || effectLower.includes("target opponent")) targetType = 'player';
      else if (effectLower.includes('target permanent')) targetType = 'permanent';
      else if (effectLower.includes('target land')) targetType = 'land';
      else if (effectLower.includes('target artifact')) targetType = 'artifact';
      else if (effectLower.includes('target enchantment')) targetType = 'enchantment';
      else if (effectLower.includes('target planeswalker')) targetType = 'planeswalker';
      else if (effectLower.includes('target spell')) targetType = 'spell';
      else if (effectLower.includes('target card')) targetType = 'card';
      else if (effectLower.includes('target nonland')) targetType = 'nonland permanent';
      else if (effectLower.includes('target noncreature')) targetType = 'noncreature permanent';
    }
    
    // For X abilities, try to detect what X represents
    let xBasedEffect: string | undefined;
    if (isVariableCost) {
      if (effectLower.includes('mana value x') || effectLower.includes('mana value equal')) {
        xBasedEffect = 'mana value';
      } else if (effectLower.includes('power x') || effectLower.includes('power equal')) {
        xBasedEffect = 'power';
      } else if (effectLower.includes('x damage')) {
        xBasedEffect = 'damage';
      } else if (effectLower.includes('x cards')) {
        xBasedEffect = 'cards';
      } else if (effectLower.includes('x target') || effectLower.includes('x creatures')) {
        xBasedEffect = 'targets';
      }
    }
    
    abilities.push({
      cost,
      costDisplay: costString.startsWith('+') || costString.startsWith('-') ? costString : `+${costString}`,
      effect,
      requiresTarget,
      targetType,
      isVariableCost,
      xBasedEffect,
    });
  }
  
  // Determine ultimate ability (typically the largest negative cost, or only negative ability)
  // For variable X costs, it's usually an ultimate if there are no other large negative costs
  if (abilities.length > 0) {
    let lowestCost = 0;
    let lowestCostIndex = -1;
    
    for (let i = 0; i < abilities.length; i++) {
      const ability = abilities[i];
      if (ability.cost === 'X') {
        // -X is often an ultimate or at least a significant ability
        // If it's the only negative ability, mark it as ultimate
        const hasOtherNegative = abilities.some((a, idx) => 
          idx !== i && typeof a.cost === 'number' && a.cost < 0
        );
        if (!hasOtherNegative) {
          ability.isUltimate = true;
        }
      } else if (typeof ability.cost === 'number' && ability.cost < lowestCost) {
        lowestCost = ability.cost;
        lowestCostIndex = i;
      }
    }
    
    // Mark the ability with lowest cost as ultimate (typically -6 or lower)
    if (lowestCostIndex >= 0 && lowestCost <= -5) {
      abilities[lowestCostIndex].isUltimate = true;
    } else if (lowestCostIndex >= 0 && abilities.length >= 3) {
      // For 3+ ability planeswalkers, the last negative ability is usually the ultimate
      // even if cost is lower than -5 (e.g., Liliana of the Veil's -6)
      abilities[lowestCostIndex].isUltimate = true;
    }
  }
  
  if (abilities.length === 0 && !hasStaticAbility) {
    return null;
  }
  
  return {
    permanentId: permanent?.id || '',
    cardName: card?.name || 'Unknown Planeswalker',
    startingLoyalty,
    abilities,
    hasStaticAbility,
    staticAbilityText,
  };
}

/**
 * Get the maximum number of loyalty ability activations per planeswalker per turn
 * 
 * Default is 1, but can be increased by:
 * - The Chain Veil: "At the beginning of your end step, if you didn't activate a loyalty ability
 *   of a planeswalker this turn, you lose 2 life. You may activate loyalty abilities of 
 *   planeswalkers you control twice each turn rather than only once."
 * - Oath of Teferi: "You may activate the loyalty abilities of planeswalkers you control twice
 *   each turn rather than only once."
 * - Teferi, Temporal Pilgrim emblem
 * - Carth the Lion (from graveyard)
 * - Nicol Bolas, Dragon-God (copying abilities)
 */
export function getLoyaltyActivationLimit(gameState: any, playerId: string): number {
  let limit = 1; // Default: once per turn
  
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // The Chain Veil
    if (cardName === "the chain veil") {
      limit = Math.max(limit, 2);
    }
    
    // Oath of Teferi
    if (cardName === "oath of teferi") {
      limit = Math.max(limit, 2);
    }
    
    // Carth the Lion - "You may activate loyalty abilities of planeswalkers you control twice"
    if (cardName === "carth the lion") {
      limit = Math.max(limit, 2);
    }
    
    // Generic check for "loyalty abilities...twice each turn" or similar
    if (oracleText.includes("loyalty abilities") && 
        (oracleText.includes("twice each turn") || oracleText.includes("twice rather than only once"))) {
      limit = Math.max(limit, 2);
    }
    
    // Some effects might allow even more activations (theoretical future cards)
    const tripleMatch = oracleText.match(/loyalty abilities.*three times/i);
    if (tripleMatch) {
      limit = Math.max(limit, 3);
    }
  }
  
  // Check emblems (stored in a different location)
  const emblems = gameState?.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== playerId) continue;
    
    const oracleText = (emblem.effect || "").toLowerCase();
    
    if (oracleText.includes("loyalty abilities") && 
        (oracleText.includes("twice") || oracleText.includes("additional"))) {
      limit = Math.max(limit, 2);
    }
  }
  
  return limit;
}

/**
 * Check if The Chain Veil trigger should fire (end step: lose 2 life if no loyalty activated)
 */
export function checkChainVeilEndStepTrigger(gameState: any, playerId: string): boolean {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    if (cardName === "the chain veil") {
      // Check if any planeswalker loyalty ability was activated this turn
      const planeswalkers = battlefield.filter((p: any) => 
        p?.controller === playerId && 
        (p?.card?.type_line || "").toLowerCase().includes("planeswalker")
      );
      
      const anyActivated = planeswalkers.some((pw: any) => 
        (pw?.loyaltyActivationsThisTurn || 0) > 0
      );
      
      // If no loyalty ability was activated, trigger the 2 life loss
      return !anyActivated;
    }
  }
  
  return false;
}

/**
 * Check if a planeswalker can activate a specific ability
 * (Once per turn per planeswalker, at sorcery speed, loyalty requirement met)
 * 
 * Handles:
 * - Standard +N/-N abilities
 * - Variable -X abilities (can always activate if loyalty >= 1)
 * - Zero cost abilities
 * - The Chain Veil effect (additional loyalty activation)
 * - Oath of Teferi effect (activate loyalty twice per turn)
 * - Eidolon of Obstruction (loyalty abilities cost {1} more for opponents)
 * - Teferi's Talent emblem (instant speed loyalty activation)
 */
export function canActivateLoyaltyAbility(
  permanent: any,
  abilityIndex: number,
  gameState: any,
  playerId: string,
  xValue?: number // For -X abilities, what X value the player wants to use
): { canActivate: boolean; reason?: string; maxX?: number; additionalManaCost?: number } {
  // Check controller
  if (permanent?.controller !== playerId) {
    return { canActivate: false, reason: "Not your planeswalker" };
  }
  
  // Check if already activated this turn, considering Chain Veil and similar effects
  const activationsThisTurn = permanent?.loyaltyActivationsThisTurn || 0;
  const maxActivations = getLoyaltyActivationLimit(gameState, playerId);
  
  if (activationsThisTurn >= maxActivations) {
    return { canActivate: false, reason: "Already activated maximum loyalty abilities this turn" };
  }
  
  // Check current loyalty
  const currentLoyalty = permanent?.counters?.loyalty || permanent?.card?.loyalty || 0;
  const abilities = parsePlaneswalkerAbilities(permanent?.card, permanent);
  
  if (!abilities || abilityIndex >= abilities.abilities.length) {
    return { canActivate: false, reason: "Invalid ability" };
  }
  
  const ability = abilities.abilities[abilityIndex];
  
  // Calculate additional mana cost from effects like Eidolon of Obstruction
  const additionalManaCost = getLoyaltyAdditionalCost(gameState, playerId, permanent);
  
  // Handle variable X cost abilities
  if (ability.cost === 'X' || ability.isVariableCost) {
    // -X abilities can be activated with any X from 0 to current loyalty
    // The player chooses X when activating
    const maxX = currentLoyalty;
    
    if (xValue !== undefined) {
      // Validate the chosen X value
      if (xValue < 0) {
        return { canActivate: false, reason: "X cannot be negative", maxX, additionalManaCost };
      }
      if (xValue > currentLoyalty) {
        return { canActivate: false, reason: `X cannot exceed current loyalty (${currentLoyalty})`, maxX, additionalManaCost };
      }
    }
    
    // Can activate -X ability as long as we have any loyalty
    // (X can be 0 in some cases)
    return { canActivate: true, maxX, additionalManaCost };
  }
  
  // For minus abilities with fixed cost, check if we have enough loyalty
  if (typeof ability.cost === 'number' && ability.cost < 0 && currentLoyalty < Math.abs(ability.cost)) {
    return { canActivate: false, reason: `Not enough loyalty (have ${currentLoyalty}, need ${Math.abs(ability.cost)})`, additionalManaCost };
  }
  
  // Check timing restrictions
  const canActivateAtInstantSpeed = canActivateLoyaltyAtInstantSpeed(gameState, playerId);
  const phase = gameState?.phase || '';
  const stack = gameState?.stack || [];
  const activePlayer = gameState?.activePlayer;
  
  if (!canActivateAtInstantSpeed) {
    // Normal sorcery speed check (main phase, stack empty, have priority)
    if (!phase.includes('main') || stack.length > 0) {
      return { canActivate: false, reason: "Can only activate at sorcery speed", additionalManaCost };
    }
    
    if (activePlayer !== playerId) {
      return { canActivate: false, reason: "Not your turn", additionalManaCost };
    }
  }
  // If instant speed is allowed, skip the sorcery speed checks
  
  return { canActivate: true, additionalManaCost };
}

/**
 * Get additional mana cost for activating loyalty abilities
 * 
 * Effects that increase loyalty ability costs:
 * - Eidolon of Obstruction: "Loyalty abilities of planeswalkers your opponents control cost {1} more to activate"
 * - Suppression Field: "Activated abilities cost {2} more to activate" (includes loyalty abilities)
 */
export function getLoyaltyAdditionalCost(gameState: any, playerId: string, planeswalker: any): number {
  let additionalCost = 0;
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const controller = permanent.controller;
    
    // Eidolon of Obstruction - affects opponents' planeswalkers
    if (cardName === "eidolon of obstruction" && controller !== playerId) {
      // The planeswalker's controller is playerId, and Eidolon is controlled by opponent
      // So this makes playerId's loyalty abilities cost more
      additionalCost += 1;
    }
    
    // Also check for generic "loyalty abilities...cost...more" patterns
    // This handles similar future cards
    if (controller !== playerId && 
        oracleText.includes("loyalty abilities") && 
        oracleText.includes("opponents control") &&
        oracleText.includes("cost") && 
        oracleText.includes("more")) {
      // Try to extract the amount
      const costMatch = oracleText.match(/cost\s*\{(\d+)\}\s*more/);
      if (costMatch) {
        additionalCost += parseInt(costMatch[1], 10);
      }
    }
    
    // Suppression Field affects all activated abilities
    if (cardName === "suppression field") {
      additionalCost += 2;
    }
    
    // Aura Shards and similar - "Activated abilities...cost {N} more"
    if (oracleText.includes("activated abilities") && 
        oracleText.includes("cost") && 
        oracleText.includes("more")) {
      const costMatch = oracleText.match(/cost\s*\{(\d+)\}\s*more/);
      if (costMatch) {
        additionalCost += parseInt(costMatch[1], 10);
      }
    }
  }
  
  return additionalCost;
}

/**
 * Check if a player can activate loyalty abilities at instant speed
 * 
 * Effects that grant instant speed activation:
 * - Teferi's Talent emblem: "You may activate loyalty abilities of planeswalkers you control 
 *   on any player's turn any time you could cast an instant"
 * - Teferi, Temporal Archmage emblem (similar effect)
 * - The Peregrine Dynamo (can copy at instant speed, but not activate)
 */
export function canActivateLoyaltyAtInstantSpeed(gameState: any, playerId: string): boolean {
  // Check emblems
  const emblems = gameState?.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== playerId) continue;
    
    const effect = (emblem.effect || "").toLowerCase();
    
    // Teferi's Talent emblem
    if (effect.includes("loyalty abilities") && 
        effect.includes("any player's turn") &&
        effect.includes("instant")) {
      return true;
    }
    
    // Teferi, Temporal Archmage emblem
    if (effect.includes("loyalty abilities") && 
        effect.includes("any time you could cast an instant")) {
      return true;
    }
  }
  
  // Check battlefield for permanents that grant this ability
  const battlefield = gameState?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Generic check for instant speed loyalty activation
    if (oracleText.includes("loyalty abilities") && 
        oracleText.includes("any time") &&
        oracleText.includes("instant")) {
      return true;
    }
  }
  
  return false;
}

/**
 * Handle Teferi's Talent draw trigger - add loyalty counter to enchanted planeswalker
 * Returns the planeswalker that should receive a loyalty counter, if any
 */
export function getTeferisTalentDrawTrigger(gameState: any, playerId: string): string | null {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    if (cardName === "teferi's talent") {
      // Find the enchanted planeswalker
      const attachedTo = permanent.attachedTo;
      if (attachedTo) {
        return attachedTo;
      }
    }
  }
  
  return null;
}

/**
 * Calculate the loyalty change when activating an ability
 * Returns the amount to add (positive) or remove (negative) from loyalty
 */
export function calculateLoyaltyChange(ability: LoyaltyAbility, xValue?: number): number {
  if (ability.cost === 'X' || ability.isVariableCost) {
    // -X ability: remove X loyalty (xValue should be provided)
    return -(xValue || 0);
  }
  
  if (typeof ability.cost === 'number') {
    return ability.cost; // Already signed correctly (+N or -N)
  }
  
  return 0;
}

// NOTE: Aura Graveyard Triggers have been moved to ./triggers/aura-graveyard.ts
// Re-exports are at the top of this file

/**
 * Get all available loyalty abilities for a planeswalker with activation status
 * Useful for UI to display which abilities can be activated
 */
export function getAvailableLoyaltyAbilities(
  permanent: any,
  gameState: any,
  playerId: string
): Array<{
  index: number;
  ability: LoyaltyAbility;
  canActivate: boolean;
  reason?: string;
  maxX?: number;
}> {
  const abilities = parsePlaneswalkerAbilities(permanent?.card, permanent);
  if (!abilities) {
    return [];
  }
  
  return abilities.abilities.map((ability, index) => {
    const result = canActivateLoyaltyAbility(permanent, index, gameState, playerId);
    return {
      index,
      ability,
      canActivate: result.canActivate,
      reason: result.reason,
      maxX: result.maxX,
    };
  });
}

// NOTE: Linked Exile System has been moved to ./triggers/linked-exile.ts
// Re-exports are at the top of this file


