/**
 * socket/resolutionScrySurveilResponseHandlers.ts
 *
 * SCRY and SURVEIL resolution step response handlers (CR 701.22 / 701.46).
 * Extracted from resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import { maybeResumeDeferredOracleIrStackSpellOnGame } from "../state/modules/oracleIrDeferredStackFinalize.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from "../state/modules/oracleIrServerZoneSync.js";
import {
  readOracleIrCompoundResumePersistFields,
  readOracleIrLedgerPersistFields,
} from "../state/modules/oracleIrTransitionPipeline.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "./resolutionCloneQueuedPromptUtils.js";
import { oracleIrTopLibraryChoiceResumeApplied } from "./resolutionLibrarySearchOracleIrResumeUtils.js";
import { broadcastGame, getPlayerName } from "./util.js";

/**
 * Handle Scry resolution response
 * 
 * Player looks at the top N cards of their library and decides which to keep
 * on top (in order) and which to put on the bottom (in order).
 * 
 * Reference: Rule 701.22 - Scry
 */
export function handleScryResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  const normalizeIdList = (v: any): string[] => {
    if (!Array.isArray(v)) return [];
    return v
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => String(x));
  };

  const keepTopOrder = normalizeIdList(selections?.keepTopOrder);
  const bottomOrder = normalizeIdList(selections?.bottomOrder);
  
  const scryStep = step as any;
  const scryCount = scryStep.scryCount || 0;
  const cards = scryStep.cards || [];
  
  debug(2, `[Resolution] Scry response: player=${pid}, scryCount=${scryCount}, keepTop=${keepTopOrder.length}, bottom=${bottomOrder.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + bottomOrder.length;
  if (totalCards !== scryCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Scry card count mismatch: expected ${scryCount}, got ${totalCards}`);
  }
  
  // Validate that the cards match what was shown
  const selectedIds = [...keepTopOrder, ...bottomOrder].map((id: any) => String(id));
  const cardIds = cards.map((c: any) => String(c?.id));
  const allMatch = selectedIds.every((id: string) => cardIds.includes(id));
  
  if (!allMatch) {
    debugWarn(2, `[Resolution] Scry selection contains cards not in original set`);
  }
  
  // Apply the scry event to the game
  if (typeof game.applyEvent === 'function') {
    game.applyEvent({
      type: "scryResolve",
      playerId: pid,
      keepTopOrder,
      bottomOrder,
    });
  }

  let ledgerPersistFields: ReturnType<typeof readOracleIrLedgerPersistFields> = {};
  let compoundResumePersistFields: ReturnType<typeof readOracleIrCompoundResumePersistFields> = {};
  let persistOracleIrLedger = false;
  let compoundDrawResult: ReturnType<typeof maybeResumeOracleIRStepsAfterResolution> = null;
  if (String(scryStep.oracleIrChoiceStepJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
    if (oracleIrTopLibraryChoiceResumeApplied(resumed, 'scry')) {
      compoundResumePersistFields = readOracleIrCompoundResumePersistFields(scryStep);
      ledgerPersistFields = readOracleIrLedgerPersistFields(game.state);
      compoundDrawResult = maybeResumeOracleIRStepsAfterResolution(ctx, step);
      persistOracleIrLedger = scryStep.persistOracleIrScryResolve === true;
      broadcastGame(io, game, gameId);
    }
  }
  
  maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);

  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "scryResolve", { 
      playerId: pid, 
      resolvedStepId: String((step as any).id || ''),
      keepTopOrder, 
      bottomOrder,
      ...(persistOracleIrLedger ? ledgerPersistFields : {}),
      ...(persistOracleIrLedger ? compoundResumePersistFields : {}),
    });
  } catch {
    // Ignore persistence failures
  }

  if ((game.state as any).pendingScry) {
    delete (game.state as any).pendingScry[pid];
    if (Object.keys((game.state as any).pendingScry).length === 0) {
      delete (game.state as any).pendingScry;
    }
  }
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const bottomCount = bottomOrder.length;
  let message = `${getPlayerName(game, pid)} scries ${scryCount}`;
  if (topCount > 0 && bottomCount > 0) {
    message += ` (${topCount} on top, ${bottomCount} on bottom)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (bottomCount > 0) {
    message += ` (all on bottom)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });

  const stepData = step as any;
  if (stepData?.scryFollowupChoice === true && stepData?.scryFollowupKind === 'damage_each_opponent') {
    const findCreatureOnBattlefieldById = (id: string): any | null => {
      if (!id) return null;
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const perm = battlefield.find((p: any) => String(p?.id) === String(id));
      if (!perm) return null;
      const tl = String(perm?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return null;
      return perm;
    };

    const recordPlayerDamageThisTurn = (targetPlayerId: string, dmg: number) => {
      if (!Number.isFinite(dmg) || dmg <= 0) return;
      try {
        (game.state as any).damageTakenThisTurnByPlayer = (game.state as any).damageTakenThisTurnByPlayer || {};
        (game.state as any).damageTakenThisTurnByPlayer[String(targetPlayerId)] =
          ((game.state as any).damageTakenThisTurnByPlayer[String(targetPlayerId)] || 0) + dmg;
      } catch {}
      try {
        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[String(targetPlayerId)] = ((game.state as any).lifeLostThisTurn[String(targetPlayerId)] || 0) + dmg;
      } catch {}
    };

    const recordCreatureDealtDamageToPlayerThisTurn = (sourceCreature: any, targetPlayerId: string, dmg: number) => {
      const sourceId = String(sourceCreature?.id || '');
      if (!sourceId || !Number.isFinite(dmg) || dmg <= 0) return;
      try {
        (game.state as any).creaturesThatDealtDamageToPlayer = (game.state as any).creaturesThatDealtDamageToPlayer || {};
        const perPlayer = (((game.state as any).creaturesThatDealtDamageToPlayer[String(targetPlayerId)] =
          (game.state as any).creaturesThatDealtDamageToPlayer[String(targetPlayerId)] || {}) as any);
        const creatureName = String(sourceCreature?.card?.name || 'Unknown Creature');
        perPlayer[sourceId] = {
          creatureName,
          totalDamage: (perPlayer[sourceId]?.totalDamage || 0) + dmg,
          lastDamageTime: Date.now(),
        };
      } catch {}
    };

    const controllerId = String(stepData.scryFollowupController || pid);
    const damage = Number(stepData.scryFollowupAmount || 0);
    const sourceName = String(stepData.scryFollowupSourceName || step.sourceName || 'Ability');
    const sourcePermanentId = String(stepData.scryFollowupSourcePermanentId || '');

    if (Number.isFinite(damage) && damage > 0) {
      const startingLife = game.state.startingLife || 40;
      game.state.life = game.state.life || {};

      const sourceCreature = findCreatureOnBattlefieldById(sourcePermanentId);

      for (const p of game.state.players || []) {
        if (!p?.id) continue;
        if (String(p.id) === controllerId) continue;
        const oppId = String(p.id);
        const currentLife = game.state.life?.[oppId] ?? startingLife;
        game.state.life[oppId] = currentLife - damage;

        recordPlayerDamageThisTurn(oppId, damage);
        if (sourceCreature) recordCreatureDealtDamageToPlayerThisTurn(sourceCreature, oppId, damage);
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName} deals ${damage} damage to each opponent.`,
        ts: Date.now(),
      });
    }
  }

  if (stepData?.scryFollowupChoice === true && stepData?.scryFollowupKind === 'draw_cards') {
    const controllerId = String(stepData.scryFollowupController || pid);
    const drawCount = Number(stepData.scryFollowupAmount || 0);
    const sourceName = String(stepData.scryFollowupSourceName || step.sourceName || 'Ability');
    const condition = String(stepData.scryFollowupCondition || '');

    let shouldDraw = Number.isFinite(drawCount) && drawCount > 0;
    if (shouldDraw && condition === 'controller_controls_artifact') {
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const controlsArtifact = battlefield.some((perm: any) => {
        if (!perm) return false;
        if (String(perm.controller || '') !== controllerId) return false;
        const tl = String(perm?.card?.type_line || '').toLowerCase();
        return tl.includes('artifact');
      });
      shouldDraw = controlsArtifact;
    }

    if (shouldDraw) {
      if (typeof (game as any).drawCards === 'function') {
        (game as any).drawCards(controllerId, drawCount);
      } else {
        const zones = game.state?.zones?.[controllerId];
        if (zones) {
          zones.hand = zones.hand || [];
          const lib = (game as any).libraries?.get?.(controllerId) || zones.library || [];
          if (Array.isArray(lib)) {
            for (let i = 0; i < drawCount; i++) {
              if (lib.length <= 0) break;
              const drawn = lib.shift();
              zones.hand.push({ ...drawn, zone: 'hand' });
            }
          }
          zones.handCount = zones.hand.length;
          zones.libraryCount = Array.isArray(lib) ? lib.length : zones.libraryCount;
          if ((game as any).libraries?.set && Array.isArray(lib)) {
            (game as any).libraries.set(controllerId, lib);
          }
        }
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} draws ${drawCount} card${drawCount === 1 ? '' : 's'}.`,
        ts: Date.now(),
      });
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Surveil resolution response
 * 
 * Player looks at the top N cards of their library and decides which to keep
 * on top (in order) and which to put in the graveyard.
 * 
 * Reference: Rule 701.25 - Surveil
 */
export function handleSurveilResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  const normalizeIdList = (v: any): string[] => {
    if (!Array.isArray(v)) return [];
    return v
      .map((x: any) => (typeof x === 'string' ? x : x?.id))
      .filter(Boolean)
      .map((x: any) => String(x));
  };

  const keepTopOrder = normalizeIdList(selections?.keepTopOrder);
  const toGraveyard = normalizeIdList(selections?.toGraveyard);
  
  const surveilStep = step as any;
  const surveilCount = surveilStep.surveilCount || 0;
  const cards = surveilStep.cards || [];
  
  debug(2, `[Resolution] Surveil response: player=${pid}, surveilCount=${surveilCount}, keepTop=${keepTopOrder.length}, toGY=${toGraveyard.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + toGraveyard.length;
  if (totalCards !== surveilCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Surveil card count mismatch: expected ${surveilCount}, got ${totalCards}`);
  }
  
  // Validate that the cards match what was shown
  const selectedIds = [...keepTopOrder, ...toGraveyard].map((id: any) => String(id));
  const cardIds = cards.map((c: any) => String(c?.id));
  const allMatch = selectedIds.every((id: string) => cardIds.includes(id));
  
  if (!allMatch) {
    debugWarn(2, `[Resolution] Surveil selection contains cards not in original set`);
  }
  
  // Apply the surveil event to the game
  if (typeof game.applyEvent === 'function') {
    game.applyEvent({
      type: "surveilResolve",
      playerId: pid,
      keepTopOrder,
      toGraveyard,
    });
  }

  let ledgerPersistFields: ReturnType<typeof readOracleIrLedgerPersistFields> = {};
  let compoundResumePersistFields: ReturnType<typeof readOracleIrCompoundResumePersistFields> = {};
  let persistOracleIrLedger = false;
  if (String(surveilStep.oracleIrChoiceStepJson || '').trim()) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
    if (oracleIrTopLibraryChoiceResumeApplied(resumed, 'surveil')) {
      compoundResumePersistFields = readOracleIrCompoundResumePersistFields(surveilStep);
      ledgerPersistFields = readOracleIrLedgerPersistFields(game.state);
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
      persistOracleIrLedger = surveilStep.persistOracleIrSurveilResolve === true;
      broadcastGame(io, game, gameId);
    }
  }

  maybeResumeDeferredOracleIrStackSpellOnGame(game, gameId);
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "surveilResolve", { 
      playerId: pid, 
      resolvedStepId: String((step as any).id || ''),
      keepTopOrder, 
      toGraveyard,
      ...(persistOracleIrLedger ? ledgerPersistFields : {}),
      ...(persistOracleIrLedger ? compoundResumePersistFields : {}),
    });
  } catch {
    // Ignore persistence failures
  }

  if ((game.state as any).pendingSurveil) {
    delete (game.state as any).pendingSurveil[pid];
    if (Object.keys((game.state as any).pendingSurveil).length === 0) {
      delete (game.state as any).pendingSurveil;
    }
  }
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const gyCount = toGraveyard.length;
  let message = `${getPlayerName(game, pid)} surveils ${surveilCount}`;
  if (topCount > 0 && gyCount > 0) {
    message += ` (${topCount} on top, ${gyCount} to graveyard)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (gyCount > 0) {
    message += ` (all to graveyard)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });

  // Optional follow-up: "then exile a card from a graveyard" (used by shared oracle templates)
  if ((surveilStep as any).followUpExileGraveyardCard === true) {
    const zones = game.state?.zones || {};
    const allGyCards: Array<{ id: string; owner: string; name?: string; type_line?: string; image_uris?: any }> = [];
    for (const playerId of Object.keys(zones)) {
      const gy: any[] = zones[playerId]?.graveyard || [];
      for (const c of gy) {
        if (!c?.id) continue;
        allGyCards.push({ id: c.id, owner: playerId, name: c.name, type_line: c.type_line, image_uris: c.image_uris });
      }
    }

    if (allGyCards.length > 0) {
      const followUpSourceName = String((surveilStep as any).followUpSourceName || step.sourceName || 'Effect');
      const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as any,
        description: `${followUpSourceName}: Exile a card from a graveyard`,
        mandatory: true,
        sourceName: followUpSourceName,
        minTargets: 1,
        maxTargets: 1,
        action: 'exile_graveyard_card',
        validTargets: allGyCards.map((c) => ({
          id: c.id,
          label: c.name || 'Card',
          description: c.type_line || 'card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          zone: 'graveyard',
          owner: c.owner,
        })),
      } as any);

      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: pid,
        sourceId: String((surveilStep as any).sourceId || step.sourceId || '').trim(),
        queuedResolutionStep,
      });
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
