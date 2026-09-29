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

/** Pronoun-style selectors that can only point back at the base step's source/target. */
const BACK_REFERENCE_SELECTOR =
  /^(?:it|itself|them|that (?:creature|permanent|planeswalker|player|opponent|creature or planeswalker)|those (?:creatures|permanents|players|planeswalkers)|each of them)$/;
const BACK_REFERENCE_SOURCE =
  /^(?:it|this permanent|this spell|this creature|that creature|that permanent)$/;

function selectorText(selector: any): string {
  return String(selector?.text ?? selector?.raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/^among\s+/, '');
}

/**
 * "Deals twice X damage to that permanent instead" (Stonesplitter Bolt), "deals twice that much damage to
 * itself instead" (Cut Propulsion): the alternative damage step replaces the preceding damage step from the
 * same source. The alternative may only point back at the base step's target and source, otherwise it is a
 * different damage effect and both steps must keep running.
 */
function resolveDamageInsteadReplacement(alt: any, base: any): OracleEffectStep | null {
  const baseTarget = selectorText(base.target);
  const altTarget = selectorText(alt.target);
  const targetsMatch = altTarget === baseTarget || BACK_REFERENCE_SELECTOR.test(altTarget);
  if (!targetsMatch) return null;

  const altSource = selectorText(alt.source);
  const sourcesMatch = !altSource || altSource === selectorText(base.source) || BACK_REFERENCE_SOURCE.test(altSource);
  if (!sourcesMatch) return null;

  if (JSON.stringify(alt.who ?? null) !== JSON.stringify(base.who ?? null)) return null;
  if ((alt.division ?? null) !== (base.division ?? null)) return null;

  // "twice that much" after a fixed amount is just the doubled fixed amount.
  const altAmountRaw = String(alt.amount?.raw || '').toLowerCase().trim();
  if (alt.amount?.kind === 'reference_amount' && altAmountRaw === 'twice that much' && base.amount?.kind === 'number') {
    return { ...alt, amount: { kind: 'number', value: Number(base.amount.value) * 2 } } as OracleEffectStep;
  }
  // "twice that much" after "damage equal to its power" doubles the same stat.
  if (alt.amount?.kind === 'reference_amount' && altAmountRaw === 'twice that much' && base.amount?.kind === 'object_stat') {
    const multiplier = Number.isFinite(Number(base.amount.multiplier)) ? Number(base.amount.multiplier) : 1;
    return { ...alt, amount: { ...base.amount, multiplier: multiplier * 2 } } as OracleEffectStep;
  }
  return alt as OracleEffectStep;
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

  if (String(alt.kind || '') === 'deal_damage' && String(base.kind || '') === 'deal_damage') {
    return resolveDamageInsteadReplacement(alt, base);
  }

  return null;
}

/**
 * "If this spell was kicked, the creature you control deals twice that much damage instead." (Chocobo Kick)
 * reaches the IR as an unparsed grant_static_ability residual right after the "damage equal to its power"
 * step, so the doubling never happened. Only kicked/bargained conditions are lowered here: those are the
 * ones the executor can always answer for a resolving spell, so the base damage is never lost.
 */
const RESIDUAL_TWICE_DAMAGE_INSTEAD =
  /^if\s+(this spell was (?:kicked|bargained)|it was (?:kicked|bargained)),\s*(?:the creature you control|that creature|it)\s+deals\s+twice\s+that\s+much\s+damage\s+instead\.?$/i;

function foldResidualTwiceDamageInstead(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  for (const step of steps) {
    const match = String((step as any)?.raw || '').trim().match(RESIDUAL_TWICE_DAMAGE_INSTEAD);
    const base: any = out[out.length - 1];
    if (
      match
      && String(step.kind) === 'grant_static_ability'
      && base?.kind === 'deal_damage'
      && base.amount?.kind === 'object_stat'
    ) {
      const multiplier = Number.isFinite(Number(base.amount.multiplier)) ? Number(base.amount.multiplier) : 1;
      const alt = {
        ...base,
        amount: { ...base.amount, multiplier: multiplier * 2 },
        raw: `${base.raw} (twice that much)`,
      };
      out[out.length - 1] = {
        kind: 'conditional',
        condition: { kind: 'if', raw: match[1]!.toLowerCase() },
        steps: [alt],
        elseSteps: [base],
        raw: String((step as any).raw).trim(),
      } as unknown as OracleEffectStep;
      continue;
    }
    out.push(step);
  }
  return out;
}

export function repairIntraAbilityInsteadConditionalSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((original) => {
    const residualFolded = original.steps?.length ? foldResidualTwiceDamageInstead(original.steps) : original.steps;
    const ability = residualFolded === original.steps || residualFolded.length === original.steps.length
      ? original
      : { ...original, steps: residualFolded };
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
