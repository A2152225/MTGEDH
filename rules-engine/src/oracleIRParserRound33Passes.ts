import type { OracleIRAbility } from './oracleIR';

const X_THRESHOLD_CONDITION = /^x is \d+ or (?:more|greater|less|fewer)$/i;
const OTHER_REVEALED_BOTTOM_RANDOM =
  /^(?:then\s+)?(?:each (?:opponent|player)|that player|they) puts? the other cards (?:they|that player) revealed this way on the bottom of (?:their|his or her) library in a random order\.?$/i;

function extractWhereXRaw(step: any): string | null {
  const raw = String(step?.raw || '');
  const m = raw.match(/\bwhere (x is .+?)\s*\.?$/i);
  return m ? m[1] : null;
}

/** "... where X is N. If X is 6 or more, ..." : bind the conditional to the earlier where-X expression. */
function annotateConditionalWhereX(steps: readonly any[]): readonly any[] {
  let changed = false;
  let lastWhere: string | null = null;
  const out = steps.map((step) => {
    const where = extractWhereXRaw(step);
    if (where) lastWhere = where;
    if (step?.kind === 'conditional' && lastWhere && !step.xWhereRaw) {
      const cond = String(step?.condition?.raw || '').trim().replace(/\.$/, '');
      if (X_THRESHOLD_CONDITION.test(cond)) {
        changed = true;
        return { ...step, xWhereRaw: lastWhere };
      }
    }
    return step;
  });
  return changed ? out : steps;
}

/** Gift of Perfection-style tail: "Then each opponent puts the other cards they revealed this way on the bottom ... random order." */
function lowerOtherRevealedBottomRandom(steps: readonly any[]): readonly any[] {
  let changed = false;
  const out = steps.map((step) => {
    if (step?.kind !== 'grant_static_ability') return step;
    const text = String(step.raw || '').trim();
    if (!OTHER_REVEALED_BOTTOM_RANDOM.test(text)) return step;
    changed = true;
    return {
      kind: 'move_zone',
      what: { kind: 'raw', text: "all cards revealed this way that weren't put onto the battlefield" },
      to: 'library',
      toRaw: 'the bottom of their library in a random order',
      raw: text,
      ...(step.sequence ? { sequence: step.sequence } : {}),
    };
  });
  return changed ? out : steps;
}

export function applyRound33AbilityPasses(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps0 = (ability.steps || []) as readonly any[];
    const steps = annotateConditionalWhereX(lowerOtherRevealedBottomRandom(steps0));
    return steps === steps0 ? ability : ({ ...ability, steps: [...steps] } as OracleIRAbility);
  });
}
