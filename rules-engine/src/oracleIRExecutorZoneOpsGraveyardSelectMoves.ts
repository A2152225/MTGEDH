/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: exact/up-to graveyard selection plus return/shuffle/put/exile movers,
 * from ExactGraveyardSelection through tryCommitNonBattlefieldZoneMove.
 * Public entry symbols: returnUpToMatchingFromGraveyardToHand,
 * shuffleUpToMatchingFromGraveyardIntoLibrary,
 * putUpToMatchingFromGraveyardOntoBattlefieldWithController,
 * exileExactMatchingFromGraveyard, exileExactCountFromHand,
 * returnExactMatchingFromGraveyardToHand,
 * putExactMatchingFromGraveyardOntoBattlefieldWithController.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { type OracleIrBattlefieldEntryContext } from './oracleIRExecutorBattlefieldEntryCommit';
import { commitCardZoneChanges } from './oracleIRExecutorCardZoneTransitionCommit';
import { getCurrentTurnNumber } from './oracleIRExecutorPlayerUtils';
import {
  addBattlefieldPermanentsToState,
  canCardEnterAttachedToTarget,
  createBattlefieldPermanentsFromCards,
  getBattlefieldAttachmentTarget,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import { cardMatchesType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { cardMatchesMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetMatchers';

type ExactGraveyardSelection =
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number }
  | {
      readonly kind: 'deterministic';
      readonly kept: readonly any[];
      readonly moved: readonly any[];
    };

function selectExactMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType,
  preferredIds: readonly string[] = []
): ExactGraveyardSelection {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  if (preferred.length >= count) {
    const moved = preferred
      .map(id => graveyard.find((card: any) => String(card?.id || '').trim() === id))
      .filter((card): card is any => Boolean(card) && cardMatchesType(card, cardType))
      .slice(0, count);
    if (moved.length === count) {
      const movedIds = new Set(moved.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
      return {
        kind: 'deterministic',
        kept: graveyard.filter((card: any) => !movedIds.has(String(card?.id || '').trim())),
        moved,
      };
    }
  }

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length < count) return { kind: 'impossible', available: moved.length };
  if (moved.length > count) return { kind: 'player_choice_required', available: moved.length };
  return { kind: 'deterministic', kept, moved };
}

export function selectUpToMatchingFromGraveyardWithCriteria(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = [],
  referenceCardName?: string,
  referencePower?: number
): ExactGraveyardSelection {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const excluded = new Set(excludeIds.map(id => String(id || '').trim()).filter(Boolean));
  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || excluded.has(cardId)) return false;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) {
      return false;
    }
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });

  if (matches.length === 0 && preferred.size > 0) {
    const relaxed = graveyard.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || excluded.has(cardId)) return false;
      return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower);
    });
    if (relaxed.length === 0) return { kind: 'impossible', available: 0 };
    if (relaxed.length > maxCount) return { kind: 'player_choice_required', available: relaxed.length };
    const movedIds = new Set(relaxed.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
    return {
      kind: 'deterministic',
      kept: graveyard.filter((card: any) => !movedIds.has(String(card?.id || '').trim())),
      moved: relaxed,
    };
  }

  if (matches.length === 0) return { kind: 'impossible', available: 0 };
  if (matches.length > maxCount) return { kind: 'player_choice_required', available: matches.length };

  const movedIds = new Set(matches.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
  return {
    kind: 'deterministic',
    kept: graveyard.filter((card: any) => !movedIds.has(String(card?.id || '').trim())),
    moved: matches,
  };
}

export function returnUpToMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(
    state,
    playerId,
    maxCount,
    criteria,
    preferredIds,
    excludeIds
  );
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], hand: [...hand, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${selection.moved.length} card(s) from graveyard to hand`],
  };
}

export function shuffleUpToMatchingFromGraveyardIntoLibrary(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(
    state,
    playerId,
    maxCount,
    criteria,
    preferredIds,
    excludeIds
  );
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const library = Array.isArray(player?.library) ? [...player.library] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({ ...(p as any), graveyard: [...selection.kept], library: [...library, ...selection.moved] } as any)
      : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} shuffles ${selection.moved.length} card(s) from graveyard into library`],
  };
}

