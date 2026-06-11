import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { OracleEffectStep, OracleObjectSelector } from '../../../../rules-engine/src/oracleIR.js';
import {
  isExternallyHandledOracleFragmentText,
  parseBareTriggerEffectFragmentSteps,
  repairGapClosureAbilitySteps,
  repairRandomChooseModeSagaAbilities,
} from '../../../../rules-engine/src/oracleIRParserPostprocess.js';
import { isSupportedCopyPermanentTriggerPattern } from './trigger-copy-permanent.js';

export { isSupportedCopyPermanentTriggerPattern } from './trigger-copy-permanent.js';

/**
 * Step kinds handled by applyOracleIRUncategorizedSpellFallback for mandatory steps.
 * Optional steps are skipped unless listed in TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.
 */
export const ORACLE_IR_FALLBACK_STEP_KINDS = new Set<string>([
  'tap_or_untap',
  'exile_top',
  'impulse_exile_top',
  'add_mana',
  'draw',
  'scry',
  'surveil',
  'gain_life',
  'lose_life',
  'sacrifice',
  'add_counter',
  'deal_damage',
  'prevent_damage',
  'discard',
  'mill',
  'create_token',
  'investigate',
  'destroy',
  'exile',
  'move_zone',
  'counter_spell',
  'goad',
  'proliferate',
  'populate',
]);

/** Optional trigger steps with explicit runtime handlers outside the spell fallback. */
export const TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS = new Set<string>(['copy_permanent']);

export function normalizeTriggerEffectForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const preserveModalBullets = /[\u2022•]/.test(raw) && /\bchoose\b/i.test(raw);

  let processed = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\btap enchanted (?:land|creature|permanent):[\s\S]*$/i, ' ')
    .replace(/\bactivate only if[\s\S]*$/i, ' ')
    .replace(/\.\s*\{[WUBRGC\dP/]+\}(?:\{[WUBRGC\dP/]+\})*:\s*[\s\S]*$/i, ' ');

  if (!preserveModalBullets) {
    processed = processed.replace(/\s+/g, ' ').trim();
  } else {
    processed = processed
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\s*([\u2022•])\s*/g, '\n• ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  return processed.length >= 4 ? processed : raw;
}

export function oracleObjectSelectorText(selector: OracleObjectSelector | undefined): string {
  if (!selector) return '';
  if (selector.kind === 'raw') return String(selector.text || '').trim();
  if (selector.kind === 'battlefield_selector') {
    const types = Array.isArray(selector.types) ? selector.types.join(' ') : '';
    const controller = selector.controllerFilter ? `${selector.controllerFilter} ` : '';
    return `${controller}${types}`.trim();
  }
  return String((selector as { text?: string; raw?: string }).text || (selector as { raw?: string }).raw || '').trim();
}

export function wouldOracleIRFallbackPrefilterMatch(effectText: string): boolean {
  const lower = String(effectText || '').trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes('draw') ||
    (lower.includes('exile') && lower.includes('top') && lower.includes('library')) ||
    (lower.includes('add') && lower.includes('{')) ||
    lower.includes('scries') ||
    lower.includes('scry') ||
    lower.includes('surveils') ||
    lower.includes('surveil') ||
    lower.includes('gain') ||
    lower.includes('lose') ||
    lower.includes('discard') ||
    lower.includes('mill') ||
    lower.includes('create') ||
    lower.includes('investigate') ||
    (lower.includes('top') && lower.includes('library') && lower.includes('graveyard')) ||
    lower.includes('damage') ||
    lower.includes('prevent') ||
    lower.includes('deal') ||
    lower.includes('counter') ||
    lower.includes('sacrifice') ||
    lower.includes('destroy') ||
    lower.includes('exile') ||
    /\breturn\b/.test(lower) ||
    (lower.includes('create') && lower.includes('token')) ||
    lower.includes('copy') ||
    lower.includes('become') ||
    /\btap\b/.test(lower) ||
    /\buntap\b/.test(lower) ||
    lower.includes('goad') ||
    lower.includes('proliferate') ||
    lower.includes('populate')
  );
}

