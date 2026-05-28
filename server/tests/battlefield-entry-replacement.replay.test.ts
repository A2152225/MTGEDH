import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('battlefield-entry replacement replay semantics', () => {
  it('replays permanent spell resolution with battlefield-entry replacement metadata', () => {
    const game = createInitialGameState('t_battlefield_entry_replacement_replay_metadata');
    const playerId = 'p1' as PlayerID;
    addPlayer(game, playerId, 'P1');

    (game.state as any).stack = [
      {
        id: 'stack_entry_replacement_1',
        type: 'spell',
        controller: playerId,
        source: 'hand',
        card: {
          id: 'entry_replacement_card_1',
          name: 'Entry Archivist',
          type_line: 'Artifact Creature - Wizard',
          oracle_text: 'This creature enters tapped.',
          power: '2',
          toughness: '2',
        },
        entersBattlefieldWithCounters: { '+1/+1': 2 },
      },
    ];

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const permanent = battlefield.find((entry: any) => entry?.card?.id === 'entry_replacement_card_1') as any;

    expect((game.state as any).stack).toEqual([]);
    expect(permanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: true,
      counters: { '+1/+1': 2 },
      basePower: 2,
      baseToughness: 2,
      card: {
        id: 'entry_replacement_card_1',
        name: 'Entry Archivist',
        zone: 'battlefield',
      },
    });
    expect(permanent?.battlefieldEntryReplacement).toMatchObject({
      applied: true,
      eventType: 'battlefield-entry',
      effectId: 'battlefield-entry-modified',
      sourceName: 'Entry Archivist',
      reason: 'battlefield_entry_replacement',
      metadata: {
        controllerId: playerId,
        effects: ['entersTapped', 'entryCounters'],
        entersTapped: true,
        entryCounters: { '+1/+1': 2 },
        entersTransformed: false,
        entersFaceDown: false,
      },
    });
  });
});