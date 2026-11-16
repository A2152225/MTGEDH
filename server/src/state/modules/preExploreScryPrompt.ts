/**
 * Twists and Turns: consume pendingPreExploreScry into the existing SCRY
 * resolution step (then explore after the scry is answered).
 * Public: takePendingPreExploreScry, peekLibraryForScryStep, buildPreExploreScryStep,
 * resumeExploreAfterPreScry.
 */
import { ResolutionStepType } from '../resolution/index.js';
import { queueExploreDecisionStep } from './triggerExploreUtils.js';

export interface PendingExploreAfterPreScry {
  controller: string;
  permanentId: string;
  remainingPermanentIds?: string[];
}

export function takePendingPreExploreScry(state: any, playerId: string): number {
  const pending = state?.pendingPreExploreScry;
  if (!pending || typeof pending !== 'object') return 0;
  const raw = Number(pending[String(playerId)] || 0);
  delete pending[String(playerId)];
  if (Object.keys(pending).length === 0) {
    try { delete state.pendingPreExploreScry; } catch { /* ignore */ }
  }
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

export function peekLibraryForScryStep(library: any[] | undefined, scryCount: number): any[] {
  const lib = Array.isArray(library) ? library : [];
  const actualCount = Math.min(Math.max(0, Math.floor(Number(scryCount || 0))), lib.length);
  return lib.slice(0, actualCount).map((c: any) => ({
    id: c?.id,
    name: c?.name,
    type_line: c?.type_line,
    oracle_text: c?.oracle_text,
    imageUrl: c?.image_uris?.normal || c?.image_uris?.small || c?.imageUrl,
    mana_cost: c?.mana_cost,
    cmc: c?.cmc,
  }));
}

export function buildPreExploreScryStep(args: {
  playerId: string;
  cards: any[];
  scryCount: number;
  exploreFollowup: PendingExploreAfterPreScry;
  sourceName?: string;
}): Record<string, unknown> {
  const scryCount = Math.max(0, Math.floor(Number(args.scryCount || 0)));
  const sourceName = String(args.sourceName || 'Twists and Turns');
  return {
    type: ResolutionStepType.SCRY,
    playerId: args.playerId as any,
    description: scryCount === 1
      ? `${sourceName}: Scry 1, then a creature explores`
      : `${sourceName}: Scry ${scryCount}, then a creature explores`,
    mandatory: true,
    cards: args.cards,
    scryCount,
    sourceName,
    scryFollowupChoice: true,
    scryFollowupKind: 'explore',
    pendingExploreAfter: args.exploreFollowup,
  };
}

export function resumeExploreAfterPreScry(args: {
  game: any;
  gameId: string;
  step: any;
}): boolean {
  const step = args.step || {};
  if (String(step.scryFollowupKind || '') !== 'explore') return false;
  const followup = step.pendingExploreAfter || {};
  const controller = String(followup.controller || step.playerId || '').trim();
  const permanentId = String(followup.permanentId || '').trim();
  if (!controller || !permanentId || !args.gameId) return false;
  const ctx = ((args.game as any).ctx || args.game) as any;
  ctx.gameId = args.gameId;
  ctx.state = args.game.state;
  if (!ctx.libraries && (args.game as any).libraries) ctx.libraries = (args.game as any).libraries;
  const remaining = Array.isArray(followup.remainingPermanentIds) ? followup.remainingPermanentIds : [];
  return queueExploreDecisionStep(ctx, controller, permanentId, remaining, { skipExploreReplacement: true }) === true;
}
