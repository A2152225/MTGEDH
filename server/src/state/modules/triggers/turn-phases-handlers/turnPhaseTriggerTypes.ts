/**
 * turn-phases-handlers/turnPhaseTriggerTypes.ts
 * Origin parent: server/src/state/modules/triggers/turn-phases.ts
 * Cluster moved: EndStepTrigger.
 * Public entry symbols: EndStepTrigger.
 */

import type { PhaseWhoseTurn } from "../phaseWhoseTurn.js";

export interface EndStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'end_step_resource' | 'end_step_effect';
  description: string;
  effect?: string;
  mandatory: boolean;
  requiresChoice?: boolean;
  modalOptions?: string[];
  affectsAllPlayers?: boolean;
  triggersOnOpponentEndStep?: boolean;  // For cards like Keeper of the Accord
  whoseTurn?: PhaseWhoseTurn;
}
