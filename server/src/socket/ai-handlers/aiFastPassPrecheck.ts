/**
 * Fast-pass precheck for AI priority.
 *
 * When an AI is handed priority, the scheduler normally waits AI_REACTION_DELAY_MS so humans
 * can follow what the AI does. That pacing is only useful before a real action. This module
 * answers "will this AI just pass?" cheaply (same response-candidate query the priority handler
 * uses) so the scheduler can run the handler immediately, and remembers the verdict for the
 * current state version so the handler does not recompute it.
 *
 * Conservative by design: anything that might lead to a real choice (own-turn empty-stack
 * decisions, declare-blockers, pending prompts or casts) returns false and keeps the delay.
 *
 * Public entry symbols: aiPriorityWillPass, consumeAIFastPassDecision,
 * setAIFastPassPrecheckForTests, clearAIFastPassDecisionsForTests.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { canRespond } from "../../state/modules/can-respond.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { isGameReplayLocked } from "../../gameRestoreState.js";
import { getAIHandlerDeps } from "../aiHandlerDeps.js";
import { isAIPlayer } from "./aiPlayerRegistry.js";
import { debug } from "../../utils/debug.js";

type FastPassFingerprint = { seq: number; priority: string; phase: string; step: string; stackLength: number };

const fastPassDecisions = new Map<string, FastPassFingerprint>();
let precheckOverride: ((gameId: string, playerId: PlayerID) => Promise<boolean>) | null = null;

function decisionKey(gameId: string, playerId: PlayerID): string {
  return `${gameId}:${String(playerId)}`;
}

function fingerprint(game: any): FastPassFingerprint {
  const state = game?.state || {};
  return {
    seq: Number(game?.seq ?? state?.seq ?? 0) || 0,
    priority: String(state.priority || ''),
    phase: String(state.phase || '').toLowerCase(),
    step: String(state.step || '').toLowerCase(),
    stackLength: Array.isArray(state.stack) ? state.stack.length : 0,
  };
}

function sameFingerprint(a: FastPassFingerprint, b: FastPassFingerprint): boolean {
  return a.seq === b.seq && a.priority === b.priority && a.phase === b.phase
    && a.step === b.step && a.stackLength === b.stackLength;
}

/** Synchronous gates: only priority windows whose sole possible action is an instant-speed response. */
function isResponseOnlyPriorityWindow(game: any, gameId: string, playerId: PlayerID): boolean {
  const state = game?.state;
  if (!state) return false;
  if (isGameReplayLocked(game, gameId)) return false;
  if (!isAIPlayer(gameId, playerId)) return false;
  if (String(state.priority || '') !== String(playerId)) return false;

  const phase = String(state.phase || '').toLowerCase();
  const step = String(state.step || '').toLowerCase();
  if (!phase || phase === 'pre_game' || phase === 'pregame' || phase === 'pre-game') return false;
  if (step.includes('cleanup')) return false;
  // Blocker declarations are real choices; keep the pacing there.
  if (phase === 'combat' && step.includes('blockers')) return false;

  if (ResolutionQueueManager.playerHasPendingSteps(gameId, playerId)) return false;
  const pendingCasts = state.pendingSpellCasts || {};
  if (Object.values(pendingCasts).some((cast: any) => String(cast?.playerId || '') === String(playerId))) return false;
  const completing = state._completingSpellCastByPlayer;
  if (completing && typeof completing === 'object' && completing[String(playerId)]) return false;
  const paymentLock = state._paymentResumeCastLock;
  if (paymentLock && String(paymentLock.playerId || '') === String(playerId)) return false;

  const isAITurn = String(state.turnPlayer || '') === String(playerId);
  const stackEmpty = !Array.isArray(state.stack) || state.stack.length === 0;
  // Own turn with an empty stack means land/spell/attack/advance decisions: not a pure pass.
  if (isAITurn && stackEmpty) return false;
  return true;
}

async function defaultPrecheck(gameId: string, playerId: PlayerID): Promise<boolean> {
  const { ensureGame } = await import("../util.js");
  const game: any = ensureGame(gameId);
  if (!isResponseOnlyPriorityWindow(game, gameId, playerId)) return false;
  const before = fingerprint(game);

  const deps = getAIHandlerDeps();
  const responseContext = typeof deps.getAIActionContext === 'function' ? deps.getAIActionContext(game) : game;
  let willPass = !canRespond(responseContext, playerId);
  if (!willPass) {
    if (typeof deps.enumerateAIActionCandidates !== 'function') return false;
    const candidates = await deps.enumerateAIActionCandidates(game, playerId, { mode: 'response' });
    willPass = !Array.isArray(candidates) || candidates.length === 0;
  }
  // The query must not have changed anything, and the window must still be the same one.
  if (!willPass || !sameFingerprint(before, fingerprint(game))) return false;
  fastPassDecisions.set(decisionKey(gameId, playerId), before);
  return true;
}

/** True when the AI holding priority has no response it would take, so it will simply pass. */
export async function aiPriorityWillPass(gameId: string, playerId: PlayerID): Promise<boolean> {
  try {
    if (precheckOverride) return await precheckOverride(gameId, playerId);
    return await defaultPrecheck(gameId, playerId);
  } catch (err) {
    debug(2, '[AI] fast-pass precheck failed; keeping normal pacing', { gameId, playerId, err });
    return false;
  }
}

/**
 * Handler side: true (and forgets the verdict) when a fast-pass verdict was recorded for exactly
 * this priority window, so the handler can pass without re-enumerating responses.
 */
export function consumeAIFastPassDecision(gameId: string, playerId: PlayerID, game: any): boolean {
  const key = decisionKey(gameId, playerId);
  const recorded = fastPassDecisions.get(key);
  if (!recorded) return false;
  fastPassDecisions.delete(key);
  return sameFingerprint(recorded, fingerprint(game));
}

export function setAIFastPassPrecheckForTests(
  override: ((gameId: string, playerId: PlayerID) => Promise<boolean>) | null,
): void {
  precheckOverride = override;
}

export function clearAIFastPassDecisionsForTests(): void {
  fastPassDecisions.clear();
}
