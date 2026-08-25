/**
 * socket/resolution-handlers/targetSelectionSacrificeAbilityCostHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the `sacrificeAbilityAsCost` branch - a TARGET_SELECTION step used to pick the
 * permanents sacrificed to pay a battlefield ability's activation cost. Validates the remaining
 * cost text, mana and life, performs the sacrifices, then either prompts for the ability's effect
 * targets, resolves it as a mana ability (no stack, CR 605), or puts the ability on the stack.
 * Public entry symbols: handleSacrificeAbilityAsCostTargetSelection.
 *
 * The branch always returned, so the caller does `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import { isActivatedManaAbilityText } from "../../state/modules/ability-cost-adjustments.js";
import { getExtraManaProduction, getManaMultiplier } from "../../state/modules/mana-abilities.js";
import { syncDerivedContinuousEffects } from "../../state/modules/staticEffectSpec.js";
import {
  serializeAbilityActivatedTriggeredStackItem,
  triggerAbilityActivatedTriggers,
} from "../../state/modules/triggers/ability-activated.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { parseTargetRequirements } from "../../rules-engine/targeting";
import { debugWarn } from "../../utils/debug.js";
import { resolveManaAbilityActivationShape } from "../interaction.js";
import {
  battlefieldAbilityStackReplayEvidence,
  buildActivatedAbilityValidTargets,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { finalizeBattlefieldAbilitySelfExertCost } from "../resolutionGraveyardSelectionHelperUtils.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  emitToPlayer,
  getEffectivePower,
  getEffectiveToughness,
  getPlayerName,
} from "../util.js";

/** TARGET_SELECTION with `sacrificeAbilityAsCost`: pay the sacrifice cost and continue the ability. */
export async function handleSacrificeAbilityAsCostTargetSelection(
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
  const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
  const abilityId = String(stepAny?.abilityId || '').trim();
  const cardName = String(stepAny?.cardName || step.sourceName || 'Ability');
  const abilityText = String(stepAny?.abilityText || step.description || '');
  const manaCost = String(stepAny?.manaCost || '');
  const requiresTap = Boolean(stepAny?.requiresTap);
  const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);
  const prePaidLifeForCost = Number(stepAny?.prePaidLifeForCost || 0);
  const sacrificeType = String(stepAny?.sacrificeType || '').trim();
  const sacrificeSubtype = stepAny?.sacrificeSubtype ? String(stepAny?.sacrificeSubtype) : undefined;
  const sacrificeCount = Number(stepAny?.sacrificeCount || selections.length || 1);
  const mustBeOther = Boolean(stepAny?.mustBeOther);
  const prePaidTappedPermanentsForCost = Array.isArray(stepAny?.prePaidTappedPermanentsForCost)
    ? (stepAny.prePaidTappedPermanentsForCost as any[]).map((entry: any) => String(entry)).filter(Boolean)
    : [];

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const sourcePerm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
  if (!sourcePerm) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'PERMANENT_NOT_FOUND',
      message: 'Permanent no longer on battlefield',
    });
    return;
  }
  if (String(sourcePerm.controller || '') !== controllerId) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'NOT_CONTROLLER',
      message: 'You no longer control that permanent',
    });
    return;
  }
  if (requiresTap && (sourcePerm as any).tapped) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'ALREADY_TAPPED',
      message: `${cardName} is already tapped`,
    });
    return;
  }

  // Conservative: only support costs that are (mana symbols and/or {T}/{Q}) plus a sacrifice clause.
  // If other text remains (pay life, discard, tap other permanents, etc.), refuse to proceed.
  // Note: for combined discard+sacrifice flows, the discard step already paid the discard portion.
  const discardClauseRegex =
    /\bdiscard\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\b/gi;

  let remainingNonManaCostText = manaCost
    .replace(/\{[^}]+\}/g, ' ')
    .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
    .replace(/\bsacrifice\b[^,]*/gi, ' ');

  if ((stepAny as any)?.discardAndSacrificeAbilityAsCost === true) {
    remainingNonManaCostText = remainingNonManaCostText.replace(discardClauseRegex, ' ');
  }

  remainingNonManaCostText = remainingNonManaCostText.replace(/[\s,]+/g, ' ').trim();
  if (remainingNonManaCostText.length > 0) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'UNSUPPORTED_COST',
      message: `Unsupported activation cost (${remainingNonManaCostText}).`,
    });
    return;
  }

  // Validate mana + life before performing irreversible zone changes.
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

  let consumeMana: (() => Promise<void>) | undefined;
  if (manaOnly) {
    const { validateAbilityManaCostFromPool, payAbilityManaCostFromPool } = await import('../util.js');
    const validated = validateAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm);
    if (validated.ok === false) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INSUFFICIENT_MANA',
        message: validated.error || 'Insufficient mana.',
      });
      return;
    }

    consumeMana = async () => {
      payAbilityManaCostFromPool(game.state, controllerId, manaOnly, sourcePerm, '[sacrificeAbilityAsCost]');
    };
  }

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

  // Validate sacrifices still legal and snapshot power before zone change
  // (Altar of Dementia: mill equal to sacrificed creature's power).
  const sacrificedNames: string[] = [];
  const sacrificedIds: string[] = [];
  const sacrificedPermanentSnapshots: any[] = [];

  const matchesSacrificeRequirement = (perm: any): boolean => {
    if (!perm) return false;
    if (String(perm.controller || '') !== controllerId) return false;
    if (mustBeOther && String(perm.id) === String(permanentId)) return false;
    const tl = String(perm.card?.type_line || '').toLowerCase();

    let okType = false;
    switch (sacrificeType) {
      case 'creature':
        okType = tl.includes('creature');
        break;
      case 'artifact':
        okType = tl.includes('artifact');
        break;
      case 'enchantment':
        okType = tl.includes('enchantment');
        break;
      case 'land':
        okType = tl.includes('land');
        break;
      case 'artifact_or_creature':
        okType = tl.includes('artifact') || tl.includes('creature');
        break;
      case 'permanent':
        okType = true;
        break;
      default:
        // Unknown type: be conservative.
        okType = false;
    }
    if (!okType) return false;
    if (sacrificeSubtype) {
      const sub = String(sacrificeSubtype).toLowerCase();
      return tl.includes(sub);
    }
    return true;
  };

  for (const chosenId of selections) {
    const chosenPerm = battlefield.find((p: any) => p && String(p.id) === String(chosenId));
    if (!chosenPerm || !matchesSacrificeRequirement(chosenPerm)) {
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'INVALID_SELECTION',
        message: 'One or more chosen permanents can no longer be sacrificed for this cost',
      });
      return;
    }
  }

  // Refresh continuous effects so sacrificed power includes lords (Morophon, etc.)
  try {
    delete (game.state as any)._derivedContinuousEffects;
    syncDerivedContinuousEffects(game.state);
  } catch {
    // best-effort
  }

  for (const chosenId of selections) {
    const chosenPerm = battlefield.find((p: any) => p && String(p.id) === String(chosenId));
    if (!chosenPerm) continue;
    // Pass game.state so lords/anthems (e.g. Morophon) are included — raw BF
    // permanents do not carry view.ts effectivePower.
    const power = getEffectivePower(chosenPerm, game.state);
    const toughness = getEffectiveToughness(chosenPerm, game.state);
    sacrificedPermanentSnapshots.push({
      id: String(chosenPerm.id || ''),
      name: String(chosenPerm?.card?.name || 'permanent'),
      controller: String(chosenPerm.controller || ''),
      owner: String(chosenPerm.owner || chosenPerm.ownerId || chosenPerm.controller || ''),
      typeLine: String(chosenPerm?.card?.type_line || '').toLowerCase(),
      power: Number.isFinite(power) ? power : null,
      effectivePower: Number.isFinite(power) ? power : undefined,
      toughness: Number.isFinite(toughness) ? toughness : null,
      manaValue: null,
      colors: Array.isArray(chosenPerm?.card?.colors) ? [...chosenPerm.card.colors] : [],
      card: chosenPerm.card ? { ...chosenPerm.card } : undefined,
    });
  }

  // Perform sacrifices.
  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as unknown as GameContext;

  const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
  for (const chosenId of selections) {
    const chosenPerm = battlefield.find((p: any) => p && String(p.id) === String(chosenId));
    const nm = String(chosenPerm?.card?.name || 'permanent');
    const ok = movePermanentToGraveyard(ctx, String(chosenId), true);
    if (ok) {
      sacrificedNames.push(nm);
      sacrificedIds.push(String(chosenId));
    }
  }

  if (sacrificedIds.length < sacrificeCount) {
    emitToPlayer(io, controllerId as any, 'error', {
      code: 'SACRIFICE_FAILED',
      message: 'Failed to sacrifice the required permanents',
    });
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
    tappedPermanentsForCost.push(String(permanentId));
  }
  const allTappedPermanentsForCost = [...prePaidTappedPermanentsForCost, ...tappedPermanentsForCost];

  const activatedAbilityText = String(stepAny?.activatedAbilityText || '').trim()
    || (manaCost ? `${manaCost}: ${abilityText}` : abilityText);

  // Mirror tap/discard cost paths: after paying the sacrifice cost, prompt for
  // effect targets (e.g. Altar of Dementia → target player to mill).
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
      emitToPlayer(io, controllerId as any, 'error', {
        code: 'NO_VALID_TARGETS',
        message: `${cardName}'s ability requires at least ${minTargets} target(s), but only ${validTargets.length} are available.`,
      });
      return;
    }

    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
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
      activatedAbilityText,
      tappedPermanentsForCost: allTappedPermanentsForCost,
      sacrificedPermanentsForCost: sacrificedIds,
      lastSacrificedPermanents: sacrificedPermanentSnapshots,
      discardedCardIdsForCost: Array.isArray((stepAny as any)?.discardedCardIdsForCost)
        ? ((stepAny as any).discardedCardIdsForCost as any[]).map((x: any) => String(x)).filter(Boolean)
        : undefined,
      exiledCardIdsFromHandForCost: Array.isArray((stepAny as any)?.exiledCardIdsFromHandForCost)
        ? ((stepAny as any).exiledCardIdsFromHandForCost as any[]).map((x: any) => String(x)).filter(Boolean)
        : undefined,
      lifePaidForCost: Number.isFinite(lifeToPayForCost + prePaidLifeForCost) && (lifeToPayForCost + prePaidLifeForCost) > 0
        ? (lifeToPayForCost + prePaidLifeForCost)
        : undefined,
    } as any);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: controllerId,
        resolvedStepId: String((step as any).id || ''),
        permanentId,
        abilityId: abilityId || undefined,
        cardName,
        abilityText,
        activatedAbilityText,
        tappedPermanents: allTappedPermanentsForCost,
        sacrificedPermanents: sacrificedIds,
        lastSacrificedPermanents: sacrificedPermanentSnapshots,
        lifePaidForCost: Number.isFinite(lifeToPayForCost + prePaidLifeForCost) && (lifeToPayForCost + prePaidLifeForCost) > 0
          ? (lifeToPayForCost + prePaidLifeForCost)
          : undefined,
        queuedResolutionStep,
      });
    } catch {
      // ignore persistence failures
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName} (sacrificed ${sacrificedNames.join(', ') || 'permanents'}) — choose target(s)`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const persistSacrificeActivationEvent = (extras: Record<string, unknown> = {}) => {
    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: controllerId,
        permanentId,
        abilityId: abilityId || undefined,
        cardName,
        abilityText,
        activatedAbilityText: activatedAbilityText || undefined,
        tappedPermanents: allTappedPermanentsForCost,
        sacrificedPermanents: sacrificedIds,
        lastSacrificedPermanents: sacrificedPermanentSnapshots,
        discardedCardIds: Array.isArray((stepAny as any)?.discardedCardIdsForCost)
          ? ((stepAny as any).discardedCardIdsForCost as any[]).map((x: any) => String(x)).filter(Boolean)
          : undefined,
        exiledCardIdsFromHandForCost: Array.isArray((stepAny as any)?.exiledCardIdsFromHandForCost)
          ? ((stepAny as any).exiledCardIdsFromHandForCost as any[]).map((x: any) => String(x)).filter(Boolean)
          : undefined,
        lifePaidForCost: Number.isFinite(lifeToPayForCost + prePaidLifeForCost) && (lifeToPayForCost + prePaidLifeForCost) > 0
          ? (lifeToPayForCost + prePaidLifeForCost)
          : undefined,
        ...(stepAny?.manaFromTreasureSpentKnown === true && typeof stepAny?.manaFromTreasureSpent === 'boolean'
          ? {
              manaFromTreasureSpentKnown: true,
              manaFromTreasureSpent: stepAny.manaFromTreasureSpent,
            }
          : {}),
        ...extras,
      });
    } catch {
      // ignore persistence failures
    }
  };

  // Mana abilities never use the stack (CR 605). Sacrifice-as-cost used to always
  // push onto the stack, forcing a pass-priority drain for Ashnod's Altar et al.
  if (isActivatedManaAbilityText(activatedAbilityText || abilityText)) {
    finalizeBattlefieldAbilitySelfExertCost(
      game,
      gameId,
      controllerId,
      permanentId,
      stepAny?.requiresSelfExertForCost === true,
    );

    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[controllerId] = game.state.manaPool[controllerId] || {
      white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
    };

    const colorToPoolKey: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
      C: 'colorless',
    };

    const manaMultiplier = getManaMultiplier(game.state, sourcePerm, controllerId);
    const effectiveMultiplier = Number.isFinite(manaMultiplier) && manaMultiplier > 0 ? manaMultiplier : 1;
    const {
      produces,
      baseAmount,
      producesAllAtOnce,
    } = resolveManaAbilityActivationShape(
      game.state,
      sourcePerm,
      controllerId,
      abilityId,
      activatedAbilityText,
      abilityText,
      manaCost,
    );

    try {
      const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
        activatedBy: controllerId as any,
        sourcePermanentId: permanentId as any,
        isManaAbility: true,
        abilityText,
      });
      for (const triggeredAbility of triggeredAbilities) {
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', serializeAbilityActivatedTriggeredStackItem(triggeredAbility));
        } catch (err) {
          debugWarn(1, '[Resolution] appendEvent(pushTriggeredAbility mana sac-cost) failed:', err);
        }
      }
    } catch {}

    if (producesAllAtOnce && produces.length > 1) {
      const amountPerColor = produces.length > 0
        ? Math.max(1, Math.floor(baseAmount / produces.length))
        : 1;
      for (const manaColor of produces) {
        const poolKey = colorToPoolKey[manaColor] || 'colorless';
        (game.state.manaPool[controllerId] as any)[poolKey] += amountPerColor * effectiveMultiplier;
      }
      broadcastManaPoolUpdate(io, gameId, controllerId as any, game.state.manaPool[controllerId] as any, `Activated ${cardName}`, game);
    } else if (produces.length > 1) {
      const extraMana = getExtraManaProduction(game.state, sourcePerm, controllerId, produces[0]);
      const totalExtra = extraMana.reduce((acc, entry) => acc + Number(entry.amount || 0), 0);
      const finalTotal = (baseAmount * effectiveMultiplier) + totalExtra;
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MANA_COLOR_SELECTION,
        playerId: controllerId as any,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (sourcePerm as any)?.card?.image_uris?.small || (sourcePerm as any)?.card?.image_uris?.normal,
        description: `Choose a color for ${cardName}'s mana.`,
        mandatory: true,
        selectionKind: 'any_color',
        permanentId,
        abilityId,
        cardName,
        amount: finalTotal,
        tappedPermanentsForCost: allTappedPermanentsForCost,
        sacrificedPermanentsForCost: sacrificedIds,
      } as any);
      persistSacrificeActivationEvent({ usesStack: false });
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName} (sacrificed ${sacrificedNames.join(', ') || 'permanents'}) — choose a color`,
        ts: Date.now(),
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    } else if (produces.length === 1) {
      const manaColor = produces[0];
      const poolKey = colorToPoolKey[manaColor] || 'colorless';
      const extraMana = getExtraManaProduction(game.state, sourcePerm, controllerId, manaColor);
      for (const extra of extraMana) {
        const extraPoolKey = colorToPoolKey[extra.color] || poolKey;
        (game.state.manaPool[controllerId] as any)[extraPoolKey] += extra.amount;
      }
      (game.state.manaPool[controllerId] as any)[poolKey] += baseAmount * effectiveMultiplier;
      broadcastManaPoolUpdate(io, gameId, controllerId as any, game.state.manaPool[controllerId] as any, `Activated ${cardName}`, game);
    }

    try {
      const stateAny = game.state as any;
      stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
      stateAny.addedManaWithThisAbilityThisTurn[String(controllerId)] =
        stateAny.addedManaWithThisAbilityThisTurn[String(controllerId)] || {};
      const permKey = String(permanentId);
      const k = abilityId ? `${permKey}:${abilityId}` : permKey;
      (stateAny.addedManaWithThisAbilityThisTurn[String(controllerId)] as any)[k] = true;
    } catch {}

    persistSacrificeActivationEvent({ usesStack: false });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName}'s mana ability (sacrificed ${sacrificedNames.join(', ') || 'permanents'})`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();

    if (Array.isArray((stepAny as any)?.queuedMadnessStepsForCost) && (stepAny as any).queuedMadnessStepsForCost.length > 0) {
      try {
        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: controllerId,
          sourceId: permanentId,
          queuedResolutionSteps: (stepAny as any).queuedMadnessStepsForCost.map((queuedStep: any) => ({ ...(queuedStep as any) })),
        });
      } catch {
        // ignore persistence failures
      }
    }

    broadcastGame(io, game, gameId);
    return;
  }

  // Put the ability on the stack (no further targets required).
  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: controllerId,
    source: permanentId,
    sourceName: cardName,
    description: abilityText,
    activatedAbilityText: activatedAbilityText || undefined,
    sacrificedPermanents: sacrificedIds,
    lastSacrificedPermanents: sacrificedPermanentSnapshots,
  } as any;

  game.state.stack = game.state.stack || [];
  game.state.stack.push(stackItem);
  finalizeBattlefieldAbilitySelfExertCost(
    game,
    gameId,
    controllerId,
    permanentId,
    stepAny?.requiresSelfExertForCost === true,
  );
  fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
    persistSacrificeActivationEvent(battlefieldAbilityStackReplayEvidence(stackItem.id));
  });

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `⚡ ${getPlayerName(game, controllerId as any)} activated ${cardName}'s ability: ${abilityText} (sacrificed ${sacrificedNames.join(', ') || 'permanents'})`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') game.bumpSeq();

  if (Array.isArray((stepAny as any)?.queuedMadnessStepsForCost) && (stepAny as any).queuedMadnessStepsForCost.length > 0) {
    try {
      appendQueuedResolutionPromptEvent(game, gameId, {
        playerId: controllerId,
        sourceId: permanentId,
        queuedResolutionSteps: (stepAny as any).queuedMadnessStepsForCost.map((queuedStep: any) => ({ ...(queuedStep as any) })),
      });
    } catch {
      // ignore persistence failures
    }
  }

  broadcastGame(io, game, gameId);
}
