// server/src/state/modules/foretellFirstCostGrant.ts
// Ranar the Ever-Watchful family: "The first card you foretell each turn costs {0} to foretell."
// Public: parseFirstForetellCostsZero, playerHasFirstForetellZeroGrant,
//   getForetellActionGenericCost, recordForetellActionThisTurn.

const FIRST_FORETELL_ZERO_RE =
  /the first card you foretell each turn costs \{0\} to foretell/i;

const DEFAULT_FORETELL_ACTION_GENERIC = 2;

function currentTurnNumber(state: any): number {
  const n = Number(state?.turnNumber ?? state?.turn ?? state?.turnCount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function parseFirstForetellCostsZero(oracleText: string): boolean {
  return FIRST_FORETELL_ZERO_RE.test(String(oracleText || '').replace(/\u2019/g, "'"));
}

export function playerHasFirstForetellZeroGrant(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid) return false;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    if (String(permanent.controller || '') !== pid) continue;
    const oracle = String(permanent.card?.oracle_text || permanent.oracle_text || '');
    if (parseFirstForetellCostsZero(oracle)) return true;
  }
  return false;
}

function alreadyForetoldThisTurn(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const turn = currentTurnNumber(state);
  const recorded = state?.foretoldThisTurn;
  if (!recorded || typeof recorded !== 'object') return false;
  const entry = recorded[pid];
  if (entry === true) return true;
  if (entry && typeof entry === 'object') {
    return Number((entry as any).turn) === turn && Boolean((entry as any).used);
  }
  if (typeof entry === 'number') return entry === turn;
  return false;
}

/** Generic mana needed to take the foretell special action ({2}, or {0} for the first one under Ranar). */
export function getForetellActionGenericCost(state: any, playerId: string): number {
  if (playerHasFirstForetellZeroGrant(state, playerId) && !alreadyForetoldThisTurn(state, playerId)) {
    return 0;
  }
  return DEFAULT_FORETELL_ACTION_GENERIC;
}

export function recordForetellActionThisTurn(state: any, playerId: string): void {
  if (!state || !playerId) return;
  const pid = String(playerId);
  if (!state.foretoldThisTurn || typeof state.foretoldThisTurn !== 'object') {
    state.foretoldThisTurn = {};
  }
  state.foretoldThisTurn[pid] = { turn: currentTurnNumber(state), used: true };
}
