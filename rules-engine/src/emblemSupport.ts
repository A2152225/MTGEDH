/**
 * emblemSupport.ts
 * 
 * Comprehensive emblem creation and management system.
 * Emblems are objects in the command zone with abilities.
 * 
 * Rules Reference:
 * - Rule 114: Emblems
 * - Rule 114.1: Some effects create emblems
 * - Rule 114.2: Emblems have no characteristics other than abilities
 * - Rule 114.3: Emblems function in the command zone
 * - Rule 114.4: Emblems can't be affected by anything
 * - Rule 114.5: Emblems are controlled by the player who put them there
 */

import type { PlayerID } from '../../shared/src';

/**
 * Emblem object
 */
export interface Emblem {
  readonly id: string;
  readonly name: string;
  readonly owner: PlayerID;
  readonly controller: PlayerID;
  readonly abilities: readonly string[];
  readonly createdBy?: string; // Name of the planeswalker/source that created this
  readonly sourceId?: string; // ID of the source permanent
  readonly timestamp: number;
  readonly isTriggeredAbility?: boolean;
  readonly isStaticAbility?: boolean;
}

/**
 * Emblem creation specification
 */
export interface EmblemSpec {
  readonly name: string;
  readonly abilities: readonly string[];
  readonly createdBy?: string;
  readonly sourceId?: string;
}

/**
 * Result of emblem creation
 */
export interface EmblemCreationResult {
  readonly emblem: Emblem;
  readonly log: readonly string[];
}

/**
 * Generate a unique emblem ID
 */
