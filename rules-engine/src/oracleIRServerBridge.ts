import type { OracleIRPendingTransition } from './oracleIRTransitionTypes';

export interface OracleIRServerBridgeResult {
  readonly halt: boolean;
  readonly deferred?: readonly OracleIRPendingTransition[];
  readonly ready?: readonly OracleIRPendingTransition[];
}

/**
 * Server injection point: step handlers propose transitions; the server
 * intercepts replacements and commits zone changes.
 *
 * Dry-run callers omit this bridge; handlers mutate state directly.
 */
export interface OracleIRServerExecutionBridge {
  proposeTransitions(
    transitions: readonly OracleIRPendingTransition[],
  ): OracleIRServerBridgeResult;
}
