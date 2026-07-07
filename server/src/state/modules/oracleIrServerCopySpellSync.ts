import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import {
  resolveCopiedTargetSpellStackItem,
  resolveCopySpellCount,
} from '../../../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { getStackItems } from '../../../../rules-engine/src/stackOperations.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import {
  appendCopyTriggeredAbilityResolveEvent,
  queueAbilityCopyRetargetPrompt,
} from './triggerAbilityCopyUtils.js';
import {
  buildResolvedAbilityCopySnapshot,
  buildResolvedSpellCopySnapshot,
  wasSpellCastFromGraveyard,
} from './stackResolveSpellCopyChoiceUtils.js';import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';

function isAbilityCopyStep(
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
): boolean {
  const targetText = step.target?.kind === 'raw'
    ? String(step.target.text || '').trim().toLowerCase()
    : '';
  return targetText.includes('ability');
}

function isAbilityStackItem(item: any): boolean {
  return String(item?.type || '').trim() === 'ability';
}

function resolveDeferredCopyDisplayName(item: any, isAbilityCopy: boolean): string {
  if (isAbilityCopy) {
    return String(item?.sourceName || item?.card?.name || 'that ability').trim() || 'that ability';
  }
  return String(item?.card?.name || item?.sourceName || 'that spell').trim() || 'that spell';
}

function findCopySpellStepForGap(
  result: OracleIRExecutionResult,
  gap: { readonly stepKind?: string; readonly raw?: string },
): Extract<OracleEffectStep, { kind: 'copy_spell' }> | undefined {
  const matchRaw = String(gap.raw || '');
  const matchKind = String(gap.stepKind || 'copy_spell');

  const fromApplied = (result.appliedSteps || []).find(
    (candidate) =>
      candidate.kind === 'copy_spell'
      && String(candidate.raw || '') === matchRaw,
  );
  if (fromApplied?.kind === 'copy_spell') {
    return fromApplied as Extract<OracleEffectStep, { kind: 'copy_spell' }>;
  }

  const fromSkipped = (result.skippedSteps || []).find(
    (candidate) =>
      String(candidate.kind || '') === matchKind
      && String((candidate as any).raw || '') === matchRaw,
  );
  if (fromSkipped?.kind === 'copy_spell') {
    return fromSkipped as Extract<OracleEffectStep, { kind: 'copy_spell' }>;
  }

  return undefined;
}

function appendCopiedSpellToServerStack(state: any, copiedItem: any): void {
  if (Array.isArray(state?.stack)) {
    state.stack.push(copiedItem);
    return;
  }

  if (state?.stack && typeof state.stack === 'object' && Array.isArray(state.stack.objects)) {
    state.stack.objects.push(copiedItem);
    return;
  }

  state.stack = [copiedItem];
}

function resolveTriggeringStackItemId(
  triggerItem: any | undefined,
  irCtx: OracleIRExecutionContext,
): string {
  return String(
    triggerItem?.triggeringStackItemId
    || triggerItem?.effectData?.triggeringStackItemId
    || irCtx.targetSpellId
    || irCtx.selectorContext?.targetSpellId
    || '',
  ).trim();
}

function resolveSpellsCastBeforeThisTurnCopyCount(
  state: any,
  controller: PlayerID,
): number {
  const spellsCastThisTurn = (state as any)?.spellsCastThisTurn;
  if (Array.isArray(spellsCastThisTurn)) {
    const countForController = spellsCastThisTurn.filter(
      (entry: any) => String(entry?.casterId || '').trim() === String(controller || '').trim(),
    ).length;
    return Math.max(0, countForController - 1);
  }

  const keyedCount = Number(spellsCastThisTurn?.[controller] || 0);
  return Math.max(0, Number.isFinite(keyedCount) ? keyedCount - 1 : 0);
}

