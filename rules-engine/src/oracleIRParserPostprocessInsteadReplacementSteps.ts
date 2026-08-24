/**
 * Origin parent: oracleIRParserPostprocess.ts (the "instead" conditional repair cluster).
 *
 * Cluster: folding a replacement clause into the step it replaces when both live inside the same
 * ability. repairAdjacentSpellInsteadConditionalAbilities already folds the identical shape when
 * the base effect and the "instead" clause parsed into two separate abilities (Cabal Ritual,
 * Stitch Together); this is the sibling-step counterpart for cards whose whole effect is one line:
 *
 *   "Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard,
 *    create ten of those tokens instead."  (Increasing Devotion)
 *
 * Left unfolded, both steps execute and the card makes fifteen tokens instead of ten.
 *
 * Public entry: repairIntraAbilityInsteadConditionalSteps
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';

function isInsteadConditionalStep(step: OracleEffectStep | undefined): boolean {
  if (!step || String(step.kind || '') !== 'conditional') return false;
  const conditional = step as any;
  if (Array.isArray(conditional.elseSteps)) return false;
  if (!Array.isArray(conditional.steps) || conditional.steps.length !== 1) return false;
  return /\binstead\b/i.test(String(conditional.raw || ''));
}

/**
 * "Create ten of those tokens instead" names its token by pointing back at the base step, which is
 * what makes this pair safe to fold: the alternative cannot describe anything but a replacement of
 * that exact creation. Once the base moves into elseSteps it no longer runs ahead of the
 * alternative, so the descriptor is copied across while both steps are still in hand.
 *
 * Wider "instead" clauses are deliberately left alone. How far back the replacement reaches varies
 * per card - See the Truth replaces the two preceding steps, Emeria Shepherd only the one - and
 * guessing wrong silently drops an effect.
 */
function resolveBackReferencedToken(alt: OracleEffectStep, base: OracleEffectStep): OracleEffectStep | null {
  if (String(alt.kind || '') !== 'create_token' || String(base.kind || '') !== 'create_token') return null;
  const altToken = String((alt as any).token || '').trim();
  if (!/^(?:of\s+those|those)$/i.test(altToken)) return null;
  const baseToken = String((base as any).token || '').trim();
  return baseToken ? ({ ...(alt as any), token: baseToken } as OracleEffectStep) : null;
}

export function repairIntraAbilityInsteadConditionalSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps || [];
    if (steps.length < 2) return ability;

    const index = steps.findIndex((step, position) => position > 0 && isInsteadConditionalStep(step));
    if (index <= 0) return ability;

    const conditional = steps[index] as any;
    const base = steps[index - 1]!;
    const alt = resolveBackReferencedToken(conditional.steps[0], base);
    if (!alt) return ability;

    return {
      ...ability,
      steps: [
        ...steps.slice(0, index - 1),
        {
          ...conditional,
          steps: [alt],
          elseSteps: [base],
        } as OracleEffectStep,
        ...steps.slice(index + 1),
      ],
    };
  });
}
