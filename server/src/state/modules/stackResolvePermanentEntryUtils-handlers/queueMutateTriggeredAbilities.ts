/**
 * Extracted from stackResolvePermanentEntryUtils.ts:
 * buildFullTriggeredAbilityText + queueMutateTriggeredAbilities.
 * Cluster moved: buildFullTriggeredAbilityText (exclusive helper),
 * queueMutateTriggeredAbilities.
 * Public entry: queueMutateTriggeredAbilities (parent keeps a thin wrapper).
 *
 * Leaf must not import stackResolvePermanentEntryUtils.ts or
 * stackResolvePermanentEntryUtils-handlers/index.ts.
 */

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { debugWarn } from '../../../utils/debug.js';
import { appendEvent } from '../../../db/index.js';
import { inferTriggeredAbilityTargetMetadata } from '../inferTriggeredAbilityTargetMetadata.js';
import { parseTriggeredAbilitiesFromText, TriggerEvent as ParsedTriggerEvent } from '../../../../../rules-engine/src/triggeredAbilities.js';
import { detectMutateTriggers } from '../triggered-abilities.js';
import { collectMatchingParsedEventLines } from '../triggers/triggerConditionFamilyMatch.js';

function buildFullTriggeredAbilityText(trigger: any): string {
  const keywordRaw = String(trigger?.keyword || 'when').toLowerCase();
  const keyword = keywordRaw === 'at' ? 'At' : keywordRaw === 'whenever' ? 'Whenever' : 'When';
  const condition = String(trigger?.triggerFilter || trigger?.condition || 'this creature mutates').trim();
  const effect = String(trigger?.effect || '').trim();
  const interveningIf = String(trigger?.interveningIfClause || '').trim();

  if (!condition) {
    return effect;
  }

  if (interveningIf) {
    return `${keyword} ${condition}, if ${interveningIf}, ${effect}`.trim();
  }

  return `${keyword} ${condition}, ${effect}`.trim();
}

