/**
 * Multiplayer Loop Shortcut consent (CR 731-style).
 * Proposer asks opponents whether to interrupt; effective iteration count is the
 * earliest interrupt (or full N if everyone declines).
 */
import type { Server, Socket } from 'socket.io';
import { appendEvent } from '../db/index.js';
import { ensureGame, broadcastGame, emitToPlayer, getPlayerName } from './util.js';
import { debug, debugWarn } from '../utils/debug.js';

export type LoopShortcutProposalResponse = {
  interrupt: boolean;
  afterIterations?: number;
};

export type PendingLoopShortcut = {
  id: string;
  proposerId: string;
  name: string;
  summary: string;
  requestedIterations: number;
  status: 'pending' | 'approved' | 'cancelled';
  createdAt: number;
  responses: Record<string, LoopShortcutProposalResponse>;
  effectiveIterations?: number;
};

function getHumanOpponentIds(game: any, proposerId: string): string[] {
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  return players
    .filter((p: any) => {
      const id = String(p?.id || '').trim();
      if (!id || id === proposerId) return false;
      if (p?.spectator === true) return false;
      if (p?.isAI === true || p?.ai === true) return false;
      return true;
    })
    .map((p: any) => String(p.id));
}

function computeEffectiveIterations(proposal: PendingLoopShortcut): number {
  const requested = Math.max(1, Math.min(1000, Number(proposal.requestedIterations) || 1));
  let effective = requested;
  for (const response of Object.values(proposal.responses || {})) {
    if (!response?.interrupt) continue;
    const after = Math.max(1, Math.min(requested, Math.floor(Number(response.afterIterations) || 1)));
    effective = Math.min(effective, after);
  }
  return effective;
}

function clearPendingLoopShortcut(game: any): void {
  if (game?.state) {
    delete (game.state as any).pendingLoopShortcut;
  }
}

