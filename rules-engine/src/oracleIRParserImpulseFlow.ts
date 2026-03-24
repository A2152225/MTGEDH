import type { OracleEffectStep } from './oracleIR';
import type { PendingImpulseFromExileTop } from './oracleIRParserPendingImpulseUpgrade';
import { tryUpgradePendingExileTopToImpulse } from './oracleIRParserPendingImpulseUpgrade';
import { tryParseSubjectOrderImpulseExileTop } from './oracleIRParserSubjectOrderImpulse';
import { tryParseCreateTokenAndExileTopClause } from './oracleIRParserTokenCreateClauses';

type ParsedFlowStep = { step: OracleEffectStep; consumed: number } | null;

export type ImpulseFlowResult = {
  handled: boolean;
  nextIndex: number;
  steps: OracleEffectStep[];
  lastCreateTokenStepIndexes: number[] | null;
  pendingImpulseFromExileTop: PendingImpulseFromExileTop;
};

export function handleImpulseOrExileTopClause(params: {
  clauses: string[];
  index: number;
  steps: OracleEffectStep[];
  lastCreateTokenStepIndexes: number[] | null;
  pendingImpulseFromExileTop: PendingImpulseFromExileTop;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
  tryParseImpulseExileTop: (idx: number) => ParsedFlowStep;
  tryParseExileTopOnly: (idx: number) => ParsedFlowStep;
  tryParseLegacySubjectOrderImpulse: (idx: number) => ParsedFlowStep;
}): ImpulseFlowResult {
  const {
    clauses,
    index,
    steps,
    lastCreateTokenStepIndexes,
    pendingImpulseFromExileTop,
    parseEffectClauseToStep,
    tryParseImpulseExileTop,
    tryParseExileTopOnly,
    tryParseLegacySubjectOrderImpulse,
  } = params;

  let nextSteps = steps;
  let nextPending = pendingImpulseFromExileTop;

  if (nextPending) {
    const pendingUpgrade = tryUpgradePendingExileTopToImpulse({
      clauses,
      currentIndex: index,
      pending: nextPending,
      steps: nextSteps,
    });
    if (pendingUpgrade.kind === 'clear') {
      nextPending = null;
    } else if (pendingUpgrade.kind === 'upgrade') {
      return {
        handled: true,
        nextIndex: pendingUpgrade.nextIndex,
        steps: pendingUpgrade.steps,
        lastCreateTokenStepIndexes: null,
        pendingImpulseFromExileTop: null,
      };
    }
  }

  const createAndExileTop = tryParseCreateTokenAndExileTopClause(clauses[index], parseEffectClauseToStep);
  if (createAndExileTop) {
    const startIdx = nextSteps.length;
    nextSteps = nextSteps.concat(createAndExileTop);

    const createIndexes = createAndExileTop
      .map((step, offset) => ({ step, index: startIdx + offset }))
      .filter(entry => entry.step.kind === 'create_token')
      .map(entry => entry.index);

    const exileIdxWithin = (() => {
      for (let offset = createAndExileTop.length - 1; offset >= 0; offset--) {
        if (createAndExileTop[offset]?.kind === 'exile_top') return offset;
      }
      return null;
    })();

    return {
      handled: true,
      nextIndex: index + 1,
      steps: nextSteps,
      lastCreateTokenStepIndexes: createIndexes.length > 0 ? createIndexes : null,
      pendingImpulseFromExileTop: exileIdxWithin !== null ? { stepIndex: startIdx + exileIdxWithin, clauseIndex: index } : null,
    };
  }

  let impulse = tryParseImpulseExileTop(index);
  if (!impulse) {
    impulse = tryParseSubjectOrderImpulseExileTop(clauses[index], clauses[index + 1]);
  }
  if (!impulse) {
    impulse = tryParseLegacySubjectOrderImpulse(index);
  }
  if (impulse) {
    return {
      handled: true,
      nextIndex: index + impulse.consumed,
      steps: nextSteps.concat([impulse.step]),
      lastCreateTokenStepIndexes: null,
      pendingImpulseFromExileTop: null,
    };
  }

  const exileTopOnly = tryParseExileTopOnly(index);
  if (exileTopOnly) {
    const nextExileSteps = nextSteps.concat([exileTopOnly.step]);
    return {
      handled: true,
      nextIndex: index + exileTopOnly.consumed,
      steps: nextExileSteps,
      lastCreateTokenStepIndexes: null,
      pendingImpulseFromExileTop: { stepIndex: nextExileSteps.length - 1, clauseIndex: index },
    };
  }

  return {
    handled: false,
    nextIndex: index,
    steps: nextSteps,
    lastCreateTokenStepIndexes,
    pendingImpulseFromExileTop: nextPending,
  };
}
