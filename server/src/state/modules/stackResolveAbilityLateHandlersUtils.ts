import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { StackActivatedAbilityLateHandlerOptions } from './stackResolveSharedTypes.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { canPermanentBeTargetedByPlayer, permanentsShareCardType, selectionRequiresSharedCardType } from '../../rules-engine/targeting.js';
import {
  parseActivationChosenTypeRevealTop,
  parseActivationChosenTypeTopLibraryReveal,
  parseChosenTypeDrawPerCreatureEffect,
} from './chosen-creature-type.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { ResolutionStepType } from '../resolution/index.js';
import { tryApplyOracleIRToActivatedAbility } from './oracleIrAbilityExecution.js';
import { extractOracleCardLookupKeys } from './oracleIrCompiledOverlayLookup.js';
import { markOnceDuringEachActivatedAbilityUsedThisTurn } from '../../../../rules-engine/src/stationPermanentUtils.js';
import { resolveChosenTypeDrawPerCreature } from './triggerChosenTypeSpellUtils.js';
import { queueChosenTypeTopLibraryRevealPrompt } from './oracleIrSpellLegacyLibrarySelectionUtils.js';
import { syncPreparedPermanentAfterControlChange } from './prepared.js';
import { attachEquipmentToCreature } from './triggerEquipmentUtils.js';

