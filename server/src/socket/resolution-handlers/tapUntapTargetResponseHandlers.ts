/**
 * socket/resolution-handlers/tapUntapTargetResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: TAP_UNTAP_TARGET case body - target filter validation, the
 * battlefield-ability tap/untap selection path, the plain tap/untap effect path,
 * and the "tap another permanent as an activation cost" resume path.
 * Public entry symbols: handleTapUntapTargetResponse.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { parseTargetRequirements } from "../../rules-engine/targeting";
import {
  applyPowerUpDiscountsToActivationManaCost,
  maybeMarkPowerUpAbilityUsedFromActivationContext,
} from "../../state/modules/marvelMechanicsHelpers.js";
import {
  maybeApplyOracleIrChoiceStepFromResolution,
  maybeResumeOracleIRStepsAfterResolution,
} from "../../state/modules/oracleIrServerZoneSync.js";
import { queueTapTriggersForTappedPermanents } from "../../state/modules/tap-trigger-queue.js";
import { queueBecomesUntappedTriggers } from "../../state/modules/triggers/tap-untap.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import {
  battlefieldAbilityStackReplayEvidence,
  buildActivatedAbilityValidTargets,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { finalizeBattlefieldAbilitySelfExertCost } from "../resolutionGraveyardSelectionHelperUtils.js";
import {
  calculateResolutionManaPoolDelta,
  persistResolutionPaymentManaMutations,
  snapshotResolutionManaPool,
} from "../resolutionPaymentManaUtils.js";
import { broadcastGame, emitToPlayer, getEffectivePower, getEffectiveToughness, getPlayerName } from "../util.js";

/** TAP_UNTAP_TARGET: tap/untap chosen permanents, or resume the activation whose cost required them. */
export async function handleTapUntapTargetResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;
  const payload = response.selections as any;

  const isTapOtherAsActivationCost = (stepData as any)?.tapOtherAbilityAsCost === true;
  const isBattlefieldAbilityTapUntapSelection = (stepData as any)?.battlefieldAbilityTapUntapSelection === true;

  const targetIds: string[] = Array.isArray(payload)
    ? payload.map((x: any) => String(x))
    : (Array.isArray(payload?.targetIds)
        ? payload.targetIds.map((x: any) => String(x))
        : []);

  const requestedAction = String(payload?.action || '');
  const stepAction = String(stepData.action || 'tap');
  const action: 'tap' | 'untap' =
    stepAction === 'both'
      ? (requestedAction === 'untap' ? 'untap' : 'tap')
      : (stepAction === 'untap' ? 'untap' : 'tap');

  const targetCount = Math.max(1, Number(stepData.targetCount || 1));
  if (targetIds.length !== targetCount) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET_COUNT',
      message: `Expected ${targetCount} target(s), got ${targetIds.length}`,
    });
    return;
  }

  const battlefield = game.state?.battlefield || [];
  const targetFilter = stepData.targetFilter || {};
  const controllerFilter: 'you' | 'opponent' | 'any' = targetFilter.controller || 'any';
  const tapStatus: 'tapped' | 'untapped' | 'any' = targetFilter.tapStatus || 'any';
  const excludeSource = targetFilter.excludeSource === true;
  const sourceId = String(step.sourceId || stepData.sourceId || '');
  const requireAllTypes = targetFilter.requireAllTypes === true;
  const minPower = targetFilter.minPower !== undefined ? Number(targetFilter.minPower) : undefined;
  const maxPower = targetFilter.maxPower !== undefined ? Number(targetFilter.maxPower) : undefined;
  const minToughness = targetFilter.minToughness !== undefined ? Number(targetFilter.minToughness) : undefined;
  const maxToughness = targetFilter.maxToughness !== undefined ? Number(targetFilter.maxToughness) : undefined;

  // Validate targets exist and satisfy basic filters
  const targets: any[] = [];
  for (const tid of targetIds) {
    const perm = battlefield.find((p: any) => p?.id === tid);
    if (!perm) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: 'Target not found on battlefield',
      });
      return;
    }
    if (excludeSource && tid === sourceId) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: 'Target must be different from source',
      });
      return;
    }
    if (controllerFilter === 'you' && perm.controller !== pid) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: 'Target must be a permanent you control',
      });
      return;
    }
    if (controllerFilter === 'opponent' && perm.controller === pid) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: "Target must be a permanent you don't control",
      });
      return;
    }

    if (tapStatus === 'tapped' && !perm.tapped) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: 'Target must be tapped',
      });
      return;
    }
    if (tapStatus === 'untapped' && perm.tapped) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'INVALID_TARGET',
        message: 'Target must be untapped',
      });
      return;
    }

    // Type filter (if present)
    const types = Array.isArray(targetFilter.types) ? targetFilter.types : [];
    if (types.length > 0) {
      const typeLine = String(perm.card?.type_line || '').toLowerCase();
      if (requireAllTypes) {
        const matchesAll = types.every((t: any) => typeLine.includes(String(t).toLowerCase()));
        if (!matchesAll) {
          emitToPlayer(io, pid as any, 'error', {
            code: 'INVALID_TARGET',
            message: 'Target does not match required type',
          });
          return;
        }
      } else {
        const matchesAny = types.some((t: any) => typeLine.includes(String(t).toLowerCase()));
        if (!matchesAny) {
        emitToPlayer(io, pid as any, 'error', {
          code: 'INVALID_TARGET',
          message: 'Target does not match required type',
        });
        return;
        }
      }
    }

    // Subtype filter (if present)
    const subtypes = Array.isArray(targetFilter.subtypes) ? targetFilter.subtypes : [];
    if (subtypes.length > 0) {
      const typeLine = String(perm.card?.type_line || '').toLowerCase();
      const matchesAllSub = subtypes.every((sub: any) => typeLine.includes(String(sub).toLowerCase()));
      if (!matchesAllSub) {
        emitToPlayer(io, pid as any, 'error', {
          code: 'INVALID_TARGET',
          message: 'Target does not match required subtype',
        });
        return;
      }
    }

    if (minPower !== undefined || maxPower !== undefined) {
      const pwr = getEffectivePower(perm, game.state);
      if ((minPower !== undefined && pwr < minPower) || (maxPower !== undefined && pwr > maxPower)) {
        emitToPlayer(io, pid as any, 'error', { code: 'INVALID_TARGET', message: 'Target does not match required power' });
        return;
      }
    }
    if (minToughness !== undefined || maxToughness !== undefined) {
      const tgh = getEffectiveToughness(perm, game.state);
      if ((minToughness !== undefined && tgh < minToughness) || (maxToughness !== undefined && tgh > maxToughness)) {
        emitToPlayer(io, pid as any, 'error', { code: 'INVALID_TARGET', message: 'Target does not match required toughness' });
        return;
      }
    }

    targets.push(perm);
  }

  if (isBattlefieldAbilityTapUntapSelection) {
    const controllerId = String(pid);
    const permanentId = String(stepData?.permanentId || step.sourceId || '').trim();
    const abilityId = String(stepData?.abilityId || '').trim();
    const cardName = String(stepData?.cardName || step.sourceName || 'Ability');
    const abilityText = String(stepData?.abilityText || step.description || '').trim();
    const activatedAbilityText = String(stepData?.activatedAbilityText || '').trim();
    const tappedPermanentsForCost = Array.isArray(stepData?.tappedPermanentsForCost)
      ? stepData.tappedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : [];
    const lifePaidForCost = Number(stepData?.lifePaidForCost || 0);

    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: controllerId,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      activatedAbilityText: activatedAbilityText || undefined,
      targets: [...targetIds],
      tapUntapAction: action,
    } as any;

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, controllerId, permanentId, {
      activatedAbilityText: activatedAbilityText || `${String(stepData?.manaCost || '')}: ${abilityText}`,
      abilityId,
    });
    const exertedPermanentIdForCost = finalizeBattlefieldAbilitySelfExertCost(
      game,
      gameId,
      controllerId,
      permanentId,
      stepData?.requiresSelfExertForCost === true,
    );
    fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          ...battlefieldAbilityStackReplayEvidence(stackItem.id),
          playerId: controllerId,
          resolvedStepId: String((step as any).id || ''),
          permanentId,
          abilityId: abilityId || undefined,
          cardName,
          abilityText,
          activatedAbilityText: activatedAbilityText || undefined,
          targets: [...targetIds],
          tappedPermanents: tappedPermanentsForCost,
          lifePaidForCost: Number.isFinite(lifePaidForCost) && lifePaidForCost > 0 ? lifePaidForCost : undefined,
          exertedPermanentIdForCost,
          tapUntapAction: action,
        });
      } catch {
        // ignore persistence failures
      }
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    broadcastGame(io, game, gameId);
    return;
  }

  // Normal TAP_UNTAP_TARGET use (effects) emits chat + persists a tap/untap event.
  // Activation-cost use should NOT persist a separate tap event; those taps are
  // persisted as part of activateBattlefieldAbility for deterministic replay.
  if (!isTapOtherAsActivationCost) {
    const affectedNames: string[] = [];
    const newlyTappedIds: string[] = [];
    for (const target of targets) {
      if (action === 'tap') {
        if (!target.tapped) {
          target.tapped = true;
          affectedNames.push(String(target.card?.name || 'permanent'));
          newlyTappedIds.push(String(target.id || ''));
        }
      } else {
        if (target.tapped) {
          target.tapped = false;
          queueBecomesUntappedTriggers(game as any, target);
          affectedNames.push(String(target.card?.name || 'permanent'));
        }
      }
    }

    if (affectedNames.length > 0) {
      const targetsText = affectedNames.length === 1
        ? affectedNames[0]
        : `${affectedNames.slice(0, -1).join(', ')} and ${affectedNames[affectedNames.length - 1]}`;

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} used ${String(step.sourceName || 'an ability')} to ${action} ${targetsText}.`,
        ts: Date.now(),
      });
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, action === 'tap' ? 'permanent_tapped' : 'permanent_untapped', {
        playerId: pid,
        resolvedStepId: String((step as any).id || ''),
        permanentIds: targetIds,
        source: String(step.sourceName || ''),
        ts: Date.now(),
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(tap/untap) failed:', e);
    }

    if (action === 'tap' && newlyTappedIds.length > 0) {
      queueTapTriggersForTappedPermanents(io, game, gameId, newlyTappedIds, String(pid));
    }
  }

  if (!isTapOtherAsActivationCost && !isBattlefieldAbilityTapUntapSelection) {
    const oracleIrChoiceJson = String((step as any)?.oracleIrChoiceStepJson || '').trim();
    const oracleIrResumeJson = String((step as any)?.oracleIrResumeStepsJson || '').trim();
    if (oracleIrChoiceJson || oracleIrResumeJson) {
      const ctx = ((game as any).ctx || game) as any;
      ctx.gameId = gameId;
      ctx.state = game.state;
      if (oracleIrChoiceJson) {
        const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, step, response);
        if (resumed) {
          maybeResumeOracleIRStepsAfterResolution(ctx, step);
        }
      } else {
        maybeResumeOracleIRStepsAfterResolution(ctx, step);
      }
      game.state = ctx.state;
    }
  }

  // Activation-cost tap flow: resume the battlefield ability activation.
  if (isTapOtherAsActivationCost) {
    const stepAny = stepData as any;
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const abilityId = String(stepAny?.abilityId || '').trim();
    const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
    const abilityText = String(stepAny?.abilityText || step.description || '');
    const requiresTap = Boolean(stepAny?.requiresTap);
    const lifeToPayForCost = stepAny?.lifeToPayForCost !== undefined ? Number(stepAny.lifeToPayForCost) : 0;

    if (action !== 'tap') {
      emitToPlayer(io, controllerId, 'error', { code: 'INVALID_SELECTION', message: 'Activation cost requires tapping targets' });
      return;
    }

    const battlefieldNow = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const sourcePerm = battlefieldNow.find((p: any) => p && String(p.id) === String(permanentId));
    if (!sourcePerm) {
      emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return;
    }
    const activatedAbilityTextForDiscount = String(stepAny?.activatedAbilityText || '').trim()
      || `${String(stepAny?.manaCost || '')}: ${abilityText}`;
    const manaCost = applyPowerUpDiscountsToActivationManaCost(
      String(stepAny?.manaCost || ''),
      sourcePerm,
      game.state,
      controllerId,
      { activatedAbilityText: activatedAbilityTextForDiscount, abilityId },
    );
    if (String(sourcePerm.controller || '') !== controllerId) {
      emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
      return;
    }
    if (requiresTap && (sourcePerm as any).tapped) {
      emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: `${cardName} is already tapped` });
      return;
    }

    // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus the tap-other clause.
    const remainingNonManaCostText = manaCost
      .replace(/\{[^}]+\}/g, ' ')
      .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
      .replace(/\btap\s+(?:another\s+|other\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+untapped\s+[a-z]+(?:\s+[a-z]+)*(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?\s+you\s+control(?:\s+with\s+(?:power|toughness)\s+\d+\s+or\s+(?:less|greater))?\b/gi, ' ')
      .replace(/[\s,]+/g, ' ')
      .trim();
    if (remainingNonManaCostText.length > 0) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${remainingNonManaCostText}).` });
      return;
    }

    // Pay mana portion of the activation cost (conservative: no Phyrexian and no X).
    const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
    const manaOnly = manaSymbols
      .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
      .join('');
    if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
      return;
    }

    let tapOtherPaymentManaDelta: Record<string, number> | undefined;
    if (manaOnly) {
      const { payAbilityManaCostFromPool } = await import('../util.js');
      const manaPoolBeforeTapOther = snapshotResolutionManaPool((game.state as any)?.manaPool?.[controllerId]);
      const paid = payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[tapOtherAbilityAsCost]');
      if (!paid.ok) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (paid as any).error || 'Insufficient mana.' });
        return;
      }
      tapOtherPaymentManaDelta = calculateResolutionManaPoolDelta(
        manaPoolBeforeTapOther,
        (game.state as any)?.manaPool?.[controllerId],
      );
      persistResolutionPaymentManaMutations(game, controllerId, undefined, tapOtherPaymentManaDelta);
    }

    if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
      const stateAny = game.state as any;
      stateAny.life = stateAny.life || {};
      const currentLife = Number(stateAny.life?.[controllerId] ?? 40);
      if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
        });
        return;
      }
      stateAny.life[controllerId] = Math.max(0, currentLife - lifeToPayForCost);
    }

    // Apply the tap-other portion of the activation cost only after mana/life are validated and paid.
    for (const target of targets) {
      if (!target.tapped) target.tapped = true;
    }

    const tappedPermanentsForCost: string[] = [];
    const tappedSet = new Set<string>();
    for (const tid of targetIds) tappedSet.add(String(tid));

    if (requiresTap) {
      (sourcePerm as any).tapped = true;
      tappedSet.add(String(permanentId));
    }
    for (const id of tappedSet) tappedPermanentsForCost.push(id);

    const targetReqs = parseTargetRequirements(abilityText, {
      gameState: game.state,
      controllerId: String(controllerId),
      sourceName: cardName,
      sourcePermanent: sourcePerm,
    });
    if (targetReqs.needsTargets) {
      const validTargets = buildActivatedAbilityValidTargets(game, controllerId, targetReqs);
      const minTargets = Number(targetReqs.minTargets ?? 1);
      const maxTargets = Number(targetReqs.maxTargets ?? minTargets);
      if (validTargets.length < minTargets) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'NO_VALID_TARGETS',
          message: `${cardName}'s ability requires at least ${minTargets} target(s), but only ${validTargets.length} are available.`,
        });
        return;
      }

      const useGraveyardSelection = Array.isArray(targetReqs.targetTypes)
        && targetReqs.targetTypes.length > 0
        && targetReqs.targetTypes.every((targetType) => String(targetType || '').toLowerCase().startsWith('graveyard_'))
        && typeof targetReqs.targetTotalPowerLimit === 'number'
        && Number.isFinite(targetReqs.targetTotalPowerLimit)
        && targetReqs.targetTotalPowerLimit > 0;
      const graveyardSelectionTargetPlayerId = useGraveyardSelection
        ? (() => {
            const ownerIds = Array.from(new Set(validTargets.map((target: any) => String(target?.zoneOwnerId || target?.controller || '')).filter(Boolean)));
            return ownerIds.length === 1 ? ownerIds[0] : undefined;
          })()
        : undefined;
      const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, (useGraveyardSelection
        ? {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: controllerId as any,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
            title: cardName,
            description: `Choose ${targetReqs.targetDescription || 'target'} for ${cardName}`,
            mandatory: minTargets > 0,
            validTargets,
            targetTypes: targetReqs.targetTypes,
            minTargets,
            maxTargets,
            targetDescription: targetReqs.targetDescription || 'target',
            targetPlayerId: graveyardSelectionTargetPlayerId,
            destination: 'battlefield',
            totalPowerLimit: Number(targetReqs.targetTotalPowerLimit),
            battlefieldAbilityTargetSelection: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
            tappedPermanentsForCost,
            tapCostTargetFilter: { ...(targetFilter || {}) },
            tapCostTargetCount: targetIds.length,
            tapCostPreferTokens: targets.length > 0 && targets.every((target: any) => Boolean(target?.isToken)),
            tapCostPreferNonTokens: targets.length > 0 && targets.every((target: any) => !target?.isToken),
          }
        : {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: controllerId as any,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
            description: abilityText,
            mandatory: minTargets > 0,
            validTargets,
            targetTypes: targetReqs.targetTypes,
            minTargets,
            maxTargets,
            targetDescription: targetReqs.targetDescription || 'target',
            battlefieldAbilityTargetSelection: true,
            permanentId,
            abilityId,
            cardName,
            abilityText,
            activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
            tappedPermanentsForCost,
            tapCostTargetFilter: { ...(targetFilter || {}) },
            tapCostTargetCount: targetIds.length,
            tapCostPreferTokens: targets.length > 0 && targets.every((target: any) => Boolean(target?.isToken)),
            tapCostPreferNonTokens: targets.length > 0 && targets.every((target: any) => !target?.isToken),
          }) as any);

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          playerId: controllerId,
          resolvedStepId: String((step as any).id || ''),
          permanentId,
          abilityId: abilityId || undefined,
          cardName,
          abilityText,
          activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
          tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
          lifePaidForCost: Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
          queuedResolutionStep,
        });
      } catch {
        // ignore persistence failures
      }

      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }

    // Put the ability on the stack.
    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: controllerId,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
    } as any;

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, controllerId, permanentId, {
      activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
      abilityId,
    });
    fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          ...battlefieldAbilityStackReplayEvidence(stackItem.id),
          playerId: controllerId,
          resolvedStepId: String((step as any).id || ''),
          permanentId,
          abilityId: abilityId || undefined,
          cardName,
          abilityText,
          activatedAbilityText: String(stepAny?.activatedAbilityText || '').trim() || `${manaCost}: ${abilityText}`,
          tappedPermanents: tappedPermanentsForCost,
          lifePaidForCost: Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0 ? lifeToPayForCost : undefined,
        });
      } catch {
        // ignore persistence failures
      }
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}'s ability: ${abilityText}`,
      ts: Date.now(),
    });

    if (tappedPermanentsForCost.length > 0) {
      queueTapTriggersForTappedPermanents(io, game, gameId, tappedPermanentsForCost, controllerId);
    }

    if (typeof game.bumpSeq === 'function') game.bumpSeq();

    broadcastGame(io, game, gameId);
    return;
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  broadcastGame(io, game, gameId);
}
