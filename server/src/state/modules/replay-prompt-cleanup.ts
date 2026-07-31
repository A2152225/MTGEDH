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
import { pruneObsoleteResolutionQueueAfterReplay } from '../resolution/replayCleanup.js';
import { wouldAutoDeclineOptionalTriggeredAbility } from './stackResolveTriggeredAbilityOptionalUtils.js';

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
  // pendingSpellCasts is restored by castSpellContinuation for in-progress casts and
  // cleared by castSpell / pruneObsoleteResolutionQueueAfterReplay when the cast completes.
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

/** Drop activated-ability stack items whose outcome was already restored via a persisted mutation event. */
export function consumeReplayedActivatedAbilityStackItems(
  ctx: GameContext,
  event: Record<string, unknown>,
): void {
  if (!(ctx as any).isReplaying) return;

  const controllerId = String(event.controllerId || '').trim();
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
    if (!item || String(item.type || '') !== 'ability') return true;

    const itemController = String(item.controller || '').trim();
    if (controllerId && itemController && itemController !== controllerId) return true;

    const itemSourceName = String(item.sourceName || item.card?.name || '').trim();
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
 *
 * Live resolveTopOfStack may also drain consecutive Always-No / no-until optional
 * triggers in the same call (one event, many pops). Mirror that here so replay
 * does not leave every historical Aura Shards on the stack after restart.
 */
export function replayPopTopOfStackDuringEventReplay(ctx: GameContext): void {
  if (!(ctx as any).isReplaying) return;
  replayApplyResolvedPermanentSpellBattlefieldEntry(ctx);
  popStackItem(ctx);

  // Mirror live optional may auto-decline drain after the first pop.
  let guard = 0;
  while (guard++ < 256) {
    const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
    const top = stack.length > 0 ? stack[stack.length - 1] : null;
    if (!top || !wouldAutoDeclineOptionalTriggeredAbility(ctx.state, top)) {
      break;
    }
    popStackItem(ctx);
  }
}

/**
 * resolveAllTriggers live-resolves N stack items without emitting per-item
 * resolveTopOfStack events. On replay, pop `count` items so historical
 * pushTriggeredAbility events do not accumulate forever.
 */
export function replayResolveAllTriggersDuringEventReplay(
  ctx: GameContext,
  count: number,
): void {
  if (!(ctx as any).isReplaying) return;
  const toPop = Math.max(0, Math.floor(Number(count) || 0));
  for (let i = 0; i < toPop; i++) {
    const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
    if (stack.length === 0) break;
    popStackItem(ctx);
  }
}

const STACK_PUSH_REPLAY_EVENT_TYPES = new Set([
  'pushTriggeredAbility',
  'pushStack',
]);

/** Copy as-enters choices from card / Morophon mirror / copy source onto the permanent after replay. */
function hydrateAsEntersChoicesOnBattlefield(state: any): void {
  if (!state || typeof state !== 'object') return;
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const morophonChosenType = (state.morophonChosenType || {}) as Record<string, string>;
  const byId = new Map<string, any>();
  for (const permanent of battlefield) {
    const id = String(permanent?.id || '').trim();
    if (id) byId.set(id, permanent);
  }

  for (const permanent of battlefield) {
    if (!permanent || typeof permanent !== 'object') continue;
    const card = permanent.card && typeof permanent.card === 'object' ? permanent.card : null;
    const permanentId = String(permanent.id || '').trim();
    const copySourceId = String(permanent.copiedFromPermanentId || '').trim();
    const copySource = copySourceId ? byId.get(copySourceId) : null;

    const creatureType = String(
      permanent.chosenCreatureType
      || card?.chosenCreatureType
      || (permanentId ? morophonChosenType[permanentId] : '')
      // CR 707.2: token copies inherit as-enters choices from the copied permanent.
      || copySource?.chosenCreatureType
      || copySource?.card?.chosenCreatureType
      || (copySourceId ? morophonChosenType[copySourceId] : '')
      || '',
    ).trim();
    // Legacy replay payloads omitted chosenCreatureType / copiedFromPermanentId for Helm
    // copies. Fall back to another same-controller Morophon that still has a type.
    let resolvedCreatureType = creatureType;
    if (
      !resolvedCreatureType
      && String(card?.name || permanent.name || '').toLowerCase().includes('morophon')
      && (permanent.isToken === true || permanent.isCopyToken === true)
    ) {
      const controllerId = String(permanent.controller || '').trim();
      for (const other of battlefield) {
        if (!other || other === permanent) continue;
        if (String(other.controller || '').trim() !== controllerId) continue;
        const otherName = String(other.card?.name || other.name || '').toLowerCase();
        if (!otherName.includes('morophon')) continue;
        const otherId = String(other.id || '').trim();
        const otherType = String(
          other.chosenCreatureType
          || other.card?.chosenCreatureType
          || (otherId ? morophonChosenType[otherId] : '')
          || '',
        ).trim();
        if (otherType) {
          resolvedCreatureType = otherType;
          break;
        }
      }
    }
    if (resolvedCreatureType) {
      permanent.chosenCreatureType = resolvedCreatureType;
      if (card) card.chosenCreatureType = resolvedCreatureType;
      if (permanentId && String(card?.name || permanent.name || '').toLowerCase().includes('morophon')) {
        morophonChosenType[permanentId] = resolvedCreatureType;
        state.morophonChosenType = morophonChosenType;
      }
    }

    const color = String(
      permanent.chosenColor
      || card?.chosenColor
      || copySource?.chosenColor
      || copySource?.card?.chosenColor
      || '',
    ).trim();
    if (color) {
      permanent.chosenColor = color;
      if (card) card.chosenColor = color;
    }

    const cardName = String(
      permanent.chosenCardName
      || card?.chosenCardName
      || copySource?.chosenCardName
      || copySource?.card?.chosenCardName
      || '',
    ).trim();
    if (cardName) {
      permanent.chosenCardName = cardName;
      if (card) card.chosenCardName = cardName;
    }

    const chosenPlayer = String(
      permanent.chosenPlayer
      || card?.chosenPlayer
      || copySource?.chosenPlayer
      || copySource?.card?.chosenPlayer
      || '',
    ).trim();
    if (chosenPlayer) {
      permanent.chosenPlayer = chosenPlayer;
      if (card) card.chosenPlayer = chosenPlayer;
    }
  }
}

/** Replay-ending events that legitimately leave pending triggered abilities on the stack. */
const STACK_PRESERVING_REPLAY_END_EVENT_TYPES = new Set([
  'queueTriggerOrderStep',
  'castSpellContinuation',
]);

function shouldPreservePendingTriggeredStackAfterReplay(ctx: GameContext): boolean {
  const lastReplayEventType = String((ctx as any)._replayLastEventType || '').trim();
  if (!STACK_PRESERVING_REPLAY_END_EVENT_TYPES.has(lastReplayEventType)) return false;

  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (stack.length === 0) return false;

  return stack.some((item: any) => String(item?.type || '').toLowerCase() === 'triggered_ability');
}

/** keywordPromptResolve keywords that intentionally leave pending stack triggers after replay. */
const KEYWORD_PROMPT_RESOLVE_STACK_KEYWORDS = new Set([
  'exploit',
]);

function shouldPreserveStackAfterKeywordPromptResolve(ctx: GameContext): boolean {
  const lastEvent = (ctx as any)._replayLastEvent;
  if (!lastEvent || typeof lastEvent !== 'object') return false;
  if (String((lastEvent as any).type || '').trim() !== 'keywordPromptResolve') return false;
  if ((lastEvent as any).cancelled === true) return false;

  const keyword = String((lastEvent as any).keyword || '').trim().toLowerCase();
  if (!KEYWORD_PROMPT_RESOLVE_STACK_KEYWORDS.has(keyword)) return false;

  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (stack.length === 0) return false;

  if (keyword === 'exploit') {
    return stack.some((item: any) =>
      String(item?.type || '').toLowerCase() === 'triggered_ability'
      && String(item?.triggerType || '').toLowerCase() === 'exploit',
    );
  }

  return true;
}

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
  if (shouldPreserveStackAfterKeywordPromptResolve(ctx)) {
    return;
  }
  if (shouldPreservePendingTriggeredStackAfterReplay(ctx)) {
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
    hydrateAsEntersChoicesOnBattlefield(ctx.state as any);
  } catch {
    // best-effort only
  }

  try {
    ResolutionQueueManager.endReplay(gameId);
    clearOptionalPaymentCallbacks(gameId);
  } catch {
    // best-effort only
  }

  // Drop cast/activation payment prompts that were re-queued by continuation events
  // after their outcomes were already applied (e.g. castSpell with paymentManaDelta).
  try {
    pruneObsoleteResolutionQueueAfterReplay(
      gameId,
      ctx.state as any,
      (ctx as any).libraries ?? (ctx.state as any)?.libraries,
    );
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
