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
    | 'permanent_etb'     // Altar of the Brood style - whenever ANY permanent enters
    | 'another_permanent_etb' // Whenever ANOTHER permanent enters under your control
    | 'deals_damage'
    | 'deals_combat_damage'
    | 'annihilator'
    | 'melee'
    | 'myriad'
    | 'exalted'
    | 'upkeep_create_copy'  // Progenitor Mimic style - create token copy at upkeep
    | 'end_step_resource';  // Kynaios & Tiro style - draw/land resource at end step
  description: string;
  effect?: string;
  value?: number; // For Annihilator N, etc.
  millAmount?: number; // For mill triggers like Altar of the Brood
  manaCost?: string; // For "sacrifice unless you pay" triggers
  mandatory: boolean;
  requiresTarget?: boolean;
  targetType?: string;
  requiresChoice?: boolean; // For triggers where player must choose
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

const KNOWN_ATTACK_TRIGGERS: Record<string, { effect: string; value?: number; putFromHand?: boolean; tappedAndAttacking?: boolean }> = {
  "hellkite charger": { effect: "Pay {5}{R}{R} for additional combat phase" },
  "combat celebrant": { effect: "Exert for additional combat phase" },
  "aurelia, the warleader": { effect: "Additional combat phase (first attack each turn)" },
  "moraug, fury of akoum": { effect: "Additional combat phase when landfall" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token" },
  "marisi, breaker of the coil": { effect: "Goad all creatures that player controls" },
  "grand warlord radha": { effect: "Add mana for each attacking creature" },
  "neheb, the eternal": { effect: "Add {R} for each life opponent lost (postcombat)" },
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
 * Known cards with ETB triggers (enters the battlefield)
 */
const KNOWN_ETB_TRIGGERS: Record<string, { 
  effect: string; 
  triggerOn: 'self' | 'creature' | 'another_permanent' | 'any_permanent';
  millAmount?: number;
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
      
      triggers.push({
        permanentId,
        cardName,
        triggerType,
        description: info.effect,
        effect: info.effect,
        millAmount: info.millAmount,
        mandatory: true,
      });
    }
  }
  
  // "When ~ enters the battlefield"
  const etbMatch = oracleText.match(/when\s+(?:~|this creature|this permanent)\s+enters the battlefield,?\s*([^.]+)/i);
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
  
  // "Whenever a creature enters the battlefield under your control"
  const creatureETBMatch = oracleText.match(/whenever a creature enters the battlefield under your control,?\s*([^.]+)/i);
  if (creatureETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb',
      description: creatureETBMatch[1].trim(),
      effect: creatureETBMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever another permanent enters the battlefield under your control" (Altar of the Brood pattern)
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
const KNOWN_BEGINNING_COMBAT_TRIGGERS: Record<string, { effect: string; requiresChoice?: boolean }> = {
  "hakbal of the surging soul": { effect: "Reveal the top card of your library. If it's a land, put it onto the battlefield tapped. Otherwise, put a +1/+1 counter on Hakbal." },
  "etali, primal storm": { effect: "Exile cards from each opponent's library and cast them without paying mana costs" },
  "marisi, breaker of the coil": { effect: "Goaded creatures can't block" },
  "aurelia, the warleader": { effect: "Untap all creatures, additional combat phase (first combat each turn)" },
  "gisela, blade of goldnight": { effect: "Damage dealt to opponents is doubled; damage dealt to you is halved" },
  "iroas, god of victory": { effect: "Creatures you control have menace and prevent damage that would be dealt to them" },
  "xenagos, god of revels": { effect: "Choose target creature you control. It gains haste and gets +X/+X" },
  "combat celebrant": { effect: "You may exert for additional combat phase" },
  "grand warlord radha": { effect: "Add mana equal to attacking creatures at beginning of combat" },
  "saskia the unyielding": { effect: "Damage to chosen player is dealt to them again" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token when attacking" },
  "grand arbiter augustin iv": { effect: "Your spells cost less; opponent spells cost more" },
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
