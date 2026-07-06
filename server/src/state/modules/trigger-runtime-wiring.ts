import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectStepsWithOverlay } from '../../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import type { OracleEffectStep, OracleObjectSelector } from '../../../../rules-engine/src/oracleIR.js';
import {
  resolveCompiledOverlayForCard,
  type CollectOracleEffectStepsOptions,
} from './oracleIrCompiledOverlayLookup.js';
import {
  isExternallyHandledOracleFragmentText,
  parseBareTriggerEffectFragmentSteps,
  repairGapClosureAbilitySteps,
  repairRandomChooseModeSagaAbilities,
} from '../../../../rules-engine/src/oracleIRParserPostprocess.js';
import { normalizeGameplayEffectText } from '../../../../rules-engine/src/oracleReminderText.js';
import { isSupportedCopyPermanentTriggerPattern } from './trigger-copy-permanent.js';

export { isSupportedCopyPermanentTriggerPattern } from './trigger-copy-permanent.js';
export type { CollectOracleEffectStepsOptions } from './oracleIrCompiledOverlayLookup.js';

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
  'lose_game',
  'sacrifice',
  'add_counter',
  'add_player_counter',
  'deal_damage',
  'prevent_damage',
  'double_counters',
  'discard',
  'mill',
  'create_token',
  'register_lose_game_replacement',
  'investigate',
  'blight',
  'destroy',
  'exile',
  'move_zone',
  'counter_spell',
  'goad',
  'proliferate',
  'populate',
  'schedule_delayed_trigger',
  'explore',
  'connive',
  'unless_pays_mana',
  'unless_pays_life',
  'conditional',
  'search_library',
  'shuffle_library',
  'shuffle_zones_into_library',
  'look_choose_from_top',
  'look_select_top',
  'look_top',
  'reveal_top',
  'choose_pile',
  'change_target',
  'choose_target_creature',
  'grant_temporary_ability',
  'grant_static_ability',
  'grant_leave_battlefield_replacement',
  'schedule_delayed_battlefield_action',
  'animate_permanent',
  'attach',
  'fight',
  'modify_pt',
  'cant_block',
  'remove_counter',
  'regenerate',
  'grant_graveyard_permission',
  'grant_graveyard_keyword_ability',
  'modify_graveyard_permissions',
  'copy_spell',
  'pay_mana',
  'add_extra_combat',
  'take_extra_turn',
]);

/** Optional trigger steps with explicit runtime handlers outside the spell fallback. */
export const TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS = new Set<string>(['copy_permanent']);

/**
 * Spell/trigger steps orchestrated by Effect Program (not uncategorized fallback).
 * Treated as fully wired for isSpellEffectFullyIrWired / primary retirement checks.
 */
export const ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS = new Set<string>([
  'choose_mode',
  'fateseal',
  'clash',
  'player_choice',
]);

export function normalizeTriggerEffectDescriptionForExecution(effectText: string): string {
  const raw = String(effectText || '').trim();
  if (!raw) return raw;

  const normalized = normalizeGameplayEffectText(raw);
  // Legacy regex handlers historically matched without trailing punctuation.
  const stripped = normalized.replace(/[.!?,;:]+$/g, '').trim();
  return stripped || normalized || raw;
}

/**
 * True when the controller may decline the entire triggered ability (Rule 603.4 optional).
 * "Each player may …" is mandatory at trigger time — per-player choices happen during resolution.
 */
export function isControllerOptionalTriggeredAbilityEffect(effectText: string): boolean {
  const lower = String(effectText || '').replace(/\u2019/g, "'").trim().toLowerCase();
  if (!lower) return false;
  if (/\beach player may\b/.test(lower)) return false;
  if (/\bstarting with you, each player may\b/.test(lower)) return false;
  if (/\bin turn order, each player may\b/.test(lower)) return false;
  if (/\byou and (?:that player|target player) may each\b/.test(lower)) return false;
  return /\byou may\b/.test(lower);
}

