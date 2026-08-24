import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { broadcastGame, canPayManaCostStringWithAvailableSources, payManaCostWithAvailableSources } from '../../socket/util.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';
import { getSavedTriggerShortcutPreference } from '../../socket/trigger-shortcuts.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { createToken } from './counters_tokens.js';
import { buildOpponentMayPayRecordedOutcome } from './opponent-may-pay-utils.js';
import { applyTriggeredReanimationEntryRiders } from './triggerReanimationRiders.js';
import { applyBattlefieldReturnCharacteristicMetadata } from './triggerDelayedEffectUtils.js';
import { markEchoPaid, sacrificePermanent } from './upkeep-triggers.js';
import type { ReflexiveTriggerEffectRunner } from './triggerReflexiveWhenYouDoQueueUtils.js';
import { tryDeferTriggeredAbilityTargetSelection } from './stackResolveTriggeredAbilityTargetPromptUtils.js';
import { inferTriggeredAbilityTargetMetadata } from './inferTriggeredAbilityTargetMetadata.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';

const OPPONENT_MAY_PAY_SPELL_CAST_TRIGGER_TYPES = new Set([
  'rhystic_study',
  'mystic_remora',
  'esper_sentinel',
  'smothering_tithe',
  // Generic cast detections that still carry paymentCost (after dedup, or when known
  // row was missed) must use opponent-may-pay — not a second controller "you may" wrap.
  'opponent_casts_any',
  'opponent_casts_noncreature',
  'opponent_casts_first_noncreature',
  'any_player_casts_any',
  'any_player_casts_noncreature',
]);

function isOpponentMayPaySpellCastTrigger(item: any): boolean {
  const triggerType = String(item?.triggerType || '').trim();
  if (!OPPONENT_MAY_PAY_SPELL_CAST_TRIGGER_TYPES.has(triggerType)) {
    return false;
  }
  // Named types are always payment prompts; generics need an explicit tax.
  if (
    triggerType === 'rhystic_study'
    || triggerType === 'mystic_remora'
    || triggerType === 'esper_sentinel'
    || triggerType === 'smothering_tithe'
  ) {
    return true;
  }
  return Boolean(String(item?.effectData?.paymentCost || '').trim());
}

const OPTIONAL_TRIGGER_MANA_PAYMENT_PATTERN = /^(?:when you cast this spell,?\s*)?you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*(?:if|when) you do,?\s*([\s\S]+)$/i;
const ECHO_TRIGGER_MANA_PAYMENT_PATTERN = /^pay (\{[^}]+\}(?:\{[^}]+\})*) or sacrifice(?:\b|$)/i;

function resolveOpponentMayPayDeclineEffectFromStackItem(item: any): string {
  const effectData = item?.effectData;
  const benefitIfNotPaid = String(effectData?.benefitIfNotPaid || '').trim();
  if (benefitIfNotPaid) {
    return benefitIfNotPaid;
  }

  const sourceName = String(item?.sourceName || '').trim().toLowerCase();
  if (
    sourceName.includes('rhystic study') ||
    sourceName.includes('mystic remora') ||
    sourceName.includes('esper sentinel')
  ) {
    return 'Draw a card';
  }

  return '';
}

function applyLiveOpponentMayPayOutcome(
  ctx: GameContext,
  params: {
    sourceName: string;
    sourceController: PlayerID;
    decidingPlayer: PlayerID;
    manaCost: string;
    declineEffect: string;
    willPay: boolean;
  }
): void {
  const { state } = ctx;
  const { sourceName, sourceController, decidingPlayer, manaCost, declineEffect, willPay } = params;

  if (willPay) {
    payManaCostWithAvailableSources(state as any, decidingPlayer, manaCost);
    return;
  }

  const recordedOutcome = buildOpponentMayPayRecordedOutcome(sourceName, declineEffect);
  let appliedDeclineOutcome = false;

  if (Number(recordedOutcome.declineDrawCount || 0) > 0) {
    drawCardsFromZone(ctx as any, sourceController, Number(recordedOutcome.declineDrawCount || 0));
    appliedDeclineOutcome = true;
  }

  if (Number(recordedOutcome.declineTreasureCount || 0) > 0) {
    createToken(
      ctx as any,
      sourceController,
      'Treasure',
      Number(recordedOutcome.declineTreasureCount || 0),
      undefined,
      undefined,
      {
        colors: [],
        typeLine: 'Token Artifact — Treasure',
        abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
        isArtifact: true,
      }
    );
    appliedDeclineOutcome = true;
  }

  if (appliedDeclineOutcome) {
    return;
  }
}

