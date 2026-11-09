// server/src/socket/combat-handlers/attackCostPermanentPaymentEnqueue.ts
// Enqueue TARGET_SELECTION for non-mana attack costs and resume declare-attackers after pay/decline.
// Public: enqueueAttackCostPermanentPaymentIfNeeded, enqueueAttackCostPermanentPaymentStep,
//   resumeDeclareAttackersAfterPermanentCost.

import type { Server, Socket } from 'socket.io';
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../state/resolution/index.js';
import { debugWarn } from '../../utils/debug.js';
import { executeDeclareAttackers } from './combatDeclareAttackersExecute.js';
import {
  buildAttackCostPhyrexianChoices,
  canAffordAttackCostPayment,
} from './attackCostPhyrexianPayment.js';
import {
  buildAttackCostPermanentValidTargets,
  buildAttackCostTapValidTargets,
  collectAttackPermanentCosts,
  collectBlockTapCreatureCosts,
  describeAttackPermanentCost,
  type AttackPermanentCostRequirement,
} from './attackCostPermanentPayment.js';
import { collectAttackerSelfAttackTax, collectBlockerSelfTax } from '../../../../shared/src/combatAttackerSelfTax.js';
import {
  collectAttackYouTaxForDefender,
  collectBlockLifeTax,
  collectBlockTax,
} from '../../state/modules/staticEffectSpecAttackYouTax.js';
import { collectThisTurnAttackLifeTaxForAttacker, collectThisTurnAttackTaxForAttacker } from '../../state/modules/staticEffectSpecAttackTaxThisTurn.js';
import { collectAttackYouTaxPhyrexianForDefender } from '../../state/modules/staticEffectSpecAttackYouTaxPhyrexian.js';
import { resolveDefendingPlayerIdForAttackTarget } from './combatDeclareAttackersSupport.js';
import { broadcastGame, emitToPlayer, getMaxGenericManaAvailable } from '../util.js';

type AttackerDecl = { creatureId: string; targetPlayerId?: string; targetPermanentId?: string };

function computeManaAttackCost(game: any, playerId: string, attackers: AttackerDecl[]) {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  let totalAttackCostRequired = 0;
  let totalAttackLifeRequired = 0;
  const attackCostBreakdown: { playerId: string; cost: number; sources: string[] }[] = [];
  const attackCostByDefender = new Map<string, { cost: number; sources: string[] }>();
  const attackCostPhyrexianItems: any[] = [];
  for (const attacker of attackers) {
    const defendingPlayerId = resolveDefendingPlayerIdForAttackTarget(attacker, battlefield, players);
    if (!defendingPlayerId) continue;
    const attackingCreature = battlefield.find((perm: any) =>
      perm.id === attacker.creatureId && perm.controller === playerId,
    );
    const tax = collectAttackYouTaxForDefender(game.state, defendingPlayerId, attackingCreature, {
      attackTargetPermanentId: String(attacker.targetPermanentId || ''),
    });
    const thisTurnTax = collectThisTurnAttackTaxForAttacker(game.state, defendingPlayerId);
    const thisTurnLifeTax = collectThisTurnAttackLifeTaxForAttacker(game.state, defendingPlayerId);
    const phyrexianTax = collectAttackYouTaxPhyrexianForDefender(game.state, defendingPlayerId, attackingCreature);
    const selfTax = collectAttackerSelfAttackTax(attackingCreature, battlefield, { players: game.state?.players });
    attackCostPhyrexianItems.push(...phyrexianTax.items);
    const combinedCost = tax.cost + thisTurnTax.cost + selfTax.cost;
    totalAttackLifeRequired += thisTurnLifeTax.cost;
    if (combinedCost <= 0 && phyrexianTax.items.length === 0 && thisTurnLifeTax.cost <= 0) continue;
    totalAttackCostRequired += combinedCost;
    const combinedSources = [
      ...tax.sources, ...thisTurnTax.sources, ...thisTurnLifeTax.sources, ...selfTax.sources,
      ...phyrexianTax.items.map((item: any) => item.source),
    ];
    const existing = attackCostByDefender.get(defendingPlayerId);
    if (existing) {
      existing.cost += combinedCost;
      for (const source of combinedSources) if (!existing.sources.includes(source)) existing.sources.push(source);
    } else {
      attackCostByDefender.set(defendingPlayerId, { cost: combinedCost, sources: combinedSources });
    }
  }
  for (const [playerIdKey, costInfo] of attackCostByDefender.entries()) {
    attackCostBreakdown.push({ playerId: playerIdKey, cost: costInfo.cost, sources: costInfo.sources });
  }
  return { totalAttackCostRequired, totalAttackLifeRequired, attackCostBreakdown, attackCostPhyrexianItems };
}