function resolveTextDrivenActivatedControlChange(
  state: any,
  controller: string,
  targets: any[],
  texts: string[],
  sourceName: string,
): boolean {
  const normalizedTexts = texts
    .map((text) => String(text || '').toLowerCase().trim())
    .filter(Boolean);
  if (normalizedTexts.length === 0) {
    return false;
  }

  const recordTemporaryControlChange = (permanentId: string, originalController: string, newController: string) => {
    const stateAny = state as any;
    stateAny.controlChangeEffects = Array.isArray(stateAny.controlChangeEffects) ? stateAny.controlChangeEffects : [];
    stateAny.controlChangeEffects.push({
      permanentId,
      originalController,
      newController,
      duration: 'eot',
      appliedAt: Date.now(),
    });
  };

  const applyControllerChange = (permanent: any, newController: string, options?: { temporary?: boolean }) => {
    const originalController = String(permanent?.controller || '').trim();
    if (!newController || !originalController || originalController === newController) {
      return false;
    }

    permanent.controller = newController;
    syncPreparedPermanentAfterControlChange(state, permanent, originalController);

    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) {
      (permanent as any).summoningSickness = true;
    }

    if (options?.temporary) {
      recordTemporaryControlChange(String(permanent.id || ''), originalController, newController);
    }

    return true;
  };

  const grantTemporaryHaste = (permanent: any) => {
    (permanent as any).grantedAbilities = Array.isArray((permanent as any).grantedAbilities)
      ? (permanent as any).grantedAbilities
      : [];
    if (!(permanent as any).grantedAbilities.some((ability: any) => String(ability || '').toLowerCase() === 'haste')) {
      (permanent as any).grantedAbilities.push('Haste');
    }

    if (!(permanent as any).untilEndOfTurn || typeof (permanent as any).untilEndOfTurn !== 'object') {
      (permanent as any).untilEndOfTurn = {};
    }
    (permanent as any).untilEndOfTurn.grantedAbilitiesToRemove = Array.isArray((permanent as any).untilEndOfTurn.grantedAbilitiesToRemove)
      ? (permanent as any).untilEndOfTurn.grantedAbilitiesToRemove
      : [];
    if (!(permanent as any).untilEndOfTurn.grantedAbilitiesToRemove.includes('Haste')) {
      (permanent as any).untilEndOfTurn.grantedAbilitiesToRemove.push('Haste');
    }
  };

  const hasExchangeCreaturesEffect = normalizedTexts.some((text) =>
    text.includes('exchange control of all creatures') ||
    text.includes('each gain control of all creatures the other controls until end of turn')
  );
  const hasDonateTargetPermanentEffect = normalizedTexts.some((text) =>
    /target (?:opponent|player) gains control of target [^.]+/i.test(text)
  );
  const hasExchangeTargetPermanentsEffect = normalizedTexts.some((text) =>
    /exchange control of two target permanents/i.test(text) ||
    /exchange control of target [^.]+ and target [^.]+/i.test(text)
  );
  const exchangeTargetsMustShareCardType = hasExchangeTargetPermanentsEffect
    && normalizedTexts.some((text) => selectionRequiresSharedCardType(text));
  const hasTemporaryGainControlEffect = normalizedTexts.some((text) =>
    text.includes('gain control of target creature') && text.includes('until end of turn')
  );
  const hasPermanentGainControlEffect = !hasTemporaryGainControlEffect && normalizedTexts.some((text) =>
    text.includes('gain control of target creature')
  );

  let applied = false;

  if (hasExchangeCreaturesEffect && targets.length > 0) {
    const targetOpponentId = String(typeof targets[0] === 'string' ? targets[0] : targets[0]?.id || '').trim();
    const players = Array.isArray((state as any).players) ? (state as any).players : [];
    const isTargetOpponent = players.some((player: any) => player && String(player.id || '') === targetOpponentId)
      && targetOpponentId !== String(controller || '');

    if (isTargetOpponent) {
      const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
      const exchangeCandidates = battlefield.filter((permanent: any) => {
        if (!permanent) return false;
        const typeLine = String(permanent.card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) return false;
        const currentController = String(permanent.controller || '').trim();
        return currentController === controller || currentController === targetOpponentId;
      });

      const controllerCreatures = exchangeCandidates.filter((permanent: any) => String(permanent.controller || '').trim() === controller);
      const opponentCreatures = exchangeCandidates.filter((permanent: any) => String(permanent.controller || '').trim() === targetOpponentId);

      for (const permanent of exchangeCandidates) {
        permanent.tapped = false;
      }

      for (const permanent of controllerCreatures) {
        const originalController = String(permanent.controller || '').trim();
        permanent.controller = targetOpponentId;
        syncPreparedPermanentAfterControlChange(state, permanent, originalController);
        (permanent as any).summoningSickness = true;
        recordTemporaryControlChange(String(permanent.id || ''), originalController, targetOpponentId);
        grantTemporaryHaste(permanent);
        applied = true;
      }

      for (const permanent of opponentCreatures) {
        const originalController = String(permanent.controller || '').trim();
        permanent.controller = controller;
        syncPreparedPermanentAfterControlChange(state, permanent, originalController);
        (permanent as any).summoningSickness = true;
        recordTemporaryControlChange(String(permanent.id || ''), originalController, controller);
        grantTemporaryHaste(permanent);
        applied = true;
      }

      if (applied) {
        debug(2, `[resolveTextDrivenActivatedControlChange] ${sourceName}: exchanged control of ${exchangeCandidates.length} creature(s) between ${controller} and ${targetOpponentId}`);
      }
    }
  }

  if (hasDonateTargetPermanentEffect && targets.length > 1) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const players = Array.isArray((state as any).players) ? (state as any).players : [];
    const targetPlayerId = targets
      .map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      .find((targetId: string) => players.some((player: any) => player && String(player.id || '') === targetId));
    const targetPermanentId = targets
      .map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      .find((targetId: string) => battlefield.some((permanent: any) => permanent && String(permanent.id || '') === targetId));

    if (targetPlayerId && targetPermanentId) {
      const targetPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === targetPermanentId);
      if (targetPermanent && applyControllerChange(targetPermanent, targetPlayerId, { temporary: false })) {
        applied = true;
        debug(2, `[resolveTextDrivenActivatedControlChange] ${sourceName}: ${targetPermanent.card?.name || targetPermanent.id} donated to ${targetPlayerId}`);
      }
    }
  }

  if (hasExchangeTargetPermanentsEffect && targets.length > 1) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    const targetPermanentIds = targets
      .map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      .filter((targetId: string) => battlefield.some((permanent: any) => permanent && String(permanent.id || '') === targetId));

    if (targetPermanentIds.length >= 2) {
      const firstPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === targetPermanentIds[0]);
      const secondPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === targetPermanentIds[1]);

      if (firstPermanent && secondPermanent) {
        if (exchangeTargetsMustShareCardType && !permanentsShareCardType([firstPermanent, secondPermanent])) {
          debug(2, `[resolveTextDrivenActivatedControlChange] ${sourceName}: skipped exchange because the selected permanents do not share a card type`);
        } else {
          const firstController = String(firstPermanent.controller || '').trim();
          const secondController = String(secondPermanent.controller || '').trim();

          if (firstController && secondController && firstController !== secondController) {
            applyControllerChange(firstPermanent, secondController, { temporary: false });
            applyControllerChange(secondPermanent, firstController, { temporary: false });
            applied = true;
            debug(2, `[resolveTextDrivenActivatedControlChange] ${sourceName}: exchanged control of ${firstPermanent.card?.name || firstPermanent.id} and ${secondPermanent.card?.name || secondPermanent.id}`);
          }
        }
      }
    }
  }

  if ((hasTemporaryGainControlEffect || hasPermanentGainControlEffect) && targets.length > 0) {
    const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
    const targetPermanent = (state.battlefield || []).find((perm: any) => perm && String(perm.id || '') === String(targetId || ''));

    if (targetPermanent) {
      const typeLine = String(targetPermanent.card?.type_line || '').toLowerCase();
      if (typeLine.includes('creature')) {
        const shouldUntap = normalizedTexts.some((text) => text.includes('untap'));
        const shouldGrantHaste = normalizedTexts.some((text) => text.includes('gains haste') || text.includes('gain haste'));

        const changed = applyControllerChange(targetPermanent, controller, { temporary: hasTemporaryGainControlEffect });
        if (shouldUntap) {
          targetPermanent.tapped = false;
        }
        if (hasTemporaryGainControlEffect && shouldGrantHaste) {
          grantTemporaryHaste(targetPermanent);
        }
        if (changed) {
          applied = true;
          debug(2, `[resolveTextDrivenActivatedControlChange] ${sourceName}: ${targetPermanent.card?.name || targetPermanent.id} now controlled by ${controller}`);
        }
      }
    }
  }

  return applied;
}

