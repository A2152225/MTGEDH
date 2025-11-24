/**
 * Rule 709: Split Cards
 * 
 * Implements the rules for split cards, including casting, characteristics,
 * fuse, and Room cards with unlock mechanics.
 * 
 * Reference: MagicCompRules 20251114.txt, Rule 709
 */

/**
 * Represents a half of a split card.
 */
export interface SplitCardHalf {
  readonly name: string;
  readonly manaCost: string;
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly text: string;
  readonly power: number | null;
  readonly toughness: number | null;
  readonly loyalty: number | null;
  readonly colors: readonly string[];
}

/**
 * Represents a split card.
 * 
 * Rule 709.1: Split cards have two card faces on a single card.
 */
export interface SplitCard {
  readonly type: 'split-card';
  readonly leftHalf: SplitCardHalf;
  readonly rightHalf: SplitCardHalf;
  readonly hasSharedTypeLine: boolean; // For Room cards (Rule 709.5)
  readonly sharedTypes?: readonly string[];
  readonly sharedSubtypes?: readonly string[];
}

/**
 * Represents a split card spell on the stack.
 * 
 * Rule 709.3: A player chooses which half to cast before putting it onto the stack.
 */
export interface SplitCardSpell {
  readonly splitCardId: string;
  readonly chosenHalf: 'left' | 'right';
  readonly isFused: boolean; // For fuse mechanic (Rule 702.102)
  readonly characteristics: SplitCardHalf | CombinedCharacteristics;
}

/**
 * Combined characteristics of both halves (Rule 709.4).
 */
export interface CombinedCharacteristics {
  readonly names: readonly [string, string];
  readonly combinedManaCost: string;
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
  readonly supertypes: readonly string[];
  readonly text: string;
  readonly colors: readonly string[];
  readonly manaValue: number;
}

/**
 * Unlocked designations for Room cards (Rule 709.5c).
 */
export type UnlockedDesignation = 'left-half-unlocked' | 'right-half-unlocked';

/**
 * Represents a Room permanent (split card with shared type line).
 */
export interface RoomPermanent {
  readonly id: string;
  readonly splitCard: SplitCard;
  readonly unlockedDesignations: readonly UnlockedDesignation[];
  readonly controller: string;
}

/**
 * Gets the combined characteristics of a split card (Rule 709.4).
 * 
 * In every zone except the stack, characteristics are combined.
 */
export function getCombinedCharacteristics(splitCard: SplitCard): CombinedCharacteristics {
  const { leftHalf, rightHalf } = splitCard;
  
  // Combine mana costs
  const combinedManaCost = combineManaCosts(leftHalf.manaCost, rightHalf.manaCost);
  
  // Combine types
  const types = [...new Set([...leftHalf.types, ...rightHalf.types])];
  const subtypes = [...new Set([...leftHalf.subtypes, ...rightHalf.subtypes])];
  const supertypes = [...new Set([...leftHalf.supertypes, ...rightHalf.supertypes])];
  
  // Combine colors
  const colors = [...new Set([...leftHalf.colors, ...rightHalf.colors])];
  
  // Calculate mana value from combined cost
  const manaValue = calculateManaValue(combinedManaCost);
  
  return {
    names: [leftHalf.name, rightHalf.name],
    combinedManaCost,
    types,
    subtypes,
    supertypes,
    text: `${leftHalf.text}\n//\n${rightHalf.text}`,
    colors,
    manaValue,
  };
}

/**
 * Combines two mana costs into a single combined cost (Rule 709.4b).
 */
function combineManaCosts(cost1: string, cost2: string): string {
  // Simple implementation - would need proper mana symbol parsing
  return `${cost1}${cost2}`;
}

/**
 * Calculates mana value from a mana cost string.
 */
function calculateManaValue(manaCost: string): number {
  // Simplified - would need proper implementation
  let value = 0;
  // Count each mana symbol
  // This is a placeholder
  return value;
}

/**
 * Chooses which half of a split card to cast (Rule 709.3).
 */
export function chooseHalfToCast(
  splitCard: SplitCard,
  half: 'left' | 'right'
): SplitCardSpell {
  const chosenHalf = half === 'left' ? splitCard.leftHalf : splitCard.rightHalf;
  
  return {
    splitCardId: `${splitCard.leftHalf.name}//${splitCard.rightHalf.name}`,
    chosenHalf: half,
    isFused: false,
    characteristics: chosenHalf,
  };
}

/**
 * Casts a split card with fuse (Rule 709.4d, Rule 702.102).
 * 
 * Fused spell has characteristics of both halves combined.
 */
export function castWithFuse(splitCard: SplitCard): SplitCardSpell {
  const combined = getCombinedCharacteristics(splitCard);
  
  return {
    splitCardId: `${splitCard.leftHalf.name}//${splitCard.rightHalf.name}`,
    chosenHalf: 'left', // Both halves are cast
    isFused: true,
    characteristics: combined,
  };
}

/**
 * Gets the characteristics of a split card spell on the stack (Rule 709.3b).
 * 
 * While on the stack, only the chosen half exists (unless fused).
 */
