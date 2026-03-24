import { beforeEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('Skullbriar zone counters', () => {
  const playerId = 'p1' as PlayerID;

  beforeEach(() => {
    ResolutionQueueManager.removeQueue('skullbriar_gy');
    ResolutionQueueManager.removeQueue('skullbriar_cz');
  });

  it('keeps Skullbriar counters when it moves from battlefield to graveyard', () => {
    const g = createInitialGameState('skullbriar_gy');

    (g.state as any).players = [{ id: playerId, name: 'P1', life: 40 }];
    (g.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    g.state.battlefield.push({
      id: 'skull_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: { '+1/+1': 3 },
      card: {
        id: 'skull_card',
        name: 'Skullbriar, the Walking Grave',
        type_line: 'Legendary Creature - Elemental Zombie',
        oracle_text:
          "Haste\nWhenever Skullbriar, the Walking Grave deals combat damage to a player, put a +1/+1 counter on it.\nCounters remain on it as it moves to any zone other than a player's hand or library.",
        power: '1',
        toughness: '1',
      },
    } as any);

    g.movePermanentToGraveyard('skull_perm', true);

    const graveyard = ((g.state as any).zones?.[playerId]?.graveyard || []) as any[];
    expect(graveyard).toHaveLength(1);
    expect(graveyard[0]?.name).toBe('Skullbriar, the Walking Grave');
    expect(graveyard[0]?.counters).toEqual({ '+1/+1': 3 });
  });

  it('preserves Skullbriar counters on the queued commander-zone replacement payload', () => {
    const g = createInitialGameState('skullbriar_cz');

    (g.state as any).players = [{ id: playerId, name: 'P1', life: 40 }];
    (g.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        commandZone: [],
        commandZoneCount: 0,
      },
    };
    (g.state as any).commandZone = {
      [playerId]: {
        commanderIds: ['skull_card'],
        commanderNames: ['Skullbriar, the Walking Grave'],
        tax: 0,
        taxById: { skull_card: 0 },
        inCommandZone: [],
      },
    };

    g.state.battlefield.push({
      id: 'skull_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      isCommander: true,
      counters: { '+1/+1': 4 },
      card: {
        id: 'skull_card',
        name: 'Skullbriar, the Walking Grave',
        type_line: 'Legendary Creature - Elemental Zombie',
        oracle_text:
          "Haste\nWhenever Skullbriar, the Walking Grave deals combat damage to a player, put a +1/+1 counter on it.\nCounters remain on it as it moves to any zone other than a player's hand or library.",
        power: '1',
        toughness: '1',
      },
    } as any);

    g.movePermanentToGraveyard('skull_perm', true);

    const queue = ResolutionQueueManager.getQueue('skullbriar_cz');
    const step = queue.steps.find((entry: any) => entry?.commanderZoneChoice === true);

    expect(step).toBeTruthy();
    expect((step as any).card?.counters).toEqual({ '+1/+1': 4 });
    expect((step as any).fromZone).toBe('graveyard');
  });
});
