/**
 * CommanderDeckValidator.ts
 * 
 * Validation utilities for Commander/EDH deck building rules:
 * - 100 card requirement (99 + commander or 98 + partner commanders)
 * - Singleton rule (one of each card except basic lands)
 * - Color identity validation
 * - Commander eligibility checks
 */

import type { KnownCardRef } from '../../../shared/src';

/**
 * MTG Colors
 */
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G';

/**
 * Result of deck validation
 */
export interface DeckValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  cardCount: number;
  commanderCount: number;
  colorIdentity: ManaColor[];
}

/**
 * Validation error (deck is illegal)
 */
export interface ValidationError {
  type: 'card_count' | 'singleton' | 'color_identity' | 'commander_invalid' | 'banned';
  message: string;
  cards?: string[];
}

/**
 * Validation warning (deck is legal but may have issues)
 */
export interface ValidationWarning {
  type: 'missing_commander' | 'suboptimal' | 'other';
  message: string;
  cards?: string[];
}

/**
 * Card with additional info for validation
 */
interface CardWithInfo extends KnownCardRef {
  mana_cost?: string;
  color_identity?: ManaColor[];
  oracle_text?: string;
}

/**
 * Parse mana cost string to extract colors
 */
export function parseManaCostColors(manaCost?: string): ManaColor[] {
  if (!manaCost) return [];
  const colors: Set<ManaColor> = new Set();
  
  // Match color symbols: {W}, {U}, {B}, {R}, {G} and hybrid like {W/U}
  const matches = manaCost.matchAll(/\{([WUBRG])(?:\/[WUBRG])?\}/gi);
  for (const match of matches) {
    const color = match[1].toUpperCase() as ManaColor;
    if (['W', 'U', 'B', 'R', 'G'].includes(color)) {
      colors.add(color);
    }
    // Handle hybrid mana
    if (match[0].includes('/')) {
      const hybridMatch = match[0].match(/\{([WUBRG])\/([WUBRG])\}/i);
      if (hybridMatch) {
        colors.add(hybridMatch[1].toUpperCase() as ManaColor);
        colors.add(hybridMatch[2].toUpperCase() as ManaColor);
      }
    }
  }
  
  return Array.from(colors);
}

/**
 * Parse oracle text for color identity (mana symbols in text)
 */
export function parseOracleTextColors(oracleText?: string): ManaColor[] {
  if (!oracleText) return [];
  const colors: Set<ManaColor> = new Set();
  
  // Match mana symbols in oracle text
  const matches = oracleText.matchAll(/\{([WUBRG])(?:\/[WUBRG])?\}/gi);
  for (const match of matches) {
    const color = match[1].toUpperCase() as ManaColor;
    if (['W', 'U', 'B', 'R', 'G'].includes(color)) {
      colors.add(color);
    }
  }
  
  return Array.from(colors);
}

/**
 * Calculate color identity for a card
 * Color identity includes:
 * - Colors in mana cost
 * - Color indicators
 * - Mana symbols in rules text
 */
export function getCardColorIdentity(card: CardWithInfo): ManaColor[] {
  // If the card already has color_identity from Scryfall, use it
  if (card.color_identity && Array.isArray(card.color_identity)) {
    return card.color_identity;
  }
  
  const colors: Set<ManaColor> = new Set();
  
  // Colors from mana cost
  const manaCostColors = parseManaCostColors(card.mana_cost);
  manaCostColors.forEach(c => colors.add(c));
  
  // Colors from oracle text
  const oracleColors = parseOracleTextColors(card.oracle_text);
  oracleColors.forEach(c => colors.add(c));
  
  return Array.from(colors);
}

/**
 * Check if a card is a basic land
 * Basic land type line format: "Basic Land — Forest" or "Basic Snow Land — Island"
 */
export function isBasicLand(card: CardWithInfo): boolean {
  const typeLine = (card.type_line || '').toLowerCase();
  // Must have "basic" as a supertype (before the em dash) and "land" as a type
  // This avoids matching cards with "basic" in ability text like "Basic Landcycling"
  return /\bbasic\b.*\bland\b/i.test(typeLine);
}

