import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import type { GameContext } from '../context.js';
import { applyOracleIRUncategorizedSpellFallback } from './oracleIrUncategorizedSpellFallback.js';
import { shouldSkipTriggerUncategorizedFallback } from './oracleIrTriggerLegacyRouting.js';
import {
  collectOracleEffectSteps,
  wouldOracleIRFallbackPrefilterMatch,
} from './trigger-runtime-wiring.js';
import { extractOracleCardLookupKeys } from './oracleIrCompiledOverlayLookup.js';
import {
  buildTriggerExecutionOptionsFromSteps,
} from './oracleIrTriggerExecutionHelpers.js';
import { debugWarn } from '../../utils/debug.js';
import { queueExploreDecisionStep } from './triggerExploreUtils.js';
import { readTriggerEffectCastXValue } from './triggerSourceUtils.js';

export interface TriggerUncategorizedFallbackDeps {
  applyCopyPermanentTriggerStep(
    ctx: GameContext,
    controller: PlayerID,
    sourceName: string,
    step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
    triggerItem?: any,
  ): number;
  queueOptionalSelfCopyFromControlledCreature(
    ctx: GameContext,
    controller: PlayerID,
    sourceName: string,
    sourcePermanentId: string,
  ): number;
  createEquippedCreatureCopyTokenFromEquipment(
    ctx: GameContext,
    controller: PlayerID,
    sourcePermanentId: string,
    description: string,
    grantsHaste: boolean,
  ): number;
}

function applyLegacyTriggerSpecialHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any | undefined,
  steps: readonly OracleEffectStep[],
  deps: TriggerUncategorizedFallbackDeps,
): number {
  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || '',
  ).trim();

  let applied = 0;
  for (const step of steps) {
    if (step.kind === 'copy_permanent') {
      applied += deps.applyCopyPermanentTriggerStep(
        ctx,
        controller,
        sourceName,
        step as Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
        triggerItem,
      );
    }
  }

  if (applied > 0) return applied;

  for (const step of steps) {
    if (step.kind === 'explore' && sourcePermanentId) {
      const targetText = String((step as { target?: { text?: string; raw?: string } }).target?.text
        || (step as { target?: { text?: string; raw?: string } }).target?.raw
        || '').trim();
      if (/this creature/i.test(targetText) && queueExploreDecisionStep(ctx, controller, sourcePermanentId)) {
        applied += 1;
      }
      continue;
    }

    if (step.kind === 'grant_temporary_ability' && (step as { optional?: boolean }).optional) {
      const effectText = Array.isArray((step as { effectText?: readonly string[] }).effectText)
        ? (step as { effectText: readonly string[] }).effectText.join(' ')
        : '';
      if (/becomes a copy of another creature you control/i.test(effectText) && sourcePermanentId) {
        applied += deps.queueOptionalSelfCopyFromControlledCreature(
          ctx,
          controller,
          sourceName,
          sourcePermanentId,
        );
      }
      continue;
    }

    if (step.kind === 'create_token') {
      const rawToken = String((step as { token?: string }).token || '').trim();
      if (/copy of equipped (?:creature|permanent)/i.test(rawToken) && sourcePermanentId) {
        applied += deps.createEquippedCreatureCopyTokenFromEquipment(
          ctx,
          controller,
          sourcePermanentId,
          description,
          Boolean((step as { grantsHaste?: string }).grantsHaste),
        );
      }
    }
  }

  return applied;
}

/**
 * Copy/explore/equipped-token bridges that still run when IR primary owns the effect
 * but the primary gate did not apply (e.g. server target queue deferrals).
 */
export function applyTriggerIrSpecialHandlersOnly(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any | undefined,
  deps: TriggerUncategorizedFallbackDeps,
): number {
  const text = String(description || '').trim();
  if (!text || !wouldOracleIRFallbackPrefilterMatch(text)) {
    return 0;
  }

  try {
    const steps = collectOracleEffectSteps(
      text,
      sourceName,
      extractOracleCardLookupKeys({ cardName: sourceName, sourceName, triggerItem }),
    );
    return applyLegacyTriggerSpecialHandlers(
      ctx,
      controller,
      sourceName,
      text,
      triggerItem,
      steps,
      deps,
    );
  } catch (err) {
    debugWarn(1, `[executeTriggerEffect] Oracle IR trigger special handlers failed for ${sourceName}:`, err);
    return 0;
  }
}

/**
 * Best-effort Oracle IR resolution for trigger effects after the primary IR gate
 * and legacy regex handlers miss. Keeps card-specific copy/explore shims only when
 * IR primary mode does not own the effect text.
 */
export function applyOracleIRTriggerUncategorizedFallback(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any | undefined,
  irCtx: OracleIRExecutionContext,
  deps: TriggerUncategorizedFallbackDeps,
): number {
  const text = String(description || '').trim();
  if (!text) return 0;

  const explicitX = typeof triggerItem?.xValue === 'number' && Number.isFinite(triggerItem.xValue)
    ? triggerItem.xValue
    : undefined;
  const xValue = explicitX ?? readTriggerEffectCastXValue((ctx as any).state, triggerItem);
  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || '',
  ).trim();
  const sourceId = String(sourcePermanentId || triggerItem?.sourceId || triggerItem?.id || '').trim();

  const specialApplied = applyTriggerIrSpecialHandlersOnly(
    ctx,
    controller,
    sourceName,
    text,
    triggerItem,
    deps,
  );
  if (specialApplied > 0) return specialApplied;

  if (shouldSkipTriggerUncategorizedFallback(text, sourceName)) {
    return 0;
  }

  return applyOracleIRUncategorizedSpellFallback(
    ctx,
    text,
    controller,
    sourceName,
    xValue,
    sourcePermanentId || undefined,
    sourceId || undefined,
    false,
    irCtx,
    'ability',
    triggerItem,
    undefined,
    buildTriggerExecutionOptionsFromSteps(
      collectOracleEffectSteps(
        text,
        sourceName,
        extractOracleCardLookupKeys({ cardName: sourceName, sourceName, triggerItem }),
      ),
      triggerItem,
    ),
  );
}
