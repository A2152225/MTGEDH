// rules-engine/src/batch97CoinFlipForce.ts
// B97: "The first time you flip one or more coins each turn, those coins come
// up heads and you win those flips." (Edgar, King of Figaro.) CR 705.3.
// Public: playerHasFirstFlipHeadsAndWin, isFirstCoinFlipEventThisTurn,
// markCoinFlipEventThisTurn, shouldForceFirstFlipHeadsAndWin.

const EDGAR_RE = /the first time you flip (?:one or more|\d+ or more|one|a coin|coins) coins? each turn, those coins come up heads and you win those flips/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

export function playerHasFirstFlipHeadsAndWin(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true || String(perm.controller || '') !== pid) return false;
    return EDGAR_RE.test(oracleOf(perm));
  });
}

function flipsAlreadyThisTurn(state: any, playerId: string): boolean {
  const rec = state?.coinFlipsThisTurn?.[playerId];
  if (Array.isArray(rec) && rec.length > 0) return true;
  if (state?.firstCoinFlipEventForcedThisTurn?.[playerId] === true) return true;
  return false;
}

export function isFirstCoinFlipEventThisTurn(state: any, playerId: string): boolean {
  return !flipsAlreadyThisTurn(state, playerId);
}

export function markCoinFlipEventThisTurn(state: any, playerId: string): void {
  if (!state || !playerId) return;
  state.firstCoinFlipEventForcedThisTurn = state.firstCoinFlipEventForcedThisTurn || {};
  state.firstCoinFlipEventForcedThisTurn[playerId] = true;
}

/** True when this player's current flip event should be forced heads-and-win. */
export function shouldForceFirstFlipHeadsAndWin(state: any, playerId: string): boolean {
  return playerHasFirstFlipHeadsAndWin(state, playerId) && isFirstCoinFlipEventThisTurn(state, playerId);
}
