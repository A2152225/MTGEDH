// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applySearchLibraryStep (+ exclusive filterChosenLibraryMatchIds).
// Public entries: applySearchLibraryStep.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';
import { resolveBattlefieldEntryFromOracleIrContext } from './oracleIRExecutorBattlefieldEntryCommit';
import { commitCardZoneChanges } from './oracleIRExecutorCardZoneTransitionCommit';
import {
  getSearchLibraryMatches,
  isOptionalSearchLibraryStep,
  resolveSearchLibraryMaxResults,
} from './oracleIRExecutorPlayerSearchLibraryMatches';
import {
  getNormalizedChosenIds,
  shuffleArray,
  withDiscardLedgerFlags,
} from './oracleIRExecutorPlayerStepShared';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import {
  readPlayerZoneCards,
  resolvePlayers,
  stampCardsPutIntoGraveyardThisTurn,
  writePlayerZoneCards,
} from './oracleIRExecutorPlayerUtils';
import { inferSplitLibrarySearchPlan } from './oracleIRSplitLibrarySearch';
import { usedOracleIrServerBridge } from './oracleIRStepLedgerRuntime';
import { createBattlefieldPermanentsFromCards } from './oracleIRExecutorZoneOps';

function filterChosenLibraryMatchIds(
  matches: readonly any[],
  chosenIds: readonly string[],
  maxResults: number,
): readonly string[] {
  const matchIds = new Set(
    matches
      .map((card) => String(card?.id || card?.cardId || '').trim())
      .filter(Boolean),
  );
  const filtered = chosenIds.filter((id) => matchIds.has(id));
  if (filtered.length === 0) return [];
  return filtered.slice(0, Math.max(1, maxResults));
}

