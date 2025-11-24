/**
 * Rule 701.55: Face a Villainous Choice
 * 
 * "[A player] faces a villainous choice — [option A], or [option B]" means
 * "[A player] chooses [option A] or [option B]. Then all actions in the chosen
 * option are performed."
 * 
 * Reference: Rule 701.55
 */

export interface VillainousChoiceAction {
  readonly type: 'villainous-choice';
  readonly playerId: string;
  readonly optionA: string;
  readonly optionB: string;
  readonly chosenOption?: 'A' | 'B';
}

/**
 * Rule 701.55a: Face a villainous choice
 */
export function faceVillainousChoice(
  playerId: string,
  optionA: string,
  optionB: string
): VillainousChoiceAction {
  return {
    type: 'villainous-choice',
    playerId,
    optionA,
    optionB,
  };
}

/**
 * Complete villainous choice
 */
export function completeVillainousChoice(
  playerId: string,
  optionA: string,
  optionB: string,
  chosenOption: 'A' | 'B'
): VillainousChoiceAction {
  return {
    type: 'villainous-choice',
    playerId,
    optionA,
    optionB,
    chosenOption,
  };
}

/**
 * Rule 701.55b: Can choose illegal option
 */
export const CAN_CHOOSE_ILLEGAL_OPTION = true;

/**
 * Rule 701.55c: Replacement effects
 */
export function faceMultipleTimes(times: number): number {
  return times;
}

/**
 * Rule 701.55d: APNAP order
 */
export function processInAPNAPOrder(
  players: readonly string[],
  apnapOrder: readonly string[]
): readonly string[] {
  return [...players].sort((a, b) => {
    const indexA = apnapOrder.indexOf(a);
    const indexB = apnapOrder.indexOf(b);
    return indexA - indexB;
  });
}
