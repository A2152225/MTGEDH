import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('station_activated applyEvent / undo-replay', () => {
  it('applies charge counters, stationed flag, grantedTypes, and taps the crewing creature', () => {
    const gameId = 't_station_activated_apply';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'station_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'station_card', name: 'The Seriema', type_line: 'Legendary Artifact — Spacecraft' },
      },
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'creature_card', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ];

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'station_step_1',
      type: ResolutionStepType.STATION_CREATURE_SELECTION,
      playerId: p1,
      description: 'Choose a creature to station',
      mandatory: true,
      tapForCountersSource: { id: 'station_1', name: 'The Seriema', counterType: 'charge', threshold: 7 },
      sourceId: 'station_1',
    } as any);

    game.applyEvent({
      type: 'station_activated',
      playerId: p1,
      resolvedStepId: 'station_step_1',
      stationId: 'station_1',
      stationName: 'The Seriema',
      creatureId: 'creature_1',
      creatureName: 'Bear',
      creaturePower: 2,
      counterType: 'charge',
      countersAdded: 2,
      totalCounters: 2,
      threshold: 7,
      stationed: false,
      ts: Date.now(),
    } as any);

    const battlefield = (game.state as any).battlefield || [];
    const station = battlefield.find((p: any) => p.id === 'station_1');
    const creature = battlefield.find((p: any) => p.id === 'creature_1');
    expect(station?.counters).toEqual({ charge: 2 });
    expect(station?.stationed).toBeFalsy();
    expect(creature?.tapped).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue?.steps?.some((s: any) => s?.id === 'station_step_1')).toBe(false);
    expect(String(queue?.activeStep?.id || '')).not.toBe('station_step_1');
  });

  it('sets stationed + Creature grantedTypes when threshold is met', () => {
    const gameId = 't_station_activated_stationed';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'station_1',
        controller: p1,
        owner: p1,
        counters: { charge: 5 },
        card: { id: 'station_card', name: 'The Seriema', type_line: 'Legendary Artifact — Spacecraft' },
      },
      {
        id: 'creature_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'creature_card', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ];

    game.applyEvent({
      type: 'station_activated',
      playerId: p1,
      stationId: 'station_1',
      creatureId: 'creature_1',
      counterType: 'charge',
      countersAdded: 2,
      totalCounters: 7,
      threshold: 7,
      stationed: true,
      grantedTypes: ['Creature'],
    } as any);

    const station = ((game.state as any).battlefield || []).find((p: any) => p.id === 'station_1');
    expect(station?.counters).toEqual({ charge: 7 });
    expect(station?.stationed).toBe(true);
    expect(station?.grantedTypes).toEqual(['Creature']);
  });

  it('does not double-add counters when updateCounters already reached totalCounters (IR path)', () => {
    const gameId = 't_station_activated_idempotent';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).battlefield = [
      {
        id: 'station_1',
        controller: p1,
        owner: p1,
        counters: {},
        card: { id: 'station_card', name: 'The Seriema', type_line: 'Legendary Artifact — Spacecraft' },
      },
    ];

    // Simulate IR-persisted counter event that already applied the charge delta.
    game.applyEvent({
      type: 'updateCounters',
      permanentId: 'station_1',
      deltas: { charge: 3 },
      skipCounterModifications: true,
    } as any);

    game.applyEvent({
      type: 'station_activated',
      playerId: p1,
      stationId: 'station_1',
      counterType: 'charge',
      countersAdded: 3,
      totalCounters: 3,
      threshold: 7,
      stationed: false,
    } as any);

    const station = ((game.state as any).battlefield || []).find((p: any) => p.id === 'station_1');
    expect(station?.counters).toEqual({ charge: 3 });
  });
});
