// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedThatPile && (step.to === 'hand' || step.to === 'graveyard')) {
// Public entry symbol: tryApplyMoveZoneGuardsFromThatPile.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { PlayerID } from '../../shared/src';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { hasExecutorClass, getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { bounceMatchingBattlefieldPermanentsToOwnersHands, moveBattlefieldPermanentsByIdToOwnersHands, permanentMatchesSelector } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  exileUpToMatchingFromGraveyard,
  cardMatchesMoveZoneSingleTargetCriteria,
  selectBattlefieldPermanentsWithTotalManaValueLte,
} from './oracleIRExecutorZoneOps';
import { findBoundCardZoneLocation, getChosenObjectIds, resolveUniqueChosenAnyGraveyardTargetId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { moveContextualCardToDestination, resolveContextualCardIdsInZones, resolveOneOfThemCandidateCardIds } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromThatPile(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution, boundTargetObjectId } = args;
  const {
    parsedThatPile,
    parsedAllCreaturesOfThatColor,
    parsedTargetCreatureMilledThisTurn,
    parsedCountTargetBattlefieldBounce,
    parsedUpToThatManyInstantOrSorcery,
    parsedAnyNumberTargetNonlandTotalMv,
    parsedMassBattlefieldCreatureBounce,
    parsedAllColoredPermanentsToHand,
    parsedAllNoncreatureNonlandPermanentsToHand,
    parsedUnlessPaysManaFromStep,
  } = args.zoneQueries;
  const {
    parsedOneOfThemBfTappedOtherHand,
    parsedOneOfThemToGraveyard,
    parsedOneOfThemToBattlefield,
    parsedCountOfThemAtRandom,
    parsedOneOfThemToHand,
    parsedThisCreatureAndTargetYouControl,
    parsedThisCreatureAndAnotherTargetCreature,
    parsedThisPermanentAndAnotherTargetCreature,
  } = args.referenceQueries;

  if (parsedThatPile && (step.to === 'hand' || step.to === 'graveyard' || step.to === 'library')) {
    const destination = step.to;
    const candidateIds = resolveContextualCardIdsInZones(nextState, ctx, runtime, ['exile', 'hand', 'graveyard']);
    let workingState = nextState;
    const combinedLog: string[] = [];
    for (const cardId of candidateIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone === destination) continue;
      const result =
        location.zone === 'graveyard'
          ? destination === 'hand'
            ? moveTargetedCardFromGraveyard(workingState, location.playerId, cardId, { cardType: 'any' }, 'hand')
            : { kind: 'impossible' as const }
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                location.playerId,
                cardId,
                'any',
                destination === 'hand' ? 'hand' : destination === 'library' ? 'library_top' : 'graveyard'
              )
            : { kind: 'impossible' as const };
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
    return buildAppliedResult({
      state: workingState,
      log:
        combinedLog.length > 0
          ? combinedLog
          : [
              destination === 'hand'
                ? `Moved that pile to hand: ${step.raw}`
                : destination === 'library'
                  ? `Moved that pile to library: ${step.raw}`
                  : `Moved that pile to graveyard: ${step.raw}`,
            ],
    });
  }

  if (parsedAllCreaturesOfThatColor && step.to === 'hand') {
    const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim();
    const colorSymbol =
      chosenMana.includes('{R}')
        ? 'R'
        : chosenMana.includes('{U}')
          ? 'U'
          : chosenMana.includes('{B}')
            ? 'B'
            : chosenMana.includes('{G}')
              ? 'G'
              : chosenMana.includes('{W}')
                ? 'W'
                : 'U';
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: `all ${colorSymbol === 'R' ? 'red' : colorSymbol === 'U' ? 'blue' : colorSymbol === 'B' ? 'black' : colorSymbol === 'G' ? 'green' : 'white'} creatures`,
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = bounceMatchingBattlefieldPermanentsToOwnersHands(nextState, selector, ctx);
    return finalizeAppliedResult(result);
  }

  if (parsedTargetCreatureMilledThisTurn && step.to === 'battlefield') {
    const effectiveCriteria = parsedTargetCreatureMilledThisTurn;
    const targetObjectId =
      boundTargetObjectId ||
      resolveUniqueChosenAnyGraveyardTargetId(nextState, effectiveCriteria, ctx, runtime, ctx.sourceName);
    if (!targetObjectId) {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-turn graveyard target: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, targetObjectId);
    if (!location || location.zone !== 'graveyard') {
      return buildAppliedResult({ state: nextState, log: [`No milled-this-turn graveyard target: ${step.raw}`] });
    }
    const result = moveTargetedCardFromGraveyard(
      nextState,
      location.playerId,
      targetObjectId,
      effectiveCriteria,
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      ctx.sourceName,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (target card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedThisCreatureAndTargetYouControl && step.to === 'hand') {
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: parsedThisCreatureAndTargetYouControl.selectorText,
    } as any);
    if (!selector) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const sourceId = String(ctx.sourceId || '').trim();
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const matchIds = battlefield
      .filter(perm => permanentMatchesSelector(perm, selector, ctx))
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const preferred = getChosenObjectIds(ctx).filter(id => matchIds.includes(id) || id === sourceId);
    const bounceIds = Array.from(
      new Set([
        ...(sourceId ? [sourceId] : []),
        ...(preferred.length > 0 ? preferred.filter(id => id !== sourceId) : matchIds).slice(0, 1),
      ])
    ).filter(Boolean);
    if (bounceIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, bounceIds);
    return finalizeAppliedResult(result);
  }

  if (parsedThisCreatureAndAnotherTargetCreature && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    const preferred = getChosenObjectIds(ctx).filter(id => id === sourceId || id === targetId);
    const bounceIds = Array.from(
      new Set([
        ...(sourceId ? [sourceId] : []),
        ...(targetId ? [targetId] : preferred.filter(id => id !== sourceId).slice(0, 1)),
      ])
    ).filter(Boolean);
    if (bounceIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, bounceIds);
    return finalizeAppliedResult(result);
  }

  if (parsedThisPermanentAndAnotherTargetCreature && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetId = String(
      ctx.targetCreatureId || ctx.targetPermanentId || ctx.selectorContext?.targetCreatureId || ''
    ).trim();
    const preferred = getChosenObjectIds(ctx).filter(id => id === sourceId || id === targetId);
    const bounceIds = Array.from(
      new Set([
        ...(sourceId ? [sourceId] : []),
        ...(targetId ? [targetId] : preferred.filter(id => id !== sourceId).slice(0, 1)),
      ])
    ).filter(Boolean);
    if (bounceIds.length === 0) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, bounceIds);
    return finalizeAppliedResult(result);
  }

  if (parsedCountTargetBattlefieldBounce && step.to === 'hand') {
    if (parsedUnlessPaysManaFromStep) {
      const unlessChoice =
        ctx.unlessPaysManaChoice ??
        ctx.selectorContext?.unlessPaysManaChoice ??
        ctx.unlessPaysLifeChoice ??
        ctx.selectorContext?.unlessPaysLifeChoice;
      if (unlessChoice === 'pay') {
        return buildAppliedResult({
          state: nextState,
          log: [`Skipped bounce (controller paid ${parsedUnlessPaysManaFromStep.mana}): ${step.raw}`],
        });
      }
    }
    const bounceSelectorText = /\byou\s+control\b/i.test(parsedCountTargetBattlefieldBounce.selectorText)
      ? parsedCountTargetBattlefieldBounce.selectorText
      : /\btarget\b/i.test(parsedCountTargetBattlefieldBounce.selectorText)
        ? parsedCountTargetBattlefieldBounce.selectorText
        : `${parsedCountTargetBattlefieldBounce.selectorText} you control`;
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: bounceSelectorText,
    } as any);
    if (!selector) {
      if (/\btarget\b/i.test(bounceSelectorText) || /\bup to\b/i.test(String(step.raw || ''))) {
        return {
          applied: false,
          message: `Skipped move zone (requires choosing bounce targets): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const matches = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
    const preferred = getChosenObjectIds(ctx);
    let targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (preferred.length > 0) {
      targetIds = targetIds.filter(id => preferred.includes(id));
      if (targetIds.length === 0) {
        targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      }
    }
    const bounceCount = parsedCountTargetBattlefieldBounce.useXValue
      ? Math.max(0, Number(ctx.xValue) || 3)
      : parsedCountTargetBattlefieldBounce.count;
    const result = moveBattlefieldPermanentsByIdToOwnersHands(
      nextState,
      targetIds.slice(0, bounceCount)
    );
    return finalizeAppliedResult(result);
  }

  if (parsedOneOfThemToHand) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const cardId = preferred[0] || candidateIds[0] || '';
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them hand: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them hand: ${step.raw}`] });
    }
    const result =
      location.zone === 'hand'
        ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
        : moveContextualCardToDestination(nextState, location, cardId, 'hand', { controllerId });
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them hand: ${step.raw}`] });
    }
    return finalizeAppliedResult(result as any);
  }

  if (parsedOneOfThemToGraveyard) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const cardId = candidateIds[0];
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them graveyard: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them graveyard: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
        : location.zone === 'hand'
          ? moveTargetedCardFromHand(nextState, location.playerId, cardId, 'any', 'graveyard')
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'graveyard')
            : { kind: 'impossible' as const };
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them graveyard: ${step.raw}`] });
    }
    return finalizeAppliedResult(result as any);
  }

  if (parsedCountOfThemAtRandom && step.to === 'battlefield') {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const pool = preferred.length > 0 ? preferred : candidateIds;
    if (pool.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No contextual cards for random return: ${step.raw}`] });
    }
    const shuffled = [...pool];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    const pickCount = Math.min(parsedCountOfThemAtRandom.count, shuffled.length);
    const pickedIds = shuffled.slice(0, pickCount);
    let workingState = nextState;
    const combinedLog: string[] = [];
    const movedBattlefieldIds: string[] = [];
    const contextualCards: any[] = [];
    const bfController = step.battlefieldController?.kind === 'owner_of_moved_cards' ? controllerId : controllerId;
    for (const cardId of pool) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location) continue;
      const player = workingState.players.find(entry => entry.id === location.playerId) as any;
      const zoneCards = Array.isArray(player?.[location.zone]) ? player[location.zone] : [];
      const card = zoneCards.find((entry: any) => String(entry?.id || '').trim() === cardId);
      if (card) contextualCards.push(card);
    }
    for (const cardId of pickedIds) {
      const location = findBoundCardZoneLocation(workingState, cardId);
      if (!location || location.zone !== 'graveyard') continue;
      const result = moveTargetedCardFromGraveyard(
        workingState,
        location.playerId,
        cardId,
        { cardType: 'creature' },
        'battlefield',
        bfController,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        undefined,
        undefined,
        battlefieldEntryOverrides
      );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedBattlefieldIds.push(...(result.movedPermanentIds || []));
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned contextual cards at random: ${step.raw}`],
      movedCards: contextualCards,
      movedPermanentIds: movedBattlefieldIds,
    });
  }

  if (parsedOneOfThemToBattlefield) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    const cardId = candidateIds[0];
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them battlefield: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them battlefield: ${step.raw}`] });
    }
    const bfController = /\bunder an opponent'?s control\b/i.test(String(step.toRaw || step.raw || ''))
      ? (String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID)
      : step.battlefieldController?.kind === 'owner_of_moved_cards'
        ? location.playerId
        : controllerId;
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(
            nextState,
            location.playerId,
            cardId,
            { cardType: 'any' },
            'battlefield',
            bfController,
            step.entersTapped,
            step.entersFaceDown,
            effectiveWithCounters,
            attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
            undefined,
            battlefieldEntryOverrides
          )
        : location.zone === 'library'
          ? moveContextualCardToDestination(nextState, location, cardId, 'battlefield', {
              controllerId: bfController,
              ctx,
              cardType: 'any',
              entersTapped: step.entersTapped,
              entersFaceDown: step.entersFaceDown,
              withCounters: effectiveWithCounters,
              battlefieldEntryOverrides,
            })
        : location.zone === 'hand'
          ? moveTargetedCardFromHand(
              nextState,
              location.playerId,
              cardId,
              'any',
              'battlefield',
              bfController,
              step.entersTapped,
              step.entersFaceDown,
              effectiveWithCounters,
              attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
              battlefieldEntryOverrides
            )
          : location.zone === 'exile'
            ? moveTargetedCardFromExile(
                nextState,
                location.playerId,
                cardId,
                'any',
                'battlefield',
                bfController,
                step.entersTapped,
                step.entersFaceDown,
                effectiveWithCounters,
                attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
                battlefieldEntryOverrides
              )
            : { kind: 'impossible' as const };
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No contextual card for one-of-them battlefield: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOneOfThemBfTappedOtherHand) {
    const candidateIds = resolveOneOfThemCandidateCardIds(nextState, ctx, runtime);
    if (candidateIds.length < 2) {
      return buildAppliedResult({ state: nextState, log: [`Insufficient contextual cards: ${step.raw}`] });
    }
    let workingState = nextState;
    const combinedLog: string[] = [];
    const bfId = candidateIds[0];
    const handId = candidateIds[1];
    const bfLocation = findBoundCardZoneLocation(workingState, bfId);
    if (bfLocation) {
      const bfResult =
        bfLocation.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(
              workingState,
              bfLocation.playerId,
              bfId,
              { cardType: 'any' },
              'battlefield',
              controllerId,
              true,
              step.entersFaceDown,
              effectiveWithCounters,
              undefined,
              undefined,
              battlefieldEntryOverrides
            )
          : bfLocation.zone === 'exile'
            ? moveTargetedCardFromExile(
                workingState,
                bfLocation.playerId,
                bfId,
                'any',
                'battlefield',
                controllerId,
                true,
                step.entersFaceDown,
                effectiveWithCounters,
                undefined,
                battlefieldEntryOverrides
              )
            : { kind: 'impossible' as const };
      if (bfResult.kind === 'applied') {
        workingState = bfResult.state;
        combinedLog.push(...(bfResult.log || []));
      }
    }
    const handLocation = findBoundCardZoneLocation(workingState, handId);
    if (handLocation && handLocation.zone !== 'hand') {
      const handResult =
        handLocation.zone === 'graveyard'
          ? moveTargetedCardFromGraveyard(workingState, handLocation.playerId, handId, { cardType: 'any' }, 'hand')
          : handLocation.zone === 'exile'
            ? moveTargetedCardFromExile(workingState, handLocation.playerId, handId, 'any', 'hand')
            : { kind: 'impossible' as const };
      if (handResult.kind === 'applied') {
        workingState = handResult.state;
        combinedLog.push(...(handResult.log || []));
      }
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Split one-of-them battlefield/hand: ${step.raw}`],
    });
  }

  if (parsedUpToThatManyInstantOrSorcery && step.to === 'exile') {
    const dynamicMaxCount = Math.max(0, Number(ctx.referenceAmount ?? 2));
    const result = exileUpToMatchingFromGraveyard(
      nextState,
      controllerId,
      dynamicMaxCount,
      parsedUpToThatManyInstantOrSorcery.criteria,
      getChosenObjectIds(ctx)
    );
    if (result.kind === 'player_choice_required') {
      return {
        applied: false,
        message: `Skipped move zone (needs player card selection): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (result.kind === 'impossible') {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard cards: ${step.raw}`] });
    }
    return finalizeAppliedResult(result);
  }

  if (parsedAnyNumberTargetNonlandTotalMv && step.to === 'hand') {
    const boundPermanentIds = Array.from(
      new Set(
        [
          String(ctx.targetCreatureId || '').trim(),
          String(ctx.targetPermanentId || '').trim(),
          ...getChosenObjectIds(ctx),
        ].filter(Boolean)
      )
    );
    const targetIds = selectBattlefieldPermanentsWithTotalManaValueLte(
      nextState,
      boundPermanentIds,
      parsedAnyNumberTargetNonlandTotalMv.totalManaValueLte
    );
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedAllColoredPermanentsToHand && step.to === 'hand') {
    const targetIds = ((nextState.battlefield || []) as any[])
      .filter(perm =>
        cardMatchesMoveZoneSingleTargetCriteria(perm as any, parsedAllColoredPermanentsToHand)
      )
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedAllNoncreatureNonlandPermanentsToHand && step.to === 'hand') {
    const targetIds = ((nextState.battlefield || []) as any[])
      .filter(perm =>
        cardMatchesMoveZoneSingleTargetCriteria(perm as any, parsedAllNoncreatureNonlandPermanentsToHand)
      )
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedMassBattlefieldCreatureBounce && step.to === 'hand') {
    if (parsedMassBattlefieldCreatureBounce.chosenCreaturesOnly) {
      const chosenIds = new Set(getChosenObjectIds(ctx));
      if (chosenIds.size === 0) {
        return {
          applied: false,
          message: `Skipped move zone (requires player choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      const targetIds = ((nextState.battlefield || []) as any[])
        .filter((perm) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!chosenIds.has(permanentId)) return false;
          return hasExecutorClass(perm as any, 'creature');
        })
        .map((perm) => String((perm as any)?.id || '').trim())
        .filter(Boolean);
      const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
      return finalizeAppliedResult(result);
    }
    const chosenType = String(ctx.selectorContext?.chosenCreatureType || 'human').trim().toLowerCase();
    const colorLetterMap: Record<string, string> = {
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
    };
    const excludedColorLetter = parsedMassBattlefieldCreatureBounce.excludeCardColor
      ? colorLetterMap[String(parsedMassBattlefieldCreatureBounce.excludeCardColor || '').trim().toLowerCase()]
      : '';
    const targetIds = ((nextState.battlefield || []) as any[])
      .filter(perm => {
        if (!hasExecutorClass(perm as any, 'creature')) return false;
        if (parsedMassBattlefieldCreatureBounce.excludeChosenCreatureType) {
          return !getExecutorTypeLineLower(perm).includes(chosenType);
        }
        if (excludedColorLetter) {
          const colors = Array.isArray((perm as any)?.colors)
            ? (perm as any).colors
            : Array.isArray((perm as any)?.card?.colors)
              ? (perm as any).card.colors
              : [];
          return !colors
            .map((color: unknown) => String(color || '').trim().toUpperCase())
            .includes(excludedColorLetter);
        }
        if (parsedMassBattlefieldCreatureBounce.eachCreatureWithoutCounter) {
          const counterName = String(parsedMassBattlefieldCreatureBounce.eachCreatureWithoutCounter || '').trim();
          const counterCount = Number(
            (perm as any)?.counters?.[counterName] ?? (perm as any)?.card?.counters?.[counterName] ?? 0
          );
          return !Number.isFinite(counterCount) || counterCount <= 0;
        }
        const term = String(parsedMassBattlefieldCreatureBounce.excludeTypeLineTerm || '').toLowerCase();
        return !getExecutorTypeLineLower(perm).includes(term);
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }


  return undefined;
}
