// Cluster: this-turn lastingEffects attackProhibitedThisTurn
//   ("If they don't, creatures they control can't attack Jaces you control this turn",
//   Jace, Multiverse Architect). Stamped by rules-engine
//   oracleIRExecutorAttackProhibitedThisTurn; cleanup expires it.
// Public: collectThisTurnAttackProhibition

const STAMP_TYPE = 'attackProhibitedThisTurn';

interface AttackProhibitedThisTurnStamp {
  type?: string;
  attackerController?: string;
  protectedController?: string;
  protectsPlayer?: boolean;
  protectedPermanentTypes?: unknown;
  source?: string;
  turnApplied?: number;
}

function currentTurnNumber(state: any): number | null {
  const turn = Number(state?.turnNumber ?? state?.turn);
  return Number.isFinite(turn) ? turn : null;
}

function permanentTypeWords(permanent: any): Set<string> {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return new Set(typeLine.split(/[^a-z'-]+/).filter(Boolean));
}

/**
 * Returns the source name when this attack is illegal because of a this-turn
 * "creatures <player> control can't attack <you / Xs you control>" restriction, else null.
 */
export function collectThisTurnAttackProhibition(
  state: any,
  attacker: { controller?: unknown } | null | undefined,
  target: { targetPlayerId?: unknown; targetPermanentId?: unknown },
): string | null {
  const effects = Array.isArray(state?.lastingEffects) ? state.lastingEffects : [];
  if (effects.length === 0 || !attacker) return null;
  const attackerController = String(attacker.controller || '').trim();
  if (!attackerController) return null;

  const targetPlayerId = String(target?.targetPlayerId || '').trim();
  const targetPermanentId = String(target?.targetPermanentId || '').trim();
  const targetPermanent = targetPermanentId
    ? (Array.isArray(state?.battlefield) ? state.battlefield : [])
      .find((perm: any) => String(perm?.id || '') === targetPermanentId)
    : undefined;
  const turn = currentTurnNumber(state);

  for (const entry of effects) {
    const stamp = entry as AttackProhibitedThisTurnStamp;
    if (String(stamp?.type || '') !== STAMP_TYPE) continue;
    if (String(stamp.attackerController || '').trim() !== attackerController) continue;
    const applied = Number(stamp.turnApplied);
    if (turn !== null && Number.isFinite(applied) && applied !== turn) continue;
    const protectedController = String(stamp.protectedController || '').trim();
    if (!protectedController) continue;
    const source = String(stamp.source || 'an effect');

    if (targetPermanent) {
      if (String(targetPermanent.controller || '').trim() !== protectedController) continue;
      const types = Array.isArray(stamp.protectedPermanentTypes)
        ? stamp.protectedPermanentTypes.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean)
        : [];
      const words = permanentTypeWords(targetPermanent);
      if (types.some((type) => words.has(type))) return source;
      continue;
    }

    if (targetPlayerId && stamp.protectsPlayer === true && targetPlayerId === protectedController) {
      return source;
    }
  }
  return null;
}