import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { getETBTriggersForPermanent } from './triggered-abilities.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { stampPermanentControlEntryForEcho } from './upkeep-triggers.js';
import { ensureInitialDayNightDesignationFromBattlefield, applyDayNightTransforms } from './day-night.js';
import { cardEntersPrepared, setPermanentPrepared } from './prepared.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { createGrantedRiotChoiceResult, processKeywordTriggers, type KeywordTriggerContext } from './keyword-handlers.js';
import { enqueueSupportedKeywordChoiceStep } from './triggerKeywordChoiceUtils.js';
import { queueSoulbondPairingChoices } from './soulbond.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from './triggerSourceUtils.js';
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
import { wouldAutoDeclineOptionalTriggeredAbility } from './stackResolveTriggeredAbilityOptionalUtils.js';
import { isModalChooseModesEffectText } from './inferTriggeredAbilityTargetMetadata.js';
import { collectMatchingParsedEventLines } from './triggers/triggerConditionFamilyMatch.js';

function pushPendingEtbTriggerIfNotAutoDeclined(
  state: any,
  pending: any[],
  stackItem: any,
): void {
  if (wouldAutoDeclineOptionalTriggeredAbility(state, stackItem)) {
    debug(
      2,
      `[triggerETBEffectsForPermanent] Skipping auto-decline optional trigger: ${stackItem?.sourceName || 'Unknown'}`,
    );
    return;
  }
  pending.push(stackItem);
}
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