export async function resumeDeclareAttackersAfterPermanentCost(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  attackers: AttackerDecl[],
  pendingPermanentCosts: AttackPermanentCostRequirement[],
  socket?: Socket,
): Promise<void> {
  if (pendingPermanentCosts.length > 0) {
    enqueueAttackCostPermanentPaymentStep(io, game, gameId, playerId, attackers, pendingPermanentCosts);
    broadcastGame(io, game, gameId);
    return;
  }
  if (attackers.length === 0) {
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }
  const mana = computeManaAttackCost(game, playerId, attackers);
  if (mana.totalAttackCostRequired > 0 || mana.attackCostPhyrexianItems.length > 0 || mana.totalAttackLifeRequired > 0) {
    const attackerIdsToExclude = attackers.map((entry) => String(entry.creatureId || ''));
    const afford = canAffordAttackCostPayment(game.state, playerId, {
      generic: mana.totalAttackCostRequired,
      items: mana.attackCostPhyrexianItems,
      excludedPermanentIds: attackerIdsToExclude,
      fixedLife: mana.totalAttackLifeRequired,
    });
    if (!afford.ok) {
      const emit = socket?.emit?.bind(socket) || ((event: string, payload: any) => emitToPlayer(io, playerId as any, event, payload));
      emit('error', {
        code: 'INSUFFICIENT_MANA_FOR_ATTACK',
        message: `Cannot attack. Need to pay mana/life for ${mana.attackCostBreakdown.map((b) => b.sources.join(', ')).join('; ')}. ${afford.error || ''}`.trim(),
      });
      broadcastGame(io, game, gameId);
      return;
    }
    const existingPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step?.attackCostPayment === true);
    if (!existingPrompt) {
      const phyrexianChoices = buildAttackCostPhyrexianChoices(mana.attackCostPhyrexianItems);
      const phyrexianLabel = phyrexianChoices.length > 0
        ? `${phyrexianChoices.map((choice) => choice.symbol).join('')} (or 2 life each)` : '';
      const genericLabel = mana.totalAttackCostRequired > 0 ? `{${mana.totalAttackCostRequired}}` : '';
      const lifeLabel = mana.totalAttackLifeRequired > 0 ? `${mana.totalAttackLifeRequired} life` : '';
      const costLabel = [phyrexianLabel, genericLabel, lifeLabel].filter(Boolean).join(' and ') || '{0}';
      const attackCostStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: playerId as any,
        sourceName: 'Attack Cost',
        description: `Pay ${costLabel} to attack (${mana.attackCostBreakdown.map((entry) => entry.sources.join(', ')).join('; ')})`,
        mandatory: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'pay_attack_cost', label: `Pay ${costLabel} and attack` },
          { id: 'cancel_attack', label: 'Cancel attack' },
        ],
        attackCostPayment: true,
        attackCostAmount: mana.totalAttackCostRequired,
        attackCostLifeAmount: mana.totalAttackLifeRequired,
        attackCostBreakdown: mana.attackCostBreakdown,
        attackCostPhyrexianItems: mana.attackCostPhyrexianItems,
        attackCostPhyrexianChoices: phyrexianChoices,
        attackers,
      } as any);
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
          playerId,
          sourceId: 'attack-cost',
          queuedResolutionStep: { ...(attackCostStep as any) },
        });
      } catch (err) {
        debugWarn(1, '[combat] appendEvent(attackCostPayment after permanent) failed:', err);
      }
    }
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }
  await executeDeclareAttackers(io, gameId, playerId as any, attackers);
}

