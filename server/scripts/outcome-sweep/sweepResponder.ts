/**
 * Outcome sweep prompt responder. Builds the AI's choice for a pending resolution step with the
 * same per-type builders the AI auto-resolver uses, then submits it through the real
 * `submitResolutionResponse` socket handler of the step's player, so spell-cast continuations
 * (X, targets, offspring/kicker options, payment) run exactly as they do for a human click.
 * Mana payment prompts pay from the pre-filled pool. Steps with no builder fall back to the
 * AI auto-resolver (`handleAIResolutionStep`, forced).
 */
import { handleAIResolutionStep } from '../../src/socket/resolution.js';
import { buildAiCostAndExploreStepResponse } from '../../src/socket/resolution-handlers/aiCostAndExploreStepResponses.js';
import { buildAiHandAndDraftStepResponse } from '../../src/socket/resolution-handlers/aiHandAndDraftStepResponses.js';
import { buildAiKeywordChoiceStepResponse } from '../../src/socket/resolution-handlers/aiKeywordChoiceStepResponses.js';
import { buildAiSimpleChoiceStepResponse } from '../../src/socket/resolution-handlers/aiSimpleChoiceStepResponses.js';
import { buildAiTargetSelectionStepResponse } from '../../src/socket/resolution-handlers/aiTargetSelectionStepResponses.js';
import { buildAiZoneSelectionStepResponse } from '../../src/socket/resolution-handlers/aiZoneSelectionStepResponses.js';
import { getFilteredValidTargetsForStep } from '../../src/socket/resolution-handlers/resolutionTargetSelectionDistinctTargetUtils.js';
import { ResolutionStepType } from '../../src/state/resolution/index.js';
import { chooseAIPhyrexianManaChoiceSelections } from '../../src/socket/ai-handlers/aiPhyrexianManaChoice.js';
import { SWEEP_P1 } from './sweepBoard.js';
import type { SweepTable } from './sweepHarness.js';

const T = ResolutionStepType as unknown as Record<string, string>;
const types = (...names: string[]) => new Set(names.map((name) => T[name]).filter(Boolean));

const HAND_TYPES = types('X_VALUE_SELECTION', 'MANA_COLOR_SELECTION', 'HAND_TO_BOTTOM', 'RETURN_CONTROLLED_PERMANENT_CHOICE',
  'HIDEAWAY_CHOICE', 'REPEATED_ZONE_DRAFT', 'JOIN_FORCES');
const TARGET_TYPES = types('FIGHT_TARGET', 'TAP_UNTAP_TARGET', 'TARGET_SELECTION', 'MUTATE_TARGET_SELECTION', 'COUNTER_MOVEMENT', 'COUNTER_TARGET',
  'COUNTER_DISTRIBUTION', 'DAMAGE_DIVISION');
const COST_TYPES = types('STATION_CREATURE_SELECTION', 'LIFE_PAYMENT', 'ADDITIONAL_COST_PAYMENT', 'SQUAD_COST_PAYMENT', 'EXPLORE_DECISION',
  'BATCH_EXPLORE_DECISION', 'MODE_SELECTION', 'OPENING_HAND_ACTIONS', 'TEMPTING_OFFER', 'ACTIVATED_ABILITY');
const ZONE_TYPES = types('LIBRARY_SEARCH', 'GRAVEYARD_SELECTION', 'SCRY', 'SURVEIL', 'BOTTOM_ORDER', 'LIM_DULS_VAULT', 'DANCE_WITH_CALAMITY',
  'DANCE_WITH_CALAMITY_CAST', 'DISCARD_SELECTION');
const SIMPLE_TYPES = types('COLOR_CHOICE', 'CREATURE_TYPE_CHOICE', 'CARD_NAME_CHOICE', 'OPTION_CHOICE', 'MODAL_CHOICE', 'PLAYER_CHOICE', 'CASCADE',
  'PONDER_EFFECT', 'TWO_PILE_SPLIT', 'DEVOUR_SELECTION', 'PROLIFERATE', 'LIFE_REDISTRIBUTION', 'FATESEAL', 'CLASH', 'VOTE', 'KYNAIOS_CHOICE',
  'UPKEEP_SACRIFICE', 'RIOT_CHOICE', 'UNLEASH_CHOICE');
