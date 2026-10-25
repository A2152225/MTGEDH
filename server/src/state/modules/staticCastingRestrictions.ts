// server/src/state/modules/staticCastingRestrictions.ts
// Live-cast wrapper around rules-engine canCastSpell (Silence, Rule of Law,
// land-count mana-value like Lavinia).
// Public entry symbols: isSpellCastingProhibitedByStaticRestriction.

import type { GameState, PlayerID } from '../../../../shared/src/index.js';
import { canCastSpell } from '../../../../rules-engine/src/castingRestrictions.js';
import { findOracleCastingLimitViolation } from './staticCastingRestrictionsOracleExtras.js';

function countSpellsCastThisTurnByPlayer(state: any, playerId: string): number {
  const list = state?.spellsCastThisTurn;
  if (Array.isArray(list)) {
    const casterId = String(playerId || '').trim();
    return list.filter((entry: any) => {
      const caster = String(
        entry?.casterId ?? entry?.playerId ?? entry?.controllerId ?? '',
      ).trim();
      return caster === casterId;
    }).length;
  }
  const keyed = Number(list?.[playerId] ?? 0);
  return Number.isFinite(keyed) ? Math.max(0, keyed) : 0;
}

export function isSpellCastingProhibitedByStaticRestriction(
  state: any,
  playerId: PlayerID | string,
  spell: any,
  castingZone: string = 'hand',
): { prohibited: boolean; reason?: string } {
  if (!state || !spell || !Array.isArray(state.players)) return { prohibited: false };
  const result = canCastSpell(
    state as GameState,
    String(playerId),
    spell,
    countSpellsCastThisTurnByPlayer(state, String(playerId)),
    castingZone,
  );
  if (result.canCast) return findOracleCastingLimitViolation(state, String(playerId), spell);
  return {
    prohibited: true,
    reason: result.reason || 'An effect prevents you from casting that spell.',
  };
}
