/**
 * triggers/zone-changes.ts
 * 
 * Zone change trigger detection and processing.
 * Includes ETB (enters the battlefield), death/dies, and LTB (leaves the battlefield) triggers.
 * 
 * Categories:
 * - ETB triggers: detectETBTriggers, getETBTriggersForPermanent
 * - ETB untap effects: detectETBUntapEffects, getETBUntapEffects, applyETBUntapEffect (etb-untap.ts)
 * - Death triggers: detectDeathTriggers (death-detection.ts), getDeathTriggers family (death-emission.ts)
 * - Undying/Persist: processUndyingPersist (death-emission.ts)
 * - Auto-sacrifice: checkETBAutoSacrifice (etb-untap.ts)
 * - Attack triggers: detectAttackTriggers (attack-detection.ts; leftover re-export path)
 */

// ============================================================================
// Type Definitions
// ============================================================================


export interface TriggeredAbility {
  permanentId: string;
  cardName: string;
  triggerType?: string;
  description: string;
  effect?: string;
  mandatory?: boolean;
  millAmount?: number;
  manaCost?: string;
  requiresChoice?: boolean;
  nontokenOnly?: boolean;
  controlledOnly?: boolean;
  colorRestriction?: string;
  creatureOnly?: boolean;
  modalOptions?: string[];
  tokenInfo?: any;
}

export type { DeathTriggerResult } from "./death-emission.js";

// ============================================================================
// Death Trigger Detection
// ============================================================================


export { detectDeathTriggers } from "./death-detection.js";

export {
  getDeathTriggers,
  getDeathTriggersForCreature,
  getPlayersWhoMustSacrifice,
  processUndyingPersist,
} from "./death-emission.js";


export { detectETBTriggers, getETBTriggersForPermanent } from "./etb-detection.js";

export { detectLTBTriggers } from "./ltb-detection.js";

export { detectAttackTriggers } from "./attack-detection.js";

export {
  detectETBUntapEffects,
  getETBUntapEffects,
  applyETBUntapEffect,
  checkETBAutoSacrifice,
  type ETBUntapEffect,
} from "./etb-untap.js";
