/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: activated-ability text match, resolver candidates,
 * resolveAIActivatedAbilityId, didAIAbilityActivationProgress,
 * requestAISharedBattlefieldAbilityActivation.
 *
 * Public entry symbols: buildAIActivatedAbilityResolverCandidates,
 * resolveAIActivatedAbilityId, didAIAbilityActivationProgress,
 * requestAISharedBattlefieldAbilityActivation.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import {
  isStationPermanentTypeLine,
  readStationChargeCreatureThresholdFromOracleText,
} from "../../../../rules-engine/src/stationPermanentUtils.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debugError, debugWarn } from "../../utils/debug.js";
import { ensureGame, getOrInitManaPool } from "../util.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { snapshotAIAbilityActivationState } from "./aiAbilityActivationSnapshot.js";
import type {
  AIAbilityActivationSnapshot,
  AIActivatedAbilityResolverCandidate,
} from "./aiAbilityActivationTypes.js";

async function handleAIResolutionStep(io: Server, gameId: string, playerId: PlayerID, step: any): Promise<void> {
  return getAIHandlerDeps().handleAIResolutionStep(io, gameId, playerId, step);
}

function normalizeAIActivatedAbilityText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAIActivatedAbilityKeywordMatchScore(requestedText: string, candidateText: string): number {
  if (!requestedText || !candidateText) {
    return 0;
  }

  const trackedKeywords = [
    'sacrifice',
    'draw',
    'search your library',
    'add',
    'mana',
    'damage',
    'destroy',
    'exile',
    'counter',
    'token',
    'target',
    'crew',
    'station',
    'level up',
    'outlast',
    'boast',
    'monstrosity',
    'adapt',
    'fortify',
    'reconfigure',
    'attach',
    'unattach',
  ];

  let score = 0;
  for (const keyword of trackedKeywords) {
    if (requestedText.includes(keyword) && candidateText.includes(keyword)) {
      score += 15;
    }
  }

  return score;
}

