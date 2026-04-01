import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('castSpellContinuation replay semantics', () => {
  it('replays life payment and in-hand spell updates', () => {
    const game = createInitialGameState('t_cast_spell_continuation_life_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    const player = ((game.state as any).players || []).find((entry: any) => entry?.id === p1);
    if (player) player.life = 40;

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Necrologia',
        type_line: 'Instant',
        oracle_text: 'As an additional cost to cast this spell, pay X life.',
        zone: 'hand',
      },
    ];
    zones.handCount = zones.hand.length;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      lifePaid: 5,
      cardUpdates: {
        lifePaymentAmount: 5,
      },
    } as any);

    expect((game.state as any).life[p1]).toBe(35);
    expect(player?.life).toBe(35);
    expect((game.state as any).lifeLostThisTurn[p1]).toBe(5);
    expect((zones.hand[0] as any).lifePaymentAmount).toBe(5);
  });

  it('replays discarded cards, sacrificed permanents, and bargain flags', () => {
    const game = createInitialGameState('t_cast_spell_continuation_bargain_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Beseech the Mirror',
        type_line: 'Sorcery',
        oracle_text: 'Bargain',
        zone: 'hand',
      },
      {
        id: 'discard_1',
        name: 'Spare Card',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'hand',
      },
    ];
    zones.handCount = zones.hand.length;
    zones.graveyard = [];
    zones.graveyardCount = 0;

    (game.state as any).battlefield = [
      {
        id: 'treasure_perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      moveHandCards: [
        {
          cardId: 'discard_1',
          destination: 'graveyard',
        },
      ],
      sacrificedPermanentIds: ['treasure_perm_1'],
      cardUpdates: {
        bargainResolved: true,
        wasBargained: true,
      },
    } as any);

    expect(zones.hand.map((card: any) => card.id)).toEqual(['spell_1']);
    expect(zones.handCount).toBe(1);
    expect(zones.graveyardCount).toBe(2);
    expect((game.state as any).battlefield).toHaveLength(0);

    const graveyardIds = (zones.graveyard as any[]).map((card: any) => card.id).sort();
    expect(graveyardIds).toEqual(['discard_1', 'treasure_card_1']);
    expect((zones.hand[0] as any).bargainResolved).toBe(true);
    expect((zones.hand[0] as any).wasBargained).toBe(true);
  });

  it('replays alternate-cost exiles and spell flags', () => {
    const game = createInitialGameState('t_cast_spell_continuation_force_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).life = { [p1]: 40 };
    const player = ((game.state as any).players || []).find((entry: any) => entry?.id === p1);
    if (player) player.life = 40;

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Force of Will',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'hand',
      },
      {
        id: 'blue_1',
        name: 'Ponder',
        type_line: 'Sorcery',
        oracle_text: '',
        colors: ['U'],
        zone: 'hand',
      },
    ];
    zones.handCount = zones.hand.length;
    zones.exile = [];
    zones.exileCount = 0;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      lifePaid: 1,
      moveHandCards: [
        {
          cardId: 'blue_1',
          destination: 'exile',
          cardUpdates: {
            exiledForAlternateCost: true,
            exiledForSpellCardId: 'spell_1',
          },
        },
      ],
      cardUpdates: {
        forceAltCostPaid: true,
        forceAltCostExiledCardId: 'blue_1',
        lifePaymentAmount: 1,
      },
    } as any);

    expect((game.state as any).life[p1]).toBe(39);
    expect(player?.life).toBe(39);
    expect(zones.handCount).toBe(1);
    expect(zones.exileCount).toBe(1);
    expect((zones.exile[0] as any).id).toBe('blue_1');
    expect((zones.exile[0] as any).zone).toBe('exile');
    expect((zones.exile[0] as any).exiledForAlternateCost).toBe(true);
    expect((zones.exile[0] as any).exiledForSpellCardId).toBe('spell_1');
    expect((zones.hand[0] as any).forceAltCostPaid).toBe(true);
    expect((zones.hand[0] as any).forceAltCostExiledCardId).toBe('blue_1');
    expect((zones.hand[0] as any).lifePaymentAmount).toBe(1);
  });

  it('replays null card updates by clearing transient spell flags', () => {
    const game = createInitialGameState('t_cast_spell_continuation_clear_flags_replay');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const zones = (game.state as any).zones[p1];
    zones.hand = [
      {
        id: 'spell_1',
        name: 'Miracle Spell',
        type_line: 'Instant',
        oracle_text: '',
        zone: 'hand',
        isFirstDrawnThisTurn: true,
        drawnAt: 123,
      },
    ];
    zones.handCount = zones.hand.length;

    game.applyEvent({
      type: 'castSpellContinuation',
      playerId: p1,
      cardId: 'spell_1',
      cardUpdates: {
        isFirstDrawnThisTurn: null,
        drawnAt: null,
      },
    } as any);

    expect('isFirstDrawnThisTurn' in (zones.hand[0] as any)).toBe(false);
    expect('drawnAt' in (zones.hand[0] as any)).toBe(false);
  });
});