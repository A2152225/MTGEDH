// Origin parent: effectProgram-handlers/effectProgramAppendOracleStep.ts
// Cluster: optional "{X} where X is ≤ life you gained" payment (Well of Lost Dreams).
// Public entries: isLifeGainedBoundedManaPayment, appendLifeGainedBoundedManaXPaymentSteps.
// Leaf must not import effectProgram.ts or effectProgram-handlers/index.ts.

import type { OracleEffectStep } from '../oracleIR';
import { ChoiceEventType } from '../choiceEventsTypes';
import type {
  BuildEffectProgramFromOracleIRInput,
  EffectProgramClauseRef,
  EffectProgramStep,
} from './effectProgramTypes.js';

export function isLifeGainedBoundedManaPayment(step: OracleEffectStep): boolean {
  if (step.kind !== 'pay_mana') return false;
  const mana = String((step as { mana?: string }).mana || '').replace(/\s+/g, '').toUpperCase();
  if (mana !== '{X}') return false;
  return /less than or equal to the amount of life you gained/i.test(String(step.raw || ''));
}

export function appendLifeGainedBoundedManaXPaymentSteps(args: {
  readonly input: BuildEffectProgramFromOracleIRInput;
  readonly steps: EffectProgramStep[];
  readonly oracleStep: OracleEffectStep;
  readonly clause: EffectProgramClauseRef;
  readonly baseId: string;
}): boolean {
  if (!isLifeGainedBoundedManaPayment(args.oracleStep)) return false;

  const bindingKey = `${args.baseId}:x`;
  args.steps.push({
    id: `${args.baseId}:x-choice`,
    kind: 'choice',
    bindingKey,
    clause: args.clause,
    raw: args.oracleStep.raw,
    choiceRequest: {
      type: ChoiceEventType.X_VALUE_SELECTION,
      playerId: args.input.controllerId,
      description: `${args.input.sourceName || 'Ability'}: Pay {X} (X is at most the life you gained), then draw X cards. Cancel to decline.`,
      mandatory: false,
      sourceId: args.input.sourceId,
      sourceName: args.input.sourceName,
      sourceImage: args.input.sourceImage,
      payload: {
        oracleStepKind: 'pay_mana',
        oracleStep: args.oracleStep,
        minX: 0,
        maxFromReferenceAmount: true,
        costPerX: '{1}',
      },
    },
  });
  args.steps.push({
    id: `${args.baseId}:command`,
    kind: 'command',
    clause: args.clause,
    raw: args.oracleStep.raw,
    guard: { bindingKey, cancelledEquals: false, onFalse: 'skip' },
    command: { kind: 'oracle_ir_step', step: args.oracleStep },
  });
  return true;
}
