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
import { resolvePlayers } from '../../../../rules-engine/src/oracleIRExecutorPlayerResolvePlayers.js';
import { controllerHasLeftTheGame } from '../../../../rules-engine/src/playerInGameStatus.js';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../../../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';
import {
  applyRandomRetargetToStackSpells,
  changeTargetMentionsCopies,
  isRandomChangeTargetStep,
  resolveChangeTargetExcludeText,
} from '../../../../rules-engine/src/oracleIRExecutorChangeTargetSupport.js';
import { getStackItems } from '../../../../rules-engine/src/stackOperations.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { queueCastFromExileResolutionPrompt } from './triggerCastFromExileUtils.js';
import {
  appendCopyTriggeredAbilityResolveEvent,
  queueAbilityCopyRetargetPrompt,
} from './triggerAbilityCopyUtils.js';
import {
  buildResolvedAbilityCopySnapshot,
  buildResolvedSpellCopySnapshot,
  wasSpellCastFromGraveyard,
} from './stackResolveSpellCopyChoiceUtils.js';import { appendEvent } from '../../db/index.js';
import { persistNamedSpellCastThisGame } from './namedSpellsCastThisGame.js';
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
  } else if (state?.stack && typeof state.stack === 'object' && Array.isArray(state.stack.objects)) {
    state.stack.objects.push(copiedItem);
  } else {
    state.stack = [copiedItem];
  }

  if (String(copiedItem?.type || '').toLowerCase() === 'spell') {
    persistNamedSpellCastThisGame(state, String(copiedItem?.controller || '').trim(), {
      name: copiedItem?.card?.name,
      id: copiedItem?.id,
    });
  }
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
    const stackItems = getStackItems(state?.stack);
    if (lookupId) {
      const byId = stackItems.find(
        (item: any) => String(item?.id || '').trim() === lookupId,
      );
      if (byId) return byId;
    }

    // On-cast self triggers often set sourceId to the card id (not stack id).
    // Fall back to the matching cast spell still on the stack.
    const sourceCardId = String(
      triggerItem?.card?.id
      || irCtx.sourceId
      || triggerItem?.source
      || '',
    ).trim();
    const sourceName = String(
      irCtx.sourceName
      || triggerItem?.sourceName
      || triggerItem?.card?.name
      || '',
    ).trim().toLowerCase();
    const controller = String(irCtx.controllerId || triggerItem?.controller || '').trim();
    const byCard = stackItems.find((item: any) => {
      if (String(item?.type || '').trim() === 'triggered_ability') return false;
      if (controller && String(item?.controller || '').trim() !== controller) return false;
      const itemCardId = String(item?.card?.id || '').trim();
      if (sourceCardId && itemCardId && itemCardId === sourceCardId) return true;
      if (sourceName) {
        const itemName = String(item?.card?.name || item?.name || '').trim().toLowerCase();
        if (itemName && itemName === sourceName) return true;
      }
      return false;
    });
    return byCard || null;
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

function isCommanderCastFromCommandZoneCopyStep(
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
): boolean {
  if (step.copies?.kind !== 'reference_amount') return false;
  const raw = String(step.copies.raw || '').trim().toLowerCase();
  return /commander.*command zone.*this game/.test(raw);
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
  if (Number.isFinite(metadataCount) && metadataCount > 0) {
    let count = Math.max(0, metadataCount);
    if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
      count = 2;
    }
    return count;
  }

  // Sticky copyCount:0 from a prior IR miss: re-resolve commander-CZ reference amounts from tax.
  // Other copy steps keep an explicit 0 so we do not invent copies.
  if (
    Number.isFinite(metadataCount)
    && metadataCount === 0
    && !isCommanderCastFromCommandZoneCopyStep(step)
  ) {
    return 0;
  }

  let count = Math.max(0, resolveCopySpellCount(state, controller, step, irCtx));
  if (
    count <= 0
    && isCommanderCastFromCommandZoneCopyStep(step)
  ) {
    count = resolveCommanderCastsFromCommandZoneThisGame(state, controller);
  }
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

