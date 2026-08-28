// server/src/socket/ai-handlers/aiAutoPassContextualIdle.ts
// Origin parent: server/src/state/modules/priority.ts autoPassLoop
// Cluster: AI auto-pass should ignore legal-but-pointless instants/flash so
// autoPassLoop does not stop and run the full AI think path.
// Public entry symbols: isAiContextuallyIdleForAutoPass.
// Lives on the socket side to avoid can-respond.ts <-> game-actions cycles.

import type { GameContext } from '../../state/context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { isSpellCastBoardContextUseful } from '../spellCastBoardContext.js';
import { getCastableSpellCandidates } from '../../state/modules/can-respond-handlers/canRespondCastableSpellCandidates.js';
import { canActivateAnyAbility } from '../../state/modules/can-respond-handlers/canRespondActivatableAbilities.js';
import { canPlayLand } from '../../state/modules/can-respond-handlers/canRespondPlayableLands.js';
import { getCastableCommanderCandidates } from '../../state/modules/can-respond-handlers/canRespondCommandZoneCandidates.js';

const RESPONSE_CANDIDATE_OPTIONS = {
  mode: 'response' as const,
  skipIgnoredCards: true,
  allowAlternateCosts: true,
  allowUnknownCostFallback: true,
  conservativeTargets: false,
};

const MAIN_CANDIDATE_OPTIONS = {
  mode: 'main' as const,
  skipIgnoredCards: true,
  allowAlternateCosts: true,
  allowUnknownCostFallback: true,
  conservativeTargets: false,
};

function candidateIsUseful(ctx: GameContext, playerId: PlayerID, candidate: { card?: any; castCard?: any }): boolean {
  const card = candidate.castCard || candidate.card;
  return isSpellCastBoardContextUseful({ state: ctx.state }, playerId, card, {
    excludeCardId: card?.id ? String(card.id) : undefined,
  });
}

/**
 * True when this AI's only "legal" priority actions are board-context no-ops
 * (Entrapment with no attackers, empty-stack Summary Dismissal, off-turn Flash
 * creatures that are not combat tricks). Humans are never treated as idle here.
 */
export function isAiContextuallyIdleForAutoPass(ctx: GameContext, playerId: PlayerID): boolean {
  const player = (Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [])
    .find((entry: any) => String(entry?.id || '') === String(playerId));
  if (player?.isAI !== true) return false;

  const responseSpells = getCastableSpellCandidates(ctx, playerId, RESPONSE_CANDIDATE_OPTIONS);
  if (responseSpells.some((candidate) => candidateIsUseful(ctx, playerId, candidate))) {
    return false;
  }

  const isTurnPlayer = String((ctx.state as any)?.turnPlayer || '') === String(playerId);
  if (isTurnPlayer) {
    if (canPlayLand(ctx, playerId)) return false;
    const mainSpells = getCastableSpellCandidates(ctx, playerId, MAIN_CANDIDATE_OPTIONS);
    if (mainSpells.some((candidate) => candidateIsUseful(ctx, playerId, candidate))) {
      return false;
    }
    const commanders = getCastableCommanderCandidates(ctx, playerId);
    if (commanders.some((candidate) => candidateIsUseful(ctx, playerId, { card: candidate.card, castCard: candidate.card }))) {
      return false;
    }
  }

  if (canActivateAnyAbility(ctx, playerId)) return false;
  return true;
}
