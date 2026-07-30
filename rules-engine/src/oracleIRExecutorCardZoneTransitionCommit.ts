import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleIRPendingTransition, RuntimeObjectZone } from './oracleIRTransitionTypes';
import {
  buildZoneChangeTransitionsFromCards,
  resolveEffectiveDestinationFromTransition,
} from './oracleIRExecutorZoneTransitionBuilders';
import {
  readPlayerZoneCards,
  stampCardsPutIntoGraveyardThisTurn,
  writePlayerZoneCards,
} from './oracleIRExecutorPlayerUtils';

export type PlayerZoneChangeBridgeContext = {
  readonly ctx?: OracleIRExecutionContext;
  readonly stepIndex?: number;
  readonly stepKind?: string;
};

type PlayerZoneName = 'library' | 'hand' | 'graveyard' | 'exile';
type PlayerSourceZoneName = PlayerZoneName;
type PlayerDestinationZoneName = PlayerZoneName | 'cease_to_exist';

function toPlayerZoneName(zone: RuntimeObjectZone): PlayerZoneName | 'command' | null {
  if (zone === 'library' || zone === 'hand' || zone === 'graveyard' || zone === 'exile') {
    return zone;
  }
  if (zone === 'command') return 'command';
  return null;
}

function removeCardById(cards: any[], objectId: string): { remaining: any[]; removed: any | null } {
  const index = cards.findIndex(
    (card) => String(card?.id || card?.card?.id || '').trim() === objectId,
  );
  if (index < 0) return { remaining: cards, removed: null };
  const removed = cards[index];
  const remaining = [...cards.slice(0, index), ...cards.slice(index + 1)];
  return { remaining, removed };
}

function placeCardInPlayerZone(
  state: GameState,
  player: any,
  card: any,
  destination: RuntimeObjectZone,
  libraryPlacement?: 'top' | 'bottom',
): void {
  const zoneName = toPlayerZoneName(destination);
  if (!zoneName) return;

  if (zoneName === 'command') {
    const commandZone = Array.isArray(player.commandZone) ? [...player.commandZone] : [];
    commandZone.push({ ...card, zone: 'command' });
    player.commandZone = commandZone;
    return;
  }

  const zoneCards = readPlayerZoneCards(state, player.id, player, zoneName);
  const stamped = zoneName === 'graveyard'
    ? stampCardsPutIntoGraveyardThisTurn(state, [card])[0]
    : { ...card, zone: zoneName };
  if (zoneName === 'library' && libraryPlacement === 'bottom') {
    writePlayerZoneCards(state, player.id, player, zoneName, [...zoneCards, stamped]);
    return;
  }
  if (zoneName === 'library' && libraryPlacement === 'top') {
    writePlayerZoneCards(state, player.id, player, zoneName, [stamped, ...zoneCards]);
    return;
  }
  writePlayerZoneCards(state, player.id, player, zoneName, [...zoneCards, stamped]);
}

function resolveLibraryPlacementFromTransition(
  transition: OracleIRPendingTransition,
): 'top' | 'bottom' | undefined {
  const placement = String((transition.event.metadata as any)?.libraryPlacement || '').trim().toLowerCase();
  if (placement === 'top' || placement === 'bottom') return placement;
  return undefined;
}

function applyReadyCardZoneTransitions(args: {
  state: GameState;
  playerId: PlayerID;
  sourceZone: PlayerSourceZoneName;
  readyTransitions: readonly OracleIRPendingTransition[];
  fallbackDestination: RuntimeObjectZone;
  fallbackLibraryPlacement?: 'top' | 'bottom';
}): { state: GameState; movedCards: any[] } {
  const player = args.state.players.find((entry) => entry.id === args.playerId) as any;
  if (!player) return { state: args.state, movedCards: [] };

  const sourceZoneName = args.sourceZone;
  let sourceCards = readPlayerZoneCards(args.state, args.playerId, player, sourceZoneName);
  const movedCards: any[] = [];

  for (const transition of args.readyTransitions) {
    const objectId = String(
      transition.event.objectId || (transition.event.object as any)?.id || '',
    ).trim();
    if (!objectId) continue;

    const { remaining, removed } = removeCardById(sourceCards, objectId);
    const card = removed ?? transition.event.object;
    if (!card) continue;

    const fallbackZone = toPlayerZoneName(args.fallbackDestination);
    const destination = resolveEffectiveDestinationFromTransition(
      transition,
      fallbackZone && fallbackZone !== 'command' ? fallbackZone : sourceZoneName,
    );
    if (destination === 'cease_to_exist') continue;

    if (sourceZoneName === 'library' && destination === 'library') {
      const libraryPlacement = resolveLibraryPlacementFromTransition(transition)
        ?? args.fallbackLibraryPlacement;
      sourceCards = remaining;
      if (libraryPlacement === 'bottom') {
        sourceCards = [...sourceCards, card];
      } else {
        sourceCards = [card, ...sourceCards];
      }
      movedCards.push(card);
      continue;
    }

    sourceCards = remaining;
    const libraryPlacement = destination === 'library'
      ? (resolveLibraryPlacementFromTransition(transition) ?? args.fallbackLibraryPlacement)
      : undefined;
    placeCardInPlayerZone(args.state, player, card, destination, libraryPlacement);
    movedCards.push(card);
  }

  writePlayerZoneCards(args.state, args.playerId, player, sourceZoneName, sourceCards);
  return {
    state: args.state,
    movedCards,
  };
}

