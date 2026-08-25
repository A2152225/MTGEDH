/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handler for equipAbility.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handleEquipAbilityRequest.
 */
import type { Server, Socket } from "socket.io";
import { appendEvent } from "../../db";
import { adjustActivationManaCostForPayment } from "../../state/modules/ability-cost-adjustments.js";
import { countArtifacts, hasMetalcraft } from "../../state/modules/game-state-effects";
import { serializeAbilityActivatedTriggeredStackItem, triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, calculateTotalAvailableMana, consumeManaFromPool, ensureGame, getOrInitManaPool, getPlayerName, parseManaCost, validateManaPayment } from "../util";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

export async function handleEquipAbilityRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: {
    gameId?: unknown;
    equipmentId?: unknown;
    targetCreatureId?: unknown;
    paymentConfirmed?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const equipmentId = payload?.equipmentId;
  const targetCreatureId = payload?.targetCreatureId;
  const paymentConfirmed = payload?.paymentConfirmed;

  if (!gameId || typeof gameId !== 'string') return;
  if (!equipmentId || typeof equipmentId !== 'string') return;
  if (!(targetCreatureId === undefined || typeof targetCreatureId === 'string')) return;
  if (!(paymentConfirmed === undefined || typeof paymentConfirmed === 'boolean')) return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    const spectator = !!(
      (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
    );
    if (!game || !playerId || spectator) return;

    if (!ensureInGameRoom(gameId)) return;

    const battlefield = game.state?.battlefield || [];
    const equipment = battlefield.find((p: any) => p.id === equipmentId);
    
    if (!equipment) {
      socket.emit("error", { code: "NOT_FOUND", message: "Equipment not found" });
      return;
    }

    // Check if player controls the equipment
    if (equipment.controller !== playerId) {
      socket.emit("error", { code: "NOT_CONTROLLER", message: "You do not control this equipment" });
      return;
    }

    const oracleText = (equipment.card?.oracle_text || "").toLowerCase();
    const typeLine = (equipment.card?.type_line || "").toLowerCase();
    
    // Check if its actually equipment
    if (!typeLine.includes("equipment")) {
      socket.emit("error", { code: "NOT_EQUIPMENT", message: "This permanent is not equipment" });
      return;
    }

    // Detect special attach abilities (like Bloodthirsty Blade) that target opponent creatures
    // Pattern: "{X}: Attach ~ to target creature an opponent controls"
    const specialAttachMatch = oracleText.match(/\{([^}]+)\}:\s*attach[^.]*(?:creature\s+an?\s+opponent|opponent[^.]*creature)/i);
    const targetsOpponentCreatures = !!specialAttachMatch;
    
    // Parse equip cost from oracle text
    // First check for special attach ability, then fall back to standard equip
    let equipCost: string;
    if (specialAttachMatch) {
      equipCost = `{${specialAttachMatch[1]}}`;
      debug(2, `[equipAbility] Detected special attach ability targeting opponent creatures: ${equipCost}`);
    } else {
      // Supports patterns like: "Equip {2}", "Equip {1}{W}", "EquipG��Pay 3 life"
      const equipCostMatch = oracleText.match(/equip\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
      equipCost = equipCostMatch ? equipCostMatch[1] : "{0}";
    }
    
    // Check for Puresteel Paladin metalcraft effect (equip costs {0})
    // Use centralized hasMetalcraft from game-state-effects
    // Note: Metalcraft only applies to standard equip, not special attach abilities
    const hasMetalcraftEquipReduction = !targetsOpponentCreatures && battlefield.some((p: any) => {
      if (p.controller !== playerId) return false;
      const pOracle = (p.card?.oracle_text || '').toLowerCase();
      // Puresteel Paladin: "Metalcraft G�� Equipment you control have equip {0}"
      return pOracle.includes('metalcraft') && 
             pOracle.includes('equipment') && 
             pOracle.includes('equip') && 
             pOracle.includes('{0}');
    });
    
    if (hasMetalcraftEquipReduction) {
      // Check if metalcraft is active using centralized function
      if (hasMetalcraft(game as any, playerId)) {
        equipCost = '{0}';
        debug(2, `[equipAbility] Metalcraft active (${countArtifacts(game as any, playerId)} artifacts) - equip cost reduced to {0}`);
      }
    }

    if (!targetCreatureId) {
      // No target specified - send list of valid targets
      const validTargets = battlefield.filter((p: any) => {
        // For special attach abilities (like Bloodthirsty Blade), target opponent creatures
        // For standard equip, target own creatures
        if (targetsOpponentCreatures) {
          if (p.controller === playerId) return false; // Must be opponent's creature
        } else {
          if (p.controller !== playerId) return false; // Must be own creature
        }
        if (p.crewed === true) return true;
        if (Array.isArray(p.grantedTypes)
          && p.grantedTypes.some((t: any) => String(t || '').toLowerCase() === 'creature')) {
          return true;
        }
        if (p.animated === true || p.isCreature === true) return true;
        const pTypeLine = (p.card?.type_line || "").toLowerCase();
        if (/\bvehicle\b/.test(pTypeLine) && !/\bcreature\b/.test(pTypeLine)) return false;
        return pTypeLine.includes("creature");
      });

      const activatedAbilityText = `Equip ${equipCost}`;

      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId,
        prompt: `Choose a creature to equip with ${equipment.card?.name || 'Equipment'}.`,
        description: `Choose a creature to equip ${equipment.card?.name || 'Equipment'} to (${targetsOpponentCreatures ? 'attach to target creature an opponent controls ' : 'equip '}${equipCost}).`,
        sourceId: equipmentId,
        sourceName: equipment.card?.name || 'Equipment',
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          type: 'permanent' as const,
          name: c.card?.name || 'Creature',
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          typeLine: c.card?.type_line,
          controller: c.controller,
        })),
        minTargets: 1,
        maxTargets: 1,
        targetTypes: ['creature'],
        targetDescription: targetsOpponentCreatures ? 'creature an opponent controls' : 'creature you control',
        battlefieldAbilityTargetSelection: true,
        permanentId: equipmentId,
        cardName: equipment.card?.name || 'Equipment',
        abilityId: 'equip',
        abilityText: activatedAbilityText,
        activatedAbilityText,
        abilityType: 'equip',
        equipmentId,
        equipCost,
        equipType: targetsOpponentCreatures ? 'opponent' : 'standard',
      } as any);

      debug(2, `[equipAbility] Enqueued Resolution Queue target selection for ${equipment.card?.name || "Equipment"}`);
      return;
    }

    const targetCreatureIdStr = targetCreatureId as string;

    // Target specified - check if we need to prompt for payment
    const targetCreature = battlefield.find((p: any) => p.id === targetCreatureIdStr);
    if (!targetCreature) {
      socket.emit("error", { code: "TARGET_NOT_FOUND", message: "Target creature not found" });
      return;
    }

    // Check target validity based on whether this is a special attach ability or standard equip
    if (targetsOpponentCreatures) {
      // For special attach abilities (like Bloodthirsty Blade), target must be opponent's creature
      if (targetCreature.controller === playerId) {
        socket.emit("error", { code: "INVALID_TARGET", message: "This ability can only target opponent creatures" });
        return;
      }
    } else {
      // For standard equip, target must be player's own creature
      if (targetCreature.controller !== playerId) {
        socket.emit("error", { code: "NOT_YOUR_CREATURE", message: "You can only equip to creatures you control" });
        return;
      }
    }

    const targetTypeLine = (targetCreature.card?.type_line || "").toLowerCase();
    if (!targetTypeLine.includes("creature")) {
      socket.emit("error", { code: "NOT_CREATURE", message: "Target is not a creature" });
      return;
    }

    // Check if payment is required
    const equipCostAdjustment = adjustActivationManaCostForPayment({
      state: game.state,
      activatorId: playerId,
      sourceCard: equipment.card,
      sourceZone: 'battlefield',
      sourceController: String(equipment.controller || playerId),
      sourcePermanent: equipment,
      sourceId: String(equipmentId),
      isManaAbility: false,
      manaCostString: equipCost,
      sourceName: equipment.card?.name || 'Equipment',
    });
    const effectiveEquipCost = equipCostAdjustment.adjustedManaCost || equipCost;
    const parsedCost = parseManaCost(effectiveEquipCost);
    const totalManaCost = parsedCost.generic + Object.values(parsedCost.colors).reduce((a: number, b: number) => a + b, 0);
    
    if (totalManaCost > 0) {
      // Validate and pay the equip cost
      const pool = getOrInitManaPool(game.state, playerId);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      // Validate payment
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", { code: "INSUFFICIENT_MANA", message: validationError });
        return;
      }
      
      // Consume mana
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, '[equipAbility]');
      
      debug(2, `[equipAbility] ${playerId} paid ${effectiveEquipCost} to equip ${equipment.card?.name} to ${targetCreature.card?.name}`);
    }

    const equipTargetDescription = targetsOpponentCreatures ? 'creature an opponent controls' : 'creature you control';
    const validRetargetTargets = battlefield
      .filter((p: any) => {
        const pTypeLine = (p.card?.type_line || '').toLowerCase();
        if (!pTypeLine.includes('creature')) return false;
        return targetsOpponentCreatures ? p.controller !== playerId : p.controller === playerId;
      })
      .map((p: any) => ({
        id: String(p.id),
        name: p.card?.name || 'Creature',
        type: 'permanent' as const,
        controller: p.controller,
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    const activatedAbilityText = `Equip ${equipCost}`;
    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: playerId,
      source: equipmentId,
      sourceName: equipment.card?.name || 'Equipment',
      description: activatedAbilityText,
      activatedAbilityText,
      abilityType: 'equip',
      targets: [targetCreatureIdStr],
      equipParams: {
        equipmentId,
        targetCreatureId: targetCreatureIdStr,
        equipmentName: equipment.card?.name,
        targetCreatureName: targetCreature.card?.name,
      },
      copyRetargetValidTargets: validRetargetTargets.map((target: any) => ({ ...target })),
      copyRetargetTargetTypes: ['creature'],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetTargetDescription: equipTargetDescription,
    } as any;

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);

    try {
      const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
        activatedBy: playerId as any,
        sourcePermanentId: equipmentId as any,
        isManaAbility: false,
        abilityText: activatedAbilityText,
        stackItemId: stackItem.id,
      });
      for (const triggeredAbility of triggeredAbilities) {
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeAbilityActivatedTriggeredStackItem(triggeredAbility));
        } catch (err) {
          debugWarn(1, 'appendEvent(pushTriggeredAbility equip ability-activated) failed:', err);
        }
      }
    } catch {}

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId,
        permanentId: equipmentId,
        abilityId: 'equip',
        cardName: equipment.card?.name || 'Equipment',
        abilityText: activatedAbilityText,
        activatedAbilityText,
        targets: [targetCreatureIdStr],
        copyRetargetValidTargets: validRetargetTargets.map((target: any) => ({ ...target })),
        copyRetargetTargetTypes: ['creature'],
        copyRetargetMinTargets: 1,
        copyRetargetMaxTargets: 1,
        copyRetargetTargetDescription: equipTargetDescription,
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility equip) failed:', e);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: totalManaCost > 0
        ? `${getPlayerName(game, playerId)} paid ${equipCost} and activated ${equipment.card?.name || "Equipment"}'s equip ability targeting ${targetCreature.card?.name || "Creature"}.`
        : `${getPlayerName(game, playerId)} activated ${equipment.card?.name || "Equipment"}'s equip ability targeting ${targetCreature.card?.name || "Creature"}.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `equipAbility error for game ${gameId}:`, err);
    socket.emit("error", { code: "EQUIP_ERROR", message: err?.message ?? String(err) });
  }

}
