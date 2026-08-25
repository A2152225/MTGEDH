// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: shared predicate over abilities whose steps are all still unknown, used by several reminder-prune clusters.
//
// Public entry points:
//   isUnknownOnlyAbility

import type { OracleIRAbility } from './oracleIR';

export function isUnknownOnlyAbility(ability: OracleIRAbility): boolean {
  return ability.steps.length === 0 || ability.steps.every((step) => step.kind === 'unknown');
}