function generateEmblemId(): string {
  return `emblem-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create an emblem for a player
 * 
 * Rule 114.1: Some effects put emblems into the command zone.
 * Rule 114.5: An emblem is controlled by the player who put it in the command zone.
 */
export function createEmblem(
  owner: PlayerID,
  spec: EmblemSpec
): EmblemCreationResult {
  const emblem: Emblem = {
    id: generateEmblemId(),
    name: spec.name,
    owner,
    controller: owner,
    abilities: spec.abilities,
    createdBy: spec.createdBy,
    sourceId: spec.sourceId,
    timestamp: Date.now(),
  };
  
  const creatorText = spec.createdBy ? ` from ${spec.createdBy}` : '';
  
  return {
    emblem,
    log: [`${owner} gets an emblem${creatorText}: "${spec.name}"`],
  };
}

/**
 * Common planeswalker emblems
 */
export const COMMON_EMBLEMS: Record<string, EmblemSpec> = {
  // Elspeth, Knight-Errant
  'Elspeth, Knight-Errant': {
    name: "Elspeth's Emblem",
    abilities: ['Artifacts, creatures, enchantments, and lands you control have indestructible.'],
    createdBy: 'Elspeth, Knight-Errant',
  },
  
  // Sorin, Lord of Innistrad
  'Sorin, Lord of Innistrad': {
    name: "Sorin's Emblem",
    abilities: ['Creatures you control get +1/+0.'],
    createdBy: 'Sorin, Lord of Innistrad',
  },
  
  // Venser, the Sojourner
  'Venser, the Sojourner': {
    name: "Venser's Emblem",
    abilities: ['Whenever you cast a spell, exile target permanent.'],
    createdBy: 'Venser, the Sojourner',
  },
  
  // Tamiyo, the Moon Sage
  'Tamiyo, the Moon Sage': {
    name: "Tamiyo's Emblem",
    abilities: ['You have no maximum hand size.', 'Whenever a card is put into your graveyard from anywhere, you may return it to your hand.'],
    createdBy: 'Tamiyo, the Moon Sage',
  },
  
  // Liliana of the Dark Realms
  'Liliana of the Dark Realms': {
    name: "Liliana's Emblem",
    abilities: ['Swamps you control have "{T}: Add {B}{B}{B}{B}."'],
    createdBy: 'Liliana of the Dark Realms',
  },
  
  // Jace, Unraveler of Secrets
  'Jace, Unraveler of Secrets': {
    name: "Jace's Emblem",
    abilities: ['Whenever an opponent casts their first spell each turn, counter that spell.'],
    createdBy: 'Jace, Unraveler of Secrets',
  },
  
  // Chandra, Torch of Defiance
  'Chandra, Torch of Defiance': {
    name: "Chandra's Emblem",
    abilities: ['Whenever you cast a spell, this emblem deals 5 damage to any target.'],
    createdBy: 'Chandra, Torch of Defiance',
  },
  
  // Nissa, Vital Force
  'Nissa, Vital Force': {
    name: "Nissa's Emblem",
    abilities: ['Whenever a land enters the battlefield under your control, you may draw a card.'],
    createdBy: 'Nissa, Vital Force',
  },
  
  // Ob Nixilis Reignited
  'Ob Nixilis Reignited': {
    name: "Ob Nixilis's Emblem",
    abilities: ['Whenever a player draws a card, you may have that player lose 2 life.'],
    createdBy: 'Ob Nixilis Reignited',
  },
  
  // Kiora, the Crashing Wave
  'Kiora, the Crashing Wave': {
    name: "Kiora's Emblem",
    abilities: ['At the beginning of your end step, create a 9/9 blue Kraken creature token.'],
    createdBy: 'Kiora, the Crashing Wave',
  },
  
  // Ajani, Mentor of Heroes
  'Ajani, Mentor of Heroes': {
    name: "Ajani's Emblem",
    abilities: ['You gain 100 life.'],
    createdBy: 'Ajani, Mentor of Heroes',
  },
  
  // Narset Transcendent
  'Narset Transcendent': {
    name: "Narset's Emblem",
    abilities: ['Your opponents can\'t cast noncreature spells.'],
    createdBy: 'Narset Transcendent',
  },
  
  // Kaya the Inexorable
  'Kaya the Inexorable': {
    name: "Kaya's Emblem",
    abilities: ['At the beginning of your upkeep, you may cast a legendary spell from your hand, graveyard, or from among cards you own in exile without paying its mana cost.'],
    createdBy: 'Kaya the Inexorable',
  },
  
  // Teferi, Hero of Dominaria
  'Teferi, Hero of Dominaria': {
    name: "Teferi's Emblem",
    abilities: ['Whenever you draw a card, exile target permanent an opponent controls.'],
    createdBy: 'Teferi, Hero of Dominaria',
  },
  
  // Gideon of the Trials
  'Gideon of the Trials': {
    name: "Gideon's Emblem",
    abilities: ['As long as you control a Gideon planeswalker, you can\'t lose the game and your opponents can\'t win the game.'],
    createdBy: 'Gideon of the Trials',
  },
  
  // The Ring (Lord of the Rings set)
  'The Ring': {
    name: 'The Ring',
    abilities: [
      'Your Ring-bearer is legendary and can\'t be blocked by creatures with greater power.',
      'Whenever your Ring-bearer attacks, draw a card, then discard a card.',
      'Whenever your Ring-bearer becomes blocked by a creature, that creature\'s controller sacrifices it at end of combat.',
      'Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.',
    ],
    createdBy: 'The Ring',
  },
};

/**
 * Create an emblem from a known planeswalker
 */
export function createEmblemFromPlaneswalker(
  owner: PlayerID,
  planeswalkerName: string
): EmblemCreationResult | null {
  const spec = COMMON_EMBLEMS[planeswalkerName];
  if (!spec) {
    return null;
  }
  return createEmblem(owner, spec);
}

/**
 * Create a custom emblem with specified abilities
 */
export function createCustomEmblem(
  owner: PlayerID,
  name: string,
  abilities: string[],
  createdBy?: string,
  sourceId?: string
): EmblemCreationResult {
  return createEmblem(owner, {
    name,
    abilities,
    createdBy,
    sourceId,
  });
}

/**
 * Check if an emblem has a specific ability text (partial match)
 */
export function emblemHasAbility(emblem: Emblem, abilityText: string): boolean {
  const lowerText = abilityText.toLowerCase();
  return emblem.abilities.some(ability => 
    ability.toLowerCase().includes(lowerText)
  );
}

/**
 * Check if an emblem is a triggered ability
 * Triggered abilities contain "when", "whenever", or "at"
 */
export function isTriggeredEmblem(emblem: Emblem): boolean {
  return emblem.abilities.some(ability => {
    const lower = ability.toLowerCase();
    return lower.startsWith('when') || 
           lower.startsWith('whenever') || 
           lower.startsWith('at ');
  });
}

/**
 * Check if an emblem is a static ability
 * Static abilities don't use the stack
 */
export function isStaticEmblem(emblem: Emblem): boolean {
  return !isTriggeredEmblem(emblem);
}

/**
 * Get all emblems controlled by a player from a collection
 */
export function getPlayerEmblems(
  emblems: readonly Emblem[],
  playerId: PlayerID
): readonly Emblem[] {
  return emblems.filter(e => e.controller === playerId);
}

/**
 * Parse emblem ability to determine its type
 */
export interface EmblemAbilityInfo {
  readonly isTriggered: boolean;
  readonly isStatic: boolean;
  readonly triggerCondition?: string;
  readonly effect: string;
}

export function parseEmblemAbility(abilityText: string): EmblemAbilityInfo {
  const lower = abilityText.toLowerCase();
  
  // Check for triggered ability patterns
  const triggerPatterns = [
    /^whenever (.+?),\s*(.+)$/i,
    /^when (.+?),\s*(.+)$/i,
    /^at (.+?),\s*(.+)$/i,
  ];
  
  for (const pattern of triggerPatterns) {
    const match = abilityText.match(pattern);
    if (match) {
      return {
        isTriggered: true,
        isStatic: false,
        triggerCondition: match[1],
        effect: match[2],
      };
    }
  }
  
  // It's a static ability
  return {
    isTriggered: false,
    isStatic: true,
    effect: abilityText,
  };
}

/**
 * Get available emblem names (for UI dropdown)
 */
export function getAvailableEmblemNames(): readonly string[] {
  return Object.keys(COMMON_EMBLEMS);
}

/**
 * Get emblem spec by name
 */
export function getEmblemSpec(name: string): EmblemSpec | undefined {
  return COMMON_EMBLEMS[name];
}

export default {
  createEmblem,
  createEmblemFromPlaneswalker,
  createCustomEmblem,
  emblemHasAbility,
  isTriggeredEmblem,
  isStaticEmblem,
  getPlayerEmblems,
  parseEmblemAbility,
  getAvailableEmblemNames,
  getEmblemSpec,
  COMMON_EMBLEMS,
};