const KEYWORD_TYPES = types('FABRICATE_CHOICE', 'TRIBUTE_CHOICE', 'EXPLOIT_CHOICE', 'BACKUP_CHOICE', 'MENTOR_TARGET', 'ENLIST_CHOICE',
  'EXTORT_PAYMENT', 'MODULAR_CHOICE', 'SOULSHIFT_TARGET', 'HAUNT_TARGET');

function buildResponse(table: SweepTable, step: any): { selections: any; cancelled?: boolean } | null {
  const type = String(step?.type || '');
  if (type === T.MANA_PAYMENT_CHOICE) {
    if (step?.phyrexianManaChoice === true) return { selections: chooseAIPhyrexianManaChoiceSelections(table.game, String(step.playerId), step) };
    return { selections: { payment: [] }, cancelled: false };
  }
  if (type === T.TRIGGER_ORDER) {
    const ids = (Array.isArray(step.triggers) ? step.triggers : []).map((entry: any) => String(entry?.id || '')).filter(Boolean);
    return { selections: ids, cancelled: false };
  }
  if (HAND_TYPES.has(type)) return buildAiHandAndDraftStepResponse(table.game, step);
  if (TARGET_TYPES.has(type)) return buildAiTargetSelectionStepResponse(table.game, table.gameId, step, { getFilteredValidTargetsForStep } as any);
  if (COST_TYPES.has(type)) return buildAiCostAndExploreStepResponse(table.game, step);
  if (ZONE_TYPES.has(type)) return buildAiZoneSelectionStepResponse(table.game, step);
  if (SIMPLE_TYPES.has(type)) return buildAiSimpleChoiceStepResponse(table.game, step);
  if (KEYWORD_TYPES.has(type)) return buildAiKeywordChoiceStepResponse(step);
  return null;
}

function optionId(option: any): unknown {
  if (option && typeof option === 'object') return option.id ?? option.value ?? option.key ?? option.label;
  return option;
}

/**
 * Human-like adjustments: X is 1 (or the minimum) so X effects do something on the small board, and a cast-time
 * option the AI would cancel (which aborts the cast) picks the first option instead.
 */
function humanize(step: any, response: { selections: any; cancelled?: boolean } | null) {
  if (!response) return response;
  const type = String(step?.type || '');
  if (type === T.X_VALUE_SELECTION) {
    const min = Math.max(0, Math.floor(Number(step.minValue ?? 0)));
    const max = Math.floor(Number(step.maxValue ?? Math.max(min, 1)));
    // The AI picks X from all available mana (64 on the sweep board), which outruns the board's targets.
    const x = Math.max(min, Math.min(Number.isFinite(max) ? max : 1, 1));
    return { selections: x, cancelled: false };
  }
  const options = Array.isArray(step?.options) ? step.options : [];
  if (response.cancelled && options.length > 0) return { selections: [optionId(options[0])], cancelled: false };
  return response;
}

/** Rejection codes that mean the AI builder's answer was invalid for the step (not an engine refusal of the action). */
const BUILDER_REJECT_CODES = new Set(['INVALID_SELECTION', 'INVALID_SELECTION_COUNT', 'STEP_MANDATORY']);

function typeLineMatches(perm: any, types: unknown[]): boolean {
  if (!types.length) return true;
  const typeLine = String(perm?.card?.type_line || '').toLowerCase();
  return types.some((raw) => {
    const type = String(raw || '').toLowerCase().trim();
    if (!type || type === 'permanent') return true;
    // Every word must hold: "nonenchantment creature" = not an enchantment and a creature.
    return type.split(/\s+/).every((word) => {
      const negated = /^non-?(.+)$/.exec(word);
      return negated ? !typeLine.includes(negated[1]) : typeLine.includes(word);
    });
  });
}

/**
 * Human-style answer used after the AI builder's answer was rejected (and for untap prompts, where a person
 * picks something tapped). Never replaces the AI builder for the first attempt otherwise.
 */