function maybeQueueOpponentMayPaySpellCastTrigger(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string
): boolean {
  if (!isOpponentMayPaySpellCastTrigger(item)) {
    return false;
  }

  const effectData = item?.effectData || {};
  const decidingPlayer = String(effectData?.casterId || item?.triggeringPlayer || item?.targetPlayer || '').trim() as PlayerID;
  const manaCost = String(effectData?.paymentCost || '').trim();
  const declineEffect = resolveOpponentMayPayDeclineEffectFromStackItem(item);
  const triggerText = String(item?.description || '').trim();
  const recordedDeclineOutcome = buildOpponentMayPayRecordedOutcome(sourceName, declineEffect || triggerText);
  const gameId = String((ctx as any).gameId || '').trim();

  if (!decidingPlayer || !manaCost || !gameId || gameId === 'unknown') {
    return false;
  }

  if ((ctx as any).isReplaying) {
    return true;
  }

  const io = (ctx as any).io;
  const promptId = `opponent_pay_${String(item?.id || sourceId || sourceName || 'trigger')}`;
  const savedPreference = getSavedTriggerShortcutPreference((ctx as any).state, decidingPlayer, sourceName);

  const persistOutcome = (willPay: boolean, auto = false) => {
    try {
      appendEvent(gameId, Number((ctx as any).seq?.value ?? 0), 'opponentMayPayResolve', {
        playerId: decidingPlayer,
        decidingPlayer,
        promptId,
        willPay,
        ...(auto ? { auto: true } : {}),
        sourceName,
        sourceController: triggerController,
        manaCost,
        declineEffect,
        triggerText,
        ...recordedDeclineOutcome,
      });
    } catch (err) {
      debugWarn(1, '[resolveTopOfStack] Failed to persist opponentMayPayResolve event:', err);
    }
  };

  const finalizeOutcome = (willPay: boolean, auto = false) => {
    applyLiveOpponentMayPayOutcome(ctx, {
      sourceName,
      sourceController: triggerController,
      decidingPlayer,
      manaCost,
      declineEffect,
      willPay,
    });
    persistOutcome(willPay, auto);
    if (io) {
      try {
        const decidingName = String(
          (((ctx as any).state?.players || []).find((p: any) => String(p?.id || '') === String(decidingPlayer))?.name)
          || decidingPlayer,
        );
        const controllerName = String(
          (((ctx as any).state?.players || []).find((p: any) => String(p?.id || '') === String(triggerController))?.name)
          || triggerController,
        );
        io.to(gameId).emit('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: willPay
            ? `${decidingName} pays ${manaCost} for ${sourceName}.`
            : `${decidingName} declines to pay ${manaCost} for ${sourceName}; ${controllerName} ${declineEffect || 'gets the effect'}.`,
          ts: Date.now(),
        });
      } catch {
        // best-effort chat
      }
      broadcastGame(io as any, ctx as any, gameId);
    }
  };

  if (savedPreference === 'always_pay' || savedPreference === 'never_pay') {
    let willPay = savedPreference === 'always_pay';
    if (willPay) {
      try {
        willPay = canPayManaCostStringWithAvailableSources(
          (ctx as any).state as any,
          decidingPlayer,
          manaCost,
        );
      } catch {
        willPay = false;
      }
    }

    finalizeOutcome(willPay, true);
    return true;
  }

  queueOptionalPaymentStep(gameId, {
    playerId: decidingPlayer,
    sourceName,
    sourceId: String(item?.source || sourceId || '').trim() || undefined,
    description: triggerText || `${sourceName}: ${String(decidingPlayer)} may pay ${manaCost}.`,
    mandatory: true,
    payChoiceId: 'pay',
    payLabel: `Pay ${manaCost}`,
    payDescription: `Pay ${manaCost}`,
    declineChoiceId: 'decline',
    declineLabel: 'Decline',
    declineDescription: declineEffect || 'Decline to pay',
    validationKind: 'mana',
    manaCost,
    stepData: {
      opponentMayPayChoice: true,
      promptId,
      sourceName,
      sourceController: triggerController,
      decidingPlayer,
      manaCost,
      declineEffect,
      triggerText,
      ...recordedDeclineOutcome,
      availableMana: ((ctx as any).state?.manaPool || {})[decidingPlayer] || {},
    },
    onPay: async () => {
      finalizeOutcome(true);
    },
    onDecline: async () => {
      finalizeOutcome(false);
    },
  });

  return true;
}


