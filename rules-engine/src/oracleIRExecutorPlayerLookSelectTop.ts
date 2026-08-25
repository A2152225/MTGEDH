// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: lookSelectTopCardsForPlayer (look at top, choose some, rest to zone).
// Public entries: lookSelectTopCardsForPlayer.

import type { GameState, PlayerID } from '../../shared/src';
import {
  commitCardZoneChanges,
  commitLookSelectRestZoneChanges,
  type PlayerZoneChangeBridgeContext,
} from './oracleIRExecutorCardZoneTransitionCommit';
import {
  readPlayerZoneCards,
  stampCardsPutIntoGraveyardThisTurn,
  writePlayerZoneCards,
} from './oracleIRExecutorPlayerZoneAccess';

export function lookSelectTopCardsForPlayer(
  state: GameState,
  playerId: PlayerID,
  lookCount: number,
  chooseCount: number,
  destination: 'hand' | 'graveyard' | 'library_top',
  restDestination: 'graveyard' | 'library',
  restToTop = false,
  restRandomOrder = false,
  bridgeOptions?: PlayerZoneChangeBridgeContext,
  chosenObjectIds?: readonly string[],
): {
  state: GameState;
  log: string[];
  chosen: any[];
  rest: any[];
  lookedAtCount: number;
  ledgerRecordedViaBridge?: boolean;
  halted?: boolean;
} {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) {
    return {
      state,
      log: [`Player not found: ${playerId}`],
      chosen: [],
      rest: [],
      lookedAtCount: 0,
    };
  }

  const library = readPlayerZoneCards(state, playerId, player, 'library');
  const actualLookCount = Math.max(0, Math.min(library.length, lookCount | 0));
  const chooseActual = Math.max(0, Math.min(actualLookCount, chooseCount | 0));
  const looked = library.slice(0, actualLookCount);
  let chosen: any[];
  let rest: any[];
  const normalizedChosenIds = (Array.isArray(chosenObjectIds) ? chosenObjectIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (normalizedChosenIds.length > 0) {
    const chosenIdSet = new Set(normalizedChosenIds);
    chosen = looked
      .filter((card) => chosenIdSet.has(String((card as { id?: string })?.id || '').trim()))
      .slice(0, chooseActual);
    const chosenIds = new Set(
      chosen.map((card) => String((card as { id?: string })?.id || '').trim()).filter(Boolean),
    );
    rest = looked.filter((card) => !chosenIds.has(String((card as { id?: string })?.id || '').trim()));
  } else {
    chosen = looked.slice(0, chooseActual);
    rest = looked.slice(chooseActual);
  }

  const stepIndex = bridgeOptions?.stepIndex;
  const canBridge = bridgeOptions?.ctx?.serverBridge && Number.isFinite(stepIndex);
  const canBridgeChosen = canBridge
    && (destination === 'hand' || destination === 'graveyard' || destination === 'library_top')
    && chosen.length > 0;

  if (canBridgeChosen) {
    const intendedDestination = destination === 'hand'
      ? 'hand'
      : destination === 'graveyard'
        ? 'graveyard'
        : 'library';
    const libraryPlacement = destination === 'library_top' ? 'top' as const : undefined;
    const cardsToCommit = (destination === 'graveyard'
      ? stampCardsPutIntoGraveyardThisTurn(state, chosen)
      : destination === 'library_top'
        ? [...chosen].reverse()
        : chosen
    ).map((card: any) => ({ ...card, ownerId: playerId, owner: playerId }));

    const commitResult = commitCardZoneChanges({
      state,
      playerId,
      cards: cardsToCommit,
      sourceZone: 'library',
      intendedDestination,
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions?.stepKind || 'look_select_top'),
      cause: 'oracle_ir:look_select_top',
      ctx: bridgeOptions?.ctx,
      libraryPlacement,
    });
    if (commitResult.halted) {
      return {
        state,
        log: [],
        chosen: [],
        rest: [],
        lookedAtCount: 0,
        halted: true,
      };
    }

    let ledgerRecordedViaBridge = Boolean(commitResult.ledgerRecordedViaBridge);
    if (rest.length > 0) {
      const restCommit = commitLookSelectRestZoneChanges({
        state,
        playerId,
        rest,
        destination,
        restDestination,
        restToTop,
        restRandomOrder,
        stepIndex: Number(stepIndex),
        stepKind: String(bridgeOptions?.stepKind || 'look_select_top'),
        ctx: bridgeOptions?.ctx,
      });
      if (restCommit.halted) {
        return {
          state,
          log: [],
          chosen: [],
          rest: [],
          lookedAtCount: 0,
          halted: true,
        };
      }
      if (restCommit.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
    }

    const destinationLabel = destination === 'hand'
      ? 'their hand'
      : destination === 'graveyard'
        ? 'their graveyard'
        : 'the top of their library';
    const restLabel = restDestination === 'graveyard'
      ? 'their graveyard'
      : restRandomOrder
        ? 'the bottom of their library in a random order'
        : restToTop
          ? 'the top of their library'
          : 'the bottom of their library';

    return {
      state,
      log: [
        `${playerId} looks at ${actualLookCount} card(s), puts ${commitResult.movedCards.length} into ${destinationLabel}, and moves ${rest.length} to ${restLabel}`,
      ],
      chosen: commitResult.movedCards,
      rest,
      lookedAtCount: actualLookCount,
      ledgerRecordedViaBridge,
    };
  }

  if (canBridge && chosen.length === 0 && rest.length > 0) {
    const restCommit = commitLookSelectRestZoneChanges({
      state,
      playerId,
      rest,
      destination,
      restDestination,
      restToTop,
      restRandomOrder,
      stepIndex: Number(stepIndex),
      stepKind: String(bridgeOptions?.stepKind || 'look_select_top'),
      ctx: bridgeOptions?.ctx,
    });
    if (restCommit.halted) {
      return {
        state,
        log: [],
        chosen: [],
        rest: [],
        lookedAtCount: 0,
        halted: true,
      };
    }

    const destinationLabel = destination === 'hand'
      ? 'their hand'
      : destination === 'graveyard'
        ? 'their graveyard'
        : 'the top of their library';
    const restLabel = restDestination === 'graveyard'
      ? 'their graveyard'
      : restRandomOrder
        ? 'the bottom of their library in a random order'
        : restToTop
          ? 'the top of their library'
          : 'the bottom of their library';

    return {
      state: restCommit.state,
      log: [
        `${playerId} looks at ${actualLookCount} card(s), puts 0 into ${destinationLabel}, and moves ${rest.length} to ${restLabel}`,
      ],
      chosen: [],
      rest,
      lookedAtCount: actualLookCount,
      ledgerRecordedViaBridge: restCommit.ledgerRecordedViaBridge,
    };
  }

  const hand = readPlayerZoneCards(state, playerId, player, 'hand');
  const graveyard = readPlayerZoneCards(state, playerId, player, 'graveyard');
  let nextLibrary = [...library];
  let nextHand = [...hand];
  let nextGraveyard = [...graveyard];
  nextLibrary.splice(0, actualLookCount);

  if (destination === 'hand') {
    nextHand.push(...chosen);
  } else if (destination === 'graveyard') {
    nextGraveyard.push(...stampCardsPutIntoGraveyardThisTurn(state, chosen));
  } else if (destination === 'library_top' && chosen.length > 0) {
    for (let index = chosen.length - 1; index >= 0; index -= 1) {
      nextLibrary.unshift(chosen[index]);
    }
  }

  if (restDestination === 'graveyard') {
    nextGraveyard.push(...stampCardsPutIntoGraveyardThisTurn(state, rest));
  } else if (rest.length > 0) {
    if (destination === 'library_top') {
      const bottomRest = restRandomOrder
        ? [...rest].sort(() => Math.random() - 0.5)
        : rest;
      nextLibrary.push(...bottomRest);
    } else {
      const reorderedRest = restToTop ? rest : [...rest].reverse();
      nextLibrary.unshift(...reorderedRest);
    }
  }

  writePlayerZoneCards(state, playerId, player, 'library', nextLibrary);
  writePlayerZoneCards(state, playerId, player, 'hand', nextHand);
  writePlayerZoneCards(state, playerId, player, 'graveyard', nextGraveyard);

  const destinationLabel = destination === 'hand'
    ? 'their hand'
    : destination === 'graveyard'
      ? 'their graveyard'
      : 'the top of their library';
  const restLabel = restDestination === 'graveyard'
    ? 'their graveyard'
    : restRandomOrder
      ? 'the bottom of their library in a random order'
      : restToTop
        ? 'the top of their library'
        : 'the bottom of their library';

  return {
    state,
    log: [
      `${playerId} looks at ${actualLookCount} card(s), puts ${chosen.length} into ${destinationLabel}, and moves ${rest.length} to ${restLabel}`,
    ],
    chosen,
    rest,
    lookedAtCount: actualLookCount,
  };
}

