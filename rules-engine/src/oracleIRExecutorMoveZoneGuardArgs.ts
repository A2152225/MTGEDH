// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the locals that applyMoveZoneStep's selector guard chains read, gathered into one
// argument bundle so each chain can live in its own module while its body stays unchanged.
// Public entry symbols: MoveZoneGuardArgs, MoveZoneFinalizeAppliedResult,
// buildMoveZoneBattlefieldEntryOverrides.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { MoveZoneRuntime, StepApplyResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { MoveZoneWhatZoneQueries } from './oracleIRExecutorMoveZoneWhatParsersZoneQueries';
import type { MoveZoneWhatReferenceQueries } from './oracleIRExecutorMoveZoneWhatParsersReferenceQueries';
import {
  getBoundTargetObjectId,
  getBottomCardLibraryOwnerId,
  getControllerId,
  getSourcePermanentPower,
  getTopCardLibraryOwnerId,
  resolveSourceCardZoneLocation,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import {
  getOneOfThemSplitKind,
  getOnePileSplitKind,
  resolveContextualBoundCardZone,
} from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { resolveBattlefieldAttachment } from './oracleIRExecutorMoveZonePermanentSelectors';

export type MoveZoneStep = Extract<OracleEffectStep, { kind: 'move_zone' }>;

export type MoveZoneFinalizeAppliedResult = (
  result:
    | {
        readonly kind?: 'applied';
        readonly applied?: true;
        readonly state: GameState;
        readonly log: readonly string[];
        readonly movedCards?: readonly any[];
        readonly movedPermanentIds?: readonly string[];
        readonly movedBattlefieldPermanentIds?: readonly string[];
        readonly lastMovedBattlefieldPermanentIds?: readonly string[];
        readonly lastMovedCards?: readonly any[];
      }
    | { readonly kind: 'halted' | 'impossible' | 'player_choice_required' }
) => StepApplyResult;

export function buildMoveZoneBattlefieldEntryOverrides(step: MoveZoneStep) {
  return step.to === 'battlefield' &&
    (step.battlefieldSetTypeLine || step.battlefieldSetOracleText || step.battlefieldLoseAllAbilities)
    ? {
        ...(step.battlefieldSetTypeLine ? { setTypeLine: step.battlefieldSetTypeLine } : {}),
        ...(typeof step.battlefieldSetOracleText === 'string'
          ? { setOracleText: step.battlefieldSetOracleText }
          : {}),
        ...(step.battlefieldLoseAllAbilities ? { loseAllAbilities: true } : {}),
      }
    : undefined;
}

export type MoveZoneBattlefieldEntryOverrides = ReturnType<typeof buildMoveZoneBattlefieldEntryOverrides>;

export type MoveZoneGuardArgs = {
  readonly state: GameState;
  readonly step: MoveZoneStep;
  readonly ctx: OracleIRExecutionContext;
  readonly runtime: MoveZoneRuntime | undefined;
  readonly nextState: GameState;
  readonly log: string[];
  readonly controllerId: ReturnType<typeof getControllerId>;
  readonly effectiveWithCounters: MoveZoneStep['withCounters'];
  readonly battlefieldEntryOverrides: MoveZoneBattlefieldEntryOverrides;
  readonly finalizeAppliedResult: MoveZoneFinalizeAppliedResult;
  readonly attachmentResolution: ReturnType<typeof resolveBattlefieldAttachment>;
  readonly sourcePermanentPower: ReturnType<typeof getSourcePermanentPower>;
  readonly boundTargetObjectId: ReturnType<typeof getBoundTargetObjectId>;
  readonly linkedSourceId: string;
  readonly parsedOneOfThemSplit: ReturnType<typeof getOneOfThemSplitKind>;
  readonly parsedOnePileSplit: ReturnType<typeof getOnePileSplitKind>;
  readonly contextualBoundCardZone: ReturnType<typeof resolveContextualBoundCardZone>;
  readonly sourceCardZone: ReturnType<typeof resolveSourceCardZoneLocation>;
  readonly whatText: string;
  readonly contextualBoundCardIds: readonly string[];
  readonly topCardLibraryOwnerId: ReturnType<typeof getTopCardLibraryOwnerId>;
  readonly bottomCardLibraryOwnerId: ReturnType<typeof getBottomCardLibraryOwnerId>;
  readonly parsedDiceBracketIt: boolean;
  readonly zoneQueries: MoveZoneWhatZoneQueries;
  readonly referenceQueries: MoveZoneWhatReferenceQueries;
};