export function applySearchLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped library search (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const allMovedCards: any[] = [];
  const replayMutations: OracleIRReplayMutation[] = [];
  let ledgerRecordedViaBridge = false;
  const bridgeActive = usedOracleIrServerBridge(ctx);

  const recordShuffledLibrary = (playerId: PlayerID, shuffledLibrary: readonly any[]): void => {
    if (step.shuffle === false) return;
    const shuffledLibraryIds = shuffledLibrary
      .map((card) => String(card?.id || card?.cardId || '').trim())
      .filter(Boolean);
    if (shuffledLibraryIds.length === 0) return;
    replayMutations.push({ kind: 'shuffleLibrary', playerId, shuffledLibraryIds });
  };

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped library search (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const matches = getSearchLibraryMatches(library, step, nextState, ctx);
    if (matches === null) {
      return {
        applied: false,
        message: `Skipped library search (criteria unresolved): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const maxResults = step.maxResults === 'any_number'
      ? matches.length
      : resolveSearchLibraryMaxResults(nextState, step, ctx);
    const matchById = new Map(
      matches.map((card) => [String(card?.id || card?.cardId || '').trim(), card] as const),
    );
    const chosenIds = filterChosenLibraryMatchIds(matches, getNormalizedChosenIds(ctx), maxResults);
    let selected: any[];

    if (chosenIds.length > 0) {
      selected = chosenIds
        .map((id) => matchById.get(String(id || '').trim()))
        .filter(Boolean) as any[];
    } else if (
      matches.length > 0
      && (
        matches.length > maxResults
        || step.maxResults === 'any_number'
        // "Up to N" is a live choice even when exactly N cards match — the player may take fewer.
        // Non-interactive unit paths auto-take the maximum available.
        || (isOptionalSearchLibraryStep(step) && ctx.interactivePlayerChoices === true)
        // Live / interactive (explicit true): always pause for LIBRARY_SEARCH UI even when only
        // one card matches. Default / non-interactive paths auto-pick unique fixed-count matches
        // (e.g. Transmute with a single same-mana-value hit).
        || ctx.interactivePlayerChoices === true
      )
    ) {
      return {
        applied: false,
        message: `Skipped library search (requires card choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    } else {
      selected = matches.slice(0, maxResults);
    }

    const selectedIds = new Set(selected.map(card => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
    const splitPlan = inferSplitLibrarySearchPlan(step.raw);
    const splitAssignmentsRaw = (ctx.selectorContext as {
      splitAssignments?: { toBattlefield?: string[]; toHand?: string[] };
    } | undefined)?.splitAssignments;

    if (splitPlan && selected.length > 0 && !splitAssignmentsRaw) {
      return {
        applied: false,
        message: `Skipped library search (requires split destination choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    const canBridgeSplit = bridgeActive
      && splitPlan
      && splitAssignmentsRaw
      && Number.isFinite(ctx.currentStepIndex)
      && selected.length > 0;

    if (canBridgeSplit) {
      const battlefieldIdSet = new Set(
        (splitAssignmentsRaw.toBattlefield || []).map((id) => String(id || '').trim()).filter(Boolean),
      );
      const handIdSet = new Set(
        (splitAssignmentsRaw.toHand || []).map((id) => String(id || '').trim()).filter(Boolean),
      );
      const battlefieldCards = selected.filter((card) =>
        battlefieldIdSet.has(String(card?.id || card?.cardId || '').trim()),
      );
      const handCards = selected.filter((card) =>
        handIdSet.has(String(card?.id || card?.cardId || '').trim()),
      );

      if (handCards.length > 0) {
        const handCommit = commitCardZoneChanges({
          state: nextState,
          playerId,
          cards: handCards.map((card) => ({ ...card, ownerId: playerId, owner: playerId })),
          sourceZone: 'library',
          intendedDestination: 'hand',
          stepIndex: Number(ctx.currentStepIndex),
          stepKind: step.kind,
          cause: 'oracle_ir:search_library_split',
          ctx,
        });
        if (handCommit.halted) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
          }, ledgerRecordedViaBridge);
        }
        nextState = handCommit.state;
        allMovedCards.push(...handCommit.movedCards);
        if (handCommit.ledgerRecordedViaBridge) {
          ledgerRecordedViaBridge = true;
        }
      }

      const playerAfterHand = nextState.players.find((entry) => entry.id === playerId) as any;
      let remainingLibrary = readPlayerZoneCards(nextState, playerId, playerAfterHand, 'library');
      remainingLibrary = remainingLibrary.filter(
        (card) => !battlefieldIdSet.has(String(card?.id || card?.cardId || '').trim()),
      );
      const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
      writePlayerZoneCards(nextState, playerId, playerAfterHand, 'library', shuffledLibrary);
      recordShuffledLibrary(playerId, shuffledLibrary);

      const entersTapped = Boolean(splitPlan.entersTapped || step.entersTapped);
      const enteredBattlefield: any[] = [];
      for (const card of battlefieldCards) {
        const resolved = resolveBattlefieldEntryFromOracleIrContext(
          nextState,
          card,
          playerId,
          { entersTapped },
          { ctx, stepKind: step.kind, cause: 'oracle_ir:search_library_split' },
        );
        if ('halted' in resolved) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
          }, ledgerRecordedViaBridge);
        }

        enteredBattlefield.push(
          ...createBattlefieldPermanentsFromCards(
            [{ ...card, ownerId: playerId, owner: playerId }],
            playerId,
            playerId,
            resolved.entersTapped,
            resolved.entersFaceDown,
            resolved.withCounters,
            'library',
          ),
        );
      }

      if (enteredBattlefield.length > 0) {
        nextState = {
          ...nextState,
          battlefield: [...(nextState.battlefield || []), ...enteredBattlefield],
        } as GameState;
        allMovedCards.push(...battlefieldCards);
        ledgerRecordedViaBridge = true;
      }

      if (step.revealFound && selected.length > 0) {
        log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
      }
      log.push(
        `${playerId} searched their library and put ${battlefieldCards.length} card(s) onto the battlefield and ${handCards.length} card(s) into their hand`,
      );
      if (step.shuffle !== false) {
        log.push(`${playerId} shuffled their library`);
      }
      continue;
    }

    const canBridgeBattlefield = bridgeActive
      && selected.length > 0
      && step.destination === 'battlefield'
      && Number.isFinite(ctx.currentStepIndex);

    if (canBridgeBattlefield) {
      const remainingLibrary = library.filter(
        (card) => !selectedIds.has(String(card?.id || card?.cardId || '').trim()),
      );
      const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
      writePlayerZoneCards(nextState, playerId, player, 'library', shuffledLibrary);
      recordShuffledLibrary(playerId, shuffledLibrary);

      const enteredBattlefield: any[] = [];
      for (const card of selected) {
        const resolved = resolveBattlefieldEntryFromOracleIrContext(
          nextState,
          card,
          playerId,
          { entersTapped: Boolean(step.entersTapped) },
          { ctx, stepKind: step.kind, cause: 'oracle_ir:search_library' },
        );
        if ('halted' in resolved) {
          return withDiscardLedgerFlags({
            applied: true,
            state: nextState,
            log,
            ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
          }, ledgerRecordedViaBridge);
        }

        enteredBattlefield.push(
          ...createBattlefieldPermanentsFromCards(
            [{ ...card, ownerId: playerId, owner: playerId }],
            playerId,
            playerId,
            resolved.entersTapped,
            resolved.entersFaceDown,
            resolved.withCounters,
            'library',
          ),
        );
      }

      nextState = {
        ...nextState,
        battlefield: [...(nextState.battlefield || []), ...enteredBattlefield],
      } as GameState;
      allMovedCards.push(...selected);
      ledgerRecordedViaBridge = true;

      if (step.revealFound && selected.length > 0) {
        log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
      }
      log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
      if (step.shuffle !== false) {
        log.push(`${playerId} shuffled their library`);
      }
      continue;
    }

    const canBridgeSearch = bridgeActive
      && selected.length > 0
      && step.destination !== 'battlefield'
      && Number.isFinite(ctx.currentStepIndex);

    if (canBridgeSearch) {
      const intendedDestination = step.destination === 'hand'
        ? 'hand'
        : step.destination === 'graveyard'
          ? 'graveyard'
          : step.destination === 'exile'
            ? 'exile'
            : 'library';
      const libraryPlacement = step.destination === 'top'
        ? 'top' as const
        : step.destination === 'bottom'
          ? 'bottom' as const
          : undefined;
      const cardsToCommit = (step.destination === 'graveyard'
        ? stampCardsPutIntoGraveyardThisTurn(nextState, selected)
        : step.destination === 'top'
          ? [...selected].reverse()
          : selected
      ).map((card: any) => ({ ...card, ownerId: playerId, owner: playerId }));

      const commitResult = commitCardZoneChanges({
        state: nextState,
        playerId,
        cards: cardsToCommit,
        sourceZone: 'library',
        intendedDestination,
        stepIndex: Number(ctx.currentStepIndex),
        stepKind: step.kind,
        cause: 'oracle_ir:search_library',
        ctx,
        libraryPlacement,
      });
      if (commitResult.halted) {
        return withDiscardLedgerFlags({
          applied: true,
          state: nextState,
          log,
          ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
        }, ledgerRecordedViaBridge);
      }

      const playerAfterCommit = nextState.players.find((entry) => entry.id === playerId) as any;
      const libraryAfterCommit = readPlayerZoneCards(nextState, playerId, playerAfterCommit, 'library');
      const committedSelectedCards = libraryAfterCommit.filter((card) =>
        selectedIds.has(String(card?.id || card?.cardId || '').trim()),
      );
      const remainingLibrary = libraryAfterCommit.filter((card) =>
        !selectedIds.has(String(card?.id || card?.cardId || '').trim()),
      );
      const shuffledRemainder = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
      const finalLibrary = step.destination === 'top'
        ? [...committedSelectedCards, ...shuffledRemainder]
        : step.destination === 'bottom'
          ? [...shuffledRemainder, ...committedSelectedCards]
          : shuffledRemainder;
      writePlayerZoneCards(nextState, playerId, playerAfterCommit, 'library', finalLibrary);
      recordShuffledLibrary(playerId, finalLibrary);

      allMovedCards.push(...commitResult.movedCards);
      if (commitResult.ledgerRecordedViaBridge) {
        ledgerRecordedViaBridge = true;
      }

      if (step.revealFound && selected.length > 0) {
        log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
      }
      if (selected.length > 0) {
        log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
      } else {
        log.push(`${playerId} searched their library and found no card`);
      }
      if (step.shuffle !== false) {
        log.push(`${playerId} shuffled their library`);
      }
      continue;
    }

    const remainingLibrary = library.filter(card => !selectedIds.has(String(card?.id || card?.cardId || '').trim()));
    const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
    recordShuffledLibrary(playerId, shuffledLibrary);
    const movedCards = selected.map((card: any) => ({
      ...card,
      zone: step.destination,
    }));
    const enteredBattlefield =
      step.destination === 'battlefield'
        ? createBattlefieldPermanentsFromCards(
            movedCards,
            playerId,
            playerId,
            Boolean(step.entersTapped),
            false,
            undefined,
            'library'
          )
        : [];

    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) => {
        if (entry.id !== playerId) return entry;
        const hand = Array.isArray(entry.hand) ? [...entry.hand] : [];
        const graveyard = Array.isArray(entry.graveyard) ? [...entry.graveyard] : [];
        const exile = Array.isArray(entry.exile) ? [...entry.exile] : [];

        if (step.destination === 'hand') {
          return { ...entry, library: shuffledLibrary, hand: [...hand, ...movedCards] };
        }
        if (step.destination === 'graveyard') {
          return { ...entry, library: shuffledLibrary, graveyard: [...graveyard, ...movedCards] };
        }
        if (step.destination === 'exile') {
          return { ...entry, library: shuffledLibrary, exile: [...exile, ...movedCards] };
        }
        if (step.destination === 'battlefield') {
          return { ...entry, library: shuffledLibrary };
        }
        if (step.destination === 'top') {
          return { ...entry, library: [...movedCards, ...shuffledLibrary] };
        }
        if (step.destination === 'bottom') {
          return { ...entry, library: [...shuffledLibrary, ...movedCards] };
        }

        return { ...entry, library: shuffledLibrary, hand: [...hand, ...movedCards] };
      }),
      ...(enteredBattlefield.length > 0
        ? { battlefield: [...(nextState.battlefield || []), ...enteredBattlefield] }
        : {}),
    } as GameState;

    if (step.revealFound && selected.length > 0) {
      log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
    }
    if (selected.length > 0) {
      log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
    } else {
      log.push(`${playerId} searched their library and found no card`);
    }
    if (step.shuffle !== false) {
      log.push(`${playerId} shuffled their library`);
    }
    allMovedCards.push(...movedCards);
  }

  return withDiscardLedgerFlags({
    applied: true,
    state: nextState,
    log,
    ...(allMovedCards.length > 0 ? { lastMovedCards: allMovedCards } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  }, ledgerRecordedViaBridge);
}
