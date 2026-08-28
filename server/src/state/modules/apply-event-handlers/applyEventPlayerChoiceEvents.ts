// server/src/state/modules/apply-event-handlers/applyEventPlayerChoiceEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Rules choices, color/basic-land-type/card-name choices, player selection, votes and option choices.
// Public entry: applyPlayerChoiceEvents(ctx, e) -> true when it handled the event.
//
// Handles: rulesChoiceResolved, colorChoice, basicLandTypeChoice, cardNameChoice, playerChoice, playerSelection, exchangeTextBoxes, voteSubmit, optionChoice
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { drawCards } from "../zones";
import { exchangePermanentOracleText } from "../../utils";
import { syncPreparedPermanentAfterControlChange } from "../prepared.js";
import { clearReplayQueuedSteps, clearReplayQueuedStepById } from "../applyEventReplayZoneCommanderManaHelpers.js";
import { resolveReplayPermanentByEvent } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionStepType } from "../../resolution/index.js";
import { executeTriggeredAbilityEffectWithOracleIR } from "../../../../../rules-engine/src/triggeredAbilities.js";

export function applyPlayerChoiceEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "rulesChoiceResolved": {
        try {
          const controllerId = String((e as any).controllerId || '').trim();
          const sourceId = String((e as any).sourceId || '').trim();
          const sourceName = String((e as any).sourceName || 'Ability').trim() || 'Ability';
          const effectText = String((e as any).effectText || '').trim();
          const rulesChoiceGroupId = String((e as any).rulesChoiceGroupId || '').trim();
          const eventData = ((e as any).eventData || {}) as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            const resolvedStepIds = Array.isArray((e as any).resolvedStepIds)
              ? ((e as any).resolvedStepIds as any[]).map((id: any) => String(id || '').trim()).filter(Boolean)
              : [];
            if (resolvedStepIds.length > 0) {
              for (const resolvedStepId of resolvedStepIds) {
                clearReplayQueuedStepById(replayGameId, resolvedStepId);
              }
            } else if (rulesChoiceGroupId) {
              clearReplayQueuedSteps(replayGameId, (step: any) => String((step as any)?.rulesChoiceGroupId || '').trim() === rulesChoiceGroupId);
            }
          }

          if (!controllerId || !sourceId || !effectText) break;

          const executeResult = executeTriggeredAbilityEffectWithOracleIR(
            ctx.state as any,
            {
              controllerId: controllerId as any,
              sourceId,
              sourceName,
              effect: effectText,
            },
            eventData,
            { allowOptional: true }
          );

          ctx.state = executeResult.state as any;
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(rulesChoiceResolved): failed', err);
        }
        break;
      }
      
      case "colorChoice": {
        // Player chose a color for a permanent or spell (e.g., Brave the Elements)
        try {
          const { permanentId, spellId, color, playerId } = e as any;
          const permanentIdStr = String(permanentId || '').trim();
          const spellIdStr = String(spellId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.COLOR_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentIdStr || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentIdStr) &&
                (!spellIdStr || String((step as any)?.spellId || '').trim() === spellIdStr)
              );
            });
          }

          // Permanent ETB color choices (Thriving lands, Caged Sun, etc.) must win over any
          // stale stack item. Matching `spellId || ''` against empty card ids previously
          // applied Thriving Grove's color onto orphaned commander spells during undo replay.
          if (permanentIdStr) {
            const permanent = resolveReplayPermanentByEvent(ctx, {
              permanentId: permanentIdStr,
              playerId,
              cardName: (e as any).cardName,
            });

            if (permanent && color) {
              (permanent as any).chosenColor = color;
              if (permanent.card && typeof permanent.card === 'object') {
                (permanent.card as any).chosenColor = color;
              }
              const colorWord = String((e as any).colorWord || '').trim().toLowerCase();
              if (colorWord) {
                (permanent as any).chosenColorWord = colorWord;
                if (permanent.card && typeof permanent.card === 'object') {
                  (permanent.card as any).chosenColorWord = colorWord;
                }
              }
              debug(2, `[applyEvent] Applied color choice: ${permanent.card?.name} -> ${color}`);
              ctx.bumpSeq();
              break;
            }
          }

          if (spellIdStr) {
            const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
            const stackItem = stack.find((item: any) =>
              item && (
                String(item.id || '') === spellIdStr
                || String(item.cardId || '') === spellIdStr
                || String(item.card?.id || '') === spellIdStr
              )
            );

            if (stackItem && color) {
              (stackItem as any).chosenColor = color;
              debug(2, `[applyEvent] Applied spell color choice: ${stackItem.card?.name || stackItem.sourceName || spellIdStr} -> ${color}`);
              ctx.bumpSeq();
              break;
            }
          }

          debugWarn(2, `[applyEvent] colorChoice: target not found (permanent=${permanentIdStr}, spell=${spellIdStr})`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(colorChoice): failed", err);
        }
        break;
      }
      
      case "basicLandTypeChoice": {
        try {
          const { permanentId, playerId, basicLandType, cardName } = e as any;
          const permanentIdStr = String(permanentId || '').trim();
          const landType = String(basicLandType || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.BASIC_LAND_TYPE_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentIdStr || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === permanentIdStr)
              );
            });
          }

          if (permanentIdStr && landType) {
            const permanent = resolveReplayPermanentByEvent(ctx, {
              permanentId: permanentIdStr,
              playerId,
              cardName,
            });
            if (permanent) {
              (permanent as any).chosenBasicLandType = landType;
              if (permanent.card && typeof permanent.card === 'object') {
                (permanent.card as any).chosenBasicLandType = landType;
              }
              debug(2, `[applyEvent] Applied basic land type choice: ${permanent.card?.name} -> ${landType}`);
            } else {
              debugWarn(2, `[applyEvent] basicLandTypeChoice: permanent ${permanentIdStr} not found`);
            }
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(basicLandTypeChoice): failed", err);
        }
        break;
      }

      case "cardNameChoice": {
        // Player chose a card name for a permanent or spell.
        try {
          const { playerId, permanentId, spellId, chosenName, cardName } = e as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.CARD_NAME_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === String(permanentId || '').trim()) &&
                (!spellId || String((step as any)?.spellId || '').trim() === String(spellId || '').trim())
              );
            });
          }

          const stack = Array.isArray(ctx.state?.stack) ? ctx.state.stack : [];
          const stackItem = stack.find((item: any) =>
            item && (String(item.id || '') === String(spellId || '') || String(item.cardId || '') === String(spellId || ''))
          );

          if (stackItem && chosenName) {
            (stackItem as any).chosenCardName = chosenName;
            debug(2, `[applyEvent] Applied spell card name choice: ${stackItem.card?.name || stackItem.sourceName || spellId} -> ${chosenName}`);
            ctx.bumpSeq();
            break;
          }

          const permanent = resolveReplayPermanentByEvent(ctx, {
            permanentId,
            playerId,
            cardName,
          });
          
          if (permanent && chosenName) {
            (permanent as any).chosenCardName = chosenName;
            if (permanent.card && typeof permanent.card === 'object') {
              (permanent.card as any).chosenCardName = chosenName;
            }
            debug(2, `[applyEvent] Applied card name choice: ${permanent.card?.name} -> ${chosenName}`);
          } else {
            debugWarn(2, `[applyEvent] cardNameChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(cardNameChoice): failed", err);
        }
        break;
      }
      
      case "playerChoice": {
        // Player chose a player for a permanent (e.g., Xantcha, Curses)
        try {
          const { playerId, permanentId, chosenPlayer } = e as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const resolvedStepType = String((e as any).resolvedStepType || ResolutionStepType.PLAYER_CHOICE).trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String((step as any)?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String((step as any)?.type || '').trim() === resolvedStepType &&
                (!playerId || String((step as any)?.playerId || '').trim() === String(playerId || '').trim()) &&
                (!permanentId || String((step as any)?.permanentId || (step as any)?.sourceId || '').trim() === String(permanentId || '').trim())
              );
            });
          }

          const permanent = resolveReplayPermanentByEvent(ctx, {
            permanentId,
            playerId,
            cardName: (e as any).cardName,
          });
          
          if (permanent && chosenPlayer) {
            (permanent as any).chosenPlayer = chosenPlayer;
            if (permanent.card && typeof permanent.card === 'object') {
              (permanent.card as any).chosenPlayer = chosenPlayer;
            }
            debug(2, `[applyEvent] Applied player choice: ${permanent.card?.name} -> ${chosenPlayer}`);
          } else {
            debugWarn(2, `[applyEvent] playerChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(playerChoice): failed", err);
        }
        break;
      }

      case "playerSelection": {
        try {
          const choosingPlayerId = String((e as any).choosingPlayerId || '');
          const selectedPlayerId = String((e as any).selectedPlayerId || '');
          const effectType = String((e as any).effectType || (e as any).effectData?.type || '');
          const permanentId = String((e as any).permanentId || (e as any).effectData?.permanentId || '');
          const effectData = ((e as any).effectData || {}) as any;
          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          const replayGameId = String((ctx as any).gameId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();

          // Clear the matching resolution prompt(s). Without this, reconnect/replay leaves
          // orphaned PLAYER_CHOICE steps (Humble Defector / control-change activations) that
          // stall AI priority and can pile up into pathological queues.
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            }
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              if (String(step.type || '') !== String(ResolutionStepType.PLAYER_CHOICE)) return false;
              const stepPermanentId = String(step.permanentId || step.sourceId || step.effectData?.permanentId || '').trim();
              if (permanentId && stepPermanentId && stepPermanentId !== permanentId) return false;
              const stepEffectType = String(step.effectData?.type || step.effectType || '').trim();
              if (effectType && stepEffectType && stepEffectType !== effectType) return false;
              if (choosingPlayerId && String(step.playerId || '').trim() && String(step.playerId || '').trim() !== choosingPlayerId) {
                return false;
              }
              return true;
            });
          }

          if (effectType === 'set_chosen_player') {
            if (permanent) {
              (permanent as any).chosenPlayer = selectedPlayerId;
            } else {
              debugWarn(2, `[applyEvent] playerSelection(set_chosen_player): permanent ${permanentId} not found`);
            }
            ctx.bumpSeq();
            break;
          }

          if (effectType === 'control_change') {
            if (permanent) {
              const previousController = String(permanent.controller || '');
              permanent.controller = selectedPlayerId;
              syncPreparedPermanentAfterControlChange(ctx.state, permanent, previousController);
              delete (permanent as any).pendingPlayerSelection;
              delete (permanent as any).pendingControlChange;

              const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
              if (typeLine.includes('creature')) {
                (permanent as any).summoningSickness = true;
              }

              if (effectData.goadsOnChange === true && choosingPlayerId) {
                const goadedBy = (permanent as any).goadedBy || [];
                const goadedUntil = (permanent as any).goadedUntil || {};
                if (!goadedBy.includes(choosingPlayerId)) {
                  (permanent as any).goadedBy = [...goadedBy, choosingPlayerId];
                }
                const persistedGoadExpiryTurn = Number((e as any).goadExpiryTurn ?? 0);
                if (persistedGoadExpiryTurn > 0) {
                  (permanent as any).goadedUntil = {
                    ...goadedUntil,
                    [choosingPlayerId]: persistedGoadExpiryTurn,
                  };
                }
              }

              if (effectData.mustAttackEachCombat === true) {
                (permanent as any).mustAttackEachCombat = true;
              }
              if (effectData.cantAttackOwner === true) {
                (permanent as any).cantAttackOwner = true;
                (permanent as any).ownerId = choosingPlayerId;
              }
              (permanent as any).chosenPlayer = selectedPlayerId;
              if (permanent.card && typeof permanent.card === 'object') {
                (permanent.card as any).chosenPlayer = selectedPlayerId;
              }
            } else {
              debugWarn(2, `[applyEvent] playerSelection(control_change): permanent ${permanentId} not found`);
            }

            const drawCount = Number(effectData.drawCards || 0);
            if (choosingPlayerId && drawCount > 0) {
              drawCards(ctx as any, choosingPlayerId as any, drawCount);
            }

            ctx.bumpSeq();
            break;
          }

          debugWarn(2, `[applyEvent] playerSelection: unsupported effectType ${effectType}`);
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(playerSelection): failed', err);
        }
        break;
      }

      case "exchangeTextBoxes": {
        try {
          const battlefield = ctx.state.battlefield || [];
          const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
          const targetPermanentId = String((e as any).targetPermanentId || '').trim();
          const exchanged = exchangePermanentOracleText(battlefield as any, sourcePermanentId, targetPermanentId);
          if (!exchanged) {
            debugWarn(2, `[applyEvent] exchangeTextBoxes: permanent(s) not found (${sourcePermanentId}, ${targetPermanentId})`);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(exchangeTextBoxes): failed', err);
        }
        break;
      }

      case "voteSubmit": {
        try {
          const voteId = String((e as any).voteId || '').trim();
          const playerId = String((e as any).playerId || '').trim();
          const choice = String((e as any).choice || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const voteCountRaw = Number((e as any).voteCount ?? 1);
          const voteCount = Number.isFinite(voteCountRaw) && voteCountRaw > 0 ? Math.floor(voteCountRaw) : 1;
          const persistedChoices = Array.isArray((e as any).choices)
            ? ((e as any).choices as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          if (!voteId || !playerId || !choice) {
            debugWarn(2, `[applyEvent] voteSubmit: invalid payload voteId=${voteId} playerId=${playerId} choice=${choice}`);
            break;
          }

          const replayGameId = String((ctx as any).gameId || '').trim();
          if (replayGameId) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepId = String(step?.id || '').trim();
              if (resolvedStepId && stepId === resolvedStepId) return true;
              return (
                String(step?.type || '') === String(ResolutionStepType.VOTE) &&
                String(step?.playerId || '').trim() === playerId &&
                String(step?.voteId || '').trim() === voteId
              );
            });
          }

          const stateAny = ctx.state as any;
          stateAny.activeVotes = stateAny.activeVotes || {};

          if (!stateAny.activeVotes[voteId]) {
            stateAny.activeVotes[voteId] = {
              choices: persistedChoices.length > 0 ? [...persistedChoices] : [],
              votes: [],
            };
          }

          const activeVote = stateAny.activeVotes[voteId];
          if (!Array.isArray(activeVote.choices)) {
            activeVote.choices = [];
          }
          if (persistedChoices.length > 0) {
            activeVote.choices = [...persistedChoices];
          }
          if (!activeVote.choices.includes(choice)) {
            activeVote.choices.push(choice);
          }
          if (!Array.isArray(activeVote.votes)) {
            activeVote.votes = [];
          }

          activeVote.votes.push({
            playerId,
            choice,
            voteCount,
          });

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(voteSubmit): failed', err);
        }
        break;
      }
      
      case "optionChoice": {
        // Player chose an option for a permanent (e.g., "flying or first strike")
        try {
          const { permanentId, chosenOption } = e as any;
          const playerId = String((e as any).playerId || '').trim();
          const permanentIdStr = String(permanentId || '').trim();
          const resolvedStepId = String((e as any).resolvedStepId || '').trim();
          const replayGameId = String((ctx as any).gameId || '').trim();
          const chosenOptions = Array.isArray((e as any).chosenOptions)
            ? ((e as any).chosenOptions as any[])
                .map((value: any) => String(value || '').trim())
                .filter((value: string) => value.length > 0)
            : [];

          // Clear the matching OPTION_CHOICE prompt on replay so undo/reload does not
          // leave an orphan choice UI. Live play already completed the step before emit.
          if (replayGameId) {
            if (resolvedStepId) {
              clearReplayQueuedStepById(replayGameId, resolvedStepId);
            } else {
              clearReplayQueuedSteps(replayGameId, (step: any) => {
                if (!step || String(step?.type || '') !== String(ResolutionStepType.OPTION_CHOICE)) return false;
                // Specialized option-choice events clear themselves; do not steal those prompts.
                if (
                  (step as any).myriadChoice === true
                  || (step as any).giftCastChoice === true
                  || (step as any).mdfcFaceChoice === true
                  || (step as any).forceOfWillExileChoice === true
                  || (step as any).legendRuleChoice === true
                  || (step as any).prisonersDilemmaChoice === true
                  || (step as any).optionalPaymentPrompt === true
                ) {
                  return false;
                }
                if (playerId && String(step?.playerId || '') !== playerId) return false;
                const queuedPermanentId = String((step as any).permanentId || (step as any).sourceId || '').trim();
                return !permanentIdStr || queuedPermanentId === permanentIdStr;
              });
            }
          }

          const battlefield = ctx.state.battlefield || [];
          const permanent = battlefield.find((p: any) => p.id === permanentId);
          
          if (permanent) {
            if (chosenOptions.length > 1) {
              delete (permanent as any).chosenOption;
              (permanent as any).chosenOptions = chosenOptions;
              debug(2, `[applyEvent] Applied option choice: ${permanent.card?.name} -> ${chosenOptions.join(', ')}`);
            } else {
              const resolvedChoice = chosenOptions[0] || String(chosenOption || '').trim();
              if (resolvedChoice) {
                delete (permanent as any).chosenOptions;
                (permanent as any).chosenOption = resolvedChoice;
                debug(2, `[applyEvent] Applied option choice: ${permanent.card?.name} -> ${resolvedChoice}`);
              }
            }
          } else {
            debugWarn(2, `[applyEvent] optionChoice: permanent ${permanentId} not found`);
          }
          
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(optionChoice): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
