// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyAirbendStep, applyEarthbendStep, applyAnimatePermanentStep.
// Public entries: those three apply* functions.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { grantAirbendPermissionToExiledCards } from './oracleIRExecutorBattlefieldAirbendPermission';
import { normalizeAnimatePermanentTargetText } from './oracleIRExecutorBattlefieldAnimateTargetText';
import { annotateBattlefieldExilesWithSource } from './oracleIRExecutorBattlefieldAnnotateExiles';
import { appendPermanentTypes } from './oracleIRExecutorBattlefieldAppendPermanentTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import {
  resolveBoundSelectorMatches,
  resolveContextualBattlefieldPermanents,
} from './oracleIRExecutorBattlefieldContextualResolvers';
import { inferGrantTemporaryAbilityTargetFromRaw } from './oracleIRExecutorBattlefieldGrantTemporaryTargetText';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import {
  oracleIrBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldRemovalHelpers';
import { resolveSubtypeOrCompoundBattlefieldPermanents } from './oracleIRExecutorBattlefieldSubtypeCompoundResolvers';
import {
  finalizeBattlefieldRemoval,
  permanentMatchesSelector,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { resolveOracleQuantity } from './oracleIRExecutorResolveQuantity';
import { EARTHBENDED_PROPERTIES } from './keywordActions/earthbend';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';

export function applyAirbendStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'airbend' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').replace(/\u2019/g, "'").trim();
  const normalizedTarget = targetText.toLowerCase().replace(/\s+/g, ' ').trim();
  const directTarget = /\btarget\b/.test(normalizedTarget);
  const allowsZeroTargets = /^(?:up to\s+|any number of\s+)/i.test(targetText);
  const explicitSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  const explicitPermanentIds = Array.from(
    new Set(
      [
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        ...(
          Array.isArray(ctx.selectorContext?.chosenObjectIds)
            ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
            : []
        ),
      ].filter(Boolean)
    )
  );

  if (directTarget && allowsZeroTargets && explicitPermanentIds.length === 0 && !explicitSpellId) {
    return { applied: true, state, log: [] };
  }

  let permanentTargets: BattlefieldPermanent[] = [];
  if (/^any number of other target nonland permanents you control$/i.test(normalizedTarget)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    permanentTargets = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.has(permanentId) || (sourceId && permanentId === sourceId)) return false;
      return permanentMatchesType(perm, 'nonland_permanent');
    });
  } else {
  const allOtherMatch = normalizedTarget.match(/^(all|each)\s+other\s+(.+)$/i);
  if (allOtherMatch) {
    const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: `${allOtherMatch[1]} ${allOtherMatch[2]}` } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped airbend (unsupported target): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    const excludedIds = new Set(explicitPermanentIds);
    permanentTargets = battlefield.filter(
      (perm: any) =>
        permanentMatchesSelector(perm, selector, ctx) && !excludedIds.has(String((perm as any)?.id || '').trim())
    );
  } else {
    const massSelector = !directTarget ? parseSimpleBattlefieldSelector(step.target as any) : null;
    permanentTargets = massSelector
      ? battlefield.filter((perm: any) => permanentMatchesSelector(perm, massSelector, ctx))
      : resolveContextualBattlefieldPermanents(battlefield, step.target as any, ctx);
  }
  }

  const wantsSpellTarget = /\bspell\b/.test(normalizedTarget);
  let targetSpell: any = null;
  if (wantsSpellTarget && (explicitSpellId || (directTarget && permanentTargets.length === 0))) {
    const stackItems = Array.isArray((state as any).stack) ? [ ...((state as any).stack as any[]) ] : [];
    const candidateSpells = stackItems.filter((item) => {
      const itemId = String((item as any)?.id || '').trim();
      return String((item as any)?.type || '').trim() === 'spell' && itemId && itemId !== String(ctx.sourceId || '').trim();
    });

    targetSpell = explicitSpellId
      ? candidateSpells.find((item) => String((item as any)?.id || '').trim() === explicitSpellId)
      : candidateSpells.length === 1
        ? candidateSpells[0]
        : null;

    if (explicitSpellId && !targetSpell) {
      return {
        applied: false,
        message: `Skipped airbend (target spell not found on stack): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    if (!explicitSpellId && !targetSpell && candidateSpells.length > 1) {
      return {
        applied: false,
        message: `Skipped airbend (needs spell target choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
  }

  const massSelection =
    /^any number of other target nonland permanents you control$/i.test(normalizedTarget) ||
    /^(all|each)\s+other\s+/i.test(normalizedTarget) ||
    (!directTarget && Boolean(parseSimpleBattlefieldSelector(step.target as any)));
  if (permanentTargets.length === 0 && !targetSpell) {
    if (massSelection) return { applied: true, state, log: [] };
    return {
      applied: false,
      message: `Skipped airbend (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let nextState = state;
  const movedCards: any[] = [];
  let affectedCount = 0;
  const log: string[] = [];

  if (permanentTargets.length > 0) {
    const removedIds = new Set<string>(permanentTargets.map((perm) => String((perm as any)?.id || '').trim()).filter(Boolean));
    const kept = battlefield.filter((perm) => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(nextState, permanentTargets, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    nextState = annotateBattlefieldExilesWithSource(result.state, permanentTargets, ctx);
    movedCards.push(
      ...permanentTargets
        .filter((perm) => !(perm as any).isToken)
        .map((perm) => buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'))
    );
    affectedCount += permanentTargets.length;
    log.push(...result.log);
  }

  if (targetSpell) {
    const targetSpellId = String((targetSpell as any)?.id || '').trim();
    const ownerId = String(
      (targetSpell as any)?.owner ||
        (targetSpell as any)?.ownerId ||
        (targetSpell as any)?.controller ||
        (targetSpell as any)?.controllerId ||
        ''
    ).trim();
    if (!targetSpellId || !ownerId) {
      return {
        applied: false,
        message: `Skipped airbend (missing stack spell owner metadata): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    const currentStack = Array.isArray((nextState as any).stack) ? [ ...((nextState as any).stack as any[]) ] : [];
    const sourceId = String(ctx.sourceId || '').trim();
    const sourceRef = sourceId || String(ctx.sourceName || '').trim();
    const baseCard = ((targetSpell as any)?.card && typeof (targetSpell as any).card === 'object')
      ? { ...((targetSpell as any).card || {}) }
      : { ...(targetSpell as any) };
    const exiledSpellCard = {
      ...baseCard,
      id: String((baseCard as any)?.id || targetSpellId).trim() || targetSpellId,
      name: String((baseCard as any)?.name || (targetSpell as any)?.name || targetSpellId).trim() || targetSpellId,
      zone: 'exile',
      owner: ownerId,
      ownerId,
      ...(sourceRef ? { exiledBy: sourceRef } : {}),
      ...(sourceId ? { exiledWith: sourceId, exiledWithSourceId: sourceId } : {}),
    };

    const updatedStack = currentStack.filter((item) => String((item as any)?.id || '').trim() !== targetSpellId);
    const updatedPlayers = (nextState.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== ownerId) return player;
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      return {
        ...player,
        exile: [...exile, exiledSpellCard],
      };
    });

    nextState = {
      ...(nextState as any),
      stack: updatedStack as any,
      players: updatedPlayers as any,
    } as GameState;
    movedCards.push(exiledSpellCard);
    affectedCount += 1;
    log.push(`${ownerId} exiles ${exiledSpellCard.name} from the stack`);
  }

  const permissionResult = grantAirbendPermissionToExiledCards(nextState, movedCards);
  nextState = permissionResult.state;
  if (permissionResult.granted > 0) {
    log.push(`Granted airbend permission for ${permissionResult.granted} exiled card(s)`);
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Airbended ${affectedCount} object(s)`],
    ...(movedCards.length > 0 ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length } : {}),
  };
}

export function applyEarthbendStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'earthbend' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || String((state.players || [])[0]?.id || '').trim()) as PlayerID;
  const amountValue = resolveOracleQuantity(state, controllerId, step.amount, ctx, {
    whereX: step.whereX,
    targetCreatureId: String(
      ctx.targetCreatureId ||
        ctx.selectorContext?.targetCreatureId ||
        ctx.targetPermanentId ||
        ctx.selectorContext?.targetPermanentId ||
        ''
    ).trim() || undefined,
  });
  if (amountValue === null || amountValue < 0) {
    return {
      applied: false,
      message: `Skipped earthbend (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const explicitTargetId = String(ctx.targetPermanentId || '').trim();
  const targets =
    explicitTargetId && /^target\b/.test(targetText)
      ? battlefield.filter((perm: any) => String((perm as any)?.id || '').trim() === explicitTargetId)
      : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean))
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped earthbend (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped earthbend (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;

  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return permanent;

    const earthbendedPermanent = appendPermanentTypes(permanent, EARTHBENDED_PROPERTIES.addedTypes);
    const counters = { ...(((earthbendedPermanent as any)?.counters || {}) as Record<string, number>) };
    const currentCounterCount = Number(counters['+1/+1'] ?? 0);
    counters['+1/+1'] = (Number.isFinite(currentCounterCount) ? currentCounterCount : 0) + amountValue;

    const grantedAbilities = Array.isArray((earthbendedPermanent as any)?.grantedAbilities)
      ? [...(earthbendedPermanent as any).grantedAbilities]
      : [];
    if (!grantedAbilities.some((ability: unknown) => String(ability || '').trim().toLowerCase() === 'haste')) {
      grantedAbilities.push('haste');
    }

    return {
      ...(earthbendedPermanent as any),
      counters,
      power: EARTHBENDED_PROPERTIES.basePower,
      toughness: EARTHBENDED_PROPERTIES.baseToughness,
      basePower: EARTHBENDED_PROPERTIES.basePower,
      baseToughness: EARTHBENDED_PROPERTIES.baseToughness,
      effectivePower: undefined,
      effectiveToughness: undefined,
      grantedAbilities,
    } as BattlefieldPermanent;
  });

  const processedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield: nextBattlefield } as GameState);
  const processedById = new Map(
    processedBattlefield.map((permanent: any) => [String((permanent as any)?.id || '').trim(), permanent])
  );
  const reconciledBattlefield = nextBattlefield.map((permanent: any) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return permanent;
    const processedPermanent = processedById.get(permanentId) as any;
    if (!processedPermanent) return permanent;
    return {
      ...(permanent as any),
      power:
        typeof processedPermanent.effectivePower === 'number'
          ? processedPermanent.effectivePower
          : typeof processedPermanent.power === 'number'
            ? processedPermanent.power
            : (permanent as any).power,
      toughness:
        typeof processedPermanent.effectiveToughness === 'number'
          ? processedPermanent.effectiveToughness
          : typeof processedPermanent.toughness === 'number'
            ? processedPermanent.toughness
            : (permanent as any).toughness,
      effectivePower: processedPermanent.effectivePower,
      effectiveToughness: processedPermanent.effectiveToughness,
      grantedAbilities: processedPermanent.grantedAbilities,
    } as BattlefieldPermanent;
  });

  let delayedTriggerRegistry = ((state as any).delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<typeof createDelayedTriggerRegistry>;
  for (const targetId of targetIds) {
    delayedTriggerRegistry = registerDelayedTrigger(
      delayedTriggerRegistry,
      createDelayedTrigger(
        String(ctx.sourceId || ctx.sourceName || 'earthbend').trim() || 'earthbend',
        String(ctx.sourceName || 'Earthbend').trim() || 'Earthbend',
        controllerId,
        DelayedTriggerTiming.WHEN_DIES_OR_EXILED,
        'Return it to the battlefield tapped under your control.',
        currentTurn,
        {
          watchingPermanentId: targetId,
          targets: [targetId],
          eventDataSnapshot: {
            sourceId: String(ctx.sourceId || '').trim() || undefined,
            sourceControllerId: String(controllerId || '').trim() || undefined,
            targetPermanentId: targetId,
            chosenObjectIds: [targetId],
          },
        }
      )
    );
  }

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: reconciledBattlefield as any,
      delayedTriggerRegistry,
    } as GameState,
    log: [`Earthbended ${targetIds.length} land(s) with ${amountValue} +1/+1 counter(s)`],
  };
}

