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
 */

import type { GameContext } from "../context.js";

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
  const etbSelfMatch = oracleText.match(/when (?:~|this creature|this permanent|this enchantment) enters the battlefield,?\s*([^.]+)/);
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
  const etbCreatureMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature enters the battlefield(?: under your control)?,?\s*([^.]+)/);
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
    | 'equipment_etb'     // Whenever an Equipment enters under your control (Puresteel Paladin)
    | 'equipment_cast'    // Whenever you cast an Equipment spell (Barret)
    | 'permanent_etb'     // Altar of the Brood style - whenever ANY permanent enters
    | 'another_permanent_etb' // Whenever ANOTHER permanent enters under your control
    | 'deals_damage'
    | 'deals_combat_damage'
    | 'annihilator'
    | 'melee'
    | 'myriad'
    | 'exalted'
    | 'upkeep_create_copy'  // Progenitor Mimic style - create token copy at upkeep
    | 'end_step_resource'   // Kynaios & Tiro style - draw/land resource at end step
    | 'end_step_effect'     // Generic end step trigger
    | 'cast_creature_type'  // Merrow Reejerey style - trigger when casting a spell of a type
    | 'tap_untap_target';   // Tap or untap target permanent
  description: string;
  effect?: string;
  value?: number; // For Annihilator N, etc.
  millAmount?: number; // For mill triggers like Altar of the Brood
  manaCost?: string; // For "sacrifice unless you pay" triggers
  mandatory: boolean;
  requiresTarget?: boolean;
  targetType?: string;
  requiresChoice?: boolean; // For triggers where player must choose
  creatureType?: string; // For "whenever you cast a [type] spell" triggers
  nontokenOnly?: boolean; // For triggers that only fire for nontoken creatures (Guardian Project)
}

/**
 * Known cards with important triggered abilities
 */
const KNOWN_DEATH_TRIGGERS: Record<string, { effect: string; triggerOn: 'own' | 'controlled' | 'any' }> = {
  "grave pact": { effect: "Each other player sacrifices a creature", triggerOn: 'controlled' },
  "dictate of erebos": { effect: "Each other player sacrifices a creature", triggerOn: 'controlled' },
  "butcher of malakir": { effect: "Each other player sacrifices a creature", triggerOn: 'controlled' },
  "blood artist": { effect: "Target player loses 1 life, you gain 1 life", triggerOn: 'any' },
  "zulaport cutthroat": { effect: "Each opponent loses 1 life, you gain 1 life", triggerOn: 'controlled' },
  "cruel celebrant": { effect: "Each opponent loses 1 life, you gain 1 life", triggerOn: 'controlled' },
  "bastion of remembrance": { effect: "Each opponent loses 1 life, you gain 1 life", triggerOn: 'controlled' },
  "syr konrad, the grim": { effect: "Each opponent loses 1 life", triggerOn: 'any' },
  "massacre wurm": { effect: "Opponent loses 2 life (when their creatures die)", triggerOn: 'any' },
  "skullclamp": { effect: "Draw 2 cards when equipped creature dies", triggerOn: 'own' },
  "grim haruspex": { effect: "Draw a card when nontoken creature dies", triggerOn: 'controlled' },
  "midnight reaper": { effect: "Draw a card, lose 1 life when nontoken creature dies", triggerOn: 'controlled' },
  "species specialist": { effect: "Draw a card when chosen creature type dies", triggerOn: 'any' },
  "harvester of souls": { effect: "Draw a card when nontoken creature dies", triggerOn: 'any' },
  "dark prophecy": { effect: "Draw a card, lose 1 life when creature dies", triggerOn: 'controlled' },
};

/**
 * OPTIMIZATION CACHE: Known cards with attack triggers
 * 
 * NOTE: This is an OPTIMIZATION cache for frequently-used cards, NOT the primary
 * trigger detection mechanism. The actual trigger detection uses DYNAMIC PATTERN
 * RECOGNITION via regex patterns in detectAttackTriggers() which can handle ANY
 * card by parsing its oracle text with patterns like:
 * - "Whenever ~ attacks, [effect]"
 * - "Whenever a creature you control attacks, [effect]"
 * - Token creation patterns like "create a X/Y [type] creature token"
 * 
 * This cache provides faster lookups for common tournament-level cards.
 */
