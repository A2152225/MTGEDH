import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { ResolutionStepType } from '../resolution/index.js';
import { uid } from '../utils.js';
import { getOrInitManaPool, parseManaCost, resolveManaCostForPoolPayment } from '../../socket/util.js';
import { movePermanentToExile } from './counters_tokens.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import {
  buildTriggerSourcePermanentSnapshot,
  getTriggerSourcePermanent,
} from './triggerSourceUtils.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
import { permanentIsCommanderCard, wasPermanentCardMovedToExile } from './triggerPermanentUtils.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import {
  cardMatchesReflexiveGraveyardExileType,
  formatReflexiveFixedPaymentLabel,
  formatReflexiveGraveyardExileLabel,
  formatReflexiveSacrificeTypeLabel,
  materializeReflexiveSourceText,
  parseReflexiveBoundGraveyardSelfExileWhenYouDo,
  parseReflexiveConditionalBattlefieldSelfExileWhenYouDo,
  parseReflexiveConvertWhenYouDo,
  parseReflexiveDiscardWhenYouDo,
  parseReflexiveFixedPaymentWhenYouDo,
  parseReflexiveExileToOwnersGraveyardWhenYouDo,
  formatReflexiveExileToOwnersGraveyardLabel,
  collectOpponentOwnedExileCardTargets,
  parseReflexiveGraveyardExileWhenYouDo,
  parseReflexiveSacrificeWhenYouDo,
  permanentMatchesReflexiveSacrificeType,
} from './reflexive-triggers.js';
import { executeReflexiveBoundSelfExilePrelude } from './triggerReflexiveBoundSelfExilePreludeUtils.js';
import { maybeQueueReflexiveAnyAmountManaPayment } from './triggerReflexiveWhenYouDoQueueUtils-handlers/maybeQueueReflexiveAnyAmountManaPayment.js';

export type ReflexiveTriggerEffectRunner = (
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem?: any,
) => void;

function maybeQueueReflexiveFixedPaymentWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveFixedPaymentWhenYouDo(description);
  if (!parsed) return false;

  // IR Effect Program owns "you may pay {C}. If you do, …" (Agrus multi-copy).
  // Do not intercept with a legacy pay/decline prompt.
  if (isTriggerEffectOwnedByOracleIrPrimary(description, sourceName)) {
    return false;
  }

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive fixed payment for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const lifeAmount = Math.max(0, Math.floor(Number(parsed.lifeAmount || 0)));
  if (lifeAmount > 0) {
    const startingLife = Number((ctx as any)?.state?.startingLife ?? 40);
    const currentLife = Number((ctx as any)?.state?.life?.[triggerController] ?? startingLife);
    if (!Number.isFinite(currentLife) || currentLife < lifeAmount) {
      debug(2, `[resolveTopOfStack] Reflexive fixed payment for ${sourceName}: insufficient life for ${lifeAmount}`);
      return true;
    }
  }

  if (parsed.manaCost) {
    const pool = getOrInitManaPool((ctx as any).state as any, triggerController) as any;
    const resolved = resolveManaCostForPoolPayment(pool, parsed.manaCost);
    if (!resolved.ok) {
      debug(2, `[resolveTopOfStack] Reflexive fixed payment for ${sourceName}: ${(resolved as any).error || 'insufficient mana'}`);
      return true;
    }
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const triggerStackItemId = String((item as any).id || sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const paymentLabel = formatReflexiveFixedPaymentLabel(parsed);
  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: You may pay ${paymentLabel}.`,
    mandatory: false,
    options: [
      {
        id: 'pay',
        label: `Pay ${paymentLabel}`,
        description: followupDescription,
      },
      {
        id: 'decline',
        label: 'Decline',
        description: 'Do not pay the optional cost.',
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    reflexiveFixedPaymentChoice: true,
    reflexiveFixedPaymentManaCost: parsed.manaCost,
    reflexiveFixedPaymentLifeAmount: lifeAmount || undefined,
    reflexiveFixedPaymentText: parsed.paymentText,
    reflexiveFixedPaymentFollowupText: parsed.followupText,
    reflexiveFixedPaymentOriginalEffect: description,
    reflexiveFixedPaymentController: String(triggerController),
    reflexiveFixedPaymentSourceName: sourceName,
    reflexiveFixedPaymentSourcePermanentId: sourcePermanentId || undefined,
    reflexiveFixedPaymentTriggerStackItemId: triggerStackItemId || undefined,
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive fixed payment trigger for ${sourceName} (${triggerController})`);
  return true;
}

function maybeQueueReflexiveSacrificeWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveSacrificeWhenYouDo(description);
  if (!parsed) return false;

  // IR Effect Program owns "you may sacrifice …. If you do, …" (yes/no then target).
  // Do not intercept with the legacy sacrifice/decline prompt.
  if (isTriggerEffectOwnedByOracleIrPrimary(description, sourceName)) {
    return false;
  }

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive sacrifice trigger for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  const validSacrifices = battlefield.filter((permanent: any) =>
    permanentMatchesReflexiveSacrificeType(permanent, String(triggerController), parsed.sacrificeType, sourcePermanentId || undefined)
  );

  if (validSacrifices.length === 0) {
    debug(2, `[resolveTopOfStack] Reflexive sacrifice trigger for ${sourceName}: no ${parsed.sacrificeType} available`);
    return true;
  }

  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);
  const sacrificeLabel = formatReflexiveSacrificeTypeLabel(parsed.sacrificeType);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: You may sacrifice ${sacrificeLabel}.`,
    mandatory: false,
    options: [
      {
        id: 'sacrifice',
        label: `Sacrifice ${sacrificeLabel}`,
        description: followupDescription,
      },
      {
        id: 'decline',
        label: 'Decline',
        description: 'Do not sacrifice anything.',
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    sacrificeWhenYouDo: true,
    sacrificeWhenYouDoStage: 'ask',
    sacrificeWhenYouDoSubtype: parsed.sacrificeType,
    sacrificeWhenYouDoController: String(triggerController),
    sacrificeWhenYouDoSourceName: sourceName,
    sacrificeWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
    sacrificeWhenYouDoFollowupDescription: followupDescription,
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive sacrifice trigger for ${sourceName} (${triggerController})`);
  return true;
}

function maybeQueueReflexiveDiscardWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveDiscardWhenYouDo(description);
  if (!parsed) return false;

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive discard trigger for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const zones = (ctx as any).state?.zones || {};
  const hand = Array.isArray(zones?.[triggerController]?.hand) ? zones[triggerController].hand : [];
  if (hand.length < parsed.discardCount) {
    debug(2, `[resolveTopOfStack] Reflexive discard trigger for ${sourceName}: no card available to discard`);
    return true;
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: You may discard a card.`,
    mandatory: false,
    options: [
      {
        id: 'discard',
        label: 'Discard a card',
        description: followupDescription,
      },
      {
        id: 'decline',
        label: 'Decline',
        description: 'Do not discard a card.',
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    reflexiveDiscardWhenYouDo: true,
    reflexiveDiscardWhenYouDoStage: 'ask',
    reflexiveDiscardWhenYouDoCount: parsed.discardCount,
    reflexiveDiscardWhenYouDoController: String(triggerController),
    reflexiveDiscardWhenYouDoSourceName: sourceName,
    reflexiveDiscardWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
    reflexiveDiscardWhenYouDoFollowupDescription: followupDescription,
    reflexiveDiscardWhenYouDoOriginalEffect: description,
    ...(/^draw a card\b/i.test(followupDescription)
      ? { afterDiscardDrawCount: 1 }
      : null),
    ...(/if a land card was discarded this way/i.test(`${followupDescription} ${description}`)
      ? { afterDiscardDrawCountIfDiscardedLand: 1 }
      : null),
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive discard trigger for ${sourceName} (${triggerController})`);
  return true;
}

function maybeQueueReflexiveConvertWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveConvertWhenYouDo(description);
  if (!parsed) return false;

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive convert trigger for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
  const sourcePermanentId = String((item as any).source || (item as any).permanentId || sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const sourcePermanent = sourcePermanentId
    ? battlefield.find((permanent: any) => String(permanent?.id || '') === sourcePermanentId)
    : undefined;
  const cardFaces = Array.isArray(sourcePermanent?.card?.card_faces) ? sourcePermanent.card.card_faces : [];
  if (!sourcePermanent || cardFaces.length < 2) {
    debug(2, `[resolveTopOfStack] Reflexive convert trigger for ${sourceName}: source permanent cannot convert`);
    return true;
  }

  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);
  const subjectLabel = parsed.subjectText || sourceName;

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: sourcePermanentId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: ${parsed.isMayAbility ? 'You may ' : ''}convert ${subjectLabel}.`,
    mandatory: !parsed.isMayAbility,
    options: [
      {
        id: 'convert',
        label: 'Convert',
        description: followupDescription,
      },
      ...(parsed.isMayAbility
        ? [{ id: 'decline', label: 'Decline', description: `Do not convert ${subjectLabel}.` }]
        : []),
    ],
    minSelections: 1,
    maxSelections: 1,
    reflexiveConvertWhenYouDo: true,
    reflexiveConvertWhenYouDoController: String(triggerController),
    reflexiveConvertWhenYouDoSourceName: sourceName,
    reflexiveConvertWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
    reflexiveConvertWhenYouDoSubject: subjectLabel,
    reflexiveConvertWhenYouDoFollowupDescription: followupDescription,
    reflexiveConvertWhenYouDoOriginalEffect: description,
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive convert trigger for ${sourceName} (${triggerController})`);
  return true;
}

function findBoundReflexiveGraveyardCard(state: any, cardId: string, preferredOwnerId?: string): { card: any; ownerId: string } | null {
  const zones = state?.zones || {};
  const ownerIds = preferredOwnerId
    ? [String(preferredOwnerId)]
    : Object.keys(zones || {});

  for (const ownerId of ownerIds) {
    const graveyard = Array.isArray(zones?.[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
    const card = graveyard.find((entry: any) => entry && String(entry.id || '') === cardId);
    if (card) {
      return { card, ownerId };
    }
  }

  if (preferredOwnerId) {
    for (const ownerId of Object.keys(zones || {})) {
      if (String(ownerId) === String(preferredOwnerId)) continue;
      const graveyard = Array.isArray(zones?.[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
      const card = graveyard.find((entry: any) => entry && String(entry.id || '') === cardId);
      if (card) {
        return { card, ownerId };
      }
    }
  }

  return null;
}

function normalizeReflexiveCounterTypeName(counterType: string): string {
  return String(counterType || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getPermanentCounterAmount(permanent: any, counterType: string): number {
  const wanted = normalizeReflexiveCounterTypeName(counterType);
  const counters = permanent?.counters && typeof permanent.counters === 'object' ? permanent.counters : {};
  for (const [existingType, amountRaw] of Object.entries(counters)) {
    if (normalizeReflexiveCounterTypeName(existingType) === wanted) {
      return Math.max(0, Number(amountRaw) || 0);
    }
  }
  return 0;
}

function maybeResolveReflexiveConditionalBattlefieldSelfExileWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
  executeTriggerEffect: ReflexiveTriggerEffectRunner,
): boolean {
  const parsed = parseReflexiveConditionalBattlefieldSelfExileWhenYouDo(description);
  if (!parsed) return false;

  const stateAny = (ctx as any).state || {};
  const sourcePermanentId = String(
    (item as any)?.effectData?.targetPermanentId ||
    (item as any)?.triggeringPermanent ||
    (item as any)?.source ||
    (item as any)?.permanentId ||
    sourceId ||
    '',
  ).trim();

  executeTriggerEffect(
    ctx,
    triggerController,
    sourceName,
    parsed.preludeText,
    { ...(item || {}), description: parsed.preludeText, effect: parsed.preludeText },
  );

  const battlefield = Array.isArray(stateAny.battlefield) ? stateAny.battlefield : [];
  const sourcePermanent = sourcePermanentId
    ? battlefield.find((permanent: any) => permanent && String(permanent.id || '') === sourcePermanentId)
    : null;
  if (!sourcePermanent) {
    return true;
  }

  const sourceTypeLine = String(sourcePermanent?.card?.type_line || '').toLowerCase();
  if (parsed.selfReferenceType !== 'permanent' && !sourceTypeLine.includes(parsed.selfReferenceType)) {
    return true;
  }

  if (getPermanentCounterAmount(sourcePermanent, parsed.conditionCounterType) > 0) {
    return true;
  }

  const permanentSnapshot = {
    ...(sourcePermanent as any),
    card: sourcePermanent.card && typeof sourcePermanent.card === 'object' ? { ...(sourcePermanent.card as any) } : sourcePermanent.card,
  };
  const gameId = String((ctx as any).gameId || '').trim();

  if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying && !permanentIsCommanderCard(ctx, sourcePermanent)) {
    try {
      appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? stateAny.seq ?? 0), 'exilePermanent', {
        permanentId: sourcePermanentId,
        sourcePermanentId,
        sourceName,
        reason: 'reflexive_conditional_battlefield_self_exile',
      });
    } catch (err) {
      debugWarn(1, `[resolveTopOfStack] appendEvent(exilePermanent conditional reflexive) failed for ${sourceName}:`, err);
    }
  }

  movePermanentToExile(ctx, sourcePermanentId, { exiledWithSourceId: sourcePermanentId, exiledWithSourceName: sourceName });
  if (!wasPermanentCardMovedToExile(stateAny, permanentSnapshot)) {
    return true;
  }

  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);
  const targetMetadata = inferTriggeredAbilityTargetMetadata(followupDescription);
  const triggerId = uid('trigger');
  const stackItem = {
    id: triggerId,
    type: 'triggered_ability',
    controller: triggerController,
    source: sourcePermanentId,
    permanentId: sourcePermanentId,
    sourceName,
    description: followupDescription,
    effect: followupDescription,
    triggerType: 'reflexive_battlefield_self_exile',
    mandatory: true,
    ...targetMetadata,
    sourcePermanentSnapshot: permanentSnapshot,
    effectData: {
      exiledPermanentId: sourcePermanentId,
      exiledCardId: String(permanentSnapshot?.card?.id || '').trim() || undefined,
      exiledCardOwnerId: String(permanentSnapshot?.owner || permanentSnapshot?.controller || '').trim() || undefined,
      conditionCounterType: parsed.conditionCounterType,
      originalEffect: description,
    },
    card: permanentSnapshot.card,
  } as any;

  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  stateAny.stack.push(stackItem);

  if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying) {
    try {
      appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? stateAny.seq ?? 0), 'pushTriggeredAbility', {
        triggerId,
        sourceId: sourcePermanentId,
        permanentId: sourcePermanentId,
        sourceName,
        controllerId: String(triggerController),
        description: followupDescription,
        effect: followupDescription,
        triggerType: 'reflexive_battlefield_self_exile',
        mandatory: true,
        ...targetMetadata,
        sourcePermanentSnapshot: permanentSnapshot,
        card: permanentSnapshot.card,
        effectData: stackItem.effectData,
      });
    } catch (err) {
      debugWarn(1, `[resolveTopOfStack] appendEvent(pushTriggeredAbility conditional reflexive) failed for ${sourceName}:`, err);
    }
  }

  debug(2, `[resolveTopOfStack] Resolved conditional battlefield self-exile reflexive for ${sourceName}`);
  return true;
}

