// rules-engine/src/sacrificeCauseProtection.ts
// B39: "Spells and abilities your opponents control can't cause you to sacrifice permanents."
// (Tajuru Preserver, Sigarda Host of Herons.) One helper shared by every effect-driven sacrifice seam:
// - IR sacrifice steps (oracleIRExecutorBattlefieldSacrificeSteps.ts applySacrificeStep) hide the protected
//   player's permanents from the step when the effect's controller is an opponent.
// - The server edict prompt (server/src/socket/sacrifice-resolution.ts) skips protected players.
// Costs the player pays themself are not affected (they are not caused by an opponent).
// Public entry symbols: playerProtectedFromOpponentSacrifice, sacrificeShieldedPermanentIds, withSacrificeCauseProtection.

const PROTECT_RE = /spells and abilities your opponents control can't cause you to sacrifice permanents/;

function lowerOracle(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
}

export function playerProtectedFromOpponentSacrifice(
  battlefield: readonly any[] | undefined,
  playerId: string,
  sourceControllerId: string | undefined | null,
): boolean {
  if (!sourceControllerId || !playerId || String(sourceControllerId) === String(playerId)) return false;
  const bf = Array.isArray(battlefield) ? battlefield : [];
  return bf.some((p: any) => p && !p.phasedOut && String(p.controller || '') === String(playerId) && PROTECT_RE.test(lowerOracle(p)));
}

export function sacrificeShieldedPermanentIds(battlefield: readonly any[] | undefined, sourceControllerId: string | undefined | null): Set<string> {
  const out = new Set<string>();
  if (!sourceControllerId) return out;
  const bf = Array.isArray(battlefield) ? battlefield : [];
  const protectedPlayers = new Set<string>();
  for (const p of bf) {
    const c = String(p?.controller || '');
    if (c && c !== String(sourceControllerId) && !p?.phasedOut && PROTECT_RE.test(lowerOracle(p))) protectedPlayers.add(c);
  }
  if (protectedPlayers.size === 0) return out;
  for (const p of bf) if (p && protectedPlayers.has(String(p.controller || ''))) out.add(String(p.id));
  return out;
}

/** Runs a sacrifice step with protected permanents hidden, then puts them back. */
export function withSacrificeCauseProtection<S extends { battlefield?: any }, R>(
  state: S,
  sourceControllerId: string | undefined | null,
  run: (s: S) => R,
): R {
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const shielded = sacrificeShieldedPermanentIds(bf, sourceControllerId);
  if (shielded.size === 0) return run(state);
  const hidden = bf.filter((p: any) => shielded.has(String(p?.id)));
  const result: any = run({ ...state, battlefield: bf.filter((p: any) => !shielded.has(String(p?.id))) });
  if (result && result.state && Array.isArray(result.state.battlefield)) {
    const present = new Set(result.state.battlefield.map((p: any) => String(p?.id)));
    result.state = { ...result.state, battlefield: [...result.state.battlefield, ...hidden.filter((p: any) => !present.has(String(p?.id)))] };
  }
  return result as R;
}
