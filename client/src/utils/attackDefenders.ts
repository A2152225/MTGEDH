// Attackable permanents (CR 506.3 / 508.1b): an attacking creature may attack a defending player,
// a planeswalker that player controls, or a battle that player protects.
import { playerIsLegalAttackTarget } from '../../../rules-engine/src/playerInGameStatus';

export type AttackDefenderRef = { id: string; name: string; defendingPlayerId?: string; isPermanent?: boolean };

/** Legal defending players followed by the planeswalkers and battles they can be attacked through. */
export function buildAttackDefenders(players: readonly any[] | undefined, battlefield: readonly any[] | undefined, attackingPlayerId: string): AttackDefenderRef[] {
  const legalPlayers = (players || []).filter((p: any) => playerIsLegalAttackTarget(p, attackingPlayerId));
  const nameById = new Map<string, string>(legalPlayers.map((p: any) => [String(p.id), String(p.name || p.id)]));
  const out: AttackDefenderRef[] = legalPlayers.map((p: any) => ({ ...p }));
  for (const perm of battlefield || []) {
    if (!perm?.id || perm.phasedOut === true) continue;
    const typeLine = String(perm?.card?.type_line || '').toLowerCase();
    const isPlaneswalker = /\bplaneswalker\b/.test(typeLine);
    const isBattle = /\bbattle\b/.test(typeLine);
    if (!isPlaneswalker && !isBattle) continue;
    const defendingPlayerId = String((isBattle ? perm.protector || perm.protectorId : null) || perm.controller || '');
    const defenderName = nameById.get(defendingPlayerId);
    if (!defenderName) continue;
    const cardName = String(perm?.card?.name || (isBattle ? 'Battle' : 'Planeswalker'));
    out.push({ id: String(perm.id), name: `${cardName} (${defenderName})`, defendingPlayerId, isPermanent: true });
  }
  return out;
}