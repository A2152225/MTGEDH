// server/src/socket/combat-handlers/combatBatch37Restrictions.ts
// Batch 37: "~ can't attack a player it has already attacked this turn." (Port Razer).
// History: state.attackedPlayersThisTurnByPermanentId[permanentId] = { turn, players }, written by
// recordPermanentAttackedPlayer from combatDeclareAttackersExecute.ts; the turn stamp makes it self-resetting.
// Origin parents: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason), combatDeclareAttackersExecute.ts.
// Public entry symbols: recordPermanentAttackedPlayer, alreadyAttackedPlayerRestrictionReason.

const ALREADY_RE = /can't attack a player it has already attacked this turn/;

function currentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
}

export function recordPermanentAttackedPlayer(state: any, permanentId: string, playerId: string): void {
  if (!state || !permanentId || !playerId) return;
  const turn = currentTurn(state);
  const map = state.attackedPlayersThisTurnByPermanentId = state.attackedPlayersThisTurnByPermanentId || {};
  const prev = map[permanentId];
  const players: string[] = prev && prev.turn === turn && Array.isArray(prev.players) ? prev.players : [];
  if (!players.includes(playerId)) players.push(playerId);
  map[permanentId] = { turn, players };
}

export function alreadyAttackedPlayerRestrictionReason(creature: any, defendingPlayerId: string | undefined, state: any): string | null {
  if (!defendingPlayerId) return null;
  const text = String(creature?.card?.oracle_text || creature?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
  if (!ALREADY_RE.test(text)) return null;
  const rec = state?.attackedPlayersThisTurnByPermanentId?.[String(creature?.id || '')];
  if (!rec || rec.turn !== currentTurn(state) || !Array.isArray(rec.players)) return null;
  return rec.players.includes(String(defendingPlayerId)) ? "can't attack a player it has already attacked this turn" : null;
}
