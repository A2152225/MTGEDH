/**
 * Rules 713-719: Remaining Card Types
 * Implementation of substitute cards, Saga cards, Adventurer cards, Class cards,
 * Attraction cards, Prototype cards, and Case cards
 * Reference: Magic: The Gathering Comprehensive Rules (20251114)
 */

// ============================================================================
// Rule 713: Substitute Cards
// ============================================================================

/**
 * Rule 713.1: A substitute card is a game supplement that can be used to
 * represent a double-faced card or meld card
 */
export interface SubstituteCard {
  readonly type: 'substitute';
  readonly representsCard: string; // Name of the card it represents
  readonly frontFaceName: string;
  readonly backFaceName?: string; // For DFCs
  readonly additionalInfo?: {
    readonly cardType?: string;
    readonly manaCost?: string;
    readonly powerToughness?: string;
  };
  readonly style: 'legacy' | 'bolas' | 'modal-dfc'; // Rule 713.2a-c
}

/**
 * Rule 713.3: Set aside the actual card before the game
 */
export function useSubstituteCard(substitute: SubstituteCard, actualCard: string): {
  readonly substitute: SubstituteCard;
  readonly setAsideCard: string;
} {
  return {
    substitute,
    setAsideCard: actualCard,
  };
}

/**
 * Rule 713.4: For all game purposes, the substitute card is considered to be
 * the card it's representing
 */
export function getRepresentedCard(substitute: SubstituteCard): string {
  return substitute.representsCard;
}

/**
 * Rule 713.5: If substitute card is face up in public zone, use actual card
 */
export function shouldReplaceSubstituteWithActual(
  substitute: SubstituteCard,
  zone: string,
  isFaceUp: boolean
): boolean {
  const publicZones = ['battlefield', 'graveyard', 'stack', 'exile'];
  return publicZones.includes(zone) && isFaceUp;
}

// ============================================================================
// Rule 714: Saga Cards
// ============================================================================

/**
 * Rule 714.1: Saga cards have striated text box with chapter symbols
 */
export interface SagaCard {
  readonly type: 'saga';
  readonly source: string;
  readonly chapterAbilities: readonly ChapterAbility[];
  readonly loreCounters: number;
  readonly hasReadAhead: boolean; // Rule 714.3a
  readonly additionalAbilities?: readonly string[]; // Rule 714.1a - for creature Sagas
}

/**
 * Rule 714.2: Chapter symbol is a keyword ability representing a triggered ability
 */
export interface ChapterAbility {
  readonly chapterNumbers: readonly number[]; // Rule 714.2c - can trigger on multiple chapters
  readonly effect: string;
}

/**
 * Rule 714.2d: Final chapter number is greatest value among chapter abilities
 */
export function getFinalChapterNumber(saga: SagaCard): number {
  if (saga.chapterAbilities.length === 0) {
    return 0;
  }
  
  const allChapterNumbers = saga.chapterAbilities.flatMap(ability => ability.chapterNumbers);
  return Math.max(...allChapterNumbers);
}

/**
 * Rule 714.2e: Final chapter ability
 */
export function getFinalChapterAbility(saga: SagaCard): ChapterAbility | null {
  const finalNumber = getFinalChapterNumber(saga);
  if (finalNumber === 0) {
    return null;
  }
  
  return saga.chapterAbilities.find(ability => 
    ability.chapterNumbers.includes(finalNumber)
  ) || null;
}

/**
 * Rule 714.3a: As Saga enters battlefield, put lore counter on it
 * (or chosen number if it has read ahead)
 */
export function putSagaOntoBattlefield(
  saga: SagaCard,
  chosenChapter?: number
): SagaCard {
  if (saga.hasReadAhead && chosenChapter !== undefined) {
    const finalChapter = getFinalChapterNumber(saga);
    const validChapter = Math.min(Math.max(1, chosenChapter), finalChapter);
    return { ...saga, loreCounters: validChapter };
  }
  
  return { ...saga, loreCounters: 1 };
}

/**
 * Rule 714.3b: At precombat main phase, put lore counter on each Saga
 * (turn-based action)
 */
