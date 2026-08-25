// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: resolveClashPlayerId, findClashOpponentPlayerId, findClashTargetBindingKey.
// Public entry symbols: resolveClashPlayerId, findClashOpponentPlayerId, findClashTargetBindingKey.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

import type { GameState } from '../../../shared/src';
import type { EffectProgramCommandStep, EffectProgramRuntime } from '../effectProgram';
import type { OracleEffectStep } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { resolvePlayers } from '../oracleIRExecutorPlayerUtils';
import { readFirstSelectionForBinding } from './effectProgramOracleRunnerLibraryLookups';

export function resolveClashPlayerId(
  state: GameState,
  oracleStep: OracleEffectStep | undefined,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (!oracleStep || String((oracleStep as any).kind || '') !== 'clash') {
    return undefined;
  }

  const players = resolvePlayers(state, (oracleStep as any).who, ctx);
  return players.length === 1 ? String(players[0]) : undefined;
}

export function findClashOpponentPlayerId(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep,
  oracleStep: OracleEffectStep,
  state: GameState,
  ctx: OracleIRExecutionContext
): string | undefined {
  const opponentBindingKey = findClashTargetBindingKey(runtime, commandStep);
  const selectedOpponentId = readFirstSelectionForBinding(runtime, opponentBindingKey);
  if (selectedOpponentId) {
    return selectedOpponentId;
  }

  if (!(oracleStep as any).opponent) {
    return undefined;
  }

  const opponents = resolvePlayers(state, (oracleStep as any).opponent, ctx);
  return opponents.length === 1 ? String(opponents[0]) : undefined;
}

export function findClashTargetBindingKey(
  runtime: EffectProgramRuntime<GameState>,
  commandStep: EffectProgramCommandStep
): string {
  const commandIndex = runtime.program.steps.findIndex(step => step.id === commandStep.id);
  const searchSteps = commandIndex >= 0 ? runtime.program.steps.slice(0, commandIndex) : runtime.program.steps;
  for (const step of searchSteps) {
    if (step.kind !== 'choice') continue;
    const payload = step.choiceRequest?.payload as any;
    if (String(payload?.oracleStepKind || '') === 'clash_target') {
      return step.bindingKey;
    }
  }
  return '';
}
