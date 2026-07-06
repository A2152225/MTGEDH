import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { debugWarn } from '../../utils/debug.js';
import { popStackItem } from './stackPushUtils.js';
import { isPermanentTypeLine } from './stackResolvePermanentSpellTypeUtils.js';
import { resolvePermanentSpellBattlefieldEntry } from './stackResolvePermanentEntryUtils.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { enterResolutionMode, exitResolutionMode } from './priority.js';
import { clearOptionalPaymentCallbacks } from '../../socket/optional-payment-prompts.js';
import { maybeResumeDeferredOracleIrStackSpell } from './oracleIrDeferredStackFinalize.js';
import { restoreAllPendingEffectProgramRuntimes } from '../effects/effectProgramReplayRestore.js';
import { resumeOracleIrPendingCompoundStepsFromState } from './oracleIrServerZoneSync.js';
import { scrubStalePerPlayerOptionalEffectProgramSteps } from './triggerCounterPlacementPromptUtils.js';

/**
 * Legacy / in-flight prompt state that must not survive event replay.
 * These fields drive processPending* migrations and cast-payment re-prompts on reconnect.
 */
const REPLAY_TRANSIENT_PROMPT_STATE_KEYS = [
  'pendingScry',
  'pendingSurveil',
  'pendingCascade',
  'pendingProliferate',
  'pendingPonder',
  'pendingBottomOrder',
  'pendingLimDulsVault',
  'pendingDanceWithCalamity',
  'pendingSpellCasts',
  'pendingTargets',
  'pendingBlightAbilityActivations',
  'pendingTriggerOrdering',
  'pendingKynaiosChoice',
  'pendingCommanderZoneChoice',
  'pendingDiscardSelection',
  'pendingOpponentSelections',
  'pendingForetellCasts',
  'pendingDamageTriggers',
  'pendingLibrarySearch',
  'pendingModalChoice',
  'pendingMayAbility',
  'oracleIrPendingResumeStepsJson',
  'oracleIrPendingResumeControllerId',
  'oracleIrPendingResumeSourceId',
  'oracleIrPendingResumeSourceName',
] as const;

/**
 * While replaying, pushTriggeredAbility restores stack timing but resolveTopOfStack
 * is skipped. When a persisted oracle_ir executeEffect follows, drop the matching
 * triggered ability so live priority/stack resolution cannot re-apply it.
 */
export function consumeReplayedTriggeredAbilityStackItems(
  ctx: GameContext,
  event: Record<string, unknown>,
): void {
  if (!(ctx as any).isReplaying) return;

  const controllerId = String(event.controllerId || event.playerId || '').trim();
  const sourceName = String(
    event.oracleIrSourceName || event.effectProgramSourceName || event.sourceName || '',
  ).trim();
  const sourceId = String(
    event.oracleIrSourceId || event.effectProgramSourceId || event.sourceId || '',
  ).trim();
  if (!sourceName && !sourceId) return;

  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (stack.length === 0) return;

  const nextStack = stack.filter((item: any) => {
    if (!item || item.type !== 'triggered_ability') return true;

    const itemController = String(item.controller || '').trim();
    if (controllerId && itemController && itemController !== controllerId) return true;

    const itemSourceName = String(item.sourceName || '').trim();
    if (sourceName && itemSourceName && itemSourceName === sourceName) return false;

    const itemSource = String(item.source || item.permanentId || '').trim();
    if (sourceId && itemSource && itemSource === sourceId) return false;

    return true;
  });

  if (nextStack.length !== stack.length) {
    (ctx.state as any).stack = nextStack;
  }
}

function isReplayableSpellStackItem(item: any): boolean {
  if (!item || !item.card) return false;
  const itemType = String(item.type || '').toLowerCase();
  if (
    itemType === 'triggered_ability'
    || itemType === 'activated_ability'
    || itemType === 'mana_ability'
    || itemType === 'ability'
  ) {
    return false;
  }
  return itemType === '' || itemType === 'spell';
}

function resolveReplaySpellCard(stackItem: any): any | null {
  const rawCard = stackItem?.card;
  if (!rawCard || typeof rawCard !== 'object') return null;
  if (rawCard.card && typeof rawCard.card === 'object' && !Array.isArray(rawCard.card)) {
    return rawCard.card;
  }
  return rawCard;
}

/**
 * Permanent spells do not yet persist a dedicated battlefield-entry mutation event.
 * During undo/replay, rebuild the resolved permanent from the stack item snapshot
 * before popping it so cast + resolveTopOfStack event pairs restore the battlefield.
 */
export function replayApplyResolvedPermanentSpellBattlefieldEntry(ctx: GameContext): void {
  if (!(ctx as any).isReplaying) return;

  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (stack.length === 0) return;

  const item = stack[stack.length - 1];
  if (!isReplayableSpellStackItem(item)) return;

  const effectiveCard = resolveReplaySpellCard(item);
  if (!effectiveCard || typeof effectiveCard !== 'object') return;

  const effectiveTypeLine = String(
    effectiveCard.type_line || item?.card?.type_line || '',
  );
  if (!isPermanentTypeLine(effectiveTypeLine)) return;

  const controller = String(item.controller || '').trim() as PlayerID;
  const cardId = String(effectiveCard.id || '').trim();
  if (!controller || !cardId) return;

  const battlefield = Array.isArray((ctx.state as any).battlefield)
    ? (ctx.state as any).battlefield
    : [];
  const stackItemId = String(item.id || '').trim();
  const alreadyPresent = battlefield.some((perm: any) => {
    if (!perm) return false;
    if (stackItemId && String(perm.id || '') === stackItemId) return true;
    return String(perm.controller || '') === controller
      && String(perm.card?.id || '') === cardId;
  });
  if (alreadyPresent) return;

  try {
    resolvePermanentSpellBattlefieldEntry(ctx, {
      controller,
      card: item.card,
      effectiveCard,
      effectiveTypeLine,
      item,
      targets: item.targets,
      fallbackOracleText: String(effectiveCard.oracle_text || ''),
      preferredPermanentId: stackItemId || undefined,
    });
  } catch (err) {
    debugWarn(1, '[replay] permanent spell battlefield entry failed:', err);
  }
}

