// server/src/socket/combat-handlers/combatDeclareControlledAttackersRequest.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: nested declareControlledAttackers socket.on body inside
//   registerCombatHandlers.
// Public entry symbols: handleDeclareControlledAttackers.

import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { getAttackTriggersForCreatures } from "../../state/modules/triggers/combat.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if.js";
import { inferTriggeredAbilityTargetMetadata } from "../../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { permanentHasKeyword, permanentHasSummoningSickness } from "../game-actions.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { queueOptionalPaymentStep } from "../optional-payment-prompts.js";
import { broadcastGame, ensureGame } from "../util.js";
import { isCurrentlyCreature } from "./combatLegalityGates.js";
import { persistTriggeredAbilityPush } from "./combatDeclareBlockersRequest.js";
import {
  emitDeclareAttackersChat,
  formatEnergyCost,
  getDefendingPlayerIdFromAttackDeclaration,
  resolveAttackTriggerManaPaymentChoice,
} from "./combatDeclareAttackersSupport.js";
import {
  enqueueSupportedEnlistChoiceSteps,
  enqueueSupportedExertChoiceSteps,
  processTapTriggersForAttackers,
} from "./combatDeclareAttackersForceTapSupport.js";
import { getCombatControl } from "./combatControlState.js";

/**
 * Declare attackers under combat control
 * Used when a player controls combat via Master Warcraft or similar effects
 *
 * Payload:
 * - gameId: string
 * - attackers: Array<{ creatureId: string; targetPlayerId: string }>
 */
