import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { debugWarn } from '../../utils/debug.js';
import { popStackItem } from './stackPushUtils.js';
import { isPermanentTypeLine } from './stackResolvePermanentSpellTypeUtils.js';
import { resolvePermanentSpellBattlefieldEntry } from './stackResolvePermanentEntryUtils.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { enterResolutionMode, exitResolutionMode } from './priority.js';
import { reassignPriorityIfHolderCannotReceive } from './priorityEligibility.js';
import { clearOptionalPaymentCallbacks } from '../../socket/optional-payment-prompts.js';
import { maybeResumeDeferredOracleIrStackSpell } from './oracleIrDeferredStackFinalize.js';
import { restoreAllPendingEffectProgramRuntimes } from '../effects/effectProgramReplayRestore.js';
import { resumeOracleIrPendingCompoundStepsFromState } from './oracleIrServerZoneSync.js';
import { scrubStalePerPlayerOptionalEffectProgramSteps } from './triggerCounterPlacementPromptUtils.js';
import { pruneObsoleteResolutionQueueAfterReplay } from '../resolution/replayCleanup.js';
import { isUndoProbeGameId } from '../../gameRestoreState.js';
import { wouldAutoDeclineOptionalTriggeredAbility } from './stackResolveTriggeredAbilityOptionalUtils.js';
import { repairReplayCardSourceZones } from './stackReplayUtils.js';

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

const AS_ENTERS_CHOICE_STEP_TYPES = new Set([
  'creature_type_choice',
  'color_choice',
  'card_name_choice',
  'player_choice',
  'option_choice',
]);

function isPermanentAlreadyOnBattlefield(
  ctx: GameContext,
  options: { stackItemId?: string; controller?: string; cardId?: string },
): boolean {
  const battlefield = Array.isArray((ctx.state as any).battlefield)
    ? (ctx.state as any).battlefield
    : [];
  const stackItemId = String(options.stackItemId || '').trim();
  const controller = String(options.controller || '').trim();
  const cardId = String(options.cardId || '').trim();
  return battlefield.some((perm: any) => {
    if (!perm) return false;
    if (stackItemId && String(perm.id || '') === stackItemId) return true;
    if (controller && cardId) {
      return String(perm.controller || '') === controller
        && String(perm.card?.id || '') === cardId;
    }
    return false;
  });
}

function findPermanentSpellStackItem(
  ctx: GameContext,
  permanentId: string,
): { index: number; item: any } | null {
  const wanted = String(permanentId || '').trim();
  if (!wanted) return null;
  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const item = stack[i];
    if (!isReplayableSpellStackItem(item)) continue;
    if (String(item?.id || '').trim() !== wanted) continue;
    const effectiveCard = resolveReplaySpellCard(item);
    const effectiveTypeLine = String(
      effectiveCard?.type_line || item?.card?.type_line || '',
    );
    if (!effectiveCard || !isPermanentTypeLine(effectiveTypeLine)) continue;
    return { index: i, item };
  }
  return null;
}

function removeStackItemAtIndex(ctx: GameContext, index: number): void {
  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (index < 0 || index >= stack.length) return;
  const next = stack.slice();
  next.splice(index, 1);
  (ctx.state as any).stack = next;
}

function scrubReplayPermanentSourceZones(ctx: GameContext, controller: string, cardId: string): void {
  const playerId = String(controller || '').trim();
  const id = String(cardId || '').trim();
  if (!playerId || !id) return;
  try {
    repairReplayCardSourceZones(ctx, playerId, id);
  } catch (err) {
    debugWarn(1, '[replay] source-zone scrub after permanent entry failed:', err);
  }
}

/**
 * Materialize a permanent spell still on the stack onto the battlefield during
 * replay. Used when legacy logs recorded as-enters prompts / ETB pushes *before*
 * resolveTopOfStack, so the permanent is no longer on top when resolve replays.
 *
 * Returns true when the permanent is on the battlefield afterward.
 */
