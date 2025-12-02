/**
 * modalTriggeredAbilities.ts
 * 
 * Support for modal triggered abilities like Black Market Connections.
 * These are triggered abilities that present mode choices when they trigger,
 * rather than modal spells that require mode selection during casting.
 * 
 * Examples:
 * - Black Market Connections: "At the beginning of your precombat main phase,
 *   choose one or more —" with modes that have costs
 * - Various charms and commands as abilities
 * 
 * This differs from:
 * - Modal spells (Rule 700.2) - modes chosen during casting
 * - Spree (Rule 702.172) - modes with costs chosen during casting
 * - Tiered (Rule 702.183) - single mode with cost during casting
 * - Escalate (Rule 702.120) - additional modes for additional cost during casting
 * 
 * Modal triggered abilities:
 * - Trigger like normal triggered abilities (Rule 603)
 * - Mode selection happens when the ability is put on the stack
 * - May have costs associated with each mode
 * - Often use "choose one or more" or "choose any number"
 */

import type { PlayerID } from '../../shared/src';
import { createModeSelectionEvent, type ModeSelectionEvent } from './choiceEvents';

/**
 * Mode definition for a modal triggered ability
 */
export interface ModalTriggerMode {
  readonly id: string;
  readonly text: string;
  readonly cost?: string;
  readonly effect: string;
  readonly requiresTarget?: boolean;
  readonly targetType?: string;
}

/**
 * Modal triggered ability definition
 */
export interface ModalTriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
  readonly triggerCondition: string;
  readonly modes: readonly ModalTriggerMode[];
  readonly minModes: number;
  readonly maxModes: number;
  readonly canRepeatModes: boolean;
}

/**
 * Selected modes for a modal triggered ability
 */
