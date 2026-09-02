/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: handleAIResolutionStep cases x_value_selection through
 * squad_cost_payment.
 *
 * Public entry symbols: handleAIResolutionPaymentAndTargetSteps.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { getEffectivePower, getEffectiveToughness } from "../util.js";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting.js";
import { chooseAIScrySelection } from "./aiZoneSearchChoiceHandlers.js";
import { chooseAIManaColorForActivation } from "./aiManaCostHelpers.js";
import { chooseAIJoinForcesContribution } from "./aiJoinForcesDecision.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";

export async function handleAIResolutionPaymentAndTargetSteps(
  io: Server,
  gameId: string,
  game: any,
  playerId: PlayerID,
  step: any,
  createResponse: (selections: any, cancelled?: boolean) => any,
): Promise<void> {
  const { chooseAIXValueSelection, chooseCardsToDiscard, chooseAIAdditionalCostCardIds } = getAIHandlerDeps();
  switch (step.type) {
      case 'x_value_selection': {
        const xValue = chooseAIXValueSelection(game, playerId, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(xValue));
        debug(1, `[AI] x_value_selection: chose X=${xValue}`);
        break;
      }

      case 'mana_color_selection': {
        const stepAny = step as any;
        const selectionKind = String(stepAny.selectionKind || 'any_color');
        const allowedCodes = Array.isArray(stepAny.allowedColors)
          ? stepAny.allowedColors
              .map((color: any) => String(color || '').toUpperCase())
              .filter((color: string) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color))
          : ['W', 'U', 'B', 'R', 'G'];

        const chosenCode = chooseAIManaColorForActivation(
          game,
          playerId,
          allowedCodes.length > 0 ? allowedCodes : ['W', 'U', 'B', 'R', 'G'],
        );
        const codeToPoolKey: Record<string, string> = {
          W: 'white',
          U: 'blue',
          B: 'black',
          R: 'red',
          G: 'green',
          C: 'colorless',
        };

        if (selectionKind === 'distribution') {
          const totalAmount = Math.max(0, Number(stepAny.totalAmount ?? stepAny.amount ?? 0));
          const distribution: Record<string, number> = {};
          if (totalAmount > 0) {
            distribution[chosenCode] = totalAmount;
          }
          ResolutionQueueManager.completeStep(gameId, step.id, createResponse(distribution));
          debug(1, `[AI] mana_color_selection: distributed ${totalAmount} mana as ${chosenCode}`);
          break;
        }

        const chosenPoolKey = codeToPoolKey[chosenCode] || 'colorless';
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(chosenPoolKey));
        debug(1, `[AI] mana_color_selection: chose ${chosenPoolKey}`);
        break;
      }

      case 'discard_selection': {
        const discardCount = Number(step.discardCount || 0);
        const resolutionModule = await import('../resolution.js');
        if (!discardCount || discardCount <= 0) {
          debug(1, `[AI] Discard selection: no discardCount specified, skipping`);
          const response = createResponse([]);
          if (ResolutionQueueManager.completeStep(gameId, step.id, response)) {
            await resolutionModule.applyResolutionStepSideEffects(io, game, gameId, step, response);
          }
          break;
        }

        const cardIds = chooseCardsToDiscard(game, playerId, discardCount);
        if (!Array.isArray(cardIds) || cardIds.length !== discardCount) {
          debugWarn(1, `[AI] Discard selection: could not choose ${discardCount} cards, chosen=${cardIds?.length || 0}`);
          const response = createResponse([]);
          if (ResolutionQueueManager.completeStep(gameId, step.id, response)) {
            await resolutionModule.applyResolutionStepSideEffects(io, game, gameId, step, response);
          }
          break;
        }

        debug(1, `[AI] Discard selection: discarding ${cardIds.length} card(s)`);
        const response = createResponse(cardIds);
        if (ResolutionQueueManager.completeStep(gameId, step.id, response)) {
          await resolutionModule.applyResolutionStepSideEffects(io, game, gameId, step, response);
        }
        break;
      }

      case 'scry': {
        const selections = chooseAIScrySelection(game, playerId, step as any);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selections));
        debug(1, `[AI] scry: keeping ${selections.keepTopOrder.length} on top, ${selections.bottomOrder.length} on bottom`);
        break;
      }

      case 'surveil': {
        const cards = Array.isArray((step as any)?.cards) ? (step as any).cards : [];
        const keepTopOrder: any[] = [];
        const toGraveyard: any[] = [];

        for (const card of cards) {
          const typeLine = String(card?.type_line || '').toLowerCase();
          if (typeLine.includes('land')) {
            toGraveyard.push(card);
          } else {
            keepTopOrder.push(card);
          }
        }

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          keepTopOrder,
          toGraveyard,
        }));
        debug(1, `[AI] surveil: keeping ${keepTopOrder.length} on top, ${toGraveyard.length} to graveyard`);
        break;
      }

      case 'bottom_order': {
        const cards = Array.isArray((step as any)?.cards) ? (step as any).cards : [];
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          bottomOrder: cards,
        }));
        debug(1, `[AI] bottom_order: preserving order for ${cards.length} card(s)`);
        break;
      }

      case 'lim_duls_vault': {
        const cards = Array.isArray((step as any)?.cards) ? (step as any).cards : [];
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          action: 'finish',
          orderedIds: cards.map((card: any) => String(card?.id || '')).filter(Boolean),
        }));
        debug(1, `[AI] lim_duls_vault: finishing with current order of ${cards.length} card(s)`);
        break;
      }

      case 'dance_with_calamity': {
        const exiledCards = Array.isArray((step as any)?.exiledCards) ? (step as any).exiledCards : [];
        const totalManaValue = Number((step as any)?.totalManaValue || 0);
        const hasSpell = exiledCards.some((card: any) => !String(card?.type_line || '').toLowerCase().includes('land'));
        const shouldContinue = (step as any)?.canContinue === true && (!hasSpell || totalManaValue <= 8);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          action: shouldContinue ? 'continue' : 'stop',
        }));
        debug(1, `[AI] dance_with_calamity: ${shouldContinue ? 'continue' : 'stop'} at total mana value ${totalManaValue}`);
        break;
      }

      case 'dance_with_calamity_cast': {
        const spellCards = Array.isArray((step as any)?.spellCards) ? (step as any).spellCards : [];
        const orderedSpellIds = [...spellCards]
          .sort((left: any, right: any) => (Number(right?.cmc || 0) || 0) - (Number(left?.cmc || 0) || 0))
          .map((card: any) => String(card?.id || ''))
          .filter(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse({
          orderedSpellIds,
        }));
        debug(1, `[AI] dance_with_calamity_cast: selected ${orderedSpellIds.length} spell(s)`);
        break;
      }

      case 'hand_to_bottom': {
        const cardsToBottom = Number((step as any)?.cardsToBottom || 0);
        const hand = Array.isArray((step as any)?.hand)
          ? (step as any).hand
          : (Array.isArray((game.state as any)?.zones?.[playerId]?.hand)
              ? (game.state as any).zones[playerId].hand
              : []);
        const selectedIds = hand
          .map((card: any) => String(card?.id || ''))
          .filter(Boolean)
          .slice(-Math.max(0, cardsToBottom));

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedIds));
        debug(1, `[AI] hand_to_bottom: selected ${selectedIds.length} card(s)`);
        break;
      }

      case 'join_forces': {
        const contribution = chooseAIJoinForcesContribution(game, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(contribution));
        debug(1, `[AI] join_forces: contributing ${contribution} mana`);
        break;
      }

      case 'fight_target': {
        const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
        const stepData = step as any;
        const sourceId = String(step.sourceId || stepData.sourceId || '');
        const targetFilter = stepData.targetFilter || {};
        const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
        const excludeSource = targetFilter.excludeSource !== false;

        const selectedId = battlefield
          .filter((perm: any) => {
            if (!perm || typeof perm.id !== 'string') return false;
            if (excludeSource && String(perm.id) === sourceId) return false;
            const typeLine = String(perm.card?.type_line || '').toLowerCase();
            if (!typeLine.includes('creature')) return false;
            if (controllerFilter === 'you' && String(perm.controller) !== String(playerId)) return false;
            if (controllerFilter === 'opponent' && String(perm.controller) === String(playerId)) return false;
            return canPermanentBeTargetedByPlayer(perm, game.state as any, playerId as any);
          })
          .map((perm: any) => String(perm.id))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : [], !selectedId));
        debug(1, `[AI] fight_target: selected ${selectedId || 'none'}`);
        break;
      }

      case 'tap_untap_target': {
        const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
        const stepData = step as any;
        const sourceId = String(step.sourceId || stepData.sourceId || '');
        const targetCount = Math.max(1, Number(stepData.targetCount || 1));
        const targetFilter = stepData.targetFilter || {};
        const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
        const tapStatus: 'tapped' | 'untapped' | 'any' = targetFilter.tapStatus || 'any';
        const excludeSource = targetFilter.excludeSource === true;
        const requireAllTypes = targetFilter.requireAllTypes === true;
        const minPower = targetFilter.minPower !== undefined ? Number(targetFilter.minPower) : undefined;
        const maxPower = targetFilter.maxPower !== undefined ? Number(targetFilter.maxPower) : undefined;
        const minToughness = targetFilter.minToughness !== undefined ? Number(targetFilter.minToughness) : undefined;
        const maxToughness = targetFilter.maxToughness !== undefined ? Number(targetFilter.maxToughness) : undefined;

        const chosenIds = battlefield
          .filter((perm: any) => {
            if (!perm || typeof perm.id !== 'string') return false;
            if (excludeSource && String(perm.id) === sourceId) return false;

            const types = Array.isArray(targetFilter.types) ? targetFilter.types : [];
            if (types.length > 0) {
              const typeLine = String(perm.card?.type_line || '').toLowerCase();
              if (requireAllTypes) {
                if (!types.every((type: any) => typeLine.includes(String(type).toLowerCase()))) return false;
              } else if (!types.some((type: any) => typeLine.includes(String(type).toLowerCase()))) {
                return false;
              }
            }

            const subtypes = Array.isArray(targetFilter.subtypes) ? targetFilter.subtypes : [];
            if (subtypes.length > 0) {
              const typeLine = String(perm.card?.type_line || '').toLowerCase();
              if (!subtypes.every((sub: any) => typeLine.includes(String(sub).toLowerCase()))) return false;
            }

            if (minPower !== undefined || maxPower !== undefined) {
              const power = getEffectivePower(perm);
              if (minPower !== undefined && power < minPower) return false;
              if (maxPower !== undefined && power > maxPower) return false;
            }
            if (minToughness !== undefined || maxToughness !== undefined) {
              const toughness = getEffectiveToughness(perm);
              if (minToughness !== undefined && toughness < minToughness) return false;
              if (maxToughness !== undefined && toughness > maxToughness) return false;
            }

            if (controllerFilter === 'you' && String(perm.controller) !== String(playerId)) return false;
            if (controllerFilter === 'opponent' && String(perm.controller) === String(playerId)) return false;
            if (tapStatus === 'tapped' && !perm.tapped) return false;
            if (tapStatus === 'untapped' && perm.tapped) return false;

            return true;
          })
          .slice(0, targetCount)
          .map((perm: any) => String(perm.id));

        const tapResponse = createResponse(
          { targetIds: chosenIds, action: stepData.action === 'untap' ? 'untap' : 'tap' },
          chosenIds.length < targetCount,
        );
        // completeStep only records the choice. Tap-other activation costs (Drowner of Secrets)
        // actually tap and resume inside applyResolutionStepSideEffects.
        if (ResolutionQueueManager.completeStep(gameId, step.id, tapResponse)) {
          const { applyResolutionStepSideEffects } = await import('../resolution.js');
          await applyResolutionStepSideEffects(io, game, gameId, step, tapResponse);
        }
        debug(1, `[AI] tap_untap_target: selected ${chosenIds.length} target(s)`);
        break;
      }

      case 'counter_movement': {
        const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
        const stepData = step as any;
        const sourceFilter = stepData.sourceFilter || {};
        const targetFilter = stepData.targetFilter || {};

        const source = battlefield.find((perm: any) => {
          if (!perm || typeof perm.id !== 'string') return false;
          if (sourceFilter.controller === 'you' && String(perm.controller) !== String(playerId)) return false;
          const counters = perm.counters || {};
          return Object.keys(counters).some((key) => Number(counters[key] || 0) > 0);
        });

        const counterType = source
          ? Object.keys(source.counters || {}).find((key) => Number(source.counters[key] || 0) > 0) || ''
          : '';

        const target = battlefield.find((perm: any) => {
          if (!perm || typeof perm.id !== 'string') return false;
          if (targetFilter.controller === 'you' && String(perm.controller) !== String(playerId)) return false;
          if (targetFilter.excludeSource && String(perm.id) === String(source?.id || '')) return false;
          return true;
        });

        const selections = source && target && counterType
          ? {
              sourcePermanentId: String(source.id),
              targetPermanentId: String(target.id),
              counterType: String(counterType),
            }
          : { sourcePermanentId: '', targetPermanentId: '', counterType: '' };

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selections, !(source && target && counterType)));
        debug(1, `[AI] counter_movement: source=${selections.sourcePermanentId || 'none'} target=${selections.targetPermanentId || 'none'} counter=${selections.counterType || 'none'}`);
        break;
      }

      case 'counter_target': {
        const validTargets = Array.isArray((step as any)?.validTargets) ? (step as any).validTargets : [];
        const selectedId = String(validTargets[0]?.id || '');
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] counter_target: selected ${selectedId || 'none'}`);
        break;
      }

      case 'station_creature_selection': {
        const creatures = Array.isArray((step as any)?.tapForCountersCreatures)
          ? (step as any).tapForCountersCreatures
          : (Array.isArray((step as any)?.creatures) ? (step as any).creatures : []);
        const selectedId = [...creatures]
          .sort((left: any, right: any) => Number(right?.power || 0) - Number(left?.power || 0))
          .map((creature: any) => String(creature?.id || ''))
          .find(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedId ? [selectedId] : []));
        debug(1, `[AI] station_creature_selection: selected ${selectedId || 'none'}`);
        break;
      }

      case 'life_payment': {
        const minPayment = Number((step as any)?.minPayment ?? 0);
        const maxPayment = Number((step as any)?.maxPayment ?? minPayment);
        const chosen = Number.isFinite(minPayment) ? minPayment : 0;
        const safeChosen = Math.max(0, Math.min(chosen, Number.isFinite(maxPayment) ? maxPayment : chosen));

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(safeChosen));
        debug(1, `[AI] life_payment: selected ${safeChosen}`);
        break;
      }

      case 'additional_cost_payment': {
        const amount = Math.max(0, Number((step as any)?.amount ?? 0));
        const costType = String((step as any)?.costType || 'discard');
        const selectedIds = (costType === 'remove_counters'
          ? (Array.isArray((step as any)?.availableCounters) ? (step as any).availableCounters : [])
              .slice(0, amount)
              .map((entry: any) => String(entry?.id || ''))
              .filter(Boolean)
          : (costType === 'sacrifice'
            ? (() => {
                const targets = Array.isArray((step as any)?.availableTargets)
                  ? [...(step as any).availableTargets]
                  : [];
                const battlefield = Array.isArray((game as any)?.state?.battlefield)
                  ? (game as any).state.battlefield
                  : [];
                const isCommanderTarget = (entry: any): boolean => {
                  if (entry?.isCommander || entry?.commander === true || entry?.card?.isCommander) return true;
                  const id = String(entry?.id || '').trim();
                  if (!id) return false;
                  const perm = battlefield.find((p: any) => p && String(p.id || '') === id);
                  if (!perm) return false;
                  return Boolean(
                    perm.isCommander
                    || perm.commander === true
                    || perm?.card?.isCommander
                    || perm?.card?.commander
                    || (Array.isArray((game as any)?.state?.commanders)
                      && (game as any).state.commanders.some((c: any) => String(c?.permanentId || c?.id || '') === id))
                  );
                };
                // Prefer non-commanders so additional-cost payments do not auto-sac the commander first.
                targets.sort((a: any, b: any) => {
                  const aCmd = isCommanderTarget(a) ? 1 : 0;
                  const bCmd = isCommanderTarget(b) ? 1 : 0;
                  if (aCmd !== bCmd) return aCmd - bCmd;
                  const aId = String(a?.id || '');
                  const bId = String(b?.id || '');
                  const aPerm = battlefield.find((p: any) => p && String(p.id || '') === aId);
                  const bPerm = battlefield.find((p: any) => p && String(p.id || '') === bId);
                  const aCmc = Number(aPerm?.card?.cmc ?? a?.card?.cmc ?? a?.cmc ?? 99);
                  const bCmc = Number(bPerm?.card?.cmc ?? b?.card?.cmc ?? b?.cmc ?? 99);
                  return aCmc - bCmc;
                });
                return targets
                  .slice(0, amount)
                  .map((entry: any) => String(entry?.id || ''))
                  .filter(Boolean);
              })()
            : chooseAIAdditionalCostCardIds(game, playerId, step, amount)));

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedIds));
        debug(1, `[AI] additional_cost_payment: selected ${selectedIds.length} item(s)`);
        break;
      }

      case 'squad_cost_payment': {
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(0));
        debug(1, `[AI] squad_cost_payment: chose 0 additional squad payments`);
        break;
      }
  }
}