function resolveDeferredCopyTargetStackItem(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  irCtx: OracleIRExecutionContext,
  triggerItem?: any,
): any | null {
  const directTargetId = String(
    irCtx.targetSpellId
    || irCtx.selectorContext?.targetSpellId
    || irCtx.selectorContext?.chosenObjectIds?.[0]
    || '',
  ).trim();

  if (step.subject === 'target_spell' && directTargetId) {
    const directItem = getStackItems(state?.stack).find(
      (item: any) => String(item?.id || '').trim() === directTargetId,
    );
    if (directItem) return directItem;
  }

  if (step.subject === 'target_spell') {
    const resolution = resolveCopiedTargetSpellStackItem({ state, step, ctx: irCtx });
    return resolution.stackItem || null;
  }

  if (step.subject === 'this_spell') {
    const triggeringStackItemId = resolveTriggeringStackItemId(triggerItem, irCtx);
    const sourceObjectType = String(irCtx.sourceObjectType || '').trim();
    const lookupId = sourceObjectType === 'ability' && triggeringStackItemId
      ? triggeringStackItemId
      : String(irCtx.sourceId || triggeringStackItemId || '').trim();
    if (!lookupId) return null;
    return getStackItems(state?.stack).find(
      (item: any) => String(item?.id || '').trim() === lookupId,
    ) || null;
  }

  return null;
}

function shouldDoubleCopyWhenCastFromGraveyard(
  params: { sourceItem?: any; oracleText?: string },
  irCtx: OracleIRExecutionContext,
): boolean {
  if (!/copy that spell twice instead/i.test(String(params.oracleText || ''))) return false;
  if (wasSpellCastFromGraveyard(params.sourceItem)) return true;
  return String(irCtx?.castFromZone || '').trim().toLowerCase() === 'graveyard';
}

function resolveServerStackCopyCount(
  state: any,
  controller: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  irCtx: OracleIRExecutionContext,
  params: {
    sourceItem?: any;
    oracleText?: string;
    gapMetadata?: Record<string, unknown>;
  },
): number {
  if (step.copies?.kind === 'spells_cast_before_this_turn') {
    const stormCount = resolveSpellsCastBeforeThisTurnCopyCount(state, controller);
    if (stormCount > 0) return stormCount;
  }

  const metadataCount = Number(params.gapMetadata?.copyCount);
  if (Number.isFinite(metadataCount) && metadataCount >= 0) {
    let count = Math.max(0, metadataCount);
    if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
      count = 2;
    }
    return count;
  }

  let count = Math.max(0, resolveCopySpellCount(state, controller, step, irCtx));
  if (
    step.copies?.kind === 'spells_cast_before_this_turn'
    && count <= 0
  ) {
    count = resolveSpellsCastBeforeThisTurnCopyCount(state, controller);
  }
  if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
    count = 2;
  }
  return count;
}

function copyRetargetMetadataFromSource(sourceItem: any): Record<string, unknown> {
  if (!sourceItem || typeof sourceItem !== 'object') return {};

  const metadata: Record<string, unknown> = {};
  if (Array.isArray(sourceItem.copyRetargetValidTargets)) {
    metadata.copyRetargetValidTargets = sourceItem.copyRetargetValidTargets.map((target: any) => (
      target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : target
    ));
  }
  if (Array.isArray(sourceItem.copyRetargetTargetTypes)) {
    metadata.copyRetargetTargetTypes = [...sourceItem.copyRetargetTargetTypes];
  }
  if (sourceItem.copyRetargetMinTargets != null) {
    metadata.copyRetargetMinTargets = sourceItem.copyRetargetMinTargets;
  }
  if (sourceItem.copyRetargetMaxTargets != null) {
    metadata.copyRetargetMaxTargets = sourceItem.copyRetargetMaxTargets;
  }
  if (sourceItem.copyRetargetTargetDescription != null) {
    metadata.copyRetargetTargetDescription = sourceItem.copyRetargetTargetDescription;
  }
  return metadata;
}

function resolveCopyRetargetMetadata(
  state: any,
  triggerItem: any | undefined,
  irCtx: OracleIRExecutionContext,
): Record<string, unknown> {
  const fromTriggerItem = copyRetargetMetadataFromSource(triggerItem);
  if (Array.isArray(fromTriggerItem.copyRetargetValidTargets)) {
    return fromTriggerItem;
  }

  const triggeringStackItemId = resolveTriggeringStackItemId(triggerItem, irCtx);
  if (!triggeringStackItemId) return fromTriggerItem;

  const triggeringStackItem = getStackItems(state?.stack).find(
    (item: any) => String(item?.id || '').trim() === triggeringStackItemId,
  );
  return {
    ...fromTriggerItem,
    ...copyRetargetMetadataFromSource(triggeringStackItem),
  };
}

