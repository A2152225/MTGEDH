/**
 * socket/game-actions-handlers/queueRequestCastPayXLifeAnnouncement.ts
 *
 * CR 601.2b: announce X (pay X life) before targets on the requestCastSpell path.
 * Fire Covenant and similar spells have no X in the mana cost, so X_VALUE_SELECTION
 * is not queued; this queues LIFE_PAYMENT first, then requestCast resumes with xValue.
 */

import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { PAY_X_LIFE_CARDS, getMaxPayableLife } from "../../state/utils.js";
import type { GameContext } from "../../state/context.js";
import { detectAdditionalCost } from "../land-helpers.js";
import { debug } from "../../utils/debug.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export function isPayXLifeCastCost(cardName: unknown, oracleText: unknown, typeLine?: unknown): boolean {
  const type = String(typeLine || '').toLowerCase();
  const isPermanent = /\b(creature|artifact|enchantment|planeswalker|land)\b/.test(type)
    && !/\b(instant|sorcery)\b/.test(type);
  const listed = PAY_X_LIFE_CARDS[String(cardName || '').trim().toLowerCase()];
  const detected = detectAdditionalCost(String(oracleText || ''))?.payLifeIsX === true;
  if (isPermanent && !detected) return false;
  return Boolean(listed || detected);
}

export function maybeQueueRequestCastPayXLifeAnnouncement(args: {
  readonly game: any;
  readonly gameId: string;
  readonly playerId: string;
  readonly cardId: string;
  readonly cardName: string;
  readonly cardInHand: any;
  readonly cardForCast?: any;
  readonly oracleText: unknown;
  readonly typeLine?: unknown;
  readonly chosenXValue?: number;
  readonly selectedFaceIndex?: number;
  readonly castSourceZone?: unknown;
  readonly options?: any;
  readonly isFreeCast?: boolean;
  readonly bypassExilePermissionCheck?: boolean;
  readonly ignoreTimingRestrictions?: boolean;
}): boolean {
  const { game, gameId, playerId, cardId, cardName, cardInHand } = args;
  if (!isPayXLifeCastCost(cardName, args.oracleText, args.typeLine || cardInHand?.type_line || args.cardForCast?.type_line)) {
    return false;
  }
  if (Number.isFinite(args.chosenXValue)) return false;
  if (typeof cardInHand?.lifePaymentAmount === 'number' || typeof args.cardForCast?.lifePaymentAmount === 'number') {
    return false;
  }

  const listed = PAY_X_LIFE_CARDS[String(cardName || '').trim().toLowerCase()];
  const startingLife = game.state?.startingLife || 40;
  const currentLife = game.state?.life?.[playerId] ?? startingLife;
  const maxPayable = getMaxPayableLife(currentLife, game as GameContext, playerId);
  const minPayment = Math.max(0, Math.floor(Number(listed?.minX ?? 0)));

  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((step: any) =>
      step?.type === ResolutionStepType.LIFE_PAYMENT
      && step?.requestCastPayXLife === true
      && String(step?.spellCardId || step?.cardId || '') === String(cardId),
    );
  if (!existing) {
    const card = args.cardForCast || cardInHand;
    const lifePaymentStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIFE_PAYMENT,
      playerId: playerId as any,
      sourceId: cardId,
      sourceName: cardName,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: listed?.effect || `Pay X life to cast ${cardName}.`,
      mandatory: true,
      cardId,
      cardName,
      currentLife,
      minPayment,
      maxPayment: maxPayable,
      requestCastPayXLife: true,
      spellCardId: String(cardId),
      spellFaceIndex: args.selectedFaceIndex,
      spellFromZone: args.castSourceZone,
      spellForcedAlternateCostId: args.options?.forcedAlternateCostId,
      spellCastWithoutPayingManaCost: args.isFreeCast === true,
      spellBypassExilePermissionCheck: args.bypassExilePermissionCheck === true,
      spellIgnoreTimingRestrictions: args.ignoreTimingRestrictions === true,
    } as any);

    persistQueuedSpellCastStepContinuation(gameId, game, {
      playerId,
      cardId,
      queuedResolutionStep: {
        ...(lifePaymentStep as any),
      },
    });
  }

  debug(2, `[requestCastSpell] Queued LIFE_PAYMENT (pay X life, ${minPayment}-${maxPayable}) for ${cardName}`);
  return true;
}