export function enqueueAttackCostPermanentPaymentStep(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  attackers: AttackerDecl[],
  requirements: AttackPermanentCostRequirement[],
  combatAction: 'attack' | 'block' = 'attack',
  blockers?: Array<{ blockerId: string; attackerId: string }>,
): boolean {
  if (!requirements.length) return false;
  const [current, ...pending] = requirements;
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const excluded = new Set<string>();
  for (const a of attackers) excluded.add(String(a.creatureId || ''));
  for (const b of blockers || []) excluded.add(String(b.blockerId || ''));
  for (const id of current.attackerIds || []) excluded.add(String(id));
  for (const id of current.blockerIds || []) excluded.add(String(id));
  const validTargets = current.kind === 'tap'
    ? buildAttackCostTapValidTargets(battlefield, playerId, excluded)
    : buildAttackCostPermanentValidTargets(
      battlefield, playerId, current.permanentType, excluded,
    );

  // Impossible tap cost: drop those combatants and continue with the rest.
  if (current.kind === 'tap' && validTargets.length < current.count) {
    if (combatAction === 'block') {
      const removeIds = new Set((current.blockerIds || []).map(String));
      const remainingBlockers = (blockers || []).filter((b) => !removeIds.has(String(b.blockerId || '')));
      const remainingBlockerIds = new Set(remainingBlockers.map((b) => String(b.blockerId || '')));
      const pendingNext = pending
        .map((req) => {
          const blockerIds = (req.blockerIds || []).filter((id) => remainingBlockerIds.has(String(id)));
          return { ...req, blockerIds, count: blockerIds.length };
        })
        .filter((req) => (req.blockerIds || []).length > 0 && req.count > 0);
      if (pendingNext.length > 0) {
        return enqueueAttackCostPermanentPaymentStep(io, game, gameId, playerId, attackers, pendingNext, 'block', remainingBlockers);
      }
      void resumeDeclareBlockersAfterTapCost(io, game, gameId, playerId, remainingBlockers);
      return true;
    }
    const removeIds = new Set((current.attackerIds || []).map(String));
    const remainingAttackers = attackers.filter((a) => !removeIds.has(String(a.creatureId || '')));
    const remainingIds = new Set(remainingAttackers.map((a) => String(a.creatureId || '')));
    const pendingNext = pending
      .map((req) => {
        const attackerIds = (req.attackerIds || []).filter((id) => remainingIds.has(String(id)));
        return { ...req, attackerIds, count: req.kind === 'tap' ? attackerIds.length : req.count };
      })
      .filter((req) => req.attackerIds.length > 0 && (req.kind === 'tap' ? req.count > 0 : req.count > 0));
    void resumeDeclareAttackersAfterPermanentCost(io, game, gameId, playerId, remainingAttackers, pendingNext);
    return true;
  }

  const existing = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
    .find((step: any) => step?.attackCostPermanentPayment === true);
  if (existing) return true;
  const label = describeAttackPermanentCost(current, combatAction);
  const confirmVerb = current.kind === 'tap'
    ? (combatAction === 'block' ? 'Tap and block' : 'Tap and attack')
    : current.kind === 'return_to_hand'
      ? 'Return and attack'
      : 'Sacrifice and attack';
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: playerId as any,
    sourceId: combatAction === 'block' ? 'block-tap-cost' : 'attack-permanent-cost',
    sourceName: current.sources[0] || (combatAction === 'block' ? 'Block Cost' : 'Attack Cost'),
    description: label,
    targetDescription: current.kind === 'tap'
      ? "untapped creature you control that isn't attacking or blocking"
      : `${current.permanentType} you control`,
    mandatory: false,
    validTargets,
    targetTypes: [current.kind === 'tap' ? 'tap_cost' : current.kind === 'return_to_hand' ? 'return_to_hand_cost' : 'sacrifice_cost'],
    minTargets: current.count,
    maxTargets: current.count,
    confirmLabel: confirmVerb,
    attackCostPermanentPayment: true,
    combatAction,
    permanentCostKind: current.kind,
    permanentCostType: current.permanentType,
    permanentCostCount: current.count,
    permanentCostAttackerIds: current.attackerIds,
    permanentCostBlockerIds: current.blockerIds || [],
    permanentCostSources: current.sources,
    pendingPermanentCosts: pending,
    attackers,
    blockers: blockers || [],
    returnType: current.kind === 'return_to_hand' ? current.permanentType : undefined,
  } as any);
  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
      playerId,
      sourceId: combatAction === 'block' ? 'block-tap-cost' : 'attack-permanent-cost',
      queuedResolutionStep: { ...(step as any) },
    });
  } catch (err) {
    debugWarn(1, '[combat] appendEvent(attackCostPermanentPayment) failed:', err);
  }
  return true;
}

export function enqueueAttackCostPermanentPaymentIfNeeded(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  attackers: AttackerDecl[],
): boolean {
  const requirements = collectAttackPermanentCosts(game.state, playerId, attackers);
  if (!requirements.length) return false;
  enqueueAttackCostPermanentPaymentStep(io, game, gameId, playerId, attackers, requirements);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}

type BlockerDecl = { blockerId: string; attackerId: string };

export function enqueueBlockTapCreatureCostIfNeeded(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  blockers: BlockerDecl[],
): boolean {
  const requirements = collectBlockTapCreatureCosts(game.state, playerId, blockers);
  if (!requirements.length) return false;
  enqueueAttackCostPermanentPaymentStep(io, game, gameId, playerId, [], requirements, 'block', blockers);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}

