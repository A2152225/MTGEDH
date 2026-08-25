/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: targeted zone movers — moveTargetedCardFromGraveyard, moveTopCardFromLibrary,
 * moveBottomCardFromLibrary, moveTargetedCardFromAnyGraveyard,
 * attachExistingBattlefieldPermanentToTarget.
 * Public entry symbols: those five functions.
 */
import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { type OracleIrBattlefieldEntryContext } from './oracleIRExecutorBattlefieldEntryCommit';
import { getCurrentTurnNumber, stampCardsPutIntoGraveyardThisTurn } from './oracleIRExecutorPlayerUtils';
import {
  addBattlefieldPermanentsToState,
  canCardEnterAttachedToTarget,
  createBattlefieldPermanentsFromCards,
  getBattlefieldAttachmentTarget,
  resolveBattlefieldEntryBeforeCommit,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import type { BattlefieldEntryCardOverrides } from './oracleIRExecutorZoneOpsBattlefieldEntry';
import { tryCommitNonBattlefieldZoneMove } from './oracleIRExecutorZoneOpsGraveyardSelectMoves';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { cardMatchesMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetMatchers';
import { getCardTypeLineLower } from './oracleIRExecutorZoneOpsThisWayParsers';

export function moveTargetedCardFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  referenceCardName?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  referencePower?: number,
  oracleIrEntry?: OracleIrBattlefieldEntryContext
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } | { readonly kind: 'halted' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const index = graveyard.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = graveyard[index];
  if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, getCurrentTurnNumber(state), referencePower)) {
    return { kind: 'impossible' };
  }

  const kept = graveyard.filter((_: any, i: number) => i !== index);
  if (destination === 'hand') {
    const bridged = tryCommitNonBattlefieldZoneMove({
      state,
      playerId,
      card,
      sourceZone: 'graveyard',
      intendedDestination: 'hand',
      oracleIrEntry,
    });
    if (bridged.kind === 'halted') return { kind: 'halted' };
    if (bridged.kind === 'applied') {
      return {
        kind: 'applied',
        state: bridged.state,
        log: [`${playerId} returns 1 card from graveyard to hand`],
        movedCards: [...bridged.movedCards],
      };
    }

    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} returns 1 card from graveyard to hand`],
      movedCards: [card],
    };
  }

  if (destination === 'exile') {
    const bridged = tryCommitNonBattlefieldZoneMove({
      state,
      playerId,
      card,
      sourceZone: 'graveyard',
      intendedDestination: 'exile',
      oracleIrEntry,
    });
    if (bridged.kind === 'halted') return { kind: 'halted' };
    if (bridged.kind === 'applied') {
      return {
        kind: 'applied',
        state: bridged.state,
        log: [`${playerId} exiles 1 card from graveyard`],
        movedCards: [...bridged.movedCards],
      };
    }

    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const nextExile = [...exile, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: nextExile } as any) : p
    );
    const nextState: any = { ...state, players: updatedPlayers as any };
    if (nextState.zones && typeof nextState.zones === 'object') {
      const ownerZones = nextState.zones[playerId] || {};
      nextState.zones = {
        ...nextState.zones,
        [playerId]: {
          ...ownerZones,
          graveyard: kept,
          graveyardCount: kept.length,
          exile: nextExile,
          exileCount: nextExile.length,
        },
      };
    }
    return {
      kind: 'applied',
      state: nextState as any,
      log: [`${playerId} exiles 1 card from graveyard`],
      movedCards: [card],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const bridged = tryCommitNonBattlefieldZoneMove({
      state,
      playerId,
      card,
      sourceZone: 'graveyard',
      intendedDestination: 'library',
      libraryPlacement: destination === 'library_top' ? 'top' : 'bottom',
      oracleIrEntry,
    });
    if (bridged.kind === 'halted') return { kind: 'halted' };
    if (bridged.kind === 'applied') {
      return {
        kind: 'applied',
        state: bridged.state,
        log: [`${playerId} puts 1 card from graveyard on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`],
        movedCards: [...bridged.movedCards],
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const nextLibrary = destination === 'library_top' ? [card, ...library] : [...library, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from graveyard on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`],
      movedCards: [card],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, battlefieldEntryOverrides))
  ) {
    return { kind: 'impossible' };
  }

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
    'gy',
    attachmentTarget,
    battlefieldEntryOverrides
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts 1 card from ${playerId}'s graveyard onto the battlefield`],
    movedCards: [card],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveTopCardFromLibrary(
  state: GameState,
  playerId: PlayerID,
  destination: 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  faceDownWardCost?: string,
  oracleIrEntry?: OracleIrBattlefieldEntryContext
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } | { readonly kind: 'halted' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  if (library.length <= 0) {
    return {
      kind: 'applied',
      state,
      log: [`${playerId} cannot move the top card of their library (empty library)`],
      movedCards: [],
    };
  }

  const [card, ...keptLibrary] = library;

  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: keptLibrary, hand } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} moves the top card of their library to their hand`],
      movedCards: [card],
    };
  }

  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId
        ? ({
            ...(p as any),
            library: keptLibrary,
            graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, [card])],
          } as any)
        : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} moves the top card of their library to their graveyard`],
      movedCards: [card],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile, card] : [card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: keptLibrary, exile } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles the top card of their library`],
      movedCards: [card],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const nextLibrary = destination === 'library_top' ? [card, ...keptLibrary] : [...keptLibrary, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [
        `${playerId} puts the top card of their library on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`,
      ],
      movedCards: [card],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, battlefieldEntryOverrides))
  ) {
    return { kind: 'impossible' };
  }

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
    'library',
    attachmentTarget,
    battlefieldEntryOverrides,
    faceDownWardCost
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library: keptLibrary } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts the top card of ${playerId}'s library onto the battlefield`],
    movedCards: [card],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveBottomCardFromLibrary(
  state: GameState,
  playerId: PlayerID,
  destination: 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  faceDownWardCost?: string,
  oracleIrEntry?: OracleIrBattlefieldEntryContext
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } | { readonly kind: 'halted' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  if (library.length <= 0) {
    return {
      kind: 'applied',
      state,
      log: [`${playerId} cannot move the bottom card of their library (empty library)`],
      movedCards: [],
    };
  }

  const card = library[library.length - 1];
  const keptLibrary = library.slice(0, -1);

  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: keptLibrary, hand } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} moves the bottom card of their library to their hand`],
      movedCards: [card],
    };
  }

  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId
        ? ({
            ...(p as any),
            library: keptLibrary,
            graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, [card])],
          } as any)
        : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} moves the bottom card of their library to their graveyard`],
      movedCards: [card],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile, card] : [card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: keptLibrary, exile } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles the bottom card of their library`],
      movedCards: [card],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const nextLibrary = destination === 'library_top' ? [card, ...keptLibrary] : [...keptLibrary, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [
        `${playerId} puts the bottom card of their library on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`,
      ],
      movedCards: [card],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, battlefieldEntryOverrides))
  ) {
    return { kind: 'impossible' };
  }

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
    'library',
    attachmentTarget,
    battlefieldEntryOverrides,
    faceDownWardCost
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library: keptLibrary } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts the bottom card of ${playerId}'s library onto the battlefield`],
    movedCards: [card],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveTargetedCardFromAnyGraveyard(
  state: GameState,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  referenceCardName?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  referencePower?: number
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } | { readonly kind: 'halted' } {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  for (const player of (state.players || []) as any[]) {
    const playerId = String(player?.id || '').trim();
    const zoneGraveyard = Array.isArray((state as any).zones?.[playerId]?.graveyard)
      ? (state as any).zones[playerId].graveyard
      : [];
    const graveyard = [
      ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
      ...zoneGraveyard,
    ];
    if (graveyard.some((card: any) => String(card?.id || '').trim() === wantedId)) {
      if (
        playerId
        && !(Array.isArray(player?.graveyard) ? player.graveyard : []).some(
          (card: any) => String(card?.id || '').trim() === wantedId,
        )
      ) {
        const found = zoneGraveyard.find((card: any) => String(card?.id || '').trim() === wantedId);
        player.graveyard = [...(Array.isArray(player.graveyard) ? player.graveyard : []), found];
      }
      return moveTargetedCardFromGraveyard(
        state,
        player.id as PlayerID,
        wantedId,
        criteria,
        destination,
        battlefieldControllerId,
        entersTapped,
        entersFaceDown,
        withCounters,
        attachedToBattlefieldPermanentId,
        referenceCardName,
        battlefieldEntryOverrides,
        referencePower
      );
    }
  }

  return { kind: 'impossible' };
}

