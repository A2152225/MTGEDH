// server/src/state/modules/can-respond-handlers/canRespondCanCastAnySpell.ts
// Origin parent: server/src/state/modules/can-respond.ts
// Cluster moved: canCastAnySpell (response-mode getCastableSpellCandidates wrapper).
// Public entry symbols: canCastAnySpell.

import type { GameContext } from '../../context.js';
import type { PlayerID } from '../../../../../shared/src/index.js';
import { getCastableSpellCandidates } from './canRespondCastableSpellCandidates.js';

/**
 * Check if player can cast any instant or flash spell from hand, graveyard (flashback), 
 * or exile (foretell/impulse draw)
 */
export function canCastAnySpell(ctx: GameContext, playerId: PlayerID): boolean {
  return getCastableSpellCandidates(ctx, playerId, {
    mode: 'response',
    skipIgnoredCards: true,
    allowAlternateCosts: true,
    allowUnknownCostFallback: true,
    conservativeTargets: false,
  }).length > 0;
}
