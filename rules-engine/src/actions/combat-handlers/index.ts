// rules-engine/src/actions/combat-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/actions/combat.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/actions/combat.ts.
// Distinct from server/src/socket/combat-handlers/.
// Never create actions/combat/ beside combat.ts.
// Leaves must not import actions/combat.ts or this index.

// Declare/deal action payload types.
export type {
  AttackerDeclaration,
  BlockerDeclaration,
  DeclareAttackersAction,
  DeclareBlockersAction,
  CombatDamageAssignment,
  DealCombatDamageAction,
} from "./combatActionTypes.js";

// Battlefield id lookup used by goad analysis and legality checks.
export { getPermanentForGoadAnalysis } from "./combatGoadPermanentLookup.js";

// Attack/block legality, creature-now, evasion, and CombatValidationResult.
export {
  isCurrentlyCreature,
  hasDefender,
  hasHaste,
  canPermanentAttack,
  canPermanentBlock,
  checkEvasionAbilities,
  getPermanentTypeLineLower,
  hasAbility,
  type CombatValidationResult,
} from "./combatLegalityHelpers.js";

// Current power from effective / base / counters / modifiers.
export { getPermanentPower } from "./combatPermanentPower.js";

// Goad status, goaders, legal goad attack targets, and processed battlefield.
export {
  buildProcessedBattlefieldForGoad,
  isGoaded,
  getGoadedBy,
  getGoadedAttackTargets,
  canGoadedCreatureAttack,
} from "./combatGoadHelpers.js";

// Goaded creatures that must attack this combat.
export { getGoadedAttackers } from "./combatGoadedAttackers.js";

// Declare-attackers legality, goad, and pillowfort costs.
export { validateDeclareAttackers } from "./combatValidateDeclareAttackers.js";