export function putUpToMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[]; readonly movedPermanentIds: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(
    state,
    sourcePlayerId,
    maxCount,
    criteria,
    preferredIds,
    excludeIds
  );
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [], movedPermanentIds: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !selection.moved.every(card => canCardEnterAttachedToTarget(card, controllerId, attachmentTarget)))
  ) {
    return { kind: 'impossible', available: selection.moved.length };
  }

  const newPermanents = createBattlefieldPermanentsFromCards(
    [...selection.moved],
    sourcePlayerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'gy',
    attachmentTarget
  );
  const updatedPlayers = state.players.map(p =>
    p.id === sourcePlayerId ? ({ ...(p as any), graveyard: [...selection.kept] } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${selection.moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function exileExactMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, playerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], exile: [...exile, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${selection.moved.length} card(s) from graveyard`],
  };
}

export function exileExactCountFromHand(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType = 'any',
  preferredIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'applied', state, log: [] };

  const hand = Array.isArray(player.hand) ? player.hand : [];
  const available = hand.filter((card: any) => cardMatchesType(card, cardType));
  if (available.length < count) {
    return available.length === 0
      ? { kind: 'impossible', available: 0 }
      : { kind: 'player_choice_required', available: available.length };
  }

  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  const selected: any[] = [];
  for (const card of available) {
    const cardId = String((card as any)?.id || '').trim();
    if (preferred.length > 0 && !preferred.includes(cardId)) continue;
    selected.push(card);
    if (selected.length >= count) break;
  }
  if (selected.length < count) {
    for (const card of available) {
      const cardId = String((card as any)?.id || '').trim();
      if (selected.some(entry => String((entry as any)?.id || '').trim() === cardId)) continue;
      selected.push(card);
      if (selected.length >= count) break;
    }
  }
  if (selected.length < count) return { kind: 'impossible', available: available.length };

  const selectedIds = new Set(selected.map(card => String((card as any)?.id || '').trim()).filter(Boolean));
  const keptHand = hand.filter((card: any) => !selectedIds.has(String((card as any)?.id || '').trim()));
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: keptHand, exile: [...exile, ...selected] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${selected.length} card(s) from hand`],
  };
}

export function returnExactMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType,
  preferredIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, playerId, count, cardType, preferredIds);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], hand: [...hand, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${selection.moved.length} card(s) from graveyard to hand`],
  };
}

export function putExactMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  count: number,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[]; readonly movedPermanentIds: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, sourcePlayerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [], movedPermanentIds: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (attachedToBattlefieldPermanentId && (!attachmentTarget || !selection.moved.every(card => canCardEnterAttachedToTarget(card, controllerId, attachmentTarget)))) {
    return { kind: 'impossible', available: selection.moved.length };
  }

  const newPermanents = createBattlefieldPermanentsFromCards(
    [...selection.moved],
    sourcePlayerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'gy',
    attachmentTarget
  );
  const updatedPlayers = state.players.map(p =>
    p.id === sourcePlayerId ? ({ ...(p as any), graveyard: [...selection.kept] } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${selection.moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function tryCommitNonBattlefieldZoneMove(args: {
  state: GameState;
  playerId: PlayerID;
  card: unknown;
  sourceZone: 'graveyard' | 'exile' | 'hand' | 'library';
  intendedDestination: 'hand' | 'graveyard' | 'exile' | 'library';
  libraryPlacement?: 'top' | 'bottom';
  oracleIrEntry?: OracleIrBattlefieldEntryContext;
}):
  | { readonly kind: 'not_bridged' }
  | { readonly kind: 'halted' }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'applied'; readonly state: GameState; readonly movedCards: readonly any[] } {
  const ctx = args.oracleIrEntry?.ctx;
  const stepIndex = ctx?.currentStepIndex;
  if (!ctx?.serverBridge || !Number.isFinite(stepIndex)) {
    return { kind: 'not_bridged' };
  }

  const commitResult = commitCardZoneChanges({
    state: args.state,
    playerId: args.playerId,
    cards: [args.card],
    sourceZone: args.sourceZone,
    intendedDestination: args.intendedDestination,
    stepIndex: Number(stepIndex),
    stepKind: args.oracleIrEntry?.stepKind || 'move_zone',
    cause: 'oracle_ir:move_zone',
    ctx,
    libraryPlacement: args.libraryPlacement,
  });
  if (commitResult.halted) return { kind: 'halted' };
  if (commitResult.movedCards.length === 0) return { kind: 'impossible' };
  return {
    kind: 'applied',
    state: commitResult.state,
    movedCards: commitResult.movedCards,
  };
}
