/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand additional-cost prompts (Bargain,
 * collect evidence, Teamwork, Behold, discard, sacrifice, pay life, Squad)
 * from CR 601.2b, before cast-time targeting.
 *
 * Public entry symbols: tryPromptCastSpellAdditionalCostsFromHand.
 */
import type { Server, Socket } from "socket.io";
import type { PaymentItem } from "../../../../shared/src/index.js";
import { getDeclarativeLeaveBattlefieldReplacementHint as getLeaveBattlefieldReplacementHint } from "../../state/modules/leaveBattlefieldReplacementHint.js";
import { buildBeholdSelectionOptions } from "../../state/modules/chosen-creature-type.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import { getEffectivePower, getPlayerName } from "../util";
import { getEffectiveAdditionalCost } from "./gameActionsAdditionalCastCosts.js";
import { persistQueuedSpellCastStepContinuation } from "./gameActionsSpellCopyHeroicTriggers.js";

export type CastSpellAdditionalCostsFromHandArgs = {
  io: Server;
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  oracleText: string;
  payment: PaymentItem[] | undefined;
  targets: any;
  xValue: number | undefined;
  alternateCostId: string | undefined;
  convokeTappedCreatures: string[] | undefined;
  shouldSkipAllPrompts: boolean;
  zones: any;
};

export type CastSpellAdditionalCostsFromHandContinue = {
  kind: "continue";
  targets: any;
  additionalCost: ReturnType<typeof getEffectiveAdditionalCost>;
  additionalCostPaid: boolean;
  bargainResolved: boolean;
  wasBargained: boolean | null;
  teamworkResolved: boolean;
  teamworkWasPaid: boolean | null;
  evidenceCollected: boolean;
};