const KNOWN_ATTACK_TRIGGERS: Record<string, { effect: string; value?: number; putFromHand?: boolean; tappedAndAttacking?: boolean; createTokens?: { count: number; power: number; toughness: number; type: string; color: string; abilities?: string[] } }> = {
  "hellkite charger": { effect: "Pay {5}{R}{R} for additional combat phase" },
  "combat celebrant": { effect: "Exert for additional combat phase" },
  "aurelia, the warleader": { effect: "Additional combat phase (first attack each turn)" },
  "moraug, fury of akoum": { effect: "Additional combat phase when landfall" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token" },
  "marisi, breaker of the coil": { effect: "Goad all creatures that player controls" },
  "grand warlord radha": { effect: "Add mana for each attacking creature" },
  "neheb, the eternal": { effect: "Add {R} for each life opponent lost (postcombat)" },
  // Token creation on attack
  "hero of bladehold": { 
    effect: "Create two 1/1 white Soldier creature tokens tapped and attacking", 
    createTokens: { count: 2, power: 1, toughness: 1, type: "Soldier", color: "white" }
  },
  "brimaz, king of oreskos": { 
    effect: "Create a 1/1 white Cat Soldier creature token with vigilance tapped and attacking", 
    createTokens: { count: 1, power: 1, toughness: 1, type: "Cat Soldier", color: "white", abilities: ["vigilance"] }
  },
  "hanweir garrison": {
    effect: "Create two 1/1 red Human creature tokens tapped and attacking",
    createTokens: { count: 2, power: 1, toughness: 1, type: "Human", color: "red" }
  },
  "Captain of the Watch": {
    effect: "Create 1/1 white Soldier creature tokens",
    createTokens: { count: 3, power: 1, toughness: 1, type: "Soldier", color: "white" }
  },
  // Creatures that put cards from hand onto battlefield tapped and attacking
  "kaalia of the vast": { effect: "Put an Angel, Demon, or Dragon from hand onto battlefield tapped and attacking", putFromHand: true, tappedAndAttacking: true },
  "kaalia, zenith seeker": { effect: "Look at top 6 cards, reveal Angel/Demon/Dragon to hand" },
  "isshin, two heavens as one": { effect: "Attack triggers happen twice" },
  "winota, joiner of forces": { effect: "Look for a Human, put onto battlefield tapped and attacking", putFromHand: false, tappedAndAttacking: true },
  "ilharg, the raze-boar": { effect: "Put a creature from hand onto battlefield tapped and attacking", putFromHand: true, tappedAndAttacking: true },
  "sneak attack": { effect: "Put creature from hand, sacrifice at end step", putFromHand: true },
  "champion of rhonas": { effect: "Exert to put creature from hand", putFromHand: true },
  "elvish piper": { effect: "Put creature from hand onto battlefield" }, // Not attack trigger but related
  "quicksilver amulet": { effect: "Put creature from hand onto battlefield" },
  "descendants' path": { effect: "Reveal top card, put creature onto battlefield if shares type" },
  "belbe's portal": { effect: "Put creature of chosen type from hand" },
};

/**
 * Known cards with "untap lands" or "untap permanents" triggers
 * These trigger on attack or combat damage
 */
const KNOWN_UNTAP_TRIGGERS: Record<string, { 
  effect: string; 
  triggerOn: 'attack' | 'combat_damage' | 'damage_to_player';
  untapType: 'lands' | 'all' | 'creatures';
  controller: 'you' | 'opponent';
}> = {
  // Attack triggers - untap when creature attacks
  "bear umbra": { 
    effect: "Untap all lands you control", 
    triggerOn: 'attack',
    untapType: 'lands',
    controller: 'you',
  },
  "nature's will": { 
    effect: "Untap all lands you control, tap all lands defending player controls", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
  "sword of feast and famine": { 
    effect: "Untap all lands you control, target player discards a card", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
  "aggravated assault": { 
    effect: "Pay {3}{R}{R} for additional combat phase, untap all creatures", 
    triggerOn: 'attack', // Actually an activated ability, but included for reference
    untapType: 'creatures',
    controller: 'you',
  },
  "savage ventmaw": { 
    effect: "Add {R}{R}{R}{G}{G}{G} when attacking", 
    triggerOn: 'attack',
    untapType: 'lands', // Not exactly untap, but mana production
    controller: 'you',
  },
  "druids' repository": { 
    effect: "Put a charge counter when a creature attacks, remove to add mana", 
    triggerOn: 'attack',
    untapType: 'lands',
    controller: 'you',
  },
  "sword of hearth and home": { 
    effect: "Search for a basic land, put onto battlefield", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
  "neheb, dreadhorde champion": { 
    effect: "Discard and draw, add {R} for each discarded", 
    triggerOn: 'combat_damage',
    untapType: 'lands',
    controller: 'you',
  },
};

/**
 * Known cards with "whenever you cast a [type] spell" triggers
 * Merrow Reejerey, Goblin Warchief, etc.
 */
const KNOWN_CAST_TYPE_TRIGGERS: Record<string, {
  effect: string;
  creatureType: string;
  tapOrUntap: 'tap' | 'untap' | 'choice';
  targetType: 'permanent' | 'creature' | 'land' | 'artifact' | 'spell';
}> = {
  "merrow reejerey": {
    effect: "Tap or untap target permanent",
    creatureType: "Merfolk",
    tapOrUntap: 'choice',
    targetType: 'permanent',
  },
  "lullmage mentor": {
    effect: "Tap 7 untapped Merfolk, counter target spell",
    creatureType: "Merfolk",
    tapOrUntap: 'tap',
    targetType: 'spell',
  },
  "goblin warchief": {
    effect: "Goblin spells cost {1} less, Goblins have haste",
    creatureType: "Goblin",
    tapOrUntap: 'untap',
    targetType: 'creature',
  },
  "elvish archdruid": {
    effect: "Add {G} for each Elf you control",
    creatureType: "Elf",
    tapOrUntap: 'untap',
    targetType: 'creature',
  },
  "bloodline pretender": {
    effect: "Put a +1/+1 counter when you cast a creature of chosen type",
    creatureType: "chosen",
    tapOrUntap: 'untap',
    targetType: 'creature',
  },
};

/**
 * Known cards with activated tap/untap abilities
 * Dawnglare Invoker, Opposition, etc.
 */
const KNOWN_TAP_UNTAP_ABILITIES: Record<string, {
  effect: string;
  cost: string;
  targetType: 'permanent' | 'creature' | 'land' | 'all_creatures';
  targetController?: 'any' | 'opponent' | 'you';
  tapOrUntap: 'tap' | 'untap';
}> = {
  "dawnglare invoker": {
    effect: "Tap all creatures target player controls",
    cost: "{8}",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "opposition": {
    effect: "Tap target artifact, creature, or land",
    cost: "Tap an untapped creature you control",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "citanul hierophants": {
    effect: "Creatures you control have 'T: Add {G}'",
    cost: "{T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'tap',
  },
  "cryptic command": {
    effect: "Tap all creatures your opponents control",
    cost: "{1}{U}{U}{U}",
    targetType: 'all_creatures',
    targetController: 'opponent',
    tapOrUntap: 'tap',
  },
  "sleep": {
    effect: "Tap all creatures target player controls, they don't untap",
    cost: "{2}{U}{U}",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "icy manipulator": {
    effect: "Tap target artifact, creature, or land",
    cost: "{1}, {T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap',
  },
  "puppet strings": {
    effect: "Tap or untap target creature",
    cost: "{2}, {T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'tap', // Can be either
  },
  "aphetto alchemist": {
    effect: "Untap target artifact or creature",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "kiora's follower": {
    effect: "Untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "vizier of tumbling sands": {
    effect: "Untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "seeker of skybreak": {
    effect: "Untap target creature",
    cost: "{T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "fatestitcher": {
    effect: "Tap or untap target permanent",
    cost: "{T}",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'tap', // Can be either
  },
  "myr galvanizer": {
    effect: "Untap each other Myr you control",
    cost: "{1}, {T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "intruder alarm": {
    effect: "Untap all creatures when a creature enters",
    cost: "Trigger",
    targetType: 'all_creatures',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "awakening": {
    effect: "Untap all creatures and lands during each player's upkeep",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "seedborn muse": {
    effect: "Untap all permanents you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "prophet of kruphix": {
    effect: "Untap all creatures and lands you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'permanent',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "murkfiend liege": {
    effect: "Untap all green and/or blue creatures you control during each other player's untap step",
    cost: "Trigger",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "quest for renewal": {
    effect: "Untap all creatures you control during each other player's untap step",
    cost: "Trigger (4+ counters)",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "pemmin's aura": {
    effect: "Untap enchanted creature",
    cost: "{U}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "freed from the real": {
    effect: "Untap enchanted creature",
    cost: "{U}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "umbral mantle": {
    effect: "Untap equipped creature, +2/+2",
    cost: "{3}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "sword of the paruns": {
    effect: "Untap equipped creature",
    cost: "{3}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
  "staff of domination": {
    effect: "Untap target creature",
    cost: "{3}, {T}",
    targetType: 'creature',
    targetController: 'any',
    tapOrUntap: 'untap',
  },
  "thousand-year elixir": {
    effect: "Untap target creature",
    cost: "{1}, {T}",
    targetType: 'creature',
    targetController: 'you',
    tapOrUntap: 'untap',
  },
};

/**
 * OPTIMIZATION CACHE: Known cards with ETB triggers (enters the battlefield)
 * 
 * NOTE: This is an OPTIMIZATION cache for frequently-used cards, NOT the primary
 * trigger detection mechanism. The actual trigger detection uses DYNAMIC PATTERN
 * RECOGNITION via regex patterns in detectETBTriggers() which can handle ANY
 * of the 27,000+ MTG cards by parsing their oracle text.
 * 
 * The pattern detection handles:
 * - "When ~ enters the battlefield, [effect]"
 * - "Whenever a creature enters the battlefield under your control, [effect]"
 * - "Whenever another permanent enters the battlefield, [effect]"
 * - "Search your library for a [type] card" with power/toughness/CMC restrictions
 * - Token creation patterns
 * - And more...
 * 
 * This cache provides faster lookups for common tournament-level cards.
 */
const KNOWN_ETB_TRIGGERS: Record<string, { 
  effect: string; 
  triggerOn: 'self' | 'creature' | 'another_permanent' | 'any_permanent';
  millAmount?: number;
  searchFilter?: { types?: string[]; subtypes?: string[]; maxPower?: number; maxToughness?: number };
  searchDestination?: 'hand' | 'battlefield' | 'top';
  searchEntersTapped?: boolean;
}> = {
  "altar of the brood": { 
    effect: "Each opponent mills 1 card", 
    triggerOn: 'another_permanent',
    millAmount: 1,
  },
  "impact tremors": { 
    effect: "Each opponent loses 1 life", 
    triggerOn: 'creature',
  },
  "purphoros, god of the forge": { 
    effect: "Each opponent loses 2 life", 
    triggerOn: 'creature',
  },
  "soul warden": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "soul's attendant": { 
    effect: "You may gain 1 life", 
    triggerOn: 'creature',
  },
  "essence warden": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "ajani's welcome": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "corpse knight": { 
    effect: "Each opponent loses 1 life", 
    triggerOn: 'creature',
  },
  "blood seeker": { 
    effect: "Creature's controller loses 1 life", 
    triggerOn: 'creature',
  },
  "suture priest": { 
    effect: "You gain 1 life; if opponent's creature, they lose 1 life", 
    triggerOn: 'creature',
  },
  "impassioned orator": { 
    effect: "You gain 1 life", 
    triggerOn: 'creature',
  },
  "dina, soul steeper": { 
    effect: "Each opponent loses 1 life when you gain life", 
    triggerOn: 'self', // Actually triggers on life gain, but she's an ETB-related card
  },
  "cathar's crusade": { 
    effect: "+1/+1 counter on each creature you control", 
    triggerOn: 'creature',
  },
  // Tutor creatures
  "imperial recruiter": {
    effect: "Search your library for a creature with power 2 or less, reveal it, and put it into your hand",
    triggerOn: 'self',
    searchFilter: { types: ['creature'], maxPower: 2 },
    searchDestination: 'hand',
  },
  "recruiter of the guard": {
    effect: "Search your library for a creature with toughness 2 or less, reveal it, and put it into your hand",
    triggerOn: 'self',
    searchFilter: { types: ['creature'], maxToughness: 2 },
    searchDestination: 'hand',
  },
  "wood elves": {
    effect: "Search your library for a Forest card and put it onto the battlefield",
    triggerOn: 'self',
    searchFilter: { subtypes: ['Forest'] },
    searchDestination: 'battlefield',
  },
  "farhaven elf": {
    effect: "Search your library for a basic land card and put it onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'], subtypes: ['Basic'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "sakura-tribe elder": {
    effect: "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card and put it onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'], subtypes: ['Basic'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "solemn simulacrum": {
    effect: "Search your library for a basic land card and put it onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'], subtypes: ['Basic'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "elvish rejuvenator": {
    effect: "Look at the top five cards of your library and put a land card onto the battlefield tapped",
    triggerOn: 'self',
    searchFilter: { types: ['land'] },
    searchDestination: 'battlefield',
    searchEntersTapped: true,
  },
  "silvergill adept": {
    effect: "As an additional cost, reveal a Merfolk card from your hand or pay {3}",
    triggerOn: 'self',
  },
  // Equipment with legendary creature triggers
  "hero's blade": {
    effect: "Whenever a legendary creature enters the battlefield under your control, you may attach Hero's Blade to it",
    triggerOn: 'creature',
  },
};

/**
 * Known cards with combat damage triggers (deals combat damage to a player)
 */
const KNOWN_COMBAT_DAMAGE_TRIGGERS: Record<string, { 
  effect: string;
  tokenType?: string;
  tokenCount?: number;
  toOpponent?: boolean; // Only triggers on damage to opponents
}> = {
  "precinct captain": { 
    effect: "Create a 1/1 white Soldier creature token",
    tokenType: "Soldier",
    tokenCount: 1,
  },
  "brimaz, king of oreskos": { 
    effect: "Create a 1/1 white Cat Soldier creature token with vigilance",
    tokenType: "Cat Soldier",
    tokenCount: 1,
  },
  "ophiomancer": { 
    effect: "Create a 1/1 black Snake creature token with deathtouch",
    tokenType: "Snake",
    tokenCount: 1,
  },
  "edric, spymaster of trest": { 
    effect: "That creature's controller draws a card",
    toOpponent: true,
  },
  "toski, bearer of secrets": { 
    effect: "Draw a card",
  },
  "ohran frostfang": { 
    effect: "Draw a card",
  },
  "coastal piracy": { 
    effect: "Draw a card",
  },
  "bident of thassa": { 
    effect: "Draw a card",
  },
  "reconnaissance mission": { 
    effect: "Draw a card",
  },
  "curiosity": { 
    effect: "Draw a card (enchanted creature)",
  },
  "sword of fire and ice": { 
    effect: "Draw a card and deal 2 damage to any target",
  },
  "sword of feast and famine": { 
    effect: "Target player discards a card, untap all lands you control",
  },
  "sword of light and shadow": { 
    effect: "Gain 3 life, return creature card from graveyard to hand",
  },
  "sword of war and peace": { 
    effect: "Deal damage equal to cards in opponent's hand, gain life equal to cards in your hand",
  },
  "sword of body and mind": { 
    effect: "Create a 2/2 Wolf token, target player mills 10",
  },
  "sword of truth and justice": { 
    effect: "Put a +1/+1 counter on a creature, proliferate",
  },
  "sword of sinew and steel": { 
    effect: "Destroy target planeswalker and artifact",
  },
  "sword of hearth and home": { 
    effect: "Exile then return target creature, search for a basic land",
  },
  "infiltration lens": { 
    effect: "Draw two cards (when blocked)",
  },
};

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
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacks',
      description: attacksMatch[1].trim(),
      effect: attacksMatch[1].trim(),
      mandatory: true,
    });
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
  const cardNameEscaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const etbPattern = new RegExp(`when\\s+(?:~|this creature|this permanent|${cardNameEscaped})\\s+enters the battlefield,?\\s*([^.]+)`, 'i');
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
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }
  
  // "Whenever a creature enters the battlefield under your control" or "Whenever a nontoken creature enters..."
  const creatureETBMatch = oracleText.match(/whenever a (?:nontoken )?creature enters the battlefield under your control,?\s*([^.]+)/i);
  if (creatureETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    const isNontokenOnly = oracleText.toLowerCase().includes('nontoken creature enters');
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
  const equipmentETBMatch = oracleText.match(/whenever (?:a|an) equipment enters the battlefield under your control,?\s*([^.]+)/i);
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
  
  // "Whenever another permanent enters the battlefield" - ANY permanent, not just yours
  // This is the Altar of the Brood pattern: "Whenever another permanent enters the battlefield, each opponent mills a card."
  // Also catches variations like "whenever another creature enters the battlefield"
  const anotherPermanentAnyETBMatch = oracleText.match(/whenever another (?:creature|permanent) enters the battlefield(?!.*under your control),?\s*([^.]+)/i);
  if (anotherPermanentAnyETBMatch && !triggers.some(t => t.triggerType === 'permanent_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_etb',
      description: anotherPermanentAnyETBMatch[1].trim(),
      effect: anotherPermanentAnyETBMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever another permanent enters the battlefield under your control"
  const anotherPermanentETBMatch = oracleText.match(/whenever another (?:creature|permanent) enters the battlefield under your control,?\s*([^.]+)/i);
  if (anotherPermanentETBMatch && !triggers.some(t => t.triggerType === 'another_permanent_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_etb',
      description: anotherPermanentETBMatch[1].trim(),
      effect: anotherPermanentETBMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "As [this] enters the battlefield, choose" - Modal permanents like Outpost Siege
  // Pattern: "As ~ enters the battlefield, choose Khans or Dragons."
  const modalETBMatch = oracleText.match(/as (?:~|this (?:creature|permanent|enchantment)) enters the battlefield,?\s*choose\s+([^.]+)/i);
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
 * Known cards with beginning of combat triggers
 */
const KNOWN_BEGINNING_COMBAT_TRIGGERS: Record<string, { effect: string; requiresChoice?: boolean; createsToken?: boolean; tokenCopy?: boolean }> = {
  "hakbal of the surging soul": { effect: "Reveal the top card of your library. If it's a land, put it onto the battlefield tapped. Otherwise, put a +1/+1 counter on Hakbal." },
  "etali, primal storm": { effect: "Exile cards from each opponent's library and cast them without paying mana costs" },
  "marisi, breaker of the coil": { effect: "Goaded creatures can't block" },
  "aurelia, the warleader": { effect: "Untap all creatures, additional combat phase (first combat each turn)" },
  "gisela, blade of goldnight": { effect: "Damage dealt to opponents is doubled; damage dealt to you is halved" },
  "iroas, god of victory": { effect: "Creatures you control have menace and prevent damage that would be dealt to them" },
  "xenagos, god of revels": { effect: "Choose target creature you control. It gains haste and gets +X/+X", requiresChoice: true },
  "combat celebrant": { effect: "You may exert for additional combat phase" },
  "grand warlord radha": { effect: "Add mana equal to attacking creatures at beginning of combat" },
  "saskia the unyielding": { effect: "Damage to chosen player is dealt to them again" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token when attacking", createsToken: true },
  "grand arbiter augustin iv": { effect: "Your spells cost less; opponent spells cost more" },
  // Token creation triggers
  "legion warboss": { effect: "Create a 1/1 red Goblin creature token with haste. That token attacks this combat if able.", createsToken: true },
  "hanweir garrison": { effect: "Create two 1/1 red Human creature tokens tapped and attacking", createsToken: true },
  "hero of bladehold": { effect: "Create two 1/1 white Soldier creature tokens tapped and attacking", createsToken: true },
  "brimaz, king of oreskos": { effect: "Create a 1/1 white Cat Soldier creature token with vigilance", createsToken: true },
  "rabble rousing": { effect: "Create X 1/1 green and white Citizen creature tokens, where X is the number of creatures attacking", createsToken: true },
  "adeline, resplendent cathar": { effect: "Create a 1/1 white Human creature token tapped and attacking", createsToken: true },
  "goblin rabblemaster": { effect: "Create a 1/1 red Goblin creature token with haste", createsToken: true },
  "krenko, tin street kingpin": { effect: "Put a +1/+1 counter on Krenko. Create X 1/1 red Goblin tokens where X is Krenko's power", createsToken: true },
  "tilonalli's summoner": { effect: "Create X 1/1 red Elemental tokens tapped and attacking, exile at end of combat", createsToken: true },
  "tendershoot dryad": { effect: "Create a 1/1 green Saproling creature token" },
  "captain of the watch": { effect: "Soldier creatures you control get +1/+1 and have vigilance" },
  // Equipment triggers
  "helm of the host": { effect: "Create a token that's a copy of equipped creature, except it's not legendary and has haste", tokenCopy: true, createsToken: true },
  "blade of selves": { effect: "Myriad - create token copies attacking each opponent", tokenCopy: true, createsToken: true },
  // Combat phase triggers
  "reconnaissance": { effect: "Remove attacking creature from combat and untap it" },
  "aggravated assault": { effect: "Pay to untap creatures and get additional combat phase" },
  "hellkite charger": { effect: "Pay to get additional combat phase" },
  "moraug, fury of akoum": { effect: "Landfall - additional combat phase, untap creatures" },
  "breath of fury": { effect: "Sacrifice creature for additional combat phase" },
  "world at war": { effect: "Additional combat phase this turn, rebound" },
  "savage beating": { effect: "Double strike or additional combat phase" },
  // FF7 cards
  "heidegger, shinra executive": { effect: "Create 1/1 white Soldier creature token for each Soldier you control", createsToken: true },
  "cait sith, fortune teller": { effect: "Roll a die and trigger based on result", requiresChoice: false },
};

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
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectBeginningOfCombatTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      // "At the beginning of combat on your turn" - only for controller
      if (lowerOracle.includes('on your turn')) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
        }
      }
      // "At the beginning of each combat" - triggers regardless of whose combat
      else if (lowerOracle.includes('each combat')) {
        triggers.push(trigger);
      }
      // Default: assume "on your turn" if not specified
      else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
      }
    }
  }
  
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
        }
        
        if (shouldTrigger) {
          // Determine if this requires sacrifice selection
          const requiresSacrifice = info.effect.toLowerCase().includes('sacrifice');
          
          results.push({
            source: {
              permanentId: permanent.id,
              cardName: card.name,
              controllerId: permanentController,
            },
            effect: info.effect,
            requiresSacrificeSelection: requiresSacrifice,
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

// ============================================================================
// End Step Trigger System
// ============================================================================

export interface EndStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'end_step_resource' | 'end_step_effect';
  description: string;
  effect?: string;
  mandatory: boolean;
  requiresChoice?: boolean;
  affectsAllPlayers?: boolean;
}

/**
 * Known cards with end step triggered abilities
 */
const KNOWN_END_STEP_TRIGGERS: Record<string, { 
  effect: string; 
  mandatory: boolean; 
  requiresChoice?: boolean;
  affectsAllPlayers?: boolean;
}> = {
  "kynaios and tiro of meletis": { 
    effect: "Each player may draw a card or play a land (you draw a card)", 
    mandatory: true,
    requiresChoice: true,
    affectsAllPlayers: true,
  },
  "edric, spymaster of trest": { 
    effect: "Opponents who dealt combat damage to your opponents draw a card", 
    mandatory: true,
  },
  "nekusar, the mindrazer": { 
    effect: "Each player draws a card at end step (draw step)", 
    mandatory: true,
  },
  "meren of clan nel toth": { 
    effect: "Return a creature card from graveyard based on experience counters", 
    mandatory: true,
    requiresChoice: true,
  },
  "atraxa, praetors' voice": { 
    effect: "Proliferate", 
    mandatory: true,
  },
  "wound reflection": { 
    effect: "Each opponent loses life equal to life they lost this turn", 
    mandatory: true,
  },
  "hope estheim": {
    effect: "Each opponent mills X cards, where X is the amount of life you gained this turn",
    mandatory: true,
  },
  "twilight prophet": {
    effect: "If you have the city's blessing, reveal top card, opponent loses life equal to its mana value, you gain that life",
    mandatory: true,
  },
  "blightsteel colossus": {
    effect: "Shuffle into library if put into graveyard (replacement)",
    mandatory: true,
  },
  // Prosper, Tome-Bound - exile top card at end step, can play until end of next turn
  "prosper, tome-bound": {
    effect: "Exile the top card of your library. Until the end of your next turn, you may play that card.",
    mandatory: true,
  },
  // Outpost Siege (Dragons mode)
  "outpost siege": {
    effect: "At the beginning of your end step, Outpost Siege deals 1 damage to any target (Dragons mode)",
    mandatory: true,
    requiresChoice: true,
  },
  // Theater of Horrors
  "theater of horrors": {
    effect: "Exile the top card of your library. You may play that card this turn.",
    mandatory: true,
  },
  // Laelia, the Blade Reforged
  "laelia, the blade reforged": {
    effect: "Exile the top card of your library. You may play that card this turn.",
    mandatory: true,
  },
  // Furious Rise - At the beginning of your end step, if you control a creature with power 4 or greater,
  // exile the top card of your library. You may play that card until you exile another card with Furious Rise.
  "furious rise": {
    effect: "Exile the top card of your library if you control a creature with power 4+. You may play that card.",
    mandatory: true,
    requiresChoice: false,
  },
  // Outpost Siege (Khans mode) - At the beginning of your upkeep, exile the top card of your library.
  // You may play that card this turn.
  // Note: Dragons mode is already listed above
};

/**
 * Detect end step triggers from a card's oracle text
 */
export function detectEndStepTriggers(card: any, permanent: any): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known cards first
  for (const [knownName, info] of Object.entries(KNOWN_END_STEP_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'end_step_resource',
        description: info.effect,
        effect: info.effect,
        mandatory: info.mandatory,
        requiresChoice: info.requiresChoice,
        affectsAllPlayers: info.affectsAllPlayers,
      });
    }
  }
  
  // Generic detection: "At the beginning of each end step" or "At the beginning of your end step"
  const endStepMatch = oracleText.match(/at the beginning of (?:each|your) end step,?\s*([^.]+)/i);
  if (endStepMatch && !triggers.some(t => t.description === endStepMatch[1].trim())) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'end_step_effect',
      description: endStepMatch[1].trim(),
      effect: endStepMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all end step triggers for the active player's end step
 */
export function getEndStepTriggers(
  ctx: GameContext,
  activePlayerId: string
): EndStepTrigger[] {
  const triggers: EndStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectEndStepTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      // "At the beginning of your end step" - only for controller
      if (lowerOracle.includes('your end step')) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
        }
      }
      // "At the beginning of each end step" - triggers regardless of whose turn
      else if (lowerOracle.includes('each end step')) {
        triggers.push(trigger);
      }
      // Default: assume "your end step" if not specified
      else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Draw Step Trigger System
// ============================================================================

export interface DrawStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
}

/**
 * Detect draw step triggers from a card's oracle text
 * Pattern: "At the beginning of your draw step" or "At the beginning of each player's draw step"
 */
export function detectDrawStepTriggers(card: any, permanent: any): DrawStepTrigger[] {
  const triggers: DrawStepTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "At the beginning of your draw step"
  const yourDrawMatch = oracleText.match(/at the beginning of your draw step,?\s*([^.]+)/i);
  if (yourDrawMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: yourDrawMatch[1].trim(),
      effect: yourDrawMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "At the beginning of each player's draw step"
  const eachDrawMatch = oracleText.match(/at the beginning of each player's draw step,?\s*([^.]+)/i);
  if (eachDrawMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: eachDrawMatch[1].trim(),
      effect: eachDrawMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all draw step triggers for the active player's draw step
 */
export function getDrawStepTriggers(
  ctx: GameContext,
  activePlayerId: string
): DrawStepTrigger[] {
  const triggers: DrawStepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectDrawStepTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      if (lowerOracle.includes('your draw step')) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
        }
      } else if (lowerOracle.includes('each player')) {
        triggers.push(trigger);
      } else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

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

// ============================================================================
// Untap Step Effects System
// ============================================================================

export interface UntapStepEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  untapType: 'artifacts' | 'creatures' | 'all' | 'lands' | 'specific';
  onOtherPlayersTurn: boolean; // True for Unwinding Clock, Seedborn Muse
  onYourTurn: boolean;
}

/**
 * Detect untap step effects from a card's oracle text
 * Handles cards like:
 * - Unwinding Clock: "Untap all artifacts you control during each other player's untap step"
 * - Seedborn Muse: "Untap all permanents you control during each other player's untap step"
 * - Prophet of Kruphix (banned): Similar to Seedborn Muse
 * - Wilderness Reclamation: "At the beginning of your end step, untap all lands you control"
 */
export function detectUntapStepEffects(card: any, permanent: any): UntapStepEffect[] {
  const effects: UntapStepEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Untap all artifacts you control during each other player's untap step" (Unwinding Clock)
  if (oracleText.includes('untap all artifacts') && oracleText.includes('other player')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Untap all artifacts you control during each other player's untap step",
      untapType: 'artifacts',
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  // "Untap all permanents you control during each other player's untap step" (Seedborn Muse)
  if (oracleText.includes('untap all permanents') && oracleText.includes('other player')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Untap all permanents you control during each other player's untap step",
      untapType: 'all',
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  // "Untap all creatures you control during each other player's untap step"
  if (oracleText.includes('untap all creatures') && oracleText.includes('other player')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Untap all creatures you control during each other player's untap step",
      untapType: 'creatures',
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  // Generic pattern: "untap all X you control during each other player's untap step"
  const untapOtherMatch = oracleText.match(/untap all (\w+)(?: you control)? during each other player's untap step/i);
  if (untapOtherMatch && !effects.length) {
    const type = untapOtherMatch[1].toLowerCase();
    let untapType: UntapStepEffect['untapType'] = 'specific';
    if (type === 'artifacts') untapType = 'artifacts';
    else if (type === 'creatures') untapType = 'creatures';
    else if (type === 'permanents') untapType = 'all';
    else if (type === 'lands') untapType = 'lands';
    
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Untap all ${type} you control during each other player's untap step`,
      untapType,
      onOtherPlayersTurn: true,
      onYourTurn: false,
    });
  }
  
  return effects;
}

/**
 * Get all untap step effects that apply during a specific player's untap step
 * @param ctx Game context
 * @param untapPlayerId The player whose untap step it is
 * @returns Effects that should trigger
 */
export function getUntapStepEffects(
  ctx: GameContext,
  untapPlayerId: string
): UntapStepEffect[] {
  const effects: UntapStepEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permEffects = detectUntapStepEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      // Check if this effect applies
      const isControllersTurn = permanent.controller === untapPlayerId;
      
      if (effect.onOtherPlayersTurn && !isControllersTurn) {
        // Effects like Unwinding Clock trigger on OTHER players' untap steps
        effects.push(effect);
      } else if (effect.onYourTurn && isControllersTurn) {
        // Effects that trigger on your own untap step
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply untap step effects (actually untap the permanents)
 * @param ctx Game context
 * @param effect The untap effect to apply
 */
export function applyUntapStepEffect(ctx: GameContext, effect: UntapStepEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== effect.controllerId) continue;
    if (!permanent.tapped) continue; // Already untapped
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'all':
        shouldUntap = true;
        break;
      case 'artifacts':
        shouldUntap = typeLine.includes('artifact');
        break;
      case 'creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'lands':
        shouldUntap = typeLine.includes('land');
        break;
      case 'specific':
        // Would need more specific matching based on the effect
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
// "Doesn't Untap" Static Effects (Intruder Alarm, Frozen, Exhaustion, etc.)
// ============================================================================

export interface DoesntUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  affectedType: 'all_creatures' | 'all_lands' | 'all_permanents' | 'specific_permanent' | 'controller_creatures' | 'controller_lands';
  affectedController?: 'all' | 'controller' | 'opponents';
  targetPermanentId?: string; // For effects that target a specific permanent (like Claustrophobia)
}

/**
 * Detect "doesn't untap" static effects from a card's oracle text
 * Handles cards like:
 * - Intruder Alarm: "Creatures don't untap during their controllers' untap steps"
 * - Winter Orb: "As long as Winter Orb is untapped, players can't untap more than one land during their untap steps"
 * - Static Orb: "As long as Static Orb is untapped, players can't untap more than two permanents during their untap steps"
 * - Stasis: "Players skip their untap steps"
 * - Frozen Aether: "Artifacts, creatures, and lands your opponents control enter the battlefield tapped"
 * - Claustrophobia: "Enchanted creature doesn't untap during its controller's untap step"
 * - Sleep: "Tap all creatures target player controls. Those creatures don't untap during that player's next untap step"
 */
export function detectDoesntUntapEffects(card: any, permanent: any): DoesntUntapEffect[] {
  const effects: DoesntUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Creatures don't untap during their controllers' untap steps" (Intruder Alarm)
  if (oracleText.includes("creatures don't untap") || 
      oracleText.includes("creatures do not untap")) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Creatures don't untap during their controllers' untap steps",
      affectedType: 'all_creatures',
      affectedController: 'all',
    });
  }
  
  // "Lands don't untap" patterns (e.g., Rising Waters)
  if (oracleText.includes("lands don't untap") || 
      oracleText.includes("lands do not untap")) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Lands don't untap during their controllers' untap steps",
      affectedType: 'all_lands',
      affectedController: 'all',
    });
  }
  
  // "Enchanted creature doesn't untap" (Claustrophobia, Narcolepsy, Ice Cage)
  if (oracleText.includes("enchanted creature doesn't untap") ||
      oracleText.includes("enchanted creature does not untap")) {
    // This affects a specific creature - the one it's attached to
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Enchanted creature doesn't untap during its controller's untap step",
      affectedType: 'specific_permanent',
      targetPermanentId: permanent?.attachedTo, // The permanent this aura is attached to
    });
  }
  
  // "This creature doesn't untap" (self-referential, like Rust Tick)
  if (oracleText.includes("this creature doesn't untap") ||
      oracleText.includes("~ doesn't untap")) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "This creature doesn't untap during your untap step",
      affectedType: 'specific_permanent',
      targetPermanentId: permanentId,
    });
  }
  
  // "Artifacts you control don't untap" or similar controller-specific effects
  if (oracleText.match(/artifacts you control don't untap/i)) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Artifacts you control don't untap during your untap step",
      affectedType: 'all_permanents', // Would need more specific type
      affectedController: 'controller',
    });
  }
  
  return effects;
}

/**
 * Check if a permanent is prevented from untapping by static effects
 * @param ctx Game context  
 * @param permanentToUntap The permanent trying to untap
 * @param untapPlayerId The player whose untap step it is
 * @returns true if the permanent should NOT untap
 */
export function isPermanentPreventedFromUntapping(
  ctx: GameContext,
  permanentToUntap: any,
  untapPlayerId: string
): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permTypeLine = (permanentToUntap?.card?.type_line || '').toLowerCase();
  const isCreature = permTypeLine.includes('creature');
  const isLand = permTypeLine.includes('land');
  const permController = permanentToUntap?.controller;
  
  // Check all permanents for "doesn't untap" effects
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const doesntUntapEffects = detectDoesntUntapEffects(permanent.card, permanent);
    
    for (const effect of doesntUntapEffects) {
      // Check if this effect applies to the permanent trying to untap
      
      // Specific permanent targeting (like Claustrophobia)
      if (effect.affectedType === 'specific_permanent') {
        if (effect.targetPermanentId === permanentToUntap.id) {
          return true; // This permanent is specifically prevented from untapping
        }
        continue;
      }
      
      // Check controller restriction
      let controllerMatches = false;
      switch (effect.affectedController) {
        case 'all':
          controllerMatches = true;
          break;
        case 'controller':
          controllerMatches = permController === effect.controllerId;
          break;
        case 'opponents':
          controllerMatches = permController !== effect.controllerId;
          break;
      }
      
      if (!controllerMatches) continue;
      
      // Check type restriction
      switch (effect.affectedType) {
        case 'all_creatures':
          if (isCreature) return true;
          break;
        case 'all_lands':
          if (isLand) return true;
          break;
        case 'all_permanents':
          return true;
        case 'controller_creatures':
          if (isCreature && permController === untapPlayerId) return true;
          break;
        case 'controller_lands':
          if (isLand && permController === untapPlayerId) return true;
          break;
      }
    }
  }
  
  // Also check if the permanent itself has a "doesn't untap" flag
  // This can be set by spells like Sleep or Hands of Binding
  if (permanentToUntap.doesntUntapNextTurn === true) {
    return true;
  }
  
  return false;
}