export async function resumeDeclareBlockersAfterTapCost(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  blockers: BlockerDecl[],
  pendingTapCosts: AttackPermanentCostRequirement[] = [],
): Promise<void> {
  if (pendingTapCosts.length > 0) {
    enqueueAttackCostPermanentPaymentStep(io, game, gameId, playerId, [], pendingTapCosts, 'block', blockers);
    broadcastGame(io, game, gameId);
    return;
  }
  if (!blockers.length) {
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  const uniqueBlockerIds = new Set(blockers.map((b) => String(b.blockerId || '')).filter(Boolean));
  const perBlockerTax = collectBlockTax(game.state);
  let selfTaxTotal = 0;
  const selfTaxSources: string[] = [];
  for (const blockerId of uniqueBlockerIds) {
    const blockerCreature = battlefield.find((perm: any) => String(perm?.id || '') === String(blockerId));
    const selfTax = collectBlockerSelfTax(blockerCreature, battlefield, { players: game.state?.players });
    selfTaxTotal += selfTax.cost;
    for (const source of selfTax.sources) if (!selfTaxSources.includes(source)) selfTaxSources.push(source);
  }
  const totalBlockCostRequired = perBlockerTax.cost * uniqueBlockerIds.size + selfTaxTotal;
  const attackerById = new Map(battlefield.map((perm: any) => [String(perm?.id || ''), perm]));
  const lifeTax = collectBlockLifeTax(game.state, {
    uniqueBlockerIds,
    blockerIsTaxed: (blocker: any, sourceController: string) => {
      const blockerId = String(blocker.id || '');
      return blockers.some((entry) => {
        if (String(entry?.blockerId || '') !== blockerId) return false;
        const attacker: any = attackerById.get(String(entry?.attackerId || ''));
        return String(attacker?.controller || '') === String(sourceController || '');
      });
    },
  });
  const totalBlockLifeRequired = lifeTax.cost;
  const blockSources = [...perBlockerTax.sources, ...selfTaxSources, ...lifeTax.sources];

  if (totalBlockCostRequired > 0 || totalBlockLifeRequired > 0) {
    const totalAvailable = getMaxGenericManaAvailable(game.state, playerId, {
      excludedPermanentIds: [...uniqueBlockerIds],
    });
    if (totalBlockCostRequired > 0 && totalAvailable < totalBlockCostRequired) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INSUFFICIENT_MANA_FOR_BLOCK',
        message: `Cannot block. Need to pay {${totalBlockCostRequired}} for ${blockSources.join(', ')}. You have {${totalAvailable}} available.`,
      });
      broadcastGame(io, game, gameId);
      return;
    }
    const playerLife = Number(
      game.state?.life?.[playerId]
      ?? (game.state?.players || []).find((entry: any) => String(entry?.id || '') === String(playerId))?.life
      ?? 40,
    );
    if (totalBlockLifeRequired > 0 && playerLife <= totalBlockLifeRequired) {
      emitToPlayer(io, playerId as any, 'error', {
        code: 'INSUFFICIENT_LIFE_FOR_BLOCK',
        message: `Cannot block. Need to pay ${totalBlockLifeRequired} life for ${lifeTax.sources.join(', ')}.`,
      });
      broadcastGame(io, game, gameId);
      return;
    }
    const existingPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step?.blockCostPayment === true);
    if (!existingPrompt) {
      const manaLabel = totalBlockCostRequired > 0 ? `{${totalBlockCostRequired}}` : '';
      const lifeLabel = totalBlockLifeRequired > 0 ? `${totalBlockLifeRequired} life` : '';
      const costLabel = [manaLabel, lifeLabel].filter(Boolean).join(' and ');
      const blockCostStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: playerId as any,
        sourceName: 'Block Cost',
        description: `Pay ${costLabel} to block (${blockSources.join(', ')})`,
        mandatory: true,
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: 'pay_block_cost', label: `Pay ${costLabel} and block` },
          { id: 'cancel_block', label: 'Cancel block' },
        ],
        blockCostPayment: true,
        blockCostAmount: totalBlockCostRequired,
        blockCostLifeAmount: totalBlockLifeRequired,
        blockCostSources: blockSources,
        blockers,
      } as any);
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
          playerId,
          sourceId: 'block-cost',
          queuedResolutionStep: { ...(blockCostStep as any) },
        });
      } catch (err) {
        debugWarn(1, '[combat] appendEvent(blockCostPayment after tap) failed:', err);
      }
    }
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // Dynamic import avoids a circular load with combatDeclareBlockersRequest.
  const { executeDeclareBlockers } = await import('./combatDeclareBlockersRequest.js');
  await executeDeclareBlockers(io, gameId, playerId as any, blockers);
}
