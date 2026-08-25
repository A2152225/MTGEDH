// Origin parent: oracleIRExecutorConditionalStepSupportExtended.ts
// Cluster moved: LastActionOutcome, EXILE_THIS_WAY_STEP_KINDS, ExtendedConditionalParams.
// Public entry symbols: LastActionOutcome, EXILE_THIS_WAY_STEP_KINDS, ExtendedConditionalParams.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

export type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export const EXILE_THIS_WAY_STEP_KINDS: readonly OracleEffectStep['kind'][] = [
  'exile',
  'exile_top',
  'impulse_exile_top',
  'move_zone',
];

export type ExtendedConditionalParams = {
  readonly normalizedRaw: string;
  readonly raw: string;
  readonly nextState: GameState;
  readonly controllerId: PlayerID;
  readonly ctx: OracleIRExecutionContext;
  readonly lastActionOutcome: LastActionOutcome;
  readonly lastMovedCards?: readonly any[];
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExcessDamageDealtThisWay?: number;
  readonly step?: OracleEffectStep;
};
