import { castThisTurnAttackRestrictionReason } from "./combatBatch34AttackRestrictions.js"; // B34
import { controlCountAttackRestrictionReason } from "./combatBatch33AttackRestrictions.js"; // B33 count
import { nonTypeCreaturesCantAttackReason } from "./combatBatch33AttackRestrictions.js"; // B33
import { defenderAttackTargetRestrictionReason } from "./combatDefenderAttackPermission.js";
// server/src/socket/combat-handlers/combatDeclareAttackersSupport.ts
// Origin parent: server/src/socket/combat.ts
// Cluster moved: declare-attackers support helpers that handleDeclareAttackers /
//   executeDeclareAttackers close over - defender labels and chat, defending-player
//   id resolution, owner-attack restriction predicates, optional attack-trigger
//   mana/energy payment (pushPaid + resolveAttackTriggerManaPaymentChoice), and
//   processAttackTriggersAfterDeclaration.
// Public entry symbols: emitDeclareAttackersChat, getDefendingPlayerIdFromAttackDeclaration,
//   resolveDefendingPlayerIdForAttackTarget, formatEnergyCost, getOwnerAttackRestrictionReason,
//   isAttackingOwnerPlaneswalker, hasLegalMustAttackDefender,
//   resolveAttackTriggerManaPaymentChoice, processAttackTriggersAfterDeclaration,
//   PendingAttackTriggerManaPayment.
// handleDeclareAttackers stays in combat.ts for a later session.

import type { Server } from "socket.io";
import { formatEnergyCost, resolveAttackTriggerManaPaymentChoice } from "./combatAttackTriggerManaPayment.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { formatDeclareAttackersMessage } from "../../../../shared/src/gameLogFormat.js";
import { getIllegalDefendingPlayerRestriction } from "../../../../rules-engine/src/attackRestrictionText.js";
import { getDefendingLandAttackRestrictionReason } from "./combatDefendingLandRestriction.js";
import { graveyardCountAttackRestrictionReason } from "./combatBatch30AttackRestrictions.js"; // B30
import { playerIsLegalAttackTarget } from "../../../../rules-engine/src/playerInGameStatus.js";
import { getAttackTriggersForCreatures } from "../../state/modules/triggers/combat.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { queueOptionalPaymentStep } from "../optional-payment-prompts.js";
import { inferTriggeredAbilityTargetMetadata } from "../../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { getPlayerName } from "../util.js";
import {
  lookupBattlefieldPermanentName,
  persistTriggeredAbilityPush,
} from "./combatDeclareBlockersRequest.js";

function lookupDefenderLabel(
  game: any,
  battlefield: any[],
  targetPlayerId?: string,
  targetPermanentId?: string,
): string {
  if (targetPermanentId) {
    const permanent = battlefield.find((entry: any) => entry?.id === targetPermanentId);
    const name = permanent?.card?.name || permanent?.card?.card_faces?.[0]?.name || 'Permanent';
    const controllerId = permanent?.controller;
    if (controllerId) {
      const controllerName = getPlayerName(game, controllerId);
      return controllerName ? `${name} (${controllerName}'s)` : name;
    }
    return name;
  }
  if (targetPlayerId) return getPlayerName(game, targetPlayerId);
  return 'an opponent';
}

export function emitDeclareAttackersChat(
  io: Server,
  gameId: string,
  game: any,
  playerId: PlayerID,
  attackers: Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
  prefix?: string,
): void {
  const battlefield = game.state?.battlefield || [];
  const message = formatDeclareAttackersMessage(
    getPlayerName(game, playerId),
    attackers,
    (creatureId) => lookupBattlefieldPermanentName(battlefield, creatureId),
    (targetPlayerId, targetPermanentId) => lookupDefenderLabel(game, battlefield, targetPlayerId, targetPermanentId),
  );
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: prefix ? `${prefix}${message}` : message,
    ts: Date.now(),
  });
}

export function getDefendingPlayerIdFromAttackDeclaration(
  attackers: Array<{ targetPlayerId?: string; targetPermanentId?: string }>,
  battlefield: any[],
): string | undefined {
  const first = attackers[0];
  if (!first) return undefined;
  return resolveDefendingPlayerIdForAttackTarget(first, battlefield) || undefined;
}