export function queueGraveyardResidentCreatureEntryTriggers(
  ctx: GameContext,
  enteringPermanent: any,
  enteringController: PlayerID,
  enteringIsCreature: boolean,
): void {
  if (!enteringIsCreature || (ctx as any).isReplaying) return;

  const state = (ctx as any).state;
  const zones = state?.zones || {};
  const enteredFrom = String(
    enteringPermanent?.enteredFromZone ??
    enteringPermanent?.card?.enteredFromZone ??
    ''
  ).toLowerCase();
  const castFrom = String(
    enteringPermanent?.castSourceZone ??
    enteringPermanent?.card?.castSourceZone ??
    enteringPermanent?.source ??
    enteringPermanent?.card?.source ??
    ''
  ).toLowerCase();
  if (enteredFrom !== 'graveyard' && castFrom !== 'graveyard') {
    return;
  }

  const pendingGraveyardResidentTriggers: any[] = [];

  for (const [zoneOwnerId, playerZones] of Object.entries(zones as Record<string, any>)) {
    const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
    for (const card of graveyard) {
      const oracle = String(card?.oracle_text || '').replace(/[â€™]/g, "'");
      if (!oracle) continue;

      const effectMatch = oracle.match(
        /whenever\s+a\s+creature(\s+you\s+control)?\s+enters(?:\s+the\s+battlefield)?,?\s*(if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard,\s*return\s+(?:this\s+card|~|[^.]+?)\s+from\s+your\s+graveyard\s+to\s+the\s+battlefield\s+tapped\s+at\s+the\s+beginning\s+of\s+the\s+next\s+end\s+step)\.?/i
      );
      if (!effectMatch) continue;

      const requiresController = Boolean(effectMatch[1]);
      if (requiresController && String(enteringController) !== String(zoneOwnerId)) {
        continue;
      }

      const effectText = String(effectMatch[2] || '').trim();
      try {
        const fullText = `Whenever a creature${requiresController ? ' you control' : ''} enters the battlefield, ${effectText}`;
        const satisfied = isInterveningIfSatisfied(ctx as any, String(zoneOwnerId), fullText, enteringPermanent);
        if (satisfied === false) {
          continue;
        }
      } catch {
        // Keep the trigger if the generic evaluator cannot decide.
      }

      const triggerId = uid('trigger');
      const stackItem = {
        id: triggerId,
        type: 'triggered_ability',
        controller: String(zoneOwnerId),
        source: String(card?.id || triggerId),
        permanentId: String(card?.id || triggerId),
        sourceName: String(card?.name || 'Graveyard trigger'),
        description: effectText,
        effect: effectText,
        triggerType: 'creature_etb',
        mandatory: true,
        card: { ...(card as any) },
        targetZone: 'graveyard',
        targetDestination: 'battlefield',
        targetGraveyardScope: 'your',
        destinationUsesSelectedCardOwner: true,
        battlefieldControllerMode: 'owner',
        battlefieldTapped: true,
        delayedReturnAt: 'next_end_step',
        boundGraveyardCardId: String(card?.id || ''),
        boundGraveyardOwnerId: String(zoneOwnerId),
        interveningIfSubjectPermanentId: enteringPermanent?.id,
        interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
      } as any;

      pendingGraveyardResidentTriggers.push(stackItem);
      debug(2, `[triggerETBEffectsForPermanent] ${stackItem.sourceName} triggered from graveyard: ${effectText}`);
    }
  }

  state.stack = state.stack || [];
  const orderedGraveyardResidentTriggers = orderTriggersByAPNAP(
    ctx as any,
    pendingGraveyardResidentTriggers.map((stackItem, originalIndex) => ({
      controllerId: String(stackItem?.controller || ''),
      originalIndex,
      stackItem,
    })),
  ).map((entry: any) => entry.stackItem);

  for (const stackItem of orderedGraveyardResidentTriggers) {
    state.stack.push(stackItem);
    persistTriggeredAbilityPush(ctx, stackItem);
  }
}
export function triggerETBEffectsForPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  includeSelfTriggers = true,
  options?: { readonly etbTriggerCache?: Map<string, ReturnType<typeof getETBTriggersForPermanent>> },
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;

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
        // Apply transforms for the current designation (this will flip eligible daybound permanents).
        applyDayNightTransforms(state as any);
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
    const watcherId = String(perm?.id || '').trim();
    let otherTriggers = watcherId && etbTriggerCache ? etbTriggerCache.get(watcherId) : undefined;
    if (!otherTriggers) {
      otherTriggers = getETBTriggersForPermanent(perm.card, perm, state);
      if (watcherId && etbTriggerCache) etbTriggerCache.set(watcherId, otherTriggers);
    }
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
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
        } catch {
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
        
        debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
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
        debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s chosen-type ETB trigger: ${trigger.description}`);
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
        debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s chosen-type enters-or-attacks trigger: ${trigger.description}`);
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
        } catch {
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
        
        debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
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
        } catch {
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
        
        debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s triggered ability: ${trigger.description}`);
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
          } catch {
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
          
          debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
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
        debug(2, `[triggerETBEffectsForPermanent] âš¡ ${trigger.cardName}'s typed ETB trigger: ${trigger.description}`);
      }
    }
  }

  for (const perm of state.battlefield) {
    if (!perm?.card || perm.id === permanent.id) continue;
    const parsedEffects = collectMatchingParsedEventLines({
      ctx,
      oracleText: String(perm.card.oracle_text || ''),
      event: 'enters',
      subjectPermanent: permanent,
      subjectControllerId: String(controller),
      sourcePermanent: perm,
      fromZone: String(
        permanent?.enteredFromZone
        || permanent?.card?.enteredFromZone
        || permanent?.castSourceZone
        || permanent?.card?.castSourceZone
        || '',
      ).toLowerCase() || undefined,
    });
    for (const line of parsedEffects) {
      const effect = line.effect;
      const normalizedEffect = effect.toLowerCase().replace(/\s+/g, ' ').trim();
      const alreadyQueued = pendingExternalEtbTriggers.some((item) => {
        if (String(item?.source || '') !== String(perm.id)) return false;
        const existing = String(item?.effect || item?.description || '').toLowerCase().replace(/\s+/g, ' ').trim();
        return existing === normalizedEffect
          || existing.startsWith(normalizedEffect)
          || normalizedEffect.startsWith(existing);
      });
      if (alreadyQueued || !normalizedEffect) continue;
      pushPendingEtbTriggerIfNotAutoDeclined(state, pendingExternalEtbTriggers, {
        id: uid('trigger'),
        type: 'triggered_ability',
        controller: perm.controller || controller,
        source: perm.id,
        permanentId: perm.id,
        sourceName: perm.card?.name,
        description: effect,
        triggerType: 'parsed_enters',
        mandatory: !/\byou may\b/i.test(effect),
        effect,
        card: perm.card,
        ...(line.reflexive ? { reflexiveWhenYouDo: line.reflexive } : {}),
        ...(line.delayed ? { delayedEndStep: line.delayed } : {}),
        sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(perm),
        interveningIfSubjectPermanentId: permanent.id,
        interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
      } as any);
    }
  }

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
    for (const stackItem of orderedExternalEtbTriggers) {
      state.stack.push(stackItem);
      persistTriggeredAbilityPush(ctx, stackItem);
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
  
  // Check for pending control change effects (Vislor Turlough, Xantcha, Akroan Horse)
  if ((permanent as any).pendingControlChange) {
    const controlChangeInfo = (permanent as any).pendingControlChange;
    if (permanent.chosenPlayer || (permanent as any).asEntersControlChangeQueued) {
      delete (permanent as any).pendingControlChange;
    } else {
    debug(2, `[triggerETBEffectsForPermanent] ${permanent.card?.name} has pending control change: ${controlChangeInfo.type}`);
    
    // Queue a resolution step for the control change
    const gameId = (ctx as any).gameId || 'unknown';
    
    if (
      controlChangeInfo.type === 'may_give_opponent' ||
      controlChangeInfo.type === 'enters_under_opponent_control' ||
      controlChangeInfo.type === 'opponent_gains'
    ) {
      const isOptional = controlChangeInfo.type === 'may_give_opponent';
      const alreadyQueued = ResolutionQueueManager.getQueue(gameId).steps.some(
        (step: any) => step?.type === ResolutionStepType.PLAYER_CHOICE && String(step?.permanentId || '') === String(permanent.id),
      );
      if (alreadyQueued) {
        debug(2, `[triggerETBEffectsForPermanent] Skipping duplicate control change step for ${permanent.card?.name}`);
      } else {
      const validOpponents = Array.isArray(state.players)
        ? state.players
            .filter((player: any) => player && String(player.id || '') !== String(controller) && !player.hasLost)
            .map((player: any) => ({
              id: String(player.id || ''),
              name: String(player.name || player.id || ''),
              life: Number(state?.life?.[player.id] ?? player.life ?? 40),
              libraryCount: Number((state?.zones?.[player.id] as any)?.libraryCount ?? 0),
              isOpponent: true,
              isSelf: false,
            }))
            .filter((player: any) => player.id)
        : [];
      
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.PLAYER_CHOICE,
        playerId: controller,
        description: isOptional 
          ? `${permanent.card?.name}: You may have an opponent gain control of it`
          : `${permanent.card?.name}: Choose an opponent to control this permanent`,
        mandatory: !isOptional,
        sourceId: permanent.id,
        sourceName: permanent.card?.name,
        permanentId: permanent.id,
        sourceImage: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
        promptTitle: isOptional ? "Control Change (Optional)" : "Choose Opponent",
        promptDescription: isOptional
          ? `Do you want to give control of ${permanent.card?.name} to an opponent? If you do, it will be goaded.`
          : `Choose which opponent will control ${permanent.card?.name}.`,
        options: [], // Will be filled with opponent list by the resolution handler
        opponentOnly: true,
        players: validOpponents,
        controlChangeData: {
          permanentId: permanent.id,
          isOptional,
          goadsOnChange: controlChangeInfo.goadsOnChange || false,
          mustAttackEachCombat: controlChangeInfo.mustAttackEachCombat || false,
          cantAttackOwner: controlChangeInfo.cantAttackOwner || false,
        },
      });
      debug(2, `[triggerETBEffectsForPermanent] Queued control change step for ${permanent.card?.name} (optional: ${isOptional})`);
      }
    }
    }
  }
}