export function buildAIActivatedAbilityResolverCandidates(permanent: any): AIActivatedAbilityResolverCandidate[] {
  const card = permanent?.card || {};
  const cardId = String(card?.id || permanent?.id || '').trim();
  const nativeOracleText = String(card?.oracle_text || '').trim();
  const lowerOracleText = nativeOracleText.toLowerCase();
  const typeLine = String(card?.type_line || '').toLowerCase();
  const candidates: AIActivatedAbilityResolverCandidate[] = [];

  if (!cardId || !nativeOracleText) {
    return candidates;
  }

  let genericAbilityIndex = 0;

  if (typeLine.includes('planeswalker')) {
    const loyaltyAbilityPattern = /^([+−–—-]?\d+):\s*(.+)/gm;
    let loyaltyMatch: RegExpExecArray | null;
    let loyaltyIndex = 0;
    while ((loyaltyMatch = loyaltyAbilityPattern.exec(nativeOracleText)) !== null) {
      const loyaltyCost = String(loyaltyMatch[1] || '').replace(/[−–—]/g, '-').trim();
      const effectText = String(loyaltyMatch[2] || '').trim();
      if (!effectText) continue;
      candidates.push({
        id: `pw-ability-${loyaltyIndex++}`,
        text: `${loyaltyCost}: ${effectText}`,
        effect: effectText,
      });
    }
    return candidates;
  }

  const lines = nativeOracleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Return[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const textOnlyActivatedAbilityPattern = /^((?:Sacrifice|Discard|Pay|Exile|Remove|Return|Tap|Untap)[^:]*?)\s*:\s*(.+)$/i;

  for (const line of lines) {
    const activatedMatch = line.match(activatedAbilityPattern);
    if (activatedMatch) {
      const costText = String(activatedMatch[1] || '').trim();
      const effectText = String(activatedMatch[2] || '').trim();
      if (!costText || !effectText) continue;
      candidates.push({
        id: `${cardId}-ability-${genericAbilityIndex++}`,
        text: `${costText}: ${effectText}`,
        effect: effectText,
      });
      continue;
    }

    const textOnlyMatch = line.match(textOnlyActivatedAbilityPattern);
    if (textOnlyMatch) {
      const costText = String(textOnlyMatch[1] || '').trim();
      const effectText = String(textOnlyMatch[2] || '').trim();
      if (!costText || !effectText) continue;
      candidates.push({
        id: `${cardId}-ability-${genericAbilityIndex++}`,
        text: `${costText}: ${effectText}`,
        effect: effectText,
      });
    }
  }

  const reconfigureMatch = nativeOracleText.match(/reconfigure\s*(\{[^}]+\}|\d+)/i);
  if (reconfigureMatch && typeLine.includes('equipment')) {
    const reconfigureCost = reconfigureMatch[1].startsWith('{') ? reconfigureMatch[1] : `{${reconfigureMatch[1]}}`;
    candidates.push({
      id: `${cardId}-reconfigure-attach-0`,
      text: `Reconfigure ${reconfigureCost} attach`,
      effect: 'attach to target creature you control',
    });
    candidates.push({
      id: `${cardId}-reconfigure-unattach-1`,
      text: `Reconfigure ${reconfigureCost} unattach`,
      effect: 'unattach this equipment',
    });
  }

  const crewMatch = nativeOracleText.match(/crew\s*(\d+)/i);
  if (crewMatch && typeLine.includes('vehicle')) {
    candidates.push({
      id: `${cardId}-crew-0`,
      text: `Crew ${crewMatch[1]}`,
      effect: `crew ${crewMatch[1]}`,
    });
  }

  const stationThreshold = readStationChargeCreatureThresholdFromOracleText(nativeOracleText);
  if (isStationPermanentTypeLine(typeLine) || lowerOracleText.includes('station')) {
    candidates.push({
      id: `${cardId}-station-0`,
      text: stationThreshold > 0 ? `Station ${stationThreshold}` : 'Station',
      effect: stationThreshold > 0 ? `station ${stationThreshold}` : 'station',
    });
  }

  const levelUpMatch = nativeOracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (levelUpMatch) {
    candidates.push({
      id: `${cardId}-level-up-0`,
      text: `Level up ${levelUpMatch[1]}`,
      effect: 'put a level counter on this permanent',
    });
  }

  const outlastMatch = nativeOracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (outlastMatch) {
    candidates.push({
      id: `${cardId}-outlast-0`,
      text: `Outlast ${outlastMatch[1]}`,
      effect: 'put a +1/+1 counter on this creature',
    });
  }

  const boastMatch = nativeOracleText.match(/boast\s*[—-]\s*(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*([^.]+)/i);
  if (boastMatch) {
    candidates.push({
      id: `${cardId}-boast-0`,
      text: `Boast ${boastMatch[1]}: ${String(boastMatch[2] || '').trim()}`,
      effect: String(boastMatch[2] || '').trim(),
    });
  }

  const monstrosityMatch = nativeOracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
  if (monstrosityMatch) {
    candidates.push({
      id: `${cardId}-monstrosity-0`,
      text: `${monstrosityMatch[1]}: Monstrosity ${monstrosityMatch[2]}`,
      effect: `monstrosity ${monstrosityMatch[2]}`,
    });
  }

  const adaptMatch = nativeOracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
  if (adaptMatch) {
    candidates.push({
      id: `${cardId}-adapt-0`,
      text: `${adaptMatch[1]}: Adapt ${adaptMatch[2]}`,
      effect: `adapt ${adaptMatch[2]}`,
    });
  }

  const fortifyMatch = nativeOracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (fortifyMatch && typeLine.includes('fortification')) {
    candidates.push({
      id: `${cardId}-fortify-0`,
      text: `Fortify ${fortifyMatch[1]}`,
      effect: 'attach this fortification to target land you control',
    });
  }

  return candidates;
}

export function resolveAIActivatedAbilityId(action: any, permanent: any): string | undefined {
  const explicitAbilityId = String(action?.abilityId || '').trim();
  if (explicitAbilityId) {
    return explicitAbilityId;
  }

  const candidates = buildAIActivatedAbilityResolverCandidates(permanent);
  if (candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0].id;
  }

  const requestedText = normalizeAIActivatedAbilityText(String(action?.abilityText || ''));
  if (!requestedText) {
    return candidates[0].id;
  }

  let bestCandidate: AIActivatedAbilityResolverCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const candidateText = normalizeAIActivatedAbilityText(candidate.text);
    const candidateEffect = normalizeAIActivatedAbilityText(String(candidate.effect || ''));
    let score = 0;

    if (requestedText === candidateText) {
      score += 1000;
    }
    if (candidateEffect && requestedText === candidateEffect) {
      score += 900;
    }
    if (requestedText.includes(candidateText)) {
      score += 400 + candidateText.length;
    }
    if (candidateText.includes(requestedText)) {
      score += 250 + requestedText.length;
    }
    if (candidateEffect && requestedText.includes(candidateEffect)) {
      score += 200 + candidateEffect.length;
    }

    score += getAIActivatedAbilityKeywordMatchScore(requestedText, candidateText);

    if (/reconfigure/i.test(candidateText)) {
      const attachedTo = String((permanent as any)?.attachedTo || '').trim();
      const isAttachCandidate = /\battach\b/.test(candidateText) && !candidateText.includes('unattach');
      const isUnattachCandidate = candidateText.includes('unattach');
      if (attachedTo && isUnattachCandidate) {
        score += 50;
      }
      if (!attachedTo && isAttachCandidate) {
        score += 50;
      }
      // When attached, prefer attach (direct host swap) over unattach-only.
      if (attachedTo && isAttachCandidate) {
        score += 60;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate?.id || candidates[0].id;
}




export function didAIAbilityActivationProgress(
  before: AIAbilityActivationSnapshot,
  after: AIAbilityActivationSnapshot,
): boolean {
  return (
    after.stackLength > before.stackLength ||
    after.pendingSteps > before.pendingSteps ||
    after.manaPoolKey !== before.manaPoolKey ||
    after.lifeTotal !== before.lifeTotal ||
    after.battlefieldCount !== before.battlefieldCount ||
    after.graveyardCount !== before.graveyardCount ||
    after.handCount !== before.handCount ||
    after.exileCount !== before.exileCount ||
    after.permanentExists !== before.permanentExists ||
    after.permanentTapped !== before.permanentTapped
  );
}

export async function requestAISharedBattlefieldAbilityActivation(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  request: {
    permanentId: string;
    abilityId: string;
    xValue?: unknown;
    drainQueuedSteps?: boolean;
  },
): Promise<boolean> {
  const game = ensureGame(gameId);
  if (!game) return false;

  const permanentId = String(request.permanentId || '').trim();
  const abilityId = String(request.abilityId || '').trim();
  if (!permanentId || !abilityId) {
    return false;
  }

  const before = snapshotAIAbilityActivationState(game, gameId, playerId, permanentId);

  try {
    const { registerInteractionHandlers } = await import('../interaction.js');
    const handlers: Record<string, (payload?: any) => any> = {};
    const aiSocket = {
      data: { playerId, gameId, spectator: false, isSpectator: false },
      rooms: new Set([gameId]),
      on: (event: string, handler: (payload?: any) => any) => {
        handlers[event] = handler;
      },
      emit: (event: string, payload: any) => {
        if (event === 'error') {
          debugWarn(1, '[AI] Shared battlefield activation rejected ability:', {
            gameId,
            playerId,
            permanentId,
            abilityId,
            payload,
          });
        }
      },
    } as any;

    registerInteractionHandlers(io, aiSocket);

    const handler = handlers.activateBattlefieldAbility;
    if (typeof handler !== 'function') {
      debugWarn(1, '[AI] Failed to locate shared activateBattlefieldAbility handler');
      return false;
    }

    await handler({
      gameId,
      permanentId,
      abilityId,
      ...(request.xValue !== undefined ? { xValue: request.xValue } : {}),
    });

    await Promise.resolve();

    if (request.drainQueuedSteps) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const queue = ResolutionQueueManager.getQueue(gameId);
        const aiStep = queue?.steps?.find((step: any) => step?.playerId === playerId);
        if (!aiStep) {
          break;
        }

        const manaBefore = JSON.stringify(getOrInitManaPool(game.state, String(playerId)) || {});
        const pendingBefore = Array.isArray(queue?.steps) ? queue.steps.length : 0;
        await handleAIResolutionStep(io, gameId, playerId, aiStep);
        await Promise.resolve();

        const nextQueue = ResolutionQueueManager.getQueue(gameId);
        const manaAfter = JSON.stringify(getOrInitManaPool(game.state, String(playerId)) || {});
        const pendingAfter = Array.isArray(nextQueue?.steps) ? nextQueue.steps.length : 0;
        if (manaAfter === manaBefore && pendingAfter >= pendingBefore) {
          break;
        }
      }
    }

    const after = snapshotAIAbilityActivationState(game, gameId, playerId, permanentId);
    const progressed = didAIAbilityActivationProgress(before, after);
    if (!progressed) {
      debugWarn(1, '[AI] Shared battlefield activation produced no state change:', {
        gameId,
        playerId,
        permanentId,
        abilityId,
      });
    }

    return progressed;
  } catch (error) {
    debugError(1, '[AI] Error activating ability via shared battlefield handler:', error);
    return false;
  }
}