function appendCopyTriggeredSpellResolveEvent(
  ctx: GameContext,
  options: {
    sourceId?: string;
    sourceName: string;
    controllerId?: string;
    triggeringStackItemId?: string;
    copiedStackItemId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      'copyTriggeredSpellResolve',
      {
        sourceId: String(options.sourceId || '').trim() || undefined,
        sourceName: String(options.sourceName || 'Spell copy').trim() || 'Spell copy',
        controllerId: String(options.controllerId || '').trim() || undefined,
        triggeringStackItemId: String(options.triggeringStackItemId || '').trim() || undefined,
        copiedStackItemId: String(options.copiedStackItemId || '').trim() || undefined,
      },
    );
  } catch (err) {
    debugWarn(
      1,
      `[oracleIR] appendEvent(copyTriggeredSpellResolve) failed for ${String(options.sourceName || 'Spell')}:`
      , err,
    );
  }
}

function queueSpellCopyRetargetChoice(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceName: string;
    copiedItem: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const validTargets = Array.isArray(params.copiedItem?.copyRetargetValidTargets)
    ? params.copiedItem.copyRetargetValidTargets
    : [];
  const currentTargets = Array.isArray(params.copiedItem?.targets) ? params.copiedItem.targets : [];
  if (validTargets.length === 0) return;

  const copyStackItemId = String(params.copiedItem?.id || '').trim();
  if (!copyStackItemId) return;

  const minTargets = Number(params.copiedItem?.copyRetargetMinTargets || currentTargets.length || 1);
  const maxTargets = Number(params.copiedItem?.copyRetargetMaxTargets || currentTargets.length || 1);
  const targetDescription = String(params.copiedItem?.copyRetargetTargetDescription || 'target');

  if (currentTargets.length === 0) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: params.controller,
      description: `${params.sourceName}: You may choose ${targetDescription} for the copy.`,
      mandatory: false,
      sourceId: copyStackItemId,
      sourceName: params.sourceName,
      validTargets: validTargets.map((target: any) => ({ ...target })),
      targetTypes: Array.isArray(params.copiedItem?.copyRetargetTargetTypes)
        ? [...params.copiedItem.copyRetargetTargetTypes]
        : ['spell_target'],
      minTargets,
      maxTargets,
      targetDescription,
      retargetSpellCopyTargetSelection: true,
      retargetSpellCopyStackItemId: copyStackItemId,
    } as any);

    appendQueuedResolutionPromptEvent(ctx, {
      playerId: params.controller,
      sourceId: copyStackItemId,
      queuedResolutionStep,
    });
    return;
  }

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: params.controller,
    description: `${params.sourceName}: You may choose new targets for the copy.`,
    mandatory: false,
    sourceId: copyStackItemId,
    sourceName: params.sourceName,
    options: [
      { id: 'keep', label: 'Keep current targets' },
      { id: 'retarget', label: 'Choose new targets' },
    ],
    minSelections: 1,
    maxSelections: 1,
    retargetSpellCopy: true,
    retargetSpellCopyStackItemId: copyStackItemId,
    retargetSpellCopyValidTargets: validTargets.map((target: any) => ({ ...target })),
    retargetSpellCopyMinTargets: minTargets,
    retargetSpellCopyMaxTargets: maxTargets,
    retargetSpellCopyTargetDescription: String(params.copiedItem?.copyRetargetTargetDescription || 'target'),
  } as any);

  appendQueuedResolutionPromptEvent(ctx, {
    playerId: params.controller,
    sourceId: copyStackItemId,
    queuedResolutionStep,
  });
}

/**
 * Push stack-target spell copies deferred by Oracle IR onto the server stack and
 * queue optional retarget prompts when `allowNewTargets` is set.
 */
