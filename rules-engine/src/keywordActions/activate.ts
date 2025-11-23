/**
 * Rule 701.2: Activate
 * 
 * To activate an activated ability is to put it onto the stack and pay its costs,
 * so that it will eventually resolve and have its effect.
 * 
 * Reference: Rule 701.2, also see Rule 602
 */

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
