/**
 * socket/resolution-handlers/targetSelectionActivationCostPaymentHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: two sibling activation-cost branches that pick which permanent pays a battlefield
 * ability's non-mana cost - `removeCountersAbilityAsCost` (remove N counters from a chosen
 * permanent) and `returnToHandAbilityAsCost` (bounce a chosen permanent). Both validate the
 * remaining cost text, pay the mana/life portion, apply the cost, and push the ability on the stack.
 * Public entry symbols: handleRemoveCountersAbilityAsCostTargetSelection,
 * handleReturnToHandAbilityAsCostTargetSelection.
 *
 * Both branches always returned, so each caller does `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** TARGET_SELECTION with `removeCountersAbilityAsCost`: remove the counters, then stack the ability. */
export async function handleRemoveCountersAbilityAsCostTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const controllerId = String(step.playerId || pid);
  const sourcePermanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
  const abilityId = String(stepAny?.abilityId || '').trim();
  const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
  const abilityText = String(stepAny?.abilityText || step.description || '');
  const manaCost = String(stepAny?.manaCost || '');
  const requiresTap = Boolean(stepAny?.requiresTap);
  const removeCount = Number(stepAny?.removeCount || 1);
  const counterTypeLabel = String(stepAny?.counterType || '').trim();
  const counterKeyCandidatesRaw = Array.isArray(stepAny?.counterKeyCandidates) ? stepAny.counterKeyCandidates : undefined;
  const counterKeyCandidates: string[] = counterKeyCandidatesRaw && counterKeyCandidatesRaw.length
    ? counterKeyCandidatesRaw.map((x: any) => String(x))
    : [counterTypeLabel];
  const removeFromType = String(stepAny?.removeFromType || 'permanent').toLowerCase();
  const mustBeOther = Boolean(stepAny?.mustBeOther);

  if (!sourcePermanentId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Missing source permanent' });
    return;
  }
  if (!Number.isFinite(removeCount) || removeCount <= 0) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'UNSUPPORTED_COST', message: 'Invalid counter removal count' });
    return;
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(sourcePermanentId));
  if (!sourcePerm) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
    return;
  }
  if (String(sourcePerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
    return;
  }
  if (requiresTap && (sourcePerm as any).tapped) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'ALREADY_TAPPED', message: `${cardName} is already tapped` });
    return;
  }

  const chosenTargetId = String(selections?.[0] || '').trim();
  const chosenPerm = battlefield.find((p: any) => p && String(p.id) === chosenTargetId);
  if (!chosenPerm || String(chosenPerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: 'Chosen permanent is no longer valid' });
    return;
  }
  if (mustBeOther && String(chosenTargetId) === String(sourcePermanentId)) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: 'You must choose another permanent' });
    return;
  }
  const chosenTypeLine = String(chosenPerm.card?.type_line || '').toLowerCase();
  if (removeFromType !== 'permanent' && !chosenTypeLine.includes(removeFromType)) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: `Chosen permanent is not a ${removeFromType}` });
    return;
  }

  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus a remove-counters clause.
  const remainingNonManaCostText = manaCost
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\bremove\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+[^,]+?\s+counters?\s+from\s+[^,]+\b/gi, ' ')
    .replace(/[\s,]+/g, ' ')
    .trim();
  if (remainingNonManaCostText.length > 0) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'UNSUPPORTED_COST',
      message: `Unsupported activation cost (${remainingNonManaCostText}).`,
    });
    return;
  }

  const counters = (chosenPerm as any).counters || {};
  const actualKey = counterKeyCandidates.find((k) => Number(counters?.[k] || 0) >= removeCount);
  const haveN = actualKey ? Number(counters?.[actualKey] || 0) : 0;
  if (!actualKey || haveN < removeCount) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'INSUFFICIENT_COUNTERS',
      message: `Selected permanent doesn't have enough ${counterTypeLabel || 'required'} counter(s). (Need ${removeCount}, have ${haveN})`,
    });
    return;
  }

  // Pay mana portion of the activation cost (conservative: no Phyrexian and no X) BEFORE removing counters.
  const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
  const manaOnly = manaSymbols
    .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
    .join('');
  if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'UNSUPPORTED_COST',
      message: `Unsupported activation cost (${manaOnly || 'complex cost'})`,
    });
    return;
  }
  if (manaOnly) {
    const { payAbilityManaCostFromPool } = await import('../util.js');
    const paid = payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[removeCountersAbilityAsCost]');
    if (!paid.ok) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'INSUFFICIENT_MANA', message: (paid as any).error || 'Insufficient mana.' });
      return;
    }
  }

  // Remove counters now (this is the chosen cost payment).
  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as unknown as GameContext;
  const { updateCounters } = await import('../../state/modules/counters_tokens.js');
  updateCounters(ctx as any, String(chosenTargetId), { [actualKey]: -removeCount });

  const tappedPermanentsForCost: string[] = [];
  if (requiresTap && !(sourcePerm as any).tapped) {
    (sourcePerm as any).tapped = true;
    tappedPermanentsForCost.push(String(sourcePermanentId));
  }

  // Put the ability on the stack.
  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: controllerId,
    source: sourcePermanentId,
    sourceName: cardName,
    description: abilityText,
  } as any;
  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);
  fireBattlefieldAbilityActivatedTriggers(game, controllerId, sourcePermanentId, abilityText, gameId, stackItem.id, () => {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        ...battlefieldAbilityStackReplayEvidence(stackItem.id),
        playerId: controllerId,
        permanentId: sourcePermanentId,
        abilityId: abilityId || undefined,
        cardName,
        abilityText,
        activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || undefined,
        tappedPermanents: tappedPermanentsForCost,
        removedCountersForCost: [{ permanentId: String(chosenTargetId), counterType: actualKey, count: removeCount }],
      });
    } catch {
      // ignore persistence failures
    }
  });

  const chosenName = String(chosenPerm?.card?.name || removeFromType || 'permanent');
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName}'s ability: ${abilityText} (removed ${removeCount} ${counterTypeLabel || actualKey} counter${removeCount === 1 ? '' : 's'} from ${chosenName})`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') game.bumpSeq();

  broadcastGame(io, game, gameId);
}

