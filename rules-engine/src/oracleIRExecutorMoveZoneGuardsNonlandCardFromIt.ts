// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the applyMoveZoneStep selector guards starting at if (parsedNonlandCardFromIt && step.to === 'exile') {
// Public entry symbol: tryApplyMoveZoneGuardsFromNonlandCardFromIt.

import type { MoveZoneGuardArgs } from './oracleIRExecutorMoveZoneGuardArgs';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import type { PlayerID } from '../../shared/src';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { moveBattlefieldPermanentsByIdToOwnersHands, permanentMatchesSelector } from './oracleIRExecutorBattlefieldOps';
import {
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
  moveTargetedCardFromExile,
  findCardsExiledWithSource,
  cardMatchesMoveZoneSingleTargetCriteria,
  resolveTypedCardIdFromPlayerZone,
  resolveCardIdsFromAnyGraveyard,
  moveCountFromHandToLibrary,
  cardMatchesType,
} from './oracleIRExecutorZoneOps';
import {
  findBoundCardZoneLocation,
  getChosenObjectIds,
  getTargetPlayerId,
  resolveSourceCardZoneLocation,
} from './oracleIRExecutorMoveZoneReferenceResolvers';
import { getLibraryPlacement } from './oracleIRExecutorMoveZoneContextualCardResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';