export function replayEnsurePermanentSpellBattlefieldEntryById(
  ctx: GameContext,
  permanentId: string,
  options?: { removeFromStack?: boolean },
): boolean {
  if (!(ctx as any).isReplaying) return false;

  const wanted = String(permanentId || '').trim();
  if (!wanted) return false;

  if (isPermanentAlreadyOnBattlefield(ctx, { stackItemId: wanted })) {
    const existing = (Array.isArray((ctx.state as any).battlefield) ? (ctx.state as any).battlefield : [])
      .find((perm: any) => perm && String(perm.id || '').trim() === wanted);
    scrubReplayPermanentSourceZones(
      ctx,
      String(existing?.controller || existing?.owner || '').trim(),
      String(existing?.card?.id || '').trim(),
    );
    return true;
  }

  const found = findPermanentSpellStackItem(ctx, wanted);
  if (!found) return false;

  const { index, item } = found;
  const effectiveCard = resolveReplaySpellCard(item);
  if (!effectiveCard || typeof effectiveCard !== 'object') return false;

  const effectiveTypeLine = String(
    effectiveCard.type_line || item?.card?.type_line || '',
  );
  if (!isPermanentTypeLine(effectiveTypeLine)) return false;

  const controller = String(item.controller || '').trim() as PlayerID;
  const cardId = String(effectiveCard.id || '').trim();
  if (!controller || !cardId) return false;

  if (isPermanentAlreadyOnBattlefield(ctx, { stackItemId: wanted, controller, cardId })) {
    if (options?.removeFromStack !== false) {
      removeStackItemAtIndex(ctx, index);
    }
    scrubReplayPermanentSourceZones(ctx, controller, cardId);
    return true;
  }

  try {
    resolvePermanentSpellBattlefieldEntry(ctx, {
      controller,
      card: item.card,
      effectiveCard,
      effectiveTypeLine,
      item,
      targets: item.targets,
      fallbackOracleText: String(effectiveCard.oracle_text || ''),
      preferredPermanentId: wanted || undefined,
    });
  } catch (err) {
    debugWarn(1, '[replay] permanent spell battlefield entry by id failed:', err);
    return false;
  }

  if (options?.removeFromStack !== false) {
    // Entry may have shifted indexes if resolvePermanentSpellBattlefieldEntry
    // touched the stack; re-find by id.
    const stillThere = findPermanentSpellStackItem(ctx, wanted);
    if (stillThere) {
      removeStackItemAtIndex(ctx, stillThere.index);
    }
  }

  scrubReplayPermanentSourceZones(ctx, controller, cardId);
  return isPermanentAlreadyOnBattlefield(ctx, { stackItemId: wanted, controller, cardId });
}

/**
 * When replaying an as-enters resolveTopOfStackPrompt, ensure the permanent that
 * the choice targets is on the battlefield (legacy inverted event order).
 */
export function replayEnsureAsEntersPermanentFromPromptSteps(
  ctx: GameContext,
  queuedSteps: readonly any[],
  fallbackSourceId?: string,
): void {
  if (!(ctx as any).isReplaying) return;

  const candidateIds = new Set<string>();
  const fallback = String(fallbackSourceId || '').trim();
  if (fallback) candidateIds.add(fallback);

  for (const step of queuedSteps || []) {
    if (!step || typeof step !== 'object') continue;
    const stepType = String((step as any).type || '').trim().toLowerCase();
    if (!AS_ENTERS_CHOICE_STEP_TYPES.has(stepType)) continue;
    const permanentId = String((step as any).permanentId || '').trim();
    const sourceId = String((step as any).sourceId || '').trim();
    if (permanentId) candidateIds.add(permanentId);
    if (sourceId) candidateIds.add(sourceId);
  }

  for (const id of candidateIds) {
    replayEnsurePermanentSpellBattlefieldEntryById(ctx, id);
  }
}

/**
 * When replaying an ETB trigger whose subject is still a permanent spell on the
 * stack (legacy inverted logs), enter that permanent before pushing the trigger.
 */
