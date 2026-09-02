/**
 * Origin sibling: triggerOracleIrPermanentEtbBridge.ts.
 * Cluster: as-enters replacements for permanents IR puts onto the battlefield
 *   (shock/check tap, pay-life, reveal, color/copy/type/player choice).
 * Public: queueBattlefieldEntryReplacementPromptsAfterOracleIR.
 *
 * createBattlefieldPermanentsFromCards never calls finalizePlayedLand /
 * putCardOntoBattlefield, so those prompts would otherwise be skipped.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { collectControllerLandStats } from '../../../../rules-engine/src/oracleIREtbTappedPattern.js';
import {
  detectSacrificeUnlessPayETB,
  evaluateConditionalLandETB,
  isShockLand,
} from '../../socket/land-helpers.js';
import { queueShockLandPaymentStep } from '../../socket/optional-payment-prompts.js';
import {
  checkColorChoiceForNewPermanents,
  checkCreatureTypeSelectionForNewPermanents,
  checkPlayerSelectionForNewPermanents,
} from '../../socket/game-actions-handlers/gameActionsPermanentEntryPrompts.js';
import { checkAsEntersCopyChoiceForNewPermanents } from './asEntersCopyChoice.js';
import { applyGraveyardTypeEntryCounterGrants } from './graveyardTypeEntryCounterBonus.js';
import {
  applyAsEntersAutomaticReplacementsForPermanent,
  tryApplyAsEntersAutomaticReplacementsForPermanent,
} from './oracleIrBattlefieldEntryAutomaticReplacements.js';
import { applyAsEntersAutomaticReplacementsAfterOracleIR } from './oracleIrAsEntersAutomaticReplacements.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrFeatureFlags.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { debug } from '../../utils/debug.js';

function controllerOf(permanent: any): string {
  return String(permanent?.controller || permanent?.controllerId || permanent?.owner || '').trim();
}

function playerHand(state: any, playerId: string): any[] {
  const fromZones = state?.zones?.[playerId]?.hand;
  if (Array.isArray(fromZones)) return fromZones;
  const player = (Array.isArray(state?.players) ? state.players : []).find(
    (entry: any) => String(entry?.id || '') === playerId,
  );
  return Array.isArray(player?.hand) ? player.hand : [];
}

function queueRevealLandChoice(
  gameId: string,
  permanent: any,
  cardName: string,
  imageUrl: string | undefined,
  controller: string,
  evaluation: { revealTypes?: string[]; canReveal?: boolean },
  hand: any[],
): void {
  if (!evaluation.canReveal) return;
  const revealTypes: string[] = Array.isArray(evaluation.revealTypes) ? evaluation.revealTypes : [];
  const existing = ResolutionQueueManager
    .getStepsForPlayer(gameId, controller as PlayerID)
    .find((step: any) => step?.revealLandChoice === true && String(step?.permanentId || '') === String(permanent.id));
  if (existing) return;

  const eligible = hand
    .filter((card: any) => {
      const typeLine = String(card?.type_line || '');
      if (!/\bland\b/i.test(typeLine)) return false;
      if (revealTypes.length === 0) return true;
      return revealTypes.some((type) => new RegExp(`\\b${String(type).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(typeLine));
    })
    .map((card: any) => ({
      id: String(card?.id || ''),
      label: String(card?.name || 'Card'),
      description: String(card?.type_line || ''),
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    }))
    .filter((option: any) => option.id);

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller as PlayerID,
    sourceName: cardName,
    sourceId: permanent.id,
    sourceImage: imageUrl,
    description: `You may reveal a ${revealTypes.join(' or ')} card from your hand. If you don't, ${cardName} enters tapped.`,
    mandatory: true,
    options: [
      ...eligible,
      { id: 'decline_reveal', label: "Don't reveal (enter tapped)" },
    ],
    minSelections: 1,
    maxSelections: 1,
    revealLandChoice: true,
    permanentId: permanent.id,
    cardName,
    revealTypes,
  } as any);
}

export function queueBattlefieldEntryReplacementPromptsAfterOracleIR(
  ctx: GameContext,
  state: any,
  battlefieldIdsBefore: ReadonlySet<string>,
): void {
  if ((ctx as any).isReplaying) return;
  const gameId = String(ctx.gameId || '').trim();
  if (!gameId) return;

  const io = (ctx as any).io;
  const players = Array.isArray(state?.players) ? state.players : [];

  applyAsEntersAutomaticReplacementsAfterOracleIR(ctx, state, battlefieldIdsBefore);

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const permanent of battlefield) {
    const id = String(permanent?.id || '').trim();
    if (!id || battlefieldIdsBefore.has(id)) continue;
    if (permanent?.isToken === true) continue;

    const card = permanent.card || {};
    const cardName = String(card.name || 'Permanent');
    const oracleText = String(card.oracle_text || card.oracleText || '');
    const controller = controllerOf(permanent);
    if (!controller) continue;
    applyGraveyardTypeEntryCounterGrants(state, permanent, controller);
    try {
      tryApplyAsEntersAutomaticReplacementsForPermanent(
        state,
        permanent,
        controller,
        applyAsEntersAutomaticReplacementsForPermanent,
      );
    } catch (error) {
      // Unbound / missing helper must not kill the process (tsx transpile-only).
      debug(2, `[oracleIR] as-enters automatic replacements skipped: ${error}`);
    }
    const imageUrl = card.image_uris?.small || card.image_uris?.normal;
    const typeLine = String(card.type_line || '').toLowerCase();
    const isLand = typeLine.includes('land');

    if (isLand && isShockLand(cardName, oracleText)) {
      queueShockLandPaymentStep(io, ctx as any, gameId, controller, permanent, cardName, imageUrl);
    }

    if (isLand) {
      const others = battlefield.filter((entry: any) => String(entry?.id || '') !== id);
      const opponentCount = players.filter((player: any) => String(player?.id || '') !== controller).length;
      const stats = collectControllerLandStats(others, controller, opponentCount);
      const hand = playerHand(state, controller);
      const evaluation = evaluateConditionalLandETB(
        oracleText,
        stats.landCount,
        stats.landTypes,
        hand,
        stats.basicLandCount,
        stats.opponentCount,
        others.filter((entry: any) => controllerOf(entry) === controller),
        stats.opponentLandCount,
      );
      if (evaluation.shouldEnterTapped && !permanent.tapped) {
        permanent.tapped = true;
        debug(2, `[oracleIR] ${cardName} enters tapped (${evaluation.reason})`);
      }
      if (evaluation.requiresRevealPrompt && evaluation.canReveal) {
        queueRevealLandChoice(gameId, permanent, cardName, imageUrl, controller, evaluation, hand);
      }
    }

    const sacrificeCost = !isOracleIrTriggerPrimaryEnabled()
      ? detectSacrificeUnlessPayETB(cardName, oracleText)
      : null;
    if (sacrificeCost) {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, controller as PlayerID)
        .find((step: any) => step?.sacrificeUnlessPayChoice === true && String(step?.permanentId || '') === id);
      if (!existing) {
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_PAYMENT_CHOICE,
          playerId: controller as PlayerID,
          sourceId: id,
          sourceName: cardName,
          sourceImage: imageUrl,
          description: `${cardName}: Pay ${sacrificeCost} to keep it. Cancel to sacrifice it.`,
          mandatory: false,
          activationPaymentChoice: true,
          confirmLabel: `Pay ${sacrificeCost}`,
          permanentId: id,
          cardName,
          manaCost: sacrificeCost,
          sacrificeUnlessPayChoice: true,
        } as any);
      }
    }
  }

  checkAsEntersCopyChoiceForNewPermanents(ctx as any, gameId);
  checkColorChoiceForNewPermanents(io, ctx as any, gameId);
  checkCreatureTypeSelectionForNewPermanents(io, ctx as any, gameId);
  if (io) {
    checkPlayerSelectionForNewPermanents(io, ctx as any, gameId);
  }
}