export function registerLoopShortcutHandlers(
  io: Server,
  socket: Socket,
  helpers: {
    ensureInRoomAndSeated: (gameId: string) => { game: any; pid: string } | null;
  },
): void {
  socket.on(
    'proposeLoopShortcut',
    (payload?: {
      gameId?: unknown;
      name?: unknown;
      summary?: unknown;
      iterationCount?: unknown;
    }) => {
      const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
      const ctx = gameId ? helpers.ensureInRoomAndSeated(gameId) : null;
      if (!ctx) return;
      const { game, pid } = ctx;

      const requestedIterations = Math.max(1, Math.min(1000, Math.floor(Number(payload?.iterationCount) || 1)));
      const name = String(payload?.name || 'Loop Shortcut').trim() || 'Loop Shortcut';
      const summary = String(payload?.summary || '').trim() || `${requestedIterations} iteration(s)`;
      const opponents = getHumanOpponentIds(game, pid);

      const proposal: PendingLoopShortcut = {
        id: `loop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        proposerId: pid,
        name,
        summary,
        requestedIterations,
        status: opponents.length === 0 ? 'approved' : 'pending',
        createdAt: Date.now(),
        responses: {},
        ...(opponents.length === 0 ? { effectiveIterations: requestedIterations } : {}),
      };

      (game.state as any).pendingLoopShortcut = proposal;
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'proposeLoopShortcut', {
          proposalId: proposal.id,
          proposerId: pid,
          name,
          summary,
          requestedIterations,
          opponentIds: opponents,
        });
      } catch (err) {
        debugWarn(1, '[LoopShortcut] appendEvent(proposeLoopShortcut) failed', err);
      }

      broadcastGame(io, game, gameId);

      // Notify proposer immediately when no humans need to consent.
      if (opponents.length === 0) {
        emitToPlayer(io, pid, 'loopShortcutConsentResult', {
          gameId,
          proposalId: proposal.id,
          approved: true,
          effectiveIterations: requestedIterations,
          interrupted: false,
        });
        clearPendingLoopShortcut(game);
        broadcastGame(io, game, gameId);
        return;
      }

      for (const opponentId of opponents) {
        emitToPlayer(io, opponentId, 'loopShortcutConsentPrompt', {
          gameId,
          proposalId: proposal.id,
          proposerId: pid,
          proposerName: getPlayerName(game, pid),
          name,
          summary,
          requestedIterations,
        });
      }

      emitToPlayer(io, pid, 'loopShortcutConsentWaiting', {
        gameId,
        proposalId: proposal.id,
        opponentIds: opponents,
        requestedIterations,
      });

      debug(2, `[LoopShortcut] Proposed ${proposal.id} by ${pid} for ${requestedIterations} iters, waiting on ${opponents.length} opponent(s)`);
    },
  );

  socket.on(
    'respondLoopShortcut',
    (payload?: {
      gameId?: unknown;
      proposalId?: unknown;
      interrupt?: unknown;
      afterIterations?: unknown;
    }) => {
      const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
      const ctx = gameId ? helpers.ensureInRoomAndSeated(gameId) : null;
      if (!ctx) return;
      const { game, pid } = ctx;
      const proposal = (game.state as any).pendingLoopShortcut as PendingLoopShortcut | undefined;
      if (!proposal || proposal.status !== 'pending') return;
      if (String(payload?.proposalId || '') !== proposal.id) return;
      if (pid === proposal.proposerId) return;

      const interrupt = payload?.interrupt === true;
      const afterIterations = interrupt
        ? Math.max(
            1,
            Math.min(
              proposal.requestedIterations,
              Math.floor(Number(payload?.afterIterations) || 1),
            ),
          )
        : undefined;

      proposal.responses[pid] = {
        interrupt,
        ...(afterIterations != null ? { afterIterations } : {}),
      };

      const opponents = getHumanOpponentIds(game, proposal.proposerId);
      const allResponded = opponents.every((id) => proposal.responses[id] != null);

      if (!allResponded) {
        if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
        broadcastGame(io, game, gameId);
        return;
      }

      const effectiveIterations = computeEffectiveIterations(proposal);
      const interrupted = effectiveIterations < proposal.requestedIterations;
      proposal.status = 'approved';
      proposal.effectiveIterations = effectiveIterations;

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'resolveLoopShortcutConsent', {
          proposalId: proposal.id,
          proposerId: proposal.proposerId,
          requestedIterations: proposal.requestedIterations,
          effectiveIterations,
          interrupted,
          responses: proposal.responses,
        });
      } catch (err) {
        debugWarn(1, '[LoopShortcut] appendEvent(resolveLoopShortcutConsent) failed', err);
      }

      emitToPlayer(io, proposal.proposerId, 'loopShortcutConsentResult', {
        gameId,
        proposalId: proposal.id,
        approved: true,
        effectiveIterations,
        interrupted,
        responses: proposal.responses,
      });

      for (const opponentId of opponents) {
        emitToPlayer(io, opponentId, 'loopShortcutConsentResult', {
          gameId,
          proposalId: proposal.id,
          approved: true,
          effectiveIterations,
          interrupted,
        });
      }

      clearPendingLoopShortcut(game);
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
    },
  );

  socket.on(
    'cancelLoopShortcut',
    (payload?: { gameId?: unknown; proposalId?: unknown }) => {
      const gameId = typeof payload?.gameId === 'string' ? payload.gameId : '';
      const ctx = gameId ? helpers.ensureInRoomAndSeated(gameId) : null;
      if (!ctx) return;
      const { game, pid } = ctx;
      const proposal = (game.state as any).pendingLoopShortcut as PendingLoopShortcut | undefined;
      if (!proposal) return;
      if (proposal.proposerId !== pid && String(payload?.proposalId || '') !== proposal.id) return;

      clearPendingLoopShortcut(game);
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);

      emitToPlayer(io, proposal.proposerId, 'loopShortcutConsentResult', {
        gameId,
        proposalId: proposal.id,
        approved: false,
        cancelled: true,
      });
    },
  );
}