export function queueCopySpellStackPushFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    sourceItem?: any;
    oracleText?: string;
  },
): boolean {
  const gaps = (result.automationGaps || []).filter(
    (gap) =>
      gap.reasonCode === 'server_stack_copy_required'
      && String(gap.stepKind || '') === 'copy_spell',
  );
  if (gaps.length === 0) return false;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const sourceName = String(params.sourceName || params.irCtx.sourceName || 'Spell').trim() || 'Spell';
  const triggerItem = params.sourceItem;
  const retargetMetadata = resolveCopyRetargetMetadata(state, triggerItem, params.irCtx);
  const queuedKeys = new Set<string>();
  let bridged = false;

  for (const gap of gaps) {
    const queueKey = `${String(gap.raw || '')}::${String(gap.stepKind || '')}`;
    if (queuedKeys.has(queueKey)) continue;

    const copyStep = findCopySpellStepForGap(result, gap);
    if (!copyStep) continue;

    const targetStackItem = resolveDeferredCopyTargetStackItem(state, copyStep, params.irCtx, triggerItem);
    if (!targetStackItem) continue;

    queuedKeys.add(queueKey);
    const copyCount = resolveServerStackCopyCount(
      state,
      params.controller,
      copyStep,
      params.irCtx,
      {
        sourceItem: params.sourceItem,
        oracleText: params.oracleText,
        gapMetadata: (gap.metadata || {}) as Record<string, unknown>,
      },
    );
    if (copyCount <= 0) continue;

    const targetName = resolveDeferredCopyDisplayName(targetStackItem, isAbilityCopyStep(copyStep));

    const triggeringStackItemId = String(targetStackItem?.id || '').trim();
    const copySourceId = String(
      params.sourceId
      || params.irCtx.sourceId
      || triggerItem?.permanentId
      || triggerItem?.source
      || '',
    ).trim();
    const triggerStackItemId = String(triggerItem?.id || '').trim();

    for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
      const abilityCopy = isAbilityCopyStep(copyStep) || isAbilityStackItem(targetStackItem);
      const copiedItem = abilityCopy
        ? {
          ...buildResolvedAbilityCopySnapshot(targetStackItem, sourceName, params.controller),
          ...retargetMetadata,
        }
        : {
          ...buildResolvedSpellCopySnapshot(targetStackItem, sourceName, params.controller),
          ...retargetMetadata,
        };
      appendCopiedSpellToServerStack(state, copiedItem);

      if (abilityCopy) {
        appendCopyTriggeredAbilityResolveEvent(ctx, {
          sourceId: copySourceId || undefined,
          sourceName,
          controllerId: params.controller,
          paid: true,
          triggerStackItemId: triggerStackItemId || undefined,
          triggeringStackItemId,
          copiedStackItemId: String(copiedItem?.id || '').trim() || undefined,
        });
      } else {
        appendCopyTriggeredSpellResolveEvent(ctx, {
          sourceId: copySourceId || undefined,
          sourceName,
          controllerId: params.controller,
          triggeringStackItemId,
          copiedStackItemId: String(copiedItem?.id || '').trim() || undefined,
        });
      }

      if (copyStep.allowNewTargets) {
        if (abilityCopy) {
          queueAbilityCopyRetargetPrompt(ctx, sourceName, params.controller, copiedItem);
        } else {
          queueSpellCopyRetargetChoice(ctx, {
            controller: params.controller,
            sourceName,
            copiedItem,
          });
        }
      }
    }

    (ctx as any).io?.to?.(gameId)?.emit?.('chat', {
      id: `m_${Date.now()}_${queuedKeys.size}`,
      gameId,
      from: 'system',
      message: `${sourceName} copies ${targetName}${copyCount > 1 ? ` ${copyCount} times` : ''}.`,
      ts: Date.now(),
    });

    debug(
      2,
      `[oracleIR] ${sourceName}: pushed ${copyCount} stack ${isAbilityCopyStep(copyStep) || isAbilityStackItem(targetStackItem) ? 'abilit' : 'spell'} cop${copyCount === 1 ? 'y' : 'ies'} of ${targetName}`,
    );
    bridged = true;
  }

  if (bridged && typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  return bridged;
}