export interface ModalTriggerSelection {
  readonly abilityId: string;
  readonly selectedModeIds: readonly string[];
  readonly totalCost: string;
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Result of parsing modal trigger text
 */
export interface ParsedModalTrigger {
  readonly isModal: boolean;
  readonly triggerCondition?: string;
  readonly modes?: readonly ModalTriggerMode[];
  readonly minModes?: number;
  readonly maxModes?: number;
}

/**
 * Black Market Connections card pattern
 * "At the beginning of your precombat main phase, choose up to three —"
 * This means you can choose 0, 1, 2, or 3 modes (each has a life cost)
 * Modes:
 * - Sell Contraband — You lose 1 life. Create a Treasure token.
 * - Buy Information — You lose 2 life. Draw a card.
 * - Hire a Mercenary — You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.
 */
const BLACK_MARKET_CONNECTIONS_PATTERN = /at the beginning of your precombat main phase, choose up to three/i;

/**
 * Generic modal trigger pattern
 * Matches "At/When/Whenever [condition], choose [X] —"
 */
const MODAL_TRIGGER_PATTERN = /^(at|when|whenever)\s+(.+?),\s+choose\s+(one|two|three|up to one|up to two|up to three|one or more|any number)/i;

/**
 * Mode pattern for bullet points
 * Matches "• Mode Name — Effect text" or "+ Cost — Effect text" (for spree-style)
 * Also handles inline bullets separated by spaces
 */
const MODE_BULLET_PATTERN = /[•+]\s*(?:([^—•+\n]+?)\s*—\s*)?([^•+\n]+?)(?=\s*[•+]|\n[•+]|$)/gi;

/**
 * Parse a modal triggered ability from oracle text
 */
export function parseModalTriggeredAbility(
  oracleText: string,
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID
): ModalTriggeredAbility | null {
  const parsed = parseModalTriggerText(oracleText);
  
  if (!parsed.isModal || !parsed.modes || !parsed.triggerCondition) {
    return null;
  }
  
  return {
    id: `modal-trigger-${sourceId}-${Date.now()}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: parsed.triggerCondition,
    modes: parsed.modes,
    minModes: parsed.minModes || 1,
    maxModes: parsed.maxModes || parsed.modes.length,
    canRepeatModes: false,
  };
}

/**
 * Parse modal trigger text to extract modes and conditions
 */
export function parseModalTriggerText(oracleText: string): ParsedModalTrigger {
  const text = oracleText.toLowerCase();
  
  // Check for modal trigger pattern
  const triggerMatch = text.match(MODAL_TRIGGER_PATTERN);
  if (!triggerMatch) {
    return { isModal: false };
  }
  
  const triggerCondition = triggerMatch[2].trim();
  const modeCount = triggerMatch[3].toLowerCase();
  
  // Determine min/max modes
  let minModes = 1;
  let maxModes = 1;
  
  switch (modeCount) {
    case 'one':
      minModes = 1;
      maxModes = 1;
      break;
    case 'two':
      minModes = 2;
      maxModes = 2;
      break;
    case 'three':
      minModes = 3;
      maxModes = 3;
      break;
    case 'up to one':
      minModes = 0;
      maxModes = 1;
      break;
    case 'up to two':
      minModes = 0;
      maxModes = 2;
      break;
    case 'up to three':
      minModes = 0;
      maxModes = 3;
      break;
    case 'one or more':
      minModes = 1;
      maxModes = 10; // Will be adjusted to actual mode count
      break;
    case 'any number':
      minModes = 0;
      maxModes = 10; // Will be adjusted to actual mode count
      break;
  }
  
  // Extract modes
  const modes = extractModes(oracleText);
  
  if (modes.length === 0) {
    return { isModal: false };
  }
  
  // Adjust maxModes to actual mode count
  maxModes = Math.min(maxModes, modes.length);
  
  return {
    isModal: true,
    triggerCondition,
    modes,
    minModes,
    maxModes,
  };
}

/**
 * Extract modes from oracle text with bullet points
 */
function extractModes(oracleText: string): ModalTriggerMode[] {
  const modes: ModalTriggerMode[] = [];
  
  // Reset regex state
  MODE_BULLET_PATTERN.lastIndex = 0;
  
  let match;
  let modeIndex = 0;
  
  while ((match = MODE_BULLET_PATTERN.exec(oracleText)) !== null) {
    const modeName = match[1]?.trim();
    const modeEffect = match[2]?.trim();
    
    if (modeEffect) {
      // Check for life payment cost in the effect
      const lifeCostMatch = modeEffect.match(/you lose (\d+) life/i);
      const cost = lifeCostMatch ? `Pay ${lifeCostMatch[1]} life` : undefined;
      
      // Check for mana cost (for spree-style modes)
      const manaCostMatch = modeName?.match(/\{[WUBRGC0-9]+\}/i);
      const manaCost = manaCostMatch ? manaCostMatch[0] : undefined;
      
      modes.push({
        id: `mode-${modeIndex}`,
        text: modeName || modeEffect.substring(0, 30) + '...',
        cost: manaCost || cost,
        effect: modeEffect,
        requiresTarget: /target/i.test(modeEffect),
        targetType: extractTargetType(modeEffect),
      });
      
      modeIndex++;
    }
  }
  
  return modes;
}

/**
 * Extract target type from effect text
 */
function extractTargetType(effectText: string): string | undefined {
  const targetMatch = effectText.match(/target\s+(\w+)/i);
  return targetMatch ? targetMatch[1] : undefined;
}

/**
 * Create a mode selection event for a modal triggered ability
 */
export function createModalTriggerSelectionEvent(
  ability: ModalTriggeredAbility,
  sourceImage?: string
): ModeSelectionEvent {
  return createModeSelectionEvent(
    ability.controllerId,
    ability.sourceId,
    ability.sourceName,
    ability.modes.map(m => ({
      id: m.id,
      text: m.cost ? `${m.text} (${m.cost})` : m.text,
    })),
    ability.minModes,
    ability.maxModes,
    sourceImage
  );
}

/**
 * Validate mode selection for a modal triggered ability
 */
export function validateModalTriggerSelection(
  ability: ModalTriggeredAbility,
  selectedModeIds: readonly string[]
): ModalTriggerSelection {
  const errors: string[] = [];
  
  // Check mode count
  if (selectedModeIds.length < ability.minModes) {
    errors.push(`Must choose at least ${ability.minModes} mode(s)`);
  }
  
  if (selectedModeIds.length > ability.maxModes) {
    errors.push(`Can choose at most ${ability.maxModes} mode(s)`);
  }
  
  // Check that all selected modes exist
  const validModeIds = new Set(ability.modes.map(m => m.id));
  for (const id of selectedModeIds) {
    if (!validModeIds.has(id)) {
      errors.push(`Invalid mode: ${id}`);
    }
  }
  
  // Check for duplicates if not allowed
  if (!ability.canRepeatModes) {
    const seen = new Set<string>();
    for (const id of selectedModeIds) {
      if (seen.has(id)) {
        errors.push(`Cannot choose the same mode twice`);
      }
      seen.add(id);
    }
  }
  
  // Calculate total cost
  const selectedModes = selectedModeIds
    .map(id => ability.modes.find(m => m.id === id))
    .filter((m): m is ModalTriggerMode => m !== undefined);
  
  const costs = selectedModes
    .filter(m => m.cost)
    .map(m => m.cost!);
  
  const totalCost = costs.length > 0 ? costs.join(', ') : 'None';
  
  return {
    abilityId: ability.id,
    selectedModeIds,
    totalCost,
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get the effects for selected modes
 */
export function getSelectedModeEffects(
  ability: ModalTriggeredAbility,
  selectedModeIds: readonly string[]
): readonly ModalTriggerMode[] {
  return selectedModeIds
    .map(id => ability.modes.find(m => m.id === id))
    .filter((m): m is ModalTriggerMode => m !== undefined);
}

/**
 * Check if a card is Black Market Connections
 */
export function isBlackMarketConnections(oracleText: string): boolean {
  return BLACK_MARKET_CONNECTIONS_PATTERN.test(oracleText);
}

/**
 * Create Black Market Connections ability
 * "At the beginning of your precombat main phase, choose up to three —"
 * You can choose 0, 1, 2, or 3 modes (optional, each with life cost)
 */
export function createBlackMarketConnectionsAbility(
  sourceId: string,
  controllerId: PlayerID
): ModalTriggeredAbility {
  return {
    id: `modal-trigger-${sourceId}-bmc`,
    sourceId,
    sourceName: 'Black Market Connections',
    controllerId,
    triggerCondition: 'At the beginning of your precombat main phase',
    modes: [
      {
        id: 'sell-contraband',
        text: 'Sell Contraband',
        cost: 'Pay 1 life',
        effect: 'You lose 1 life. Create a Treasure token.',
        requiresTarget: false,
      },
      {
        id: 'buy-information',
        text: 'Buy Information',
        cost: 'Pay 2 life',
        effect: 'You lose 2 life. Draw a card.',
        requiresTarget: false,
      },
      {
        id: 'hire-mercenary',
        text: 'Hire a Mercenary',
        cost: 'Pay 3 life',
        effect: 'You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
        requiresTarget: false,
      },
    ],
    minModes: 0, // "Choose up to three" means you can choose 0
    maxModes: 3,
    canRepeatModes: false,
  };
}

/**
 * Integration with spree ability for spree spells
 * Spree spells are modal with costs per mode
 */
export function createSpreeAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; cost: string; effect: string }[]
): ModalTriggeredAbility {
  return {
    id: `spree-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting', // Not a trigger, but uses same structure
    modes: modes.map((m, i) => ({
      id: `spree-mode-${i}`,
      text: m.text,
      cost: m.cost,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: modes.length,
    canRepeatModes: false,
  };
}

/**
 * Integration with tiered ability for tiered spells
 * Tiered spells are modal with exactly one mode and associated cost
 */
export function createTieredAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; cost: string; effect: string }[]
): ModalTriggeredAbility {
  return {
    id: `tiered-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting', // Not a trigger, but uses same structure
    modes: modes.map((m, i) => ({
      id: `tiered-mode-${i}`,
      text: m.text,
      cost: m.cost,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: 1, // Tiered is always exactly one mode
    canRepeatModes: false,
  };
}

/**
 * Integration with escalate ability for escalate spells
 * Escalate spells allow choosing more modes for additional cost
 */
export function createEscalateAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  escalateCost: string
): ModalTriggeredAbility & { escalateCost: string } {
  return {
    id: `escalate-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting', // Not a trigger, but uses same structure
    modes: modes.map((m, i) => ({
      id: `escalate-mode-${i}`,
      text: m.text,
      cost: i > 0 ? escalateCost : undefined, // First mode is free
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: modes.length,
    canRepeatModes: false,
    escalateCost,
  };
}

/**
 * Calculate total escalate cost
 */
export function calculateEscalateCost(
  selectedModeCount: number,
  escalateCost: string
): { count: number; totalCost: string } {
  const additionalModes = Math.max(0, selectedModeCount - 1);
  return {
    count: additionalModes,
    totalCost: additionalModes > 0 ? `${additionalModes} × ${escalateCost}` : 'None',
  };
}

/**
 * Command cards (Cryptic Command, Kolaghan's Command, etc.)
 * "Choose two —" with 4 modes, must choose exactly 2 different modes
 */
export function createCommandAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[]
): ModalTriggeredAbility {
  return {
    id: `command-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `command-mode-${i}`,
      text: m.text,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 2,
    maxModes: 2,
    canRepeatModes: false, // Must choose 2 different modes
  };
}

/**
 * Create Cryptic Command ability modes
 * "Choose two —"
 * - Counter target spell
 * - Return target permanent to its owner's hand
 * - Tap all creatures your opponents control
 * - Draw a card
 */
export function createCrypticCommandModes(
  sourceId: string,
  controllerId: PlayerID
): ModalTriggeredAbility {
  return createCommandAbilityModes(sourceId, 'Cryptic Command', controllerId, [
    { text: 'Counter target spell', effect: 'Counter target spell.' },
    { text: 'Return target permanent to its owner\'s hand', effect: 'Return target permanent to its owner\'s hand.' },
    { text: 'Tap all creatures your opponents control', effect: 'Tap all creatures your opponents control.' },
    { text: 'Draw a card', effect: 'Draw a card.' },
  ]);
}

/**
 * Create Kolaghan's Command ability modes
 * "Choose two —"
 */
export function createKolaghansCommandModes(
  sourceId: string,
  controllerId: PlayerID
): ModalTriggeredAbility {
  return createCommandAbilityModes(sourceId, 'Kolaghan\'s Command', controllerId, [
    { text: 'Return target creature card from your graveyard to your hand', effect: 'Return target creature card from your graveyard to your hand.' },
    { text: 'Target player discards a card', effect: 'Target player discards a card.' },
    { text: 'Destroy target artifact', effect: 'Destroy target artifact.' },
    { text: 'Kolaghan\'s Command deals 2 damage to any target', effect: 'Kolaghan\'s Command deals 2 damage to any target.' },
  ]);
}

/**
 * Entwine configuration for modal spells
 * Allows choosing 1 mode OR paying entwine cost to get all modes
 */
export interface EntwineAbilityConfig extends ModalTriggeredAbility {
  readonly entwineCost: string;
  readonly isEntwined: boolean;
}

/**
 * Create an entwine spell configuration
 * Rule 702.42 - Entwine allows choosing all modes instead of one
 * 
 * @param sourceId - Source ID
 * @param sourceName - Source name
 * @param controllerId - Controller ID
 * @param modes - Available modes
 * @param entwineCost - Cost to entwine (get all modes)
 * @returns Entwine ability configuration
 */
export function createEntwineAbilityModes(
  sourceId: string,
  sourceName: string,
  controllerId: PlayerID,
  modes: readonly { text: string; effect: string }[],
  entwineCost: string
): EntwineAbilityConfig {
  return {
    id: `entwine-${sourceId}`,
    sourceId,
    sourceName,
    controllerId,
    triggerCondition: 'When casting',
    modes: modes.map((m, i) => ({
      id: `entwine-mode-${i}`,
      text: m.text,
      effect: m.effect,
      requiresTarget: /target/i.test(m.effect),
      targetType: extractTargetType(m.effect),
    })),
    minModes: 1,
    maxModes: 1, // Without entwine, choose only 1
    canRepeatModes: false,
    entwineCost,
    isEntwined: false,
  };
}

/**
 * Apply entwine to get all modes
 */
export function applyEntwine(
  config: EntwineAbilityConfig
): EntwineAbilityConfig {
  return {
    ...config,
    minModes: config.modes.length,
    maxModes: config.modes.length,
    isEntwined: true,
  };
}

/**
 * Validate entwine selection
 */
export function validateEntwineSelection(
  config: EntwineAbilityConfig,
  selectedModeIds: readonly string[],
  isEntwined: boolean
): ModalTriggerSelection {
  if (isEntwined) {
    // Must select all modes when entwined
    const allModeIds = config.modes.map(m => m.id);
    const hasAllModes = allModeIds.every(id => selectedModeIds.includes(id));
    
    if (!hasAllModes) {
      return {
        abilityId: config.id,
        selectedModeIds,
        totalCost: config.entwineCost,
        isValid: false,
        errors: ['When entwined, all modes must be selected'],
      };
    }
    
    return {
      abilityId: config.id,
      selectedModeIds,
      totalCost: config.entwineCost,
      isValid: true,
      errors: [],
    };
  }
  
  // Standard validation for non-entwined
  return validateModalTriggerSelection(config, selectedModeIds);
}

/**
 * Cipher encoded spell tracking
 * Rule 702.99 - Cipher encodes a spell onto a creature
 */
export interface CipherEncodedSpell {
  readonly spellId: string;
  readonly spellName: string;
  readonly spellOracleText: string;
  readonly encodedOnCreatureId: string;
  readonly encodedOnCreatureName: string;
  readonly controllerId: PlayerID;
  readonly timestamp: number;
}

/**
 * Cipher registry for tracking encoded spells
 */
export interface CipherRegistry {
  readonly encodedSpells: readonly CipherEncodedSpell[];
}

/**
 * Valid creature for cipher encoding
 */
export interface CipherEncodingTarget {
  readonly creatureId: string;
  readonly creatureName: string;
  readonly controllerId: PlayerID;
  readonly isValid: boolean;
  readonly invalidReason?: string;
}

/**
 * Cipher encoding choice event
 * Rule 702.99a - "you may exile this spell card encoded on a creature you control"
 */
export interface CipherEncodingChoice {
  readonly type: 'cipher_encoding';
  readonly spellId: string;
  readonly spellName: string;
  readonly controllerId: PlayerID;
  readonly validTargets: readonly CipherEncodingTarget[];
  readonly isMay: true; // "you may" - optional
  readonly description: string;
}

/**
 * Create empty cipher registry
 */
export function createCipherRegistry(): CipherRegistry {
  return {
    encodedSpells: [],
  };
}

/**
 * Get valid creatures for cipher encoding
 * Rule 702.99a - Must be a creature you control
 * 
 * @param creatures - All creatures on battlefield
 * @param controllerId - The player encoding the spell
 * @returns List of valid encoding targets
 */
export function getValidCipherTargets(
  creatures: readonly { id: string; name: string; controllerId: PlayerID }[],
  controllerId: PlayerID
): readonly CipherEncodingTarget[] {
  return creatures.map(creature => {
    const isControlled = creature.controllerId === controllerId;
    
    return {
      creatureId: creature.id,
      creatureName: creature.name,
      controllerId: creature.controllerId,
      isValid: isControlled,
      invalidReason: isControlled ? undefined : 'You must control the creature',
    };
  }).filter(target => target.isValid);
}

/**
 * Create cipher encoding choice event
 * This is displayed when a cipher spell resolves to let player choose a creature
 */
export function createCipherEncodingChoice(
  spellId: string,
  spellName: string,
  controllerId: PlayerID,
  creatures: readonly { id: string; name: string; controllerId: PlayerID }[]
): CipherEncodingChoice {
  const validTargets = getValidCipherTargets(creatures, controllerId);
  
  return {
    type: 'cipher_encoding',
    spellId,
    spellName,
    controllerId,
    validTargets,
    isMay: true,
    description: `${spellName} has cipher. You may exile it encoded on a creature you control.`,
  };
}

/**
 * Validate cipher encoding target selection
 */
export function validateCipherEncodingTarget(
  choice: CipherEncodingChoice,
  selectedCreatureId: string | null
): {
  isValid: boolean;
  error?: string;
  skipEncoding: boolean;
} {
  // Player can choose not to encode (it's a "may" ability)
  if (selectedCreatureId === null) {
    return {
      isValid: true,
      skipEncoding: true,
    };
  }
  
  const target = choice.validTargets.find(t => t.creatureId === selectedCreatureId);
  
  if (!target) {
    return {
      isValid: false,
      error: 'Selected creature is not a valid target for cipher encoding',
      skipEncoding: false,
    };
  }
  
  if (!target.isValid) {
    return {
      isValid: false,
      error: target.invalidReason || 'Invalid target',
      skipEncoding: false,
    };
  }
  
  return {
    isValid: true,
    skipEncoding: false,
  };
}

/**
 * Encode a cipher spell onto a creature
 * Rule 702.99a - As the spell resolves, exile it and encode it onto a creature
 */
export function encodeSpellOntoCreature(
  registry: CipherRegistry,
  spellId: string,
  spellName: string,
  spellOracleText: string,
  creatureId: string,
  creatureName: string,
  controllerId: PlayerID
): CipherRegistry {
  const encodedSpell: CipherEncodedSpell = {
    spellId,
    spellName,
    spellOracleText,
    encodedOnCreatureId: creatureId,
    encodedOnCreatureName: creatureName,
    controllerId,
    timestamp: Date.now(),
  };
  
  return {
    encodedSpells: [...registry.encodedSpells, encodedSpell],
  };
}

/**
 * Get spells encoded on a creature
 */
export function getEncodedSpells(
  registry: CipherRegistry,
  creatureId: string
): readonly CipherEncodedSpell[] {
  return registry.encodedSpells.filter(s => s.encodedOnCreatureId === creatureId);
}

/**
 * Remove encoded spells when creature leaves battlefield
 * Rule 702.99c - If the creature leaves the battlefield, the spell remains exiled
 * but is no longer encoded on anything (can't trigger)
 */
export function removeEncodedSpells(
  registry: CipherRegistry,
  creatureId: string
): CipherRegistry {
  return {
    encodedSpells: registry.encodedSpells.filter(s => s.encodedOnCreatureId !== creatureId),
  };
}

/**
 * Check for cipher triggers when a creature deals combat damage to a player
 * Rule 702.99b - Whenever the encoded creature deals combat damage to a player,
 * you may cast a copy of the encoded card without paying its mana cost
 */
export function checkCipherTriggers(
  registry: CipherRegistry,
  creatureId: string,
  damagedPlayerId: PlayerID
): readonly {
  encodedSpell: CipherEncodedSpell;
  triggerId: string;
  description: string;
}[] {
  const encodedSpells = getEncodedSpells(registry, creatureId);
  
  return encodedSpells.map(spell => ({
    encodedSpell: spell,
    triggerId: `cipher-trigger-${spell.spellId}-${Date.now()}`,
    description: `${spell.encodedOnCreatureName} dealt combat damage to a player. You may cast a copy of ${spell.spellName} without paying its mana cost.`,
  }));
}

/**
 * Create cipher cast event
 * This is a "may" ability - player can choose to cast or not
 */
export function createCipherCastEvent(
  playerId: PlayerID,
  encodedSpell: CipherEncodedSpell
): {
  type: 'cipher_cast';
  playerId: PlayerID;
  spellName: string;
  spellOracleText: string;
  creatureName: string;
  isMay: true;
} {
  return {
    type: 'cipher_cast',
    playerId,
    spellName: encodedSpell.spellName,
    spellOracleText: encodedSpell.spellOracleText,
    creatureName: encodedSpell.encodedOnCreatureName,
    isMay: true,
  };
}

// =============================================================================
// NINJUTSU SUPPORT
// Rule 702.49 - Ninjutsu allows swapping an unblocked attacker with a Ninja
// =============================================================================

/**
 * Unblocked attacker that can be returned for Ninjutsu
 */
export interface NinjutsuTarget {
  readonly creatureId: string;
  readonly creatureName: string;
  readonly controllerId: PlayerID;
  readonly isUnblocked: boolean;
  readonly isAttacking: boolean;
  readonly isValid: boolean;
  readonly invalidReason?: string;
}

/**
 * Ninjutsu activation choice
 * Rule 702.49a - Return an unblocked attacking creature you control to hand,
 * put this card onto the battlefield tapped and attacking
 */
export interface NinjutsuActivationChoice {
  readonly type: 'ninjutsu_activation';
  readonly ninjaCardId: string;
  readonly ninjaCardName: string;
  readonly ninjutsuCost: string;
  readonly controllerId: PlayerID;
  readonly validTargets: readonly NinjutsuTarget[];
  readonly description: string;
}

/**
 * Get valid creatures for Ninjutsu activation
 * Rule 702.49a - Must be an unblocked attacking creature you control
 * 
 * @param attackingCreatures - All attacking creatures with their blocked status
 * @param controllerId - The player activating Ninjutsu
 * @returns List of valid Ninjutsu targets
 */
export function getValidNinjutsuTargets(
  attackingCreatures: readonly { 
    id: string; 
    name: string; 
    controllerId: PlayerID;
    isBlocked: boolean;
  }[],
  controllerId: PlayerID
): readonly NinjutsuTarget[] {
  return attackingCreatures.map(creature => {
    const isControlled = creature.controllerId === controllerId;
    const isUnblocked = !creature.isBlocked;
    const isValid = isControlled && isUnblocked;
    
    let invalidReason: string | undefined;
    if (!isControlled) {
      invalidReason = 'You must control the attacking creature';
    } else if (!isUnblocked) {
      invalidReason = 'Creature must be unblocked';
    }
    
    return {
      creatureId: creature.id,
      creatureName: creature.name,
      controllerId: creature.controllerId,
      isUnblocked,
      isAttacking: true,
      isValid,
      invalidReason,
    };
  }).filter(target => target.isValid);
}

/**
 * Check if Ninjutsu can be activated
 * Rule 702.49a - Can only activate during combat after blockers are declared
 * and only if you have an unblocked attacking creature
 */
export function canActivateNinjutsu(
  attackingCreatures: readonly { 
    id: string; 
    name: string; 
    controllerId: PlayerID;
    isBlocked: boolean;
  }[],
  controllerId: PlayerID,
  currentStep: string
): {
  canActivate: boolean;
  reason?: string;
  validTargetCount: number;
} {
  // Must be after blockers are declared (declare blockers step or later in combat)
  const validSteps = ['declare_blockers', 'combat_damage', 'end_of_combat'];
  const stepLower = currentStep.toLowerCase().replace(/\s+/g, '_');
  
  if (!validSteps.some(s => stepLower.includes(s))) {
    return {
      canActivate: false,
      reason: 'Ninjutsu can only be activated after blockers are declared',
      validTargetCount: 0,
    };
  }
  
  const validTargets = getValidNinjutsuTargets(attackingCreatures, controllerId);
  
  if (validTargets.length === 0) {
    return {
      canActivate: false,
      reason: 'No unblocked attacking creatures you control',
      validTargetCount: 0,
    };
  }
  
  return {
    canActivate: true,
    validTargetCount: validTargets.length,
  };
}

/**
 * Create Ninjutsu activation choice
 * This is displayed when a player wants to activate Ninjutsu
 */
export function createNinjutsuActivationChoice(
  ninjaCardId: string,
  ninjaCardName: string,
  ninjutsuCost: string,
  controllerId: PlayerID,
  attackingCreatures: readonly { 
    id: string; 
    name: string; 
    controllerId: PlayerID;
    isBlocked: boolean;
  }[]
): NinjutsuActivationChoice {
  const validTargets = getValidNinjutsuTargets(attackingCreatures, controllerId);
  
  return {
    type: 'ninjutsu_activation',
    ninjaCardId,
    ninjaCardName,
    ninjutsuCost,
    controllerId,
    validTargets,
    description: `Activate Ninjutsu for ${ninjaCardName} (${ninjutsuCost}). Choose an unblocked attacking creature to return to your hand.`,
  };
}

/**
 * Validate Ninjutsu target selection
 */
export function validateNinjutsuTarget(
  choice: NinjutsuActivationChoice,
  selectedCreatureId: string
): {
  isValid: boolean;
  error?: string;
  selectedTarget?: NinjutsuTarget;
} {
  const target = choice.validTargets.find(t => t.creatureId === selectedCreatureId);
  
  if (!target) {
    return {
      isValid: false,
      error: 'Selected creature is not a valid target for Ninjutsu',
    };
  }
  
  if (!target.isValid) {
    return {
      isValid: false,
      error: target.invalidReason || 'Invalid target',
    };
  }
  
  return {
    isValid: true,
    selectedTarget: target,
  };
}

/**
 * Result of Ninjutsu activation
 */
export interface NinjutsuActivationResult {
  readonly ninjaCardId: string;
  readonly ninjaCardName: string;
  readonly returnedCreatureId: string;
  readonly returnedCreatureName: string;
  readonly defendingPlayerId?: PlayerID;
  readonly log: readonly string[];
}

/**
 * Process Ninjutsu activation
 * 
 * @param choice - The Ninjutsu choice
 * @param selectedCreatureId - The creature to return
 * @param defendingPlayerId - The player/planeswalker being attacked
 * @returns Result of the activation
 */
export function processNinjutsuActivation(
  choice: NinjutsuActivationChoice,
  selectedCreatureId: string,
  defendingPlayerId?: PlayerID
): NinjutsuActivationResult | { error: string } {
  const validation = validateNinjutsuTarget(choice, selectedCreatureId);
  
  if (!validation.isValid || !validation.selectedTarget) {
    return { error: validation.error || 'Invalid target' };
  }
  
  const target = validation.selectedTarget;
  
  return {
    ninjaCardId: choice.ninjaCardId,
    ninjaCardName: choice.ninjaCardName,
    returnedCreatureId: target.creatureId,
    returnedCreatureName: target.creatureName,
    defendingPlayerId,
    log: [
      `${choice.controllerId} activates Ninjutsu for ${choice.ninjaCardName}`,
      `Paying ${choice.ninjutsuCost}`,
      `Returning ${target.creatureName} to hand`,
      `${choice.ninjaCardName} enters the battlefield tapped and attacking`,
    ],
  };
}

export default {
  parseModalTriggeredAbility,
  parseModalTriggerText,
  createModalTriggerSelectionEvent,
  validateModalTriggerSelection,
  getSelectedModeEffects,
  isBlackMarketConnections,
  createBlackMarketConnectionsAbility,
  createSpreeAbilityModes,
  createTieredAbilityModes,
  createEscalateAbilityModes,
  calculateEscalateCost,
  createCommandAbilityModes,
  createCrypticCommandModes,
  createKolaghansCommandModes,
  createEntwineAbilityModes,
  applyEntwine,
  validateEntwineSelection,
  createCipherRegistry,
  getValidCipherTargets,
  createCipherEncodingChoice,
  validateCipherEncodingTarget,
  encodeSpellOntoCreature,
  getEncodedSpells,
  removeEncodedSpells,
  checkCipherTriggers,
  createCipherCastEvent,
  getValidNinjutsuTargets,
  canActivateNinjutsu,
  createNinjutsuActivationChoice,
  validateNinjutsuTarget,
  processNinjutsuActivation,
};
