/**
 * Batch 24: Fasting-style optional draw-step skip ("If you would begin your draw step, you may skip that step
 * instead. If you do, you gain N life."). At the start of its controller's turn the player answers an
 * OPTION_CHOICE (flag optionalDrawStepSkipChoice); choosing to skip stamps optionalDrawStepSkipTurn on the
 * permanent, which findStaticSkipDrawStepSource reads, and the draw step then grants the "if you do" life.
 * Public entry symbols: OPTIONAL_DRAW_STEP_SKIP_RE, queueOptionalDrawStepSkipPrompt,
 * applyOptionalDrawStepSkipChoice, applyOptionalDrawStepSkipLifeGain.
 */
import type { GameContext } from '../context.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { persistBattlefieldPermanentPatchAfterMutation } from '../effects/battlefieldPermanentReplayPersistence.js';
import { applyLifeGainViaProcessLifeChange } from './turn-handlers/turnCombatDamageLifeGain.js';

export const OPTIONAL_DRAW_STEP_SKIP_RE = /\bif you would begin your draw step, you may skip that step instead\b/i;

function rec(obj: unknown): Record<string, unknown> | null {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
}

function oracleOf(perm: unknown): string {
  return String(rec(rec(perm)?.card)?.oracle_text || '').replace(/\u2019/g, "'");
}

function currentTurn(state: unknown): number {
  const s = rec(state);
  return Number(s?.turnNumber ?? s?.turn ?? 0) || 0;
}

function optionalSkipPermanents(state: unknown, playerId: string): Record<string, unknown>[] {
  const bf = rec(state)?.battlefield;
  if (!Array.isArray(bf)) return [];
  return (bf as unknown[])
    .map(rec)
    .filter((p): p is Record<string, unknown> => !!p && p.phasedOut !== true
      && String(p.controller || '') === playerId && OPTIONAL_DRAW_STEP_SKIP_RE.test(oracleOf(p)));
}

/** Queues the may-skip prompt for the active player. Returns true when a prompt was queued. */
export function queueOptionalDrawStepSkipPrompt(ctx: GameContext, activePlayerId: string): boolean {
  if (Reflect.get(ctx, 'isReplaying')) return false;
  if (!String(Reflect.get(ctx, 'gameId') || '').trim()) return false;
  const perm = optionalSkipPermanents(ctx.state, activePlayerId)[0];
  if (!perm) return false;
  const name = String(rec(perm.card)?.name || 'Fasting');
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: activePlayerId,
    sourceId: String(perm.id || ''),
    sourceName: name,
    description: `${name}: skip your draw step this turn?`,
    mandatory: true,
    options: [
      { id: 'skip', label: 'Skip draw step', value: 'skip' },
      { id: 'draw', label: 'Draw normally', value: 'draw' },
    ],
    minSelections: 1,
    maxSelections: 1,
    optionalDrawStepSkipChoice: true,
    optionalDrawStepSkipPermanentId: String(perm.id || ''),
  });
  return true;
}

/** Records the answer on the permanent (persisted as a battlefield patch). */
export function applyOptionalDrawStepSkipChoice(ctx: GameContext, permanentId: string, skip: boolean): boolean {
  const bf = rec(ctx.state)?.battlefield;
  const perm = Array.isArray(bf) ? rec((bf as unknown[]).find(p => String(rec(p)?.id || '') === permanentId)) : null;
  if (!perm) return false;
  if (skip) perm.optionalDrawStepSkipTurn = currentTurn(ctx.state);
  else perm.optionalDrawStepSkipTurn = -1;
  try {
    persistBattlefieldPermanentPatchAfterMutation(ctx, perm, { fields: ['optionalDrawStepSkipTurn'] as const, sourceId: permanentId });
  } catch {}
  return true;
}

/** "If you do, you gain N life." Called when the draw step was skipped. Returns the life gained. */
export function applyOptionalDrawStepSkipLifeGain(ctx: GameContext, activePlayerId: string): number {
  const turn = currentTurn(ctx.state);
  let total = 0;
  for (const perm of optionalSkipPermanents(ctx.state, activePlayerId)) {
    if (Number(perm.optionalDrawStepSkipTurn) !== turn || perm.optionalDrawStepSkipLifeTurn === turn) continue;
    perm.optionalDrawStepSkipLifeTurn = turn;
    const m = oracleOf(perm).match(/skip that step instead\.\s*if you do, you gain (\d+) life/i);
    if (m) total += applyLifeGainViaProcessLifeChange(ctx, activePlayerId, Number(m[1]), String(rec(perm.card)?.name || '')).actualChange;
  }
  return total;
}