export function queueMutateTriggeredAbilities(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  if ((ctx as any).isReplaying) {
    return;
  }

  const permanentId = String(permanent?.id || '').trim();
  const sourceName = String(permanent?.card?.name || 'Triggered ability').trim();
  if (!permanentId) {
    return;
  }

  const cardsToInspect = Array.isArray((permanent as any)?.mutatedStack) && (permanent as any).mutatedStack.length > 0
    ? (permanent as any).mutatedStack
    : [
        {
          name: sourceName,
          oracleText: String(permanent?.card?.oracle_text || '').trim(),
        },
      ];
  const mutateTriggers = cardsToInspect.flatMap((entry: any) => {
    const oracleText = String(entry?.oracleText || '').trim();
    if (!oracleText) return [];
    return parseTriggeredAbilitiesFromText(
      oracleText,
      permanentId,
      controller,
      String(entry?.name || sourceName).trim() || sourceName,
    ).filter((trigger) => trigger?.event === ParsedTriggerEvent.MUTATES);
  });
  const seenMutateEffects = new Set(
    mutateTriggers.map((trigger) => String(trigger?.effect || '').trim().toLowerCase()).filter(Boolean),
  );
  for (const entry of cardsToInspect) {
    const oracleText = String(entry?.oracleText || '').trim();
    if (!oracleText) continue;
    const detected = detectMutateTriggers(
      { name: String(entry?.name || sourceName).trim() || sourceName, oracle_text: oracleText },
      permanent,
    );
    for (const extra of detected) {
      const effect = String(extra.effect || extra.description || '').trim();
      if (!effect || seenMutateEffects.has(effect.toLowerCase())) continue;
      seenMutateEffects.add(effect.toLowerCase());
      mutateTriggers.push({
        event: ParsedTriggerEvent.MUTATES,
        effect,
        optional: extra.mandatory === false,
        keyword: 'whenever',
        condition: 'this creature mutates',
      } as any);
    }
    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText,
      event: 'mutates',
      subjectPermanent: permanent,
      subjectControllerId: controller,
      sourcePermanent: permanent,
    })) {
      const effect = line.effect.trim();
      const effectKey = effect.toLowerCase();
      if (!effect || [...seenMutateEffects].some((existing) => (
        existing.includes(effectKey.slice(0, 24)) || effectKey.includes(existing.slice(0, 24))
      ))) continue;
      seenMutateEffects.add(effect.toLowerCase());
      mutateTriggers.push({
        event: ParsedTriggerEvent.MUTATES,
        effect,
        optional: /^you may\b/i.test(effect),
        keyword: 'whenever',
        condition: 'this creature mutates',
      } as any);
    }
  }
  if (mutateTriggers.length === 0) {
    return;
  }

  const state: any = (ctx as any).state;
  state.stack = state.stack || [];
  const gameId = String((ctx as any).gameId || '').trim();

  for (const trigger of mutateTriggers) {
    const effectText = String(trigger?.effect || '').trim();
    if (!effectText) continue;

    const fullText = buildFullTriggeredAbilityText(trigger);
    const {
      requiresTarget,
      targetType,
      targetConstraint,
      targetZone,
      targetDestination,
      targetGraveyardScope,
      destinationUsesSelectedCardOwner,
      battlefieldControllerMode,
      battlefieldCounters,
      targetAction,
      targetFilterTypes,
      targetFilterRequiredTypeWords,
      targetFilterExcludeTypes,
      targetFilterPermanentOnly,
      targetFilterExactManaValue,
      targetFilterMinManaValue,
      targetFilterMaxManaValue,
      targetTotalPowerLimit,
      targetCastWithoutPayingManaCost,
      targetCastIsOptional,
      minTargets,
      maxTargets,
    } = inferTriggeredAbilityTargetMetadata(effectText, {
      gameState: state,
      controllerId: controller,
      sourceName,
      sourcePermanent: permanent,
    });
    const triggerId = uid('trigger');

    state.stack.push({
      id: triggerId,
      type: 'triggered_ability',
      controller,
      source: permanentId,
      sourceName,
      description: effectText,
      triggerType: 'triggered_ability',
      effect: fullText,
      mandatory: trigger?.optional !== true,
      ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
      ...(targetType ? { targetType } : null),
      ...(targetConstraint ? { targetConstraint } : null),
      ...(targetZone ? { targetZone } : null),
      ...(targetDestination ? { targetDestination } : null),
      ...(targetGraveyardScope ? { targetGraveyardScope } : null),
      ...(destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
      ...(battlefieldControllerMode ? { battlefieldControllerMode } : null),
      ...(battlefieldCounters ? { battlefieldCounters } : null),
      ...(targetAction ? { targetAction } : null),
      ...(Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null),
      ...(Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null),
      ...(Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null),
      ...(targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
      ...(typeof targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue } : null),
      ...(typeof targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue } : null),
      ...(typeof targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue } : null),
      ...(typeof targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit } : null),
      ...(targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
      ...(targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
      ...(typeof minTargets === 'number' ? { minTargets } : null),
      ...(typeof maxTargets === 'number' ? { maxTargets } : null),
    } as any);

    if (gameId) {
      try {
        appendEvent(gameId, (state as any).seq ?? 0, 'pushTriggeredAbility', {
          triggerId,
          sourceId: permanentId,
          permanentId,
          sourceName,
          controllerId: controller,
          description: effectText,
          triggerType: 'triggered_ability',
          effect: fullText,
          mandatory: trigger?.optional !== true,
          ...(requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
          ...(targetType ? { targetType } : null),
          ...(targetConstraint ? { targetConstraint } : null),
          ...(targetZone ? { targetZone } : null),
          ...(targetDestination ? { targetDestination } : null),
          ...(targetGraveyardScope ? { targetGraveyardScope } : null),
          ...(destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
          ...(battlefieldControllerMode ? { battlefieldControllerMode } : null),
          ...(battlefieldCounters ? { battlefieldCounters } : null),
          ...(targetAction ? { targetAction } : null),
          ...(Array.isArray(targetFilterTypes) ? { targetFilterTypes } : null),
          ...(Array.isArray(targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords } : null),
          ...(Array.isArray(targetFilterExcludeTypes) ? { targetFilterExcludeTypes } : null),
          ...(targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
          ...(typeof targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue } : null),
          ...(typeof targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue } : null),
          ...(typeof targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue } : null),
          ...(typeof targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit } : null),
          ...(targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
          ...(targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
          ...(typeof minTargets === 'number' ? { minTargets } : null),
          ...(typeof maxTargets === 'number' ? { maxTargets } : null),
        });
      } catch (err) {
        debugWarn(1, '[resolveTopOfStack] appendEvent(pushTriggeredAbility mutate) failed:', err);
      }
    }
  }
}