export function getSpellCharacteristics(spell: SplitCardSpell): SplitCardHalf | CombinedCharacteristics {
  return spell.characteristics;
}

/**
 * Checks if a split card matches a chosen name (Rule 709.4a).
 * 
 * An object has the chosen name if one of its names is the chosen name.
 */
export function splitCardMatchesName(splitCard: SplitCard, chosenName: string): boolean {
  return splitCard.leftHalf.name === chosenName || splitCard.rightHalf.name === chosenName;
}

/**
 * Creates a Room permanent entering the battlefield (Rule 709.5d).
 * 
 * Gets unlocked designation based on which half was cast.
 */
export function createRoomPermanent(
  id: string,
  splitCard: SplitCard,
  controller: string,
  castHalf: 'left' | 'right' | null
): RoomPermanent {
  const unlockedDesignations: UnlockedDesignation[] = [];
  
  if (castHalf === 'left') {
    unlockedDesignations.push('left-half-unlocked');
  } else if (castHalf === 'right') {
    unlockedDesignations.push('right-half-unlocked');
  }
  // If entering without being cast, no unlocked designations
  
  return {
    id,
    splitCard,
    unlockedDesignations,
    controller,
  };
}

/**
 * Checks if a half is unlocked (Rule 709.5c).
 */
export function isHalfUnlocked(
  room: RoomPermanent,
  half: 'left' | 'right'
): boolean {
  const designation: UnlockedDesignation = 
    half === 'left' ? 'left-half-unlocked' : 'right-half-unlocked';
  return room.unlockedDesignations.includes(designation);
}

/**
 * Checks if a half is locked.
 */
export function isHalfLocked(
  room: RoomPermanent,
  half: 'left' | 'right'
): boolean {
  return !isHalfUnlocked(room, half);
}

/**
 * Pays unlock cost to unlock a half (Rule 709.5e).
 * 
 * This is a special action that can be taken during a main phase
 * with priority and empty stack.
 */
export function unlockHalf(
  room: RoomPermanent,
  half: 'left' | 'right'
): RoomPermanent {
  if (isHalfUnlocked(room, half)) {
    return room; // Already unlocked
  }
  
  const designation: UnlockedDesignation = 
    half === 'left' ? 'left-half-unlocked' : 'right-half-unlocked';
  
  return {
    ...room,
    unlockedDesignations: [...room.unlockedDesignations, designation],
  };
}

/**
 * Unlocks a half of a permanent (Rule 709.5f).
 * 
 * Effect-based unlocking (not paying unlock cost).
 */
export function unlockHalfByEffect(
  room: RoomPermanent,
  half: 'left' | 'right'
): RoomPermanent {
  return unlockHalf(room, half);
}

/**
 * Locks a half of a permanent (Rule 709.5g).
 */
export function lockHalf(
  room: RoomPermanent,
  half: 'left' | 'right'
): RoomPermanent {
  if (isHalfLocked(room, half)) {
    return room; // Already locked
  }
  
  const designation: UnlockedDesignation = 
    half === 'left' ? 'left-half-unlocked' : 'right-half-unlocked';
  
  return {
    ...room,
    unlockedDesignations: room.unlockedDesignations.filter(d => d !== designation),
  };
}

/**
 * Checks if a Room was just fully unlocked (Rule 709.5i).
 * 
 * Triggers when:
 * - Had one unlocked designation and gained the other
 * - Had neither and gained both
 */
export function wasFullyUnlocked(
  previousRoom: RoomPermanent,
  currentRoom: RoomPermanent
): boolean {
  const prevCount = previousRoom.unlockedDesignations.length;
  const currCount = currentRoom.unlockedDesignations.length;
  
  // Fully unlocked means both designations
  const isFullyUnlocked = currCount === 2;
  const wasNotFullyUnlocked = prevCount < 2;
  
  return isFullyUnlocked && wasNotFullyUnlocked;
}

/**
 * Gets the active characteristics of a Room permanent (Rule 709.5).
 * 
 * A Room only has name, mana cost, and rules text of unlocked halves.
 */
export function getRoomCharacteristics(room: RoomPermanent): Partial<CombinedCharacteristics> {
  const leftUnlocked = isHalfUnlocked(room, 'left');
  const rightUnlocked = isHalfUnlocked(room, 'right');
  
  const names: string[] = [];
  const manaCosts: string[] = [];
  const texts: string[] = [];
  
  if (leftUnlocked) {
    names.push(room.splitCard.leftHalf.name);
    manaCosts.push(room.splitCard.leftHalf.manaCost);
    texts.push(room.splitCard.leftHalf.text);
  }
  
  if (rightUnlocked) {
    names.push(room.splitCard.rightHalf.name);
    manaCosts.push(room.splitCard.rightHalf.manaCost);
    texts.push(room.splitCard.rightHalf.text);
  }
  
  // Shared types are always active
  const types = room.splitCard.sharedTypes || [];
  const subtypes = room.splitCard.sharedSubtypes || [];
  
  return {
    names: names.length > 0 ? [names[0], names[1]] : undefined,
    types,
    subtypes,
    text: texts.join('\n'),
  };
}
