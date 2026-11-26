import {
  recordTurnLimitedEtbTriggerQueued,
  shouldSkipTurnLimitedEtbTrigger,
} from './triggerDoThisOnlyOnceEachTurn.js';
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { getETBTriggersForPermanent } from './triggered-abilities.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { reactToCausedTrigger } from './triggers/round67GameTriggers.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { stampPermanentControlEntryForEcho } from './upkeep-triggers.js';
import { ensureInitialDayNightDesignationFromBattlefield, enterPermanentTransformed } from './day-night.js';
import { cardEntersPrepared, setPermanentPrepared } from './prepared.js';
import {
  createGrantedRiotChoiceResult,
  processKeywordTriggers,
  type KeywordTriggerContext,
} from './keyword-handlers.js';
import { enqueueSupportedKeywordChoiceStep } from './triggerKeywordChoiceUtils.js';
import { queueSoulbondPairingChoices } from './soulbond.js';
import { buildInterveningIfSubjectSnapshot, buildTriggerSourcePermanentSnapshot } from './triggerSourceUtils.js';
import {
  matchesRequiredTypePhrase,
  persistTriggeredAbilityPush,
  queueSelfETBTriggersForPermanent,
  queueTemporaryEtbTriggersForEntry,
  recordBattlefieldEntryTurnTracking,
  shouldQueueChosenTypeCreatureEtbTrigger,
  tryBuildTypedPermanentEtbStackItem,
} from './triggerEtbEntryEffects.js';
import { matchesColorRestriction } from './stackResolvePermanentEtbTriggerUtils.js';
import { permanentIsCommanderCard } from './triggerPermanentUtils.js';
import { hydratePermanentCardOracleInPlace } from './cardOracleHydration.js';
import { filterOneOrMoreEntryDuplicates } from './triggers/simultaneousEntryBatch.js';
import { syncClassLevelGating } from './classLevelGating.js';
import { permanentHasTriggeredAbilities } from './triggers/triggeredAbilitySuppression.js';
import { stampWatcherEtbTriggerTargetMetadata } from './triggerEtbTargetMetadataStamp.js';
import { appendGraveyardSourceEtbParsedLines } from './etbGraveyardSourceIr.js';
import { queueGraveyardResidentCreatureEntryTriggers } from './triggerEtbGraveyardResidentEntryTriggers.js';
import { collectParsedEntersWatcherTriggers, pushPendingEtbTriggerIfNotAutoDeclined } from './triggerEtbParsedEntersWatchers.js';
import { queuePendingEntryControlChangeStep } from './triggerEtbControlChangeStep.js';

export { queueGraveyardResidentCreatureEntryTriggers } from './triggerEtbGraveyardResidentEntryTriggers.js';

export function queueSupportedETBKeywordChoices(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  const state = (ctx as any).state;
  if (!state || !permanent) {
    return;
  }

  const battlefield = state.battlefield || [];
  const actualController = (permanent?.controller || controller) as PlayerID;
  const keywordCtx: KeywordTriggerContext = {
    gameId: (ctx as any).gameId || 'unknown',
    permanent,
    controller: actualController,
    state,
    battlefield,
    players: state.players || [],
    activePlayer: state.activePlayer || actualController,
  };

  const results = processKeywordTriggers(keywordCtx, 'etb');
  if (!results.some((result) => result.keyword === 'riot')) {
    const grantedRiot = createGrantedRiotChoiceResult(keywordCtx);
    if (grantedRiot) {
      results.push(grantedRiot);
    }
  }
  for (const result of results) {
    if (!result.requiresPlayerChoice) {
      continue;
    }

    if (enqueueSupportedKeywordChoiceStep(
      ctx,
      permanent,
      String(permanent?.card?.name || 'Permanent'),
      String(permanent?.id || ''),
      result,
    )) {
      debug(2, `[queueSupportedETBKeywordChoices] Queued ${result.keyword} choice for ${permanent?.card?.name || permanent?.id || 'permanent'}`);
    }
  }
}