/** TARGET_SELECTION with `returnToHandAbilityAsCost`: bounce the chosen permanent, then stack the ability. */
export async function handleReturnToHandAbilityAsCostTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const controllerId = String(step.playerId || pid);
  const sourcePermanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
  const abilityId = String(stepAny?.abilityId || '').trim();
  const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
  const abilityText = String(stepAny?.abilityText || step.description || '');
  const manaCost = String(stepAny?.manaCost || '');
  const requiresTap = Boolean(stepAny?.requiresTap);
  const mustBeOther = Boolean(stepAny?.mustBeOther);
  const returnType = String(stepAny?.returnType || 'permanent').toLowerCase();
  const activatedAbilityText = String(stepAny?.activatedAbilityText || '').trim();
  const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);

  if (!sourcePermanentId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Missing source permanent' });
    return;
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(sourcePermanentId));
  if (!sourcePerm) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
    return;
  }
  if (String(sourcePerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
    return;
  }
  if (requiresTap && (sourcePerm as any).tapped) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'ALREADY_TAPPED', message: `${cardName} is already tapped` });
    return;
  }

  const chosenId = String(selections?.[0] || '').trim();
  const chosenPerm = battlefield.find((p: any) => p && String(p.id) === chosenId);
  if (!chosenPerm || String(chosenPerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: 'Chosen permanent is no longer valid' });
    return;
  }
  if (mustBeOther && String(chosenId) === String(sourcePermanentId)) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: 'You must choose another permanent' });
    return;
  }

  const chosenTypeLine = String(chosenPerm.card?.type_line || '').toLowerCase();
  if (returnType === 'nonland permanent') {
    if (chosenTypeLine.includes('land')) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: 'Chosen permanent must be nonland' });
      return;
    }
  } else if (returnType !== 'permanent' && returnType) {
    if (!chosenTypeLine.includes(returnType)) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'INVALID_SELECTION', message: `Chosen permanent is not a ${returnType}` });
      return;
    }
  }

  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the return clause.
  const remainingNonManaCostText = manaCost
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
    .replace(
      /\breturn\s+(?:(?:another|other)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(?:a|an|one|1)\s+(?:creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/gi,
      ' '
    )
    .replace(/[\s,]+/g, ' ')
    .trim();
  if (remainingNonManaCostText.length > 0) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'UNSUPPORTED_COST',
      message: `Unsupported activation cost (${remainingNonManaCostText}).`,
    });
    return;
  }

  // Validate deferred life payment (actual payment happens after the target selection resolves)
  if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
    const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
    if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INSUFFICIENT_LIFE',
        message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
      });
      return;
    }
  }

  // Validate and then pay mana portion of the activation cost (conservative: no Phyrexian and no X).
  const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
  const manaOnly = manaSymbols
    .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
    .join('');
  if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
    return;
  }
  let consumeMana: (() => Promise<void>) | undefined;
  if (manaOnly) {
    const { validateAbilityManaCostFromPool, payAbilityManaCostFromPool } = await import('../util.js');
    const validated = validateAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm);
    if (validated.ok === false) {
      emitToPlayer(io, controllerId as any, 'error', { code: 'INSUFFICIENT_MANA', message: validated.error || 'Insufficient mana.' });
      return;
    }

    consumeMana = async () => {
      payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[returnToHandAbilityAsCost]');
    };
  }

  // Apply the return-to-hand cost.
  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
    commandZone: (game.state as any).commandZone,
  } as unknown as GameContext;

  const { movePermanentToHand } = await import('../../state/modules/zones.js');
  const ok = movePermanentToHand(ctx as any, chosenId);
  if (!ok) {
    emitToPlayer(io, controllerId as any, 'error', { code: 'MOVE_FAILED', message: 'Failed to return permanent to hand' });
    return;
  }

  if (consumeMana) {
    await consumeMana();
  }

  // Optional deferred life payment (validated at activation time; applied now so cancel doesn't charge life)
  if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
    const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
    if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INSUFFICIENT_LIFE',
        message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
      });
      return;
    }
    (game.state as any).life[controllerId] = currentLife - lifeToPayForCost;
  }

  const tappedPermanentsForCost: string[] = [];
  if (requiresTap && !(sourcePerm as any).tapped) {
    (sourcePerm as any).tapped = true;
    tappedPermanentsForCost.push(String(sourcePermanentId));
  }

  // Put the ability on the stack.
  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: controllerId,
    source: sourcePermanentId,
    sourceName: cardName,
    description: abilityText,
    ...(activatedAbilityText ? { activatedAbilityText } : null),
  } as any;

  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);
  fireBattlefieldAbilityActivatedTriggers(game, controllerId, sourcePermanentId, abilityText, gameId, stackItem.id, () => {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        ...battlefieldAbilityStackReplayEvidence(stackItem.id),
        playerId: controllerId,
        permanentId: sourcePermanentId,
        abilityId: abilityId || undefined,
        cardName,
        abilityText,
        tappedPermanents: tappedPermanentsForCost,
        returnedPermanentsToHandForCost: [chosenId],
        activatedAbilityText: activatedAbilityText || undefined,
        lifePaidForCost: Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
      });
    } catch {
      // ignore persistence failures
    }
  });

  const returnedName = String(chosenPerm?.card?.name || returnType || 'permanent');
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName}'s ability: ${abilityText} (returned ${returnedName} to its owner's hand)`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') game.bumpSeq();

  broadcastGame(io, game, gameId);
}
