// server/src/state/modules/zones-handlers/zonesDrawReplacementSkipDrawApply.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster: applySkipDrawReplacementChoice — optional skip of a draw-step draw,
//   then stamp lastingEffects.attackYouProhibitedExceptKeywords (Island Sanctuary
//   “if you do”). Idle replacement wrapper is not a continuous lock.
// Public entry symbols: applySkipDrawReplacementChoice.
// Leaf must not import zones.ts or zones-handlers/index.ts.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameState } from '../../../../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { tryApplyAttackYouProhibitedExceptKeywordsGrant } from '../../../../../rules-engine/src/oracleIRExecutorAttackYouProhibitedExceptKeywords.js';
import type { GameContext } from '../../context.js';
import { drawCards } from './zonesDrawCards.js';

export interface SkipDrawReplacementResult {
  applied: boolean;
  skipped?: boolean;
  declined?: boolean;
  reason?: string;
  drawnCards?: any[];
}

function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((keyword) => String(keyword || '').trim().toLowerCase())
    .filter((keyword) => /^[a-z][a-z\s]*$/.test(keyword));
}

function stampExceptKeywordsLock(args: {
  ctx: GameContext;
  playerId: string;
  keywords: string[];
  sourceName: string;
  sourceId: string;
}): void {
  const { ctx, playerId, keywords, sourceName, sourceId } = args;
  if (keywords.length === 0) return;
  const grant = tryApplyAttackYouProhibitedExceptKeywordsGrant(
    ctx.state as GameState,
    {
      kind: 'grant_static_ability',
      target: { text: 'you' } as any,
      effectText: [`can't be attacked except by creatures with ${keywords.join(' and/or ')}`],
      duration: 'until_next_turn',
      raw: `until your next turn, you can't be attacked except by creatures with ${keywords.join(' and/or ')}`,
    },
    buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId,
      sourceName,
      sourceObjectType: 'ability',
    } as any),
  );
  if (grant?.applied && grant.state) {
    (ctx.state as any).lastingEffects = (grant.state as any).lastingEffects;
  }
}

export function applySkipDrawReplacementChoice(ctx: GameContext, event: {
  playerId: PlayerID | string;
  choiceId?: string;
  remainingDrawCountAfterChoice?: number;
  exceptKeywords?: unknown;
  sourcePermanentId?: string;
  sourceName?: string;
}): SkipDrawReplacementResult {
  const playerId = String(event?.playerId || '').trim() as PlayerID;
  if (!playerId) return { applied: false, reason: 'missing_player' };

  const choiceId = String(event?.choiceId || '').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const keywords = normalizeKeywords(event?.exceptKeywords);
  const sourceName = String(event?.sourceName || 'Skip this draw').trim() || 'Skip this draw';
  const sourceId = String(event?.sourcePermanentId || 'skip-draw').trim() || 'skip-draw';

  if (choiceId === 'skip_draw' || choiceId === 'skip') {
    stampExceptKeywordsLock({ ctx, playerId, keywords, sourceName, sourceId });
    ctx.bumpSeq();
    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, playerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
    }
    return { applied: true, skipped: true };
  }

  const previousSuppress = (ctx as any)._suppressSkipDrawReplacement === true;
  (ctx as any)._suppressSkipDrawReplacement = true;
  try {
    const drawnCards = drawCards(ctx, playerId, 1, { skipEventPersistence: true });
    if (!previousSuppress) delete (ctx as any)._suppressSkipDrawReplacement;
    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, playerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
    }
    return { applied: true, declined: true, drawnCards };
  } finally {
    if (previousSuppress) {
      (ctx as any)._suppressSkipDrawReplacement = true;
    } else {
      delete (ctx as any)._suppressSkipDrawReplacement;
    }
  }
}