function maybeQueueReflexiveBoundGraveyardSelfExileWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveBoundGraveyardSelfExileWhenYouDo(description);
  if (!parsed) return false;

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive bound graveyard exile trigger for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const dyingCreature = (item as any)?.dyingCreature || null;
  const boundCardId = String(
    (item as any)?.boundGraveyardCardId ||
    dyingCreature?.faceUpCard?.id ||
    dyingCreature?.card?.id ||
    '',
  ).trim();
  const preferredOwnerId = String(
    (item as any)?.boundGraveyardOwnerId ||
    dyingCreature?.owner ||
    dyingCreature?.controller ||
    '',
  ).trim();

  if (!executeReflexiveBoundSelfExilePrelude(ctx, parsed.preludeText, triggerController, sourceName, sourcePermanentId || String(sourceId || '').trim())) {
    return false;
  }

  if (!boundCardId) {
    debug(2, `[resolveTopOfStack] Reflexive bound graveyard exile trigger for ${sourceName}: no bound graveyard card id`);
    return true;
  }

  const boundEntry = findBoundReflexiveGraveyardCard((ctx as any).state, boundCardId, preferredOwnerId || undefined);
  if (!boundEntry) {
    debug(2, `[resolveTopOfStack] Reflexive bound graveyard exile trigger for ${sourceName}: bound card is not in a graveyard`);
    return true;
  }

  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);
  const boundCardName = String(boundEntry.card?.name || sourceName || 'that card').trim() || 'that card';
  const sourceSnapshot = (item as any)?.sourcePermanentSnapshot || dyingCreature || null;

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal || boundEntry.card?.image_uris?.small || boundEntry.card?.image_uris?.normal,
    description: `${sourceName}: You may exile ${boundCardName}.`,
    mandatory: false,
    options: [
      {
        id: 'exile',
        label: `Exile ${boundCardName}`,
        description: followupDescription,
      },
      {
        id: 'decline',
        label: 'Decline',
        description: 'Do not exile it.',
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    reflexiveBoundGraveyardSelfExileWhenYouDo: true,
    reflexiveBoundGraveyardSelfExileWhenYouDoStage: 'ask',
    reflexiveBoundGraveyardSelfExileWhenYouDoController: String(triggerController),
    reflexiveBoundGraveyardSelfExileWhenYouDoSourceName: sourceName,
    reflexiveBoundGraveyardSelfExileWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
    reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardId: boundCardId,
    reflexiveBoundGraveyardSelfExileWhenYouDoBoundOwnerId: boundEntry.ownerId,
    reflexiveBoundGraveyardSelfExileWhenYouDoBoundCardName: boundCardName,
    reflexiveBoundGraveyardSelfExileWhenYouDoFollowupDescription: followupDescription,
    reflexiveBoundGraveyardSelfExileWhenYouDoFollowupConnector: parsed.followupConnector,
    reflexiveBoundGraveyardSelfExileWhenYouDoOriginalEffect: description,
    reflexiveBoundGraveyardSelfExileWhenYouDoSourcePermanentSnapshot: sourceSnapshot && typeof sourceSnapshot === 'object'
      ? { ...(sourceSnapshot as any), card: sourceSnapshot.card && typeof sourceSnapshot.card === 'object' ? { ...(sourceSnapshot.card as any) } : sourceSnapshot.card }
      : undefined,
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive bound graveyard exile trigger for ${sourceName} (${triggerController})`);
  return true;
}

function maybeQueueReflexiveGraveyardExileWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveGraveyardExileWhenYouDo(description);
  if (!parsed) return false;

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive graveyard exile trigger for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const zones = (ctx as any).state?.zones || {};
  const graveyard = Array.isArray(zones?.[triggerController]?.graveyard) ? zones[triggerController].graveyard : [];
  const validTargets = graveyard
    .filter((card: any) => cardMatchesReflexiveGraveyardExileType(card, parsed.cardType))
    .map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || card?.id || 'Card'),
      typeLine: String(card?.type_line || ''),
      manaCost: String(card?.mana_cost || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      zoneOwnerId: String(triggerController),
    }))
    .filter((card: any) => Boolean(card.id));

  if (validTargets.length < parsed.exileCount) {
    debug(2, `[resolveTopOfStack] Reflexive graveyard exile trigger for ${sourceName}: not enough matching graveyard cards`);
    return true;
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);
  const exileLabel = formatReflexiveGraveyardExileLabel(parsed.exileCount, parsed.cardType);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: You may exile ${exileLabel} from your graveyard.`,
    mandatory: false,
    options: [
      {
        id: 'exile',
        label: `Exile ${exileLabel}`,
        description: followupDescription,
      },
      {
        id: 'decline',
        label: 'Decline',
        description: 'Do not exile a card from your graveyard.',
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    reflexiveGraveyardExileWhenYouDo: true,
    reflexiveGraveyardExileWhenYouDoStage: 'ask',
    reflexiveGraveyardExileWhenYouDoCount: parsed.exileCount,
    reflexiveGraveyardExileWhenYouDoCardType: parsed.cardType || undefined,
    reflexiveGraveyardExileWhenYouDoController: String(triggerController),
    reflexiveGraveyardExileWhenYouDoSourceName: sourceName,
    reflexiveGraveyardExileWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
    reflexiveGraveyardExileWhenYouDoFollowupDescription: followupDescription,
    reflexiveGraveyardExileWhenYouDoOriginalEffect: description,
    reflexiveGraveyardExileWhenYouDoValidTargets: validTargets,
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive graveyard exile trigger for ${sourceName} (${triggerController})`);
  return true;
}


function maybeQueueReflexiveExileToOwnersGraveyardWhenYouDo(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const parsed = parseReflexiveExileToOwnersGraveyardWhenYouDo(description);
  if (!parsed) return false;

  if ((ctx as any).isReplaying) {
    debug(2, `[resolveTopOfStack] Reflexive exile-to-GY processor for ${sourceName}: skipping prompt discovery during replay`);
    return true;
  }

  const validTargets = collectOpponentOwnedExileCardTargets((ctx as any).state, String(triggerController));
  if (validTargets.length < parsed.putCount) {
    debug(2, `[resolveTopOfStack] Reflexive exile-to-GY processor for ${sourceName}: not enough opponent-owned exile cards`);
    return true;
  }

  const sourcePermanentId = String((item as any).source || (item as any).permanentId || '').trim();
  const promptSourceId = sourcePermanentId || String(sourceId || '').trim();
  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(getTriggerSourcePermanent((ctx as any).state, item));
  const followupDescription = materializeReflexiveSourceText(parsed.followupText, sourceName);
  const putLabel = formatReflexiveExileToOwnersGraveyardLabel(parsed.putCount);

  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: triggerController as PlayerID,
    sourceId: promptSourceId || undefined,
    sourceName,
    sourceImage: (item as any)?.card?.image_uris?.small || (item as any)?.card?.image_uris?.normal,
    description: `${sourceName}: You may put ${putLabel}.`,
    mandatory: false,
    options: [
      {
        id: 'put',
        label: `Put ${putLabel}`,
        description: followupDescription,
      },
      {
        id: 'decline',
        label: 'Decline',
        description: 'Do not put cards from exile into graveyards.',
      },
    ],
    minSelections: 1,
    maxSelections: 1,
    reflexiveExileToOwnersGraveyardWhenYouDo: true,
    reflexiveExileToOwnersGraveyardWhenYouDoStage: 'ask',
    reflexiveExileToOwnersGraveyardWhenYouDoCount: parsed.putCount,
    reflexiveExileToOwnersGraveyardWhenYouDoController: String(triggerController),
    reflexiveExileToOwnersGraveyardWhenYouDoSourceName: sourceName,
    reflexiveExileToOwnersGraveyardWhenYouDoSourcePermanentId: sourcePermanentId || undefined,
    reflexiveExileToOwnersGraveyardWhenYouDoFollowupDescription: followupDescription,
    reflexiveExileToOwnersGraveyardWhenYouDoOriginalEffect: description,
    reflexiveExileToOwnersGraveyardWhenYouDoValidTargets: validTargets,
    ...(sourcePermanentSnapshot ? { sourcePermanentSnapshot } : null),
  } as any);

  debug(2, `[resolveTopOfStack] Deferred reflexive exile-to-GY processor for ${sourceName} (${triggerController})`);
  return true;
}

export function tryDeferReflexiveWhenYouDoTriggers(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  trimmedDescription: string,
  effectText: string,
  executeTriggerEffect: ReflexiveTriggerEffectRunner,
): boolean {
  const description = effectText || trimmedDescription;

  if (maybeQueueReflexiveAnyAmountManaPayment(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive mana payment trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveFixedPaymentWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive fixed payment trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveExileToOwnersGraveyardWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive exile-to-GY processor for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveDiscardWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive discard trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveConvertWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive convert trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeResolveReflexiveConditionalBattlefieldSelfExileWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description, executeTriggerEffect)) {
    debug(2, `[resolveTopOfStack] Resolved reflexive conditional battlefield exile trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveBoundGraveyardSelfExileWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive bound graveyard exile trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveGraveyardExileWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive graveyard exile trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueReflexiveSacrificeWhenYouDo(ctx, item, triggerController, sourceName, sourceId, description)) {
    debug(2, `[resolveTopOfStack] Deferred reflexive sacrifice trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  return false;
}

function isOracleIrReflexiveWhenYouDoStep(step: { kind?: string; timing?: string; raw?: string; effect?: string }): boolean {
  if (String(step?.kind || '') !== 'schedule_delayed_trigger') return false;
  if (String(step?.timing || '').trim() !== 'on_event') return false;
  const raw = `${String(step.raw || '')} ${String(step.effect || '')}`.trim();
  return /^when you do(?: so)?\b/i.test(String(step.raw || '').trim())
    || /^when you do(?: so)?\b/i.test(String(step.effect || '').trim())
    || /\bwhen you do(?: so)?,/i.test(raw);
}

function stripReflexiveWhenYouDoPrefix(text: string): string {
  return String(text || '')
    .replace(/^when you do(?: so)?,?\s*/i, '')
    .trim();
}

function collectCreatedTokenIdsFromOracleIR(
  state: any,
  result: { readonly appliedSteps?: readonly { kind?: string }[]; readonly replayMutations?: readonly { kind?: string; tokenData?: { id?: string } }[] },
  battlefieldIdsBefore: ReadonlySet<string>,
): string[] {
  const fromMutations = (Array.isArray(result.replayMutations) ? result.replayMutations : [])
    .filter((mutation) => mutation?.kind === 'createToken')
    .map((mutation) => String(mutation?.tokenData?.id || '').trim())
    .filter(Boolean);
  const fromBattlefield = (Array.isArray(state?.battlefield) ? state.battlefield : [])
    .filter((permanent: any) => {
      const id = String(permanent?.id || '').trim();
      if (!id || battlefieldIdsBefore.has(id)) return false;
      return permanent?.isToken === true;
    })
    .map((permanent: any) => String(permanent.id).trim())
    .filter(Boolean);
  return Array.from(new Set([...fromMutations, ...fromBattlefield]));
}

export function queueOracleIrReflexiveWhenYouDoFollowups(
  ctx: GameContext,
  state: any,
  result: {
    readonly appliedSteps?: readonly { kind?: string; timing?: string; raw?: string; effect?: string }[];
    readonly replayMutations?: readonly { kind?: string; tokenData?: { id?: string } }[];
  },
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
    battlefieldIdsBefore?: ReadonlySet<string>;
  },
): void {
  if ((ctx as any).isReplaying) return;
  const delayedSteps = (result.appliedSteps || []).filter(isOracleIrReflexiveWhenYouDoStep);
  if (delayedSteps.length === 0) return;
  if (!(result.appliedSteps || []).some((step) => step.kind === 'create_token')) return;

  const createdTokenIds = collectCreatedTokenIdsFromOracleIR(
    state,
    result,
    params.battlefieldIdsBefore || new Set(),
  );
  if (createdTokenIds.length === 0) return;

  const controller = String(params.controller || '').trim();
  const sourceName = String(params.sourceName || params.triggerItem?.sourceName || 'Delayed trigger').trim() || 'Delayed trigger';
  const sourceId = String(params.sourceId || params.triggerItem?.source || params.triggerItem?.permanentId || '').trim();
  if (!controller) return;

  const sourcePermanentSnapshot = buildTriggerSourcePermanentSnapshot(
    getTriggerSourcePermanent(state, params.triggerItem || { source: sourceId, permanentId: sourceId }),
  );

  for (const step of delayedSteps) {
    const followup = stripReflexiveWhenYouDoPrefix(String(step.effect || step.raw || '').trim());
    if (!followup) continue;
    const targetMetadata = inferTriggeredAbilityTargetMetadata(followup);
    const triggerId = uid('trigger');
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller,
      source: sourceId || null,
      ...(sourceId ? { permanentId: sourceId } : {}),
      sourceName,
      description: followup,
      effect: followup,
      triggerType: 'reflexive_when_you_do',
      mandatory: !/\byou may\b/i.test(followup),
      ...targetMetadata,
      chosenObjectIds: [...createdTokenIds],
      sourcePermanentSnapshot,
      effectData: {
        createdTokenIds: [...createdTokenIds],
        originalEffect: String(step.raw || step.effect || '').trim() || followup,
      },
      card: sourcePermanentSnapshot?.card || params.triggerItem?.card,
    } as any;

    state.stack = Array.isArray(state.stack) ? state.stack : [];
    state.stack.push(stackItem);

    const gameId = String((ctx as any).gameId || '').trim();
    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? state.seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: sourceId || null,
          ...(sourceId ? { permanentId: sourceId } : {}),
          sourceName,
          controllerId: controller,
          description: followup,
          effect: followup,
          triggerType: 'reflexive_when_you_do',
          mandatory: stackItem.mandatory,
          ...targetMetadata,
          sourcePermanentSnapshot,
          card: stackItem.card,
          effectData: stackItem.effectData,
          chosenObjectIds: [...createdTokenIds],
        });
      } catch (err) {
        debugWarn(1, `[oracle-ir] appendEvent(pushTriggeredAbility reflexive when-you-do) failed for ${sourceName}:`, err);
      }
    }
    debug(2, `[oracle-ir] Queued reflexive when-you-do follow-up for ${sourceName}`);
  }
}
