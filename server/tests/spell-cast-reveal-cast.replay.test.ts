import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('spell-cast reveal/cast replay semantics', () => {
  beforeEach(() => {
    for (const gameId of [
      't_spell_bottom_reveal_choice_replay',
      't_revealed_cast_choice_replay',
    ]) {
      resetGame(gameId);
    }
  });

  it('replays the bottom-reveal choice by clearing the initial prompt and queueing the cast choice', () => {
    const gameId = 't_spell_bottom_reveal_choice_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game as any).libraries = new Map();
    (game as any).libraries.set(p1, [
      { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
      { id: 'hit_1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', zone: 'library' },
    ]);
    (game.state as any).zones[p1].library = [
      { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
      { id: 'hit_1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', zone: 'library' },
    ];
    (game.state as any).zones[p1].libraryCount = 2;
    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: p1,
        card: { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', owner: p1, zone: 'stack' },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'cast_1',
      queuedResolutionStep: {
        id: 'queued_bottom_reveal_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        description: 'Neera, Wild Mage: Put Opt on the bottom of its owner\'s library and reveal until a nonland?',
        mandatory: false,
        sourceId: 'neera_perm',
        sourceName: 'Neera, Wild Mage',
        options: [
          { id: 'yes', label: 'Use ability' },
          { id: 'no', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        spellBottomRevealUntilNonlandChoice: true,
        triggeringStackItemId: 'spell_1',
        triggeringSpellCard: { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', owner: p1 },
        revealFromLibraryPlayerId: p1,
        revealSourcePermanentId: 'neera_perm',
      },
    } as any);

    game.applyEvent({
      type: 'spellBottomRevealUntilNonlandResolve',
      playerId: p1,
      resolvedStepId: 'queued_bottom_reveal_choice_1',
      choice: 'yes',
      triggeringStackItemId: 'spell_1',
      spellOwnerId: p1,
      revealFromLibraryPlayerId: p1,
      ownerLibraryAfter: [
        { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.' },
      ],
      revealLibraryAfter: [
        { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.' },
      ],
      queuedResolutionStep: {
        id: 'queued_reveal_cast_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        description: 'Neera, Wild Mage: Cast Lightning Bolt without paying its mana cost?',
        mandatory: false,
        sourceName: 'Neera, Wild Mage',
        sourceId: 'neera_perm',
        options: [
          { id: 'cast', label: 'Cast Lightning Bolt' },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        castRevealedFromLibraryChoice: true,
        castRevealedFromLibraryCard: {
          id: 'hit_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        castRevealedFromLibraryOtherCards: [
          { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain' },
        ],
        castRevealedFromLibraryPlayerId: p1,
      },
    } as any);

    expect(((game.state as any).stack || []).some((item: any) => item.id === 'spell_1')).toBe(false);
    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_reveal_cast_choice_1');
    expect((queue.steps[0] as any)?.castRevealedFromLibraryChoice).toBe(true);
    expect((((game as any).libraries.get(p1) || []) as any[]).map((card: any) => card.id)).toEqual(['cast_1']);
  });

  it('replays the revealed-card cast choice by clearing the prompt and restoring the stack item', () => {
    const gameId = 't_revealed_cast_choice_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game as any).libraries = new Map();
    (game as any).libraries.set(p1, [
      { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', zone: 'library' },
    ]);
    (game.state as any).zones[p1].library = [
      { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', zone: 'library' },
    ];
    (game.state as any).zones[p1].libraryCount = 1;

    ResolutionQueueManager.addStep(gameId, {
      id: 'queued_reveal_cast_choice_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1 as any,
      description: 'Neera, Wild Mage: Cast Lightning Bolt without paying its mana cost?',
      mandatory: false,
      sourceName: 'Neera, Wild Mage',
      sourceId: 'neera_perm',
      options: [
        { id: 'cast', label: 'Cast Lightning Bolt' },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      castRevealedFromLibraryChoice: true,
      castRevealedFromLibraryCard: {
        id: 'hit_1',
        name: 'Lightning Bolt',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      },
      castRevealedFromLibraryOtherCards: [
        { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain' },
      ],
      castRevealedFromLibraryPlayerId: p1,
    } as any);

    game.applyEvent({
      type: 'castRevealedFromLibraryResolve',
      playerId: p1,
      resolvedStepId: 'queued_reveal_cast_choice_1',
      choice: 'cast',
      cardId: 'hit_1',
      libraryAfter: [
        { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.' },
        { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain' },
      ],
      stackItem: {
        id: 'reveal_cast_spell_1',
        type: 'spell',
        controller: p1,
        targets: [],
        castFromHand: false,
        castWithoutPayingManaCost: true,
        card: {
          id: 'hit_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          zone: 'stack',
        },
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);
    expect((((game as any).libraries.get(p1) || []) as any[]).map((card: any) => card.id)).toEqual(['cast_1', 'land_1']);
    expect(((game.state as any).stack || []).map((item: any) => item.card?.name)).toEqual(['Lightning Bolt']);
  });
});