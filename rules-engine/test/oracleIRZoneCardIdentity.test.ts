import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { createBattlefieldPermanentsFromCards } from '../src/oracleIRExecutorZoneOpsBattlefieldEntry.js';
import {
  flattenZoneCardForBattlefield,
  isUsableCardDisplayName,
  mergeRevealedCardIdentity,
} from '../src/oracleIRExecutorZoneCardIdentity.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

const WARP_WORLD_TEXT =
  "Each player shuffles all permanents they own into their library, then reveals that many cards from the top of their library. Each player puts all artifact, creature, and land cards revealed this way onto the battlefield, then does the same for enchantment cards, then puts all cards revealed this way that weren't put onto the battlefield on the bottom of their library.";

describe('Warp World battlefield card identity', () => {
  it('does not treat a permanent id as a display name', () => {
    expect(isUsableCardDisplayName('Island', 'oracle-island')).toBe(true);
    expect(isUsableCardDisplayName('perm_8kgpfc9j', 'perm_8kgpfc9j')).toBe(false);
    expect(isUsableCardDisplayName('perm-aa6e1fb5-a06b-4e10-8cc7-785e0f0b298e_mtdz0wj6')).toBe(false);
  });

  it('flattens nested card wrappers onto the battlefield card object', () => {
    const permanents = createBattlefieldPermanentsFromCards(
      [{
        id: 'perm_oldisland',
        card: {
          id: 'oracle-island',
          name: 'Island',
          type_line: 'Basic Land — Island',
          image_uris: { small: 'https://example.com/island.jpg' },
        },
      }],
      'p1' as PlayerID,
      'p1' as PlayerID,
      false,
      false,
      undefined,
      'library',
    );
    expect(permanents[0]?.card?.name).toBe('Island');
    expect(permanents[0]?.card?.image_uris?.small).toBe('https://example.com/island.jpg');
    expect(permanents[0]?.card?.card).toBeUndefined();
  });

  it('merges a revealed snapshot onto a nameless duplicate-id stub', () => {
    const merged = mergeRevealedCardIdentity(
      { id: 'oracle-island' },
      {
        id: 'oracle-island',
        name: 'Island',
        type_line: 'Basic Land — Island',
        image_uris: { small: 'https://example.com/island.jpg' },
      },
    );
    expect(flattenZoneCardForBattlefield(merged).name).toBe('Island');
    expect(merged.image_uris?.small).toBe('https://example.com/island.jpg');
  });

  it('puts duplicate-id lands with names instead of the library stub', () => {
    const p1 = 'p1' as PlayerID;
    const islandId = 'oracle-island';
    const namedIsland = {
      id: islandId,
      owner: p1,
      name: 'Island',
      type_line: 'Basic Land — Island',
      image_uris: { small: 'https://example.com/island.jpg' },
    };
    const state = {
      players: [{
        id: p1,
        hand: [],
        graveyard: [],
        library: [
          { id: islandId },
          { ...namedIsland },
        ],
      }],
      battlefield: [],
      life: { [p1]: 40 },
    } as unknown as GameState;

    const allSteps = collectOracleEffectSteps(WARP_WORLD_TEXT, 'Warp World');
    const putSteps = (allSteps || []).filter((step) => step.kind === 'move_zone').slice(1);
    expect(putSteps.map((step) => step.kind)).toEqual(['move_zone', 'move_zone', 'move_zone']);

    const result = applyOracleIRStepsToGameState(
      state,
      putSteps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'warp_world_spell',
        sourceName: 'Warp World',
        sourceObjectType: 'spell',
        lastRevealedCards: [namedIsland, { ...namedIsland }],
        lastMovedCountByPlayer: { [p1]: 2 },
      }),
      { allowOptional: true },
    );

    const battlefield = (result.state.battlefield || []) as any[];
    expect(battlefield.length).toBeGreaterThan(0);
    for (const perm of battlefield) {
      expect(perm.card?.name).toBe('Island');
      expect(String(perm.card?.name || '')).not.toEqual(String(perm.id || ''));
      expect(perm.card?.image_uris?.small).toBe('https://example.com/island.jpg');
    }
  });
});