export function addLoreCounterToSaga(saga: SagaCard): SagaCard {
  if (saga.chapterAbilities.length === 0) {
    return saga; // Don't add if no chapter abilities
  }
  return { ...saga, loreCounters: saga.loreCounters + 1 };
}

/**
 * Rule 714.2b: Check if chapter ability triggers
 * Triggers when lore counters were less than N and became at least N
 */
export function checkChapterTriggers(
  previousCounters: number,
  newCounters: number,
  chapterNumber: number
): boolean {
  return previousCounters < chapterNumber && newCounters >= chapterNumber;
}

/**
 * Rule 714.4: State-based action - sacrifice Saga if counters >= final chapter
 */
export function shouldSacrificeSaga(
  saga: SagaCard,
  chapterAbilityOnStack: boolean
): boolean {
  const finalChapter = getFinalChapterNumber(saga);
  if (finalChapter === 0) {
    return false;
  }
  
  return saga.loreCounters >= finalChapter && !chapterAbilityOnStack;
}

// ============================================================================
// Rule 715: Adventurer Cards
// ============================================================================

/**
 * Rule 715.1: Adventurer cards have two-part frame with inset frame
 */
export interface AdventurerCard {
  readonly type: 'adventurer';
  readonly normalCharacteristics: CardCharacteristics;
  readonly adventureCharacteristics: CardCharacteristics;
  readonly isAdventure: boolean; // Currently cast/on stack as Adventure
  readonly isExiledFromAdventure: boolean; // Rule 715.3d
}

interface CardCharacteristics {
  readonly name: string;
  readonly manaCost: string;
  readonly types: readonly string[];
  readonly text: string;
  readonly power?: number;
  readonly toughness?: number;
}

/**
 * Rule 715.2b: Alternative characteristics are copiable values
 */
export function hasAdventure(card: AdventurerCard): boolean {
  return true; // All adventurer cards have an Adventure
}

/**
 * Rule 715.3: Choose whether to play normally or as Adventure
 */
export function castAsAdventure(card: AdventurerCard): AdventurerCard {
  return { ...card, isAdventure: true };
}

export function castNormally(card: AdventurerCard): AdventurerCard {
  return { ...card, isAdventure: false };
}

/**
 * Rule 715.3a-b: While on stack as Adventure, has only alternative characteristics
 */
export function getAdventurerCardCharacteristics(
  card: AdventurerCard,
  zone: string
): CardCharacteristics {
  // Rule 715.4: Everywhere except stack (or stack not as Adventure), use normal
  if (zone !== 'stack' || !card.isAdventure) {
    return card.normalCharacteristics;
  }
  
  // Rule 715.3b: On stack as Adventure, use alternative characteristics
  return card.adventureCharacteristics;
}

/**
 * Rule 715.3c: Copy of Adventure spell is also an Adventure
 */
export function copyAdventureSpell(card: AdventurerCard): AdventurerCard {
  if (!card.isAdventure) {
    return card;
  }
  
  return {
    ...card,
    isAdventure: true,
  };
}

/**
 * Rule 715.3d: Instead of going to graveyard, exile it and can cast later
 * (but not as Adventure)
 */
export function resolveAdventureSpell(card: AdventurerCard): AdventurerCard {
  if (!card.isAdventure) {
    return card;
  }
  
  return {
    ...card,
    isAdventure: false,
    isExiledFromAdventure: true,
  };
}

export function canCastExiledAdventureCard(card: AdventurerCard): boolean {
  return card.isExiledFromAdventure;
}

// ============================================================================
// Rule 716: Class Cards
// ============================================================================

/**
 * Rule 716.1: Class cards have striated text box with class level bars
 */
export interface ClassCard {
  readonly type: 'class';
  readonly source: string;
  readonly level: number; // Rule 716.2b - level designation
  readonly levelAbilities: readonly ClassLevelAbility[];
  readonly baseAbilities: readonly string[]; // Rule 716.3 - always active
}

/**
 * Rule 716.2: Class level bar represents activated and static abilities
 */
