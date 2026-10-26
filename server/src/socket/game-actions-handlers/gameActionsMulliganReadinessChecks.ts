/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: pre-game readiness and mulligan bookkeeping - the free-mulligan
 * house rule, effective mulligan counts, and the "is everyone done" checks for
 * mulligans, kept hands and submitted decks.
 *
 * Public entry symbols: calculateEffectiveMulliganCount, shouldMulliganBeFree,
 * checkAllPlayersKeptHands, checkAllPlayersHaveDecks.
 */
import { debug, debugWarn } from "../../utils/debug.js";
import { isAiSeatId } from "../join-handlers/playerSeatIds.js";

/**
 * Check if a hand qualifies for a free mulligan under "no lands or all lands" house rule.
 * Returns true if the hand has 0 lands or all cards are lands.
 */
function handHasNoLandsOrAllLands(hand: any[]): boolean {
  if (!Array.isArray(hand) || hand.length === 0) return false;

  let landCount = 0;
  for (const card of hand) {
    if (!card) continue;
    const typeLine = String(card.type_line || "").toLowerCase();
    if (/\bland\b/.test(typeLine)) {
      landCount++;
    }
  }

  // No lands or all lands
  return landCount === 0 || landCount === hand.length;
}

/**
 * Check if all human (non-AI, non-spectator) players have mulliganed in the current round.
 * Used for the "group mulligan discount" house rule.
 */
function checkAllHumanPlayersMulliganed(game: any): boolean {
  try {
    const players = game.state?.players || [];
    const mulliganState = (game.state as any)?.mulliganState || {};

    const humanPlayers = players.filter((p: any) =>
      p && !p.spectator && !p.isSpectator && !p.isAI && p.id && !isAiSeatId(p.id)
    );

    if (humanPlayers.length === 0) return false;

    // Check if all human players have mulliganed at least once
    for (const player of humanPlayers) {
      const playerMulliganState = mulliganState[player.id];
      if (!playerMulliganState || (playerMulliganState.mulligansTaken || 0) === 0) {
        return false;
      }
    }

    return true;
  } catch (err) {
    debugWarn(1, "checkAllHumanPlayersMulliganed failed:", err);
    return false;
  }
}

/**
 * Calculate the effective mulligan count for a player based on game rules.
 * This determines how many cards they need to put back when keeping their hand.
 *
 * In multiplayer games (3+ players), the first mulligan is always free per
 * official Commander/multiplayer rules (rule 103.5a). This is now baseline behavior.
 */
export function calculateEffectiveMulliganCount(
  actualMulligans: number,
  game: any,
  playerId: string
): number {
  if (actualMulligans === 0) return 0;

  const houseRules = game.state?.houseRules || {};
  const players = game.state?.players || [];
  const isMultiplayer = players.filter((p: any) => p && !p.spectator && !p.isSpectator).length > 2;

  let effectiveCount = actualMulligans;

  // Free first mulligan in multiplayer (Commander rule 103.5a)
  if (isMultiplayer && actualMulligans >= 1) {
    effectiveCount = Math.max(0, actualMulligans - 1);
    debug(1, `[mulligan] Free first mulligan applied for ${playerId} (multiplayer baseline): ${actualMulligans} -> ${effectiveCount}`);
  }

  // Group mulligan discount: if enabled and all human players mulliganed, reduce by 1
  if (houseRules.groupMulliganDiscount && checkAllHumanPlayersMulliganed(game)) {
    effectiveCount = Math.max(0, effectiveCount - 1);
    debug(1, `[mulligan] Group mulligan discount applied for ${playerId}: effective count now ${effectiveCount}`);
  }

  return effectiveCount;
}

/**
 * Check if a mulligan should be free due to "no lands or all lands" house rule.
 * This is checked before taking the mulligan.
 */
export function shouldMulliganBeFree(game: any, playerId: string): boolean {
  const houseRules = game.state?.houseRules || {};
  
  if (!houseRules.freeMulliganNoLandsOrAllLands) {
    return false;
  }
  
  // Get the player's current hand
  const zones = game.state?.zones?.[playerId];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  
  return handHasNoLandsOrAllLands(hand);
}

/**
 * Check if all non-spectator players have kept their hands during pre-game.
 * Returns { allKept: boolean, waitingPlayers: string[] }
 */
export function checkAllPlayersKeptHands(game: any): { allKept: boolean; waitingPlayers: string[] } {
  try {
    const players = game.state?.players || [];
    const mulliganState = (game.state as any)?.mulliganState || {};
    
    const nonSpectatorPlayers = players.filter((p: any) => p && !p.spectator && !p.isSpectator);
    const waitingPlayers: string[] = [];
    
    for (const player of nonSpectatorPlayers) {
      const playerId = player.id;
      const playerMulliganState = mulliganState[playerId];
      
      // Player hasn't kept their hand if:
      // 1. No mulligan state exists, OR
      // 2. hasKeptHand is explicitly false, OR
      // 3. Still choosing cards to put on the bottom (London mulligan)
      if (
        !playerMulliganState ||
        !playerMulliganState.hasKeptHand ||
        Number(playerMulliganState.pendingBottomCount || 0) > 0
      ) {
        waitingPlayers.push(player.name || playerId);
      }
    }
    
    return {
      allKept: waitingPlayers.length === 0,
      waitingPlayers,
    };
  } catch (err) {
    debugWarn(1, "checkAllPlayersKeptHands failed:", err);
    return { allKept: false, waitingPlayers: [] };
  }
}

/**
 * Check if all non-spectator players have imported/selected their decks.
 * A player has a deck if their library has cards (libraryCount > 0).
 * Returns { allHaveDecks: boolean, waitingPlayers: string[] }
 */
export function checkAllPlayersHaveDecks(game: any): { allHaveDecks: boolean; waitingPlayers: string[] } {
  try {
    const players = game.state?.players || [];
    const zones = game.state?.zones || {};
    
    const nonSpectatorPlayers = players.filter((p: any) => p && !p.spectator && !p.isSpectator);
    const waitingPlayers: string[] = [];
    
    for (const player of nonSpectatorPlayers) {
      const playerId = player.id;
      const playerZones = zones[playerId];
      
      // Player doesn't have a deck if:
      // 1. No zones exist for them, OR
      // 2. libraryCount is 0 or undefined AND handCount is 0 or undefined
      // (hand can have cards if they've drawn already)
      const libraryCount = playerZones?.libraryCount ?? 0;
      const handCount = playerZones?.handCount ?? 0;
      
      if (libraryCount === 0 && handCount === 0) {
        waitingPlayers.push(player.name || playerId);
      }
    }
    
    return {
      allHaveDecks: waitingPlayers.length === 0,
      waitingPlayers,
    };
  } catch (err) {
    debugWarn(1, "checkAllPlayersHaveDecks failed:", err);
    return { allHaveDecks: false, waitingPlayers: [] };
  }
}
