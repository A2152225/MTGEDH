/**
 * Rule 701.48: Learn
 * 
 * "Learn" means "You may discard a card. If you do, draw a card. If you didn't
 * discard a card, you may reveal a Lesson card you own from outside the game and
 * put it into your hand."
 * 
 * Reference: Rule 701.48
 */

export interface LearnAction {
  readonly type: 'learn';
  readonly playerId: string;
  readonly discardedCard?: boolean;
  readonly drewCard?: boolean;
  readonly revealedLesson?: string;
}

export interface LearnResult {
  readonly playerId: string;
  readonly discardedCard: boolean;
  readonly drewCard: boolean;
  readonly tookLesson: boolean;
  readonly revealedLesson?: string;
}

/**
 * Rule 701.48a: Learn
 */
export function learn(playerId: string): LearnAction {
  return {
    type: 'learn',
    playerId,
  };
}

/**
 * Complete learn with discard choice
 */
export function learnWithDiscard(
  playerId: string,
  discarded: boolean,
  drew: boolean
): LearnAction {
  return {
    type: 'learn',
    playerId,
    discardedCard: discarded,
    drewCard: drew,
  };
}

/**
 * Complete learn with Lesson
 */
export function learnWithLesson(
  playerId: string,
  lessonCardId: string
): LearnAction {
  return {
    type: 'learn',
    playerId,
    discardedCard: false,
    revealedLesson: lessonCardId,
  };
}

export function usesLessonFallback(action: LearnAction): boolean {
  return action.discardedCard === false && typeof action.revealedLesson === 'string';
}

export function createLearnResult(action: LearnAction): LearnResult {
  return {
    playerId: action.playerId,
    discardedCard: action.discardedCard === true,
    drewCard: action.drewCard === true,
    tookLesson: usesLessonFallback(action),
    revealedLesson: action.revealedLesson,
  };
}