export function attachExistingBattlefieldPermanentToTarget(
  state: GameState,
  attachmentPermanentId: string,
  targetPermanentId: string
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const attachmentId = String(attachmentPermanentId || '').trim();
  const targetId = String(targetPermanentId || '').trim();
  if (!attachmentId || !targetId || attachmentId === targetId) return { kind: 'impossible' };

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const attachment = battlefield.find(perm => String((perm as any)?.id || '').trim() === attachmentId) as any;
  const target = battlefield.find(perm => String((perm as any)?.id || '').trim() === targetId) as any;
  if (!attachment || !target) return { kind: 'impossible' };

  const typeLine = getCardTypeLineLower(attachment);
  const isEquipment = typeLine.includes('equipment');
  // CR 303.4: attaching a non-Aura enchantment (Necromancy, Animate Dead) makes it an Aura.
  const becomesAura = typeLine.includes('enchantment') && !typeLine.includes('aura') && !isEquipment;
  const previousTargetId = String((attachment as any)?.attachedTo || '').trim();

  const updatedBattlefield = battlefield.map((perm: any) => {
    const permId = String(perm?.id || '').trim();
    if (!permId) return perm;

    if (permId === attachmentId) {
      const currentTypeLine = String(perm?.card?.type_line || perm?.type_line || '').trim();
      const nextTypeLine = becomesAura
        ? (/\u2014|—/.test(currentTypeLine) ? `${currentTypeLine} Aura` : `${currentTypeLine} \u2014 Aura`)
        : currentTypeLine;
      return {
        ...perm,
        attachedTo: targetId,
        ...(isEquipment ? { isEquipped: true } : {}),
        ...(becomesAura
          ? {
              card: {
                ...(perm.card || {}),
                type_line: nextTypeLine,
              },
            }
          : {}),
      };
    }

    let nextAttachments = Array.isArray(perm.attachments) ? [...perm.attachments] : [];
    let nextAttachedEquipment = Array.isArray(perm.attachedEquipment) ? [...perm.attachedEquipment] : [];

    if (permId === previousTargetId) {
      nextAttachments = nextAttachments.filter(id => String(id || '').trim() !== attachmentId);
      nextAttachedEquipment = nextAttachedEquipment.filter(id => String(id || '').trim() !== attachmentId);
    }

    if (permId === targetId) {
      if (!nextAttachments.includes(attachmentId)) nextAttachments.push(attachmentId);
      if (isEquipment && !nextAttachedEquipment.includes(attachmentId)) nextAttachedEquipment.push(attachmentId);
    }

    const out: any = { ...perm, attachments: nextAttachments };
    if (isEquipment) {
      out.attachedEquipment = nextAttachedEquipment;
      out.isEquipped = nextAttachedEquipment.length > 0;
    }
    return out;
  });

  return {
    kind: 'applied',
    state: { ...state, battlefield: updatedBattlefield as any } as any,
    log: [`${attachmentId} attaches to ${targetId}`],
  };
}

