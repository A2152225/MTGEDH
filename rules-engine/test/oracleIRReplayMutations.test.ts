import { describe, expect, it } from 'vitest';

import {
  buildBattlefieldDestroyReplayMutations,
  buildCreateTokenReplayMutations,
  buildMoveZoneReplayMutations,
  collectReplayMutationsFromAppliedStep,
} from '../src/oracleIRReplayMutations';
import type { GameState, PlayerID } from '../../shared/src';

describe('oracle IR replay mutations', () => {
  it('builds createToken mutations from created token ids on battlefield', () => {
    const state = {
      battlefield: [{
        id: 'token_1',
        controller: 'p1',
        isToken: true,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'token_1',
          name: 'Soldier',
          type_line: 'Creature — Soldier',
          colors: ['W'],
          keywords: ['haste'],
        },
      }],
    } as GameState;

    expect(buildCreateTokenReplayMutations(state, ['token_1'])).toEqual([{
      kind: 'createToken',
      controllerId: 'p1',
      tokenData: {
        id: 'token_1',
        name: 'Soldier',
        typeLine: 'Creature — Soldier',
        power: 1,
        toughness: 1,
        colors: ['W'],
        abilities: ['haste'],
        hasHaste: true,
      },
    }]);
  });

  it('builds exilePermanent mutations from exiled battlefield permanent ids', () => {
    expect(collectReplayMutationsFromAppliedStep(
      { kind: 'exile', target: { kind: 'raw', text: 'it' }, raw: 'exile it' } as any,
      { lastExiledBattlefieldPermanentIds: ['arch_perm'] },
      { battlefield: [], players: [] } as GameState,
      { controllerId: 'p1' as PlayerID, sourceId: 'arch_perm', sourceName: "Archfiend's Vessel" },
    )).toEqual([{
      kind: 'exilePermanent',
      permanentId: 'arch_perm',
      sourcePermanentId: 'arch_perm',
      sourceName: "Archfiend's Vessel",
    }]);
  });

  it('builds goad mutations from lastGoadedCreatures', () => {
    expect(collectReplayMutationsFromAppliedStep(
      { kind: 'goad', target: { kind: 'raw', text: 'target creature' }, raw: 'Goad target creature.' } as any,
      {
        applied: true,
        lastGoadedCreatures: [{ id: 'bear_1', controller: 'p2' }],
        log: ['Goaded 1 creature(s)'],
      },
      { battlefield: [{ id: 'bear_1', controller: 'p2' }], players: [], turnNumber: 7 } as GameState,
      { controllerId: 'p1' as PlayerID },
    )).toEqual([{
      kind: 'goad',
      permanentId: 'bear_1',
      goaderId: 'p1',
      expiryTurn: 8,
    }]);
  });

  it('builds graveyard zone moves for destroyed cards and tokens', () => {
    expect(buildBattlefieldDestroyReplayMutations([
      {
        id: 'mogg_perm',
        owner: 'p1',
        controller: 'p1',
        card: { id: 'mogg_card', name: 'Mogg Maniac', type_line: 'Creature — Goblin' },
      },
      {
        id: 'goblin_token',
        owner: 'p2',
        controller: 'p2',
        isToken: true,
        card: { id: 'goblin_token', name: 'Goblin', type_line: 'Creature — Goblin' },
      },
    ])).toEqual([
      {
        kind: 'effectProgramZoneMove',
        playerId: 'p1',
        fromPlayerId: 'p1',
        cardId: 'mogg_card',
        fromZone: 'battlefield',
        toZone: 'graveyard',
        card: { id: 'mogg_card', name: 'Mogg Maniac', type_line: 'Creature — Goblin', zone: 'graveyard' },
        fromPermanentId: 'mogg_perm',
        skipGraveyardEntryTriggers: true,
      },
      {
        kind: 'effectProgramZoneMove',
        playerId: 'p2',
        fromPlayerId: 'p2',
        cardId: 'goblin_token',
        fromZone: 'battlefield',
        toZone: 'graveyard',
        card: { id: 'goblin_token', name: 'Goblin', type_line: 'Creature — Goblin', zone: 'graveyard', isToken: true },
        fromPermanentId: 'goblin_token',
        skipGraveyardEntryTriggers: true,
      },
    ]);
  });

  it('builds move zone mutations from explicit from/to zones', () => {
    const card = { id: 'gy-1', name: 'Shock', owner: 'p1' };
    expect(buildMoveZoneReplayMutations({
      fromZone: 'graveyard',
      toZone: 'hand',
      movedCards: [card],
      state: { players: [], battlefield: [] } as GameState,
      ctx: { controllerId: 'p1' as PlayerID },
    })).toEqual([{
      kind: 'effectProgramZoneMove',
      playerId: 'p1',
      fromPlayerId: 'p1',
      cardId: 'gy-1',
      fromZone: 'graveyard',
      toZone: 'hand',
      card,
    }]);
  });
});
