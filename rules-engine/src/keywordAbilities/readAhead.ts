/**
 * Read Ahead keyword ability (Rule 702.155)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.155. Read Ahead
 * 702.155a Read ahead is a keyword found on some Saga cards. "Read ahead" means "Chapter 
 * abilities of this Saga can't trigger the turn it entered the battlefield unless it has exactly 
 * the number of lore counters on it specified in the chapter symbol of that ability."
 * 702.155b As a Saga with the read ahead ability enters the battlefield, its controller chooses 
 * a number from one to that Saga's final chapter number. That Saga enters the battlefield with 
 * the chosen number of lore counters on it.
 * 702.155c Multiple instances of read ahead on the same object are redundant.
 */

export interface ReadAheadAbility {
  readonly type: 'read-ahead';
  readonly source: string;
  readonly finalChapterNumber: number;
  readonly chosenStartingChapter?: number;
  readonly loreCounters: number;
}

/**
 * Create a read ahead ability
 * Rule 702.155a
 * @param source - The Saga with read ahead
 * @param finalChapterNumber - Final chapter of the Saga
 * @returns Read ahead ability object
 */
export function readAhead(source: string, finalChapterNumber: number): ReadAheadAbility {
  return {
    type: 'read-ahead',
    source,
    finalChapterNumber,
    loreCounters: 0,
  };
}

/**
 * Choose starting chapter as Saga enters
 * Rule 702.155b
 * @param ability - Read ahead ability
 * @param chosenChapter - Chapter number to start at (1 to final)
 * @returns Updated ability
 */
export function chooseReadAheadChapter(
  ability: ReadAheadAbility,
  chosenChapter: number
): ReadAheadAbility {
  const validChapter = Math.max(1, Math.min(chosenChapter, ability.finalChapterNumber));
  
  return {
    ...ability,
    chosenStartingChapter: validChapter,
    loreCounters: validChapter,
  };
}

/**
 * Check if chapter ability can trigger
 * Rule 702.155a - Can't trigger turn it entered unless exact lore counter match
 * @param ability - Read ahead ability
 * @param chapterNumber - Chapter number to check
 * @param isSameTurnEntered - Whether it's the same turn it entered
 * @returns True if can trigger
 */
export function canChapterTrigger(
  ability: ReadAheadAbility,
  chapterNumber: number,
  isSameTurnEntered: boolean
): boolean {
  if (!isSameTurnEntered) {
    return true; // Can always trigger after the turn it entered
  }
  
  // On the turn it entered, can only trigger if exact match
  return ability.loreCounters === chapterNumber;
}

/**
 * Multiple instances of read ahead are redundant
 * Rule 702.155c
 * @param abilities - Array of read ahead abilities
 * @returns True if more than one
 */
export function hasRedundantReadAhead(abilities: readonly ReadAheadAbility[]): boolean {
  return abilities.length > 1;
}