export interface ClassLevelAbility {
  readonly levelNumber: number;
  readonly activationCost: string;
  readonly staticAbilities: readonly string[];
}

/**
 * Rule 716.2a: Activate to gain level, check only as sorcery
 */
export function canActivateLevelAbility(
  classCard: ClassCard,
  targetLevel: number,
  canActivateSorcery: boolean
): boolean {
  if (!canActivateSorcery) {
    return false;
  }
  
  // Can only activate if current level is exactly targetLevel - 1
  return classCard.level === targetLevel - 1;
}

export function activateLevelAbility(
  classCard: ClassCard,
  targetLevel: number
): ClassCard {
  return { ...classCard, level: targetLevel };
}

/**
 * Rule 716.2a: Static abilities active if level >= N
 */
export function getActiveClassAbilities(classCard: ClassCard): readonly string[] {
  const levelAbilities = classCard.levelAbilities
    .filter(ability => classCard.level >= ability.levelNumber)
    .flatMap(ability => ability.staticAbilities);
  
  // Rule 716.3: Base abilities always active
  return [...classCard.baseAbilities, ...levelAbilities];
}

/**
 * Rule 716.2b: Levels are not copiable
 */
export function copyClassCard(classCard: ClassCard): ClassCard {
  // Copy doesn't copy level designation
  return { ...classCard, level: 1 }; // Rule 716.2d - default level 1
}

/**
 * Rule 716.2d: If no level, treated as level 1
 */
export function getClassLevel(classCard: ClassCard | any): number {
  if ('level' in classCard && typeof classCard.level === 'number') {
    return classCard.level;
  }
  return 1;
}

// ============================================================================
// Rule 717: Attraction Cards
// ============================================================================

/**
 * Rule 717.1: Attraction cards with Astrotorium backs and lit-up numbers
 */
export interface AttractionCard {
  readonly type: 'attraction';
  readonly source: string;
  readonly name: string;
  readonly litUpNumbers: readonly number[]; // Numbers with white text on colored background
  readonly visitAbility: string; // Rule 717.5
  readonly inJunkyard: boolean; // Rule 717.6a
}

/**
 * Rule 717.2: Attraction deck in command zone
 */
export interface AttractionDeck {
  readonly cards: readonly AttractionCard[];
  readonly isConstructed: boolean;
}

export function createAttractionDeck(
  cards: readonly AttractionCard[],
  isConstructed: boolean
): AttractionDeck | null {
  // Rule 717.2a: Constructed needs 10+ with different names
  if (isConstructed) {
    if (cards.length < 10) {
      return null;
    }
    const names = new Set(cards.map(c => c.name));
    if (names.size !== cards.length) {
      return null;
    }
  } else {
    // Rule 717.2b: Limited needs 3+
    if (cards.length < 3) {
      return null;
    }
  }
  
  return { cards, isConstructed };
}

/**
 * Rule 717.4: Roll to visit Attractions during precombat main phase
 * Rule 717.5: Visit ability triggers if roll matches lit-up number
 */
export function checkVisitTrigger(
  attraction: AttractionCard,
  dieRoll: number
): boolean {
  return attraction.litUpNumbers.includes(dieRoll);
}

/**
 * Rule 717.6: Replacement effect - put in command zone instead of other zones
 */
export function shouldAttractionGoToCommandZone(
  zone: string
): boolean {
  const allowedZones = ['battlefield', 'exile', 'command'];
  return !allowedZones.includes(zone);
}

export function putAttractionInJunkyard(
  attraction: AttractionCard
): AttractionCard {
  return { ...attraction, inJunkyard: true };
}

// ============================================================================
// Rule 718: Prototype Cards
// ============================================================================

/**
 * Rule 718.1: Prototype cards have inset frame with alternative characteristics
 */
export interface PrototypeCard {
  readonly type: 'prototype';
  readonly normalCharacteristics: PrototypeCharacteristics;
  readonly prototypeCharacteristics: PrototypeCharacteristics;
  readonly isPrototyped: boolean; // Cast as prototyped spell
}

