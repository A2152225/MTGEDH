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
    | 'creature_etb'
    | 'deals_damage'
    | 'deals_combat_damage'
    | 'annihilator'
    | 'melee'
    | 'myriad'
    | 'exalted';
  description: string;
  effect?: string;
  value?: number; // For Annihilator N, etc.
  mandatory: boolean;
  requiresTarget?: boolean;
  targetType?: string;
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

const KNOWN_ATTACK_TRIGGERS: Record<string, { effect: string; value?: number }> = {
  "hellkite charger": { effect: "Pay {5}{R}{R} for additional combat phase" },
  "combat celebrant": { effect: "Exert for additional combat phase" },
  "aurelia, the warleader": { effect: "Additional combat phase (first attack each turn)" },
  "moraug, fury of akoum": { effect: "Additional combat phase when landfall" },
  "najeela, the blade-blossom": { effect: "Create 1/1 Warrior token" },
  "marisi, breaker of the coil": { effect: "Goad all creatures that player controls" },
  "grand warlord radha": { effect: "Add mana for each attacking creature" },
  "neheb, the eternal": { effect: "Add {R} for each life opponent lost (postcombat)" },
};

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
 * Detect ETB triggers
 */
export function detectETBTriggers(card: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  
  // "When ~ enters the battlefield"
  const etbMatch = oracleText.match(/when\s+(?:~|this creature|this permanent)\s+enters the battlefield,?\s*([^.]+)/i);
  if (etbMatch) {
    triggers.push({
      permanentId: "", // Will be set when permanent is created
      cardName,
      triggerType: 'etb',
      description: etbMatch[1].trim(),
      effect: etbMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever a creature enters the battlefield under your control"
  const creatureETBMatch = oracleText.match(/whenever a creature enters the battlefield under your control,?\s*([^.]+)/i);
  if (creatureETBMatch) {
    triggers.push({
      permanentId: "",
      cardName,
      triggerType: 'creature_etb',
      description: creatureETBMatch[1].trim(),
      effect: creatureETBMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Check if a creature has flying or other evasion
 */
export function hasEvasionAbility(card: any): { flying: boolean; menace: boolean; trample: boolean; unblockable: boolean; shadow: boolean; horsemanship: boolean; fear: boolean; intimidate: boolean; skulk: boolean } {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  const checkKeyword = (kw: string) => 
    keywords.includes(kw) || keywords.map((k: string) => k.toLowerCase()).includes(kw.toLowerCase()) || oracleText.includes(kw.toLowerCase());
  
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