export function triggerETBEffectsForPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  includeSelfTriggers = true,
  options?: {
    readonly etbTriggerCache?: Map<string, ReturnType<typeof getETBTriggersForPermanent>>;
    /** Per-batch watcher gate results; only for plain token batches that can't change any watcher's abilities. */
    readonly etbGateCache?: Map<any, boolean>;
  },
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;
  // A Class enters at level 1: only its level-1 section may trigger (CR 716).
  try { syncClassLevelGating(state); } catch { /* best-effort */ }

  try {
    hydratePermanentCardOracleInPlace(permanent);
  } catch {
    // best-effort only
  }

  stampPermanentControlEntryForEcho(state, permanent, String(controller));

  // Day/Night: ensure the game gains a designation when a daybound/nightbound permanent is present.
  try {
    ensureInitialDayNightDesignationFromBattlefield(state as any);
  } catch {}

  if (cardEntersPrepared(permanent?.card)) {
    setPermanentPrepared(state, permanent);
  }

  // Daybound replacement effect: if it's night, daybound permanents enter transformed.
  try {
    const dn = (state as any).dayNight;
    if (dn === 'night') {
      const card: any = permanent?.card;
      const oracle = String(card?.oracle_text || '').toLowerCase();
      const layout = card?.layout;
      if ((layout === 'transform' || layout === 'double_faced_token') && Array.isArray(card?.card_faces) && oracle.includes('daybound')) {
        // Enter already transformed (702.145b / 712.11a); do not fire transform triggers.
        enterPermanentTransformed(permanent, 'other');
      }
    }
  } catch {}
  
  const typeLineLower = String(permanent.card?.type_line || '').toLowerCase();
  const isCreature = typeLineLower.includes('creature');
  const isEnchantment = typeLineLower.includes('enchantment');
  const isToken = permanent.isToken === true;

  recordBattlefieldEntryTurnTracking(state, controller, permanent, {
    trackFaceDownAndSubtype: true,
  });

  queueSupportedETBKeywordChoices(ctx, permanent, controller);
  queueSoulbondPairingChoices(ctx, permanent, String(controller));
  const pendingExternalEtbTriggers: any[] = [];
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  const etbTriggerCache = options?.etbTriggerCache;
  for (const perm of state.battlefield) {
    if (!perm || perm.id === permanent.id) continue;
    const gateCache = options?.etbGateCache;
    let gate = gateCache?.get(perm);
    if (gate === undefined) {
      gate = permanentHasTriggeredAbilities(perm, state, { event: 'etb', eventSubject: permanent });
      gateCache?.set(perm, gate);
    }
    if (!gate) continue;
    const watcherId = String(perm?.id || '').trim();
    let otherTriggers = watcherId && etbTriggerCache ? etbTriggerCache.get(watcherId) : undefined;
    if (!otherTriggers) {
      otherTriggers = getETBTriggersForPermanent(perm.card, perm, state);
      if (watcherId && etbTriggerCache) etbTriggerCache.set(watcherId, otherTriggers);
    }
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      // "Whenever one or more tokens you control enter" also counts Treasures and other noncreature tokens.
      const tokenSubjectOnly = isToken
        && /^(?:a |one or more )?tokens?$/i.test(String((trigger as any).requiredTypePhrase || '').trim());
      if (trigger.triggerType === 'creature_etb' && (isCreature || tokenSubjectOnly)) {
        // "This ability triggers only once each turn." (Caretaker's Talent)
        if (shouldSkipTurnLimitedEtbTrigger(state, trigger, String(perm.id || ''))) {
          continue;
        }
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue;
        }

        // Check if this trigger requires token creatures.
        if ((trigger as any).tokenOnly && !isToken) {
          continue;
        }
        
        // Check if this trigger requires the entering creature to be controlled by the trigger's controller
        // (e.g., Aura Shards: "Whenever a creature you control enters")
        if ((trigger as any).controlledOnly) {
          const triggerController = perm.controller || controller;
          if (controller !== triggerController) {
            continue; // Skip - entering creature is not controlled by trigger's controller
          }
        }
        
        // Check if this trigger requires a specific type phrase (e.g., "token creature", "artifact creature", "Bear").
        const requiredTypeRaw = typeof (trigger as any).requiredTypePhrase === 'string' ? String((trigger as any).requiredTypePhrase) : '';
        const requiredType = requiredTypeRaw.replace(/\bcreatures\b/gi, 'creature').replace(/\bartifacts\b/gi, 'artifact').trim();
        if (requiredType) {
          const enteringTypeLine = String(permanent.card?.type_line || '');
          if (!matchesRequiredTypePhrase(enteringTypeLine, requiredType, isToken)) {
            continue;
          }
        }

        const colorRestriction = typeof (trigger as any).colorRestriction === 'string'
          ? String((trigger as any).colorRestriction).trim()
          : '';
        if (colorRestriction) {
          const enteringColors = Array.isArray(permanent.card?.colors) ? permanent.card.colors : [];
          if (!matchesColorRestriction(colorRestriction, enteringColors)) {
            continue;
          }
        }
        
        const triggerController = perm.controller || controller;
        state.stack = state.stack || [];
        const triggerId = uid("trigger");

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        // These ETB triggers come from OTHER permanents (not the entering permanent), so we must filter here.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            const controlledOnly = !!(trigger as any).controlledOnly;
            textForEval = controlledOnly
              ? `Whenever a creature you control enters the battlefield, ${textForEval}`
              : `Whenever a creature enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            permanent,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch (err) {
          reportHookFailure('intervening-if.eval', err, { source: 'triggerEtbPermanentEffects' });
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: permanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
        recordTurnLimitedEtbTriggerQueued(state, trigger, String(perm.id || ''));
        
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }

      if (trigger.triggerType === 'chosen_type_creature_etb') {
        if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, permanent, controller, isToken, isCreature)) {
          continue;
        }

        const triggerController = perm.controller || controller;
        const triggerId = uid('trigger');
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: permanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
        } as any;
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s chosen-type ETB trigger: ${trigger.description}`);
      }

      if (trigger.triggerType === 'chosen_type_creature_etb_or_attack' && isCreature) {
        if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, permanent, controller, isToken, isCreature)) {
          continue;
        }

        const triggerController = perm.controller || controller;
        const triggerId = uid('trigger');
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: permanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
        } as any;
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s chosen-type enters-or-attacks trigger: ${trigger.description}`);
      }

      // "Whenever a commander you control enters or attacks" and
      // "Whenever your commander enters [or attacks]" (Tome of Legends; "your" = you own it).
      if (trigger.triggerType === 'commander_you_control_etb_or_attack' || trigger.triggerType === 'commander_etb') {
        const enteringIsCommander =
          permanent?.isCommander === true
          || permanent?.commander === true
          || permanent?.card?.isCommander === true
          || permanentIsCommanderCard(ctx, permanent);
        if (!enteringIsCommander) {
          continue;
        }
        const triggerController = perm.controller || controller;
        const relevantPlayer = trigger.triggerType === 'commander_etb'
          ? String(permanent?.owner || controller)
          : String(controller);
        if (relevantPlayer !== String(triggerController)) {
          continue;
        }

        const triggerId = uid('trigger');
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: permanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
        } as any;
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
        debug(2, `[triggerETBEffectsForPermanent] ${trigger.cardName}'s commander enters-or-attacks trigger: ${trigger.description}`);
      }
      
      // another_permanent_etb triggers
      if (trigger.triggerType === 'another_permanent_etb') {
        // Check if this trigger only fires on creatures (creatureOnly flag)
        if ((trigger as any).creatureOnly && !isCreature) {
          continue; // Skip - this trigger only fires on creatures
        }
        
        const triggerController = perm.controller || controller;

                const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;
        
        // For another_permanent_etb, check if the entering permanent is controlled by the trigger's controller
        // This is the "under your control" restriction
        if (controller !== triggerController) {
          continue; // Skip - entering permanent is not controlled by trigger's controller
        }

        const colorRestriction = typeof (trigger as any).colorRestriction === 'string'
          ? String((trigger as any).colorRestriction).trim()
          : '';
        if (colorRestriction) {
          const enteringColors = Array.isArray(permanent.card?.colors) ? permanent.card.colors : [];
          if (!matchesColorRestriction(colorRestriction, enteringColors)) {
            continue;
          }
        }

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever another permanent enters the battlefield under your control, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            permanent,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch (err) {
          reportHookFailure('intervening-if.eval', err, { source: 'triggerEtbPermanentEffects' });
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: permanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
        
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;

        const colorRestriction = typeof (trigger as any).colorRestriction === 'string'
          ? String((trigger as any).colorRestriction).trim()
          : '';
        if (colorRestriction) {
          const enteringColors = Array.isArray(permanent.card?.colors) ? permanent.card.colors : [];
          if (!matchesColorRestriction(colorRestriction, enteringColors)) {
            continue;
          }
        }

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever a permanent enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            permanent,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch (err) {
          reportHookFailure('intervening-if.eval', err, { source: 'triggerEtbPermanentEffects' });
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        state.stack = state.stack || [];
        const triggerId = uid("trigger");
        
        const stackItem = {
          id: triggerId,
          type: 'triggered_ability',
          controller: triggerController,
          source: perm.id,
          permanentId: perm.id,
          sourceName: trigger.cardName,
          description: trigger.description,
          triggerType: trigger.triggerType,
          mandatory: trigger.mandatory,
          effect: trigger.effect || trigger.description,
          card: perm.card,
          sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
          interveningIfSubjectPermanentId: permanent.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
        
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
      }
      
      // opponent_creature_etb triggers (Suture Priest, Authority of the Consuls)
      // These trigger when a creature enters under an OPPONENT's control
      if (trigger.triggerType === 'opponent_creature_etb' && isCreature) {
        const triggerController = perm.controller;
        // Only fire if the entering creature is controlled by an opponent of the trigger controller
        if (triggerController && triggerController !== controller) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          try {
            const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
            let textForEval = desc;
            if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
              textForEval = `Whenever a creature enters the battlefield under an opponent's control, ${textForEval}`;
            }
            const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);
            const satisfied = isInterveningIfSatisfied(
              ctx as any,
              String(triggerController),
              textForEval,
              permanent,
              needsThatPlayerRef && String(controller || '')
                ? {
                    thatPlayerId: String(controller),
                    referencedPlayerId: String(controller),
                    theirPlayerId: String(controller),
                  }
                : undefined
            );
            if (satisfied === false) {
              debug(2, `[triggerETBEffectsForPermanent] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
              continue;
            }
          } catch (err) {
            reportHookFailure('intervening-if.eval', err, { source: 'triggerEtbPermanentEffects' });
            // Conservative fallback: keep the trigger if evaluation fails.
          }

          state.stack = state.stack || [];
          const triggerId = uid("trigger");
          
          const stackItem = {
            id: triggerId,
            type: 'triggered_ability',
            controller: triggerController,
            source: perm.id,
            permanentId: perm.id,
            sourceName: trigger.cardName,
            description: trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            effect: trigger.effect || trigger.description,
            card: perm.card,
            sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
            // Store the entering creature's controller for effects like "that player loses 1 life"
            targetPlayer: controller,
            interveningIfSubjectPermanentId: permanent.id,
            interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
          } as any;
          pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, stackItem);
          
          debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }

      const typedEtbStackItem = tryBuildTypedPermanentEtbStackItem(
        ctx,
        trigger,
        perm,
        permanent,
        String(controller),
      );
      if (typedEtbStackItem) {
        pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, typedEtbStackItem);
        debug(2, `[triggerETBEffectsForPermanent] ⚡ ${trigger.cardName}'s typed ETB trigger: ${trigger.description}`);
      }
    }
  }

  collectParsedEntersWatcherTriggers(ctx, state, permanent, controller, pendingExternalEtbTriggers);

  appendGraveyardSourceEtbParsedLines({
    ctx,
    state,
    enteringPermanent: permanent,
    enteringController: String(controller),
    pending: pendingExternalEtbTriggers,
    pushPending: pushPendingEtbTriggerIfNotAutoDeclined,
  });

  const orderedExternalEtbTriggers = orderTriggersByAPNAP(
    ctx as any,
    pendingExternalEtbTriggers.map((stackItem, originalIndex) => ({
      controllerId: String(stackItem?.controller || ''),
      originalIndex,
      stackItem,
    })),
  ).map((entry: any) => entry.stackItem);

  // During replay, persisted pushTriggeredAbility events restore these triggers.
  if (!(ctx as any).isReplaying) {
    for (const stackItem of filterOneOrMoreEntryDuplicates(orderedExternalEtbTriggers)) {
      stampWatcherEtbTriggerTargetMetadata(state, stackItem);
      state.stack.push(stackItem);
      persistTriggeredAbilityPush(ctx, stackItem);
      try { reactToCausedTrigger(ctx, stackItem, { event: 'etb', permanent }); } catch { /* best-effort */ }
    }
  }

  queueTemporaryEtbTriggersForEntry(ctx, permanent, controller, {
    isCreature,
    isEnchantment,
    isToken,
  });

  queueGraveyardResidentCreatureEntryTriggers(ctx, permanent, controller, isCreature);

  if (includeSelfTriggers) {
    queueSelfETBTriggersForPermanent(ctx, permanent, controller);
  }
  
  // Pending control change effects (Vislor Turlough, Xantcha, Akroan Horse)
  queuePendingEntryControlChangeStep(ctx, state, permanent, controller);
}
