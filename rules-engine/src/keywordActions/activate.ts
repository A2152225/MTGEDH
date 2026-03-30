/**
 * Rule 701.2: Activate
 * 
 * To activate an activated ability is to put it onto the stack and pay its costs,
 * so that it will eventually resolve and have its effect.
 * 
 * Reference: Rule 701.2, also see Rule 602
 */
export interface ActivateAction {
  readonly type: 'activate';
  readonly abilityId: string;
  readonly controllerId: string;
}

export interface ActivateResult {
  readonly abilityId: string;
  readonly controllerId: string;
  readonly costsPaid: boolean;
  readonly usesStack: boolean;
  readonly resolves: boolean;
}

export function canActivateAction(
  hasPriority: boolean,
  canPayCosts: boolean,
  timingAllowsActivation: boolean
): boolean {
  return hasPriority && canPayCosts && timingAllowsActivation;
}

export function createActivationResult(
  action: ActivateAction,
  costsPaid: boolean,
  resolves: boolean
): ActivateResult {
  return {
    abilityId: action.abilityId,
    controllerId: action.controllerId,
    costsPaid,
    usesStack: true,
    resolves: costsPaid && resolves,
  };
}
