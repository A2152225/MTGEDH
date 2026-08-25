/**
 * Origin parent: rules-engine/src/oracleIRParserParseOracleTextToIRLatePasses.ts
 * Cluster: split "discard your hand and draw N cards" onto discard + draw
 *   after clause parse keeps only the draw half.
 * Public: rewriteDiscardHandAndDrawAbilities
 * Leaf must not import oracleIRParserParseOracleTextToIRLatePasses.ts.
 */

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { parseQuantity } from './oracleIRParserUtils';

const DISCARD_HAND_AND_DRAW =
  /discard your hand and draw (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i;

function expandDiscardHandAndDrawSteps(
  steps: readonly OracleEffectStep[] | undefined,
): OracleEffectStep[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];

  return steps.flatMap((step) => {
    if (step.kind === 'conditional') {
      const raw = String((step as { raw?: string }).raw || '');
      const match = raw.match(DISCARD_HAND_AND_DRAW);
      if (match) {
        const amountWord = String(match[1] || 'four').trim();
        return [{
          ...step,
          steps: [
            {
              kind: 'discard',
              who: { kind: 'you' },
              amount: { kind: 'number', value: 9999 },
              raw: 'discard your hand',
            } as OracleEffectStep,
            {
              kind: 'draw',
              who: { kind: 'you' },
              amount: parseQuantity(amountWord),
              raw: `draw ${amountWord} cards`,
            } as OracleEffectStep,
          ],
        } as OracleEffectStep];
      }
      return [{
        ...step,
        steps: expandDiscardHandAndDrawSteps((step as { steps?: readonly OracleEffectStep[] }).steps),
        ...((step as { elseSteps?: readonly OracleEffectStep[] }).elseSteps
          ? { elseSteps: expandDiscardHandAndDrawSteps((step as { elseSteps?: readonly OracleEffectStep[] }).elseSteps) }
          : {}),
      } as OracleEffectStep];
    }

    const raw = String((step as { raw?: string }).raw || '');
    const match = raw.match(DISCARD_HAND_AND_DRAW);
    if (!match || (step.kind !== 'draw' && step.kind !== 'discard' && step.kind !== 'unknown')) {
      return [step];
    }
    const amountWord = String(match[1] || 'four').trim();
    return [
      {
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 9999 },
        raw: 'discard your hand',
      } as OracleEffectStep,
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(amountWord),
        raw: `draw ${amountWord} cards`,
      } as OracleEffectStep,
    ];
  });
}

export function rewriteDiscardHandAndDrawAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: expandDiscardHandAndDrawSteps(ability.steps),
  }));
}
