// server/src/state/modules/can-respond-handlers/canRespondPlayableLands.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: getPlayableLandCandidates, canPlayLand, hasPlayFromZoneEffect,
// hasPlayFromTopOfLibraryEffect, and land-play timing/face helpers.
// Public entry symbols: getPlayableLandCandidates, canPlayLand,
// isCardPlayableAsLandFromHand, getPlayableLandFaceIndex, getHandCastEvaluationCard.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { debug, debugWarn } from '../../../utils/debug.js';
import { calculateMaxLandsPerTurn } from '../game-state-effects.js';
import { hasExhaustedOnceDuringEachGraveyardCastActivation } from '../../../../../rules-engine/src/stationPermanentUtils.js';
import {
  cardAllowsPlayerToPlayFromExile,
  cardMeetsPlayFromExileConditions,
  getPlayableExileCardsForPlayer,
  getPlayableFromExileDurablePermissionForCard,
} from '../playable-from-exile.js';
import type { SharedLandSourceZone, SharedPlayableLandCandidate } from './canRespondTypes.js';
import { isTransformBackFace } from './canRespondTransformBackFace.js';
import {
  getTopLibraryCard,
  canPlayTopLibraryLand,
  isCardPlayableFromExile,
} from './canRespondTopLibraryFlashExile.js';
import { getSpecificLandFromGraveyardPermission, canPlaySpecificLandFromGraveyard } from './canRespondGraveyardLandPermission.js';
import { getHandCastEvaluationCards } from './canRespondHandCastEvaluation.js';
import { isInMainPhase } from './canRespondMainPhase.js';

function isLandPlayTimingWindowOpen(ctx: GameContext, playerId: PlayerID): boolean {
  const state = ctx?.state as any;
  const turnPlayer = String(state?.turnPlayer || state?.activePlayer || '').trim();
  const hasTurnPlayer = turnPlayer.length > 0;
  const isTurnPlayer = !hasTurnPlayer || turnPlayer === String(playerId || '');
  const stackEmpty = !Array.isArray(state?.stack) || state.stack.length === 0;
  const rawStep = String(state?.step || '').trim();
  const phase = String(state?.phase || '').toUpperCase();
  const hasTimingMarker = rawStep.length > 0 || phase.length > 0;
  const inMainPhase = !hasTimingMarker || isInMainPhase(ctx) || phase.includes('MAIN');

  return isTurnPlayer && stackEmpty && inMainPhase;
}



export function getHandCastEvaluationCard(card: any): any {
  const candidates = getHandCastEvaluationCards(card);
  return candidates[0] || card;
}

export function isCardPlayableAsLandFromHand(card: any): boolean {
  if (!card || typeof card === 'string') return false;
  if (isTransformBackFace(card)) return false;

  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if ((layout === 'transform' || layout === 'double_faced_token') && cardFaces.length >= 1) {
    return /\bland\b/i.test(String(cardFaces[0]?.type_line || ''));
  }

  if (layout === 'modal_dfc' && cardFaces.length >= 1) {
    return cardFaces.some((face: any) => /\bland\b/i.test(String(face?.type_line || '')));
  }

  return /\bland\b/i.test(String(card?.type_line || ''));
}

export function getPlayableLandFaceIndex(card: any): number | undefined {
  const layout = String(card?.layout || '').toLowerCase();
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];

  if (layout !== 'modal_dfc' || cardFaces.length === 0) {
    return undefined;
  }

  const landFaceIndex = cardFaces.findIndex((face: any) => /\bland\b/i.test(String(face?.type_line || '')));
  return landFaceIndex >= 0 ? landFaceIndex : undefined;
}

function hasRemainingLandPlay(ctx: GameContext, playerId: PlayerID): boolean {
  const state = ctx.state as any;
  const landsPlayedThisTurn = state?.landsPlayedThisTurn?.[playerId] ?? 0;
  const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx, playerId);
  return landsPlayedThisTurn < maxLandsPerTurn;
}

