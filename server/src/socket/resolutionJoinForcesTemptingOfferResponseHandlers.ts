/**
 * socket/resolutionJoinForcesTemptingOfferResponseHandlers.ts
 *
 * JOIN_FORCES / TEMPTING_OFFER response handlers (+ apply helpers).
 * Split from resolutionJoinForcesTemptingZoneChoiceResponseHandlers.ts
 * (kept as a thin re-export barrel). Wired through resolutionHandlerDeps.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../db/index.js";
import type { GameContext } from "../state/context.js";
import { applyJoinForcesPaidManaPowerPump } from "../state/modules/joinForcesResolutionQueue.js";
import { maybeResumeOracleIRStepsAfterResolution } from "../state/modules/oracleIrServerZoneSync.js";
import { triggerETBEffectsForToken } from "../state/modules/triggerEtbEntryEffects.js";
import { drawCards as drawCardsFromZones } from "../state/modules/zones.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { getTokenImageUrls } from "../services/tokens.js";
import { debug, debugWarn } from "../utils/debug.js";
import { creatureHasHaste } from "./game-actions.js";
import { createLibrarySearchStep } from "./resolutionLibrarySearchStepUtils.js";
import { getPlayerName } from "./util.js";
import { stampPermanentEntryTimestamp } from '../../../rules-engine/src/permanentTimestamps.js';

export function handleJoinForcesResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract contribution amount from selection
  let contribution = 0;
  if (typeof selection === 'number') {
    contribution = Math.max(0, Math.floor(selection));
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    contribution = Math.max(0, Math.floor((selection as any).amount || 0));
  }
  
  const stepData = step as any;
  const cardName = stepData.cardName || step.sourceName || 'Join Forces';
  const initiator = stepData.initiator;
  const availableMana = stepData.availableMana || 0;
  const tappedPermanentIds: string[] = [];
  
  // Validate contribution doesn't exceed available mana
  if (contribution > availableMana) {
    debugWarn(1, `[Resolution] Join Forces: contribution ${contribution} exceeds available mana ${availableMana} for player ${pid}`);
    return; // Reject invalid contribution
  }

  // Spend mana by tapping sources (Join Forces is a mana payment, not floating mana).
  // This is intentionally a simple/optimistic model: we tap lands first, then mana rocks/dorks.
  // Mana Flare / Heartbeat / Dictate are approximated as +1 extra mana per land tap.
  if (contribution > 0) {
    try {
      const battlefield = (game.state?.battlefield || []) as any[];
      const globalLandExtra = battlefield.some((p: any) => {
        const name = String(p?.card?.name || '').toLowerCase();
        return name.includes('mana flare') || name.includes('heartbeat of spring') || name.includes('dictate of karametra');
      });

      let remaining = contribution;

      // Tap lands first
      for (const perm of battlefield) {
        if (remaining <= 0) break;
        if (!perm || perm.controller !== pid) continue;
        if (perm.tapped) continue;
        const typeLine = String(perm.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('land')) continue;

        perm.tapped = true;
        tappedPermanentIds.push(String(perm.id));
        remaining -= globalLandExtra ? 2 : 1;
      }

      // Then tap other mana sources (mana dorks/rocks), 1 mana each (conservative)
      if (remaining > 0) {
        for (const perm of battlefield) {
          if (remaining <= 0) break;
          if (!perm || perm.controller !== pid) continue;
          if (perm.tapped) continue;
          if (!perm.card) continue;

          const oracle = String(perm.card?.oracle_text || '').toLowerCase();
          if (!oracle.includes('{t}:') || !oracle.includes('add')) continue;

          // Respect summoning sickness for creatures with tap abilities
          const tl = String(perm.card?.type_line || '').toLowerCase();
          const isCreature = tl.includes('creature');
          const isLand = tl.includes('land');
          if (isCreature && !isLand && perm.summoningSickness) {
            const hasHaste = creatureHasHaste(perm, battlefield as any, pid as any);
            if (!hasHaste) continue;
          }

          perm.tapped = true;
          tappedPermanentIds.push(String(perm.id));
          remaining -= 1;
        }
      }

      if (remaining > 0) {
        debugWarn(1, `[Resolution] Join Forces: tapped sources still short by ${remaining} for ${pid}`);
      }
    } catch (err) {
      debugWarn(1, `[Resolution] Join Forces: failed to tap mana sources for ${pid}:`, err);
    }
  }
  
  debug(1, `[Resolution] Join Forces: player=${pid} contributed ${contribution} mana to ${cardName}`);
  
  // Track contributions in game state for effect resolution
  game.state.joinForcesContributions = game.state.joinForcesContributions || {};
  game.state.joinForcesContributions[cardName] = game.state.joinForcesContributions[cardName] || { 
    total: 0, 
    byPlayer: {},
    initiator,
    cardName,
    effectDescription: String(stepData.effectDescription || ''),
    sourcePermanentId: String(stepData.sourceId || '').trim() || undefined,
  };
  game.state.joinForcesContributions[cardName].total += contribution;
  game.state.joinForcesContributions[cardName].byPlayer[pid] = contribution;

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'joinForcesContribution', {
      stepId: String((step as any).id || ''),
      playerId: pid,
      cardName,
      initiator,
      contribution,
      tappedPermanentIds,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(joinForcesContribution) failed:', err);
  }
  
  // Notify players of the contribution
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: contribution > 0 
      ? `${getPlayerName(game, pid)} contributes ${contribution} mana to ${cardName}.`
      : `${getPlayerName(game, pid)} declines to contribute mana to ${cardName}.`,
    ts: Date.now(),
  });
  
  // Check if all players have responded - if so, apply the effect
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingJoinForcesSteps = queue.steps.filter(s => 
    s.type === ResolutionStepType.JOIN_FORCES && 
    (s as any).cardName === cardName
  );
  
  if (remainingJoinForcesSteps.length === 0) {
    // All players have responded - apply the Join Forces effect
    const contributions = game.state.joinForcesContributions[cardName];
    const total = contributions.total;
    const resumeJson = String(stepData.oracleIrResumeStepsJson || '').trim();
    let oracleIrResumed = false;

    if (resumeJson) {
      const ctx = ((game as any).ctx || game) as any;
      ctx.gameId = gameId;
      ctx.state = game.state;
      const queueLenBeforeResume = ResolutionQueueManager.getQueue(gameId).steps.length;
      const resumeResult = maybeResumeOracleIRStepsAfterResolution(ctx, {
        ...stepData,
        oracleIrResumeStepsJson: resumeJson,
        oracleIrXValue: total,
        oracleIrControllerId: String(stepData.oracleIrControllerId || initiator || pid).trim(),
      });
      const appliedCount = Array.isArray(resumeResult?.appliedSteps) ? resumeResult.appliedSteps.length : 0;
      const queuedNewSteps = ResolutionQueueManager.getQueue(gameId).steps.length > queueLenBeforeResume;
      // A player_choice gap is not "resumed" unless a follow-up prompt was actually queued.
      // Collective Voyage previously skipped applyJoinForcesEffect here with no LIBRARY_SEARCH.
      oracleIrResumed = Boolean(resumeResult) && (appliedCount > 0 || queuedNewSteps);
    }

    const completionPayload = oracleIrResumed
      ? undefined
      : applyJoinForcesEffect(io, game, gameId, cardName, total, contributions.byPlayer, initiator, {
          effectDescription: contributions.effectDescription,
          sourcePermanentId: contributions.sourcePermanentId,
        });

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'joinForcesComplete', {
        cardName,
        initiator,
        totalContributions: total,
        byPlayer: { ...(contributions.byPlayer || {}) },
        effectDescription: contributions.effectDescription,
        sourcePermanentId: contributions.sourcePermanentId,
        ...(oracleIrResumed ? { oracleIrResumed: true } : {}),
        ...(completionPayload || {}),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(joinForcesComplete) failed:', err);
    }
    
    // Clean up
    delete game.state.joinForcesContributions[cardName];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Apply the actual Join Forces effect based on total mana contributed
 */
