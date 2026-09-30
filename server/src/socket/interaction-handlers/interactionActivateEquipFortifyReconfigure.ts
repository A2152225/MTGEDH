/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility families for equip, fortify, and
 * reconfigure (attach/unattach). tryHandle returns true when this family
 * handled or rejected the activation.
 *
 * Public entry symbols: tryHandleActivateEquipFortifyReconfigure.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { parseEquipAbilitiesFromOracle, permanentMatchesEquipQualifier } from "../../../../shared/src/equipAbilities.js";
import { appendEvent } from "../../db";
import { isCreatureNow } from "../../state/creatureTypeNow.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  getEffectivePower,
  getEffectiveToughness,
  getOrInitManaPool,
  getPlayerName,
  validateAndConsumeManaCostFromPool,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { persistQueuedBattlefieldAbilityStepActivation } from "./interactionActivationEventPersistence.js";
import { isBattlefieldSorcerySpeedWindow } from "./interactionGraveyardCastCostAndTimingRules.js";
import { notifySpellOrAbilityPutOnStack } from "../../state/modules/stackPutNotify.js";

export async function tryHandleActivateEquipFortifyReconfigure(
  ctx: ActivateBattlefieldAbilityContext,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    battlefield,
    permanent,
    card,
    cardName,
    oracleText,
    typeLine,
    scopedAbilityFullText,
  } = ctx;

  // Handle equip abilities (equipment cards)
  // Check if this is an equip ability - abilityId contains "equip" or it's an equipment with equip cost
  const isEquipment = typeLine.includes("equipment");
  const hasExplicitEquipAbilityId = /-equip-(\d+)$/i.test(abilityId) || abilityId === 'equip';
  const equipAbilityText = hasExplicitEquipAbilityId ? oracleText : scopedAbilityFullText;
  const isEquipAbility = hasExplicitEquipAbilityId || (isEquipment && /\bequip\b/i.test(equipAbilityText));
  if (isEquipAbility) {
    // CR 702.6a: Equip is sorcery-speed even when oracle omits the reminder text.
    if (!isBattlefieldSorcerySpeedWindow(game, String(pid))) {
      socket.emit('error', {
        code: 'SORCERY_SPEED_ONLY',
        message: `${cardName}'s Equip ability can only be activated at sorcery speed (your main phase with an empty stack).`,
      });
      return true;
    }
    // Parse all equip abilities (shared qualifier parser): legendary / tribal / compound / commander / token / …
    const equipAbilities = parseEquipAbilitiesFromOracle(equipAbilityText);
    
    // Extract which equip ability was selected from abilityId
    // Format: "{cardId}-equip-{index}" e.g., "card123-equip-0" or "card123-equip-1"
    let selectedAbilityIndex = 0;
    const abilityIndexMatch = abilityId.match(/-equip-(\d+)$/i);
    if (abilityIndexMatch) {
      selectedAbilityIndex = parseInt(abilityIndexMatch[1], 10);
    }
    
    const selectedEquip = equipAbilities[selectedAbilityIndex] || equipAbilities[0] || null;
    const equipCost = selectedEquip?.cost || "{0}";
    const equipQualifier = selectedEquip?.qualifier || { kind: 'any' as const, raw: null };
    const equipType = equipQualifier.raw; // human-readable restriction, or null for generic equip
    const equipTargetDescription = selectedEquip?.targetDescription || 'creature you control';
    
    // Get valid targets based on equip qualifier
    const validTargets = battlefield.filter((p: any) => {
      if (p.controller !== pid) return false;
      return permanentMatchesEquipQualifier(p, equipQualifier);
    });

    debug(2, `[activateBattlefieldAbility] Equip ${cardName} targets=${validTargets.length}: ${validTargets.map((p: any) => {
      const name = String(p?.card?.name || p?.id || '?');
      const crewed = p?.crewed === true ? 'crewed' : '';
      const granted = Array.isArray(p?.grantedTypes) && p.grantedTypes.some((t: any) => String(t).toLowerCase() === 'creature') ? 'grantedCreature' : '';
      const tl = String(p?.card?.type_line || '');
      return `${name}[${[crewed, granted].filter(Boolean).join('|') || tl}]`;
    }).join(', ')}`);
    const excludedVehicles = battlefield.filter((p: any) => {
      if (p.controller !== pid) return false;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl.includes('vehicle')) return false;
      return !permanentMatchesEquipQualifier(p, equipQualifier);
    });
    if (excludedVehicles.length > 0) {
      debug(2, `[activateBattlefieldAbility] Equip ${cardName} excluded vehicles: ${excludedVehicles.map((p: any) => `${p?.card?.name || p?.id}(crewed=${p?.crewed === true}, grantedTypes=${JSON.stringify(p?.grantedTypes || [])})`).join(', ')}`);
    }

    if (validTargets.length === 0) {
      socket.emit("error", {
        code: "NO_VALID_TARGETS",
        message: equipType 
          ? `You have no legal targets for Equip ${equipType}`
          : "You have no creatures to equip",
      });
      return true;
    }

    const activatedAbilityText = selectedEquip?.label || `Equip ${equipCost}`;

    // Unified Resolution Queue prompt
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityType || (s as any)?.abilityId || '') === 'equip' && String((s as any)?.equipmentId || (s as any)?.permanentId || s?.sourceId) === String(permanentId));

    if (!existing) {
      const equipStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `Choose a permanent to equip ${cardName} to (${equipTargetDescription}, ${equipCost}).`,
        mandatory: false,
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          label: `${c.card?.name || 'Permanent'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
          description: c.card?.type_line || 'Permanent',
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
        targetTypes: equipQualifier.kind === 'planeswalker'
          ? ['planeswalker']
          : equipQualifier.kind === 'creature_or_planeswalker'
            ? ['creature', 'planeswalker']
            : ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: equipTargetDescription,
        battlefieldAbilityTargetSelection: true,
        equipmentId: permanentId,
        permanentId,
        equipmentName: cardName,
        cardName,
        abilityId: 'equip',
        abilityText: activatedAbilityText,
        activatedAbilityText,
        abilityType: 'equip',
        equipCost,
        equipType,
        equipQualifierKind: equipQualifier.kind,
        targetsOpponentCreatures: false,
      } as any);

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: activatedAbilityText,
        activatedAbilityText,
        queuedStep: {
          id: String((equipStep as any).id || ''),
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a permanent to equip ${cardName} to (${equipTargetDescription}, ${equipCost}).`,
          mandatory: false,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Permanent'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
            description: c.card?.type_line || 'Permanent',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: equipQualifier.kind === 'planeswalker'
            ? ['planeswalker']
            : equipQualifier.kind === 'creature_or_planeswalker'
              ? ['creature', 'planeswalker']
              : ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: equipTargetDescription,
          battlefieldAbilityTargetSelection: true,
          equipmentId: permanentId,
          permanentId,
          equipmentName: cardName,
          cardName,
          abilityId: 'equip',
          abilityText: activatedAbilityText,
          activatedAbilityText,
          abilityType: 'equip',
          equipCost,
          equipType,
          equipQualifierKind: equipQualifier.kind,
          targetsOpponentCreatures: false,
        },
      });
    }

    debug(2, `[activateBattlefieldAbility] Equip ability on ${cardName}: queued TARGET_SELECTION (cost=${equipCost}, qualifier=${equipQualifier.kind})`);
    broadcastGame(io, game, gameId);
    return true;
  }

  // Handle fortify abilities (Fortification cards)
  const hasExplicitFortifyAbilityId = /-fortify-(\d+)$/i.test(abilityId) || abilityId === 'fortify';
  const fortifyMatch = oracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  const isFortifyAbility = hasExplicitFortifyAbilityId && typeLine.includes('fortification') && fortifyMatch;

  if (isFortifyAbility && fortifyMatch) {
    const fortifyCost = fortifyMatch[1];
    const validTargets = battlefield.filter((p: any) => {
      if (p.controller !== pid) return false;
      const pTypeLine = (p.card?.type_line || '').toLowerCase();
      return pTypeLine.includes('land');
    });

    if (validTargets.length === 0) {
      socket.emit('error', {
        code: 'NO_VALID_TARGETS',
        message: 'You have no lands to fortify',
      });
      return true;
    }

    const activatedAbilityText = `Fortify ${fortifyCost}`;

    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityType || (s as any)?.abilityId || '') === 'fortify' && String((s as any)?.fortificationId || (s as any)?.permanentId || s?.sourceId) === String(permanentId));

    if (!existing) {
      const fortifyStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `Choose a land to fortify ${cardName} to (${fortifyCost}).`,
        mandatory: false,
        validTargets: validTargets.map((land: any) => ({
          id: land.id,
          label: land.card?.name || 'Land',
          description: land.card?.type_line || 'Land',
          imageUrl: land.card?.image_uris?.small || land.card?.image_uris?.normal,
        })),
        targetTypes: ['land'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'land you control',
        battlefieldAbilityTargetSelection: true,
        fortificationId: permanentId,
        permanentId,
        fortificationName: cardName,
        cardName,
        abilityId: 'fortify',
        abilityText: activatedAbilityText,
        activatedAbilityText,
        abilityType: 'fortify',
        fortifyCost,
      } as any);

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: activatedAbilityText,
        activatedAbilityText,
        queuedStep: {
          id: String((fortifyStep as any).id || ''),
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a land to fortify ${cardName} to (${fortifyCost}).`,
          mandatory: false,
          validTargets: validTargets.map((land: any) => ({
            id: land.id,
            label: land.card?.name || 'Land',
            description: land.card?.type_line || 'Land',
            imageUrl: land.card?.image_uris?.small || land.card?.image_uris?.normal,
          })),
          targetTypes: ['land'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'land you control',
          battlefieldAbilityTargetSelection: true,
          fortificationId: permanentId,
          permanentId,
          fortificationName: cardName,
          cardName,
          abilityId: 'fortify',
          abilityText: activatedAbilityText,
          activatedAbilityText,
          abilityType: 'fortify',
          fortifyCost,
        },
      });
    }

    debug(2, `[activateBattlefieldAbility] Fortify ability on ${cardName}: queued TARGET_SELECTION (cost=${fortifyCost})`);
    broadcastGame(io, game, gameId);
    return true;
  }

  const hasExplicitReconfigureAttachAbilityId = /-reconfigure-attach-(\d+)$/i.test(abilityId);
  const hasExplicitReconfigureUnattachAbilityId = /-reconfigure-unattach-(\d+)$/i.test(abilityId);
  const reconfigureMatch = oracleText.match(/reconfigure\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  const isReconfigureEquipment = typeLine.includes('equipment') && /\breconfigure\b/i.test(oracleText);

  if (hasExplicitReconfigureAttachAbilityId && isReconfigureEquipment && reconfigureMatch) {
    const reconfigureCost = reconfigureMatch[1];
    const validTargets = battlefield.filter((p: any) => {
      if (!p || p.controller !== pid) return false;
      if (String(p.id) === String(permanentId)) return false;
      return isCreatureNow(p);
    });

    if (validTargets.length === 0) {
      socket.emit('error', {
        code: 'NO_VALID_TARGETS',
        message: 'You have no other creatures to attach this reconfigure permanent to',
      });
      return true;
    }

    const activatedAbilityText = `Reconfigure ${reconfigureCost}`;
    const existing = ResolutionQueueManager
      .getStepsForPlayer(gameId, pid as any)
      .find((s: any) => s?.type === ResolutionStepType.TARGET_SELECTION && (s as any)?.battlefieldAbilityTargetSelection === true && String((s as any)?.abilityType || '') === 'reconfigure_attach' && String((s as any)?.reconfigureId || (s as any)?.permanentId || s?.sourceId) === String(permanentId));

    if (!existing) {
      const reconfigureStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
        description: `Choose a creature to attach ${cardName} to (Reconfigure ${reconfigureCost}).`,
        mandatory: false,
        validTargets: validTargets.map((c: any) => ({
          id: c.id,
          label: `${c.card?.name || 'Creature'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
          description: c.card?.type_line || 'Creature',
          imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
        })),
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'another creature you control',
        battlefieldAbilityTargetSelection: true,
        reconfigureId: permanentId,
        permanentId,
        reconfigureName: cardName,
        cardName,
        abilityId,
        abilityText: 'Attach to target creature you control',
        activatedAbilityText,
        abilityType: 'reconfigure_attach',
        reconfigureCost,
        targetsOpponentCreatures: false,
      } as any);

      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: 'Attach to target creature you control',
        activatedAbilityText,
        queuedStep: {
          id: String((reconfigureStep as any).id || ''),
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
          description: `Choose a creature to attach ${cardName} to (Reconfigure ${reconfigureCost}).`,
          mandatory: false,
          validTargets: validTargets.map((c: any) => ({
            id: c.id,
            label: `${c.card?.name || 'Creature'} (${getEffectivePower(c, game.state)}/${getEffectiveToughness(c, game.state)})`,
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['creature'],
          minTargets: 1,
          maxTargets: 1,
          targetDescription: 'another creature you control',
          battlefieldAbilityTargetSelection: true,
          reconfigureId: permanentId,
          permanentId,
          reconfigureName: cardName,
          cardName,
          abilityId,
          abilityText: 'Attach to target creature you control',
          activatedAbilityText,
          abilityType: 'reconfigure_attach',
          reconfigureCost,
          targetsOpponentCreatures: false,
        },
      });
    }

    debug(2, `[activateBattlefieldAbility] Reconfigure attach ability on ${cardName}: queued TARGET_SELECTION (cost=${reconfigureCost})`);
    broadcastGame(io, game, gameId);
    return true;
  }

  if (hasExplicitReconfigureUnattachAbilityId && isReconfigureEquipment && reconfigureMatch) {
    const reconfigureCost = reconfigureMatch[1];

    if (!(permanent as any).attachedTo) {
      socket.emit('error', {
        code: 'INVALID_ACTIVATION',
        message: `${cardName} is not attached to anything.`,
      });
      return true;
    }

    const pool = getOrInitManaPool(game.state, pid);
    const paid = validateAndConsumeManaCostFromPool(pool as any, reconfigureCost, { logPrefix: '[activateBattlefieldAbility:reconfigure-unattach]' });
    if (!paid.ok) {
      socket.emit('error', {
        code: 'INSUFFICIENT_MANA',
        message: (paid as any).error || `Cannot pay ${reconfigureCost}.`,
      });
      return true;
    }

    broadcastManaPoolUpdate(io, gameId, pid, pool as any, `Activated ${cardName}`, game);

    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: 'Unattach this Equipment',
      activatedAbilityText: `Reconfigure ${reconfigureCost}`,
      abilityType: 'reconfigure_unattach',
    } as any;

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    notifySpellOrAbilityPutOnStack(game as any, stackItem.id);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: Unattach this Equipment`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
      playerId: pid,
      permanentId,
      abilityId,
      cardName,
      abilityText: 'Unattach this Equipment',
      activatedAbilityText: `Reconfigure ${reconfigureCost}`,
      abilityType: 'reconfigure_unattach',
    });

    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
