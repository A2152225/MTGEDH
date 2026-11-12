import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { executeSearchLibrary } from '../src/actions/searchLibrary';
import { putLookChosenCardsOntoBattlefield } from '../src/oracleIRExecutorLookChooseBattlefieldEntry';
import { tryApplyMoveZoneGuardsFromCommandZonePermanent } from '../src/oracleIRExecutorMoveZoneGuardsCommandZonePermanent';
import { applySearchLibraryStep } from '../src/oracleIRExecutorPlayerSearchLibraryStep';
import {
  takeAndStampCardFromZoneArray,
} from '../src/oracleIRExecutorZoneOpsBattlefieldEntry';

function bears(id: string) {
  return {
    id,
    name: 'Grizzly Bears',
    layout: 'normal',
    type_line: 'Creature — Bear',
    oracle_text: '',
    power: '2',
    toughness: '2',
  };
}

function midLibraryState(playerId: PlayerID = 'p1') {
  const top = bears('top');
  const mid = bears('mid');
  const bottom = bears('bottom');
  const player: any = {
    id: playerId,
    library: [top, mid, bottom],
    graveyard: [],
    hand: [],
    exile: [],
    life: 40,
  };
  const state = {
    players: [player],
    battlefield: [],
  } as unknown as GameState;
  return { state, player, top, mid, bottom };
}

function libraryIds(state: GameState, playerId: PlayerID = 'p1'): string[] {
  const player = state.players.find((entry) => entry.id === playerId) as any;
  return (Array.isArray(player?.library) ? player.library : []).map((card: any) => String(card.id));
}

describe('CR 20261106 rejected enter-transformed library restore by path', () => {
  it('look-choose restores a mid-library card to its original index', () => {
    const { state, player, mid } = midLibraryState();
    const result = putLookChosenCardsOntoBattlefield({
      state,
      playerId: 'p1',
      player,
      cards: [mid],
      entersTransformed: true,
      stepKind: 'look_choose',
    });
    expect(result.halted).toBe(false);
    expect(result.state.battlefield).toHaveLength(0);
    expect(libraryIds(result.state)).toEqual(['top', 'mid', 'bottom']);
  });

  it('search_library IR restores a mid-library card to its original index', () => {
    const { state } = midLibraryState();
    const result = applySearchLibraryStep(
      state,
      {
        kind: 'search_library',
        who: { kind: 'you' },
        destination: 'battlefield',
        shuffle: false,
        entersTransformed: true,
        maxResults: 1,
        criteria: { text: 'card' },
        raw: 'Search your library for a card and put it onto the battlefield transformed.',
      } as any,
      {
        controllerId: 'p1',
        selectorContext: { chosenObjectIds: ['mid'] },
      } as any,
    );
    expect(result.applied).toBe(true);
    expect((result as any).state.battlefield).toHaveLength(0);
    expect(libraryIds((result as any).state)).toEqual(['top', 'mid', 'bottom']);
  });

  it('command-zone among-them library path restores a mid-library card to its original index', () => {
    const { state, mid } = midLibraryState();
    const finalizeAppliedResult = (value: any) => {
      if (!value || value.kind === 'impossible') {
        return { applied: false, state, log: ['unavailable'] };
      }
      return { applied: true, state: value.state, log: value.log || [] };
    };
    const result = tryApplyMoveZoneGuardsFromCommandZonePermanent({
      state,
      nextState: state,
      step: {
        kind: 'move_zone',
        to: 'battlefield',
        entersTransformed: true,
        raw: 'Put a card that shares a type among them onto the battlefield transformed.',
      },
      ctx: {
        controllerId: 'p1',
        lastMovedCards: [mid],
        selectorContext: { chosenObjectIds: ['mid'] },
      },
      runtime: { lastMovedCards: [mid] },
      log: [],
      controllerId: 'p1',
      effectiveWithCounters: undefined,
      battlefieldEntryOverrides: undefined,
      finalizeAppliedResult,
      zoneQueries: { parsedSharesTypeFromAmongThem: true },
    } as any);
    expect(result).toBeTruthy();
    expect((result as any).applied).toBe(true);
    expect((result as any).state.battlefield).toHaveLength(0);
    expect(libraryIds((result as any).state)).toEqual(['top', 'mid', 'bottom']);
  });

  it('legacy searchLibrary action restores a mid-library card to its original index', () => {
    const { state } = midLibraryState();
    const result = executeSearchLibrary(
      'game-1',
      {
        type: 'searchLibrary',
        playerId: 'p1',
        destination: 'battlefield',
        entersTransformed: true,
        shuffle: false,
        selectedCardIds: ['mid'],
      } as any,
      {
        getState: () => state,
        emit: () => undefined,
      } as any,
    );
    expect(result.next.battlefield).toHaveLength(0);
    expect(libraryIds(result.next)).toEqual(['top', 'mid', 'bottom']);
  });

  it('takeAndStampCardFromZoneArray records the pre-removal mid-library index', () => {
    const library = [bears('top'), bears('mid'), bears('bottom')];
    const taken = takeAndStampCardFromZoneArray(library, 'mid', 'library');
    expect(taken?.sourceZone).toBe('library');
    expect(taken?.sourceIndex).toBe(1);
    expect(library.map((card) => card.id)).toEqual(['top', 'bottom']);
  });
});