export function applyJoinForcesEffect(
  io: Server,
  game: any,
  gameId: string,
  cardName: string,
  totalContributions: number,
  byPlayer: Record<string, number>,
  initiator: string,
  metadata?: {
    effectDescription?: string;
    sourcePermanentId?: string;
  },
): Record<string, any> | undefined {
  const cardNameLower = cardName.toLowerCase();
  const players = game.state?.players || [];
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  const result: Record<string, any> = {};
  
  debug(1, `[Resolution] Applying Join Forces effect: ${cardName} with ${totalContributions} total mana`);
  
  // Minds Aglow: Each player draws X cards
  if (cardNameLower.includes('minds aglow')) {
    for (const p of players) {
      if (p.hasLost) continue;
      try {
        if (typeof (game as any).drawCards === 'function') {
          (game as any).drawCards(p.id, totalContributions);
          continue;
        }

        const libraries = (game as any).libraries;
        if (libraries && typeof libraries.get === 'function' && typeof libraries.set === 'function') {
          const ctx: GameContext = {
            state: game.state,
            libraries,
            bumpSeq: () => {
              if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
            },
            rng: (game as any).rng,
          } as any;
          drawCardsFromZones(ctx, p.id, totalContributions);
          continue;
        }

        debugWarn(1, `[Resolution] Minds Aglow: no draw handler available for ${p.id}`);
      } catch (err) {
        debugWarn(1, `[Resolution] Minds Aglow: draw failed for ${p.id}:`, err);
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `📚 Minds Aglow: Each player draws ${totalContributions} cards!`,
      ts: Date.now(),
    });
  }
  // Collective Voyage: Each player may search for X basic lands
  else if (cardNameLower.includes('collective voyage')) {
    for (const p of players) {
      if (p.hasLost) continue;
      createLibrarySearchStep(game, gameId, p.id, {
        searchFor: `up to ${totalContributions} basic land card(s)`,
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: 'Collective Voyage',
        shuffleAfter: true,
        maxSelections: totalContributions,
        filter: { types: ['land'], supertypes: ['basic'] },
      });
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🌲 Collective Voyage: Each player may search for up to ${totalContributions} basic land cards!`,
      ts: Date.now(),
    });
  }
  // Alliance of Arms: Each player creates X Soldier tokens
  else if (cardNameLower.includes('alliance of arms')) {
    const createdPermanentIdsByPlayer: Record<string, string[]> = {};
    for (const p of players) {
      if (p.hasLost) continue;
      createdPermanentIdsByPlayer[String(p.id)] = [];
      for (let i = 0; i < totalContributions; i++) {
        const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
        battlefield.push({
          id: tokenId,
          controller: p.id,
          owner: p.id,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: tokenId,
            name: 'Soldier Token',
            type_line: 'Token Creature — Soldier',
            power: '1',
            toughness: '1',
            colors: ['W'],
          },
        });
        stampPermanentEntryTimestamp(game.state, battlefield[battlefield.length - 1]);
        createdPermanentIdsByPlayer[String(p.id)].push(tokenId);
      }
    }
    result.createdPermanentIdsByPlayer = createdPermanentIdsByPlayer;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚔️ Alliance of Arms: Each player creates ${totalContributions} 1/1 white Soldier tokens!`,
      ts: Date.now(),
    });
  }
  // Shared Trauma: Each player mills X cards
  else if (cardNameLower.includes('shared trauma')) {
    for (const p of players) {
      if (p.hasLost) continue;
      game.state.pendingMill = game.state.pendingMill || {};
      game.state.pendingMill[p.id] = (game.state.pendingMill[p.id] || 0) + totalContributions;
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `💀 Shared Trauma: Each player mills ${totalContributions} cards!`,
      ts: Date.now(),
    });
  } else if (applyJoinForcesPaidManaPowerPump(battlefield, {
    cardName,
    totalContributions,
    effectDescription: metadata?.effectDescription,
    sourcePermanentId: metadata?.sourcePermanentId,
  })) {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚡ ${cardName} gets +${totalContributions}/+0 until end of turn!`,
      ts: Date.now(),
    });
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Handle Tempting Offer accept/decline response
 * Each opponent may accept the tempting offer
 */
export function handleTemptingOfferResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract acceptance from selection
  let accepted = false;
  if (typeof selection === 'boolean') {
    accepted = selection;
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    accepted = Boolean((selection as any).accept || (selection as any).accepted);
  } else if (typeof selection === 'string') {
    accepted = selection === 'accept' || selection === 'true';
  }
  
  const stepData = step as any;
  const cardName = stepData.cardName || step.sourceName || 'Tempting Offer';
  const initiator = stepData.initiator;
  
  debug(2, `[Resolution] Tempting Offer: player=${pid} ${accepted ? 'ACCEPTS' : 'DECLINES'} ${cardName}`);
  
  // Track responses in game state for effect resolution
  game.state.temptingOfferResponses = game.state.temptingOfferResponses || {};
  game.state.temptingOfferResponses[cardName] = game.state.temptingOfferResponses[cardName] || { 
    acceptedBy: [],
    initiator,
    cardName 
  };
  
  if (accepted) {
    game.state.temptingOfferResponses[cardName].acceptedBy.push(pid);
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'temptingOfferResponse', {
      stepId: String((step as any).id || ''),
      resolvedStepId: String((step as any).id || ''),
      playerId: pid,
      cardName,
      initiator,
      accepted,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(temptingOfferResponse) failed:', err);
  }
  
  // Notify players of the response
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: accepted 
      ? `✅ ${getPlayerName(game, pid)} accepts the tempting offer from ${cardName}!`
      : `❌ ${getPlayerName(game, pid)} declines the tempting offer from ${cardName}.`,
    ts: Date.now(),
  });
  
  // Check if all opponents have responded - if so, apply the effect
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingTemptingOfferSteps = queue.steps.filter(s => 
    s.type === ResolutionStepType.TEMPTING_OFFER && 
    (s as any).cardName === cardName
  );
  
  if (remainingTemptingOfferSteps.length === 0) {
    // All opponents have responded - apply the Tempting Offer effect
    const responses = game.state.temptingOfferResponses[cardName];
    const acceptedBy = responses.acceptedBy;
    const initiatorBonusCount = 1 + acceptedBy.length; // Initiator gets effect once plus for each acceptor
    
    const completionPayload = applyTemptingOfferEffect(io, game, gameId, cardName, acceptedBy, initiator, initiatorBonusCount);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'temptingOfferComplete', {
        cardName,
        initiator,
        acceptedBy: [...acceptedBy],
        initiatorBonusCount,
        ...(completionPayload || {}),
      });
    } catch (err) {
      debugWarn(1, '[Resolution] appendEvent(temptingOfferComplete) failed:', err);
    }
    
    // Clean up
    delete game.state.temptingOfferResponses[cardName];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Apply the actual Tempting Offer effect
 */
export function applyTemptingOfferEffect(
  io: Server,
  game: any,
  gameId: string,
  cardName: string,
  acceptedBy: string[],
  initiator: string,
  initiatorBonusCount: number
): Record<string, any> | undefined {
  const cardNameLower = cardName.toLowerCase();
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  const result: Record<string, any> = {};
  
  debug(2, `[Resolution] Applying Tempting Offer effect: ${cardName}, ${acceptedBy.length} accepted, initiator gets ${initiatorBonusCount}x`);
  
  // Tempt with Discovery: Search for lands
  if (cardNameLower.includes('discovery')) {
    // Set up library search for initiator
    createLibrarySearchStep(game, gameId, initiator, {
      searchFor: `up to ${initiatorBonusCount} land card(s)`,
      destination: 'battlefield',
      tapped: false,
      optional: true,
      source: 'Tempt with Discovery',
      shuffleAfter: true,
      maxSelections: initiatorBonusCount,
      filter: { types: ['land'] },
    });
    
    // Each accepting opponent also searches
    for (const opponentId of acceptedBy) {
      createLibrarySearchStep(game, gameId, opponentId, {
        searchFor: 'a land card',
        destination: 'battlefield',
        tapped: false,
        optional: true,
        source: 'Tempt with Discovery',
        shuffleAfter: true,
        maxSelections: 1,
        filter: { types: ['land'] },
      });
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🌲 Tempt with Discovery: ${getPlayerName(game, initiator)} searches for up to ${initiatorBonusCount} land(s).${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) also search.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Glory: +1/+1 counters
  else if (cardNameLower.includes('glory')) {
    // Initiator's creatures get counters
    const initiatorCreatures = battlefield.filter((p: any) => 
      p.controller === initiator && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    );
    for (const creature of initiatorCreatures) {
      creature.counters = creature.counters || {};
      creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + initiatorBonusCount;
    }
    
    // Each accepting opponent's creatures get 1 counter
    for (const opponentId of acceptedBy) {
      const opponentCreatures = battlefield.filter((p: any) => 
        p.controller === opponentId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      for (const creature of opponentCreatures) {
        creature.counters = creature.counters || {};
        creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + 1;
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `✨ Tempt with Glory: ${getPlayerName(game, initiator)}'s creatures each get ${initiatorBonusCount} +1/+1 counter(s)!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s)' creatures each get 1 counter.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Vengeance: Create hasty Elemental tokens (X is approximated)
  else if (cardNameLower.includes('vengeance')) {
    // NOTE: True X should come from the spell's X value; this matches the prior legacy behavior.
    const xValue = 3;
    const createdPermanentIdsByPlayer: Record<string, string[]> = {};

    const elementalImageUrls = getTokenImageUrls('Elemental', 1, 1, ['R']);
    const ctx = { state: game.state } as any;

    const createdTokens: Array<{ token: any; controller: string }> = [];

    const initiatorTokenCount = xValue * initiatorBonusCount;
    createdPermanentIdsByPlayer[String(initiator)] = [];
    for (let i = 0; i < initiatorTokenCount; i++) {
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
      const token = {
        id: tokenId,
        controller: initiator,
        owner: initiator,
        tapped: false,
        counters: {},
        isToken: true,
        summoningSickness: false,
        card: {
          id: tokenId,
          name: 'Elemental',
          type_line: 'Token Creature — Elemental',
          power: '1',
          toughness: '1',
          colors: ['R'],
          oracle_text: 'Haste',
          keywords: ['Haste'],
          image_uris: elementalImageUrls,
        },
      };
      battlefield.push(token);
      stampPermanentEntryTimestamp(game.state, battlefield[battlefield.length - 1]);
      createdTokens.push({ token, controller: initiator });
      createdPermanentIdsByPlayer[String(initiator)].push(tokenId);
    }

    for (const opponentId of acceptedBy) {
      createdPermanentIdsByPlayer[String(opponentId)] = [];
      for (let i = 0; i < xValue; i++) {
        const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_opp_${i}`;
        const token = {
          id: tokenId,
          controller: opponentId,
          owner: opponentId,
          tapped: false,
          counters: {},
          isToken: true,
          summoningSickness: false,
          card: {
            id: tokenId,
            name: 'Elemental',
            type_line: 'Token Creature — Elemental',
            power: '1',
            toughness: '1',
            colors: ['R'],
            oracle_text: 'Haste',
            keywords: ['Haste'],
            image_uris: elementalImageUrls,
          },
        };
        battlefield.push(token);
        stampPermanentEntryTimestamp(game.state, battlefield[battlefield.length - 1]);
        createdTokens.push({ token, controller: opponentId });
        createdPermanentIdsByPlayer[String(opponentId)].push(tokenId);
      }
    }

    result.xValue = xValue;
    result.createdPermanentIdsByPlayer = createdPermanentIdsByPlayer;

    for (const { token, controller } of createdTokens) {
      triggerETBEffectsForToken(ctx, token, controller);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🔥 Tempt with Vengeance: ${getPlayerName(game, initiator)} creates ${initiatorTokenCount} hasty 1/1 Elemental tokens!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) each get ${xValue} tokens.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Bunnies: Create Rabbit tokens
  else if (cardNameLower.includes('bunnies')) {
    const rabbitImageUrls = getTokenImageUrls('Rabbit', 1, 1, ['W']);
    const ctx = { state: game.state } as any;
    const createdPermanentIdsByPlayer: Record<string, string[]> = {};

    const createdTokens: Array<{ token: any; controller: string }> = [];

    createdPermanentIdsByPlayer[String(initiator)] = [];
    for (let i = 0; i < initiatorBonusCount; i++) {
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_bunny_${i}`;
      const token = {
        id: tokenId,
        controller: initiator,
        owner: initiator,
        tapped: false,
        counters: {},
        isToken: true,
        summoningSickness: true,
        card: {
          id: tokenId,
          name: 'Rabbit',
          type_line: 'Token Creature — Rabbit',
          power: '1',
          toughness: '1',
          colors: ['W'],
          oracle_text: '',
          image_uris: rabbitImageUrls,
        },
      };
      battlefield.push(token);
      stampPermanentEntryTimestamp(game.state, battlefield[battlefield.length - 1]);
      createdTokens.push({ token, controller: initiator });
      createdPermanentIdsByPlayer[String(initiator)].push(tokenId);
    }

    for (const opponentId of acceptedBy) {
      createdPermanentIdsByPlayer[String(opponentId)] = [];
      const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_bunny_opp`;
      const token = {
        id: tokenId,
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        isToken: true,
        summoningSickness: true,
        card: {
          id: tokenId,
          name: 'Rabbit',
          type_line: 'Token Creature — Rabbit',
          power: '1',
          toughness: '1',
          colors: ['W'],
          oracle_text: '',
          image_uris: rabbitImageUrls,
        },
      };
      battlefield.push(token);
      stampPermanentEntryTimestamp(game.state, battlefield[battlefield.length - 1]);
      createdTokens.push({ token, controller: opponentId });
      createdPermanentIdsByPlayer[String(opponentId)].push(tokenId);
    }

    result.createdPermanentIdsByPlayer = createdPermanentIdsByPlayer;

    for (const { token, controller } of createdTokens) {
      triggerETBEffectsForToken(ctx, token, controller);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🐰 Tempt with Bunnies: ${getPlayerName(game, initiator)} creates ${initiatorBonusCount} 1/1 Rabbit token(s)!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) each get 1 token.` : ''}`,
      ts: Date.now(),
    });
  }
  // Add more Tempting Offer cards as needed (Reflections, Vengeance, Immortality, Bunnies, Mayhem)
  else {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🎁 ${cardName}: ${getPlayerName(game, initiator)} gets the effect ${initiatorBonusCount} time(s).${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) also get the effect.` : ''}`,
      ts: Date.now(),
    });
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