/**
 * Check if a card can be a commander
 * - Legendary Creature
 * - Card with "can be your commander" text
 * - Planeswalker with commander ability
 */
export function canBeCommander(card: CardWithInfo): boolean {
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Legendary Creature
  if (typeLine.includes('legendary') && typeLine.includes('creature')) {
    return true;
  }
  
  // Cards that explicitly say they can be commander
  if (oracleText.includes('can be your commander')) {
    return true;
  }
  
  // Planeswalkers with commander ability
  if (typeLine.includes('planeswalker') && oracleText.includes('can be your commander')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card has generic Partner ability (can partner with any Partner)
 * Note: "Partner with [Name]" is a DIFFERENT ability - those cards can only partner
 * with their specific named partner
 */
export function hasPartner(card: CardWithInfo): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  // Match "Partner" but NOT "Partner with [something]"
  // Generic Partner appears as standalone "Partner" keyword
  return /\bpartner\b(?!\s+with\b)/i.test(oracleText);
}

/**
 * Check if a card has "Partner with [Name]" ability
 * These can only partner with their specific named partner
 */
export function hasPartnerWith(card: CardWithInfo): string | null {
  const oracleText = (card.oracle_text || '');
  const match = oracleText.match(/Partner with ([^(.\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Check if a card is a Background
 */
export function isBackground(card: CardWithInfo): boolean {
  const typeLine = (card.type_line || '').toLowerCase();
  return typeLine.includes('background');
}

/**
 * Check if a card has "Choose a Background"
 */
export function hasChooseABackground(card: CardWithInfo): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  return oracleText.includes('choose a background');
}

/**
 * Check if a card's color identity is within the commander's color identity
 */
export function isWithinColorIdentity(
  cardColors: ManaColor[],
  commanderColors: ManaColor[]
): boolean {
  // Colorless cards (no color identity) are always legal
  if (cardColors.length === 0) return true;
  
  // Check each color in the card's identity
  for (const color of cardColors) {
    if (!commanderColors.includes(color)) {
      return false;
    }
  }
  return true;
}

/**
 * Validate a Commander deck
 */
export function validateCommanderDeck(
  cards: CardWithInfo[],
  commanders: CardWithInfo[]
): DeckValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  
  // Calculate commander color identity
  const commanderColors: Set<ManaColor> = new Set();
  for (const commander of commanders) {
    const colors = getCardColorIdentity(commander);
    colors.forEach(c => commanderColors.add(c));
  }
  const colorIdentity = Array.from(commanderColors);
  
  // Check commander count and validity
  const commanderCount = commanders.length;
  
  if (commanderCount === 0) {
    warnings.push({
      type: 'missing_commander',
      message: 'No commander selected. You need to choose a commander.',
    });
  } else if (commanderCount > 2) {
    errors.push({
      type: 'commander_invalid',
      message: `Too many commanders (${commanderCount}). Maximum is 2 with Partner.`,
      cards: commanders.map(c => c.name),
    });
  } else if (commanderCount === 2) {
    // Validate partner compatibility
    const [cmd1, cmd2] = commanders;
    const cmd1HasPartner = hasPartner(cmd1);
    const cmd2HasPartner = hasPartner(cmd2);
    const cmd1PartnerWith = hasPartnerWith(cmd1);
    const cmd2PartnerWith = hasPartnerWith(cmd2);
    const cmd1HasBackground = hasChooseABackground(cmd1);
    const cmd2IsBackground = isBackground(cmd2);
    const cmd2HasBackground = hasChooseABackground(cmd2);
    const cmd1IsBackground = isBackground(cmd1);
    
    // Valid pairings:
    // 1. Both have generic Partner
    // 2. One has "Partner with [Name]" that matches the other's name
    // 3. One has "Choose a Background" and the other is a Background
    const genericPartnerPair = cmd1HasPartner && cmd2HasPartner;
    const partnerWithPair = 
      (cmd1PartnerWith && cmd1PartnerWith.toLowerCase() === cmd2.name.toLowerCase()) ||
      (cmd2PartnerWith && cmd2PartnerWith.toLowerCase() === cmd1.name.toLowerCase());
    const backgroundPair = 
      (cmd1HasBackground && cmd2IsBackground) ||
      (cmd2HasBackground && cmd1IsBackground);
    
    const validPartners = genericPartnerPair || partnerWithPair || backgroundPair;
    
    if (!validPartners) {
      errors.push({
        type: 'commander_invalid',
        message: 'Both commanders must have Partner, or one must have "Choose a Background" and the other must be a Background.',
        cards: commanders.map(c => c.name),
      });
    }
  }
  
  // Validate each commander is eligible
  for (const commander of commanders) {
    if (!canBeCommander(commander) && !isBackground(commander)) {
      errors.push({
        type: 'commander_invalid',
        message: `"${commander.name}" cannot be a commander.`,
        cards: [commander.name],
      });
    }
  }
  
  // Check total card count (99 cards + 1 commander, or 98 + 2 partners)
  const expectedCards = 100 - commanderCount;
  const totalCards = cards.length;
  
  if (totalCards !== expectedCards && commanderCount > 0) {
    errors.push({
      type: 'card_count',
      message: `Deck has ${totalCards} cards. Expected ${expectedCards} (plus ${commanderCount} commander${commanderCount > 1 ? 's' : ''} = 100 total).`,
    });
  } else if (totalCards !== 99 && commanderCount === 0) {
    // If no commander selected yet, expect 99 or 100 cards
    if (totalCards !== 100) {
      warnings.push({
        type: 'other',
        message: `Deck has ${totalCards} cards. Expected 99-100 cards.`,
      });
    }
  }
  
  // Check singleton rule
  const cardCounts = new Map<string, number>();
  for (const card of cards) {
    const name = card.name;
    cardCounts.set(name, (cardCounts.get(name) || 0) + 1);
  }
  
  const duplicates: string[] = [];
  for (const [name, count] of cardCounts) {
    if (count > 1) {
      const card = cards.find(c => c.name === name);
      if (card && !isBasicLand(card)) {
        duplicates.push(`${name} (${count} copies)`);
      }
    }
  }
  
  if (duplicates.length > 0) {
    errors.push({
      type: 'singleton',
      message: 'Commander decks can only have one copy of each card (except basic lands).',
      cards: duplicates,
    });
  }
  
  // Check color identity
  if (commanderCount > 0) {
    const colorViolations: string[] = [];
    for (const card of cards) {
      const cardColors = getCardColorIdentity(card);
      if (!isWithinColorIdentity(cardColors, colorIdentity)) {
        colorViolations.push(card.name);
      }
    }
    
    if (colorViolations.length > 0) {
      errors.push({
        type: 'color_identity',
        message: `${colorViolations.length} card(s) have colors outside your commander's color identity (${colorIdentity.join('') || 'colorless'}).`,
        cards: colorViolations,
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cardCount: totalCards + commanderCount,
    commanderCount,
    colorIdentity,
  };
}

/**
 * Format color identity for display
 */
export function formatColorIdentity(colors: ManaColor[]): string {
  if (colors.length === 0) return 'Colorless';
  
  const colorNames: Record<ManaColor, string> = {
    W: 'White',
    U: 'Blue',
    B: 'Black',
    R: 'Red',
    G: 'Green',
  };
  
  // Sort colors in WUBRG order
  const order: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
  const sorted = colors.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  
  return sorted.map(c => colorNames[c]).join(', ');
}

/**
 * Get color emoji symbols
 */
export function getColorEmojis(colors: ManaColor[]): string {
  const colorEmojis: Record<ManaColor, string> = {
    W: '⚪',
    U: '🔵',
    B: '⚫',
    R: '🔴',
    G: '🟢',
  };
  
  if (colors.length === 0) return '⬜';
  
  const order: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
  const sorted = colors.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  
  return sorted.map(c => colorEmojis[c]).join('');
}
