/**
 * socket/resolution-handlers/targetSelectionCrewAndEnlistHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two "untapped creatures you control fuel a combat keyword" branches - Crew
 * (validate every chosen crewer, sum effective power against the Vehicle's crew cost, then apply and
 * persist the crewVehicle event) and Enlist (validate the single chosen creature against the
 * attacker, then apply and persist the enlist event).
 * Public entry symbols: tryHandleCrewAbilityTargetSelection, handleEnlistChoiceTargetSelection.
 *
 * The crew branch was guarded by the `isCrewTargetStep` expression, which came along; the dispatcher
 * returns true when the step was a crew step and the caller must stop. The enlist branch always
 * returned, so its call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { creatureHasHaste } from "../game-actions.js";
import { resolveGroupedPermanentRef } from "../tokenGroupResolve.js";
import {
  broadcastGame,
  emitToPlayer,
  getEffectivePower,
  getPlayerName,
} from "../util.js";

/** Crew (Vehicle activated ability) target selection; true when the step was a crew step. */
export async function tryHandleCrewAbilityTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const isCrewTargetStep =
    stepAny?.crewAbility === true
    || (Array.isArray(stepAny?.targetTypes) && stepAny.targetTypes.some((t: any) => String(t).toLowerCase() === 'crew_creature'));
  if (!isCrewTargetStep) return false;

  const vehicleId = String(stepAny?.vehicleId || step.sourceId || '').trim();
  const crewPower = Number(stepAny?.crewPower || 0);
  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const vehicle = battlefield.find((p: any) => p && String(p.id) === vehicleId);
  if (!vehicle || String(vehicle.controller || '') !== String(pid)) {
    debugWarn(1, `[Resolution] crewAbility: vehicle not found/controlled: ${vehicleId}`);
    return true;
  }

  // Validate selected crewers are still legal and total power is sufficient.
  let totalPower = 0;
  const chosenCrewers: any[] = [];
  const resolvedCrewerIds: string[] = [];
  const usedCrewerIds = new Set<string>();
  for (const rawId of selections.map((id: any) => String(id))) {
    const resolvedId =
      resolveGroupedPermanentRef(game, pid as any, rawId, { usedIds: usedCrewerIds }) || rawId;
    const crewer = battlefield.find((p: any) => p && String(p.id) === String(resolvedId));
    if (!crewer) {
      debugWarn(1, `[Resolution] crewAbility: crewer missing: ${rawId} (resolved=${resolvedId})`);
      emitToPlayer(io, pid as any, 'error', { code: 'INVALID_CREWER', message: `Crew failed: selected permanent is no longer available.` });
      return true;
    }
    if (String(crewer.controller || '') !== String(pid)) {
      debugWarn(1, `[Resolution] crewAbility: crewer not controlled by player: ${resolvedId}`);
      emitToPlayer(io, pid as any, 'error', { code: 'INVALID_CREWER', message: `Crew failed: you no longer control that creature.` });
      return true;
    }
    const tl = String(crewer.card?.type_line || '').toLowerCase();
    const grantedCreature = Array.isArray((crewer as any).grantedTypes)
      && (crewer as any).grantedTypes.some((t: any) => String(t).toLowerCase() === 'creature');
    const isCreatureNow = tl.includes('creature') || (crewer as any).crewed === true || grantedCreature;
    if (!isCreatureNow) {
      debugWarn(1, `[Resolution] crewAbility: crewer not a creature: ${resolvedId}`);
      emitToPlayer(io, pid as any, 'error', { code: 'INVALID_CREWER', message: `Crew failed: that permanent is not a creature.` });
      return true;
    }
    if (crewer.tapped) {
      debugWarn(1, `[Resolution] crewAbility: crewer already tapped: ${resolvedId}`);
      emitToPlayer(io, pid as any, 'error', { code: 'INVALID_CREWER', message: `Crew failed: that creature is already tapped.` });
      return true;
    }
    if (String(resolvedId) === String(vehicleId)) {
      debugWarn(1, `[Resolution] crewAbility: vehicle cannot crew itself: ${resolvedId}`);
      emitToPlayer(io, pid as any, 'error', { code: 'INVALID_CREWER', message: `Crew failed: a Vehicle cannot crew itself.` });
      return true;
    }
    usedCrewerIds.add(String(resolvedId));
    resolvedCrewerIds.push(String(resolvedId));
    chosenCrewers.push(crewer);
    totalPower += getEffectivePower(crewer);
  }
  const crewerIds = resolvedCrewerIds;

  if (crewPower > 0 && totalPower < crewPower) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INSUFFICIENT_POWER',
      message: `Selected creatures have total power ${totalPower}, need ${crewPower}+ to crew.`,
    });
    return true;
  }

  debug(1, `[Resolution] Applying crewVehicle for ${vehicleId} with ${selections.length} crewer(s)`);
  // Apply via applyEvent for determinism (replay uses the same path).
  if (typeof (game as any).applyEvent === 'function') {
    (game as any).applyEvent({
      type: 'crewVehicle',
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      vehicleId,
      crewerIds,
    });
  }

  // Persist for replay.
  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'crewVehicle', {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      vehicleId,
      crewerIds,
    });
  } catch {
    // ignore persistence failures
  }

  const vehicleName = String(vehicle?.card?.name || 'Vehicle');
  const crewerNames = chosenCrewers.map((c: any) => String(c?.card?.name || 'Creature')).filter(Boolean);
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} crews ${vehicleName}${crewerNames.length ? ` with ${crewerNames.join(', ')}` : ''}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
  return true;
}

