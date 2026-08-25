/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: handleAIResolutionStep cases explore_decision through
 * hideaway_choice.
 *
 * Public entry symbols: handleAIResolutionKeywordAndMiscSteps.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug } from "../../utils/debug.js";
import {
  chooseAIHideawayCardId,
  chooseAIReturnControlledPermanentId,
  chooseAIUpkeepSacrificeSelection,
} from "./aiZoneSearchChoiceHandlers.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";

export async function handleAIResolutionKeywordAndMiscSteps(
  io: Server,
  gameId: string,
  game: any,
  playerId: PlayerID,
  step: any,
  createResponse: (selections: any, cancelled?: boolean) => any,
): Promise<void> {
  switch (step.type) {
      case 'explore_decision': {
        const permanentId = String((step as any)?.permanentId || step.sourceId || '');
        const isLand = Boolean((step as any)?.isLand);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          permanentId,
          toGraveyard: !isLand,
        }));
        debug(1, `[AI] explore_decision: ${isLand ? 'keeping land on top' : 'binning nonland'}`);
        break;
      }

      case 'batch_explore_decision': {
        const explores = Array.isArray((step as any)?.explores) ? (step as any).explores : [];
        const decisions = explores
          .map((entry: any) => ({
            permanentId: String(entry?.permanentId || ''),
            toGraveyard: !Boolean(entry?.isLand),
          }))
          .filter((entry: any) => Boolean(entry.permanentId));

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({ decisions }));
        debug(1, `[AI] batch_explore_decision: selected ${decisions.length} explore decision(s)`);
        break;
      }

      case 'mana_payment_choice': {
        const stepData = step as any;
        if (
          stepData.spellPaymentRequired === true ||
          stepData.sacrificeUnlessPayChoice === true ||
          stepData.activationPaymentChoice === true
        ) {
          const selections = await getAIHandlerDeps().chooseAISpellPaymentSelections(io as any, gameId, game, playerId as any, stepData);
          ResolutionQueueManager.completeStep(
            gameId,
            step.id,
            selections ? createResponse(selections) : createResponse({ payment: [] }, true),
          );
          debug(1, `[AI] mana_payment_choice: ${selections ? 'assembled payment' : 'could not assemble payment'}`);
          break;
        }

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({ payment: [] }, true));
        debug(1, `[AI] mana_payment_choice: unsupported payment prompt, cancelling`);
        break;
      }

      case 'tempting_offer': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(false));
        debug(1, `[AI] tempting_offer: declining offer`);
        break;
      }

      case 'activated_ability': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([]));
        debug(1, `[AI] activated_ability: auto-resolving without selections`);
        break;
      }

      case 'cascade': {
        const shouldCast = Boolean((step as any)?.hitCard);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(shouldCast));
        debug(1, `[AI] cascade: ${shouldCast ? 'casting' : 'declining'} hit card`);
        break;
      }

      case 'ponder_effect': {
        const cards = Array.isArray((step as any)?.cards) ? (step as any).cards : [];
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          newOrder: cards.map((card: any) => String(card?.id || '')).filter(Boolean),
          shouldShuffle: false,
        }));
        debug(1, `[AI] ponder_effect: keeping ${cards.length} card(s) in order`);
        break;
      }

      case 'devour_selection': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([]));
        debug(1, `[AI] devour_selection: not sacrificing any creatures`);
        break;
      }

      case 'suspend_cast': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({ action: 'suspend' }));
        debug(1, `[AI] suspend_cast: suspending ${String((step as any)?.card?.name || 'card')}`);
        break;
      }

      case 'morph_turn_face_up': {
        const canAfford = (step as any)?.canAfford !== false;
        ResolutionQueueManager.completeStep(
          gameId,
          step.id,
          createResponse({ action: canAfford ? 'turn_face_up' : 'cancel' }, !canAfford),
        );
        debug(1, `[AI] morph_turn_face_up: ${canAfford ? 'turning face-up' : 'cancelling (cannot afford)'}`);
        break;
      }

      case 'proliferate': {
        const availableTargets = Array.isArray((step as any)?.availableTargets) ? (step as any).availableTargets : [];
        const selectedTargetIds = availableTargets
          .filter((target: any) => {
            const counters = target?.counters || {};
            const isOwnPermanent = !target?.isPlayer && String(target?.controller || '') === String(playerId);
            const isOpponentPlayer = target?.isPlayer === true && String(target?.id || '') !== String(playerId);

            if (isOwnPermanent && Number(counters['+1/+1'] || 0) > 0) return true;
            if (isOpponentPlayer && Number(counters.poison || 0) > 0) return true;
            if (!target?.isPlayer && String(target?.controller || '') !== String(playerId) && Number(counters['-1/-1'] || 0) > 0) return true;
            return false;
          })
          .map((target: any) => String(target?.id || ''))
          .filter(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedTargetIds));
        debug(1, `[AI] proliferate: selected ${selectedTargetIds.length} target(s)`);
        break;
      }

      case 'fateseal': {
        const cards = Array.isArray((step as any)?.cards) ? (step as any).cards : [];
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          keepTopOrder: cards,
          bottomOrder: [],
        }));
        debug(1, `[AI] fateseal: keeping ${cards.length} card(s) on top`);
        break;
      }

      case 'clash': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          putOnBottom: false,
        }));
        debug(1, `[AI] clash: keeping revealed card on top`);
        break;
      }

      case 'vote': {
        const choices = Array.isArray((step as any)?.choices) ? (step as any).choices : [];
        const choice = typeof choices[0] === 'string' ? choices[0] : 'decline';
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          choice,
          voteCount: 1,
        }));
        debug(1, `[AI] vote: selected ${choice}`);
        break;
      }

      case 'two_pile_split': {
        const items = Array.isArray((step as any)?.items) ? (step as any).items : [];
        const pileCount = Math.max(2, Math.floor(Number((step as any)?.pileCount ?? 2)));
        const piles = Array.from({ length: pileCount }, () => [] as string[]);

        items.forEach((item: any, index: number) => {
          const id = String(item?.id || '');
          if (!id) return;
          piles[index % pileCount].push(id);
        });

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          pileA: piles[0] || [],
          pileB: piles[1] || [],
          ...(pileCount > 2 ? { pileC: piles[2] || [] } : {}),
          ...(pileCount > 2 ? { piles } : {}),
        }));
        if ((step as any)?.oracleIrSequentialPileSplit === true) {
          const { resolveSequentialPileSplitForAI } = await import('../resolution.js');
          await resolveSequentialPileSplitForAI(
            io,
            game,
            gameId,
            step,
            createResponse({
              piles,
              pileA: piles[0] || [],
              pileB: piles[1] || [],
              ...(pileCount > 2 ? { pileC: piles[2] || [] } : {}),
            }),
          );
        }
        debug(1, `[AI] ${pileCount}-pile split: ${piles.map((pile) => pile.length).join('/')}`);
        break;
      }

      case 'riot_choice': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(['counter']));
        debug(1, `[AI] riot_choice: chose +1/+1 counter`);
        break;
      }

      case 'unleash_choice': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(['counter']));
        debug(1, `[AI] unleash_choice: chose +1/+1 counter`);
        break;
      }

      case 'fabricate_choice': {
        const value = Number((step as any)?.value || 1);
        const choice = value >= 2 ? 'tokens' : 'counters';
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([choice]));
        debug(1, `[AI] fabricate_choice: chose ${choice}`);
        break;
      }

      case 'tribute_choice': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(['decline']));
        debug(1, `[AI] tribute_choice: declined tribute`);
        break;
      }

      case 'extort_payment': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(['skip']));
        debug(1, `[AI] extort_payment: skipping payment`);
        break;
      }

      case 'keyword_choice': {
        const options = Array.isArray((step as any)?.options) ? (step as any).options : [];
        const firstOption = options[0];
        const selected = typeof firstOption === 'string'
          ? firstOption
          : String(firstOption?.id ?? firstOption?.value ?? '');
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selected ? [selected] : []));
        debug(1, `[AI] keyword_choice: selected ${selected || 'none'}`);
        break;
      }

      case 'exploit_choice': {
        const creatures = Array.isArray((step as any)?.creatures) ? (step as any).creatures : [];
        const selectedId = [...creatures]
          .sort((left: any, right: any) => {
            const leftValue = (parseInt(left?.power, 10) || 0) + (parseInt(left?.toughness, 10) || 0);
            const rightValue = (parseInt(right?.power, 10) || 0) + (parseInt(right?.toughness, 10) || 0);
            return leftValue - rightValue;
          })
          .map((creature: any) => String(creature?.id || ''))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] exploit_choice: selected ${selectedId || 'none'}`);
        break;
      }

      case 'backup_choice': {
        const targets = Array.isArray((step as any)?.targets) ? (step as any).targets : [];
        const sourceId = String((step as any)?.sourceId || '');
        const selectedId = [...targets]
          .filter((target: any) => String(target?.id || '') !== sourceId)
          .sort((left: any, right: any) => {
            const leftValue = (parseInt(left?.power, 10) || 0) + (parseInt(left?.toughness, 10) || 0);
            const rightValue = (parseInt(right?.power, 10) || 0) + (parseInt(right?.toughness, 10) || 0);
            return rightValue - leftValue;
          })
          .map((target: any) => String(target?.id || ''))
          .find(Boolean)
          || sourceId;

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] backup_choice: selected ${selectedId || 'none'}`);
        break;
      }

      case 'mentor_target': {
        const targets = Array.isArray((step as any)?.targets) ? (step as any).targets : [];
        const selectedId = [...targets]
          .sort((left: any, right: any) => (parseInt(left?.power, 10) || 0) - (parseInt(right?.power, 10) || 0))
          .map((target: any) => String(target?.id || ''))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] mentor_target: selected ${selectedId || 'none'}`);
        break;
      }

      case 'enlist_choice': {
        const creatures = Array.isArray((step as any)?.creatures) ? (step as any).creatures : [];
        const selectedId = [...creatures]
          .sort((left: any, right: any) => (parseInt(right?.power, 10) || 0) - (parseInt(left?.power, 10) || 0))
          .map((creature: any) => String(creature?.id || ''))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] enlist_choice: selected ${selectedId || 'none'}`);
        break;
      }

      case 'modular_choice': {
        const targets = Array.isArray((step as any)?.targets) ? (step as any).targets : [];
        const selectedId = [...targets]
          .sort((left: any, right: any) => {
            const leftValue = (parseInt(left?.power, 10) || 0) + (parseInt(left?.toughness, 10) || 0);
            const rightValue = (parseInt(right?.power, 10) || 0) + (parseInt(right?.toughness, 10) || 0);
            return rightValue - leftValue;
          })
          .map((target: any) => String(target?.id || ''))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] modular_choice: selected ${selectedId || 'none'}`);
        break;
      }

      case 'soulshift_target': {
        const spirits = Array.isArray((step as any)?.spirits) ? (step as any).spirits : [];
        const selectedId = [...spirits]
          .sort((left: any, right: any) => (Number(right?.cmc || 0) || 0) - (Number(left?.cmc || 0) || 0))
          .map((spirit: any) => String(spirit?.id || ''))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] soulshift_target: selected ${selectedId || 'none'}`);
        break;
      }

      case 'haunt_target': {
        const hauntTargets = Array.isArray((step as any)?.targets) ? (step as any).targets : [];
        const selectedId = hauntTargets.map((target: any) => String(target?.id || '')).find(Boolean);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] haunt_target: selected ${selectedId || 'none'}`);
        break;
      }

      case 'upkeep_sacrifice': {
        const selection = chooseAIUpkeepSacrificeSelection(game, playerId, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selection));
        debug(
          1,
          `[AI] upkeep_sacrifice: selected ${typeof selection === 'object' && !Array.isArray(selection) ? `${selection.type}${selection.creatureId ? `:${selection.creatureId}` : ''}` : 'none'}`,
        );
        break;
      }

      case 'return_controlled_permanent_choice': {
        const permanentId = chooseAIReturnControlledPermanentId(game, playerId, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(permanentId));
        debug(1, `[AI] return_controlled_permanent_choice: selected ${permanentId || 'none'}`);
        break;
      }

      case 'hideaway_choice': {
        const cardId = chooseAIHideawayCardId(game, playerId, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(cardId ? [cardId] : []));
        debug(1, `[AI] hideaway_choice: selected ${cardId || 'none'}`);
        break;
      }
  }
}

