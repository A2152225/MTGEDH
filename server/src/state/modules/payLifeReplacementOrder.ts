// server/src/state/modules/payLifeReplacementOrder.ts
// CR 616.1 order prompt when two or more pay-life replacements would apply
// (e.g. Ashiok, Wicked Manipulator plus another life-payment replacement).
// Extends the existing draw/token order-prompt pattern with a new event kind
// handled here so replacementOrderChoice.ts only needs a minimal hook.
// Public: listPayLifeReplacementCandidates, queuePayLifeReplacementOrderIfNeeded,
//   applyChosenPayLifeReplacement, PAY_LIFE_REPLACEMENT_ORDER_FLAG.

import type { PlayerID } from '../../../../shared/src/types.js';
import { uid } from '../utils.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';

export const PAY_LIFE_REPLACEMENT_ORDER_FLAG = 'payLifeReplacementOrderChoice';
export const LIFE_PAYMENT_EVENT = 'life-payment';

export interface PayLifeReplacementCandidate {
  id: string;
  effectId: string;
  sourceName: string;
  sourcePermanentId?: string;
  description: string;
}

const DESCRIPTIONS: Record<string, string> = {
  'pay-life-exile-library-top': 'Exile the top card of your library (Ashiok, Wicked Manipulator)',
};

function readSpecs(state: any): any[] {
  if (Array.isArray(state?._replacementEffectSpecs)) return state._replacementEffectSpecs;
  if (Array.isArray(state?.replacementEffectSpecs)) return state.replacementEffectSpecs;
  return [];
}

export function listPayLifeReplacementCandidates(state: any, playerId: string, amount: number): PayLifeReplacementCandidate[] {
  const pid = String(playerId || '').trim();
  const payAmount = Math.max(0, Math.floor(Number(amount || 0)));
  const specs = readSpecs(state);
  const out: PayLifeReplacementCandidate[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const event = String(spec?.event || '');
    if (event !== 'life-payment' && event !== 'pay-life') continue;
    const effectId = String(spec?.effectId || spec?.id || '').trim();
    if (!effectId) continue;
    const controllerId = String(spec?.controllerId || spec?.sourceControllerId || '').trim();
    if (controllerId && pid && controllerId !== pid) continue;
    const sourcePermanentId = String(spec?.sourcePermanentId || spec?.sourceId || '').trim();
    const sourceName = String(spec?.sourceName || 'Replacement').trim() || 'Replacement';
    const id = String(spec?.id || `${effectId}:${sourcePermanentId || 'global'}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      effectId,
      sourceName,
      sourcePermanentId: sourcePermanentId || undefined,
      description: DESCRIPTIONS[effectId] || `${sourceName} replaces this life payment`,
    });
  }
  // Amount is accepted so future specs can match on a minimum payment.
  void payAmount;
  return out;
}

export function queuePayLifeReplacementOrderIfNeeded(args: {
  ctx: { state: any; gameId?: string; isReplaying?: boolean };
  playerId: string;
  amount: number;
}): { queued: boolean; candidates: PayLifeReplacementCandidate[] } {
  const candidates = listPayLifeReplacementCandidates(args.ctx.state, args.playerId, args.amount);
  if (candidates.length < 2) return { queued: false, candidates };
  const gameId = String((args.ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (args.ctx as any).isReplaying) {
    return { queued: false, candidates };
  }
  ResolutionQueueManager.addStep(gameId, {
    id: uid('pay_life_repl_order'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: args.playerId as PlayerID,
    sourceId: candidates[0].sourcePermanentId || 'pay-life-replacement',
    sourceName: 'Replacement order',
    description: 'Choose which replacement to apply first (CR 616.1).',
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    [PAY_LIFE_REPLACEMENT_ORDER_FLAG]: true,
    payLifeAmount: Math.max(0, Math.floor(Number(args.amount || 0))),
    payLifePlayerId: args.playerId,
    options: candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.sourceName,
      description: candidate.description,
    })),
    payLifeReplacementCandidates: candidates,
  } as any);
  return { queued: true, candidates };
}

export function applyChosenPayLifeReplacement(args: {
  state: any;
  playerId: string;
  amount: number;
  chosenId: string;
  applyCandidate: (candidate: PayLifeReplacementCandidate) => void;
}): { applied: boolean; chosen?: PayLifeReplacementCandidate; remaining: PayLifeReplacementCandidate[] } {
  const candidates = listPayLifeReplacementCandidates(args.state, args.playerId, args.amount);
  const chosen = candidates.find((candidate) => candidate.id === args.chosenId) || candidates[0];
  if (!chosen) return { applied: false, remaining: candidates };
  args.applyCandidate(chosen);
  const remaining = candidates.filter((candidate) => candidate.id !== chosen.id);
  return { applied: true, chosen, remaining };
}