export function resolveDefendingPlayerIdForAttackTarget(
  attacker: { targetPlayerId?: string; targetPermanentId?: string },
  battlefield: any[],
  players?: any[],
): string | undefined {
  const playerIds = new Set(
    (Array.isArray(players) ? players : [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean),
  );

  const targetPlayerId = String(attacker.targetPlayerId || '').trim();
  if (targetPlayerId) {
    if (playerIds.size === 0 || playerIds.has(targetPlayerId)) return targetPlayerId;
    const targetPerm = battlefield.find((perm: any) => String(perm?.id || '') === targetPlayerId);
    if (targetPerm?.controller) return String(targetPerm.controller);
  }

  const targetPermanentId = String(attacker.targetPermanentId || '').trim();
  if (targetPermanentId) {
    const targetPerm = battlefield.find((perm: any) => String(perm?.id || '') === targetPermanentId);
    if (targetPerm?.controller) return String(targetPerm.controller);
  }

  return undefined;
}

export {
  formatEnergyCost,
  resolveAttackTriggerManaPaymentChoice,
  type PendingAttackTriggerManaPayment,
} from "./combatAttackTriggerManaPayment.js";

export function getOwnerAttackRestrictionReason(
  creature: any,
  defendingPlayerId?: string,
  options?: { targetIsOwnerPlaneswalker?: boolean; battlefield?: readonly any[]; gameState?: unknown },
): string | null {
  if (options?.battlefield) {
    const defenderReason = defenderAttackTargetRestrictionReason(creature, defendingPlayerId, options.battlefield, options.gameState);
    if (defenderReason) return defenderReason;
    const landReason = getDefendingLandAttackRestrictionReason(creature, defendingPlayerId, options.battlefield);
    if (landReason) return landReason;
    const graveyardReason = graveyardCountAttackRestrictionReason(creature, options.gameState); // B30
    if (graveyardReason) return graveyardReason;
    const b33NonTypeReason = nonTypeCreaturesCantAttackReason(creature, options.battlefield); // B33
    if (b33NonTypeReason) return b33NonTypeReason;
    const b33CountReason = controlCountAttackRestrictionReason(creature, defendingPlayerId, options.battlefield); // B33
    if (b33CountReason) return b33CountReason;
    const b34CastGate = castThisTurnAttackRestrictionReason(creature, options.gameState); // B34
    if (b34CastGate) return b34CastGate;
  }
  const restriction = getIllegalDefendingPlayerRestriction({
    oracleText: String(creature?.card?.oracle_text || creature?.oracle_text || ''),
    ownerId: creature?.owner || creature?.ownerId,
    controllerId: creature?.controller,
    defendingPlayerId,
    cantAttackOwner: Boolean(creature?.cantAttackOwner),
    targetIsOwnerPlaneswalker: options?.targetIsOwnerPlaneswalker === true,
  });
  return restriction.illegal ? String(restriction.reason || "This creature can't attack its owner") : null;
}

export function isAttackingOwnerPlaneswalker(creature: any, attacker: any, battlefield: any[]): boolean {
  const targetPermanentId = String(attacker?.targetPermanentId || '').trim();
  if (!targetPermanentId) return false;
  const target = battlefield.find((perm: any) => String(perm?.id || '') === targetPermanentId);
  if (!target) return false;
  const typeLine = String(target?.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('planeswalker')) return false;
  const ownerId = String(creature?.owner || creature?.ownerId || '').trim();
  return Boolean(ownerId) && String(target.controller || '') === ownerId;
}

export function hasLegalMustAttackDefender(permanent: any, playerId: string, players: any[], gameState?: unknown): boolean {
  if (gameState && graveyardCountAttackRestrictionReason(permanent, gameState)) return false; // UI31 graveyard gate
  return (Array.isArray(players) ? players : [])
    .filter((player: any) => playerIsLegalAttackTarget(player, playerId))
    .some((player: any) => !getOwnerAttackRestrictionReason(permanent, String(player.id)));
}

export function processAttackTriggersAfterDeclaration(
  io: Server,
  game: any,
  gameId: string,
  playerId: PlayerID,
  attackerIds: string[],
  resolvedAttackers: Array<{ creatureId: string; targetPlayerId?: string; targetPermanentId?: string }>,
): void {
  const battlefield = game.state?.battlefield || [];
  try {
    const attackingCreatures = battlefield.filter((perm: any) => 
      attackerIds.includes(perm.id)
    );
    
    const firstDefender = getDefendingPlayerIdFromAttackDeclaration(
      resolvedAttackers,
      battlefield,
    );

    if (attackingCreatures.length > 0 && firstDefender) {
      // Create a minimal context for trigger detection
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
      
      // Push triggers to stack and notify clients
      if (triggers.length > 0) {
        debug(2, `[combat] Found ${triggers.length} attack trigger(s) for game ${gameId}`);
        
        for (const trigger of triggers) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          const triggerControllerId = ((trigger as any).controllerId || playerId) as PlayerID;
          try {
            const controller = String(triggerControllerId);
            const sourcePerm = battlefield.find((p: any) => p?.id === (trigger as any).permanentId);

            const raw = String(trigger.description || (trigger as any).effect || '').trim();
            let textForEval = raw;
            const hasTriggerPrefix = /^(?:when|whenever|at)\b/i.test(textForEval);
            if (!hasTriggerPrefix) {
              // Attack triggers are commonly stored as post-comma fragments.
              // Wrap to enable intervening-if extraction.
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
              debug(2, `[combat] Skipping attack trigger due to unmet intervening-if: ${trigger.cardName} - ${trigger.description}`);
              continue;
            }
          } catch {
            // Conservative fallback: keep the trigger if evaluation fails.
          }

          // Check if this is an optional mana or energy payment trigger
          if ((trigger.manaCost || (trigger as any).energyCost) && !trigger.mandatory) {
            // Don't auto-push to stack - instead enqueue a Resolution Queue prompt
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
              `[combat] Enqueued attack trigger mana payment choice for ${trigger.cardName}: ${trigger.manaCost} to ${trigger.effect}`
            );
          } else {
            // Regular trigger - push onto stack immediately
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
              ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),
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
            
            // Add value or effectData based on type
            if (typeof trigger.value === 'number') {
              stackItem.value = trigger.value;
            } else if (typeof trigger.value === 'object') {
              stackItem.effectData = trigger.value;
            }

            // Preserve "that player" context (common on "attacks a player" templates).
            // Prefer explicit metadata, then the attacking permanent's target, then the first defender.
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
              ...(targetMetadata.targetCombatRole ? { targetCombatRole: targetMetadata.targetCombatRole } : null),
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
            }, `attack ${trigger.triggerType || 'trigger'}`);

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
    debugWarn(1, '[combat] Error processing attack triggers:', triggerErr);
  }
}
