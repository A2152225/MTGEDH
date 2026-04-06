import { describe, expect, it } from 'vitest';

import { applyEvent } from '../src/state/modules/applyEvent';

describe('delayed graveyard return applyEvent', () => {
  it('replay scheduleDelayedGraveyardReturn rebuilds pending delayed graveyard returns', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'scheduleDelayedGraveyardReturn',
      playerId: 'p1',
      sourceName: 'Resurrection Orb',
      entries: [
        {
          scheduleId: 'delayed_1',
          cardId: 'creature_card_1',
          zoneOwnerId: 'p1',
          fireAtTurnNumber: 3,
          sourceName: 'Resurrection Orb',
          createdBy: 'p1',
          destination: 'battlefield',
          battlefieldControllerMode: 'owner',
          battlefieldTapped: true,
          battlefieldCounters: { '+1/+1': 1 },
        },
      ],
    } as any);

    expect((ctx.state as any).pendingDelayedGraveyardReturns).toEqual([
      {
        scheduleId: 'delayed_1',
        cardId: 'creature_card_1',
        zoneOwnerId: 'p1',
        fireAtTurnNumber: 3,
        fireAtStep: 'end_step',
        fireAtPlayerId: undefined,
        sourceName: 'Resurrection Orb',
        createdBy: 'p1',
        destination: 'battlefield',
        destinationUsesSelectedCardOwner: false,
        battlefieldControllerMode: 'owner',
        battlefieldControllerId: undefined,
        battlefieldTapped: true,
        battlefieldCounters: { '+1/+1': 1 },
      },
    ]);
  });

  it('replay scheduleDelayedGraveyardReturn preserves next-upkeep firing metadata', () => {
    const ctx: any = {
      state: {
        battlefield: [],
        stack: [],
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'scheduleDelayedGraveyardReturn',
      playerId: 'p1',
      sourceName: 'Phytotitan',
      entries: [
        {
          scheduleId: 'delayed_upkeep_1',
          cardId: 'phytotitan_card_1',
          zoneOwnerId: 'p1',
          fireAtTurnNumber: 5,
          fireAtStep: 'upkeep',
          fireAtPlayerId: 'p1',
          sourceName: 'Phytotitan',
          createdBy: 'p1',
          destination: 'battlefield',
          battlefieldControllerMode: 'owner',
          battlefieldTapped: true,
        },
      ],
    } as any);

    expect((ctx.state as any).pendingDelayedGraveyardReturns).toEqual([
      {
        scheduleId: 'delayed_upkeep_1',
        cardId: 'phytotitan_card_1',
        zoneOwnerId: 'p1',
        fireAtTurnNumber: 5,
        fireAtStep: 'upkeep',
        fireAtPlayerId: 'p1',
        sourceName: 'Phytotitan',
        createdBy: 'p1',
        destination: 'battlefield',
        destinationUsesSelectedCardOwner: false,
        battlefieldControllerMode: 'owner',
        battlefieldControllerId: undefined,
        battlefieldTapped: true,
        battlefieldCounters: undefined,
      },
    ]);
  });
});