export function tryApplyMoveZoneGuardsFromNonlandCardFromIt(args: MoveZoneGuardArgs): MoveZoneStepHandlerResult | undefined {
  const { state, step, ctx, runtime, nextState, log, controllerId, effectiveWithCounters, battlefieldEntryOverrides, finalizeAppliedResult, attachmentResolution } = args;
  const {
    parsedCardFromAGraveyard,
    parsedTargetCreatureGyAndBf,
  } = args.zoneQueries;
  const {
    parsedCardFromTargetPlayerHand,
    parsedNonlandCardFromIt,
    parsedThisCardFromExile,
    parsedThatSpell,
    parsedThisSpellBuybackToHand,
    parsedUpToBattlefieldBounce,
    parsedCardFromAmongThoseCards,
    parsedTypedCardFromYourGraveyard,
    parsedOneOfThemHandBounce,
  } = args.referenceQueries;

  if (parsedNonlandCardFromIt && step.to === 'exile') {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetPlayerId = getTargetPlayerId(ctx);
    if (targetPlayerId) {
      const player = nextState.players.find(p => p.id === targetPlayerId) as any;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      const preferred = getChosenObjectIds(ctx);
      const match =
        hand.find((card: any) => {
          const cardId = String(card?.id || '').trim();
          if (!cardId || cardMatchesType(card, 'land')) return false;
          return preferred.length === 0 || preferred.includes(cardId);
        }) || hand.find((card: any) => !cardMatchesType(card, 'land'));
      const cardId = String((match as any)?.id || '').trim();
      if (cardId) {
        const result = moveTargetedCardFromHand(nextState, targetPlayerId, cardId, 'nonland', 'exile');
        if (result.kind === 'applied') return finalizeAppliedResult(result);
      }
    }
    const matches = findCardsExiledWithSource(nextState, sourceId, { cardType: 'nonland' });
    const preferred = getChosenObjectIds(ctx);
    const chosen =
      preferred.length > 0
        ? matches.find(match => preferred.includes(match.cardId)) || matches[0]
        : matches[0];
    if (!chosen) {
      return buildAppliedResult({ state: nextState, log: [`No nonland card exiled with source: ${step.raw}`] });
    }
    return buildAppliedResult({
      state: nextState,
      log: [`Nonland card already exiled with source: ${step.raw}`],
    });
  }

  if (parsedThisSpellBuybackToHand && step.to === 'hand') {
    const sourceId = String(ctx.sourceId || '').trim();
    const preferredIds = [
      sourceId,
      'gy-source-self',
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ].filter(Boolean);
    for (const cardId of preferredIds) {
      const location = findBoundCardZoneLocation(nextState, cardId);
      if (!location) continue;
      const result =
        location.zone === 'hand'
          ? { kind: 'applied' as const, state: nextState, log: [] as string[] }
          : location.zone === 'graveyard'
            ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: 'any' }, 'hand')
            : location.zone === 'exile'
              ? moveTargetedCardFromExile(nextState, location.playerId, cardId, 'any', 'hand')
              : { kind: 'impossible' as const };
      if (result.kind === 'applied') {
        return buildAppliedResult({
          state: result.state,
          log: result.log?.length ? result.log : [`Returned this spell to hand (buyback): ${step.raw}`],
        });
      }
    }
    return buildAppliedResult({
      state: nextState,
      log: [`Returned this spell to hand (buyback, implicit): ${step.raw}`],
    });
  }

  if (parsedThisCardFromExile && step.to === 'battlefield') {
    const sourceZone =
      resolveSourceCardZoneLocation(nextState, { kind: 'raw', text: 'this card' }, ctx, step.raw) ||
      (() => {
        const sourceId = String(ctx.sourceId || '').trim();
        const location = sourceId ? findBoundCardZoneLocation(nextState, sourceId) : null;
        return location?.zone === 'exile' ? { ...location, cardId: sourceId } : null;
      })();
    if (!sourceZone || sourceZone.zone !== 'exile') {
      const controller = nextState.players.find(p => p.id === controllerId) as any;
      const exile = Array.isArray(controller?.exile) ? controller.exile : [];
      const fallback = exile.find((card: any) => String(card?.id || '').trim() === 'exile-source-self');
      if (!fallback) {
        return {
          applied: false,
          message: `Skipped move zone (source card not in exile): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      const result = moveTargetedCardFromExile(
        nextState,
        controllerId,
        'exile-source-self',
        'any',
        'battlefield',
        controllerId,
        step.entersTapped,
        step.entersFaceDown,
        effectiveWithCounters,
        attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
        battlefieldEntryOverrides
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (exile card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }
    const result = moveTargetedCardFromExile(
      nextState,
      sourceZone.playerId,
      sourceZone.cardId,
      'any',
      'battlefield',
      controllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (exile card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedThatSpell && step.to === 'library') {
    const libraryPlacementFromStep = getLibraryPlacement(step);
    const libraryPlacementRaw = String(
      (ctx as any).libraryPlacement || (ctx as any).selectorContext?.libraryPlacement || ''
    )
      .trim()
      .toLowerCase();
    const libraryPlacement =
      libraryPlacementFromStep ||
      (libraryPlacementRaw === 'top' ? 'top' : libraryPlacementRaw === 'bottom' ? 'bottom' : 'top');
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || 'stack-spell-1').trim();
    const stack = Array.isArray((nextState as any).stack) ? [...(nextState as any).stack] : [];
    const spellIndex = stack.findIndex(entry => String((entry as any)?.id || '').trim() === targetSpellId);
    if (spellIndex < 0) {
      const movedCards = [
        ...(Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      const counteredCard = movedCards[movedCards.length - 1];
      const counteredCardId = String((counteredCard as any)?.id || '').trim();
      if (counteredCardId) {
        const ownerId = String(
          (counteredCard as any)?.owner ||
            (counteredCard as any)?.ownerId ||
            (counteredCard as any)?.controller ||
            controllerId
        ).trim() as PlayerID;
        const graveyardResult = moveTargetedCardFromGraveyard(
          nextState,
          ownerId,
          counteredCardId,
          { cardType: 'any' },
          libraryPlacement === 'top' ? 'library_top' : 'library_bottom'
        );
        if (graveyardResult.kind === 'applied') {
          return buildAppliedResult({
            state: graveyardResult.state,
            log:
              graveyardResult.log.length > 0
                ? graveyardResult.log
                : [`Put countered spell on the ${libraryPlacement} of ${ownerId}'s library: ${step.raw}`],
            movedCards: graveyardResult.movedCards,
          });
        }
      }
      return {
        applied: false,
        message: `Skipped move zone (target spell unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const spell = stack[spellIndex] as any;
    const ownerId = String(spell?.owner || spell?.controller || controllerId).trim() as PlayerID;
    const card = spell?.card || { id: `${targetSpellId}-card`, name: 'Countered Spell', type_line: 'Instant' };
    const player = nextState.players.find(p => p.id === ownerId) as any;
    const library = Array.isArray(player?.library) ? [...player.library] : [];
    const nextLibrary = libraryPlacement === 'top' ? [card, ...library] : [...library, card];
    const updatedPlayers = nextState.players.map(p =>
      p.id === ownerId ? ({ ...(p as any), library: nextLibrary } as any) : p
    );
    const updatedStack = stack.filter((_, index) => index !== spellIndex);
    return buildAppliedResult({
      state: { ...(nextState as any), stack: updatedStack, players: updatedPlayers as any } as any,
      log: [`Put ${targetSpellId} on the ${libraryPlacement === 'top' ? 'top' : 'bottom'} of ${ownerId}'s library`],
    });
  }

  if (parsedThatSpell && step.to === 'hand') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || 'stack-spell-1').trim();
    const stack = Array.isArray((nextState as any).stack) ? [...(nextState as any).stack] : [];
    const spellIndex = stack.findIndex(entry => String((entry as any)?.id || '').trim() === targetSpellId);
    if (spellIndex < 0) {
      return {
        applied: false,
        message: `Skipped move zone (target spell unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    const spell = stack[spellIndex] as any;
    const ownerId = String(spell?.owner || spell?.controller || controllerId).trim() as PlayerID;
    const card = spell?.card || { id: `${targetSpellId}-card`, name: 'Returned Spell', type_line: 'Instant' };
    const player = nextState.players.find(p => p.id === ownerId) as any;
    const hand = Array.isArray(player?.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = nextState.players.map(p => (p.id === ownerId ? ({ ...(p as any), hand } as any) : p));
    const updatedStack = stack.filter((_, index) => index !== spellIndex);
    return buildAppliedResult({
      state: { ...(nextState as any), stack: updatedStack, players: updatedPlayers as any } as any,
      log: [`Returned ${targetSpellId} to ${ownerId}'s hand`],
    });
  }

  if (parsedUpToBattlefieldBounce && step.to === 'hand') {
    const dynamicMaxCount = /^up to x target permanents$/i.test(String((step.what as any)?.text || ''))
      ? Math.max(1, Number(ctx.xValue ?? ctx.referenceAmount ?? 3))
      : parsedUpToBattlefieldBounce.maxCount;
    const selectorText = parsedUpToBattlefieldBounce.selectorText;
    let targetIds: string[] = [];
    if (/^target creatures?$/i.test(selectorText)) {
      targetIds = Array.from(
        new Set(
          [
            String(ctx.targetCreatureId || '').trim(),
            String(ctx.targetPermanentId || '').trim(),
            ...getChosenObjectIds(ctx),
          ].filter(Boolean)
        )
      ).slice(0, dynamicMaxCount);
    } else {
      const selector = parseSimpleBattlefieldSelector({
        kind: 'raw',
        text: selectorText,
      } as any);
      if (!selector) {
        return {
          applied: false,
          message: `Skipped move zone (unsupported selector): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
      const battlefield = [...((nextState.battlefield || []) as any[])];
      const matches = battlefield.filter(perm => permanentMatchesSelector(perm, selector, ctx));
      const preferred = getChosenObjectIds(ctx);
      targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
      if (preferred.length > 0) {
        targetIds = targetIds.filter(id => preferred.includes(id));
        if (targetIds.length === 0) {
          targetIds = matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
        }
      }
      if (targetIds.length > dynamicMaxCount) {
        return {
          applied: false,
          message: `Skipped move zone (needs player bounce choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }
      targetIds = targetIds.slice(0, dynamicMaxCount);
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, targetIds);
    return finalizeAppliedResult(result);
  }

  if (parsedCardFromAmongThoseCards && step.to === 'hand') {
    const cardId = resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'hand',
      parsedCardFromAmongThoseCards.cardType,
      getChosenObjectIds(ctx)
    ) || resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'graveyard',
      parsedCardFromAmongThoseCards.cardType,
      getChosenObjectIds(ctx)
    ) || resolveTypedCardIdFromPlayerZone(
      nextState,
      controllerId,
      'exile',
      parsedCardFromAmongThoseCards.cardType,
      getChosenObjectIds(ctx)
    );
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No among-those-cards match: ${step.raw}`] });
    }
    const location = findBoundCardZoneLocation(nextState, cardId);
    if (!location) {
      return {
        applied: false,
        message: `Skipped move zone (among-those-cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    if (location.zone === 'hand') {
      return buildAppliedResult({ state: nextState, log: [`Card already in hand: ${step.raw}`] });
    }
    const result =
      location.zone === 'graveyard'
        ? moveTargetedCardFromGraveyard(nextState, location.playerId, cardId, { cardType: parsedCardFromAmongThoseCards.cardType }, 'hand')
        : moveTargetedCardFromExile(nextState, location.playerId, cardId, parsedCardFromAmongThoseCards.cardType, 'hand');
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (among-those-cards unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedTypedCardFromYourGraveyard) {
    const libraryPlacement = getLibraryPlacement(step);
    const preferredIds = getChosenObjectIds(ctx);
    const graveyardCriteria = parsedTypedCardFromYourGraveyard;
    let cardId = preferredIds.find(id => {
      const player = nextState.players.find(p => p.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      return graveyard.some(
        (card: any) =>
          String(card?.id || '').trim() === id &&
          cardMatchesMoveZoneSingleTargetCriteria(card, graveyardCriteria)
      );
    });
    if (!cardId) {
      const player = nextState.players.find((entry) => entry.id === controllerId) as any;
      const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
      const criteriaMatches = graveyard.filter((card: any) =>
        cardMatchesMoveZoneSingleTargetCriteria(card, graveyardCriteria)
      );
      if (criteriaMatches.length === 1) {
        cardId = String(criteriaMatches[0]?.id || '').trim();
      } else if (criteriaMatches.length > 1) {
        cardId =
          preferredIds.find((id) =>
            criteriaMatches.some((card: any) => String(card?.id || '').trim() === id)
          ) || String(criteriaMatches[0]?.id || '').trim();
      }
    }
    if (!cardId) {
      cardId = resolveTypedCardIdFromPlayerZone(
        nextState,
        controllerId,
        'graveyard',
        graveyardCriteria.cardType,
        []
      );
    }
    if (!cardId) {
      return buildAppliedResult({ state: nextState, log: [`No matching graveyard card: ${step.raw}`] });
    }
    const destination =
      step.to === 'library' && libraryPlacement
        ? libraryPlacement === 'top'
          ? 'library_top'
          : 'library_bottom'
        : step.to === 'battlefield'
          ? 'battlefield'
          : step.to;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      controllerId,
      cardId,
      graveyardCriteria,
      destination as any,
      step.to === 'battlefield' ? controllerId : undefined,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedOneOfThemHandBounce) {
    const candidateIds = getChosenObjectIds(ctx).filter(id =>
      ((nextState.battlefield || []) as any[]).some(perm => String(perm?.id || '').trim() === id)
    );
    const preferred = getChosenObjectIds(ctx).filter(id => candidateIds.includes(id));
    const targetId = preferred[0] || candidateIds[0] || '';
    if (!targetId) {
      return buildAppliedResult({ state: nextState, log: [`No contextual battlefield permanent: ${step.raw}`] });
    }
    const result = moveBattlefieldPermanentsByIdToOwnersHands(nextState, [targetId]);
    return finalizeAppliedResult(result);
  }

  if (parsedCardFromTargetPlayerHand) {
    const targetPlayerId = getTargetPlayerId(ctx);
    if (!targetPlayerId) {
      return {
        applied: false,
        message: `Skipped move zone (unsupported selector): ${step.raw}`,
        reason: 'unsupported_selector',
      };
    }

    const libraryPlacement = getLibraryPlacement(step);
    if (step.to === 'library' && libraryPlacement) {
      const preferredIds = getChosenObjectIds(ctx);
      const result = moveCountFromHandToLibrary(
        nextState,
        targetPlayerId,
        1,
        libraryPlacement === 'top' ? 'top' : 'bottom',
        preferredIds
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
        return {
          applied: false,
          message: `Skipped move zone (target hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return buildAppliedResult({
        state: result.state,
        log: result.log.length > 0 ? result.log : [`Moved target opponent hand card to library: ${step.raw}`],
      });
    }

    if (step.to === 'exile') {
      const preferredIds = getChosenObjectIds(ctx);
      let targetObjectId = preferredIds.find(id => {
        const player = nextState.players.find(p => p.id === targetPlayerId) as any;
        const hand = Array.isArray(player?.hand) ? player.hand : [];
        return hand.some((card: any) => String(card?.id || '').trim() === id);
      });
      if (!targetObjectId) {
        const player = nextState.players.find(p => p.id === targetPlayerId) as any;
        const hand = Array.isArray(player?.hand) ? player.hand : [];
        if (hand.length === 1) {
          targetObjectId = String((hand[0] as any)?.id || '').trim();
        }
      }
      if (!targetObjectId) {
        return {
          applied: false,
          message: `Skipped move zone (unsupported selector): ${step.raw}`,
          reason: 'unsupported_selector',
        };
      }
      const result = moveTargetedCardFromHand(
        nextState,
        targetPlayerId,
        targetObjectId,
        parsedCardFromTargetPlayerHand.cardType,
        'exile'
      );
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped move zone (target hand card unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      return finalizeAppliedResult(result);
    }
  }

  if (parsedTargetCreatureGyAndBf && step.to === 'hand') {
    const preferred = getChosenObjectIds(ctx);
    const gyMatches = resolveCardIdsFromAnyGraveyard(nextState, 'creature', preferred, 1);
    const gyMatch = gyMatches[0];
    const battlefield = [...((nextState.battlefield || []) as any[])];
    const creatureIds = battlefield
      .filter(perm => hasExecutorClass(perm as any, 'creature'))
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const bfId =
      preferred.find(id => creatureIds.includes(id)) ||
      (creatureIds.length === 1 ? creatureIds[0] : creatureIds[0] || '');
    let workingState = nextState;
    const combinedLog: string[] = [];
    if (gyMatch) {
      const gyResult = moveTargetedCardFromGraveyard(
        workingState,
        gyMatch.playerId,
        gyMatch.cardId,
        { cardType: 'creature' },
        'hand'
      );
      if (gyResult.kind === 'applied') {
        workingState = gyResult.state;
        combinedLog.push(...(gyResult.log || []));
      }
    }
    if (bfId) {
      const bfResult = moveBattlefieldPermanentsByIdToOwnersHands(workingState, [bfId]);
      workingState = bfResult.state;
      combinedLog.push(...bfResult.log);
    }
    if (combinedLog.length === 0) {
      return buildAppliedResult({ state: nextState, log: [`No targets for gy/bf hand return: ${step.raw}`] });
    }
    return buildAppliedResult({
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Returned graveyard creature and battlefield creature: ${step.raw}`],
    });
  }

  if (parsedCardFromAGraveyard && step.to === 'exile') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCardFromAGraveyard.cardType,
      getChosenObjectIds(ctx),
      1
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard card matched: ${step.raw}`],
      });
    }
    if (matches.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (graveyard target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const match = matches[0];
    const result = moveTargetedCardFromGraveyard(
      nextState,
      match.playerId,
      match.cardId,
      { cardType: parsedCardFromAGraveyard.cardType },
      'exile'
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }

  if (parsedCardFromAGraveyard && step.to === 'battlefield') {
    const matches = resolveCardIdsFromAnyGraveyard(
      nextState,
      parsedCardFromAGraveyard.cardType,
      getChosenObjectIds(ctx),
      1
    );
    if (matches.length === 0) {
      return buildAppliedResult({
        state: nextState,
        log: [`No graveyard card matched: ${step.raw}`],
      });
    }
    if (matches.length > 1) {
      return {
        applied: false,
        message: `Skipped move zone (graveyard target requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const match = matches[0];
    const battlefieldControllerId =
      step.battlefieldController?.kind === 'you'
        ? controllerId
        : step.battlefieldController?.kind === 'owner_of_moved_cards'
          ? match.playerId
          : controllerId;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      match.playerId,
      match.cardId,
      { cardType: parsedCardFromAGraveyard.cardType },
      'battlefield',
      battlefieldControllerId,
      step.entersTapped,
      step.entersFaceDown,
      effectiveWithCounters,
      attachmentResolution.kind === 'resolved' ? attachmentResolution.permanentId : undefined,
      undefined,
      battlefieldEntryOverrides
    );
    if (result.kind === 'impossible') {
      return {
        applied: false,
        message: `Skipped move zone (graveyard card unavailable): ${step.raw}`,
        reason: 'impossible_action',
        options: { persist: false },
      };
    }
    return finalizeAppliedResult(result);
  }


  return undefined;
}
