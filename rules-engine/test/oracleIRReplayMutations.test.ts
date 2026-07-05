import { describe, expect, it } from 'vitest';

import {
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