export function commitCardZoneChanges(args: {
  state: GameState;
  playerId: PlayerID;
  cards: readonly unknown[];
  sourceZone: PlayerSourceZoneName;
  intendedDestination: RuntimeObjectZone;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
  libraryPlacement?: 'top' | 'bottom';
}): {
  state: GameState;
  log: string[];
  halted: boolean;
  movedCards: any[];
  ledgerRecordedViaBridge: boolean;
} {
  const cards = (Array.isArray(args.cards) ? args.cards : []).filter(Boolean);
  if (cards.length === 0) {
    return {
      state: args.state,
      log: [],
      halted: false,
      movedCards: [],
      ledgerRecordedViaBridge: false,
    };
  }

  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return {
      ...applyDirectCardZoneChanges(args),
      ledgerRecordedViaBridge: false,
    };
  }

  const transitions = buildZoneChangeTransitionsFromCards({
    cards,
    sourceZone: args.sourceZone,
    intendedDestination: args.intendedDestination,
    ownerId: args.playerId,
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause,
    ctx: args.ctx,
    libraryPlacement: args.libraryPlacement,
  });

  const bridgeResult = bridge.proposeTransitions(transitions);
  if (bridgeResult.halt) {
    if (args.ctx?.transitionHaltState) {
      args.ctx.transitionHaltState.halted = true;
      args.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
    }
    return {
      state: args.state,
      log: [],
      halted: true,
      movedCards: [],
      ledgerRecordedViaBridge: false,
    };
  }

  const ready = bridgeResult.ready ?? transitions;
  const applied = applyReadyCardZoneTransitions({
    state: args.state,
    playerId: args.playerId,
    sourceZone: args.sourceZone,
    readyTransitions: ready,
    fallbackDestination: args.intendedDestination,
    fallbackLibraryPlacement: args.libraryPlacement,
  });

  return {
    state: applied.state,
    log: [],
    halted: false,
    movedCards: applied.movedCards,
    ledgerRecordedViaBridge: true,
  };
}

function applyDirectCardZoneChanges(args: {
  state: GameState;
  playerId: PlayerID;
  cards: readonly unknown[];
  sourceZone: PlayerSourceZoneName;
  intendedDestination: RuntimeObjectZone;
  libraryPlacement?: 'top' | 'bottom';
}): { state: GameState; log: string[]; halted: boolean; movedCards: any[] } {
  const player = args.state.players.find((entry) => entry.id === args.playerId) as any;
  if (!player) {
    return { state: args.state, log: [], halted: false, movedCards: [] };
  }

  const sourceCards = readPlayerZoneCards(args.state, args.playerId, player, args.sourceZone);
  const movedCards: any[] = [];
  let nextSource = [...sourceCards];

  for (const rawCard of args.cards) {
    const objectId = String((rawCard as any)?.id || (rawCard as any)?.card?.id || '').trim();
    if (!objectId) continue;
    const { remaining, removed } = removeCardById(nextSource, objectId);
    if (!removed) continue;
    nextSource = remaining;
    placeCardInPlayerZone(args.state, player, removed, args.intendedDestination, args.libraryPlacement);
    movedCards.push(removed);
  }

  writePlayerZoneCards(args.state, args.playerId, player, args.sourceZone, nextSource);
  return {
    state: args.state,
    log: [],
    halted: false,
    movedCards,
  };
}