interface PrototypeCharacteristics {
  readonly manaCost: string;
  readonly power: number;
  readonly toughness: number;
  readonly colors: readonly string[]; // Derived from mana cost
}

/**
 * Rule 718.2a: Alternative characteristics are copiable values
 */
export function hasPrototype(card: PrototypeCard): boolean {
  return true; // All prototype cards have the ability
}

/**
 * Rule 718.3: Choose whether to cast normally or as prototyped
 */
export function castAsPrototyped(card: PrototypeCard): PrototypeCard {
  return { ...card, isPrototyped: true };
}

export function castPrototypeNormally(card: PrototypeCard): PrototypeCard {
  return { ...card, isPrototyped: false };
}

/**
 * Rule 718.3b: Prototyped spell/permanent has only alternative characteristics
 */
export function getPrototypeCharacteristics(
  card: PrototypeCard,
  zone: string
): PrototypeCharacteristics {
  // Rule 718.4: Normal characteristics except on stack/battlefield when prototyped
  const isActiveZone = zone === 'stack' || zone === 'battlefield';
  
  if (isActiveZone && card.isPrototyped) {
    return card.prototypeCharacteristics;
  }
  
  return card.normalCharacteristics;
}

/**
 * Rule 718.3c: Copy of prototyped spell is also prototyped
 */
export function copyPrototypedSpell(card: PrototypeCard): PrototypeCard {
  if (!card.isPrototyped) {
    return card;
  }
  
  return {
    ...card,
    isPrototyped: true,
  };
}

/**
 * Rule 718.3d: Copy of prototyped permanent is also prototyped
 */
export function copyPrototypedPermanent(card: PrototypeCard): PrototypeCard {
  if (!card.isPrototyped) {
    return card;
  }
  
  return {
    ...card,
    isPrototyped: true,
  };
}

/**
 * Rule 718.5: Other characteristics remain the same
 */
export function getPrototypeOtherCharacteristics(
  card: PrototypeCard
): {
  readonly name: string;
  readonly types: readonly string[];
  readonly text: string;
} {
  // These don't change whether prototyped or not
  // Would be stored in the card object (not shown here for simplicity)
  return {
    name: '', // Same regardless
    types: [], // Same regardless
    text: '', // Same regardless
  };
}

// ============================================================================
// Rule 719: Case Cards
// ============================================================================

/**
 * Rule 719.1: Case cards with vertical illustration
 */
export interface CaseCard {
  readonly type: 'case';
  readonly source: string;
  readonly name: string;
  readonly solveCondition: string; // To solve condition
  readonly isSolved: boolean;
  readonly solvedAbilities: readonly string[]; // Only active when solved
  readonly baseAbilities: readonly string[]; // Always active
}

/**
 * Rule 719.2: "To solve" is a keyword ability
 * Rule 719.2a: Triggered ability that checks condition at beginning of end step
 */
export function checkSolveCondition(
  caseCard: CaseCard,
  conditionMet: boolean
): CaseCard {
  if (conditionMet && !caseCard.isSolved) {
    return { ...caseCard, isSolved: true };
  }
  return caseCard;
}

/**
 * Rule 719.3: "Solved" keyword ability - abilities only function when solved
 */
export function getActiveCaseAbilities(caseCard: CaseCard): readonly string[] {
  if (caseCard.isSolved) {
    return [...caseCard.baseAbilities, ...caseCard.solvedAbilities];
  }
  return caseCard.baseAbilities;
}

/**
 * Rule 719.4: Solved is a designation (like monarch, city's blessing)
 */
export function isCaseSolved(caseCard: CaseCard): boolean {
  return caseCard.isSolved;
}

/**
 * Rule 719.5: If Case leaves battlefield, it's no longer solved
 */
export function resetCaseOnZoneChange(caseCard: CaseCard): CaseCard {
  return { ...caseCard, isSolved: false };
}

/**
 * Rule 719.6: Solved is not a copiable value
 */
export function copyCaseCard(caseCard: CaseCard): CaseCard {
  return { ...caseCard, isSolved: false };
}