export async function handleDeclareControlledAttackers(
  io: Server,
  socket: Socket,
  payload?: {
    gameId?: unknown;
    attackers?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const attackersRaw = payload?.attackers;

  try {
    if (!gameId || typeof gameId !== 'string') {
      socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Missing gameId' } as any);
      return;
    }
    if (!Array.isArray(attackersRaw)) {
      socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Invalid attackers payload' } as any);
      return;
    }

    const attackers = attackersRaw
      .filter((entry: any) => entry && typeof entry === 'object')
      .map((entry: any) => ({
        creatureId: typeof entry.creatureId === 'string' ? entry.creatureId : null,
        targetPlayerId: typeof entry.targetPlayerId === 'string' ? entry.targetPlayerId : null,
      }));
    if (attackers.some((entry) => !entry.creatureId || !entry.targetPlayerId)) {
      socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Invalid attackers payload' } as any);
      return;
    }

    const playerId = (socket.data as any)?.playerId as PlayerID | undefined;
    if (!playerId) {
      socket.emit?.('error', { code: 'CONTROLLED_ATTACKERS_ERROR', message: 'Player not identified' } as any);
      return;
    }

    const socketGameId = (socket.data as any)?.gameId;
    if ((socketGameId && socketGameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' } as any);
      return;
    }

    const game = ensureGame(gameId);
    if (!game) {
      socket.emit?.('error', { code: 'GAME_NOT_FOUND', message: 'Game not found' } as any);
      return;
    }

    const players = ((game.state as any)?.players || []) as any[];
    const me = players.find((p: any) => p?.id === playerId);
    if (!me || me?.spectator || me?.isSpectator) {
      socket.emit?.('error', { code: 'NOT_AUTHORIZED', message: 'Not authorized.' } as any);
      return;
    }

    // Verify player has combat control
    const combatControl = getCombatControl(game);
    if (!combatControl || combatControl.controllerId !== playerId) {
      socket.emit("error", {
        code: "NO_COMBAT_CONTROL",
        message: "You don't have combat control",
      });
      return;
    }

    if (!combatControl.controlsAttackers) {
      socket.emit("error", {
        code: "NO_ATTACKER_CONTROL",
        message: "You don't control attacker declarations",
      });
      return;
    }

    const battlefield = game.state?.battlefield || [];
    const attackerIds: string[] = [];
    
    // Validate and set up each attacker
    for (const attacker of attackers) {
      const creature = battlefield.find((perm: any) => 
        perm.id === attacker.creatureId
      );
      
      if (!creature) {
        socket.emit("error", {
          code: "INVALID_ATTACKER",
          message: `Creature ${attacker.creatureId} not found`,
        });
        return;
      }

      // Check if permanent is a creature (includes devotion check for Gods)
      if (!isCurrentlyCreature(creature, battlefield, playerId)) {
        socket.emit("error", {
          code: "NOT_A_CREATURE",
          message: `${(creature as any).card?.name || "This permanent"} is not a creature`,
        });
        return;
      }

      // Check if creature can attack (not tapped, no summoning sickness unless haste)
      if ((creature as any).tapped) {
        socket.emit("error", {
          code: "CREATURE_TAPPED",
          message: `${(creature as any).card?.name || "Creature"} is tapped and cannot attack`,
        });
        return;
      }

      // Check defender keyword
      const oracleText = ((creature as any).card?.oracle_text || "").toLowerCase();
      if (oracleText.includes("defender")) {
        socket.emit("error", {
          code: "HAS_DEFENDER",
          message: `${(creature as any).card?.name || "Creature"} has defender and cannot attack`,
        });
        return;
      }

      // Check summoning sickness
      if (permanentHasSummoningSickness(creature, battlefield, playerId)) {
        socket.emit("error", {
          code: "SUMMONING_SICKNESS",
          message: `${(creature as any).card?.name || "Creature"} has summoning sickness`,
        });
        return;
      }

      attackerIds.push(attacker.creatureId);
      
      // Mark creature as attacking
      (creature as any).attacking = attacker.targetPlayerId;
      
      // Tap the attacker (unless it has vigilance)
      const hasVigilance = permanentHasKeyword(creature, battlefield, playerId, 'vigilance');
      if (!hasVigilance) {
        (creature as any).tapped = true;
      }
    }

    try {
      enqueueSupportedExertChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
      enqueueSupportedEnlistChoiceSteps(gameId, battlefield as any[], String(playerId), attackerIds.map((id) => String(id)));
    } catch (e) {
      debugWarn(1, '[combat] Failed to enqueue controlled attack-time choice steps:', e);
    }

    // Process tap triggers for creatures that became tapped from attacking
    processTapTriggersForAttackers(io, game, gameId, attackers, battlefield, playerId);

    // Update combat state
    game.state.combat = {
      ...game.state.combat!,
      phase: 'declareAttackers',
      attackers: attackers.map(a => ({
        permanentId: a.creatureId,
        defending: a.targetPlayerId,
        blockedBy: [],
      })),
    };

    // Persist the event
    try {
      await appendEvent(gameId, (game as any).seq || 0, "declareControlledAttackers", {
        playerId,
        attackers,
        combatControl: combatControl.sourceName,
      });
    } catch (e) {
      debugWarn(1, "[combat] Failed to persist declareControlledAttackers event:", e);
    }

    emitDeclareAttackersChat(
      io,
      gameId,
      game,
      playerId,
      attackers,
      `🎯 ${combatControl.sourceName}: `,
    );

    // Process attack triggers for controlled combat declarations
    try {
      const attackingCreatures = battlefield.filter((perm: any) => attackerIds.includes(perm.id));
      const firstDefender = getDefendingPlayerIdFromAttackDeclaration(attackers, battlefield);

      if (attackingCreatures.length > 0 && firstDefender) {
        const ctx = {
          state: game.state,
          bumpSeq: () => {
            if (typeof (game as any).bumpSeq === "function") {
              (game as any).bumpSeq();
            }
          }
        };

        const triggers = orderTriggersByAPNAP(
          ctx as any,
          getAttackTriggersForCreatures(
            ctx as any,
            attackingCreatures,
            playerId,
            firstDefender
          ).map((trigger, originalIndex) => ({
            controllerId: String((trigger as any).controllerId || playerId || ''),
            originalIndex,
            trigger,
          }))
        ).map((entry: any) => entry.trigger);

        if (triggers.length > 0) {
          debug(2, `[combat] Found ${triggers.length} controlled attack trigger(s) for game ${gameId}`);

          for (const trigger of triggers) {
            const triggerControllerId = ((trigger as any).controllerId || playerId) as PlayerID;
            try {
              const controller = String(triggerControllerId);
              const sourcePerm = battlefield.find((p: any) => p?.id === (trigger as any).permanentId);

              const raw = String(trigger.description || (trigger as any).effect || '').trim();
              let textForEval = raw;
              const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
              if (!hasTriggerPrefix) {
                const oracleLower = String(sourcePerm?.card?.oracle_text || '').toLowerCase();
                if (oracleLower.includes('attacks a player')) {
                  textForEval = `Whenever ~ attacks a player, ${textForEval}`;
                } else {
                  textForEval = `Whenever ~ attacks, ${textForEval}`;
                }
              }

              const valueObj = (trigger as any).value && typeof (trigger as any).value === 'object' ? (trigger as any).value : undefined;
              const defendingPlayerId = String(
                valueObj?.defendingPlayerId ||
                  valueObj?.defendingPlayer ||
                  (sourcePerm && typeof (sourcePerm as any).attacking === 'string' ? (sourcePerm as any).attacking : '') ||
                  firstDefender ||
                  ''
              );

              const needsThatPlayerRef = /\bthat player\b/i.test(textForEval);

              const ok = isInterveningIfSatisfied(
                ctx as any,
                controller,
                textForEval,
                sourcePerm,
                defendingPlayerId
                  ? {
                      defendingPlayerId,
                      thoseCreatureIds: attackerIds,
                      ...(needsThatPlayerRef
                        ? {
                            thatPlayerId: defendingPlayerId,
                            referencedPlayerId: defendingPlayerId,
                            theirPlayerId: defendingPlayerId,
                          }
                        : {}),
                    }
                  : undefined
              );
              if (ok === false) {
                debug(2, `[combat] Skipping controlled attack trigger due to unmet intervening-if: ${trigger.cardName} - ${trigger.description}`);
                continue;
              }
            } catch {
              // Conservative fallback: keep the trigger if evaluation fails.
            }

            if ((trigger.manaCost || (trigger as any).energyCost) && !trigger.mandatory) {
              const permanent = battlefield.find((p: any) => p?.id === trigger.permanentId);
              const cardImageUrl =
                permanent?.card?.image_uris?.small || permanent?.card?.image_uris?.normal;
              const energyCost = Number((trigger as any).energyCost || 0);
              const paymentCost = energyCost > 0 ? formatEnergyCost(energyCost) : String(trigger.manaCost || '');
              const validationKind = energyCost > 0 ? 'energy' : 'mana';
              const payChoiceId = energyCost > 0 ? 'pay_energy' : 'pay_mana';

              queueOptionalPaymentStep(gameId, {
                playerId: triggerControllerId,
                sourceId: String(trigger.permanentId || ''),
                sourceName: trigger.cardName,
                sourceImage: cardImageUrl,
                description: trigger.description || `${trigger.cardName}: You may pay ${paymentCost}.`,
                mandatory: false,
                minSelections: 0,
                maxSelections: 1,
                priority: -1,
                payChoiceId,
                payLabel: `Pay ${paymentCost}`,
                payDescription: `If you do: ${trigger.effect || 'resolve effect'}`,
                declineChoiceId: 'decline',
                declineLabel: 'Decline',
                declineDescription: 'Do not pay the optional cost.',
                validationKind,
                manaCost: energyCost > 0 ? undefined : trigger.manaCost,
                energyAmount: energyCost > 0 ? energyCost : undefined,
                stepData: {
                  attackTriggerManaPaymentChoice: true,
                  permanentId: trigger.permanentId,
                  cardName: trigger.cardName,
                  manaCost: energyCost > 0 ? undefined : trigger.manaCost,
                  energyCost: energyCost > 0 ? energyCost : undefined,
                  effect: trigger.effect,
                  triggerDescription: trigger.description,
                },
                onPay: async () => {
                  resolveAttackTriggerManaPaymentChoice(
                    io,
                    game,
                    gameId,
                    triggerControllerId as any,
                    {
                      permanentId: String(trigger.permanentId || ''),
                      cardName: String(trigger.cardName || ''),
                      effect: String(trigger.effect || ''),
                      manaCost: String(trigger.manaCost || paymentCost || ''),
                      energyCost: energyCost > 0 ? energyCost : undefined,
                      description: String(trigger.description || ''),
                    },
                    true
                  );
                },
                onDecline: async () => {
                  resolveAttackTriggerManaPaymentChoice(
                    io,
                    game,
                    gameId,
                    triggerControllerId as any,
                    {
                      permanentId: String(trigger.permanentId || ''),
                      cardName: String(trigger.cardName || ''),
                      effect: String(trigger.effect || ''),
                      manaCost: String(trigger.manaCost || paymentCost || ''),
                      energyCost: energyCost > 0 ? energyCost : undefined,
                      description: String(trigger.description || ''),
                    },
                    false
                  );
                },
              });

              debug(
                2,
                `[combat] Enqueued controlled attack trigger mana payment choice for ${trigger.cardName}: ${trigger.manaCost} to ${trigger.effect}`
              );
            } else {
              game.state.stack = game.state.stack || [];
              const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
              const triggerEffectText = String((trigger as any).effect || trigger.description || '').trim();
              const targetMetadata = inferTriggeredAbilityTargetMetadata(triggerEffectText || String(trigger.description || ''), {
                gameState: game.state,
                controllerId: String(triggerControllerId),
                sourceName: String(trigger.cardName || sourcePerm?.card?.name || ''),
                sourcePermanent: sourcePerm,
              } as any);
              const stackItem: any = {
                id: triggerId,
                type: 'triggered_ability',
                controller: triggerControllerId,
                source: trigger.permanentId,
                permanentId: trigger.permanentId,
                sourceName: trigger.cardName,
                description: trigger.description,
                effect: triggerEffectText,
                triggerType: trigger.triggerType,
                mandatory: trigger.mandatory,
                triggeringPlayer: playerId,
                ...(targetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                ...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),
                ...(targetMetadata.targetConstraint ? { targetConstraint: targetMetadata.targetConstraint } : null),
                ...(targetMetadata.targetZone ? { targetZone: targetMetadata.targetZone } : null),
                ...(targetMetadata.targetDestination ? { targetDestination: targetMetadata.targetDestination } : null),
                ...(targetMetadata.targetGraveyardScope ? { targetGraveyardScope: targetMetadata.targetGraveyardScope } : null),
                ...(targetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
                ...(targetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: targetMetadata.battlefieldControllerMode } : null),
                ...(targetMetadata.battlefieldCounters ? { battlefieldCounters: targetMetadata.battlefieldCounters } : null),
                ...(targetMetadata.targetAction ? { targetAction: targetMetadata.targetAction } : null),
                ...(Array.isArray(targetMetadata.targetFilterTypes) ? { targetFilterTypes: targetMetadata.targetFilterTypes } : null),
                ...(Array.isArray(targetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: targetMetadata.targetFilterRequiredTypeWords } : null),
                ...(Array.isArray(targetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: targetMetadata.targetFilterExcludeTypes } : null),
                ...(targetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
                ...(typeof targetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: targetMetadata.targetFilterExactManaValue } : null),
                ...(typeof targetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: targetMetadata.targetFilterMinManaValue } : null),
                ...(typeof targetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: targetMetadata.targetFilterMaxManaValue } : null),
                ...(typeof targetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: targetMetadata.targetTotalPowerLimit } : null),
                ...(targetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
                ...(targetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
                ...(typeof targetMetadata.minTargets === 'number' ? { minTargets: targetMetadata.minTargets } : null),
                ...(typeof targetMetadata.maxTargets === 'number' ? { maxTargets: targetMetadata.maxTargets } : null),
              };

              if (typeof trigger.value === 'number') {
                stackItem.value = trigger.value;
              } else if (typeof trigger.value === 'object') {
                stackItem.effectData = trigger.value;
              }

              const effectData = stackItem.effectData && typeof stackItem.effectData === 'object' ? stackItem.effectData : undefined;
              const defendingPlayerId = String(
                (effectData as any)?.defendingPlayerId ||
                  (effectData as any)?.defendingPlayer ||
                  (sourcePerm && typeof (sourcePerm as any).attacking === 'string' ? (sourcePerm as any).attacking : '') ||
                  firstDefender ||
                  ''
              );
              if (defendingPlayerId) {
                stackItem.defendingPlayer = defendingPlayerId;
                stackItem.targetPlayer = defendingPlayerId;
                if (effectData) {
                  (effectData as any).defendingPlayer = (effectData as any).defendingPlayer || defendingPlayerId;
                  (effectData as any).defendingPlayerId = (effectData as any).defendingPlayerId || defendingPlayerId;
                }
              }
              const attackingPlayerId = String(
                (effectData as any)?.attackingPlayerId
                  || ((trigger.triggerType as string) === 'player_attacks_your_opponent' ? playerId : ''),
              ).trim();
              if (attackingPlayerId) {
                stackItem.attackingPlayerId = attackingPlayerId;
                if (effectData) {
                  (effectData as any).attackingPlayerId = (effectData as any).attackingPlayerId || attackingPlayerId;
                } else {
                  stackItem.effectData = { attackingPlayerId, defendingPlayerId: defendingPlayerId || undefined };
                }
              }

              game.state.stack.push(stackItem);
              persistTriggeredAbilityPush(gameId, game, {
                triggerId,
                sourceId: trigger.permanentId,
                permanentId: trigger.permanentId,
                sourceName: trigger.cardName,
                controllerId: triggerControllerId,
                description: trigger.description,
                triggerType: trigger.triggerType,
                effect: String((trigger as any).effect || trigger.description || '').trim(),
                mandatory: trigger.mandatory,
                triggeringPlayer: playerId,
                ...(targetMetadata.requiresTarget ? { requiresTarget: true, needsTargetSelection: true } : null),
                ...(targetMetadata.targetType ? { targetType: targetMetadata.targetType } : null),
                ...(targetMetadata.targetConstraint ? { targetConstraint: targetMetadata.targetConstraint } : null),
                ...(targetMetadata.targetZone ? { targetZone: targetMetadata.targetZone } : null),
                ...(targetMetadata.targetDestination ? { targetDestination: targetMetadata.targetDestination } : null),
                ...(targetMetadata.targetGraveyardScope ? { targetGraveyardScope: targetMetadata.targetGraveyardScope } : null),
                ...(targetMetadata.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
                ...(targetMetadata.battlefieldControllerMode ? { battlefieldControllerMode: targetMetadata.battlefieldControllerMode } : null),
                ...(targetMetadata.battlefieldCounters ? { battlefieldCounters: targetMetadata.battlefieldCounters } : null),
                ...(targetMetadata.targetAction ? { targetAction: targetMetadata.targetAction } : null),
                ...(Array.isArray(targetMetadata.targetFilterTypes) ? { targetFilterTypes: targetMetadata.targetFilterTypes } : null),
                ...(Array.isArray(targetMetadata.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: targetMetadata.targetFilterRequiredTypeWords } : null),
                ...(Array.isArray(targetMetadata.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: targetMetadata.targetFilterExcludeTypes } : null),
                ...(targetMetadata.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
                ...(typeof targetMetadata.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: targetMetadata.targetFilterExactManaValue } : null),
                ...(typeof targetMetadata.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: targetMetadata.targetFilterMinManaValue } : null),
                ...(typeof targetMetadata.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: targetMetadata.targetFilterMaxManaValue } : null),
                ...(typeof targetMetadata.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: targetMetadata.targetTotalPowerLimit } : null),
                ...(targetMetadata.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
                ...(targetMetadata.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
                ...(typeof targetMetadata.minTargets === 'number' ? { minTargets: targetMetadata.minTargets } : null),
                ...(typeof targetMetadata.maxTargets === 'number' ? { maxTargets: targetMetadata.maxTargets } : null),
                ...(typeof stackItem.value !== 'undefined' ? { value: stackItem.value } : {}),
                ...(stackItem.effectData && typeof stackItem.effectData === 'object' ? { effectData: stackItem.effectData } : {}),
                ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : {}),
                ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : {}),
              }, `controlled attack ${trigger.triggerType || 'trigger'}`);

              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `⚡ ${trigger.cardName}'s triggered ability: ${trigger.description}`,
                ts: Date.now(),
              });
            }
          }
        }
      }
    } catch (triggerErr) {
      debugWarn(1, "[combat] Error processing controlled attack triggers:", triggerErr);
    }

    if (typeof (game as any).bumpSeq === "function") {
      (game as any).bumpSeq();
    }

    broadcastGame(io, game, gameId);

    debug(2, `[combat] Player ${playerId} declared ${attackers.length} controlled attackers in game ${gameId}`);
    
  } catch (err: any) {
    debugError(1, `[combat] declareControlledAttackers error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "CONTROLLED_ATTACKERS_ERROR",
      message: err?.message ?? String(err),
    });
  }
}