export type { StackActivatedAbilityLateHandlerDeps, StackActivatedAbilityLateHandlerOptions } from './stackResolveSharedTypes.js';

function markResolvedOncePerTurnActivatedAbility(state: any, item: any): void {
  if (!item?.oncePerTurnActivated) {
    return;
  }
  const permanentId = String(item?.source || '').trim();
  if (!permanentId) {
    return;
  }
  const permanent = (state?.battlefield || []).find((entry: any) => String(entry?.id || '') === permanentId);
  if (!permanent) {
    return;
  }
  const abilityIndex = Number(item?.activatedAbilityIndex);
  markOnceDuringEachActivatedAbilityUsedThisTurn(
    permanent,
    Number.isFinite(abilityIndex) ? abilityIndex : 0,
  );
}

export function tryResolveStackActivatedAbilityLateHandlers(
  ctx: GameContext,
  options: StackActivatedAbilityLateHandlerOptions,
): boolean {
  const { item, controller, targets, executeTriggerEffect } = options;
  if (item?.type !== 'ability') return false;

  const state = (ctx as any).state;
  const { bumpSeq } = ctx;
  const sourceName = item?.sourceName || 'Unknown';
  const description = item?.description || '';
  const descriptionWithoutTimingRestriction = String(description || '')
    .trim()
    .replace(/\s+activate(?:\s+this ability)?\s+only\s+(?:as a sorcery|any time you could cast a sorcery)\.?$/i, '')
    .trim();
  const battlefield = state.battlefield || [];
  const sourcePermanentId = String(item?.source || '').trim();
  const sourcePermanent = sourcePermanentId
    ? battlefield.find((permanent: any) => permanent?.id === sourcePermanentId)
    : null;
  const isEquipmentAttachAbility =
    Boolean(sourcePermanent) &&
    /\bequipment\b/i.test(String(sourcePermanent?.card?.type_line || '')) &&
    /^attach(?:\s+(?:this equipment|[\w ,.'\-]+))?\s+to\s+target creature(?:\s+you control|\s+an opponent controls)?\.?$/i.test(descriptionWithoutTimingRestriction);

  if (isEquipmentAttachAbility) {
    const targetCreatureId = String(item?.targets?.[0] || '').trim();
    if (!targetCreatureId) {
      debugWarn(2, `[tryResolveStackActivatedAbilityLateHandlers] Activated attachment ability from ${sourceName} is missing a target creature`);
      bumpSeq();
      return true;
    }

    attachEquipmentToCreature(ctx, state, controller, {
      equipmentId: sourcePermanentId,
      targetCreatureId,
      sourceName,
      equipmentName: sourceName || String(sourcePermanent?.card?.name || 'Equipment'),
    });
    markResolvedOncePerTurnActivatedAbility(state, item);
    bumpSeq();
    return true;
  }

  const activatedAbilityText = String(item?.activatedAbilityText || '').trim();
  const abilityTextForTypeChoice = [activatedAbilityText, description].filter(Boolean).join(' ').trim();
  const needsActivationCreatureTypeChoice = parseActivationChosenTypeRevealTop(abilityTextForTypeChoice)
    || parseChosenTypeDrawPerCreatureEffect(abilityTextForTypeChoice);
  const existingAbilityChosenType = String(item?.chosenCreatureType || '').trim();
  const isReplayingAbility = !!(ctx as any).isReplaying;

  if (needsActivationCreatureTypeChoice && !existingAbilityChosenType && !isReplayingAbility) {
    debug(2, `[tryResolveStackActivatedAbilityLateHandlers] ${sourceName} activated ability requires creature type choice`);

    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: controller as PlayerID,
      description: `Choose a creature type for ${sourceName}'s ability`,
      mandatory: true,
      sourceId: String(item?.source || item?.id || ''),
      sourceName,
      spellId: String(item?.id || ''),
      cardName: sourceName,
      ...(parseChosenTypeDrawPerCreatureEffect(abilityTextForTypeChoice)
        ? { pendingChosenTypeEffect: 'draw_per_creature' }
        : {}),
    } as any);

    state.stack = state.stack || [];
    state.stack.push(item as any);
    bumpSeq();
    return true;
  }

  const activationTopReveal = parseActivationChosenTypeTopLibraryReveal(abilityTextForTypeChoice);
  if (activationTopReveal) {
    const revealSourcePermanentId = String(item?.source || '');
    const revealSourcePermanent = (state.battlefield || []).find((perm: any) => perm && String(perm.id) === revealSourcePermanentId);
    const chosenType = String(revealSourcePermanent?.chosenCreatureType || existingAbilityChosenType || '').trim();
    if (chosenType) {
      const queuedCount = queueChosenTypeTopLibraryRevealPrompt(ctx, controller as PlayerID, chosenType, {
        sourceId: String(item?.id || revealSourcePermanentId || ''),
        sourceName,
        description: `${sourceName}: Look at the top ${activationTopReveal.lookCount} cards of your library. You may reveal ${chosenType} creature cards from among them and put them into your hand. Put the rest on the bottom in a random order.`,
        lookCount: activationTopReveal.lookCount,
      });
      debug(2, `[tryResolveStackActivatedAbilityLateHandlers] ${sourceName} queued chosen-type top-library reveal (${queuedCount} card(s))`);
      markResolvedOncePerTurnActivatedAbility(state, item);
      bumpSeq();
      return true;
    }
  }

  if (existingAbilityChosenType && parseChosenTypeDrawPerCreatureEffect(abilityTextForTypeChoice)) {
    resolveChosenTypeDrawPerCreature(ctx, controller as PlayerID, existingAbilityChosenType, sourceName);
    markResolvedOncePerTurnActivatedAbility(state, item);
    bumpSeq();
    return true;
  }

  resolveTextDrivenActivatedControlChange(
    state,
    String(controller || ''),
    targets,
    [activatedAbilityText, description],
    String(sourceName || 'Activated ability'),
  );

  const activatedOracleForIR = (() => {
    const scoped = String(activatedAbilityText || '').trim();
    if (scoped.includes(':')) return scoped;
    return [activatedAbilityText, description].filter(Boolean).join('\n').trim();
  })();
  if (activatedOracleForIR) {
    const cardKeys = extractOracleCardLookupKeys({
      cardName: sourceName,
      sourceName,
      sourceItem: item,
      card: sourcePermanent?.card || item?.card,
      effectiveCard: sourcePermanent?.card || item?.card,
    });
    const selectedModeIds = Array.isArray(item?.selectedModeIds)
      ? item.selectedModeIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : Array.isArray(item?.chosenModes)
        ? item.chosenModes.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : undefined;
    const irResult = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: controller as PlayerID,
      sourceName,
      oracleText: activatedOracleForIR,
      sourcePermanentId: String(item?.source || ''),
      stackItemId: String(item?.id || ''),
      targets: Array.isArray(item?.targets) ? item.targets : undefined,
      teamworkWasPaid: Boolean(item?.teamworkWasPaid ?? item?.card?.teamworkWasPaid),
      giftPromised: Boolean(item?.giftPromised ?? item?.card?.giftPromised),
      allowOptional: true,
      cardId: cardKeys.cardId,
      sourceItem: item,
      card: sourcePermanent?.card || item?.card,
      ...(selectedModeIds && selectedModeIds.length > 0 ? { selectedModeIds } : {}),
    });
    if (irResult.handled) {
      debug(2, `[tryResolveStackActivatedAbilityLateHandlers] Oracle IR resolved activated ability from ${sourceName} (${irResult.applied} step(s))`);
      markResolvedOncePerTurnActivatedAbility(state, item);
      bumpSeq();
      return true;
    }
  }

  debug(2, `[tryResolveStackActivatedAbilityLateHandlers] Executing activated ability from ${sourceName} for ${controller}: ${description}`);
  executeTriggerEffect(ctx, controller, sourceName, description, item);
  markResolvedOncePerTurnActivatedAbility(state, item);
  bumpSeq();
  return true;
}