export function replayEnsureInterveningIfSubjectOnBattlefield(
  ctx: GameContext,
  event: Record<string, unknown>,
): void {
  if (!(ctx as any).isReplaying) return;

  const subjectId = String(
    event.interveningIfSubjectPermanentId
    || (event.interveningIfSubjectSnapshot as any)?.id
    || '',
  ).trim();
  if (!subjectId) return;

  replayEnsurePermanentSpellBattlefieldEntryById(ctx, subjectId);
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

  const stackItemId = String(item.id || '').trim();
  if (stackItemId) {
    // Top-of-stack path: enter but leave popping to replayPopTopOfStackDuringEventReplay.
    replayEnsurePermanentSpellBattlefieldEntryById(ctx, stackItemId, { removeFromStack: false });
    return;
  }

  const effectiveCard = resolveReplaySpellCard(item);
  if (!effectiveCard || typeof effectiveCard !== 'object') return;

  const effectiveTypeLine = String(
    effectiveCard.type_line || item?.card?.type_line || '',
  );
  if (!isPermanentTypeLine(effectiveTypeLine)) return;

  const controller = String(item.controller || '').trim() as PlayerID;
  const cardId = String(effectiveCard.id || '').trim();
  if (!controller || !cardId) return;

  if (isPermanentAlreadyOnBattlefield(ctx, { controller, cardId })) return;

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
  'castSpell',
  'castCommander',
  // Mid-copy restarts: keep original + copy on stack (copy events are not castSpell).
  'copyTriggeredSpellResolve',
  'copyTriggeredAbilityResolve',
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

    const colorWord = String(
      permanent.chosenColorWord
      || card?.chosenColorWord
      || copySource?.chosenColorWord
      || copySource?.card?.chosenColorWord
      || '',
    ).trim();
    if (colorWord) {
      permanent.chosenColorWord = colorWord;
      if (card) card.chosenColorWord = colorWord;
    }

    const basicLandType = String(
      permanent.chosenBasicLandType
      || card?.chosenBasicLandType
      || copySource?.chosenBasicLandType
      || copySource?.card?.chosenBasicLandType
      || '',
    ).trim();
    if (basicLandType) {
      permanent.chosenBasicLandType = basicLandType;
      if (card) card.chosenBasicLandType = basicLandType;
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

/** Turn-step triggerTypes persisted by nextStep (must match turn.ts TURN_STEP_TRIGGER_TYPES). */
const TURN_STEP_TRIGGER_TYPES_FOR_STACK_PRESERVE = new Set([
  'upkeep',
  'draw_step',
  'precombat_main',
  'postcombat_main',
  'begin_combat',
  'end_combat',
  'end_step',
  'rebound',
  'paradigm',
  'saga_chapter',
]);

function isTurnStepPersistedTriggerEvent(event: any): boolean {
  if (!event || String(event.type || '') !== 'pushTriggeredAbility') return false;
  const triggerType = String(event.triggerType || '').trim().toLowerCase();
  return TURN_STEP_TRIGGER_TYPES_FOR_STACK_PRESERVE.has(triggerType);
}

function stackHasTriggeredAbility(ctx: GameContext): boolean {
  const stack = Array.isArray((ctx.state as any)?.stack) ? (ctx.state as any).stack : [];
  if (stack.length === 0) return false;
  return stack.some((item: any) => String(item?.type || '').toLowerCase() === 'triggered_ability');
}

function shouldPreservePendingTriggeredStackAfterReplay(ctx: GameContext): boolean {
  const lastReplayEventType = String((ctx as any)._replayLastEventType || '').trim();
  if (STACK_PRESERVING_REPLAY_END_EVENT_TYPES.has(lastReplayEventType)) {
    return stackHasTriggeredAbility(ctx);
  }

  // Live sockets historically appended nextStep *after* nextStep() persisted
  // pushTriggeredAbility, so a restart mid-step can end on nextStep with a
  // legitimate pending turn-step trigger from the preceding push event.
  if (lastReplayEventType === 'nextStep') {
    const penultimate = (ctx as any)._replayPenultimateEvent;
    if (
      isTurnStepPersistedTriggerEvent(penultimate)
      || String(penultimate?.type || '') === 'queueTriggerOrderStep'
    ) {
      return stackHasTriggeredAbility(ctx);
    }
  }

  return false;
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
 * After a full replay, drop stack orphans left because replay restored pushes
 * (or live-re-executed optional choices) without a balancing pop.
 *
 * Pending resolution-queue prompts must NOT block this — they are separate from
 * the MTG stack, and G1-style restarts left Aura Shards / Altar floods precisely
 * because scrub bailed on leftover prompts + typeless activation shells.
 *
 * Preserves a legitimately pending trigger when the event log ends on a push /
 * keyword prompt / cast continuation.
 */
function collectTrailingUnansweredPushTriggerIds(ctx: GameContext): Set<string> {
  const ids = new Set<string>();
  const last = (ctx as any)._replayLastEvent;
  if (!last || String(last.type || '').trim() !== 'pushTriggeredAbility') {
    return ids;
  }
  const lastId = String(last.triggerId || '').trim();
  if (lastId) ids.add(lastId);
  const penultimate = (ctx as any)._replayPenultimateEvent;
  if (penultimate && String(penultimate.type || '').trim() === 'pushTriggeredAbility') {
    const prevId = String(penultimate.triggerId || '').trim();
    if (prevId) ids.add(prevId);
  }
  return ids;
}

export function scrubStaleReplayedStackAfterFullReplay(ctx: GameContext): void {
  const gameId = String(ctx?.gameId || '').trim();
  if (!gameId) return;

  const lastReplayEventType = String((ctx as any)._replayLastEventType || '').trim();
  const trailingPushTriggerIds = collectTrailingUnansweredPushTriggerIds(ctx);
  // castSpell / pushStack / copy mid-cast: keep the whole stack.
  // pushTriggeredAbility alone is handled below — only the trailing unanswered
  // trigger(s) survive; older Deathmantle/Sephiroth orphans are dropped.
  if (
    STACK_PUSH_REPLAY_EVENT_TYPES.has(lastReplayEventType)
    && lastReplayEventType !== 'pushTriggeredAbility'
  ) {
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

  const keepItem = (item: any): boolean => {
    if (!item || typeof item !== 'object') return false;
    if (item.oracleIrDeferredFinalize === true) return true;

    const type = String(item.type || '').toLowerCase().trim();
    // Real in-progress spells / activated abilities stay; typeless stack shells
    // (common after compressed loop / ability replay) and triggered abilities
    // whose outcomes already live in mutation events are dropped.
    // Note: castSpell/castCommander are in STACK_PUSH_REPLAY_EVENT_TYPES so a
    // replay that ends mid-cast preserves the stack before this filter runs.
    if (type === 'spell' || type === 'ability') return true;
    if (type === 'triggered_ability') {
      if (trailingPushTriggerIds.size === 0) return false;
      const triggerId = String(item.id || item.triggerId || '').trim();
      return Boolean(triggerId && trailingPushTriggerIds.has(triggerId));
    }
    if (!type) return false;
    return true;
  };

  const nextStack = stack.filter(keepItem);
  if (nextStack.length === stack.length) return;

  (ctx.state as any).stack = nextStack;

  if (nextStack.length > 0) return;

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
      reassignPriorityIfHolderCannotReceive(ctx);
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

  // Undo boundary planning replays into a scratch `undo_probe_*` context.
  // Do not resume deferred stack/IR or emit live resolution handlers for it.
  if (isUndoProbeGameId(gameId)) {
    try {
      ResolutionQueueManager.endReplay(gameId);
      ResolutionQueueManager.clearAllSteps(gameId);
    } catch {
      // best-effort only
    }
    return;
  }

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

  try {
    reassignPriorityIfHolderCannotReceive(ctx);
  } catch {
    // best-effort only
  }
}
