import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';
import { broadcastGame, consumeManaFromPool, getOrInitManaPool, parseManaCost } from '../../socket/util.js';
import { queueOptionalPaymentStep } from '../../socket/optional-payment-prompts.js';
import { getSavedTriggerShortcutPreference } from '../../socket/trigger-shortcuts.js';
import { drawCards as drawCardsFromZone } from './zones.js';
import { createToken } from './counters_tokens.js';
import { buildOpponentMayPayRecordedOutcome } from './opponent-may-pay-utils.js';
import { applyTriggeredReanimationEntryRiders } from './triggerReanimationRiders.js';
import { markEchoPaid, sacrificePermanent } from './upkeep-triggers.js';
import type { ReflexiveTriggerEffectRunner } from './triggerReflexiveWhenYouDoQueueUtils.js';
import { tryDeferTriggeredAbilityTargetSelection } from './stackResolveTriggeredAbilityTargetPromptUtils.js';

const OPPONENT_MAY_PAY_SPELL_CAST_TRIGGER_TYPES = new Set([
  'rhystic_study',
  'mystic_remora',
  'esper_sentinel',
  'smothering_tithe',
]);

const OPTIONAL_TRIGGER_MANA_PAYMENT_PATTERN = /^you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*if you do,?\s*([\s\S]+)$/i;
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
    const parsedCost = parseManaCost(manaCost);
    const pool = getOrInitManaPool(state as any, decidingPlayer);
    consumeManaFromPool(pool as any, parsedCost.colors, parsedCost.generic, `[opponentMayPay:${sourceName}]`);
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
        typeLine: 'Token Artifact â€” Treasure',
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
  const triggerType = String(item?.triggerType || '').trim();
  if (!OPPONENT_MAY_PAY_SPELL_CAST_TRIGGER_TYPES.has(triggerType)) {
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
      broadcastGame(io as any, ctx as any, gameId);
    }
  };

  if (savedPreference === 'always_pay' || savedPreference === 'never_pay') {
    let willPay = savedPreference === 'always_pay';
    if (willPay) {
      try {
        const parsedCost = parseManaCost(manaCost);
        const pool = getOrInitManaPool((ctx as any).state as any, decidingPlayer);
        const colorEntries = Object.entries(parsedCost.colors || {});
        const hasColoredMana = colorEntries.every(([color, amount]) => {
          const colorKey = ({ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' } as any)[String(color).toUpperCase()];
          return Number((pool as any)?.[colorKey] || 0) >= Number(amount || 0);
        });
        const totalMana = ['white', 'blue', 'black', 'red', 'green', 'colorless']
          .reduce((sum, key) => sum + Number((pool as any)?.[key] || 0), 0);
        const totalCost = Number(parsedCost.generic || 0) + colorEntries.reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
        if (!hasColoredMana || totalMana < totalCost) {
          willPay = false;
        }
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
  if (!(hasBoundGraveyardReturn || hasRandomCreatureGraveyardReturn || hasReturnTargetPermanentToHand)) {
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
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool((ctx as any).state as any, triggerController);
      consumeManaFromPool(pool as any, parsedCost.colors, parsedCost.generic, `[triggerManaPayment:${sourceName}]`);
      const battlefieldBeforeIds = new Set(
        Array.isArray(((ctx as any).state as any)?.battlefield)
          ? ((((ctx as any).state as any).battlefield as any[]).map((permanent: any) => String(permanent?.id || '')))
          : []
      );
      const resolvedTriggerItem = {
        ...(item as any),
        description: paidEffect,
        effect: paidEffect,
        optionalPaymentResolved: true,
      } as any;

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
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool((ctx as any).state as any, triggerController);
      consumeManaFromPool(pool as any, parsedCost.colors, parsedCost.generic, `[echo:${sourceName}]`);
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