/** Enlist (attacks trigger) target selection. */
export async function handleEnlistChoiceTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const attackerId = String(stepAny?.enlistAttackerId || step.sourceId || '').trim();
  const enlistedCreatureId = String(selections?.[0] || '').trim();
  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const attacker = battlefield.find((p: any) => p && String(p.id) === attackerId);
  const enlisted = battlefield.find((p: any) => p && String(p.id) === enlistedCreatureId);

  if (!attacker || String(attacker.controller || '') !== String(pid)) {
    debugWarn(1, `[Resolution] enlistChoice: attacker not found/controlled: ${attackerId}`);
    return;
  }
  if (!enlisted || String(enlisted.controller || '') !== String(pid)) {
    debugWarn(1, `[Resolution] enlistChoice: enlisted creature not found/controlled: ${enlistedCreatureId}`);
    return;
  }
  const tl = String(enlisted.card?.type_line || '').toLowerCase();
  if (!tl.includes('creature')) {
    debugWarn(1, `[Resolution] enlistChoice: selected permanent is not a creature: ${enlistedCreatureId}`);
    return;
  }
  if (enlisted.tapped) {
    debugWarn(1, `[Resolution] enlistChoice: creature already tapped: ${enlistedCreatureId}`);
    return;
  }
  if (enlisted.attacking) {
    debugWarn(1, `[Resolution] enlistChoice: creature is attacking: ${enlistedCreatureId}`);
    return;
  }
  if ((enlisted as any).summoningSickness && !creatureHasHaste(enlisted, battlefield as any, pid)) {
    debugWarn(1, `[Resolution] enlistChoice: creature has summoning sickness: ${enlistedCreatureId}`);
    return;
  }
  if (String(enlistedCreatureId) === String(attackerId)) {
    debugWarn(1, `[Resolution] enlistChoice: attacker cannot enlist itself: ${enlistedCreatureId}`);
    return;
  }

  if (typeof (game as any).applyEvent === 'function') {
    (game as any).applyEvent({
      type: 'enlist',
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      attackerId,
      enlistedCreatureId,
    });
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'enlist', {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      attackerId,
      enlistedCreatureId,
    });
  } catch {
    // ignore persistence failures
  }

  const attackerName = String(attacker?.card?.name || 'Attacker');
  const enlistedName = String(enlisted?.card?.name || 'Creature');
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} enlists ${enlistedName} for ${attackerName}.`,
    ts: Date.now(),
  });

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}