export function humanFallbackResponse(table: SweepTable, step: any): { selections: any; cancelled?: boolean } | null {
  const type = String(step?.type || '');
  if (type === T.CARD_NAME_CHOICE) {
    const candidates = Array.isArray(step.candidateNames) ? step.candidateNames.map(String).filter(Boolean) : [];
    if (candidates.length) return { selections: [candidates[0]], cancelled: false };
    const restriction = String(step.restrictionText || step.description || '').toLowerCase();
    const name = /\bnonland\b|other than a basic land/.test(restriction) ? 'Grizzly Bears' : /\bland\b/.test(restriction) ? 'Forest' : 'Grizzly Bears';
    return { selections: [name], cancelled: false };
  }
  if (type === T.TAP_UNTAP_TARGET) {
    const filter = step.targetFilter || {};
    const count = Math.max(1, Number(step.targetCount || 1));
    const action = step.action === 'untap' ? 'untap' : 'tap';
    const sourceId = String(step.sourceId || '');
    const valid = new Set((Array.isArray(step.validTargets) ? step.validTargets : []).map((entry: any) => String(entry?.id ?? entry)));
    const pool = (table.game.state?.battlefield || []).filter((perm: any) => {
      if (!perm?.id) return false;
      if (valid.size) return valid.has(String(perm.id));
      if (filter.excludeSource && String(perm.id) === sourceId) return false;
      if (filter.controller === 'you' && perm.controller !== step.playerId) return false;
      if (filter.controller === 'opponent' && perm.controller === step.playerId) return false;
      if (filter.tapStatus === 'tapped' && !perm.tapped) return false;
      if (filter.tapStatus === 'untapped' && perm.tapped) return false;
      return typeLineMatches(perm, Array.isArray(filter.types) ? filter.types : []);
    });
    // A person untaps something tapped and taps something untapped.
    pool.sort((a: any, b: any) => Number(Boolean(b.tapped) === (action === 'untap')) - Number(Boolean(a.tapped) === (action === 'untap')));
    if (pool.length < count) return null;
    return { selections: { targetIds: pool.slice(0, count).map((perm: any) => String(perm.id)), action }, cancelled: false };
  }
  if (type === T.OPTION_CHOICE || type === T.MODAL_CHOICE) {
    const options = Array.isArray(step.options) ? step.options : [];
    const min = Math.max(1, Number(step.minSelections ?? 1));
    if (options.length >= min) return { selections: options.slice(0, min).map(optionId), cancelled: false };
  }
  return null;
}

async function submitViaSocket(table: SweepTable, step: any, response: { selections: any; cancelled?: boolean }): Promise<string | undefined> {
  const handlers = table.handlers[String(step.playerId || SWEEP_P1)] || table.handlers[SWEEP_P1];
  const mark = table.emitted.length;
  // Extra top-level answer fields travel like the client sends them (library search splitAssignments).
  const { selections, cancelled, stepId: _stepId, playerId: _playerId, timestamp: _timestamp, ...extras } = response as any;
  await handlers.submitResolutionResponse({
    ...extras,
    gameId: table.gameId,
    stepId: String(step.id),
    selections,
    cancelled: Boolean(cancelled),
  });
  const error = table.emitted.slice(mark).find((entry) => entry.event === 'error');
  const code = error ? String(error.payload?.code || 'error') : undefined;
  if (error && code && BUILDER_REJECT_CODES.has(code)) {
    for (const entry of table.emitted.slice(mark)) if (entry.event === 'error') table.responderRejects.add(entry);
    return code;
  }
  return undefined;
}

/**
 * First attempt: AI-built choice through the socket handler. When the step rejects that answer as invalid
 * (an AI builder bug, recorded as `rejected:CODE`), the retry submits a human-style answer; further retries
 * go to the forced AI auto-resolver.
 */
export async function answerSweepStep(table: SweepTable, step: any, attempt: number): Promise<string> {
  const stepId = String(step.id);
  if (attempt <= 1) {
    let response: { selections: any; cancelled?: boolean } | null = null;
    try {
      response = humanize(step, buildResponse(table, step));
    } catch {
      response = null;
    }
    if (response) {
      const rejected = await submitViaSocket(table, step, response);
      if (rejected) {
        table.rejectedSteps.set(stepId, rejected);
        return `rejected:${rejected}`;
      }
      return 'socket';
    }
  }
  if (attempt === 2 && table.rejectedSteps.has(stepId)) {
    const fallback = humanFallbackResponse(table, step);
    if (fallback) {
      await submitViaSocket(table, step, fallback);
      return 'human';
    }
  }
  await handleAIResolutionStep(table.io, table.gameId, step, { force: true });
  return 'ai';
}
