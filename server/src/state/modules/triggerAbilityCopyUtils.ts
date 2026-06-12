import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { broadcastGame, consumeManaFromPool, getOrInitManaPool, parseManaCost } from '../../socket/util.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';

const OPTIONAL_COPY_ABILITY_PAYMENT_PATTERN = /^you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*if you do,\s*copy that ability(?:\.|(?:\.\s*you may choose new targets for the copy\.))?$/i;
const DIRECT_COPY_ABILITY_PATTERN = /^copy that ability(?:\.|(?:\.\s*you may choose new targets for the copy\.))?$/i;

export function cloneStackItemForAbilityCopy(
  ctx: GameContext,
  sourceName: string,
  controller: PlayerID,
  triggeringStackItemId: unknown,
): any | null {
  const state: any = (ctx as any).state;
  const stack = Array.isArray(state?.stack) ? state.stack : [];
  const targetStackItemId = String(triggeringStackItemId || '').trim();
  if (!targetStackItemId) {
    debugWarn(2, `[resolveTopOfStack] ${sourceName}: missing triggering stack item for copy effect`);
    return null;
  }

  const original = stack.find((entry: any) => entry && String(entry.id || '') === targetStackItemId);
  if (!original) {
    debugWarn(2, `[resolveTopOfStack] ${sourceName}: triggering stack item ${targetStackItemId} no longer exists`);
    return null;
  }

  if ((original as any).type === 'mana_ability') {
    debugWarn(2, `[resolveTopOfStack] ${sourceName}: refusing to copy mana ability ${targetStackItemId}`);
    return null;
  }

  const copiedItem: any = {
    ...original,
    id: uid('copied_ability'),
    controller: String((original as any).controller || controller),
    targets: Array.isArray((original as any).targets)
      ? (original as any).targets.map((target: any) => (
          target && typeof target === 'object' && !Array.isArray(target)
            ? { ...target }
            : target
        ))
      : (original as any).targets,
    card: (original as any).card ? { ...(original as any).card } : (original as any).card,
    ability: (original as any).ability ? { ...(original as any).ability } : (original as any).ability,
    searchParams: (original as any).searchParams ? { ...(original as any).searchParams } : (original as any).searchParams,
    upgradeData: (original as any).upgradeData ? { ...(original as any).upgradeData } : (original as any).upgradeData,
    equipParams: (original as any).equipParams ? { ...(original as any).equipParams } : (original as any).equipParams,
    fortifyParams: (original as any).fortifyParams ? { ...(original as any).fortifyParams } : (original as any).fortifyParams,
    reconfigureParams: (original as any).reconfigureParams ? { ...(original as any).reconfigureParams } : (original as any).reconfigureParams,
    copiedFromStackItemId: targetStackItemId,
    copiedBySourceName: sourceName,
    isCopy: true,
  };

  stack.push(copiedItem);

  const gameId = (ctx as any).gameId || 'unknown';
  const io = (ctx as any).io;
  const copiedName = String((original as any).sourceName || (original as any).card?.name || 'an ability');
  io?.to?.(gameId)?.emit?.('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName} copies ${copiedName}.`,
    ts: Date.now(),
  });

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }
  if (io) {
    broadcastGame(io as any, ctx as any, gameId);
  }
  return copiedItem;
}

export function appendCopyTriggeredAbilityResolveEvent(
  ctx: GameContext,
  options: {
    sourceId?: string;
    sourceName: string;
    controllerId?: string;
    paid?: boolean;
    manaCost?: string;
    triggerStackItemId?: string;
    triggeringStackItemId?: string;
    copiedStackItemId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || 'unknown');
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) {
    return;
  }

  try {
    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0), 'copyTriggeredAbilityResolve', {
      sourceId: String(options.sourceId || '').trim() || undefined,
      sourceName: String(options.sourceName || 'Ability').trim() || 'Ability',
      controllerId: String(options.controllerId || '').trim() || undefined,
      paid: options.paid !== false,
      manaCost: String(options.manaCost || '').trim() || undefined,
      triggerStackItemId: String(options.triggerStackItemId || '').trim() || undefined,
      triggeringStackItemId: String(options.triggeringStackItemId || '').trim() || undefined,
      copiedStackItemId: String(options.copiedStackItemId || '').trim() || undefined,
    });
  } catch (err) {
    debugWarn(1, `[resolveTopOfStack] appendEvent(copyTriggeredAbilityResolve) failed for ${String(options.sourceName || 'Ability')}:`, err);
  }
}

