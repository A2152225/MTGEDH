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
 * Check whether a villainous choice branch token is well formed.
 */
export function isValidVillainousOption(option: string): option is 'A' | 'B' {
  return option === 'A' || option === 'B';
}

/**
 * Apply the chosen villainous branch to an action.
 */
export function chooseVillainousOption(
  action: VillainousChoiceAction,
  chosenOption: 'A' | 'B',
): VillainousChoiceAction {
  return {
    ...action,
    chosenOption,
  };
}

/**
 * Return the text of the chosen villainous option, if one has been selected.
 */
export function getChosenVillainousOptionText(action: VillainousChoiceAction): string | null {
  if (action.chosenOption === 'A') {
    return action.optionA;
  }

  if (action.chosenOption === 'B') {
    return action.optionB;
  }

  return null;
}

/**
 * Return the two textual branches of a villainous choice.
 */
export function getVillainousOptions(action: VillainousChoiceAction): readonly string[] {
  return [action.optionA, action.optionB];
}

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
  const orderMap = new Map(apnapOrder.map((playerId, index) => [playerId, index]));

  return players
    .map((playerId, index) => ({
      playerId,
      index,
      orderIndex: orderMap.get(playerId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => {
      if (left.orderIndex !== right.orderIndex) {
        return left.orderIndex - right.orderIndex;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.playerId);
}
