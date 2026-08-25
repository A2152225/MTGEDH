/**
 * socket/resolution-handlers/upkeepSacrificeResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: UPKEEP_SACRIFICE case body (edict / upkeep sacrifice a creature, optional
 * source fallback, optional life-loss rider, optional after-sacrifice TARGET_SELECTION).
 * Public entry symbols: handleUpkeepSacrificeResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { queueLifeLossTriggers } from "../../state/modules/triggers/life-loss.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { getPlayerName } from "../util.js";

/**
 * Handle Upkeep Sacrifice choice response
 * Player must sacrifice a creature, or if they can't, sacrifice the source (e.g., Eldrazi Monument)
 */
export function handleUpkeepSacrificeResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract the selection - { type: 'creature' | 'source', creatureId?: string }
  let sacrificeType: 'creature' | 'source' = 'source';
  let creatureId: string | undefined;
  
  if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    sacrificeType = (selection as any).type || 'source';
    creatureId = (selection as any).creatureId;
  } else if (typeof selection === 'string') {
    // Direct creature ID passed
    creatureId = selection;
    sacrificeType = 'creature';
  }
  
  const stepData = step as any;
  const sourceName = step.sourceName || 'Upkeep Sacrifice';
  const sourceId = stepData.sourceId;
  const sourceToSacrifice = stepData.sourceToSacrifice;
  const creatures = stepData.creatures || [];
  const allowSourceSacrifice: boolean = stepData.allowSourceSacrifice !== false;
  let sacrificedPermanentId: string | undefined;
  
  const battlefield = game.state?.battlefield || [];
  
  if (sacrificeType === 'creature' && creatureId) {
    // Validate the creature is in the valid options
    const isValidCreature = creatures.some((c: any) => c.id === creatureId);
    if (!isValidCreature) {
      debugWarn(1, `[Resolution] Invalid creature selection for upkeep sacrifice: ${creatureId}`);
      return;
    }
    
    // Find and sacrifice the creature
    const creatureIdx = battlefield.findIndex((p: any) => p.id === creatureId);
    if (creatureIdx !== -1) {
      const sacrificed = battlefield[creatureIdx];
      const creatureName = sacrificed.card?.name || 'Creature';
      sacrificedPermanentId = String(sacrificed.id || creatureId);
      sacrificePermanent(game as any, sacrificedPermanentId, pid);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} sacrifices ${creatureName} for ${sourceName}.`,
        ts: Date.now(),
      });
      
      debug(2, `[Resolution] ${pid} sacrificed ${creatureName} for ${sourceName}`);
    }
  } else if (allowSourceSacrifice) {
    // Sacrifice the source (e.g., Eldrazi Monument)
    if (sourceId) {
      const sourceIdx = battlefield.findIndex((p: any) => p.id === sourceId);
      if (sourceIdx !== -1) {
        const sacrificed = battlefield[sourceIdx];
        const artifactName = sacrificed.card?.name || sourceName;
        sacrificedPermanentId = String(sacrificed.id || sourceId);
        sacrificePermanent(game as any, sacrificedPermanentId, pid);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} has no creatures and sacrifices ${artifactName}.`,
          ts: Date.now(),
        });
        
        debug(2, `[Resolution] ${pid} sacrificed ${artifactName} (source) - no creatures available`);
      }
    }
  } else {
    // Creature-only sacrifice (no fallback). If there are no creatures, do as much as possible.
    if (!Array.isArray(creatures) || creatures.length === 0) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} has no creatures to sacrifice (${sourceName}).`,
        ts: Date.now(),
      });
      debug(2, `[Resolution] ${pid} has no creatures to sacrifice (${sourceName})`);
    } else {
      debugWarn(1, `[Resolution] Missing/invalid creature selection for creature-only sacrifice (${sourceName})`);
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  if (sacrificedPermanentId) {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'sacrificePermanent', {
        playerId: pid,
        resolvedStepId: String((step as any).id || ''),
        permanentId: sacrificedPermanentId,
      });
    } catch {
      // ignore persistence failures
    }
  }

  const lifeLossAfterSacrifice = Number((stepData as any).lifeLossAfterSacrifice || 0);
  if (Number.isFinite(lifeLossAfterSacrifice) && lifeLossAfterSacrifice > 0) {
    const lifeLossPlayerId = String((stepData as any).lifeLossAfterSacrificePlayerId || pid).trim() || String(pid);
    const startingLife = Number(game.state?.startingLife || 40);
    game.state.life = game.state.life || {};
    const currentLife = Number(game.state.life?.[lifeLossPlayerId] ?? startingLife);
    const newLife = currentLife - lifeLossAfterSacrifice;
    game.state.life[lifeLossPlayerId] = newLife;

    const playerObj = ((game.state as any).players || []).find((player: any) => String(player?.id || '') === lifeLossPlayerId);
    if (playerObj) {
      playerObj.life = newLife;
    }

    (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
    (game.state as any).lifeLostThisTurn[lifeLossPlayerId] =
      Number((game.state as any).lifeLostThisTurn[lifeLossPlayerId] || 0) + lifeLossAfterSacrifice;

    queueLifeLossTriggers(
      game as any,
      lifeLossPlayerId,
      lifeLossAfterSacrifice,
      String((stepData as any).lifeLossAfterSacrificeSourceController || (stepData as any).sourceController || ''),
      { trackLifeLost: false },
    );

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'adjustLife', {
        playerId: lifeLossPlayerId,
        delta: -lifeLossAfterSacrifice,
      });
    } catch {
      // ignore persistence failures
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${sourceName}: ${getPlayerName(game, lifeLossPlayerId)} loses ${lifeLossAfterSacrifice} life. (${currentLife} → ${newLife})`,
      ts: Date.now(),
    });
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'upkeepSacrificeResolve', {
      playerId: pid,
      resolvedStepId: String((step as any).id || ''),
      sourceId: String(sourceId || ''),
      sourceName: String(sourceName || ''),
      sacrificeType,
      sacrificedPermanentId,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(upkeepSacrificeResolve) failed:', err);
  }

  if ((stepData as any).afterSacrificeFollowupTargetSelection === true) {
    const battlefieldNow = game.state?.battlefield || [];
    const followupTargetTypes: string[] = Array.isArray((stepData as any).afterSacrificeFollowupTargetTypes)
      ? (stepData as any).afterSacrificeFollowupTargetTypes.map((targetType: any) => String(targetType || '').toLowerCase()).filter(Boolean)
      : [];
    const followupAction = String((stepData as any).afterSacrificeFollowupAction || '').trim();
    const followupDescription = String((stepData as any).afterSacrificeFollowupDescription || `${sourceName}: Choose a target`).trim();
    const followupTargetDescription = String((stepData as any).afterSacrificeFollowupTargetDescription || 'target permanent').trim();

    const matchesFollowupTarget = (permanent: any) => {
      if (!permanent) return false;
      if (followupTargetTypes.length === 0) return true;
      const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
      return followupTargetTypes.some((targetType) => typeLine.includes(targetType));
    };

    const validTargets = battlefieldNow
      .filter((p: any) => matchesFollowupTarget(p))
      .map((p: any) => ({
        id: p.id,
        type: 'permanent',
        label: p.card?.name || 'Permanent',
        controller: p.controller,
        owner: p.owner,
        typeLine: p.card?.type_line,
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
        card: p.card,
        zone: 'battlefield',
      }));

    if (validTargets.length > 0) {
      const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as any,
        description: followupDescription,
        mandatory: true,
        sourceId: step.sourceId,
        sourceName: step.sourceName,
        validTargets,
        targetTypes: followupTargetTypes,
        minTargets: 1,
        maxTargets: 1,
        targetDescription: followupTargetDescription,
        action: followupAction,
      } as any);

      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: pid,
        sourceId: String(step.sourceId || '').trim(),
        queuedResolutionStep,
      });
    }
  }
}