function canPlayLandFromGraveyard(ctx: GameContext, playerId: PlayerID): boolean {
  const graveyard = ctx?.state?.zones?.[playerId]?.graveyard;
  return Array.isArray(graveyard)
    ? graveyard.some((card: any) => canPlaySpecificLandFromGraveyard(ctx, playerId, card))
    : false;
}

function isLandPlayableFromExile(state: any, playerId: PlayerID, card: any): boolean {
  const playableCards = (state as any)?.playableFromExile?.[playerId];
  const currentTurn = Number((state as any)?.turnNumber ?? 0);
  const cardId = String(card?.id || card?.name || '');
  return (isCardPlayableFromExile(playableCards, cardId, currentTurn) && cardMeetsPlayFromExileConditions(state, card, playerId))
    || cardAllowsPlayerToPlayFromExile(card, playerId, currentTurn, state)
    || Boolean(getPlayableFromExileDurablePermissionForCard(state, playerId, card, 'play'));
}

export function getPlayableLandCandidates(
  ctx: GameContext,
  playerId: PlayerID,
  options?: { skipBattlefieldDuplicates?: boolean },
): SharedPlayableLandCandidate[] {
  try {
    const { state } = ctx;
    if (!state) return [];

    const zones = state.zones?.[playerId];
    if (!zones) return [];

    if (!isLandPlayTimingWindowOpen(ctx, playerId)) {
      return [];
    }

    if (!hasRemainingLandPlay(ctx, playerId)) {
      return [];
    }

    const skipBattlefieldDuplicates = options?.skipBattlefieldDuplicates === true;
    const battlefieldCardIds = skipBattlefieldDuplicates
      ? new Set(
          (Array.isArray(state.battlefield) ? state.battlefield : [])
            .filter((permanent: any) => permanent?.controller === playerId)
            .map((permanent: any) => String(permanent?.card?.id || ''))
            .filter((cardId: string) => cardId.length > 0),
        )
      : new Set<string>();
    const candidates: SharedPlayableLandCandidate[] = [];

    const pushCandidate = (
      card: any,
      sourceZone: SharedLandSourceZone,
      options?: {
        graveyardPermissionId?: string;
        graveyardPermissionSourceName?: string;
        leaveBattlefieldReplacementDestination?: 'exile';
        leaveBattlefieldReplacementSourceName?: string;
        leaveBattlefieldReplacementLifeGain?: number;
      },
    ) => {
      if (!card || typeof card === 'string') return;
      if (!isCardPlayableAsLandFromHand(card)) return;

      const cardId = String(card?.id || '');
      if (skipBattlefieldDuplicates && cardId && battlefieldCardIds.has(cardId)) {
        return;
      }

      candidates.push({
        card,
        sourceZone,
        selectedFaceIndex: getPlayableLandFaceIndex(card),
        ...(options?.graveyardPermissionId
          ? { castPermissionId: options.graveyardPermissionId, graveyardPermissionId: options.graveyardPermissionId }
          : {}),
        ...(options?.graveyardPermissionSourceName ? { graveyardPermissionSourceName: options.graveyardPermissionSourceName } : {}),
        ...(options?.leaveBattlefieldReplacementDestination ? { leaveBattlefieldReplacementDestination: options.leaveBattlefieldReplacementDestination } : {}),
        ...(options?.leaveBattlefieldReplacementSourceName ? { leaveBattlefieldReplacementSourceName: options.leaveBattlefieldReplacementSourceName } : {}),
        ...(options?.leaveBattlefieldReplacementLifeGain ? { leaveBattlefieldReplacementLifeGain: options.leaveBattlefieldReplacementLifeGain } : {}),
      });
    };

    const topCard = getTopLibraryCard(ctx, playerId);
    if (topCard && canPlayTopLibraryLand(ctx, playerId, topCard)) {
      pushCandidate(topCard, 'library');
    }

    if (Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        const specificPermission = getSpecificLandFromGraveyardPermission(ctx, playerId, card);
        if (!specificPermission.allowed) {
          continue;
        }
        pushCandidate(card, 'graveyard', specificPermission);
      }
    }

    for (const card of getPlayableExileCardsForPlayer(state, playerId)) {
      if (!isLandPlayableFromExile(state, playerId, card)) {
        continue;
      }
      pushCandidate(card, 'exile');
    }

    if (Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        pushCandidate(card, 'hand');
      }
    }

    return candidates;
  } catch (err) {
    debugWarn(1, '[getPlayableLandCandidates] Error:', err);
    return [];
  }
}