function maybeQueueControllerMayPayTriggeredAbility(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
  executeTriggerEffect: ReflexiveTriggerEffectRunner,
): boolean {
  const match = String(description || '').trim().match(OPTIONAL_TRIGGER_MANA_PAYMENT_PATTERN);
  if (!match) {
    return false;
  }

  // IR Effect Program already owns "you may pay {C}. If you do, …" (Agrus multi-copy).
  // Do not also queue a legacy mana-payment OPTION_CHOICE.
  if (isTriggerEffectOwnedByOracleIrPrimary(String(description || '').trim(), sourceName)) {
    return false;
  }

  const manaCost = String(match[1] || '').trim();
  const paidEffect = String(match[2] || '').trim();
  const gameId = String((ctx as any).gameId || '').trim();
  if (!manaCost || !paidEffect) {
    return false;
  }

  const hasBoundGraveyardReturn =
    String((item as any)?.boundGraveyardCardId || '').trim().length > 0 &&
    String((item as any)?.targetDestination || '').trim().toLowerCase() === 'battlefield' &&
    (!String((item as any)?.targetZone || '').trim() || String((item as any)?.targetZone || '').trim().toLowerCase() === 'graveyard') &&
    /\breturn\b[\s\S]*\b(?:that card|it)\b[\s\S]*\bto the battlefield\b/i.test(paidEffect);
  const hasRandomCreatureGraveyardReturn =
    /\breturn\s+a\s+creature\s+card\s+at\s+random\s+from\s+your\s+graveyard\s+to\s+the\s+battlefield\b/i.test(paidEffect);
  const hasReturnTargetPermanentToHand =
    /\breturn\s+target\s+permanent\s+to\s+its\s+owner'?s?\s+hand\b/i.test(paidEffect);
  // Generic optional mana payment: any "you may pay {cost}. If/When you do, <effect>".
  // Specialized GY / return-to-hand helpers below remain for richer metadata.

  if ((ctx as any).isReplaying) {
    return true;
  }

  if (!gameId || gameId === 'unknown') {
    return false;
  }

  queueOptionalPaymentStep(gameId, {
    playerId: triggerController,
    sourceName,
    sourceId: String((item as any).source || sourceId || '').trim() || undefined,
    sourceImage: (item as any).sourceImage,
    description: `${sourceName}: ${String(description || '').trim()}`,
    mandatory: false,
    minSelections: 0,
    maxSelections: 1,
    priority: -1,
    payChoiceId: 'pay_mana',
    payLabel: `Pay ${manaCost}`,
    payDescription: `If you do: ${paidEffect}`,
    declineChoiceId: 'decline',
    declineLabel: 'Decline',
    declineDescription: 'Do not pay the optional cost.',
    validationKind: 'mana',
    manaCost,
    stepData: {
      triggeredAbilityManaPaymentChoice: true,
      triggerStackItemId: String((item as any).id || '').trim() || undefined,
      permanentId: String((item as any).source || sourceId || '').trim() || undefined,
      cardName: sourceName,
      manaCost,
      effect: paidEffect,
      triggerDescription: String(description || '').trim(),
    },
    onPay: async () => {
      payManaCostWithAvailableSources((ctx as any).state as any, triggerController, manaCost);
      const battlefieldBeforeIds = new Set(
        Array.isArray(((ctx as any).state as any)?.battlefield)
          ? ((((ctx as any).state as any).battlefield as any[]).map((permanent: any) => String(permanent?.id || '')))
          : []
      );
      const paidTargetMetadata = inferTriggeredAbilityTargetMetadata(paidEffect, {
        gameState: (ctx as any).state,
        controllerId: String(triggerController),
        sourceName,
      });
      const resolvedTriggerItem = {
        ...(item as any),
        description: paidEffect,
        effect: paidEffect,
        optionalPaymentResolved: true,
      } as any;
      for (const [key, value] of Object.entries(paidTargetMetadata)) {
        if (value !== undefined) {
          resolvedTriggerItem[key] = value;
        }
      }

      if (hasRandomCreatureGraveyardReturn && !String(resolvedTriggerItem.boundGraveyardCardId || '').trim()) {
        const zones = (((ctx as any).state as any)?.zones || {}) as Record<string, any>;
        const playerZones = (zones[String(triggerController)] || {}) as any;
        const graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
        const creatureCards = graveyard.filter((card: any) => /\bcreature\b/i.test(String(card?.type_line || '')));
        if (creatureCards.length > 0) {
          const rng = typeof (ctx as any).rng === 'function' ? () => Number((ctx as any).rng()) || 0 : () => Math.random();
          const choiceIndex = Math.floor(Math.max(0, Math.min(0.999999, rng())) * creatureCards.length);
          const chosenCard = creatureCards[Math.min(choiceIndex, creatureCards.length - 1)];
          if (chosenCard) {
            resolvedTriggerItem.boundGraveyardCardId = String(chosenCard.id || '').trim() || undefined;
            resolvedTriggerItem.boundGraveyardOwnerId = String(triggerController || '').trim() || undefined;
            resolvedTriggerItem.targetZone = 'graveyard';
            resolvedTriggerItem.targetDestination = 'battlefield';
          }
        }
      }

      if (hasReturnTargetPermanentToHand) {
        resolvedTriggerItem.requiresTarget = true;
        resolvedTriggerItem.targetType = 'permanent';
        resolvedTriggerItem.minTargets = 1;
        resolvedTriggerItem.maxTargets = 1;
        resolvedTriggerItem.targetDescription = 'target permanent';
        resolvedTriggerItem.action = 'return_to_hand';
      }

      const deferredTargetSelection = tryDeferTriggeredAbilityTargetSelection(
        ctx,
        resolvedTriggerItem,
        (ctx as any).state,
        {
          triggerController,
          sourceName,
          sourceId: String((item as any).source || sourceId || '').trim(),
          description: paidEffect,
          triggerType: String((item as any).triggerType || 'tap'),
        },
      );
      if (deferredTargetSelection) {
        if (typeof (ctx as any).bumpSeq === 'function') {
          (ctx as any).bumpSeq();
        }
        const io = (ctx as any).io;
        if (io) {
          broadcastGame(io as any, ctx as any, gameId);
        }
        return;
      }

      executeTriggerEffect(ctx, triggerController, sourceName, paidEffect, {
        ...resolvedTriggerItem,
      });
      if (String(resolvedTriggerItem.targetDestination || '').trim().toLowerCase() === 'battlefield') {
        const battlefield = Array.isArray(((ctx as any).state as any)?.battlefield)
          ? ((((ctx as any).state as any).battlefield as any[]) as any[])
          : [];
        const returnedPermanent = battlefield.find((permanent: any) => (
          !battlefieldBeforeIds.has(String(permanent?.id || ''))
          && String(permanent?.card?.id || '').trim() === String(resolvedTriggerItem.boundGraveyardCardId || '').trim()
        ));
        if (returnedPermanent) {
          applyBattlefieldReturnCharacteristicMetadata(returnedPermanent, resolvedTriggerItem);
          applyTriggeredReanimationEntryRiders(
            ctx,
            returnedPermanent,
            sourceName,
            triggerController,
            String(description || paidEffect || ''),
            returnedPermanent?.card?.name || String(resolvedTriggerItem.boundGraveyardCardId || ''),
          );
        }
      }
      if (typeof (ctx as any).bumpSeq === 'function') {
        (ctx as any).bumpSeq();
      }
      const io = (ctx as any).io;
      if (io) {
        broadcastGame(io as any, ctx as any, gameId);
      }
    },
    onDecline: async () => {
      if (typeof (ctx as any).bumpSeq === 'function') {
        (ctx as any).bumpSeq();
      }
      const io = (ctx as any).io;
      if (io) {
        broadcastGame(io as any, ctx as any, gameId);
      }
    },
  });

  return true;
}

