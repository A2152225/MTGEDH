/**
 * socket/resolution-handlers/attackCostPermanentPaymentHandlers.ts
 *
 * TARGET_SELECTION for non-mana attack/block costs (Floodtide Serpent / Flooded Woodlands /
 * Hollow Warrior tap-creature).
 * Public: handleAttackCostPermanentPaymentTargetSelection, handleAttackCostPermanentPaymentCancelled.
 * Must not import resolution.ts.
 */

import type { Server } from 'socket.io';
import type { ResolutionStep, ResolutionStepResponse } from '../../state/resolution/index.js';
import { debug } from '../../utils/debug.js';
import { queueTapTriggersForTappedPermanents } from '../../state/modules/tap-trigger-queue.js';
import {
  payAttackCostPermanentSelections,
  type AttackPermanentCostRequirement,
} from '../combat-handlers/attackCostPermanentPayment.js';
import {
  resumeDeclareAttackersAfterPermanentCost,
  resumeDeclareBlockersAfterTapCost,
} from '../combat-handlers/attackCostPermanentPaymentEnqueue.js';
import { emitToPlayer, getPlayerName } from '../util.js';

type AttackerDecl = { creatureId: string; targetPlayerId?: string; targetPermanentId?: string };
type BlockerDecl = { blockerId: string; attackerId: string };

function payVerb(kind: string): string {
  if (kind === 'tap') return 'tapped';
  if (kind === 'return_to_hand') return 'returned';
  return 'sacrificed';
}

export async function handleAttackCostPermanentPaymentTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepAny = step as any;
  const playerId = String(step.playerId || response.playerId);
  const kind = String(stepAny.permanentCostKind || 'sacrifice') as 'sacrifice' | 'return_to_hand' | 'tap';
  const combatAction = String(stepAny.combatAction || 'attack') === 'block' ? 'block' : 'attack';
  const count = Math.max(1, Math.floor(Number(stepAny.permanentCostCount) || 1));
  const selections = Array.isArray(response.selections) ? response.selections.map(String) : [];
  if (selections.length < count) {
    emitToPlayer(io, playerId as any, 'error', {
      code: 'INVALID_SELECTION',
      message: `Choose ${count} permanent(s) to pay the ${combatAction} cost.`,
    });
    return;
  }
  const attackers: AttackerDecl[] = Array.isArray(stepAny.attackers) ? stepAny.attackers : [];
  const blockers: BlockerDecl[] = Array.isArray(stepAny.blockers) ? stepAny.blockers : [];
  const excluded = new Set<string>();
  for (const a of attackers) excluded.add(String(a.creatureId || ''));
  for (const b of blockers) excluded.add(String(b.blockerId || ''));
  const payment = await payAttackCostPermanentSelections(
    game, gameId, playerId, kind, selections.slice(0, count),
    { excludedCombatantIds: excluded },
  );
  if (payment.ok !== true) {
    emitToPlayer(io, playerId as any, 'error', { code: 'ATTACK_COST_PAYMENT_FAILED', message: payment.error });
    return;
  }
  if (kind === 'tap') {
    queueTapTriggersForTappedPermanents(io, game, gameId, payment.movedIds, playerId);
  }
  const sources = Array.isArray(stepAny.permanentCostSources) ? stepAny.permanentCostSources : [];
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} ${payVerb(kind)} ${payment.movedNames.join(', ')} to ${combatAction}${sources.length ? ` (${sources.join(', ')})` : ''}.`,
    ts: Date.now(),
  });
  debug(1, `[combat] Player ${playerId} paid permanent ${combatAction} cost (${kind})`);
  const pending: AttackPermanentCostRequirement[] = Array.isArray(stepAny.pendingPermanentCosts)
    ? stepAny.pendingPermanentCosts : [];
  if (combatAction === 'block') {
    await resumeDeclareBlockersAfterTapCost(io, game, gameId, playerId, blockers, pending);
    return;
  }
  await resumeDeclareAttackersAfterPermanentCost(io, game, gameId, playerId, attackers, pending);
}

export async function handleAttackCostPermanentPaymentCancelled(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepAny = step as any;
  const playerId = String(step.playerId || response.playerId);
  const combatAction = String(stepAny.combatAction || 'attack') === 'block' ? 'block' : 'attack';
  const sources = Array.isArray(stepAny.permanentCostSources) ? stepAny.permanentCostSources : [];

  if (combatAction === 'block') {
    const removeIds = new Set(
      (Array.isArray(stepAny.permanentCostBlockerIds) ? stepAny.permanentCostBlockerIds : []).map(String),
    );
    const blockers: BlockerDecl[] = (Array.isArray(stepAny.blockers) ? stepAny.blockers : [])
      .filter((b: BlockerDecl) => !removeIds.has(String(b.blockerId || '')));
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, playerId)} declined the block cost${sources.length ? ` (${sources.join(', ')})` : ''}; those blockers were removed.`,
      ts: Date.now(),
    });
    const pendingRaw: AttackPermanentCostRequirement[] = Array.isArray(stepAny.pendingPermanentCosts)
      ? stepAny.pendingPermanentCosts : [];
    const remainingIds = new Set(blockers.map((b) => String(b.blockerId || '')));
    const pending = pendingRaw
      .map((req) => {
        const blockerIds = (req.blockerIds || []).filter((id) => remainingIds.has(String(id)));
        return { ...req, blockerIds, count: blockerIds.length };
      })
      .filter((req) => (req.blockerIds || []).length > 0 && req.count > 0);
    await resumeDeclareBlockersAfterTapCost(io, game, gameId, playerId, blockers, pending);
    return;
  }

  const removeIds = new Set(
    (Array.isArray(stepAny.permanentCostAttackerIds) ? stepAny.permanentCostAttackerIds : []).map(String),
  );
  const attackers: AttackerDecl[] = (Array.isArray(stepAny.attackers) ? stepAny.attackers : [])
    .filter((a: AttackerDecl) => !removeIds.has(String(a.creatureId || '')));
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, playerId)} declined the attack cost${sources.length ? ` (${sources.join(', ')})` : ''}; those attackers were removed.`,
    ts: Date.now(),
  });
  const pendingRaw: AttackPermanentCostRequirement[] = Array.isArray(stepAny.pendingPermanentCosts)
    ? stepAny.pendingPermanentCosts : [];
  const remainingIds = new Set(attackers.map((a) => String(a.creatureId || '')));
  const pending = pendingRaw
    .map((req) => {
      const attackerIds = (req.attackerIds || []).filter((id) => remainingIds.has(String(id)));
      return { ...req, attackerIds, count: attackerIds.length };
    })
    .filter((req) => req.attackerIds.length > 0 && req.count > 0);
  await resumeDeclareAttackersAfterPermanentCost(io, game, gameId, playerId, attackers, pending);
}