export function applyAnimatePermanentStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'animate_permanent' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedTargetText = normalizeAnimatePermanentTargetText(
    String((step.target as any)?.text || inferGrantTemporaryAbilityTargetFromRaw(String(step.raw || '')) || '')
  );
  const normalizedTarget = { ...(step.target as any), text: normalizedTargetText };
  const targetText = normalizedTargetText.toLowerCase();

  if (
    /^enchanted forest$/i.test(targetText) ||
    /^enchanted mountain$/i.test(targetText) ||
    /^enchanted forest becomes/i.test(targetText) ||
    /^enchanted mountain becomes/i.test(targetText) ||
    /enchanted forest becomes/i.test(String(step.raw || '')) ||
    /enchanted mountain becomes/i.test(String(step.raw || ''))
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const aura = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    const hostId = String((aura as any)?.attachedTo || (aura as any)?.enchanting || '').trim();
    const host = hostId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === hostId)
      : undefined;
    if (host) {
      const targetIds = new Set([String((host as any)?.id || '').trim()].filter(Boolean));
      const nextBattlefield = battlefield.map((permanent: any) => {
        const permanentId = String((permanent as any)?.id || '').trim();
        if (!targetIds.has(permanentId)) return permanent;
        return appendPermanentTypes(permanent, Array.isArray(step.addTypes) && step.addTypes.length > 0 ? step.addTypes : ['Creature']);
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: ['Animated enchanted land into a creature'],
      };
    }
    return { applied: true, state, log: ['No enchanted land host for animation'] };
  }

  if (
    /^it$/i.test(targetText) ||
    /^this land$/i.test(targetText) ||
    /you may have it become a 0\/0 elemental creature until end of turn/i.test(String(step.raw || ''))
  ) {
    const sourceId = String(ctx.sourceId || ctx.targetPermanentId || '').trim();
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (source) {
      const targetIds = new Set([String((source as any)?.id || '').trim()].filter(Boolean));
      const nextBattlefield = battlefield.map((permanent: any) => {
        const permanentId = String((permanent as any)?.id || '').trim();
        if (!targetIds.has(permanentId)) return permanent;
        return appendPermanentTypes(permanent, Array.isArray(step.addTypes) && step.addTypes.length > 0 ? step.addTypes : ['Creature']);
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: ['Animated source permanent into an Elemental creature'],
      };
    }
    return { applied: true, state, log: ['No source land for optional animation'] };
  }

  const selector = parseSimpleBattlefieldSelector(normalizedTarget as any);
  const boundMatches = selector ? resolveBoundSelectorMatches(battlefield, selector, ctx) : [];
  const explicitTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
  const isMassTarget = /^(?:each|all)\b/i.test(normalizedTargetText);
  const subtypeMassTargets = resolveSubtypeOrCompoundBattlefieldPermanents(
    battlefield,
    normalizedTarget as any,
    ctx
  );
  const selectorMassTargets = selector
    ? battlefield.filter((perm: any) => permanentMatchesSelector(perm, selector, ctx))
    : [];
  const targets =
    subtypeMassTargets && subtypeMassTargets.length > 0
      ? subtypeMassTargets
      : boundMatches.length > 0
      ? boundMatches.slice(0, 1)
      : explicitTargetId && (
        /^(?:target|that|the)\b/.test(targetText) ||
        /\bany number of target\b/.test(targetText)
      )
      ? battlefield.filter((perm: any) => String((perm as any)?.id || '').trim() === explicitTargetId)
      : isMassTarget && selectorMassTargets.length > 0
        ? selectorMassTargets
        : selector
          ? selectorMassTargets.slice(0, 1)
          : resolveDirectBattlefieldPermanents(battlefield, normalizedTarget as any, ctx);
  const targetIds = new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean));

  if (targetIds.size === 0) {
    return {
      applied: false,
      message: `Skipped permanent animation (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.size > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped permanent animation (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const normalizedAbilities = Array.isArray(step.abilities)
    ? step.abilities.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const controllerId = (String(ctx.controllerId || '').trim() || String((targets[0] as any)?.controller || '').trim()) as PlayerID;
  const expiresOnControllerTurn = step.duration === 'until_next_turn' ? controllerId : undefined;

  const nextBattlefield = battlefield.map((permanent: any) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!targetIds.has(permanentId)) return permanent;

    let animated: any = Array.isArray(step.addTypes) && step.addTypes.length > 0
      ? appendPermanentTypes(permanent, step.addTypes)
      : { ...(permanent as any) };
    const grantedAbilities = Array.isArray(animated.grantedAbilities) ? [...animated.grantedAbilities] : [];
    for (const ability of normalizedAbilities) {
      if (!grantedAbilities.some((entry: unknown) => String(entry || '').trim().toLowerCase() === ability)) {
        grantedAbilities.push(ability);
      }
    }

    const temporaryEffects = Array.isArray(animated.temporaryEffects) ? [...animated.temporaryEffects] : [];
    if (step.duration !== 'static') {
      temporaryEffects.push({
        id: `${permanentId}:animate:${temporaryEffects.length + 1}`,
        description: step.raw,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(expiresOnControllerTurn ? { expiresOnControllerTurn } : {}),
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceName: String(ctx.sourceName || '').trim() || undefined,
        ...(normalizedAbilities.length > 0 ? { grantedAbilities: normalizedAbilities } : {}),
      } as any);
    }

    animated = {
      ...animated,
      ...(typeof step.power === 'number' ? { power: step.power, basePower: step.power, effectivePower: undefined } : {}),
      ...(typeof step.toughness === 'number' ? { toughness: step.toughness, baseToughness: step.toughness, effectiveToughness: undefined } : {}),
      ...(grantedAbilities.length > 0 ? { grantedAbilities } : {}),
      ...(temporaryEffects.length > 0 ? { temporaryEffects } : {}),
    };

    return animated as BattlefieldPermanent;
  });

  const processedBattlefield = getProcessedBattlefield({ ...(state as any), battlefield: nextBattlefield } as GameState);

  return {
    applied: true,
    state: { ...(state as any), battlefield: processedBattlefield } as GameState,
    log: [`Animated ${targetIds.size} permanent(s)`],
  };
}
