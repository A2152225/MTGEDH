import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import {
  ORACLE_IR_FALLBACK_STEP_KINDS,
  TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
  wouldOracleIRFallbackPrefilterMatch,
} from './trigger-runtime-wiring.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync.js';
import { isOracleIrExecutionHandled } from './oracleIrSpellExecution.js';
import { debug, debugWarn } from '../../utils/debug.js';

const EFFECT_PROGRAM_ONLY_KINDS = new Set<string>([
  'choose_mode',
  'fateseal',
  'clash',
]);

const UNLESS_PAY_KINDS = new Set<string>([
  'unless_pays_mana',
  'unless_pays_life',
]);

function isOptionalStep(step: OracleEffectStep): boolean {
  if ((step as { optional?: boolean }).optional === true) return true;
  return /^you may\b/i.test(String(step.raw || '').trim());
}

function shouldIncludeUncategorizedSpellFallbackStep(step: OracleEffectStep): boolean {
  if (!step || step.kind === 'unknown') return false;
  if (EFFECT_PROGRAM_ONLY_KINDS.has(String(step.kind))) return false;

  if (isOptionalStep(step)) {
    if (UNLESS_PAY_KINDS.has(String(step.kind))) return true;
    if (TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(String(step.kind))) return true;
    if (ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind))) return true;
    return true;
  }

  if (step.kind === 'conditional') return true;
  if (UNLESS_PAY_KINDS.has(String(step.kind))) return true;
  return ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind));
}

function collectSpellSteps(oracleText: string, spellName: string): OracleEffectStep[] {
  const ir = parseOracleTextToIR(oracleText, spellName);
  const steps: OracleEffectStep[] = [];
  for (const ability of ir.abilities || []) {
    for (const step of ability.steps || []) {
      if (step) steps.push(step as OracleEffectStep);
    }
  }
  return steps;
}

/**
 * Best-effort Oracle IR resolution for spells that did not match categorizeSpell.
 * Delegates to applyOracleIRStepsOnServer instead of duplicating per-step handlers.
 */
export function applyOracleIRUncategorizedSpellFallback(
  ctx: GameContext,
  oracleText: string,
  caster: PlayerID,
  spellName: string,
  xValue?: number,
  sourcePermanentId?: string,
  sourceId?: string,
  castFromGraveyard?: boolean,
  irCtx?: OracleIRExecutionContext,
  sourceObjectType: 'spell' | 'ability' = 'spell',
): number {
  try {
    const text = String(oracleText || '').trim();
    if (!text || !wouldOracleIRFallbackPrefilterMatch(text)) return 0;

    const allSteps = collectSpellSteps(text, spellName);
    const fallbackSteps = allSteps.filter(shouldIncludeUncategorizedSpellFallbackStep);
    if (fallbackSteps.length === 0) return 0;

    const executionCtx = irCtx || buildOracleIRExecutionContext({
      controllerId: caster,
      sourceId: sourcePermanentId || sourceId,
      sourceName: spellName,
      sourceObjectType,
      xValue,
      ...(castFromGraveyard ? { castFromZone: 'graveyard' as const } : {}),
    }, {
      sourceObjectType,
      castFromZone: castFromGraveyard ? 'graveyard' : undefined,
    });

    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;

    const optionalSteps = fallbackSteps.filter(isOptionalStep);
    const mandatorySteps = fallbackSteps.filter((step) => !isOptionalStep(step));

    let applied = 0;

    const countHandled = (result: ReturnType<typeof applyOracleIRStepsOnServer>, queueStart: number) => {
      const queueAfter = gameId !== 'unknown'
        ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
        : queueStart;
      if (!isOracleIrExecutionHandled(result, queueStart, queueAfter)) return;
      applied += Math.max(1, result.appliedSteps.length);
    };

    if (mandatorySteps.length > 0) {
      const result = applyOracleIRStepsOnServer(
        ctx,
        (ctx as any).state,
        mandatorySteps,
        {
          ...executionCtx,
          controllerId: caster,
          sourceName: spellName,
          sourceId: sourcePermanentId || sourceId,
        },
        { allowOptional: false },
        { controller: caster },
      );
      countHandled(result, queueBefore);
    }

    for (const step of optionalSteps) {
      const queueStart = gameId !== 'unknown'
        ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
        : 0;
      const result = applyOracleIRStepsOnServer(
        ctx,
        (ctx as any).state,
        [step],
        {
          ...executionCtx,
          controllerId: caster,
          sourceName: spellName,
          sourceId: sourcePermanentId || sourceId,
        },
        { allowOptional: true },
        { controller: caster },
      );
      countHandled(result, queueStart);
    }

    if (applied > 0) {
      debug(2, `[oracleIR] Fallback applied ${applied} step(s) for ${spellName}`);
    }
    return applied;
  } catch (err) {
    debugWarn(2, `[oracleIR] Fallback failed for ${spellName}:`, err);
    return 0;
  }
}