export function queueAbilityCopyRetargetPrompt(
  ctx: GameContext,
  sourceName: string,
  controller: PlayerID,
  copiedItem: any,
): void {
  const validTargets = Array.isArray((copiedItem as any)?.copyRetargetValidTargets)
    ? (copiedItem as any).copyRetargetValidTargets
    : [];
  const currentTargets = Array.isArray((copiedItem as any)?.targets) ? (copiedItem as any).targets : [];
  if (validTargets.length === 0) return;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId) {
    return;
  }

  const minTargets = Number((copiedItem as any)?.copyRetargetMinTargets || currentTargets.length || 1);
  const maxTargets = Number((copiedItem as any)?.copyRetargetMaxTargets || currentTargets.length || 1);
  const targetDescription = String((copiedItem as any)?.copyRetargetTargetDescription || 'target');
  const copyStackItemId = String((copiedItem as any).id || '').trim();

  if (currentTargets.length === 0) {
    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controller,
      description: `${sourceName}: You may choose ${targetDescription} for the copy.`,
      mandatory: false,
      sourceId: copyStackItemId || undefined,
      sourceName,
      validTargets,
      targetTypes: Array.isArray((copiedItem as any)?.copyRetargetTargetTypes)
        ? (copiedItem as any).copyRetargetTargetTypes
        : ['spell_target'],
      minTargets,
      maxTargets,
      targetDescription,
      retargetAbilityCopyTargetSelection: true,
      retargetAbilityCopyStackItemId: copyStackItemId,
    } as any);
    return;
  }

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller,
    description: `${sourceName}: You may choose new targets for the copy.`,
    mandatory: false,
    sourceId: String((copiedItem as any).id || '').trim() || undefined,
    sourceName,
    options: [
      { id: 'keep', label: 'Keep current targets' },
      { id: 'retarget', label: 'Choose new targets' },
    ],
    minSelections: 1,
    maxSelections: 1,
    retargetAbilityCopy: true,
    retargetAbilityCopyStackItemId: String((copiedItem as any).id || '').trim(),
    retargetAbilityCopyValidTargets: validTargets,
    retargetAbilityCopyTargetTypes: Array.isArray((copiedItem as any)?.copyRetargetTargetTypes)
      ? (copiedItem as any).copyRetargetTargetTypes
      : [],
    retargetAbilityCopyMinTargets: minTargets,
    retargetAbilityCopyMaxTargets: maxTargets,
    retargetAbilityCopyTargetDescription: targetDescription,
  } as any);
}

export function tryDeferCopyTriggeredAbilityPrompts(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  trimmedDescription: string,
  triggerType: string,
  state: any,
): boolean {
  if (
    isOracleIrTriggerPrimaryEnabled()
    && isTriggerEffectOwnedByOracleIrPrimary(trimmedDescription, sourceName)
  ) {
    return false;
  }

  const optionalCopyAbilityMatch = triggerType === 'ability_activated'
    ? trimmedDescription.match(OPTIONAL_COPY_ABILITY_PAYMENT_PATTERN)
    : null;
  const isDirectAbilityCopy = triggerType === 'ability_activated' && DIRECT_COPY_ABILITY_PATTERN.test(trimmedDescription);
  const allowsRetargetingCopy = /choose new targets for the copy\./i.test(trimmedDescription);

  if (optionalCopyAbilityMatch && !(ctx as any).isReplaying) {
    const manaCost = String(optionalCopyAbilityMatch[1] || '').trim();
    const gameId = (ctx as any).gameId || 'unknown';
    const persistCopyTriggeredAbilityResolve = (paid: boolean, copiedItemId?: string) => {
      appendCopyTriggeredAbilityResolveEvent(ctx, {
        sourceId: String((item as any).source || sourceId || '').trim() || undefined,
        sourceName,
        controllerId: String(triggerController || '').trim(),
        paid,
        manaCost,
        triggerStackItemId: String((item as any).id || '').trim() || undefined,
        triggeringStackItemId: String((item as any).triggeringStackItemId || '').trim(),
        copiedStackItemId: String(copiedItemId || '').trim() || undefined,
      });
    };

    queueOptionalPaymentStep(gameId, {
      playerId: triggerController as PlayerID,
      sourceName,
      sourceId: String((item as any).source || sourceId || '').trim() || undefined,
      description: `${sourceName}: ${trimmedDescription}`,
      mandatory: false,
      payChoiceId: 'pay',
      payLabel: `Pay ${manaCost}`,
      payDescription: 'Copy that ability.',
      declineChoiceId: 'decline',
      declineLabel: 'Decline',
      declineDescription: 'Do not copy that ability.',
      validationKind: 'mana',
      manaCost,
      stepData: {
        triggeringStackItemId: String((item as any).triggeringStackItemId || '').trim(),
        copyTriggeredAbilityChoice: true,
        cardName: sourceName,
      },
      onPay: async () => {
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool(state as any, triggerController as PlayerID);
        consumeManaFromPool(pool as any, parsedCost.colors, parsedCost.generic, `[copyAbilityTrigger:${sourceName}]`);
        const copiedItem = cloneStackItemForAbilityCopy(ctx, sourceName, triggerController as PlayerID, (item as any).triggeringStackItemId);
        if (copiedItem) {
          persistCopyTriggeredAbilityResolve(true, String((copiedItem as any).id || '').trim());
        }
        if (copiedItem && allowsRetargetingCopy) {
          queueAbilityCopyRetargetPrompt(ctx, sourceName, triggerController as PlayerID, copiedItem);
        }
      },
      onDecline: async () => {
        persistCopyTriggeredAbilityResolve(false);
        if (typeof (ctx as any).bumpSeq === 'function') {
          (ctx as any).bumpSeq();
        }
        const io = (ctx as any).io;
        if (io) {
          broadcastGame(io as any, ctx as any, gameId);
        }
      },
    });
    debug(2, `[resolveTopOfStack] Deferred optional payment copy trigger for ${sourceName} (${triggerController})`);
    return true;
  }

  if (isDirectAbilityCopy) {
    const copiedItem = cloneStackItemForAbilityCopy(ctx, sourceName, triggerController as PlayerID, (item as any).triggeringStackItemId);
    if (copiedItem) {
      appendCopyTriggeredAbilityResolveEvent(ctx, {
        sourceId: String((item as any).source || sourceId || '').trim() || undefined,
        sourceName,
        controllerId: String(triggerController || '').trim(),
        paid: true,
        triggerStackItemId: String((item as any).id || '').trim() || undefined,
        triggeringStackItemId: String((item as any).triggeringStackItemId || '').trim(),
        copiedStackItemId: String((copiedItem as any).id || '').trim() || undefined,
      });
    }
    if (copiedItem && allowsRetargetingCopy) {
      queueAbilityCopyRetargetPrompt(ctx, sourceName, triggerController as PlayerID, copiedItem);
    }
    return true;
  }

  return false;
}