function isOptionalTriggerStep(step: OracleEffectStep): boolean {
  if (Boolean((step as { optional?: boolean }).optional)) return true;
  return /^you may\b/i.test(String(step.raw || '').trim());
}

export function isTriggerStepRuntimeWired(step: OracleEffectStep): boolean {
  if (step.kind === 'unknown') return true;

  if (step.kind === 'copy_permanent') {
    return isSupportedCopyPermanentTriggerPattern(step);
  }

  if (isOptionalTriggerStep(step)) {
    return TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(step.kind);
  }

  return ORACLE_IR_FALLBACK_STEP_KINDS.has(step.kind);
}

export function parseTriggerEffectSteps(effectText: string, cardName: string): OracleEffectStep[] {
  const rawText = String(effectText || '').trim();
  if (!rawText || isExternallyHandledOracleFragmentText(rawText)) return [];

  const bareFragment = parseBareTriggerEffectFragmentSteps(rawText);
  if (bareFragment && bareFragment.length > 0) {
    return [...bareFragment];
  }

  const parsed = parseOracleTextToIR(normalizeTriggerEffectForIrAudit(effectText), cardName);
  const repairedAbilities = repairRandomChooseModeSagaAbilities(
    repairGapClosureAbilitySteps(parsed.abilities || []),
  );
  const steps: OracleEffectStep[] = [];
  for (const ability of repairedAbilities) {
    for (const step of ability.steps || []) {
      if (step) steps.push(step as OracleEffectStep);
    }
  }
  return steps;
}

/**
 * Parse oracle/trigger effect text to IR steps. Trigger-fragment normalization
 * (bare upkeep/ETB clauses) wins over spell-style full-card IR so effects like
 * Cryptoplasm upkeep copy resolve to copy_permanent steps.
 */
export function collectOracleEffectSteps(oracleText: string, sourceName: string): OracleEffectStep[] {
  const text = String(oracleText || '').trim();
  if (!text) return [];

  const triggerSteps = parseTriggerEffectSteps(text, sourceName);
  if (triggerSteps.length > 0) {
    return triggerSteps;
  }

  const ir = parseOracleTextToIR(text, sourceName);
  const fromAbilities = (ir.abilities || []).flatMap((ability) => ability.steps || []);
  if (fromAbilities.length > 0) {
    return fromAbilities as OracleEffectStep[];
  }

  return [];
}

function collectUnwiredTriggerStepGaps(steps: readonly OracleEffectStep[]): string[] {
  const gaps: string[] = [];
  for (const step of steps) {
    if (isTriggerStepRuntimeWired(step)) continue;
    const optionalSuffix = isOptionalTriggerStep(step) ? ' (optional)' : '';
    gaps.push(`${step.kind}${optionalSuffix}`);
  }
  return gaps;
}

/**
 * Returns trigger effects where parsed Oracle IR steps would rely on the runtime
 * Oracle IR fallback path but are not wired there. Ignores effects that only parse
 * to step kinds handled elsewhere in executeTriggerEffect.
 */
export function getTriggerRuntimeWiringGaps(effectText: string, cardName: string): string[] {
  const rawText = String(effectText || '').trim();
  if (!rawText || isExternallyHandledOracleFragmentText(rawText)) return [];

  const steps = parseTriggerEffectSteps(effectText, cardName);
  if (steps.length === 0) return [];

  const hasUnknown = steps.some(step => step.kind === 'unknown');
  if (hasUnknown) return [];

  const gaps = collectUnwiredTriggerStepGaps(steps);
  if (gaps.length === 0) return [];

  const copyGaps = gaps.filter(gap => gap.startsWith('copy_permanent'));
  if (copyGaps.length > 0) return copyGaps;

  if (!wouldOracleIRFallbackPrefilterMatch(effectText)) return [];

  return gaps.filter(gap => {
    const kind = gap.replace(/ \(optional\)$/, '');
    return ORACLE_IR_FALLBACK_STEP_KINDS.has(kind) || TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(kind);
  });
}