/**
 * Check if player can play a land
 * This includes:
 * - Having a land in hand (excluding transform back faces)
 * - Having a land in graveyard AND an effect that allows playing from graveyard
 * - Having a land in exile AND an effect that allows playing from exile
 * - Having pending play effects (impulse draw, etc.)
 * - Not having reached the land play limit for this turn
 * 
 * NOTE: Caller should verify game is in main phase with empty stack before calling
 */
export function canPlayLand(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) {
      debug(2, `[canPlayLand] ${playerId}: No state`);
      return false;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      debug(2, `[canPlayLand] ${playerId}: No zones found`);
      return false;
    }

    if (!isLandPlayTimingWindowOpen(ctx, playerId)) {
      const currentStep = String((state as any)?.step || '').toUpperCase();
      const currentPhase = String((state as any)?.phase || '').toUpperCase();
      const stackSize = Array.isArray((state as any)?.stack) ? (state as any).stack.length : 0;
      const turnPlayer = String((state as any)?.turnPlayer || (state as any)?.activePlayer || '');
      debug(2, `[canPlayLand] ${playerId}: Land timing window closed (step=${currentStep}, phase=${currentPhase}, stack=${stackSize}, turnPlayer=${turnPlayer})`);
      return false;
    }

    if (!hasRemainingLandPlay(ctx, playerId)) {
      const landsPlayedThisTurn = (state.landsPlayedThisTurn as any)?.[playerId] ?? 0;
      const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx, playerId);
      debug(2, `[canPlayLand] ${playerId}: Already played max lands this turn (${landsPlayedThisTurn}/${maxLandsPerTurn})`);
      return false;
    }

    if (!Array.isArray(zones.hand)) {
      debug(2, `[canPlayLand] ${playerId}: zones.hand is not an array:`, typeof zones.hand, zones.hand);
      if (zones.handCount && zones.handCount > 0) {
        debugWarn(1, `[canPlayLand] ${playerId}: WARNING - handCount=${zones.handCount} but zones.hand is not an array! This is a data consistency issue.`);
        return true;
      }
    }

    const candidates = getPlayableLandCandidates(ctx, playerId);
    if (candidates.length > 0) {
      const firstCandidate = candidates[0];
      debug(2, `[canPlayLand] ${playerId}: Found playable land in ${firstCandidate.sourceZone}: ${firstCandidate.card?.name || 'unknown'}`);
      return true;
    }

    debug(2, `[canPlayLand] ${playerId}: No playable land candidates found`);
    return false;
  } catch (err) {
    debugWarn(1, "[canPlayLand] Error:", err);
    return false;
  }
}

/**
 * Check if player has an effect that allows playing cards from a specific zone
 * @param zone - The zone to check (graveyard, exile, etc.)
 */