// ============================================================================
// Card Draw Trigger System
// ============================================================================

export interface CardDrawTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: "opponent_draws" | "player_draws" | "you_draw";
  effect: string;
  mandatory: boolean;
}

/**
 * Detect card draw triggers from a permanents oracle text
 * Handles patterns like:
 * - "Whenever an opponent draws a card, they lose 1 life" (Nekusar)
 * - "Whenever a player draws a card, that player discards a card" (Notion Thief reverse)
 * - "Whenever you draw a card, you gain 1 life" (various)
 */
export function detectCardDrawTriggers(card: any, permanent: any): CardDrawTrigger[] {
  const triggers: CardDrawTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Pattern: "Whenever an opponent draws a card"
  const opponentDrawsMatch = oracleText.match(/whenever an opponent draws (?:a card|cards?),?\s*([^.]+)/i);
  if (opponentDrawsMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "opponent_draws",
      effect: opponentDrawsMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Pattern: "Whenever a player draws a card" (except first each turn sometimes)
  const playerDrawsMatch = oracleText.match(/whenever a player draws (?:a card|cards?),?\s*([^.]+)/i);
  if (playerDrawsMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "player_draws",
      effect: playerDrawsMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Pattern: "Whenever you draw a card"
  const youDrawMatch = oracleText.match(/whenever you draw (?:a card|cards?),?\s*([^.]+)/i);
  if (youDrawMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: "you_draw",
      effect: youDrawMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all card draw triggers that should fire when a player draws a card
 */
export function getCardDrawTriggers(
  ctx: GameContext,
  drawingPlayerId: string,
  controllerId?: string
): CardDrawTrigger[] {
  const triggers: CardDrawTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permController = permanent.controller;
    const permTriggers = detectCardDrawTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      // Check if this trigger applies
      switch (trigger.triggerType) {
        case "opponent_draws":
          // Triggers when an opponent of the permanents controller draws
          if (drawingPlayerId !== permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
        case "player_draws":
          // Triggers for any player drawing
          triggers.push({ ...trigger, controllerId: permController });
          break;
        case "you_draw":
          // Triggers when the permanents controller draws
          if (drawingPlayerId === permController) {
            triggers.push({ ...trigger, controllerId: permController });
          }
          break;
      }
    }
  }
  
  return triggers;
}

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
// Devotion Mana Calculation
// ============================================================================

/**
 * Calculate devotion to a color for a player
 * Devotion = count of mana symbols of that color in mana costs of permanents you control
 */
export function calculateDevotion(
  gameState: any,
  playerId: string,
  color: 'W' | 'U' | 'B' | 'R' | 'G'
): number {
  const battlefield = gameState?.battlefield || [];
  let devotion = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const manaCost = permanent.card?.mana_cost || "";
    
    // Count occurrences of the color symbol
    // Format: {W}, {U}, {B}, {R}, {G}
    // Also count hybrid: {W/U}, {W/B}, etc.
    const colorSymbol = `{${color}}`;
    const regex = new RegExp(`\\{${color}(?:\\/[WUBRG])?\\}|\\{[WUBRG]\\/${color}\\}`, 'gi');
    const matches = manaCost.match(regex) || [];
    devotion += matches.length;
  }
  
  return devotion;
}

/**
 * Get the amount of mana produced by a devotion-based ability
 * Cards like Karametra's Acolyte, Nykthos
 */
export function getDevotionManaAmount(
  card: any,
  gameState: any,
  controllerId: string
): { color: string; amount: number }[] {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const results: { color: string; amount: number }[] = [];
  
  // Pattern: "Add an amount of {G} equal to your devotion to green"
  const devotionManaMatch = oracleText.match(
    /add (?:an amount of )?(\{[WUBRGC]\})(?:[^.]*?)equal to your devotion to (\w+)/i
  );
  
  if (devotionManaMatch) {
    const manaSymbol = devotionManaMatch[1].toUpperCase();
    const colorName = devotionManaMatch[2].toLowerCase();
    
    let colorCode: 'W' | 'U' | 'B' | 'R' | 'G' = 'G';
    switch (colorName) {
      case 'white': colorCode = 'W'; break;
      case 'blue': colorCode = 'U'; break;
      case 'black': colorCode = 'B'; break;
      case 'red': colorCode = 'R'; break;
      case 'green': colorCode = 'G'; break;
    }
    
    const amount = calculateDevotion(gameState, controllerId, colorCode);
    
    // Extract color from mana symbol
    const color = manaSymbol.replace(/[{}]/g, '');
    
    // Note: Devotion-based mana abilities should produce 0 if devotion is 0
    // Do not use Math.max(1, amount) as that would be incorrect
    results.push({ color, amount });
  }
  
  // Nykthos pattern: "Add X mana in any combination of colors..."
  if (oracleText.includes('nykthos') || 
      (oracleText.includes('devotion') && oracleText.includes('any combination'))) {
    // Nykthos requires choosing a color and getting devotion to that color
    // This would need UI interaction, so we return a placeholder
    results.push({ color: 'devotion_choice', amount: 0 });
  }
  
  return results;
}

// ============================================================================
// Win/Loss Condition Detection
// ============================================================================

export interface WinCondition {
  type: 'life_zero' | 'poison' | 'commander_damage' | 'card_effect' | 'empty_library_draw';
  playerId: string;
  winnerId?: string;
  loserId?: string;
  reason: string;
}

/**
 * Check for game-ending conditions
 * Rule 104.3: A player loses the game if:
 * - Their life total is 0 or less
 * - They have 10+ poison counters
 * - They've been dealt 21+ combat damage by a single commander
 * - They attempt to draw from an empty library
 * - A card effect says they lose
 */
export function checkWinConditions(ctx: GameContext): WinCondition[] {
  const conditions: WinCondition[] = [];
  const players = ctx.state?.players || [];
  const life = (ctx as any).life || {};
  const poison = (ctx as any).poison || {};
  const commanderDamage = (ctx.state as any)?.commanderDamage || {};
  
  for (const player of players) {
    if (!player || (player as any).spectator || (player as any).isSpectator) continue;
    const playerId = player.id;
    
    // Check life total (Rule 104.3b)
    const playerLife = life[playerId] ?? 40;
    if (playerLife <= 0) {
      conditions.push({
        type: 'life_zero',
        playerId,
        loserId: playerId,
        reason: `${player.name || playerId} has 0 or less life (${playerLife})`,
      });
    }
    
    // Check poison counters (Rule 104.3d) - 10 in regular, but Commander uses 10 as well
    const playerPoison = poison[playerId] ?? 0;
    if (playerPoison >= 10) {
      conditions.push({
        type: 'poison',
        playerId,
        loserId: playerId,
        reason: `${player.name || playerId} has ${playerPoison} poison counters`,
      });
    }
    
    // Check commander damage (21+ from a single commander)
    const playerCmdrDamage = commanderDamage[playerId] || {};
    for (const [commanderId, damage] of Object.entries(playerCmdrDamage)) {
      if (typeof damage === 'number' && damage >= 21) {
        conditions.push({
          type: 'commander_damage',
          playerId,
          loserId: playerId,
          reason: `${player.name || playerId} has taken ${damage} commander damage from a single commander`,
        });
        break; // Only need to report once per player
      }
    }
  }
  
  // Check for card-based win conditions on the battlefield
  const battlefield = ctx.state?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const cardName = (permanent.card.name || "").toLowerCase();
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const controllerId = permanent.controller;
    const controller = players.find((p: any) => p.id === controllerId);
    
    // Felidar Sovereign: "At the beginning of your upkeep, if you have 40 or more life, you win the game."
    if (cardName.includes('felidar sovereign') && (life[controllerId] ?? 40) >= 40) {
      conditions.push({
        type: 'card_effect',
        playerId: controllerId,
        winnerId: controllerId,
        reason: `${controller?.name || controllerId} wins with Felidar Sovereign (40+ life at upkeep)`,
      });
    }
    
    // Test of Endurance: "At the beginning of your upkeep, if you have 50 or more life, you win the game."
    if (cardName.includes('test of endurance') && (life[controllerId] ?? 40) >= 50) {
      conditions.push({
        type: 'card_effect',
        playerId: controllerId,
        winnerId: controllerId,
        reason: `${controller?.name || controllerId} wins with Test of Endurance (50+ life at upkeep)`,
      });
    }
    
    // Thassa's Oracle: Win condition is checked on ETB/resolution
    // Jace, Wielder of Mysteries: Similar to Lab Man
    // Laboratory Maniac: Replacement effect for drawing from empty library
    // These are handled in the draw logic
  }
  
  return conditions;
}

/**
 * Check for alternate win condition triggers at upkeep
 */
export function checkUpkeepWinConditions(
  ctx: GameContext,
  activePlayerId: string
): WinCondition | null {
  const life = (ctx as any).life || {};
  const playerLife = life[activePlayerId] ?? 40;
  const battlefield = ctx.state?.battlefield || [];
  const players = ctx.state?.players || [];
  const player = players.find((p: any) => p.id === activePlayerId);
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== activePlayerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    // Felidar Sovereign
    if (cardName.includes('felidar sovereign') && playerLife >= 40) {
      return {
        type: 'card_effect',
        playerId: activePlayerId,
        winnerId: activePlayerId,
        reason: `${player?.name || activePlayerId} wins with Felidar Sovereign (40+ life at upkeep)`,
      };
    }
    
    // Test of Endurance
    if (cardName.includes('test of endurance') && playerLife >= 50) {
      return {
        type: 'card_effect',
        playerId: activePlayerId,
        winnerId: activePlayerId,
        reason: `${player?.name || activePlayerId} wins with Test of Endurance (50+ life at upkeep)`,
      };
    }
    
    // Chance Encounter (with 10+ luck counters)
    if (cardName.includes('chance encounter')) {
      const counters = permanent.counters || {};
      if ((counters.luck || 0) >= 10) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Chance Encounter (10+ luck counters)`,
        };
      }
    }
    
    // Helix Pinnacle (with 100+ tower counters)
    if (cardName.includes('helix pinnacle')) {
      const counters = permanent.counters || {};
      if ((counters.tower || 0) >= 100) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Helix Pinnacle (100+ tower counters)`,
        };
      }
    }
    
    // Epic Struggle (20+ creatures at upkeep)
    if (cardName.includes('epic struggle')) {
      const creatureCount = battlefield.filter((p: any) => 
        p.controller === activePlayerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      ).length;
      
      if (creatureCount >= 20) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Epic Struggle (20+ creatures)`,
        };
      }
    }
    
    // Mortal Combat (20+ creatures in graveyard)
    if (cardName.includes('mortal combat')) {
      const zones = ctx.state?.zones?.[activePlayerId];
      const graveyard = zones?.graveyard || [];
      const creatureCount = graveyard.filter((c: any) => 
        (c.type_line || '').toLowerCase().includes('creature')
      ).length;
      
      if (creatureCount >= 20) {
        return {
          type: 'card_effect',
          playerId: activePlayerId,
          winnerId: activePlayerId,
          reason: `${player?.name || activePlayerId} wins with Mortal Combat (20+ creatures in graveyard)`,
        };
      }
    }
  }
  
  return null;
}

// ============================================================================
// Transform/Flip Triggers
// ============================================================================

export interface TransformCheckResult {
  permanentId: string;
  cardName: string;
  shouldTransform: boolean;
  reason: string;
  newFace?: any;
}

/**
 * Check if a permanent should transform at end of turn
 * Handles cards like Growing Rites of Itlimoc, Legion's Landing, etc.
 */
export function checkEndOfTurnTransforms(
  ctx: GameContext,
  activePlayerId: string
): TransformCheckResult[] {
  const results: TransformCheckResult[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== activePlayerId) continue;
    if (!permanent.card) continue;
    
    const cardName = (permanent.card.name || "").toLowerCase();
    const oracleText = ((permanent.card as any).oracle_text || "").toLowerCase();
    const layout = (permanent.card as any).layout;
    const cardFaces = (permanent.card as any).card_faces;
    
    // Only check transformable cards
    if (layout !== 'transform' && layout !== 'double_faced_token') continue;
    if (!Array.isArray(cardFaces) || cardFaces.length < 2) continue;
    
    // Skip already transformed cards (back face is showing)
    if ((permanent as any).transformed) continue;
    
    // Growing Rites of Itlimoc: Transform at end of turn if you control 4+ creatures
    if (cardName.includes('growing rites of itlimoc')) {
      const creatureCount = battlefield.filter((p: any) => 
        p.controller === activePlayerId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      ).length;
      
      if (creatureCount >= 4) {
        results.push({
          permanentId: permanent.id,
          cardName: permanent.card.name,
          shouldTransform: true,
          reason: `Control ${creatureCount} creatures (4+ required)`,
          newFace: cardFaces[1],
        });
      }
    }
    
    // Legion's Landing: Transform when you attack with 3+ creatures
    // (This is actually checked during declare attackers, but including for completeness)
    
    // Arguel's Blood Fast: Transform at end of turn if you have 5 or less life
    if (cardName.includes("arguel's blood fast")) {
      const life = (ctx as any).life?.[activePlayerId] ?? 40;
      if (life <= 5) {
        results.push({
          permanentId: permanent.id,
          cardName: permanent.card.name,
          shouldTransform: true,
          reason: `Life total is ${life} (5 or less required)`,
          newFace: cardFaces[1],
        });
      }
    }
    
    // Dowsing Dagger: Transform when creature deals combat damage
    // (Checked during combat damage resolution)
    
    // Treasure Map: Transform when it has 3+ landmark counters
    if (cardName.includes('treasure map')) {
      const counters = permanent.counters || {};
      if ((counters.landmark || 0) >= 3) {
        results.push({
          permanentId: permanent.id,
          cardName: permanent.card.name,
          shouldTransform: true,
          reason: `Has ${counters.landmark} landmark counters (3+ required)`,
          newFace: cardFaces[1],
        });
      }
    }
    
    // Generic pattern: "At the beginning of your end step, if [condition], transform ~"
    const endStepTransformMatch = oracleText.match(
      /at the beginning of (?:your )?end step,?\s*if ([^,]+),?\s*transform/i
    );
    if (endStepTransformMatch) {
      // We found a transform trigger - would need to evaluate the condition
      // For now, mark it for UI to handle
      results.push({
        permanentId: permanent.id,
        cardName: permanent.card.name,
        shouldTransform: false, // UI needs to confirm
        reason: `Condition: ${endStepTransformMatch[1]}`,
        newFace: cardFaces[1],
      });
    }
  }
  
  return results;
}

// ============================================================================
// Landfall Triggers
// ============================================================================

export interface LandfallTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  mandatory: boolean;
  requiresChoice?: boolean;
}

/**
 * Detect landfall triggers from a permanent's oracle text
 */
export function detectLandfallTriggers(card: any, permanent: any): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Pattern: "Landfall — Whenever a land enters the battlefield under your control,"
  const landfallMatch = oracleText.match(
    /landfall\s*[—-]\s*whenever a land enters the battlefield under your control,?\s*([^.]+)/i
  );
  if (landfallMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: landfallMatch[1].trim(),
      mandatory: !landfallMatch[1].toLowerCase().includes('you may'),
      requiresChoice: landfallMatch[1].toLowerCase().includes('you may'),
    });
  }
  
  // Also check for non-keyworded landfall: "Whenever a land enters the battlefield under your control"
  const genericLandfallMatch = oracleText.match(
    /whenever a land enters the battlefield under your control,?\s*([^.]+)/i
  );
  if (genericLandfallMatch && !landfallMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      effect: genericLandfallMatch[1].trim(),
      mandatory: !genericLandfallMatch[1].toLowerCase().includes('you may'),
      requiresChoice: genericLandfallMatch[1].toLowerCase().includes('you may'),
    });
  }
  
  return triggers;
}

/**
 * Get all landfall triggers when a land enters the battlefield
 */
export function getLandfallTriggers(
  ctx: GameContext,
  landController: string
): LandfallTrigger[] {
  const triggers: LandfallTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    // Landfall triggers only fire for the controller
    if (permanent.controller !== landController) continue;
    
    const permTriggers = detectLandfallTriggers(permanent.card, permanent);
    triggers.push(...permTriggers);
  }
  
  return triggers;
}

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