function orderCopyControllerIdsByAPNAP(state: any, controllerIds: readonly string[]): string[] {
  const wanted = new Set(
    controllerIds.map((id) => String(id || '').trim()).filter(Boolean),
  );
  if (wanted.size === 0) return [];

  const players = Array.isArray(state?.players) ? state.players : [];
  const turnOrder = players
    .map((player: any) => String(player?.id || '').trim())
    .filter(Boolean);
  const activePlayerId = String(
    state?.activePlayer || state?.turnPlayer || turnOrder[0] || '',
  ).trim();
  const activeIndex = Math.max(0, turnOrder.indexOf(activePlayerId));
  const apnapOrder = activeIndex > 0
    ? [...turnOrder.slice(activeIndex), ...turnOrder.slice(0, activeIndex)]
    : turnOrder;

  const ordered = apnapOrder.filter((id: string) => wanted.has(id));
  for (const id of wanted) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

function copySpellIsEachOtherPlayer(
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
): boolean {
  const raw = String(step.raw || '');
  const whoText = step.who?.kind === 'raw' ? String(step.who.text || '') : '';
  return /each other player/i.test(raw) || /each other player/i.test(whoText);
}

/**
 * Hive Mind copies aren't cast, so other players never announced modes (CR 601.2b).
 * Drop inherited selectedModes so each copy controller gets a choose_mode prompt.
 */
function withoutInheritedSpellModeChoices(copiedItem: any): any {
  if (!copiedItem || typeof copiedItem !== 'object') return copiedItem;
  const next = { ...copiedItem };
  delete next.selectedModes;
  delete next.selectedModeDescriptions;
  if (next.card && typeof next.card === 'object' && !Array.isArray(next.card)) {
    const nextCard = { ...next.card };
    delete nextCard.selectedModes;
    delete nextCard.selectedModeDescriptions;
    next.card = nextCard;
  }
  return next;
}

function resolveCopySpellControllerIds(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  irCtx: OracleIRExecutionContext,
  params: {
    triggerControllerId: string;
    copiedSpellControllerId: string;
  },
): string[] {
  const triggerControllerId = String(params.triggerControllerId || '').trim();
  const livingTriggerController = triggerControllerId && !controllerHasLeftTheGame(state, triggerControllerId)
    ? [triggerControllerId]
    : [];
  if (!step.who) {
    return livingTriggerController;
  }

  const isEachOtherPlayer = copySpellIsEachOtherPlayer(step);
  const referenceControllerId = isEachOtherPlayer
    ? (String(params.copiedSpellControllerId || '').trim() || triggerControllerId)
    : triggerControllerId;

  const resolved = resolvePlayers(
    state,
    step.who,
    {
      ...irCtx,
      controllerId: (referenceControllerId || irCtx.controllerId) as PlayerID,
    },
  );
  const ids = resolved.map((id) => String(id || '').trim()).filter(Boolean)
    .filter((id) => !controllerHasLeftTheGame(state, id));
  if (ids.length === 0) {
    return livingTriggerController;
  }
  return orderCopyControllerIdsByAPNAP(state, ids);
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
  if (controllerHasLeftTheGame(ctx.state, params.controller)) return;

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
  const randomCopyRetarget = (result.appliedSteps || []).find(
    (step): step is Extract<OracleEffectStep, { kind: 'change_target' }> =>
      isRandomChangeTargetStep(step) && changeTargetMentionsCopies(step as Extract<OracleEffectStep, { kind: 'change_target' }>),
  );
  const queuedKeys = new Set<string>();
  let bridged = false;

  for (const gap of gaps) {
    const queueKey = `${String(gap.raw || '')}::${String(gap.stepKind || '')}`;
    if (queuedKeys.has(queueKey)) continue;

    const copyStep = findCopySpellStepForGap(result, gap);
    if (!copyStep) continue;

    const targetStackItem = resolveDeferredCopyTargetStackItem(state, copyStep, params.irCtx, triggerItem);

    if (copyStep.optional === true && copyStep.subject === 'this_spell') {
      const snapshotItem = targetStackItem || params.sourceItem;
      if (snapshotItem && typeof snapshotItem === 'object') {
        (snapshotItem as any).oracleIrOptionalCopyThisSpell = true;
      }
      queuedKeys.add(queueKey);
      bridged = true;
      continue;
    }

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
    const copiedSpellControllerId = String(
      targetStackItem?.controller
      || targetStackItem?.controllerId
      || '',
    ).trim();
    const copyControllers = resolveCopySpellControllerIds(state, copyStep, params.irCtx, {
      triggerControllerId: String(params.controller || ''),
      copiedSpellControllerId,
    });
    if (copyControllers.length === 0) continue;

    let pushedCopyCount = 0;
    for (const copyController of copyControllers) {
      const copyControllerId = copyController as PlayerID;
      if (controllerHasLeftTheGame(state, copyControllerId)) continue;
      for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
        const abilityCopy = isAbilityCopyStep(copyStep) || isAbilityStackItem(targetStackItem);
        let copiedItem = abilityCopy
          ? {
            ...buildResolvedAbilityCopySnapshot(targetStackItem, sourceName, copyControllerId),
            ...(randomCopyRetarget ? {} : retargetMetadata),
          }
          : {
            ...buildResolvedSpellCopySnapshot(targetStackItem, sourceName, copyControllerId),
            ...(randomCopyRetarget ? {} : retargetMetadata),
          };
        if (!abilityCopy && copySpellIsEachOtherPlayer(copyStep)) {
          copiedItem = withoutInheritedSpellModeChoices(copiedItem);
        }
        appendCopiedSpellToServerStack(state, copiedItem);
        pushedCopyCount += 1;

        if (abilityCopy) {
          appendCopyTriggeredAbilityResolveEvent(ctx, {
            sourceId: copySourceId || undefined,
            sourceName,
            controllerId: copyControllerId,
            paid: true,
            triggerStackItemId: triggerStackItemId || undefined,
            triggeringStackItemId,
            copiedStackItemId: String(copiedItem?.id || '').trim() || undefined,
          });
        } else {
          appendCopyTriggeredSpellResolveEvent(ctx, {
            sourceId: copySourceId || undefined,
            sourceName,
            controllerId: copyControllerId,
            triggeringStackItemId,
            copiedStackItemId: String(copiedItem?.id || '').trim() || undefined,
          });
        }

        if (randomCopyRetarget) {
          const retargeted = applyRandomRetargetToStackSpells(
            state,
            [String(copiedItem?.id || '').trim()].filter(Boolean),
            params.irCtx,
            randomCopyRetarget.exclude,
            resolveChangeTargetExcludeText(randomCopyRetarget),
          );
          if (retargeted.state && retargeted.state !== state) {
            Object.assign(state, retargeted.state);
          }
        } else if (copyStep.allowNewTargets) {
          if (abilityCopy) {
            queueAbilityCopyRetargetPrompt(ctx, sourceName, copyControllerId, copiedItem);
          } else {
            queueSpellCopyRetargetChoice(ctx, {
              controller: copyControllerId,
              sourceName,
              copiedItem,
            });
          }
        }
      }
    }

    (ctx as any).io?.to?.(gameId)?.emit?.('chat', {
      id: `m_${Date.now()}_${queuedKeys.size}`,
      gameId,
      from: 'system',
      message: `${sourceName} copies ${targetName}${pushedCopyCount > 1 ? ` ${pushedCopyCount} times` : ''}.`,
      ts: Date.now(),
    });

    debug(
      2,
      `[oracleIR] ${sourceName}: pushed ${pushedCopyCount} stack ${isAbilityCopyStep(copyStep) || isAbilityStackItem(targetStackItem) ? 'abilit' : 'spell'} cop${pushedCopyCount === 1 ? 'y' : 'ies'} of ${targetName}`,
    );
    bridged = true;
  }

  if (bridged && typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  return bridged;
}

/**
 * After IR applies optional copy_spell ("you may cast the copy"), queue a
 * cast-from-exile choice for each newly created playable copy.
 */
export function queueCastableCopiedSpellPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const appliedOptionalCopy = (result.appliedSteps || []).some(
    (step) => step.kind === 'copy_spell' && (step as any).optional === true,
  );
  if (!appliedOptionalCopy) return;

  const controllerId = String(params.controller || '').trim();
  if (!controllerId) return;
  if (controllerHasLeftTheGame(state, controllerId)) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const zoneExile = Array.isArray(state?.zones?.[controllerId]?.exile)
    ? state.zones[controllerId].exile
    : [];
  const playerExile = Array.isArray(
    (state?.players || []).find((player: any) => String(player?.id || '') === controllerId)?.exile,
  )
    ? (state.players || []).find((player: any) => String(player?.id || '') === controllerId)?.exile
    : [];
  const copies = [...zoneExile, ...playerExile].filter((card: any) => {
    if (!card || card.isCopy !== true) return false;
    return String(card.canBePlayedBy || '') === controllerId;
  });
  const seen = new Set<string>();
  for (const copy of copies) {
    const copyId = String(copy?.id || '').trim();
    if (!copyId || seen.has(copyId)) continue;
    seen.add(copyId);
    queueCastFromExileResolutionPrompt(
      ctx,
      gameId,
      controllerId as PlayerID,
      sourceName,
      sourceId,
      undefined,
      copy,
      {
        declineDestination: 'exile',
        description: `${sourceName}: You may cast ${String(copy?.name || 'the copy')} without paying its mana cost.`,
      },
    );
  }
}