function hasPlayFromZoneEffect(ctx: GameContext, playerId: PlayerID, zone: string): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      // Only check permanents controlled by this player
      if (permanent.controller !== playerId) continue;
      
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      
      // Check for "you may play" or "you may cast" from the specified zone
      const hasPlayText = oracleText.includes("you may play") || oracleText.includes("you may cast");
      const hasZone = oracleText.includes(zone);
      
      if (hasPlayText && hasZone) {
        // For graveyard casting from Station cards, check charge counter threshold
        if (zone === "graveyard" && typeLine.includes("spacecraft")) {
          // Station cards: graveyard casting is threshold-gated
          // Check if the ability mentions "permanent spell" (Station restriction)
          if (oracleText.includes("permanent spell") && oracleText.includes("from your graveyard")) {
            // Parse required threshold - graveyard casting is typically at highest threshold
            // Pattern: "It's an artifact creature at N+." indicates when it becomes a creature
            const creatureMatch = oracleText.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
            if (creatureMatch) {
              const threshold = parseInt(creatureMatch[1], 10);
              const chargeCounters = (permanent as any).counters?.charge || 0;
              
              // Only allow graveyard casting if threshold is met
              if (chargeCounters >= threshold) {
                if (
                  /\bonce during each of your turns\b/i.test(oracleText)
                  && /\bfrom your graveyard\b/i.test(oracleText)
                  && hasExhaustedOnceDuringEachGraveyardCastActivation(
                    permanent as typeof permanent & { activatedAbilityIndicesThisTurn?: Record<number, true> },
                    state as typeof state & { castFromGraveyardThisTurn?: Record<string, boolean> },
                    playerId,
                  )
                ) {
                  continue;
                }
                return true;
              }
              // Threshold not met - continue checking other permanents
              continue;
            }
          }
        }
        
        // Additional check for lands specifically (Crucible of Worlds, etc.)
        if (zone === "graveyard" && oracleText.includes("land")) {
          return true;
        }
        
        // For exile, be more generous as it often comes from impulse draw effects
        if (zone === "exile") {
          return true;
        }
        
        // Generic graveyard casting (not Station-specific)
        if (zone === "graveyard" && !typeLine.includes("spacecraft")) {
          return true;
        }
      }
      
      // Special case: "play cards from exile" or "cast cards from exile"
      if (zone === "exile" && 
          (oracleText.includes("play") || oracleText.includes("cast")) && 
          oracleText.includes("from exile")) {
        return true;
      }
    }
    
    // Check for temporary effects stored in game state
    // Many impulse draw effects store exiled cards with "can play until end of turn" markers
    const stateAny = state as any;
    if (zone === "exile" && stateAny.playableFromExile) {
      const playableCards = stateAny.playableFromExile[playerId];
      const currentTurn = Number(stateAny?.turnNumber ?? 0);
      const playerExile = Array.isArray(stateAny?.zones?.[playerId]?.exile) ? stateAny.zones[playerId].exile : [];
      const hasUsableEntry = Array.isArray(playableCards)
        ? playableCards.some((cardId) => {
            const card = playerExile.find((entry: any) => String(entry?.id || entry?.name || '') === String(cardId || ''));
            return !card || cardMeetsPlayFromExileConditions(stateAny, card, playerId);
          })
        : Object.keys(playableCards || {}).some((cardId) => {
            if (!isCardPlayableFromExile(playableCards, cardId, currentTurn)) return false;
            const card = playerExile.find((entry: any) => String(entry?.id || entry?.name || '') === String(cardId || ''));
            return !card || cardMeetsPlayFromExileConditions(stateAny, card, playerId);
          });
      if (hasUsableEntry) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasPlayFromZoneEffect] Error:", err);
    return false;
  }
}

/**
 * Check if player has "play from top of library" effect
 * Examples: Experimental Frenzy, Future Sight, Bolas's Citadel
 */
function hasPlayFromTopOfLibraryEffect(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      // Only check permanents controlled by this player
      if (permanent.controller !== playerId) continue;
      
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      
      // Check for various patterns of "play from top of library"
      if ((oracleText.includes("you may play") || oracleText.includes("you may cast")) &&
          (oracleText.includes("top") || oracleText.includes("off the top")) &&
          (oracleText.includes("library") || oracleText.includes("your library"))) {
        return true;
      }
      
      // Special case for Experimental Frenzy and similar
      if (oracleText.includes("play") && 
          oracleText.includes("from the top of your library")) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasPlayFromTopOfLibraryEffect] Error:", err);
    return false;
  }
}