/**
 * During event replay, resolveTopOfStack must not re-run live IR/trigger handlers
 * (outcomes are in executeEffect / mutation events), but it must still pop the
 * stack item that was resolved when the event was originally logged.
 */
export function replayPopTopOfStackDuringEventReplay(ctx: GameContext): void {
  if (!(ctx as any).isReplaying) return;
  replayApplyResolvedPermanentSpellBattlefieldEntry(ctx);
  popStackItem(ctx);
}

const STACK_PUSH_REPLAY_EVENT_TYPES = new Set([
  'pushTriggeredAbility',
  'pushStack',
]);

/**
 * After a full replay, drop triggered abilities that were resolved earlier in the
 * game but left on the stack because resolveTopOfStack replay used to no-op.
 * Preserves a legitimately pending trigger when the event log ends on a push.
 */
export function scrubStaleReplayedStackAfterFullReplay(ctx: GameContext): void {
  const gameId = String(ctx?.gameId || '').trim();
  if (!gameId) return;

  let hasPendingResolutionSteps = false;
  try {
    hasPendingResolutionSteps = ResolutionQueueManager.getPendingSummary(gameId).hasPending;
  } catch {
    // best-effort only
  }
  if (hasPendingResolutionSteps) return;

  const lastReplayEventType = String((ctx as any)._replayLastEventType || '').trim();
  if (STACK_PUSH_REPLAY_EVENT_TYPES.has(lastReplayEventType)) {
    return;
  }

  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (stack.length === 0) return;

  const hasDeferredOrSpellStackItem = stack.some((item: any) => {
    if (!item || typeof item !== 'object') return false;
    if (item.oracleIrDeferredFinalize === true) return true;
    if (String(item.type || '').toLowerCase() === 'spell') return true;
    if (String(item.type || '').toLowerCase() !== 'triggered_ability') return true;
    return false;
  });
  if (hasDeferredOrSpellStackItem) return;

  const allTriggeredAbilities = stack.every(
    (item: any) => String(item?.type || '').toLowerCase() === 'triggered_ability',
  );
  if (!allTriggeredAbilities) return;

  (ctx.state as any).stack = [];

  try {
    const state = ctx.state as any;
    const turnPlayer = String(state.turnPlayer || '').trim();
    const phase = String(state.phase || '').toLowerCase();
    const step = String(state.step || '').toUpperCase();
    if (
      turnPlayer
      && phase !== 'pre_game'
      && phase !== 'pre-game'
      && !['UNTAP', 'CLEANUP'].includes(step)
    ) {
      state.priority = turnPlayer;
      state.priorityPassedBy = new Set<string>();
      state.priorityClaimed = new Set<string>();
    }
  } catch {
    // best-effort only
  }
}

export function clearReplayTransientPromptState(state: any): void {
  if (!state || typeof state !== 'object') return;

  for (const key of REPLAY_TRANSIENT_PROMPT_STATE_KEYS) {
    try {
      delete state[key];
    } catch {
      // best-effort only
    }
  }

  delete state._priorityAfterResolution;
}

/**
 * After rebuilding game state from the event log, drop any UI prompts that were
 * re-created while replaying. Completed choices live in persisted events only.
 */
export function finalizeGameStateAfterReplay(ctx: GameContext): void {
  const gameId = String(ctx?.gameId || '').trim();
  if (!gameId) return;

  try {
    ResolutionQueueManager.endReplay(gameId);
    clearOptionalPaymentCallbacks(gameId);
  } catch {
    // best-effort only
  }

  let hasPendingResolutionSteps = false;
  try {
    hasPendingResolutionSteps = ResolutionQueueManager.getPendingSummary(gameId).hasPending;
  } catch {
    // best-effort only
  }

  if (hasPendingResolutionSteps) {
    try {
      scrubStalePerPlayerOptionalEffectProgramSteps(gameId);
    } catch {
      // best-effort only
    }

    try {
      restoreAllPendingEffectProgramRuntimes(ctx as any, gameId);
    } catch {
      // best-effort only
    }

    try {
      if ((ctx.state as any)?.priority !== null) {
        enterResolutionMode(ctx);
      }
    } catch {
      // best-effort only
    }
  }

  // Scry/surveil/library-search compound spells persist resume steps on the
  // choice event; when the replay batch omits a trailing drawCards event,
  // finish the draw and append it for event-log determinism.
  try {
    if (String((ctx.state as any)?.oracleIrPendingResumeStepsJson || '').trim()) {
      resumeOracleIrPendingCompoundStepsFromState(ctx);
    }
  } catch {
    // best-effort only
  }

  try {
    clearReplayTransientPromptState(ctx.state as any);
  } catch {
    // best-effort only
  }

  try {
    if (!hasPendingResolutionSteps && (ctx.state as any)?.priority === null) {
      exitResolutionMode(ctx);
    }
  } catch {
    // best-effort only
  }

  try {
    if (!hasPendingResolutionSteps) {
      maybeResumeDeferredOracleIrStackSpell(ctx);
    }
  } catch {
    // best-effort only
  }

  try {
    scrubStaleReplayedStackAfterFullReplay(ctx);
  } catch {
    // best-effort only
  }
}
