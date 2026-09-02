/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: targeted hand/exile movers — moveTargetedCardFromHand, moveTargetedCardFromExile.
 * Public entry symbols: moveTargetedCardFromHand, moveTargetedCardFromExile.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { type OracleIrBattlefieldEntryContext } from './oracleIRExecutorBattlefieldEntryCommit';
import { stampCardPutIntoGraveyardThisTurn } from './oracleIRExecutorPlayerUtils';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
  resolveBattlefieldEntryBeforeCommit,
  resolveMoverAttachment,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import type { BattlefieldEntryCardOverrides } from './oracleIRExecutorZoneOpsBattlefieldEntry';
import { cardMatchesType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { tryCommitNonBattlefieldZoneMove } from './oracleIRExecutorZoneOpsGraveyardSelectMoves';

export function moveTargetedCardFromHand(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  cardType: SimpleCardType,
  destination: 'graveyard' | 'exile' | 'battlefield',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  oracleIrEntry?: OracleIrBattlefieldEntryContext
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } | { readonly kind: 'halted' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const index = hand.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = hand[index];
  if (!cardMatchesType(card, cardType)) return { kind: 'impossible' };

  const kept = hand.filter((_: any, i: number) => i !== index);
  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const movedCard = stampCardPutIntoGraveyardThisTurn(state, card);
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), hand: kept, graveyard: [...graveyard, movedCard] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from hand to graveyard`],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), hand: kept, exile: [...exile, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles 1 card from hand`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachment = resolveMoverAttachment(
    state,
    card,
    controllerId,
    attachedToBattlefieldPermanentId,
    battlefieldEntryOverrides,
  );
  if (attachment.kind === 'impossible') return { kind: 'impossible' };

  const entryResolution = resolveBattlefieldEntryBeforeCommit(
    state,
    card,
    controllerId,
    { entersTapped, entersFaceDown, withCounters },
    oracleIrEntry,
  );
  if (entryResolution.kind === 'halted') return { kind: 'halted' };

  const newPermanent = createBattlefieldPermanentsFromCards(
    [card],
    playerId,
    controllerId,
    entryResolution.entersTapped,
    entryResolution.entersFaceDown,
    entryResolution.withCounters,
    'hand',
    attachment.attachmentTarget,
    battlefieldEntryOverrides,
    undefined,
    attachment.enchantedPlayerId,
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts 1 card from ${playerId}'s hand onto the battlefield`],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveTargetedCardFromExile(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  cardType: SimpleCardType,
  destination: 'hand' | 'graveyard' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  oracleIrEntry?: OracleIrBattlefieldEntryContext
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } | { readonly kind: 'halted' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const index = exile.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = exile[index];
  if (!cardMatchesType(card, cardType)) return { kind: 'impossible' };

  const kept = exile.filter((_: any, i: number) => i !== index);
  if (destination === 'hand') {
    const bridged = tryCommitNonBattlefieldZoneMove({
      state,
      playerId,
      card,
      sourceZone: 'exile',
      intendedDestination: 'hand',
      oracleIrEntry,
    });
    if (bridged.kind === 'halted') return { kind: 'halted' };
    if (bridged.kind === 'applied') {
      return {
        kind: 'applied',
        state: bridged.state,
        log: [`${playerId} returns 1 card from exile to hand`],
      };
    }

    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, hand: [...hand, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} returns 1 card from exile to hand`],
    };
  }

  if (destination === 'graveyard') {
    const bridged = tryCommitNonBattlefieldZoneMove({
      state,
      playerId,
      card,
      sourceZone: 'exile',
      intendedDestination: 'graveyard',
      oracleIrEntry,
    });
    if (bridged.kind === 'halted') return { kind: 'halted' };
    if (bridged.kind === 'applied') {
      return {
        kind: 'applied',
        state: bridged.state,
        log: [`${playerId} puts 1 card from exile to graveyard`],
      };
    }

    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const movedCard = stampCardPutIntoGraveyardThisTurn(state, card);
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, graveyard: [...graveyard, movedCard] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from exile to graveyard`],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const bridged = tryCommitNonBattlefieldZoneMove({
      state,
      playerId,
      card,
      sourceZone: 'exile',
      intendedDestination: 'library',
      libraryPlacement: destination === 'library_top' ? 'top' : 'bottom',
      oracleIrEntry,
    });
    if (bridged.kind === 'halted') return { kind: 'halted' };
    if (bridged.kind === 'applied') {
      return {
        kind: 'applied',
        state: bridged.state,
        log: [`${playerId} puts 1 card from exile on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`],
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const nextLibrary = destination === 'library_top' ? [card, ...library] : [...library, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from exile on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachment = resolveMoverAttachment(
    state,
    card,
    controllerId,
    attachedToBattlefieldPermanentId,
    battlefieldEntryOverrides,
  );
  if (attachment.kind === 'impossible') return { kind: 'impossible' };

  const entryResolution = resolveBattlefieldEntryBeforeCommit(
    state,
    card,
    controllerId,
    { entersTapped, entersFaceDown, withCounters },
    oracleIrEntry,
  );
  if (entryResolution.kind === 'halted') return { kind: 'halted' };

  const newPermanent = createBattlefieldPermanentsFromCards(
    [card],
    playerId,
    controllerId,
    entryResolution.entersTapped,
    entryResolution.entersFaceDown,
    entryResolution.withCounters,
    'exile',
    attachment.attachmentTarget,
    battlefieldEntryOverrides,
    undefined,
    attachment.enchantedPlayerId,
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), exile: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts 1 card from ${playerId}'s exile onto the battlefield`],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}
