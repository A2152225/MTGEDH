/**
 * Extracted from triggerEtbEntryEffects.ts: self-ETB triggers for a permanent.
 * Cluster moved: queueSelfETBTriggersForPermanent.
 * Public: queueSelfETBTriggersForPermanent
 *
 * Leaf must not import triggerEtbEntryEffects.ts or triggerEtbEntryEffects-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { queueSelfEtbGraveyardTargetPrompt } from '../triggerEtbGraveyardTargetPrompt.js';
import { getETBTriggersForPermanent } from '../triggered-abilities.js';
import { isFaceUpTriggerType } from '../triggerEmissionFamilyUtils.js';
import { isInterveningIfSatisfied } from '../triggers/intervening-if.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from '../triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata, isModalChooseModesEffectText } from '../inferTriggeredAbilityTargetMetadata.js';
import { triggerSubjectIRVerdict } from '../triggers/triggerIRVerdict.js';
import { handleRoomDoorStateOnEnter } from '../triggers/room.js';
import { pushTriggerDoublerCopies } from '../triggers/combat.js';
import {
  recordTurnLimitedEtbTriggerQueued,
  shouldSkipTurnLimitedEtbTrigger,
} from '../triggerDoThisOnlyOnceEachTurn.js';
import {
  isNamedOrAnotherTypedEtbTrigger,
  isTypedPermanentEtbTrigger,
  resolveEnteringCreatureDiscoverXValue,
  shouldQueueNamedOrAnotherTypedEtbTrigger,
  shouldQueueTypedPermanentEtbTrigger,
} from './triggerEtbTypedPermanentMatch.js';

export function queueSelfETBTriggersForPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  // Persisted pushTriggeredAbility / resolveTopOfStackPrompt events own replay.
  // Live re-queue during isReplaying leaves answered Sephiroth/etc. prompts on stack.
  if ((ctx as any).isReplaying) {
    return;
  }
  const state = (ctx as any).state;
  if (!state || !permanent?.card) {
    return;
  }

  const selfETBTriggerTypes = new Set([
    'etb',
    'this_equipment_etb',
    'self_enters_or_attacks',
    'etb_modal_choice',
    'job_select',
    'living_weapon',
    'etb_sacrifice_unless_pay',
    'etb_bounce_land',
    'etb_gain_life',
    'etb_draw',
    'etb_search',
    'etb_create_token',
    'etb_counter',
    'hideaway_etb',
  ]);
  const allTriggers = getETBTriggersForPermanent(permanent.card, permanent, state);
  // Suppress duplicate self-ETB stack items that describe the same clause
  // (e.g. legacy this_equipment_etb + generic etb for Living Weapon / Job Select /
  // Midnight Angel Armor "create … token, then attach").
  const queuedSelfEtbEffectKeys = new Set<string>();
  for (const trigger of allTriggers) {
    const triggerAny = trigger as any;
    const triggerType = String((trigger as any)?.triggerType || '').trim();
    const isExplicitSelfETB = selfETBTriggerTypes.has(triggerType);
    if (isFaceUpTriggerType(triggerType) || triggerType === 'job_select' || triggerType === 'living_weapon') {
      continue;
    }
    const isKnownExternalETB =
      triggerType === 'permanent_etb' ||
      triggerType === 'creature_etb' ||
      triggerType === 'another_permanent_etb' ||
      triggerType === 'opponent_creature_etb';
    if (!isExplicitSelfETB && isKnownExternalETB) {
      continue;
    }
    // "Whenever an enchantment you control enters" is not a self-ETB unless
    // this permanent actually is that type (e.g. Sigil of the Empty Throne).
    if (!isExplicitSelfETB && isTypedPermanentEtbTrigger(triggerType)) {
      if (!shouldQueueTypedPermanentEtbTrigger(trigger, permanent, permanent, String(controller))) {
        continue;
      }
    }
    if (!isExplicitSelfETB && isNamedOrAnotherTypedEtbTrigger(triggerType)) {
      if (!shouldQueueNamedOrAnotherTypedEtbTrigger(trigger, permanent, permanent, String(controller))) {
        continue;
      }
    }
    // A watcher clause ("Whenever a land you control enters", "another Elf you control")
    // only fires for this permanent's own entry when the permanent satisfies the printed
    // subject (Emeria Shepherd is not a land). The IR covers every enters variant; the
    // land list below is the fallback when no parsed sentence backs the entry.
    if (!isExplicitSelfETB && triggerSubjectIRVerdict({
      oracleText: String(permanent?.card?.oracle_text || ''),
      events: ['enters'],
      effectTexts: [(trigger as any)?.effect, (trigger as any)?.description],
      subjectPermanent: permanent,
      subjectControllerId: String(controller || permanent?.controller || ''),
      sourcePermanent: { ...permanent, controller: String(permanent?.controller || controller || '') },
      state,
    }) === false) {
      continue;
    }
    if (
      triggerType === 'land_you_control_etb'
      || triggerType === 'opponent_land_etb'
      || triggerType === 'enchanted_player_land_etb'
      || triggerType === 'any_land_etb'
      || triggerType === 'this_or_another_land_you_control_etb'
    ) {
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      if (!/\bland\b/.test(typeLine)) continue;
    }
    if (shouldSkipTurnLimitedEtbTrigger(state, trigger, String(permanent.id || ''))) {
      continue;
    }

    const raw = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
    const effectDedupeKey = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (effectDedupeKey && queuedSelfEtbEffectKeys.has(effectDedupeKey)) {
      continue;
    }
    if (effectDedupeKey) queuedSelfEtbEffectKeys.add(effectDedupeKey);
    let textForEval = raw;
    if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
      textForEval = `When ~ enters the battlefield, ${textForEval}`;
    }

    const ok = isInterveningIfSatisfied(
      ctx as any,
      String(controller),
      textForEval,
      permanent,
      /\bthat player\b/i.test(textForEval)
        ? {
            thatPlayerId: String(controller),
            referencedPlayerId: String(controller),
            theirPlayerId: String(controller),
          }
        : undefined
    );
    if (ok === false) {
      continue;
    }

    state.stack = state.stack || [];
    const triggerId = uid('trigger');
    const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(permanent);

    // Enrich graveyard / zone / filter metadata for self-ETB triggered abilities so
    // that downstream target-selection (TARGET_SELECTION step builders in
    // socket/resolution.ts and socket/game-actions.ts) can enumerate graveyard
    // targets for ETB-triggered reanimation effects (Coalstoke Gearhulk,
    // Iridescent Drake, etc.). Mirrors the pattern used by exploit/exert paths
    // and the modal-trigger handler in socket/resolution.ts.
    // "Whenever NAME or another Equipment you control enters, you may attach that Equipment to
    // target creature you control" (Hammer of Nazahn): the typed/named-or-another detectors do not
    // stamp requiresTarget, so infer it from the effect text exactly like the "another TYPE enters"
    // path (tryBuildTypedPermanentEtbStackItem) does. Otherwise no target is ever chosen and the
    // IR attach step silently stalls on an ambiguous "target creature you control".
    const selfEffectText = String(trigger.effect || trigger.description || '');
    const inferTypedEtbTarget = trigger.requiresTarget !== true
      && (isNamedOrAnotherTypedEtbTrigger(triggerType) || isTypedPermanentEtbTrigger(triggerType))
      && !isModalChooseModesEffectText(selfEffectText)
      && /\btarget\b/i.test(selfEffectText);
    const enrichedMetadata = (trigger.requiresTarget || (trigger as any)?.targetZone || inferTypedEtbTarget)
      ? inferTriggeredAbilityTargetMetadata(String(trigger.effect || trigger.description || ''), {
          gameState: (ctx as any).state,
          controllerId: String(controller),
          sourceName: String(trigger.cardName || permanent.card?.name || ''),
          sourcePermanent: permanent,
        } as any)
      : ({} as ReturnType<typeof inferTriggeredAbilityTargetMetadata>);

    const effectiveRequiresTarget = trigger.requiresTarget === true
      || (inferTypedEtbTarget && Boolean(enrichedMetadata.targetType || enrichedMetadata.targetZone));

    const discoverXValue = resolveEnteringCreatureDiscoverXValue(trigger, permanent, state);

    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller,
      source: permanent.id,
      sourceName: trigger.cardName || permanent.card?.name,
      description: trigger.description,
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory,
      permanentId: permanent.id,
      effect: trigger.effect || trigger.description,
      requiresChoice: trigger.requiresChoice,
      requiresTarget: effectiveRequiresTarget || trigger.requiresTarget,
      targetType: enrichedMetadata.targetType || trigger.targetType,
      targetConstraint: enrichedMetadata.targetConstraint || trigger.targetConstraint,
      needsTargetSelection: effectiveRequiresTarget || false,
      isModal: triggerAny.isModal,
      modalOptions: triggerAny.modalOptions,
      targetPlayer: triggerAny.targetPlayer,
      value: trigger.value,
      effectData: triggerAny.effectData,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
      ...(enrichedMetadata.targetZone ? { targetZone: enrichedMetadata.targetZone } : null),
      ...(enrichedMetadata.targetDestination ? { targetDestination: enrichedMetadata.targetDestination } : null),
      ...(enrichedMetadata.targetGraveyardScope ? { targetGraveyardScope: enrichedMetadata.targetGraveyardScope } : null),
      ...(enrichedMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
      ...(enrichedMetadata.battlefieldControllerMode ? { battlefieldControllerMode: enrichedMetadata.battlefieldControllerMode } : null),
      ...(enrichedMetadata.battlefieldCounters ? { battlefieldCounters: enrichedMetadata.battlefieldCounters } : null),
      ...(enrichedMetadata.targetAction ? { targetAction: enrichedMetadata.targetAction } : null),
      ...(Array.isArray(enrichedMetadata.targetFilterTypes) ? { targetFilterTypes: enrichedMetadata.targetFilterTypes } : null),
      ...(Array.isArray((enrichedMetadata as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (enrichedMetadata as any).targetFilterRequiredTypeWords } : null),
      ...(Array.isArray(enrichedMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: enrichedMetadata.targetFilterExcludeTypes } : null),
      ...(enrichedMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
      ...(typeof (enrichedMetadata as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (enrichedMetadata as any).targetFilterExactManaValue } : null),
      ...(typeof (enrichedMetadata as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (enrichedMetadata as any).targetFilterMinManaValue } : null),
      ...(typeof enrichedMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: enrichedMetadata.targetFilterMaxManaValue } : null),
      ...(typeof enrichedMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: enrichedMetadata.targetTotalPowerLimit } : null),
      ...(enrichedMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
      ...(enrichedMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
      ...(typeof enrichedMetadata.minTargets === 'number' ? { minTargets: enrichedMetadata.minTargets } : null),
      ...(typeof enrichedMetadata.maxTargets === 'number' ? { maxTargets: enrichedMetadata.maxTargets } : null),
      interveningIfSubjectPermanentId: permanent.id,
      interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(permanent),
      ...(typeof discoverXValue === 'number' ? { xValue: discoverXValue } : null),
      ...(triggerAny.doThisOnlyOnceEachTurn ? { doThisOnlyOnceEachTurn: true } : null),
      ...(triggerAny.oncePerTurn ? { oncePerTurn: true } : null),
      ...(typeof triggerAny.hideawayCount === 'number' ? { hideawayCount: triggerAny.hideawayCount } : null),
      ...(triggerAny.hideawayCondition ? { hideawayCondition: triggerAny.hideawayCondition } : null),
    } as any;
    recordTurnLimitedEtbTriggerQueued(state, trigger, String(permanent.id || ''));
    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);

    // Prevent game-actions queueSelfEtbBattlefieldTutorSearch from also enqueueing
    // a LIBRARY_SEARCH for the same self-ETB battlefield tutor (double prompt / undo drift).
    const effectForTutorGuard = String(trigger.effect || trigger.description || '');
    if (
      /search your library/i.test(effectForTutorGuard)
      && /onto the battlefield/i.test(effectForTutorGuard)
    ) {
      permanent.etbProcessed = true;
    }

    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, (state as any).seq ?? 0, 'pushTriggeredAbility', {
          triggerId,
          sourceId: permanent.id,
          permanentId: permanent.id,
          sourceName: trigger.cardName || permanent.card?.name,
          controllerId: controller,
          description: trigger.description,
          triggerType: trigger.triggerType,
          effect: trigger.effect || trigger.description,
          mandatory: trigger.mandatory,
          requiresChoice: trigger.requiresChoice,
          requiresTarget: effectiveRequiresTarget || trigger.requiresTarget,
          targetType: enrichedMetadata.targetType || trigger.targetType,
          targetConstraint: enrichedMetadata.targetConstraint || trigger.targetConstraint,
          needsTargetSelection: effectiveRequiresTarget || false,
          isModal: triggerAny.isModal,
          modalOptions: triggerAny.modalOptions,
          targetPlayer: triggerAny.targetPlayer,
          value: trigger.value,
          effectData: triggerAny.effectData,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
          ...(enrichedMetadata.targetZone ? { targetZone: enrichedMetadata.targetZone } : null),
          ...(enrichedMetadata.targetDestination ? { targetDestination: enrichedMetadata.targetDestination } : null),
          ...(enrichedMetadata.targetGraveyardScope ? { targetGraveyardScope: enrichedMetadata.targetGraveyardScope } : null),
          ...(enrichedMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
          ...(enrichedMetadata.battlefieldControllerMode ? { battlefieldControllerMode: enrichedMetadata.battlefieldControllerMode } : null),
          ...(enrichedMetadata.battlefieldCounters ? { battlefieldCounters: enrichedMetadata.battlefieldCounters } : null),
          ...(enrichedMetadata.targetAction ? { targetAction: enrichedMetadata.targetAction } : null),
          ...(Array.isArray(enrichedMetadata.targetFilterTypes) ? { targetFilterTypes: enrichedMetadata.targetFilterTypes } : null),
          ...(Array.isArray((enrichedMetadata as any).targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: (enrichedMetadata as any).targetFilterRequiredTypeWords } : null),
          ...(Array.isArray(enrichedMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: enrichedMetadata.targetFilterExcludeTypes } : null),
          ...(enrichedMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
          ...(typeof (enrichedMetadata as any).targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: (enrichedMetadata as any).targetFilterExactManaValue } : null),
          ...(typeof (enrichedMetadata as any).targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: (enrichedMetadata as any).targetFilterMinManaValue } : null),
          ...(typeof enrichedMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: enrichedMetadata.targetFilterMaxManaValue } : null),
          ...(typeof enrichedMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: enrichedMetadata.targetTotalPowerLimit } : null),
          ...(enrichedMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
          ...(enrichedMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
          ...(typeof enrichedMetadata.minTargets === 'number' ? { minTargets: enrichedMetadata.minTargets } : null),
          ...(typeof enrichedMetadata.maxTargets === 'number' ? { maxTargets: enrichedMetadata.maxTargets } : null),
          ...(typeof triggerAny.hideawayCount === 'number' ? { hideawayCount: triggerAny.hideawayCount } : null),
          ...(triggerAny.hideawayCondition ? { hideawayCondition: triggerAny.hideawayCondition } : null),
        });
      } catch (err) {
        debugWarn(1, '[queueSelfETBTriggersForPermanent] appendEvent(pushTriggeredAbility self ETB) failed:', err);
      }
    }

    queueSelfEtbGraveyardTargetPrompt(ctx, {
      controller,
      triggerId,
      permanentId: String(permanent.id || ''),
      sourceName: String(trigger.cardName || permanent.card?.name || 'Triggered ability'),
      effectText: String(trigger.effect || trigger.description || ''),
      mandatory: trigger.mandatory !== false,
      requiresTarget: effectiveRequiresTarget,
      enrichedMetadata,
    });
  }

  handleRoomDoorStateOnEnter(ctx, permanent, controller);
}
