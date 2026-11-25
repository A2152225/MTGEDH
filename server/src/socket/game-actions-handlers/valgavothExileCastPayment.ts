// server/src/socket/game-actions-handlers/valgavothExileCastPayment.ts
// Queue the Valgavoth "pay life equal to mana value rather than pay its mana
// cost" alternate when a spell is being cast from exile under that permission.
// Payment goes through queuePayLifeAdditionalCostPrompt / payLifeAmount with
// forSpellOrNonManaAbility (Sylex blocks). Public: shouldUseValgavothExileLifeCost,
// tryPromptValgavothExileLifeCost.

import { playersCannotPayLifeToCastOrActivateNonMana } from "../../state/modules/karnsSylexPayLifeRestriction.js";
import { reportHookFailure } from '../../../../shared/src/hookFailureReporter.js';
import {
  getValgavothExileCastLifeCost,
  VALGAVOTH_EXILE_LIFE_COST_ID,
} from "../../state/modules/valgavothExilePlay.js";
import { mayPlayCardsExiledWithSourceThisTurn } from "../../state/modules/staticEffectSpec-handlers/batch95LongTailStatics.js";
import { getPlayableFromExileDurablePermissionForCard } from "../../state/modules/playable-from-exile.js";
import { emitToPlayer } from "../util.js";
import {
  paymentAlreadyResolvedPayLifeCost,
  queuePayLifeAdditionalCostPrompt,
} from "./gameActionsPayLifeAdditionalCostPrompt.js";

export { VALGAVOTH_EXILE_LIFE_COST_ID };

function hasIndependentPlayFromExilePermission(state: any, playerId: string, card: any): boolean {
  if (!card) return false;
  if (card.canBePlayedBy || card.playableUntilTurn != null || card.isWarped === true || card.exiledBecauseWarped === true) {
    return true;
  }
  try {
    if (mayPlayCardsExiledWithSourceThisTurn(state, playerId, card)) return true;
  } catch (err) { reportHookFailure('hook.optional.mayPlayCardsExiledWithSourceThisTurn', err, { source: 'valgavothExileCastPayment' }); /* hook optional */ }
  try {
    if (getPlayableFromExileDurablePermissionForCard(state, playerId, card, 'cast')) return true;
  } catch (err) { reportHookFailure('hook.optional.getPlayableFromExileDurablePermissionForCard', err, { source: 'valgavothExileCastPayment' }); /* hook optional */ }
  return false;
}

export function shouldUseValgavothExileLifeCost(
  state: any,
  playerId: string,
  card: any,
  alternateCostId?: string,
): number | null {
  const chosen = String(alternateCostId || card?.forcedAlternateCostId || '').trim() === VALGAVOTH_EXILE_LIFE_COST_ID;
  const life = getValgavothExileCastLifeCost(state, playerId, card);
  if (life == null) return null;
  if (chosen) return life;
  if (hasIndependentPlayFromExilePermission(state, playerId, card)) return null;
  return life;
}

function stampValgavothLifeAlternate(card: any): void {
  if (!card || typeof card !== 'object') return;
  try {
    card.forcedAlternateCostId = VALGAVOTH_EXILE_LIFE_COST_ID;
    card.castWithoutPayingManaCost = true;
  } catch { /* frozen ref */ }
}

export function tryPromptValgavothExileLifeCost(args: {
  io: any;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  payment?: unknown;
  targets?: unknown;
  xValue?: unknown;
  alternateCostId?: string;
  convokeTappedCreatures?: unknown;
}): 'queued' | 'blocked' | 'continue' {
  const life = shouldUseValgavothExileLifeCost(
    args.game?.state,
    args.playerId,
    args.cardInHand,
    args.alternateCostId,
  );
  if (life == null) return 'continue';

  stampValgavothLifeAlternate(args.cardInHand);

  if (paymentAlreadyResolvedPayLifeCost(args.payment)
    || args.cardInHand?.payLifeAdditionalCostResolved === true
    || (args.targets as any)?.payLifeAdditionalCostResolved === true
    || (args.targets as any)?.additionalCostMethod === 'pay_life') {
    return 'continue';
  }

  if (playersCannotPayLifeToCastOrActivateNonMana(args.game?.state, args.playerId)) {
    emitToPlayer(args.io, args.playerId as any, 'error', {
      code: 'CANNOT_PAY_COST',
      message: `Cannot pay life to cast ${args.cardInHand?.name || 'this spell'} with Valgavoth.`,
    });
    return 'blocked';
  }

  const currentLife = Number(args.game?.state?.life?.[args.playerId]
    ?? args.game?.state?.players?.find((entry: any) => String(entry?.id) === String(args.playerId))?.life
    ?? 40);
  if (currentLife < life) {
    emitToPlayer(args.io, args.playerId as any, 'error', {
      code: 'CANNOT_PAY_COST',
      message: `Cannot cast ${args.cardInHand?.name || 'this spell'}: you need to pay ${life} life but only have ${currentLife} life.`,
    });
    return 'blocked';
  }

  const queued = queuePayLifeAdditionalCostPrompt({
    game: args.game,
    gameId: args.gameId,
    playerId: args.playerId,
    cardId: args.cardId,
    cardInHand: args.cardInHand,
    amount: life,
    payment: args.payment,
    targets: args.targets,
    xValue: args.xValue,
    alternateCostId: VALGAVOTH_EXILE_LIFE_COST_ID,
    convokeTappedCreatures: args.convokeTappedCreatures,
  });
  return queued ? 'queued' : 'continue';
}
