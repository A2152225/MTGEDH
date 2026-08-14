import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { matchesGraveyardCardTargetType } from '../../rules-engine/targeting.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { uid, cardManaValue, getActualPowerToughness } from '../utils.js';
import { getETBTriggersForPermanent } from './triggered-abilities.js';
import { isInterveningIfSatisfied } from './triggers/intervening-if.js';
import { orderTriggersByAPNAP } from './triggers/ordering.js';
import { stampPermanentControlEntryForEcho } from './upkeep-triggers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import {
  buildInterveningIfSubjectSnapshot,
  buildTriggerSourcePermanentSnapshot,
} from './triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata, isModalChooseModesEffectText } from './inferTriggeredAbilityTargetMetadata.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { handleRoomDoorStateOnEnter } from './triggers/room.js';
import { pushTriggerDoublerCopies } from './triggers/combat.js';
import {
  recordTurnLimitedEtbTriggerQueued,
  shouldSkipTurnLimitedEtbTrigger,
} from './triggerDoThisOnlyOnceEachTurn.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTypeLineForMatching(typeLine: string): string {
  // Replace em dash separators and normalize to spaces so word-boundary matching works.
  return String(typeLine || '')
    .toLowerCase()
    .replace(/[â€™]/g, "'")
    .replace(/â€”/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function typeLineHasAllWords(typeLine: string, phrase: string): boolean {
  const tl = normalizeTypeLineForMatching(typeLine);
  const tokens = String(phrase || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((tok) => new RegExp(`\\b${escapeRegExp(tok)}\\b`, 'i').test(tl));
}

export function shouldQueueChosenTypeCreatureEtbTrigger(
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
  isToken: boolean,
  isCreature: boolean,
): boolean {
  if (!isCreature || !enteringPermanent) return false;
  if ((trigger as any)?.nontokenOnly && isToken) return false;
  const chosenType = String(sourcePermanent?.chosenCreatureType || '').trim();
  if (!chosenType) return false;
  const triggerController = String(sourcePermanent?.controller || enteringController || '');
  if (String(enteringController || '') !== triggerController) return false;
  return permanentHasCreatureTypeNow(enteringPermanent, chosenType);
}

/** "Whenever an enchantment/artifact/equipment you control enters" — not a self-ETB. */
export const TYPED_PERMANENT_ETB_REQUIRED_TYPE: Record<string, string> = {
  enchantment_etb: 'enchantment',
  artifact_etb: 'artifact',
  equipment_etb: 'equipment',
};

export function isTypedPermanentEtbTrigger(triggerType: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    TYPED_PERMANENT_ETB_REQUIRED_TYPE,
    String(triggerType || '').trim(),
  );
}

export function shouldQueueTypedPermanentEtbTrigger(
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
): boolean {
  const triggerType = String(trigger?.triggerType || '').trim();
  const requiredType = TYPED_PERMANENT_ETB_REQUIRED_TYPE[triggerType];
  if (!requiredType || !enteringPermanent) return false;

  const typeLine = String(enteringPermanent?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes(requiredType)) return false;

  const isToken = Boolean(enteringPermanent?.isToken || enteringPermanent?.card?.isToken);
  if ((trigger as any)?.nontokenOnly && isToken) return false;
  if ((trigger as any)?.tokenOnly && !isToken) return false;

  if ((trigger as any)?.controlledOnly) {
    const triggerController = String(sourcePermanent?.controller || enteringController || '');
    if (!triggerController || String(enteringController || '') !== triggerController) {
      return false;
    }
  }

  return true;
}

const NAMED_OR_ANOTHER_TYPED_ETB_TYPES = new Set([
  'named_or_another_typed_etb',
  'this_or_another_typed_etb',
  'this_or_another_typed_etb_any',
  'named_or_another_nontoken_typed_etb',
  'this_or_another_nontoken_typed_etb',
]);

export function isNamedOrAnotherTypedEtbTrigger(triggerType: string): boolean {
  return NAMED_OR_ANOTHER_TYPED_ETB_TYPES.has(String(triggerType || '').trim());
}

export function resolveEnteringCreatureDiscoverXValue(
  trigger: any,
  enteringPermanent: any,
  state: any,
): number | undefined {
  const effect = String(trigger?.effect || trigger?.description || '');
  const match = effect.match(/where\s+x\s+is\s+that\s+creature(?:'|’)?s\s+(power|toughness)/i);
  if (!match || !enteringPermanent) return undefined;
  const pt = getActualPowerToughness(enteringPermanent, state);
  const value = String(match[1] || '').toLowerCase() === 'power' ? pt.power : pt.toughness;
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : undefined;
}

export function shouldQueueNamedOrAnotherTypedEtbTrigger(
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
): boolean {
  const triggerType = String(trigger?.triggerType || '').trim();
  if (!isNamedOrAnotherTypedEtbTrigger(triggerType) || !enteringPermanent) return false;

  const isToken = Boolean(enteringPermanent?.isToken || enteringPermanent?.card?.isToken);
  if ((trigger as any)?.nontokenOnly && isToken) return false;
  if (/nontoken/i.test(triggerType) && isToken) return false;

  const sourceId = String(sourcePermanent?.id || '').trim();
  const enteringId = String(enteringPermanent?.id || '').trim();
  const isSelf = Boolean(sourceId && enteringId && sourceId === enteringId);

  const triggerController = String(sourcePermanent?.controller || enteringController || '');
  const requiresControllerMatch = (trigger as any)?.controlledOnly === true
    || triggerType !== 'this_or_another_typed_etb_any';
  if (!isSelf && requiresControllerMatch && triggerController
    && String(enteringController || '') !== triggerController) {
    return false;
  }

  // "NAME or another TYPE" always includes the named permanent itself.
  if (isSelf) return true;

  const phrase = String((trigger as any)?.requiredTypePhrase || '').trim();
  if (!phrase) return false;
  const types = phrase.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
  return types.some((creatureType) => permanentHasCreatureTypeNow(enteringPermanent, creatureType));
}

export function tryBuildTypedPermanentEtbStackItem(
  ctx: GameContext,
  trigger: any,
  sourcePermanent: any,
  enteringPermanent: any,
  enteringController: string,
): any | null {
  if (
    !shouldQueueTypedPermanentEtbTrigger(trigger, sourcePermanent, enteringPermanent, enteringController)
    && !shouldQueueNamedOrAnotherTypedEtbTrigger(trigger, sourcePermanent, enteringPermanent, enteringController)
  ) {
    return null;
  }

  const triggerController = String(sourcePermanent?.controller || enteringController || '');
  if (shouldSkipTurnLimitedEtbTrigger((ctx as any).state, trigger, String(sourcePermanent?.id || ''))) {
    return null;
  }
  const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
  let textForEval = desc;
  if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
    const requiredType = TYPED_PERMANENT_ETB_REQUIRED_TYPE[String(trigger?.triggerType || '').trim()] || 'permanent';
    const article = /^[aeiou]/i.test(requiredType) ? 'an' : 'a';
    textForEval = (trigger as any)?.controlledOnly
      ? `Whenever ${article} ${requiredType} you control enters the battlefield, ${textForEval}`
      : `Whenever ${article} ${requiredType} enters the battlefield, ${textForEval}`;
  }

  try {
    const satisfied = isInterveningIfSatisfied(
      ctx as any,
      triggerController,
      textForEval,
      enteringPermanent,
    );
    if (satisfied === false) {
      return null;
    }
  } catch {
    // Conservative fallback: keep the trigger if evaluation fails.
  }

  const effectText = String((trigger as any)?.effect || trigger?.description || '');
  const modalChooseModes = isModalChooseModesEffectText(effectText);
  const enrichedMetadata = (
    !modalChooseModes
    && (
      (trigger as any)?.requiresTarget === true
      || /\btarget\b/i.test(effectText)
      || String((trigger as any)?.targetZone || '').trim().length > 0
    )
  )
    ? inferTriggeredAbilityTargetMetadata(effectText, {
        gameState: (ctx as any).state,
        controllerId: triggerController,
        sourceName: String(trigger?.cardName || sourcePermanent?.card?.name || ''),
        sourcePermanent,
      } as any)
    : ({} as ReturnType<typeof inferTriggeredAbilityTargetMetadata>);
  const effectiveRequiresTarget = !modalChooseModes && (
    (trigger as any)?.requiresTarget === true
    || Boolean(enrichedMetadata.targetZone)
    || Boolean(enrichedMetadata.targetType)
  );

  const discoverXValue = resolveEnteringCreatureDiscoverXValue(trigger, enteringPermanent, (ctx as any).state);
  recordTurnLimitedEtbTriggerQueued((ctx as any).state, trigger, String(sourcePermanent?.id || ''));

  return {
    id: uid('trigger'),
    type: 'triggered_ability',
    controller: triggerController,
    source: sourcePermanent?.id,
    permanentId: sourcePermanent?.id,
    sourceName: trigger?.cardName,
    description: trigger?.description,
    triggerType: trigger?.triggerType,
    mandatory: trigger?.mandatory,
    effect: effectText || trigger?.description,
    card: sourcePermanent?.card,
    sourcePermanentSnapshot: buildTriggerSourcePermanentSnapshot(sourcePermanent),
    interveningIfSubjectPermanentId: enteringPermanent?.id,
    interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
    requiresTarget: effectiveRequiresTarget,
    targetType: enrichedMetadata.targetType || (trigger as any)?.targetType,
    targetConstraint: enrichedMetadata.targetConstraint || (trigger as any)?.targetConstraint,
    needsTargetSelection: effectiveRequiresTarget,
    ...(typeof discoverXValue === 'number' ? { xValue: discoverXValue } : null),
    ...((trigger as any)?.doThisOnlyOnceEachTurn ? { doThisOnlyOnceEachTurn: true } : null),
    ...((trigger as any)?.oncePerTurn ? { oncePerTurn: true } : null),
    ...(enrichedMetadata.targetZone ? { targetZone: enrichedMetadata.targetZone } : null),
    ...(enrichedMetadata.targetDestination ? { targetDestination: enrichedMetadata.targetDestination } : null),
    ...(typeof enrichedMetadata.minTargets === 'number' ? { minTargets: enrichedMetadata.minTargets } : null),
    ...(typeof enrichedMetadata.maxTargets === 'number' ? { maxTargets: enrichedMetadata.maxTargets } : null),
  };
}

export function matchesRequiredTypePhrase(typeLine: string, requiredPhrase: string, isToken: boolean): boolean {
  let phrase = String(requiredPhrase || '').toLowerCase().trim();
  if (!phrase) return true;

  const hasNontoken = /\b(?:nontoken|non-token)\b/i.test(phrase);
  const hasTokenWord = /\btoken\b/i.test(phrase);

  if (hasNontoken && isToken) return false;
  if (!hasNontoken && hasTokenWord && !isToken) return false;

  // Strip token qualifiers from the phrase so the remaining words match the actual type line.
  phrase = phrase
    .replace(/\b(?:nontoken|non-token)\b/gi, '')
    .replace(/\btoken\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return typeLineHasAllWords(typeLine, phrase);
}

function buildTriggeredAbilityGraveyardValidTargets(
  ctx: GameContext,
  controllerId: string,
  metadata: ReturnType<typeof inferTriggeredAbilityTargetMetadata>,
): Array<{ id: string; name: string; typeLine: string; manaCost?: string; imageUrl?: string; zoneOwnerId: string }> {
  const state = (ctx as any).state || {};
  const zones = (state.zones || {}) as Record<string, any>;
  const graveyardScope = String((metadata as any).targetGraveyardScope || 'your').toLowerCase();
  const owners = graveyardScope === 'any'
    ? Object.keys(zones).filter((pid) => Array.isArray(zones[pid]?.graveyard))
    : graveyardScope === 'opponent'
      ? Object.keys(zones).filter((pid) => String(pid) !== String(controllerId) && Array.isArray(zones[pid]?.graveyard))
      : [String(controllerId)];

  // Reconstruct the graveyard target type token using the same naming the
  // matchesGraveyardCardTargetType helper expects. Prefer the most specific
  // representation available on the metadata bundle.
  const filterTypes = Array.isArray(metadata.targetFilterTypes) ? metadata.targetFilterTypes : [];
  const excludeTypes = Array.isArray(metadata.targetFilterExcludeTypes) ? metadata.targetFilterExcludeTypes : [];
  const requiredTypeWords = Array.isArray((metadata as any).targetFilterRequiredTypeWords) ? (metadata as any).targetFilterRequiredTypeWords : [];
  let baseToken: string;
  if (excludeTypes.length === 1 && filterTypes.length === 1) {
    baseToken = `graveyard_non-${String(excludeTypes[0]).toLowerCase()}_${String(filterTypes[0]).toLowerCase()}_card`;
  } else if (excludeTypes.length === 1 && filterTypes.length === 0) {
    baseToken = `graveyard_non-${String(excludeTypes[0]).toLowerCase()}_card`;
  } else if (filterTypes.length === 1) {
    baseToken = `graveyard_${String(filterTypes[0]).toLowerCase()}_card`;
  } else if ((metadata as any).targetFilterPermanentOnly === true) {
    baseToken = 'graveyard_permanent_card';
  } else {
    baseToken = 'graveyard_card';
  }

  const typeTokens = filterTypes.length > 1
    ? filterTypes.map((typeName) => `graveyard_${String(typeName).toLowerCase()}_card`)
    : [baseToken];

  const exactMV = typeof (metadata as any).targetFilterExactManaValue === 'number' ? Number((metadata as any).targetFilterExactManaValue) : undefined;
  const minMV = typeof (metadata as any).targetFilterMinManaValue === 'number' ? Number((metadata as any).targetFilterMinManaValue) : undefined;
  const maxMV = typeof metadata.targetFilterMaxManaValue === 'number' ? Number(metadata.targetFilterMaxManaValue) : undefined;

  const results: Array<{ id: string; name: string; typeLine: string; manaCost?: string; imageUrl?: string; zoneOwnerId: string }> = [];
  for (const ownerId of owners) {
    const graveyard = Array.isArray(zones[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
    for (const card of graveyard) {
      if (!typeTokens.some((token) => matchesGraveyardCardTargetType(card, token))) continue;
      // Required-type words must all appear in the type line (e.g. "Dragon" for
      // "target Dragon creature card from your graveyard"). Hyphens are tolerated.
      if (requiredTypeWords.length > 0) {
        const typeLine = String(card?.type_line || '').toLowerCase();
        if (!requiredTypeWords.every((word: string) => typeLine.includes(String(word).toLowerCase()))) continue;
      }
      const mv = cardManaValue(card);
      if (typeof exactMV === 'number' && Number.isFinite(exactMV) && mv !== exactMV) continue;
      if (typeof minMV === 'number' && Number.isFinite(minMV) && mv < minMV) continue;
      if (typeof maxMV === 'number' && Number.isFinite(maxMV) && mv > maxMV) continue;
      results.push({
        id: String(card?.id || ''),
        name: String(card?.name || card?.id || 'Card'),
        typeLine: String(card?.type_line || ''),
        manaCost: String(card?.mana_cost || ''),
        imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
        zoneOwnerId: String(ownerId),
      });
    }
  }
  return results.filter((entry) => Boolean(entry.id));
}

export function queueSelfETBTriggersForPermanent(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
): void {
  const state = (ctx as any).state;
  if (!state || !permanent?.card) {
    return;
  }

  const selfETBTriggerTypes = new Set([
    'etb',
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
  const allTriggers = getETBTriggersForPermanent(permanent.card, permanent);
  for (const trigger of allTriggers) {
    const triggerAny = trigger as any;
    const triggerType = String((trigger as any)?.triggerType || '').trim();
    const isExplicitSelfETB = selfETBTriggerTypes.has(triggerType);
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
    if (shouldSkipTurnLimitedEtbTrigger(state, trigger, String(permanent.id || ''))) {
      continue;
    }

    const raw = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
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
    const enrichedMetadata = (trigger.requiresTarget || (trigger as any)?.targetZone)
      ? inferTriggeredAbilityTargetMetadata(String(trigger.effect || trigger.description || ''), {
          gameState: (ctx as any).state,
          controllerId: String(controller),
          sourceName: String(trigger.cardName || permanent.card?.name || ''),
          sourcePermanent: permanent,
        } as any)
      : ({} as ReturnType<typeof inferTriggeredAbilityTargetMetadata>);

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
      requiresTarget: trigger.requiresTarget,
      targetType: enrichedMetadata.targetType || trigger.targetType,
      targetConstraint: enrichedMetadata.targetConstraint || trigger.targetConstraint,
      needsTargetSelection: trigger.requiresTarget || false,
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
          requiresTarget: trigger.requiresTarget,
          targetType: enrichedMetadata.targetType || trigger.targetType,
          targetConstraint: enrichedMetadata.targetConstraint || trigger.targetConstraint,
          needsTargetSelection: trigger.requiresTarget || false,
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

    // ETB-trigger graveyard target selection wiring (Coalstoke Gearhulk,
    // Iridescent Drake, etc.). When the just-pushed self-ETB triggered ability
    // requires targeting a graveyard card, queue a GRAVEYARD_SELECTION step so
    // the player can pick before the trigger resolves. The response handler in
    // socket/resolution.ts (triggeredAbilityGraveyardChoice branch) will stamp
    // the chosen card id onto stackItem.targets, after which normal trigger
    // resolution proceeds via executeTriggerEffect's graveyardToBattlefieldMatch
    // (and friends).
    try {
      const gameIdLocal = String((ctx as any).gameId || '').trim();
      const isReplayingLocal = !!(ctx as any).isReplaying;
      const requiresGraveyardTarget =
        gameIdLocal && gameIdLocal !== 'unknown' && !isReplayingLocal &&
        trigger.requiresTarget === true &&
        String((enrichedMetadata as any).targetZone || '').toLowerCase() === 'graveyard';
      if (requiresGraveyardTarget) {
        const validTargets = buildTriggeredAbilityGraveyardValidTargets(
          ctx,
          String(controller),
          enrichedMetadata as any,
        );
        if (validTargets.length > 0) {
          const graveyardScope = String((enrichedMetadata as any).targetGraveyardScope || 'your').toLowerCase();
          const targetPlayerId = graveyardScope === 'your' ? String(controller) : '';
          const minTargets = typeof enrichedMetadata.minTargets === 'number' ? enrichedMetadata.minTargets : 1;
          const maxTargets = typeof enrichedMetadata.maxTargets === 'number' ? enrichedMetadata.maxTargets : 1;
          const sourceName = String(trigger.cardName || permanent.card?.name || 'Triggered ability');
          const queueStep = ResolutionQueueManager.addStep(gameIdLocal, {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: controller as any,
            sourceId: triggerId,
            sourceName,
            description: `${sourceName}: choose target card from a graveyard.`,
            mandatory: trigger.mandatory !== false,
            validTargets,
            minTargets,
            maxTargets,
            targetPlayerId,
            destination: String(enrichedMetadata.targetDestination || 'battlefield').toLowerCase(),
            destinationUsesSelectedCardOwner: enrichedMetadata.destinationUsesSelectedCardOwner === true,
            ...(enrichedMetadata.battlefieldControllerMode ? { battlefieldControllerMode: enrichedMetadata.battlefieldControllerMode } : null),
            ...(enrichedMetadata.battlefieldCounters ? { battlefieldCounters: enrichedMetadata.battlefieldCounters } : null),
            triggeredAbilityGraveyardChoice: true,
            triggerStackItemId: triggerId,
            triggerSourcePermanentId: String(permanent.id || ''),
          } as any);
          appendQueuedResolutionPromptEvent(ctx, {
            playerId: String(controller),
            sourceId: triggerId,
            queuedResolutionStep: queueStep,
          });
          debug(2, `[queueSelfETBTriggersForPermanent] queued GRAVEYARD_SELECTION for ETB trigger ${sourceName} (${validTargets.length} valid targets)`);
        }
      }
    } catch (err) {
      debugWarn(1, '[queueSelfETBTriggersForPermanent] graveyard target selection wiring failed:', err);
    }
  }

  handleRoomDoorStateOnEnter(ctx, permanent, controller);
}

export function persistTriggeredAbilityPush(ctx: GameContext, stackItem: any): void {
  const state = (ctx as any).state;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || !stackItem?.id) {
    return;
  }

  try {
    appendEvent(gameId, (state as any).seq ?? 0, 'pushTriggeredAbility', {
      triggerId: stackItem.id,
      sourceId: stackItem.source,
      permanentId: stackItem.permanentId || stackItem.source,
      sourceName: stackItem.sourceName,
      controllerId: stackItem.controller,
      description: stackItem.description,
      triggerType: stackItem.triggerType,
      ...(stackItem.effect ? { effect: stackItem.effect } : null),
      mandatory: typeof stackItem.mandatory === 'boolean' ? stackItem.mandatory : true,
      ...(typeof stackItem.requiresChoice === 'boolean' ? { requiresChoice: stackItem.requiresChoice } : null),
      ...(typeof stackItem.requiresTarget === 'boolean' ? { requiresTarget: stackItem.requiresTarget } : null),
      ...(typeof stackItem.needsTargetSelection === 'boolean' ? { needsTargetSelection: stackItem.needsTargetSelection } : null),
      ...(stackItem.targetType ? { targetType: stackItem.targetType } : null),
      ...(stackItem.targetConstraint ? { targetConstraint: stackItem.targetConstraint } : null),
      ...(typeof stackItem.isModal === 'boolean' ? { isModal: stackItem.isModal } : null),
      ...(Array.isArray(stackItem.modalOptions) ? { modalOptions: stackItem.modalOptions } : null),
      ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : null),
      ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : null),
      ...(stackItem.triggeringPlayer != null ? { triggeringPlayer: stackItem.triggeringPlayer } : null),
      ...(stackItem.targetZone ? { targetZone: stackItem.targetZone } : null),
      ...(stackItem.targetDestination ? { targetDestination: stackItem.targetDestination } : null),
      ...(stackItem.targetGraveyardScope ? { targetGraveyardScope: stackItem.targetGraveyardScope } : null),
      ...(stackItem.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
      ...(stackItem.battlefieldControllerMode ? { battlefieldControllerMode: stackItem.battlefieldControllerMode } : null),
      ...(stackItem.battlefieldCounters && typeof stackItem.battlefieldCounters === 'object' ? { battlefieldCounters: stackItem.battlefieldCounters } : null),
      ...(stackItem.targetAction ? { targetAction: stackItem.targetAction } : null),
      ...(Array.isArray(stackItem.targetFilterTypes) ? { targetFilterTypes: stackItem.targetFilterTypes } : null),
      ...(Array.isArray(stackItem.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: stackItem.targetFilterRequiredTypeWords } : null),
      ...(Array.isArray(stackItem.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: stackItem.targetFilterExcludeTypes } : null),
      ...(stackItem.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
      ...(typeof stackItem.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: stackItem.targetFilterExactManaValue } : null),
      ...(typeof stackItem.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: stackItem.targetFilterMinManaValue } : null),
      ...(typeof stackItem.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: stackItem.targetFilterMaxManaValue } : null),
      ...(typeof stackItem.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: stackItem.targetTotalPowerLimit } : null),
      ...(stackItem.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
      ...(stackItem.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
      ...(typeof stackItem.minTargets === 'number' ? { minTargets: stackItem.minTargets } : null),
      ...(typeof stackItem.maxTargets === 'number' ? { maxTargets: stackItem.maxTargets } : null),
      ...(stackItem.delayedReturnAt ? { delayedReturnAt: stackItem.delayedReturnAt } : null),
      ...(stackItem.battlefieldTapped === true ? { battlefieldTapped: true } : null),
      ...(stackItem.boundGraveyardCardId ? { boundGraveyardCardId: stackItem.boundGraveyardCardId } : null),
      ...(stackItem.boundGraveyardOwnerId ? { boundGraveyardOwnerId: stackItem.boundGraveyardOwnerId } : null),
      ...(stackItem.interveningIfSubjectPermanentId ? { interveningIfSubjectPermanentId: stackItem.interveningIfSubjectPermanentId } : null),
      ...(stackItem.interveningIfSubjectSnapshot && typeof stackItem.interveningIfSubjectSnapshot === 'object'
        ? { interveningIfSubjectSnapshot: stackItem.interveningIfSubjectSnapshot }
        : null),
      ...(typeof stackItem.value !== 'undefined' ? { value: stackItem.value } : null),
      ...(stackItem.effectData && typeof stackItem.effectData === 'object' ? { effectData: stackItem.effectData } : null),
      ...(stackItem.card && typeof stackItem.card === 'object' ? { card: stackItem.card } : null),
      ...(stackItem.sourcePermanentSnapshot && typeof stackItem.sourcePermanentSnapshot === 'object'
        ? { sourcePermanentSnapshot: stackItem.sourcePermanentSnapshot }
        : null),
    });
  } catch (err) {
    debugWarn(1, '[persistTriggeredAbilityPush] appendEvent(pushTriggeredAbility) failed:', err);
  }
}

function getTemporaryEtbTriggers(state: any): any[] {
  return Array.isArray(state?.temporaryEtbTriggers)
    ? state.temporaryEtbTriggers
    : [];
}

export function addTemporaryEtbTrigger(state: any, entry: any): void {
  if (!state || !entry) return;
  state.temporaryEtbTriggers = getTemporaryEtbTriggers(state);
  state.temporaryEtbTriggers.push(entry);
}

export function clearTemporaryEtbTriggers(state: any): number {
  if (!state || !Array.isArray(state.temporaryEtbTriggers)) return 0;

  const before = state.temporaryEtbTriggers.length;
  const expiringDurations = new Set(['end_of_turn', 'until_end_of_turn', 'eot', 'this_turn']);
  state.temporaryEtbTriggers = state.temporaryEtbTriggers.filter((entry: any) => {
    const expiresAt = String(entry?.expiresAt || '').trim().toLowerCase();
    return !expiringDurations.has(expiresAt);
  });

  if (state.temporaryEtbTriggers.length === 0) {
    delete state.temporaryEtbTriggers;
  }

  return before - (Array.isArray(state.temporaryEtbTriggers) ? state.temporaryEtbTriggers.length : 0);
}

export function queueTemporaryEtbTriggersForEntry(
  ctx: GameContext,
  enteringPermanent: any,
  controller: PlayerID,
  options: {
    isCreature: boolean;
    isEnchantment: boolean;
    isToken: boolean;
  },
): void {
  const state = (ctx as any).state;
  const temporaryTriggers = getTemporaryEtbTriggers(state);
  if (temporaryTriggers.length === 0) return;

  const enteringController = String(controller || '');
  const enteringTypeLine = String(enteringPermanent?.card?.type_line || '');

  for (const entry of temporaryTriggers) {
    if (!entry) continue;

    const triggerController = String(entry?.controller || '');
    if (!triggerController || triggerController !== enteringController) {
      continue;
    }

    const watchTypes = Array.isArray(entry?.watchTypes)
      ? entry.watchTypes.map((value: any) => String(value || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const matchesWatchedType =
      (options.isCreature && watchTypes.includes('creature'))
      || (options.isEnchantment && watchTypes.includes('enchantment'));
    if (!matchesWatchedType) {
      continue;
    }

    if (entry?.nontokenOnly === true && options.isToken) {
      continue;
    }
    if (entry?.tokenOnly === true && !options.isToken) {
      continue;
    }

    const requiredTypeRaw = typeof entry?.requiredTypePhrase === 'string'
      ? String(entry.requiredTypePhrase)
      : '';
    const requiredType = requiredTypeRaw
      .replace(/\bcreatures\b/gi, 'creature')
      .replace(/\bartifacts\b/gi, 'artifact')
      .trim();
    if (requiredType && !matchesRequiredTypePhrase(enteringTypeLine, requiredType, options.isToken)) {
      continue;
    }

    const triggerText = typeof entry?.triggerText === 'string' ? String(entry.triggerText).trim() : '';
    if (triggerText) {
      try {
        const satisfied = isInterveningIfSatisfied(
          ctx as any,
          triggerController,
          triggerText,
          enteringPermanent,
        );
        if (satisfied === false) {
          continue;
        }
      } catch {
        // Conservative fallback: keep the trigger if evaluation fails.
      }
    }

    state.stack = state.stack || [];
    const stackItem = {
      id: uid('trigger'),
      type: 'triggered_ability',
      controller: triggerController,
      source: String(entry?.sourceId || entry?.id || ''),
      sourceName: String(entry?.sourceName || 'Temporary ETB Trigger'),
      description: String(entry?.description || entry?.effect || '').trim(),
      triggerType: String(entry?.triggerType || 'temporary_etb'),
      mandatory: entry?.mandatory !== false,
      interveningIfSubjectPermanentId: enteringPermanent?.id,
      interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(enteringPermanent),
    } as any;
    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);
    persistTriggeredAbilityPush(ctx, stackItem);

    debug(2, `[queueTemporaryEtbTriggersForEntry] âš¡ ${stackItem.sourceName}: ${stackItem.description}`);
  }
}

function incrementTurnCounter(
  state: any,
  field: string,
  controller: PlayerID,
): void {
  (state as any)[field] = (state as any)[field] || {};
  const key = String(controller);
  (state as any)[field][key] = ((state as any)[field][key] || 0) + 1;
}

function recordPermanentIdEnteredThisTurn(
  state: any,
  field: string,
  controller: PlayerID,
  permanentId: string,
): void {
  (state as any)[field] = (state as any)[field] || {};
  const key = String(controller);
  const byController = (state as any)[field];
  byController[key] = byController[key] || {};
  byController[key][String(permanentId)] = true;
}

export function recordBattlefieldEntryTurnTracking(
  state: any,
  controller: PlayerID,
  permanent: any,
  options?: { trackFaceDownAndSubtype?: boolean },
): void {
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isLand = typeLine.includes('land');
  const isArtifact = typeLine.includes('artifact');
  const isEnchantment = typeLine.includes('enchantment');
  const isPlaneswalker = typeLine.includes('planeswalker');
  const isBattle = typeLine.includes('battle');
  const permanentId = String(permanent?.id || '');

  if (!isLand) {
    incrementTurnCounter(state, 'nonlandPermanentsEnteredBattlefieldThisTurn', controller);
  }
  if (isLand) {
    incrementTurnCounter(state, 'landsEnteredBattlefieldThisTurn', controller);
  }
  if (isCreature) {
    incrementTurnCounter(state, 'creaturesEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'creaturesEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }

    if (options?.trackFaceDownAndSubtype) {
      try {
        const isFaceDown =
          permanent?.faceDown === true || permanent?.isFaceDown === true || permanent?.faceDownCreature === true;
        if (isFaceDown) {
          incrementTurnCounter(state, 'faceDownCreaturesEnteredBattlefieldThisTurnByController', controller);
        }
      } catch {
        // best-effort tracking only
      }

      try {
        const typeLineRaw = String(permanent?.card?.type_line || '');
        const typeLineLower = typeLineRaw.toLowerCase();
        const dashSplit = typeLineLower.split(/â€”|\s-\s/);
        const subtypePart = dashSplit.length > 1 ? dashSplit.slice(1).join(' ') : '';
        const subtypeTokens = subtypePart
          .split(/\s+/)
          .map((t) => t.replace(/[^a-z0-9-]/g, '').trim())
          .filter(Boolean);

        if (subtypeTokens.length) {
          (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype =
            (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype || {};
          const key = String(controller);
          const byController = (state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype;
          byController[key] = byController[key] || {};
          for (const st of subtypeTokens) {
            byController[key][st] = (byController[key][st] || 0) + 1;
          }
        }
      } catch {
        // best-effort tracking only
      }
    }
  }
  if (isArtifact) {
    incrementTurnCounter(state, 'artifactsEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'artifactsEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
  if (isEnchantment) {
    incrementTurnCounter(state, 'enchantmentsEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'enchantmentsEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
  if (isPlaneswalker) {
    incrementTurnCounter(state, 'planeswalkersEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'planeswalkersEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
  if (isBattle) {
    incrementTurnCounter(state, 'battlesEnteredBattlefieldThisTurnByController', controller);
    if (permanentId) {
      recordPermanentIdEnteredThisTurn(
        state,
        'battlesEnteredBattlefieldThisTurnIdsByController',
        controller,
        permanentId,
      );
    }
  }
}

export function triggerETBEffectsForToken(
  ctx: GameContext,
  token: any,
  controller: PlayerID
): void {
  const state = (ctx as any).state;
  if (!state?.battlefield) return;

  stampPermanentControlEntryForEcho(state, token, String(controller));
  
  const typeLineLower = String(token.card?.type_line || '').toLowerCase();
  const isCreature = typeLineLower.includes('creature');
  const isEnchantment = typeLineLower.includes('enchantment');
  const isToken = true; // By definition, this is a token

  // Track "entered this turn" counters for intervening-if templates.
  // (Tokens can matter here: e.g. Treasures for artifact ETBs.)
  recordBattlefieldEntryTurnTracking(state, controller, token);
  const pendingExternalEtbTriggers: any[] = [];
  
  // Check all other permanents for triggers that fire when creatures/permanents enter
  for (const perm of state.battlefield) {
    if (!perm || perm.id === token.id) continue;
    
    const otherTriggers = getETBTriggersForPermanent(perm.card, perm);
    for (const trigger of otherTriggers) {
      // creature_etb triggers (Cathars' Crusade, Soul Warden, etc.)
      if (trigger.triggerType === 'creature_etb' && isCreature) {
        // Check if this trigger requires nontoken creatures (e.g., Guardian Project)
        if ((trigger as any).nontokenOnly && isToken) {
          continue; // Skip - this trigger only fires for nontoken creatures
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
          const enteringTypeLine = String(token.card?.type_line || '');
          if (!matchesRequiredTypePhrase(enteringTypeLine, requiredType, isToken)) {
            continue;
          }
        }
        
        // Determine trigger controller
        const triggerController = perm.controller || controller;

        const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
        const needsThatPlayerRef = /\bthat player\b/i.test(desc);
        const triggeringPlayerForStack = needsThatPlayerRef ? String(controller) : undefined;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        // These ETB triggers come from OTHER permanents (not the entering token), so we must filter here.
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
            token,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
            continue;
          }
        } catch {
          // Conservative fallback: keep the trigger if evaluation fails.
        }
        
        // Push trigger onto the stack
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
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }

      if (trigger.triggerType === 'chosen_type_creature_etb' && isCreature) {
        if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, token, controller, isToken, isCreature)) {
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
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s chosen-type ETB trigger for token: ${trigger.description}`);
      }

      if (trigger.triggerType === 'chosen_type_creature_etb_or_attack' && isCreature) {
        if (!shouldQueueChosenTypeCreatureEtbTrigger(trigger, perm, token, controller, isToken, isCreature)) {
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
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s chosen-type enters-or-attacks trigger for token: ${trigger.description}`);
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
            token,
            triggeringPlayerForStack
              ? {
                  thatPlayerId: triggeringPlayerForStack,
                  referencedPlayerId: triggeringPlayerForStack,
                  theirPlayerId: triggeringPlayerForStack,
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
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
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
          ...(triggeringPlayerForStack ? { triggeringPlayer: triggeringPlayerForStack } : {}),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
      }
      
      // permanent_etb triggers (Altar of the Brood style - triggers on ANY permanent)
      if (trigger.triggerType === 'permanent_etb') {
        const triggerController = perm.controller || controller;

        // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
        try {
          const desc = String((trigger as any)?.description || (trigger as any)?.effect || '').trim();
          let textForEval = desc;
          if (!/^(?:when|whenever|at)\b/i.test(textForEval)) {
            textForEval = `Whenever a permanent enters the battlefield, ${textForEval}`;
          }
          const satisfied = isInterveningIfSatisfied(
            ctx as any,
            String(triggerController),
            textForEval,
            token,
            /\bthat player\b/i.test(textForEval) && String(controller || '')
              ? {
                  thatPlayerId: String(controller),
                  referencedPlayerId: String(controller),
                  theirPlayerId: String(controller),
                }
              : undefined
          );
          if (satisfied === false) {
            debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
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
          interveningIfSubjectPermanentId: token.id,
          interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
        } as any;
        pendingExternalEtbTriggers.push(stackItem);
        
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s triggered ability for token: ${trigger.description}`);
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
              token,
              needsThatPlayerRef && String(controller || '')
                ? {
                    thatPlayerId: String(controller),
                    referencedPlayerId: String(controller),
                    theirPlayerId: String(controller),
                  }
                : undefined
            );
            if (satisfied === false) {
              debug(2, `[triggerETBEffectsForToken] Skipping ETB trigger due to unmet intervening-if: ${trigger.cardName} - ${desc}`);
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
            interveningIfSubjectPermanentId: token.id,
            interveningIfSubjectSnapshot: buildInterveningIfSubjectSnapshot(token),
          } as any;
          pendingExternalEtbTriggers.push(stackItem);
          
          debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s opponent creature ETB trigger: ${trigger.description}`);
        }
      }

      const typedEtbStackItem = tryBuildTypedPermanentEtbStackItem(
        ctx,
        trigger,
        perm,
        token,
        String(controller),
      );
      if (typedEtbStackItem) {
        pendingExternalEtbTriggers.push(typedEtbStackItem);
        debug(2, `[triggerETBEffectsForToken] âš¡ ${trigger.cardName}'s typed ETB trigger for token: ${trigger.description}`);
      }
    }
  }

  state.stack = state.stack || [];
  const orderedExternalEtbTriggers = orderTriggersByAPNAP(
    ctx as any,
    pendingExternalEtbTriggers.map((stackItem, originalIndex) => ({
      controllerId: String(stackItem?.controller || ''),
      originalIndex,
      stackItem,
    })),
  ).map((entry: any) => entry.stackItem);

  for (const stackItem of orderedExternalEtbTriggers) {
    state.stack.push(stackItem);
    pushTriggerDoublerCopies(state, stackItem);
    persistTriggeredAbilityPush(ctx, stackItem);
  }

  queueTemporaryEtbTriggersForEntry(ctx, token, controller, {
    isCreature,
    isEnchantment,
    isToken,
  });
}