export function normalizeTriggerEffectForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  if (!raw) return raw;

  const executionNormalized = normalizeTriggerEffectDescriptionForExecution(raw);
  const preserveModalBullets = /[\u2022•]/.test(raw) && /\bchoose\b/i.test(raw);

  let processed = executionNormalized
    .replace(/\btap enchanted (?:land|creature|permanent):[\s\S]*$/i, ' ')
    .replace(/\bactivate only if[\s\S]*$/i, ' ');

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
    /\bhave .+ until end of turn\b/.test(lower) ||
    /\b(?:gets?|get) [+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/.test(lower) ||
    lower.includes('double') ||
    lower.includes('lose') ||
    lower.includes('discard') ||
    lower.includes('mill') ||
    lower.includes('create') ||
    lower.includes('investigate') ||
    lower.includes('blight') ||
    (lower.includes('top') && lower.includes('library') && lower.includes('graveyard')) ||
    lower.includes('damage') ||
    lower.includes('prevent') ||
    lower.includes('blocked') ||
    /\bcan'?t block\b/.test(lower) ||
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
    lower.includes('populate') ||
    lower.includes('blight') ||
    lower.includes('explore') ||
    lower.includes('connive') ||
    lower.includes('additional combat') ||
    lower.includes('extra combat') ||
    lower.includes('search your library') ||
    (lower.includes('top') && lower.includes('library')) ||
    (lower.includes('cost') && (lower.includes('less') || lower.includes('more')))
  );
}

function isOptionalTriggerStep(step: OracleEffectStep): boolean {
  if (Boolean((step as { optional?: boolean }).optional)) return true;
  return /^you may\b/i.test(String(step.raw || '').trim());
}

const TRIGGER_CHOICE_STEP_KINDS = new Set<string>([
  'choose_creature_type',
  'choose_color',
  'choose_card_name',
  'choose_basic_land_type',
  'choose_opponent',
  'choose_target_creature',
]);

/** gain_control steps with server executor + prepared-sync coverage in applyOracleIRStepsOnServer. */
export function isSupportedGainControlTriggerPattern(
  step: OracleEffectStep,
): boolean {
  if (step.kind !== 'gain_control') return false;
  const raw = String(step.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return (
    /each player gains control of all creatures they own/.test(raw)
    || /each player gains control of all permanents they own/.test(raw)
    || /each player gains control of all nontoken permanents they own/.test(raw)
    || /the attacking player gains control of this artifact and untaps it/.test(raw)
  );
}

export function isTriggerStepRuntimeWired(step: OracleEffectStep): boolean {
  if (step.kind === 'unknown') return true;

  if (TRIGGER_CHOICE_STEP_KINDS.has(String(step.kind))) {
    return true;
  }

  if (ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS.has(String(step.kind))) {
    return true;
  }

  if (step.kind === 'copy_permanent') {
    return isSupportedCopyPermanentTriggerPattern(step);
  }

  if (step.kind === 'gain_control') {
    return isSupportedGainControlTriggerPattern(step);
  }

  if (isOptionalTriggerStep(step)) {
    return (
      TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(step.kind)
      || ORACLE_IR_FALLBACK_STEP_KINDS.has(step.kind)
    );
  }

  return ORACLE_IR_FALLBACK_STEP_KINDS.has(step.kind);
}

export function parseTriggerEffectSteps(effectText: string, cardName: string): OracleEffectStep[] {
  const rawText = String(effectText || '').trim();
  if (!rawText) return [];

  const bareFragment = parseBareTriggerEffectFragmentSteps(rawText);
  if (bareFragment && bareFragment.length > 0) {
    return [...bareFragment];
  }

  if (isExternallyHandledOracleFragmentText(rawText)) return [];

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
export function collectOracleEffectSteps(
  oracleText: string,
  sourceName: string,
  options?: CollectOracleEffectStepsOptions,
): OracleEffectStep[] {
  const mergedOptions: CollectOracleEffectStepsOptions = {
    ...options,
    cardName: options?.cardName || sourceName,
  };
  const overlay = resolveCompiledOverlayForCard(mergedOptions);
  if (overlay) {
    return collectOracleEffectStepsWithOverlay(
      oracleText,
      sourceName,
      overlay,
      options?.overlayOptions,
    );
  }

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