function maybeQueueEchoTriggeredAbility(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  description: string,
): boolean {
  const match = String(description || '').trim().match(ECHO_TRIGGER_MANA_PAYMENT_PATTERN);
  if (!match) {
    return false;
  }

  const manaCost = String(match[1] || '').trim();
  const gameId = String((ctx as any).gameId || '').trim();
  const permanentId = String((item as any).source || sourceId || '').trim();
  if (!manaCost || !permanentId) {
    return false;
  }

  if ((ctx as any).isReplaying) {
    return true;
  }

  if (!gameId || gameId === 'unknown') {
    return false;
  }

  queueOptionalPaymentStep(gameId, {
    playerId: triggerController,
    sourceName,
    sourceId: permanentId,
    sourceImage: (item as any).sourceImage,
    description: `${sourceName}: ${String(description || '').trim()}`,
    mandatory: true,
    payChoiceId: 'pay_echo',
    payLabel: `Pay ${manaCost}`,
    payDescription: `Pay ${manaCost} to keep ${sourceName}.`,
    declineChoiceId: 'decline',
    declineLabel: 'Sacrifice it',
    declineDescription: `Sacrifice ${sourceName}.`,
    validationKind: 'mana',
    manaCost,
    stepData: {
      echoChoice: true,
      permanentId,
      cardName: sourceName,
      manaCost,
      triggerDescription: String(description || '').trim(),
    },
    onPay: async () => {
      payManaCostWithAvailableSources((ctx as any).state as any, triggerController, manaCost);
      markEchoPaid(ctx, permanentId);

      const io = (ctx as any).io;
      if (io) {
        broadcastGame(io as any, ctx as any, gameId);
      }
    },
    onDecline: async () => {
      sacrificePermanent(ctx, permanentId, triggerController);

      const io = (ctx as any).io;
      if (io) {
        broadcastGame(io as any, ctx as any, gameId);
      }
    },
  });

  return true;
}

export function tryDeferOptionalTriggerPaymentPrompts(
  ctx: GameContext,
  item: any,
  triggerController: PlayerID,
  sourceName: string,
  sourceId: string,
  trimmedDescription: string,
  executeTriggerEffect: ReflexiveTriggerEffectRunner,
): boolean {
  if (maybeQueueEchoTriggeredAbility(ctx, item, triggerController, sourceName, sourceId, trimmedDescription)) {
    debug(2, `[resolveTopOfStack] Deferred echo payment trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueControllerMayPayTriggeredAbility(ctx, item, triggerController, sourceName, sourceId, trimmedDescription, executeTriggerEffect)) {
    debug(2, `[resolveTopOfStack] Deferred controller-pay trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  if (maybeQueueOpponentMayPaySpellCastTrigger(ctx, item, triggerController, sourceName, sourceId)) {
    debug(2, `[resolveTopOfStack] Deferred opponent-pay trigger for ${sourceName} (${triggerController})`);
    return true;
  }
  return false;
}