export function tryPromptCastSpellAdditionalCostsFromHand(
  args: CastSpellAdditionalCostsFromHandArgs,
): CastSpellAdditionalCostsFromHandContinue | void {
  const {
    io,
    socket,
    game,
    gameId,
    playerId,
    cardId,
    cardInHand,
    oracleText,
    payment,
    xValue,
    alternateCostId,
    convokeTappedCreatures,
    shouldSkipAllPrompts,
    zones,
  } = args;
  let { targets } = args;

      // Check for additional costs (discard a card, sacrifice, etc.)
      // This handles cards like Seize the Spoils, Faithless Looting, etc.
      const additionalCost = getEffectiveAdditionalCost(cardInHand, oracleText);
      const additionalCostPaid = (payment as any[])?.some((p: any) => p && p.additionalCostPaid === true) ||
                                  (targets as any)?.additionalCostPaid === true;

      // Bargain (WOE): optional additional cost while casting.
      // We treat this as a replay-stable, explicit player choice: either they sacrificed (wasBargained=true)
      // or they declined / had no legal targets (wasBargained=false). If untracked, keep it null.
      const hasBargain = /\bbargain\b/i.test(String(oracleText || ''));
      const bargainMarker = (payment as any[])?.find((p: any) =>
        p &&
        (p.bargainResolved === true ||
          p.wasBargained === true ||
          p.wasBargained === false ||
          p.bargained === true ||
          p.bargained === false)
      );
      let bargainResolved =
        bargainMarker?.bargainResolved === true ||
        (targets as any)?.bargainResolved === true ||
        (cardInHand as any)?.bargainResolved === true;
      const rawWasBargained =
        bargainMarker?.wasBargained ??
        bargainMarker?.bargained ??
        (targets as any)?.wasBargained ??
        (targets as any)?.bargained ??
        (cardInHand as any)?.wasBargained ??
        (cardInHand as any)?.bargained;
      let wasBargained = typeof rawWasBargained === 'boolean' ? rawWasBargained : null;

      const teamworkMarker = (payment as any[])?.find((p: any) => p && p.teamworkResolved === true);
      let teamworkResolved =
        teamworkMarker?.teamworkResolved === true ||
        (targets as any)?.teamworkResolved === true ||
        (cardInHand as any)?.teamworkResolved === true;
      const rawTeamworkWasPaid =
        teamworkMarker?.teamworkWasPaid ??
        (targets as any)?.teamworkWasPaid ??
        (cardInHand as any)?.teamworkWasPaid;
      let teamworkWasPaid = typeof rawTeamworkWasPaid === 'boolean' ? rawTeamworkWasPaid : null;

      // Collect-evidence additional cost markers (optional costs must avoid re-prompt loops).
      const collectEvidenceMarker = (payment as any[])?.find((p: any) =>
        p && (p.collectEvidenceResolved === true || p.evidenceCollected === true || p.evidenceWasCollected === true || p.collectedEvidence === true)
      );
      const collectEvidenceResolved =
        collectEvidenceMarker?.collectEvidenceResolved === true ||
        (targets as any)?.collectEvidenceResolved === true ||
        (cardInHand as any)?.collectEvidenceResolved === true;
      const evidenceCollected =
        collectEvidenceMarker?.evidenceCollected === true ||
        collectEvidenceMarker?.evidenceWasCollected === true ||
        collectEvidenceMarker?.collectedEvidence === true ||
        (targets as any)?.evidenceCollected === true ||
        (targets as any)?.evidenceWasCollected === true ||
        (targets as any)?.collectedEvidence === true ||
        (cardInHand as any)?.evidenceCollected === true ||
        (cardInHand as any)?.evidenceWasCollected === true ||
        (cardInHand as any)?.collectedEvidence === true;

      if (!shouldSkipAllPrompts && hasBargain && !bargainResolved) {
        const battlefield = game.state?.battlefield || [];
        const validBargainTargets = battlefield.filter((p: any) => {
          if (!p) return false;
          if (p.controller !== playerId) return false;
          if (p.isToken === true) return true;
          const tl = String(p.card?.type_line || '').toLowerCase();
          return tl.includes('artifact') || tl.includes('enchantment');
        });

        // If there are no legal permanents to sacrifice, Bargain is deterministically not paid.
        if (validBargainTargets.length === 0) {
          (targets as any) = (targets as any) || {};
          (targets as any).bargainResolved = true;
          (targets as any).wasBargained = false;
          bargainResolved = true;
          wasBargained = false;
        } else {
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) =>
              s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT &&
              String((s as any)?.sourceId || '') === String(cardId) &&
              String((s as any)?.costType || '') === 'sacrifice' &&
              String((s as any)?.additionalCostKeyword || '').toLowerCase().trim() === 'bargain'
            );

          if (!existing) {
            const bargainStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Bargain (optional): You may sacrifice an artifact, enchantment, or token as you cast ${cardInHand.name}. Submit with 0 selections to decline.`,
              mandatory: false,
              cardId,
              cardName: cardInHand.name,
              costType: 'sacrifice',
              amount: 1,
              additionalCostKeyword: 'bargain',
              title: `Bargain (optional) � ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableTargets: validBargainTargets.map((p: any) => ({
                id: p.id,
                name: p.card?.name || 'Unknown',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                typeLine: p.card?.type_line,
                ...getLeaveBattlefieldReplacementHint(p, 'graveyard', game.state),
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(bargainStep as any),
              },
            });
          }

          debug(2, `[castSpellFromHand] Queued Bargain (optional) prompt for ${cardInHand.name}`);
          return; // Wait for Bargain selection via Resolution Queue
        }
      }
      
      if (!shouldSkipAllPrompts && additionalCost?.type === 'collect_evidence' && !collectEvidenceResolved) {
        const required = Number((additionalCost as any).collectEvidenceValue || 0);
        const optional = Boolean((additionalCost as any).collectEvidenceIsOptional);

        if (!Number.isFinite(required) || required <= 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_ADDITIONAL_COST',
            message: `Additional cost "Collect evidence" is not supported yet for ${cardInHand.name}.`,
          });
          return;
        }

        const gy = Array.isArray(zones.graveyard) ? zones.graveyard : [];
        const validTargets = gy.map((c: any) => ({
          id: String(c?.id || ''),
          name: String(c?.name || c?.id || 'Card'),
          typeLine: c?.type_line,
          manaCost: c?.mana_cost,
          imageUrl: c?.image_uris?.small || c?.image_uris?.normal,
        })).filter((t: any) => Boolean(t.id));

        const effectId = cardId;
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, playerId as any)
          .find((s: any) => (s as any)?.type === ResolutionStepType.GRAVEYARD_SELECTION && String((s as any)?.effectId || '') === String(effectId));

        if (!existing) {
          const collectEvidenceStep = ResolutionQueueManager.addStep(gameId, {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: playerId as any,
            sourceId: effectId,
            sourceName: cardInHand.name,
            sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
            description: optional
              ? `You may collect evidence ${required} for ${cardInHand.name} by exiling cards from your graveyard (total mana value ${required} or more). Submit with 0 selections to decline.`
              : `Collect evidence ${required} for ${cardInHand.name} by exiling cards from your graveyard (total mana value ${required} or more).`,
            mandatory: !optional,
            effectId,
            cardName: cardInHand.name,
            title: `Collect evidence ${required} (${cardInHand.name})`,
            targetPlayerId: playerId,
            minTargets: optional ? 0 : 1,
            maxTargets: Math.max(optional ? 0 : 1, validTargets.length),
            destination: 'exile',
            purpose: 'collectEvidence',
            collectEvidenceMinManaValue: required,
            validTargets,
            castSpellFromHandArgs: {
              cardId,
              payment,
              targets,
              xValue,
              alternateCostId,
              convokeTappedCreatures,
            },
          } as any);

          persistQueuedSpellCastStepContinuation(gameId, game, {
            playerId,
            cardId,
            queuedResolutionStep: {
              ...(collectEvidenceStep as any),
            },
          });
        }

        debug(2, `[castSpellFromHand] Queued collect evidence ${required} prompt for ${cardInHand.name}`);
        return; // Wait for graveyard selection via Resolution Queue
      }

      if (!shouldSkipAllPrompts && additionalCost?.type === 'teamwork' && !teamworkResolved) {
        const minPower = Math.max(0, Number((additionalCost as any).teamworkMinPower || 0));
        const teamworkCreatures = (game.state?.battlefield || []).filter((p: any) => {
          if (!p || String(p.controller || '') !== String(playerId)) return false;
          if ((p as any).tapped) return false;
          const typeLine = String(p?.card?.type_line || '').toLowerCase();
          return typeLine.includes('creature');
        });
        const totalUntappedPower = teamworkCreatures.reduce(
          (sum: number, permanent: any) => sum + getEffectivePower(permanent),
          0,
        );

        if (minPower <= 0 || totalUntappedPower < minPower) {
          (targets as any) = (targets as any) || {};
          (targets as any).teamworkResolved = true;
          (targets as any).teamworkWasPaid = false;
          teamworkResolved = true;
          teamworkWasPaid = false;
        } else {
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) =>
              s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT &&
              String((s as any)?.sourceId || '') === String(cardId) &&
              String((s as any)?.costType || '') === 'teamwork',
            );

          if (!existing) {
            const teamworkStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Teamwork (optional): Tap creatures with total power ${minPower} or more to cast ${cardInHand.name}. Submit with no selections to decline.`,
              mandatory: false,
              cardId,
              cardName: cardInHand.name,
              costType: 'teamwork',
              amount: 0,
              teamworkMinPower: minPower,
              title: `Teamwork � ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableTargets: teamworkCreatures.map((p: any) => ({
                id: p.id,
                name: p.card?.name || 'Creature',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                typeLine: p.card?.type_line,
                power: getEffectivePower(p),
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(teamworkStep as any),
              },
            });
          }

          debug(2, `[castSpellFromHand] Queued Teamwork (optional) prompt for ${cardInHand.name}`);
          return;
        }
      }

      if (!shouldSkipAllPrompts && additionalCost?.type === 'behold_chosen_type') {
        const beholdMarker = (payment as any[])?.find((p: any) => p && p.beholdResolved === true);
        const beholdResolved =
          beholdMarker?.beholdResolved === true ||
          (targets as any)?.beholdResolved === true ||
          (cardInHand as any)?.beholdResolved === true;
        const chosenTypeForBehold = String(
          (cardInHand as any)?.chosenCreatureType ||
          (targets as any)?.chosenCreatureType ||
          beholdMarker?.chosenCreatureType ||
          '',
        ).trim();

        if (!beholdResolved) {
          const existingBeholdPrompt = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) =>
              String((s as any)?.spellBeholdCastCardId || (s as any)?.beholdCastCardId || '') === String(cardId) &&
              (
                (s as any)?.spellBeholdCastPrompt === true ||
                (s as any)?.type === ResolutionStepType.CREATURE_TYPE_CHOICE ||
                (
                  (s as any)?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT &&
                  String((s as any)?.costType || '') === 'behold'
                )
              ),
            );

          if (existingBeholdPrompt) {
            debug(2, `[castSpellFromHand] Waiting on behold prompt for ${cardInHand.name}`);
            return;
          }

          if (!chosenTypeForBehold && additionalCost.beholdIsOptional !== false) {
            const beholdOptionStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.OPTION_CHOICE,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Optional additional cost for ${cardInHand.name}: You may choose a creature type and behold ${additionalCost.amount} creatures of that type.`,
              mandatory: false,
              options: [
                { id: 'behold', label: `Behold ${additionalCost.amount} creatures` },
                { id: 'skip', label: 'Skip behold' },
              ],
              minSelections: 1,
              maxSelections: 1,
              spellBeholdCastPrompt: true,
              spellBeholdCastCardId: cardId,
              spellBeholdCount: additionalCost.amount,
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(beholdOptionStep as any),
              },
            });
            debug(2, `[castSpellFromHand] Queued optional behold prompt for ${cardInHand.name}`);
            return;
          }

          if (!chosenTypeForBehold) {
            const beholdTypeStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.CREATURE_TYPE_CHOICE,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Choose a creature type to behold for ${cardInHand.name}`,
              mandatory: true,
              beholdCastCardId: cardId,
              cardName: cardInHand.name,
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(beholdTypeStep as any),
              },
            });
            debug(2, `[castSpellFromHand] Queued behold creature type choice for ${cardInHand.name}`);
            return;
          }

          if (!additionalCostPaid) {
            const beholdCount = Math.max(1, Number(additionalCost.amount || 2));
            const { handCards, battlefieldCreatures } = buildBeholdSelectionOptions(
              game.state,
              String(playerId),
              chosenTypeForBehold,
              zones.hand,
              cardId,
            );
            const totalBeholdOptions = handCards.length + battlefieldCreatures.length;
            if (totalBeholdOptions < beholdCount) {
              socket.emit('error', {
                code: 'CANNOT_PAY_COST',
                message: `Cannot behold ${beholdCount} ${chosenTypeForBehold} creature(s) for ${cardInHand.name}: you only have ${totalBeholdOptions} available.`,
              });
              return;
            }

            const beholdPaymentStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Behold ${beholdCount} ${chosenTypeForBehold} creature${beholdCount === 1 ? '' : 's'} to cast ${cardInHand.name}. Reveal matching cards from your hand and/or choose creatures you control.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              costType: 'behold',
              amount: beholdCount,
              chosenCreatureType: chosenTypeForBehold,
              title: `Behold ${beholdCount} ${chosenTypeForBehold} creature${beholdCount === 1 ? '' : 's'}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableCards: handCards.map((c: any) => ({
                id: c.id,
                name: c.name,
                imageUrl: c.image_uris?.small || c.image_uris?.normal,
                typeLine: c.type_line,
                zone: 'hand',
              })),
              availableTargets: battlefieldCreatures.map((p: any) => ({
                id: p.id,
                name: p.card?.name || 'Unknown',
                imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
                typeLine: p.card?.type_line,
                zone: 'battlefield',
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(beholdPaymentStep as any),
              },
            });
            debug(2, `[castSpellFromHand] Queued behold payment for ${cardInHand.name} (${chosenTypeForBehold})`);
            return;
          }
        }
      }

      if (!shouldSkipAllPrompts && additionalCost && additionalCost.type !== 'behold_chosen_type' && !additionalCostPaid) {
        // Need to prompt for additional cost payment
        if (additionalCost.type === 'discard') {
          // Check if player has enough cards to discard
          const handCards = zones.hand.filter((c: any) => c.id !== cardId); // Exclude the card being cast
          if (handCards.length < additionalCost.amount) {
            socket.emit("error", {
              code: "CANNOT_PAY_COST",
              message: `Cannot cast ${cardInHand.name}: You need to discard ${additionalCost.amount} card(s) but only have ${handCards.length} other card(s) in hand.`,
            });
            return;
          }
          
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.costType || '') === 'discard');

          if (!existing) {
            const discardCostStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `As an additional cost to cast ${cardInHand.name}, discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''}.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              costType: 'discard',
              amount: additionalCost.amount,
              title: `Discard ${additionalCost.amount} card${additionalCost.amount > 1 ? 's' : ''} to cast ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableCards: handCards.map((c: any) => ({
                id: c.id,
                name: c.name,
                imageUrl: c.image_uris?.small || c.image_uris?.normal,
                typeLine: c.type_line,
              })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(discardCostStep as any),
              },
            });
          }

          debug(2, `[castSpellFromHand] Queued discard of ${additionalCost.amount} card(s) for ${cardInHand.name}`);
          return; // Wait for discard selection via Resolution Queue
        } else if (additionalCost.type === 'sacrifice') {
          // Find valid sacrifice targets
          const battlefield = game.state?.battlefield || [];
          const validSacrificeTargets = battlefield.filter((p: any) => {
            if (p.controller !== playerId) return false;
            const tl = (p.card?.type_line || '').toLowerCase();
            if (!additionalCost.filter) return true;
            return tl.includes(additionalCost.filter.toLowerCase());
          });
          
          if (validSacrificeTargets.length < additionalCost.amount) {
            socket.emit("error", {
              code: "CANNOT_PAY_COST",
              message: `Cannot cast ${cardInHand.name}: You need to sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}(s) but don't control enough.`,
            });
            return;
          }
          
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT && String((s as any)?.sourceId || '') === String(cardId) && String((s as any)?.costType || '') === 'sacrifice');

          if (!existing) {
            const sacrificeCostStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.ADDITIONAL_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `As an additional cost to cast ${cardInHand.name}, sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''}.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              costType: 'sacrifice',
              amount: additionalCost.amount,
              filter: additionalCost.filter,
              title: `Sacrifice ${additionalCost.amount} ${additionalCost.filter || 'permanent'}${additionalCost.amount > 1 ? 's' : ''} to cast ${cardInHand.name}`,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              availableTargets: validSacrificeTargets.map((p: any) => ({
              id: p.id,
              name: p.card?.name || 'Unknown',
              imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
              typeLine: p.card?.type_line,
              isCommander: Boolean(p.isCommander || p.commander || p?.card?.isCommander || p?.card?.commander),
              ...getLeaveBattlefieldReplacementHint(p, 'graveyard', game.state),
            })),
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(sacrificeCostStep as any),
              },
            });
          }

          debug(2, `[castSpellFromHand] Queued sacrifice of ${additionalCost.amount} ${additionalCost.filter || 'permanent'}(s) for ${cardInHand.name}`);
          return; // Wait for sacrifice selection via Resolution Queue
        } else if (additionalCost.type === 'pay_life') {
          // Pay X life as an additional cost (Vampiric Tutor, etc.)
          const startingLife = game.state.startingLife || 40;
          const currentLife = game.state.life?.[playerId] ?? startingLife;
          
          // Validate that player can pay the life
          if (currentLife < additionalCost.amount) {
            socket.emit("error", {
              code: "CANNOT_PAY_COST",
              message: `Cannot cast ${cardInHand.name}: You need to pay ${additionalCost.amount} life but only have ${currentLife} life.`,
            });
            return;
          }
          
          // Pay the life immediately
          game.state.life = game.state.life || {};
          game.state.life[playerId] = currentLife - additionalCost.amount;

          // Track life lost this turn.
          try {
            (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
            (game.state as any).lifeLostThisTurn[String(playerId)] =
              ((game.state as any).lifeLostThisTurn[String(playerId)] || 0) + Number(additionalCost.amount || 0);
          } catch {}
          queueLifePaymentTriggers(game as any, String(playerId), Number(additionalCost.amount || 0), { sourceId: cardId, sourceName: cardInHand.name });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${getPlayerName(game, playerId)} pays ${additionalCost.amount} life to cast ${cardInHand.name}. (${currentLife} G�� ${game.state.life[playerId]})`,
            ts: Date.now(),
          });
          
          debug(2, `[castSpellFromHand] Player paid ${additionalCost.amount} life for ${cardInHand.name}`);
          
          // Mark additional cost as paid
          (targets as any) = (targets as any) || {};
          (targets as any).additionalCostPaid = true;
        } else if (additionalCost.type === 'squad') {
          // Squad: "As an additional cost to cast this spell, you may pay {cost} any number of times"
          // Prompt the player to choose how many times to pay the squad cost
          const existing = ResolutionQueueManager
            .getStepsForPlayer(gameId, playerId as any)
            .find((s: any) => s?.type === ResolutionStepType.SQUAD_COST_PAYMENT && String((s as any)?.sourceId || '') === String(cardId));

          if (!existing) {
            const squadCostStep = ResolutionQueueManager.addStep(gameId, {
              type: ResolutionStepType.SQUAD_COST_PAYMENT,
              playerId: playerId as any,
              sourceId: cardId,
              sourceName: cardInHand.name,
              sourceImage: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              description: `Choose how many times to pay Squad for ${cardInHand.name}.`,
              mandatory: true,
              cardId,
              cardName: cardInHand.name,
              squadCost: additionalCost.cost,
              imageUrl: cardInHand.image_uris?.small || cardInHand.image_uris?.normal,
              castSpellFromHandArgs: {
                cardId,
                payment,
                targets,
                xValue,
                alternateCostId,
                convokeTappedCreatures,
              },
            } as any);

            persistQueuedSpellCastStepContinuation(gameId, game, {
              playerId,
              cardId,
              queuedResolutionStep: {
                ...(squadCostStep as any),
              },
            });
          }

          debug(2, `[castSpellFromHand] Queued squad payment for ${cardInHand.name} (cost: ${additionalCost.cost})`);
          return; // Wait for squad payment selection via Resolution Queue
        }
      }

  return {
    kind: "continue",
    targets,
    additionalCost,
    additionalCostPaid,
    bargainResolved,
    wasBargained,
    teamworkResolved,
    teamworkWasPaid,
    evidenceCollected,
  };
}
