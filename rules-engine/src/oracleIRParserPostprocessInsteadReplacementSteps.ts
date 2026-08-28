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
 *   "Put a +1/+1 counter on each creature you control. If you have the city's blessing,
 *    put two +1/+1 counters on each creature you control instead."  (Andúril, Narsil Reforged)
 *
 * Left unfolded, both steps execute and the card makes fifteen tokens / three counters instead of ten / two.
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

function selectorIdentity(step: any): string {
  const normalize = (value: unknown) => {
    if (!value || typeof value !== 'object') return value ?? null;
    const copy = { ...(value as Record<string, unknown>) };
    if (typeof copy.text === 'string') copy.text = copy.text.toLowerCase().trim();
    if (typeof copy.raw === 'string') copy.raw = copy.raw.toLowerCase().trim();
    return copy;
  };
  return JSON.stringify({
    target: normalize(step?.target),
    who: normalize(step?.who),
    what: normalize(step?.what),
  });
}

/**
 * "Create ten of those tokens instead" names its token by pointing back at the base step, which is
 * what makes this pair safe to fold: the alternative cannot describe anything but a replacement of
 * that exact creation. Once the base moves into elseSteps it no longer runs ahead of the
 * alternative, so the descriptor is copied across while both steps are still in hand.
 *
 * Same-target add_counter replacements (Andúril) are the same shape: one preceding counter step
 * is replaced by another counter step on the same permanents, just a different amount.
 *
 * Wider "instead" clauses are deliberately left alone. How far back the replacement reaches varies
 * per card - See the Truth replaces the two preceding steps, Emeria Shepherd only the one - and
 * guessing wrong silently drops an effect.
 */
function resolveInsteadReplacementStep(alt: OracleEffectStep, base: OracleEffectStep): OracleEffectStep | null {
  if (String(alt.kind || '') === 'create_token' && String(base.kind || '') === 'create_token') {
    const altToken = String((alt as any).token || '').trim();
    if (!/^(?:of\s+those|those)$/i.test(altToken)) return null;
    const baseToken = String((base as any).token || '').trim();
    return baseToken ? ({ ...(alt as any), token: baseToken } as OracleEffectStep) : null;
  }

  if (String(alt.kind || '') === 'add_counter' && String(base.kind || '') === 'add_counter') {
    return selectorIdentity(alt) === selectorIdentity(base) ? alt : null;
  }

  return null;
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
    const alt = resolveInsteadReplacementStep(conditional.steps[0], base);
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
