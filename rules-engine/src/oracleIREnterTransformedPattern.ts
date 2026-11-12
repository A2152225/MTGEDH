/**
 * Generic detector and IR stamp for "put/return ... onto the battlefield
 * transformed/converted" (CR 712.11a, 701.27j, 701.28h).
 */
import type { OracleIRAbility, OracleEffectStep } from './oracleIR';

const CAST_TRANSFORMED_ONLY = /\bcast\b[\s\S]{0,80}\btransformed\b/i;

export function oracleTextInstructsEnterTransformedOrConverted(text: string | undefined | null): boolean {
  const raw = String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return false;
  if (CAST_TRANSFORMED_ONLY.test(raw) && !/\b(?:put|return|move|moves|place)\b/i.test(raw)) {
    return false;
  }
  if (/\breturn this (?:card|permanent|saga|battle|artifact|enchantment|creature) transformed\b/i.test(raw)) {
    return true;
  }
  if (/\b(?:put|return|move|moves|place)\b[\s\S]{0,220}?\b(?:onto|to) the battlefield\b[\s\S]{0,100}?\b(?:transformed|converted)\b/i.test(raw)) {
    return true;
  }
  if (/\b(?:put|return|move|moves|place)\b[\s\S]{0,220}?\b(?:transformed|converted)\b[\s\S]{0,100}?\b(?:onto|to) the battlefield\b/i.test(raw)) {
    return true;
  }
  if (/\bexile this [^.]*[,.]?\s*then return it to the battlefield transformed\b/i.test(raw)) {
    return true;
  }
  return false;
}

function stepPutsOntoBattlefield(step: any): boolean {
  if (!step || typeof step !== 'object') return false;
  const kind = String(step.kind || '');
  if (kind === 'move_zone') return step.to === 'battlefield';
  if (kind === 'search_library' || kind === 'repeated_zone_draft') return step.destination === 'battlefield';
  if (kind === 'look_choose' || kind === 'look_top' || kind === 'player_look_choose') {
    return step.destination === 'battlefield' || step.to === 'battlefield';
  }
  return false;
}

function stepSourceText(step: any): string {
  return [step?.raw, step?.toRaw, step?.destinationRaw, step?.text, step?.effectText]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function stampStep(step: OracleEffectStep): OracleEffectStep {
  const nextNested = stampNestedContainers(step);
  if (!stepPutsOntoBattlefield(nextNested)) return nextNested;
  if ((nextNested as any).entersTransformed === true) return nextNested;
  if (!oracleTextInstructsEnterTransformedOrConverted(stepSourceText(nextNested))) return nextNested;
  return { ...(nextNested as any), entersTransformed: true };
}

function stampStepList(steps: readonly OracleEffectStep[] | undefined): OracleEffectStep[] | undefined {
  if (!Array.isArray(steps)) return undefined;
  let changed = false;
  const next = steps.map((step) => {
    const stamped = stampStep(step);
    if (stamped !== step) changed = true;
    return stamped;
  });
  return changed ? next : (steps as OracleEffectStep[]);
}

function stampNestedContainers(step: OracleEffectStep): OracleEffectStep {
  const record = step as any;
  let changed = false;
  const patch: Record<string, unknown> = {};
  for (const key of ['steps', 'otherwise', 'thenSteps', 'elseSteps', 'ifSteps', 'otherwiseSteps']) {
    if (!Array.isArray(record[key])) continue;
    const next = stampStepList(record[key]);
    if (next !== record[key]) {
      patch[key] = next;
      changed = true;
    }
  }
  for (const key of ['modes', 'choices', 'options', 'bands', 'results', 'branches']) {
    if (!Array.isArray(record[key])) continue;
    let listChanged = false;
    const nextList = record[key].map((entry: any) => {
      if (!entry || typeof entry !== 'object') return entry;
      const nextSteps = stampStepList(entry.steps);
      if (nextSteps === entry.steps) return entry;
      listChanged = true;
      return { ...entry, steps: nextSteps };
    });
    if (listChanged) {
      patch[key] = nextList;
      changed = true;
    }
  }
  return changed ? { ...record, ...patch } : step;
}

export function stampEnterTransformedOnOracleAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  let changed = false;
  const next = (abilities || []).map((ability) => {
    const steps = stampStepList(ability.steps);
    if (steps === ability.steps) return ability;
    changed = true;
    return { ...ability, steps: steps || [] };
  });
  return changed ? next : (abilities as OracleIRAbility[]);
}
