import type { OracleEffectStep } from './oracleIR';
import type { OracleIRAbility } from './oracleIR';

export type OracleEffectStepThisWayBinding = {
  readonly thisWayAntecedentStepIndex?: number;
  readonly thisWayAntecedentStepKind?: string;
};

const EXILE_ANTECEDENT_KINDS = [
  'exile',
  'exile_top',
  'impulse_exile_top',
  'exile_named_cards_from_zones',
  'destroy',
  'move_zone',
] as const;

/** Kinds that can satisfy "revealed this way" for ledger-first where-X / for-each reads. */
export const REVEALED_THIS_WAY_ANTECEDENT_KINDS = [
  'look',
  'reveal',
  'scry',
  'surveil',
  'search_library',
] as const;

/** Kinds that can satisfy "searched (your) library this way" conditional clauses. */
export const SEARCHED_THIS_WAY_ANTECEDENT_KINDS = ['search_library'] as const;

/** Abstract parser/runtime kinds → concrete `OracleEffectStep.kind` values. */
export const ANTECEDENT_STEP_KIND_ALIASES: Readonly<Record<string, readonly string[]>> = {
  look: ['look_top', 'look_select_top', 'look_choose_from_top', 'reveal_top', 'reveal'],
  reveal: ['reveal_top', 'look_select_top', 'look_choose_from_top', 'look_top', 'look'],
  scry: ['scry'],
  surveil: ['surveil'],
  discard: ['discard', 'mill'],
  mill: ['mill', 'discard'],
  tap: ['tap', 'untap'],
  untap: ['untap', 'tap'],
};

export function expandAntecedentStepKinds(kinds: readonly string[]): readonly string[] {
  const expanded = new Set<string>();
  for (const kind of kinds) {
    const normalized = String(kind || '').trim();
    if (!normalized) continue;
    expanded.add(normalized);
    for (const alias of ANTECEDENT_STEP_KIND_ALIASES[normalized] || []) {
      expanded.add(alias);
    }
    if (normalized === 'exile') {
      for (const alias of EXILE_ANTECEDENT_KINDS) {
        expanded.add(alias);
      }
    }
  }
  return [...expanded];
}

function appliedKindMatchesAntecedent(
  appliedKind: string | undefined,
  soughtKinds: readonly string[],
): boolean {
  const applied = String(appliedKind || '').trim();
  if (!applied) return false;
  const expanded = new Set(expandAntecedentStepKinds(soughtKinds));
  return expanded.has(applied);
}

const THIS_WAY_ANTECEDENT_RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly kinds: readonly string[];
}> = [
  { pattern: /\bexiled this way\b/i, kinds: EXILE_ANTECEDENT_KINDS },
  { pattern: /\bdiscarded this way\b/i, kinds: ['discard', 'mill'] },
  { pattern: /\brevealed this way\b/i, kinds: REVEALED_THIS_WAY_ANTECEDENT_KINDS },
  {
    pattern: /\b(?:search(?:es)?|searched)\s+(?:your|their|that player'?s?|an opponent'?s?)\s+library this way\b/i,
    kinds: SEARCHED_THIS_WAY_ANTECEDENT_KINDS,
  },
  { pattern: /\bsacrificed this way\b/i, kinds: ['sacrifice'] },
  { pattern: /\bdestroyed this way\b/i, kinds: ['destroy'] },
  { pattern: /\btapped this way\b/i, kinds: ['tap', 'untap'] },
  { pattern: /\bmilled this way\b/i, kinds: ['mill'] },
  {
    pattern: /\bput into (?:a |your |their |the )?graveyard this way\b/i,
    kinds: ['mill', 'discard', 'move_zone'],
  },
  { pattern: /\bput\b.+\bthis way\b/i, kinds: ['move_zone'] },
];

function collectThisWayClauseTexts(step: OracleEffectStep): readonly string[] {
  const texts: string[] = [];
  if (String(step.raw || '').trim()) texts.push(String(step.raw));

  const extended = step as OracleEffectStep & {
    whereX?: { raw?: string };
    condition?: { raw?: string };
    unlessCondition?: { raw?: string };
    scaler?: { kind?: string; raw?: string };
    amount?: { kind?: string; raw?: string };
  };

  if (String(extended.whereX?.raw || '').trim()) texts.push(String(extended.whereX!.raw));
  if (String(extended.condition?.raw || '').trim()) texts.push(String(extended.condition!.raw));
  if (String(extended.unlessCondition?.raw || '').trim()) texts.push(String(extended.unlessCondition!.raw));
  if (extended.scaler?.kind === 'reference_scaler' && String(extended.scaler.raw || '').trim()) {
    texts.push(String(extended.scaler.raw));
  }
  if (extended.amount?.kind === 'reference_amount' && String(extended.amount.raw || '').trim()) {
    texts.push(String(extended.amount.raw));
  }

  return texts;
}

function inferAntecedentKindsFromText(text: string): readonly string[] | null {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  for (const rule of THIS_WAY_ANTECEDENT_RULES) {
    if (rule.pattern.test(normalized)) return rule.kinds;
  }
  return null;
}

export function findAntecedentStepIndexInProgram(
  steps: readonly OracleEffectStep[],
  kinds: readonly string[],
  beforeIndex: number,
): number | null {
  if (beforeIndex <= 0) return null;
  const expanded = expandAntecedentStepKinds(kinds);
  if (expanded.length === 0) return null;

  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const kind = String(steps[index]?.kind || '').trim();
    if (expanded.includes(kind)) return index;
  }
  return null;
}

export function bindThisWayAntecedentOnStep(
  steps: readonly OracleEffectStep[],
  step: OracleEffectStep,
  stepIndex: number,
): OracleEffectStep {
  for (const text of collectThisWayClauseTexts(step)) {
    const kinds = inferAntecedentKindsFromText(text);
    if (!kinds) continue;
    const antecedentStepIndex = findAntecedentStepIndexInProgram(steps, kinds, stepIndex);
    if (antecedentStepIndex === null) continue;
    const antecedentStepKind = String(steps[antecedentStepIndex]?.kind || kinds[0] || '').trim() || kinds[0];
    return {
      ...step,
      thisWayAntecedentStepIndex: antecedentStepIndex,
      thisWayAntecedentStepKind: antecedentStepKind,
    } as OracleEffectStep;
  }
  return step;
}

export function bindThisWayAntecedentOnSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step, index) => bindThisWayAntecedentOnStep(steps, step, index));
}

export function bindThisWayAntecedentOnAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: bindThisWayAntecedentOnSteps(ability.steps),
  }));
}

export function resolveThisWayAntecedentStepIndex(
  ctx: { readonly currentStepIndex?: number; readonly appliedStepKinds?: ReadonlyMap<number, string> } | undefined,
  step: OracleEffectStep & OracleEffectStepThisWayBinding,
  fallbackKind = 'exile',
): number | null {
  if (typeof step.thisWayAntecedentStepIndex === 'number' && step.thisWayAntecedentStepIndex >= 0) {
    return step.thisWayAntecedentStepIndex;
  }
  if (ctx?.currentStepIndex == null) return null;
  const kind = String(step.thisWayAntecedentStepKind || fallbackKind);
  for (let index = ctx.currentStepIndex - 1; index >= 0; index -= 1) {
    if (appliedKindMatchesAntecedent(ctx.appliedStepKinds?.get(index), [kind])) return index;
  }
  return null;
}
