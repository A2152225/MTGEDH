/**
 * Queue optional on-cast casualty / conspire prompts (printed or granted).
 * Public: tryQueueOnCastKeywordPrompts.
 */
import { getDeclarativeLeaveBattlefieldReplacementHint as getLeaveBattlefieldReplacementHint } from "../../state/modules/leaveBattlefieldReplacementHint.js";
import {
  buildCasualtyPaymentStep,
  buildConspirePaymentStep,
  creaturesSharingColorWithSpell,
  hasCasualtyX,
  hasConspire,
  isCasualtyLegalSacrifice,
  readCasualtyValue,
  stampOnCastKeywordFlags,
} from "../../state/modules/onCastKeywordPrompts.js";
import { ResolutionQueueManager } from "../../state/resolution/index.js";
import { getEffectivePower } from "../util.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export type QueueOnCastKeywordPromptsArgs = {
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardName: string;
  card: any;
  oracleText?: string;
  sourceId?: string;
  sourceImage?: string;
  skip?: boolean;
  effectId?: string;
  castSpellFromHandArgs?: Record<string, unknown>;
};

function alreadyResolved(card: any, keyPaid: string, keyResolved: string): boolean {
  return card?.[keyResolved] === true
    || card?.[keyPaid] === true
    || card?.[keyPaid] === false
    || card?.card?.[keyResolved] === true
    || card?.card?.[keyPaid] === true
    || card?.card?.[keyPaid] === false;
}

export function tryQueueOnCastKeywordPrompts(args: QueueOnCastKeywordPromptsArgs): boolean {
  if (args.skip) return false;
  const card = args.card || {};
  const playerId = String(args.playerId);
  const cardName = String(args.cardName || card.name || 'Spell');
  const sourceImage = args.sourceImage
    || card.image_uris?.small
    || card.image_uris?.normal
    || card.card?.image_uris?.small;
  const sourceId = String(args.sourceId || args.effectId || args.cardId);
  const battlefield: any[] = Array.isArray(args.game?.state?.battlefield) ? args.game.state.battlefield : [];
  const powerOf = (perm: any) => {
    try { return getEffectivePower(perm, args.game.state); } catch { return Number(perm?.power || perm?.card?.power || 0) || 0; }
  };

  const casualtyX = hasCasualtyX(card, args.oracleText);
  const casualtyN = casualtyX ? 1 : readCasualtyValue(card, args.oracleText);
  if ((casualtyX || casualtyN != null) && !alreadyResolved(card, 'casualtyPaid', 'casualtyResolved')) {
    const minPower = casualtyX ? 1 : Number(casualtyN);
    const targets = battlefield
      .filter((perm) => isCasualtyLegalSacrifice(perm, playerId, minPower, powerOf))
      .map((perm) => ({
        id: perm.id,
        name: perm.card?.name || 'Creature',
        imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
        typeLine: perm.card?.type_line,
        power: powerOf(perm),
        ...getLeaveBattlefieldReplacementHint(perm, 'graveyard', args.game.state),
      }));
    if (targets.length === 0) {
      stampOnCastKeywordFlags(card, { casualtyResolved: true, casualtyPaid: false, casualtyValue: casualtyX ? undefined : casualtyN, casualtyX });
    } else {
      const step = ResolutionQueueManager.addStep(args.gameId, buildCasualtyPaymentStep({
        playerId,
        cardId: args.cardId,
        cardName,
        sourceId,
        sourceImage,
        casualtyValue: casualtyX ? 1 : Number(casualtyN),
        casualtyX,
        availableTargets: targets,
        castSpellFromHandArgs: args.castSpellFromHandArgs,
      }) as any);
      persistQueuedSpellCastStepContinuation(args.gameId, args.game, {
        playerId,
        cardId: args.cardId,
        effectId: args.effectId,
        queuedResolutionStep: { ...(step as any) },
        pendingSpellCast: args.effectId
          ? { ...((args.game.state as any).pendingSpellCasts?.[args.effectId] || {}) }
          : undefined,
      });
      return true;
    }
  }

  if (hasConspire(card, args.oracleText) && !alreadyResolved(card, 'conspirePaid', 'conspireResolved')) {
    const creatures = creaturesSharingColorWithSpell(battlefield, playerId, card);
    if (creatures.length < 2) {
      stampOnCastKeywordFlags(card, { conspireResolved: true, conspirePaid: false });
    } else {
      const step = ResolutionQueueManager.addStep(args.gameId, buildConspirePaymentStep({
        playerId,
        cardId: args.cardId,
        cardName,
        sourceId,
        sourceImage,
        availableTargets: creatures.map((perm) => ({
          id: perm.id,
          name: perm.card?.name || 'Creature',
          imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
          typeLine: perm.card?.type_line,
          power: powerOf(perm),
        })),
        castSpellFromHandArgs: args.castSpellFromHandArgs,
      }) as any);
      persistQueuedSpellCastStepContinuation(args.gameId, args.game, {
        playerId,
        cardId: args.cardId,
        effectId: args.effectId,
        queuedResolutionStep: { ...(step as any) },
        pendingSpellCast: args.effectId
          ? { ...((args.game.state as any).pendingSpellCasts?.[args.effectId] || {}) }
          : undefined,
      });
      return true;
    }
  }

  return false;
}
