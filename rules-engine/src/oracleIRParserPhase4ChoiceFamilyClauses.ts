/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: dispatcher for Phase 4 leftover choice-family parses
 *   (each-player choose-then-destroy-rest, secret opponent damage matrix,
 *   mill-from-among may-cast, may-reveal four-zone named-copy win).
 * Public: tryParsePhase4ChoiceFamilyClause
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import { tryParseEachPlayerChooseThenDestroyRest } from './oracleIRParserEachPlayerChooseDestroyRest';
import { tryParseMayCastFromAmong } from './oracleIRParserMayCastFromAmong';
import { tryParseMayRevealHandWinIfOwnNamed } from './oracleIRParserMayRevealHandWinIfOwnNamed';
import { tryParseSecretOpponentChoiceDamage } from './oracleIRParserSecretOpponentChoiceDamage';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

export function tryParsePhase4ChoiceFamilyClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  return tryParseEachPlayerChooseThenDestroyRest(args)
    ?? tryParseSecretOpponentChoiceDamage(args)
    ?? tryParseMayCastFromAmong(args)
    ?? tryParseMayRevealHandWinIfOwnNamed(args);
}