function orderLookSelectRestCards(
  rest: readonly any[],
  options: { restToTop?: boolean; restRandomOrder?: boolean; restLibraryPlacement?: 'top' | 'bottom' },
): any[] {
  if (options.restRandomOrder) {
    return [...rest].sort(() => Math.random() - 0.5);
  }
  if (options.restLibraryPlacement === 'bottom') {
    return [...rest];
  }
  return options.restToTop ? [...rest] : [...rest].reverse();
}

/** Route look_select_top / look_choose_from_top rest piles through the pre-commit bridge. */
export function commitLookSelectRestZoneChanges(args: {
  state: GameState;
  playerId: PlayerID;
  rest: readonly any[];
  destination: 'hand' | 'graveyard' | 'library_top' | 'exile';
  restDestination: 'graveyard' | 'library';
  restToTop?: boolean;
  restRandomOrder?: boolean;
  restLibraryPlacement?: 'top' | 'bottom';
  stepIndex: number;
  stepKind: string;
  cause?: string;
  ctx?: OracleIRExecutionContext;
}): {
  state: GameState;
  halted: boolean;
  ledgerRecordedViaBridge: boolean;
} {
  const rest = (Array.isArray(args.rest) ? args.rest : []).filter(Boolean);
  if (rest.length === 0) {
    return { state: args.state, halted: false, ledgerRecordedViaBridge: false };
  }

  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return { state: args.state, halted: false, ledgerRecordedViaBridge: false };
  }

  let workingState = args.state;
  let ledgerRecordedViaBridge = false;

  if (args.restDestination === 'graveyard') {
    const result = commitCardZoneChanges({
      state: workingState,
      playerId: args.playerId,
      cards: rest,
      sourceZone: 'library',
      intendedDestination: 'graveyard',
      stepIndex: args.stepIndex,
      stepKind: args.stepKind,
      cause: args.cause || 'oracle_ir:look_select_top_rest',
      ctx: args.ctx,
    });
    if (result.halted) {
      return { state: workingState, halted: true, ledgerRecordedViaBridge: false };
    }
    return {
      state: result.state,
      halted: false,
      ledgerRecordedViaBridge: result.ledgerRecordedViaBridge,
    };
  }

  const orderedRest = orderLookSelectRestCards(rest, {
    restToTop: args.restToTop,
    restRandomOrder: args.restRandomOrder,
    restLibraryPlacement: args.restLibraryPlacement,
  });
  const libraryPlacement = args.destination === 'library_top'
    ? 'bottom' as const
    : (args.restLibraryPlacement ?? (args.restToTop ? 'top' as const : 'top' as const));

  for (const card of orderedRest) {
    const result = commitCardZoneChanges({
      state: workingState,
      playerId: args.playerId,
      cards: [card],
      sourceZone: 'library',
      intendedDestination: 'library',
      stepIndex: args.stepIndex,
      stepKind: args.stepKind,
      cause: args.cause || 'oracle_ir:look_select_top_rest',
      ctx: args.ctx,
      libraryPlacement,
    });
    if (result.halted) {
      return { state: workingState, halted: true, ledgerRecordedViaBridge };
    }
    workingState = result.state;
    if (result.ledgerRecordedViaBridge) ledgerRecordedViaBridge = true;
  }

  return { state: workingState, halted: false, ledgerRecordedViaBridge };
}

/** Record library-top look/reveal observations via pre-commit bridge without zone mutation. */
export function commitLibraryTopObservation(args: {
  playerId: PlayerID;
  cards: readonly unknown[];
  stepIndex: number;
  stepKind: string;
  cause?: string;
  ctx?: OracleIRExecutionContext;
}): { halted: boolean; ledgerRecordedViaBridge: boolean } {
  const cards = (Array.isArray(args.cards) ? args.cards : []).filter(Boolean);
  if (cards.length === 0) {
    return { halted: false, ledgerRecordedViaBridge: false };
  }

  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return { halted: false, ledgerRecordedViaBridge: false };
  }

  const transitions = buildZoneChangeTransitionsFromCards({
    cards,
    sourceZone: 'library',
    intendedDestination: 'library',
    ownerId: args.playerId,
    stepIndex: args.stepIndex,
    stepKind: args.stepKind,
    cause: args.cause || 'oracle_ir:library_observation',
    ctx: args.ctx,
  });

  const bridgeResult = bridge.proposeTransitions(transitions);
  if (bridgeResult.halt) {
    if (args.ctx?.transitionHaltState) {
      args.ctx.transitionHaltState.halted = true;
      args.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
    }
    return { halted: true, ledgerRecordedViaBridge: false };
  }

  return { halted: false, ledgerRecordedViaBridge: true };
}
